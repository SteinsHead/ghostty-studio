use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{BufReader, Cursor, Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::{
    codecs::jpeg::JpegEncoder, DynamicImage, ExtendedColorType, GenericImageView, ImageDecoder,
    ImageFormat, ImageReader, Limits,
};
use serde_json::to_vec;
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;

use crate::{
    error::CommandError,
    models::{
        BackgroundAssetMetadata, BackgroundAssetPreview, BackgroundAssetSummary,
        BackgroundAssetUsage, BackgroundImageState,
    },
};

const MAX_SOURCE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_ENCODED_BYTES: usize = 32 * 1024 * 1024;
const MAX_PREVIEW_BYTES: u64 = 2 * 1024 * 1024;
const MAX_METADATA_BYTES: u64 = 16 * 1024;
const MAX_DIMENSION: u32 = 8192;
const MAX_PIXELS: u64 = 32_000_000;
const MAX_DECODE_ALLOC: u64 = 192 * 1024 * 1024;
const MAX_LIBRARY_ASSETS: usize = 64;
const MAX_LIBRARY_BYTES: u64 = 512 * 1024 * 1024;
const MAX_DISPLAY_NAME_CHARS: usize = 120;
const LARGE_IMAGE_PIXELS: u64 = 12_000_000;
const PREVIEW_EDGE: u32 = 480;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SupportedFormat {
    Png,
    Jpeg,
}

impl SupportedFormat {
    fn image_format(self) -> ImageFormat {
        match self {
            Self::Png => ImageFormat::Png,
            Self::Jpeg => ImageFormat::Jpeg,
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpg",
        }
    }

    fn media_type(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
        }
    }

    fn from_media_type(value: &str) -> Option<Self> {
        match value {
            "image/png" => Some(Self::Png),
            "image/jpeg" => Some(Self::Jpeg),
            _ => None,
        }
    }
}

pub fn list(data_root: &Path) -> Result<Vec<BackgroundAssetSummary>, CommandError> {
    ensure_root(data_root)?;
    let root = library_root(data_root);
    let metadata_dir = root.join("metadata");
    let mut assets = Vec::new();
    let entries = fs::read_dir(&metadata_dir)?;
    for entry in entries {
        let entry = entry?;
        let file_name = entry.file_name();
        let Some(file_name) = file_name.to_str() else {
            continue;
        };
        let Some(asset_id) = file_name.strip_suffix(".json") else {
            continue;
        };
        if require_asset_id(asset_id).is_err() {
            continue;
        }
        let path = metadata_dir.join(format!("{asset_id}.json"));
        if let Ok(metadata) = read_metadata(&root, &path) {
            if verify_asset_bytes(&root, &metadata).is_ok()
                && verify_preview_bytes(&root, &metadata).is_ok()
            {
                assets.push(summary(metadata));
                if assets.len() > MAX_LIBRARY_ASSETS {
                    return Err(CommandError::new(
                        "background_library_too_large",
                        "the background image library contains too many entries",
                    ));
                }
            }
        }
    }
    assets.sort_by(|left, right| {
        right
            .imported_at_ms
            .cmp(&left.imported_at_ms)
            .then_with(|| left.display_name.cmp(&right.display_name))
    });
    Ok(assets)
}

pub fn import(data_root: &Path, source: &Path) -> Result<BackgroundAssetSummary, CommandError> {
    ensure_root(data_root)?;
    let root = library_root(data_root);
    let source_bytes = read_selected_file(source)?;
    let display_name = display_name_for_path(source);
    let (decoded, format) = decode_supported(&source_bytes)?;
    let (width, height) = decoded.dimensions();
    let sanitized = encode_image(&decoded, format, 92)?;
    if sanitized.len() > MAX_ENCODED_BYTES {
        return Err(CommandError::new(
            "background_image_too_large",
            "the normalized image exceeds the 32 MiB library limit",
        ));
    }

    let id = hex(&Sha256::digest(&sanitized));
    let metadata_path = root.join("metadata").join(format!("{id}.json"));
    let existing_metadata = read_metadata(&root, &metadata_path).ok();
    if let Some(metadata) = existing_metadata.as_ref().filter(|metadata| {
        metadata_matches_image(metadata, format, width, height, sanitized.len() as u64)
    }) {
        if verify_asset_bytes(&root, metadata).is_ok()
            && verify_preview_bytes(&root, metadata).is_ok()
        {
            return Ok(summary(metadata.clone()));
        }
    }

    let has_existing_artifact = artifact_paths(&root, &id)
        .iter()
        .any(|path| fs::symlink_metadata(path).is_ok());
    let asset_path = root
        .join("assets")
        .join(format!("{id}.{}", format.extension()));
    let (other_asset_ids, current_bytes) = managed_asset_usage(&root, &id, &asset_path)?;
    if !has_existing_artifact && other_asset_ids >= MAX_LIBRARY_ASSETS {
        return Err(CommandError::new(
            "background_library_full",
            "the background image library has reached its 64 image limit",
        ));
    }
    if current_bytes.saturating_add(sanitized.len() as u64) > MAX_LIBRARY_BYTES {
        return Err(CommandError::new(
            "background_library_full",
            "the background image library has reached its 512 MiB size limit",
        ));
    }

    persist_private_replacing(&asset_path, &sanitized)?;

    let preview = decoded.thumbnail(PREVIEW_EDGE, PREVIEW_EDGE);
    let preview_bytes = encode_image(&preview, format, 84)?;
    if preview_bytes.len() as u64 > MAX_PREVIEW_BYTES {
        return Err(CommandError::new(
            "background_preview_too_large",
            "the generated preview exceeds its safety limit",
        ));
    }
    let preview_path = root
        .join("previews")
        .join(format!("{id}.{}", format.extension()));
    persist_private_replacing(&preview_path, &preview_bytes)?;

    let metadata = BackgroundAssetMetadata {
        id: id.clone(),
        display_name: existing_metadata
            .as_ref()
            .filter(|metadata| {
                metadata_matches_image(metadata, format, width, height, sanitized.len() as u64)
            })
            .map(|metadata| metadata.display_name.clone())
            .unwrap_or(display_name),
        media_type: format.media_type().to_string(),
        width,
        height,
        size_bytes: sanitized.len() as u64,
        imported_at_ms: existing_metadata
            .as_ref()
            .filter(|metadata| {
                metadata_matches_image(metadata, format, width, height, sanitized.len() as u64)
            })
            .map(|metadata| metadata.imported_at_ms)
            .unwrap_or_else(now_ms),
    };
    let metadata_bytes = to_vec(&metadata).map_err(|error| {
        CommandError::new(
            "background_metadata_failed",
            format!("failed to encode private image metadata: {error}"),
        )
    })?;
    // Metadata is the commit marker for an asset. Write it last so an interrupted
    // repair remains invisible to list(), and the next import can retry safely.
    persist_private_replacing(&metadata_path, &metadata_bytes)?;

    let committed = read_metadata(&root, &metadata_path)?;
    verify_asset_bytes(&root, &committed)?;
    verify_preview_bytes(&root, &committed)?;
    Ok(summary(committed))
}

/// Removes every file Ghostty Studio can own for an asset id.
///
/// Each target is constructed inside a verified private library directory. Missing
/// files count as success, and all targets are attempted before an error is returned,
/// so a partially completed deletion is safe to retry.
pub fn remove(data_root: &Path, asset_id: &str) -> Result<(), CommandError> {
    require_asset_id(asset_id)?;
    ensure_root(data_root)?;
    let root = library_root(data_root);
    let targets = artifact_paths(&root, asset_id);
    let mut first_error = None;

    for path in targets {
        let result = match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_dir() => Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "managed image target is unexpectedly a directory",
            )),
            Ok(_) => fs::remove_file(&path),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        };
        if let Err(error) = result {
            first_error.get_or_insert(error);
        } else if let Some(parent) = path.parent() {
            let _ = File::open(parent).and_then(|directory| directory.sync_all());
        }
    }

    if let Some(error) = first_error {
        Err(CommandError::new(
            "background_asset_remove_failed",
            format!("one or more private image files could not be removed: {error}"),
        ))
    } else {
        Ok(())
    }
}

pub fn preview(data_root: &Path, asset_id: &str) -> Result<BackgroundAssetPreview, CommandError> {
    require_asset_id(asset_id)?;
    ensure_root(data_root)?;
    let root = library_root(data_root);
    let metadata_path = root.join("metadata").join(format!("{asset_id}.json"));
    let metadata = read_metadata(&root, &metadata_path)?;
    let format = SupportedFormat::from_media_type(&metadata.media_type).ok_or_else(|| {
        CommandError::new(
            "background_asset_corrupt",
            "the managed image has an unsupported media type",
        )
    })?;
    let path = match verify_preview_bytes(&root, &metadata) {
        Ok(path) => path,
        Err(_) => {
            let asset_path = verify_asset_bytes(&root, &metadata)?;
            let asset_bytes = read_regular_limited(&asset_path, MAX_SOURCE_BYTES)?;
            let (decoded, observed_format) = decode_supported(&asset_bytes)?;
            if observed_format != format {
                return Err(CommandError::new(
                    "background_asset_changed",
                    "the managed image no longer matches its private metadata",
                ));
            }
            let preview = decoded.thumbnail(PREVIEW_EDGE, PREVIEW_EDGE);
            let preview_bytes = encode_image(&preview, format, 84)?;
            if preview_bytes.len() as u64 > MAX_PREVIEW_BYTES {
                return Err(CommandError::new(
                    "background_preview_too_large",
                    "the generated preview exceeds its safety limit",
                ));
            }
            let repaired = root
                .join("previews")
                .join(format!("{asset_id}.{}", format.extension()));
            persist_private_replacing(&repaired, &preview_bytes)?;
            verify_preview_bytes(&root, &metadata)?
        }
    };
    let bytes = read_regular_limited(&path, MAX_PREVIEW_BYTES)?;
    Ok(BackgroundAssetPreview {
        asset_id: asset_id.to_string(),
        data_url: format!(
            "data:{};base64,{}",
            format.media_type(),
            STANDARD.encode(bytes)
        ),
    })
}

pub fn resolve_asset_path(data_root: &Path, asset_id: &str) -> Result<PathBuf, CommandError> {
    require_asset_id(asset_id)?;
    ensure_root(data_root)?;
    let root = library_root(data_root);
    let metadata_path = root.join("metadata").join(format!("{asset_id}.json"));
    let metadata = read_metadata(&root, &metadata_path)?;
    verify_asset_bytes(&root, &metadata)
}

pub fn state_for_value(
    data_root: &Path,
    source_config: Option<&Path>,
    value: Option<&str>,
) -> BackgroundImageState {
    let Some(value) = value.filter(|value| !value.trim().is_empty()) else {
        return BackgroundImageState {
            kind: "none".to_string(),
            asset_id: None,
        };
    };
    if ensure_root(data_root).is_err() {
        return external_state();
    }
    let root = library_root(data_root);
    let Some(candidate) = configured_image_path(source_config, value) else {
        return external_state();
    };
    let candidate_identity = fs::canonicalize(&candidate).ok();
    let managed_root_identity = fs::canonicalize(root.join("assets")).ok();
    let Some(candidate_identity) = candidate_identity else {
        return external_state();
    };
    if !Some(&candidate_identity)
        .zip(managed_root_identity.as_ref())
        .is_some_and(|(candidate, managed_root)| candidate.parent() == Some(managed_root.as_path()))
    {
        return external_state();
    }
    let Some(stem) = candidate_identity
        .file_stem()
        .and_then(|value| value.to_str())
    else {
        return external_state();
    };
    if resolve_asset_path(data_root, stem)
        .is_ok_and(|resolved| fs::canonicalize(resolved).ok().as_ref() == Some(&candidate_identity))
    {
        BackgroundImageState {
            kind: "managed".to_string(),
            asset_id: Some(stem.to_string()),
        }
    } else {
        external_state()
    }
}

/// Resolve a Ghostty background-image value without exposing it outside the backend.
/// Relative values are anchored to the file that declared them, matching Ghostty.
pub fn configured_image_path(source_config: Option<&Path>, raw_value: &str) -> Option<PathBuf> {
    let value = unquote(raw_value.trim()).trim();
    if value.is_empty() {
        return None;
    }
    if let Some(rest) = value.strip_prefix("~/") {
        return std::env::var_os("HOME")
            .map(PathBuf::from)
            .map(|home| home.join(rest));
    }
    let path = PathBuf::from(value);
    if path.is_absolute() {
        Some(path)
    } else {
        source_config
            .and_then(Path::parent)
            .map(|parent| parent.join(path))
    }
}

fn unquote(value: &str) -> &str {
    value
        .strip_prefix('"')
        .and_then(|remaining| remaining.strip_suffix('"'))
        .unwrap_or(value)
}

fn verify_asset_bytes(
    root: &Path,
    metadata: &BackgroundAssetMetadata,
) -> Result<PathBuf, CommandError> {
    let path = asset_path_for_metadata(root, metadata)?;
    let bytes = read_regular_limited(&path, MAX_SOURCE_BYTES)?;
    if hex(&Sha256::digest(&bytes)) != metadata.id || bytes.len() as u64 != metadata.size_bytes {
        return Err(CommandError::new(
            "background_asset_changed",
            "the managed image changed after it was imported",
        ));
    }
    let (decoded, format) = decode_supported(&bytes)?;
    if format.media_type() != metadata.media_type
        || decoded.dimensions() != (metadata.width, metadata.height)
    {
        return Err(CommandError::new(
            "background_asset_changed",
            "the managed image no longer matches its private metadata",
        ));
    }
    Ok(path)
}

fn verify_preview_bytes(
    root: &Path,
    metadata: &BackgroundAssetMetadata,
) -> Result<PathBuf, CommandError> {
    let format = SupportedFormat::from_media_type(&metadata.media_type).ok_or_else(|| {
        CommandError::new(
            "background_asset_corrupt",
            "the managed image has an unsupported media type",
        )
    })?;
    let path = root
        .join("previews")
        .join(format!("{}.{}", metadata.id, format.extension()));
    let bytes = read_regular_limited(&path, MAX_PREVIEW_BYTES)?;
    let (decoded, observed_format) = decode_supported(&bytes)?;
    if observed_format != format
        || decoded.width() > PREVIEW_EDGE
        || decoded.height() > PREVIEW_EDGE
    {
        return Err(CommandError::new(
            "background_asset_corrupt",
            "the managed image preview failed its integrity check",
        ));
    }
    Ok(path)
}

fn metadata_matches_image(
    metadata: &BackgroundAssetMetadata,
    format: SupportedFormat,
    width: u32,
    height: u32,
    size_bytes: u64,
) -> bool {
    metadata.media_type == format.media_type()
        && metadata.width == width
        && metadata.height == height
        && metadata.size_bytes == size_bytes
}

fn artifact_paths(root: &Path, asset_id: &str) -> [PathBuf; 5] {
    [
        root.join("metadata").join(format!("{asset_id}.json")),
        root.join("previews").join(format!("{asset_id}.png")),
        root.join("previews").join(format!("{asset_id}.jpg")),
        root.join("assets").join(format!("{asset_id}.png")),
        root.join("assets").join(format!("{asset_id}.jpg")),
    ]
}

fn managed_asset_usage(
    root: &Path,
    replaced_asset_id: &str,
    replaced_asset_path: &Path,
) -> Result<(usize, u64), CommandError> {
    let mut ids = HashSet::new();
    let mut bytes = 0_u64;
    for (directory, extensions, counts_bytes) in [
        ("assets", &["png", "jpg"][..], true),
        ("previews", &["png", "jpg"][..], false),
        ("metadata", &["json"][..], false),
    ] {
        let managed_directory = root.join(directory);
        for entry in fs::read_dir(&managed_directory)? {
            let entry = entry?;
            let file_name = entry.file_name();
            let Some(file_name) = file_name.to_str() else {
                continue;
            };
            let Some((asset_id, extension)) = file_name.rsplit_once('.') else {
                continue;
            };
            if !extensions.contains(&extension) {
                continue;
            }
            if require_asset_id(asset_id).is_err() {
                continue;
            }
            if asset_id != replaced_asset_id {
                ids.insert(asset_id.to_string());
            }
            let managed_path = managed_directory.join(format!("{asset_id}.{extension}"));
            if counts_bytes && managed_path != replaced_asset_path {
                let metadata = entry.metadata()?;
                if metadata.is_file() && !metadata.file_type().is_symlink() {
                    bytes = bytes.saturating_add(metadata.len());
                }
            }
        }
    }
    Ok((ids.len(), bytes))
}

fn decode_supported(bytes: &[u8]) -> Result<(DynamicImage, SupportedFormat), CommandError> {
    let reader = ImageReader::new(BufReader::new(Cursor::new(bytes)))
        .with_guessed_format()
        .map_err(|_| unsupported_image())?;
    let format = match reader.format() {
        Some(ImageFormat::Png) => SupportedFormat::Png,
        Some(ImageFormat::Jpeg) => SupportedFormat::Jpeg,
        _ => return Err(unsupported_image()),
    };
    let dimensions =
        ImageReader::with_format(BufReader::new(Cursor::new(bytes)), format.image_format())
            .into_dimensions()
            .map_err(|_| corrupt_image())?;
    validate_dimensions(dimensions.0, dimensions.1)?;

    let mut reader =
        ImageReader::with_format(BufReader::new(Cursor::new(bytes)), format.image_format());
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_DIMENSION);
    limits.max_image_height = Some(MAX_DIMENSION);
    limits.max_alloc = Some(MAX_DECODE_ALLOC);
    reader.limits(limits.clone());

    // ImageReader::decode does not apply EXIF orientation. Read it separately before
    // sanitizing JPEG metadata so photos from cameras keep their displayed direction.
    let orientation = if format == SupportedFormat::Jpeg {
        let mut orientation_reader =
            ImageReader::with_format(BufReader::new(Cursor::new(bytes)), format.image_format());
        orientation_reader.limits(limits);
        let mut decoder = orientation_reader
            .into_decoder()
            .map_err(|_| corrupt_image())?;
        Some(decoder.orientation().map_err(|_| corrupt_image())?)
    } else {
        None
    };

    let mut decoded = reader.decode().map_err(|_| corrupt_image())?;
    if let Some(orientation) = orientation {
        decoded.apply_orientation(orientation);
    }
    validate_dimensions(decoded.width(), decoded.height())?;
    Ok((decoded, format))
}

fn validate_dimensions(width: u32, height: u32) -> Result<(), CommandError> {
    let pixels = u64::from(width).saturating_mul(u64::from(height));
    if width == 0
        || height == 0
        || width > MAX_DIMENSION
        || height > MAX_DIMENSION
        || pixels > MAX_PIXELS
    {
        return Err(CommandError::new(
            "background_image_dimensions_too_large",
            "the image exceeds the 8192 pixel edge or 32 megapixel decode limit",
        ));
    }
    Ok(())
}

fn encode_image(
    image: &DynamicImage,
    format: SupportedFormat,
    jpeg_quality: u8,
) -> Result<Vec<u8>, CommandError> {
    let mut output = Vec::new();
    match format {
        SupportedFormat::Png => image
            .write_to(&mut Cursor::new(&mut output), ImageFormat::Png)
            .map_err(|_| corrupt_image())?,
        SupportedFormat::Jpeg => {
            let rgb = image.to_rgb8();
            JpegEncoder::new_with_quality(&mut output, jpeg_quality)
                .encode(
                    rgb.as_raw(),
                    rgb.width(),
                    rgb.height(),
                    ExtendedColorType::Rgb8,
                )
                .map_err(|_| corrupt_image())?;
        }
    }
    Ok(output)
}

fn read_selected_file(path: &Path) -> Result<Vec<u8>, CommandError> {
    if !path.is_absolute() {
        return Err(CommandError::new(
            "background_image_invalid_path",
            "the selected image path is not absolute",
        ));
    }
    read_regular_limited(path, MAX_SOURCE_BYTES)
}

fn read_regular_limited(path: &Path, limit: u64) -> Result<Vec<u8>, CommandError> {
    read_regular_limited_with_hook(path, limit, || {})
}

fn read_regular_limited_with_hook(
    path: &Path,
    limit: u64,
    before_open: impl FnOnce(),
) -> Result<Vec<u8>, CommandError> {
    let visible = fs::symlink_metadata(path).map_err(|_| {
        CommandError::new(
            "background_image_unreadable",
            "the selected image could not be opened",
        )
    })?;
    let invalid_file_type = visible.file_type().is_symlink() || !visible.is_file();
    if invalid_file_type || visible.len() > limit {
        return Err(CommandError::new(
            if invalid_file_type {
                "background_image_unreadable"
            } else {
                "background_image_too_large"
            },
            "the selected image must be a regular file within the size limit",
        ));
    }
    before_open();
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
    }
    let file = options.open(path).map_err(|_| {
        CommandError::new(
            "background_image_unreadable",
            "the selected image could not be opened safely",
        )
    })?;
    let opened = file.metadata()?;
    if !opened.is_file() || !same_file_identity(&visible, &opened) || opened.len() > limit {
        return Err(CommandError::new(
            "background_image_changed",
            "the selected image changed while it was being opened",
        ));
    }
    let mut bytes = Vec::with_capacity(opened.len() as usize);
    (&file).take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(CommandError::new(
            "background_image_too_large",
            "the selected image exceeds the size limit",
        ));
    }
    let completed = file.metadata()?;
    if !same_file_identity(&opened, &completed) || completed.len() != bytes.len() as u64 {
        return Err(CommandError::new(
            "background_image_changed",
            "the selected image changed while it was being read",
        ));
    }
    Ok(bytes)
}

#[cfg(unix)]
fn same_file_identity(left: &fs::Metadata, right: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;

    left.dev() == right.dev()
        && left.ino() == right.ino()
        && left.len() == right.len()
        && left.mtime() == right.mtime()
        && left.mtime_nsec() == right.mtime_nsec()
}

#[cfg(not(unix))]
fn same_file_identity(left: &fs::Metadata, right: &fs::Metadata) -> bool {
    left.len() == right.len() && left.modified().ok() == right.modified().ok()
}

fn library_root(data_root: &Path) -> PathBuf {
    data_root.join("backgrounds").join("v1")
}

fn ensure_root(data_root: &Path) -> Result<(), CommandError> {
    let root = library_root(data_root);
    for path in [
        data_root.to_path_buf(),
        data_root.join("backgrounds"),
        root.clone(),
        root.join("assets"),
        root.join("previews"),
        root.join("metadata"),
    ] {
        fs::create_dir_all(&path)?;
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(CommandError::new(
                "background_library_unavailable",
                "the private image library path is not a regular directory",
            ));
        }
        set_private_directory(&path)?;
    }
    Ok(())
}

fn asset_path_for_metadata(
    root: &Path,
    metadata: &BackgroundAssetMetadata,
) -> Result<PathBuf, CommandError> {
    require_asset_id(&metadata.id)?;
    let format = SupportedFormat::from_media_type(&metadata.media_type).ok_or_else(|| {
        CommandError::new(
            "background_asset_corrupt",
            "the managed image metadata has an unsupported media type",
        )
    })?;
    Ok(root
        .join("assets")
        .join(format!("{}.{}", metadata.id, format.extension())))
}

fn read_metadata(root: &Path, path: &Path) -> Result<BackgroundAssetMetadata, CommandError> {
    let bytes = read_regular_limited(path, MAX_METADATA_BYTES)?;
    let metadata: BackgroundAssetMetadata = serde_json::from_slice(&bytes).map_err(|_| {
        CommandError::new(
            "background_asset_corrupt",
            "the managed image metadata is invalid",
        )
    })?;
    require_asset_id(&metadata.id)?;
    if path.file_stem().and_then(|value| value.to_str()) != Some(metadata.id.as_str())
        || !valid_display_name(&metadata.display_name)
        || metadata.width == 0
        || metadata.height == 0
        || metadata.width > MAX_DIMENSION
        || metadata.height > MAX_DIMENSION
        || u64::from(metadata.width).saturating_mul(u64::from(metadata.height)) > MAX_PIXELS
        || metadata.size_bytes > MAX_SOURCE_BYTES
    {
        return Err(CommandError::new(
            "background_asset_corrupt",
            "the managed image metadata failed validation",
        ));
    }
    let expected_parent = root.join("metadata");
    if path.parent() != Some(expected_parent.as_path()) {
        return Err(CommandError::new(
            "background_asset_corrupt",
            "the managed image metadata is outside the private library",
        ));
    }
    Ok(metadata)
}

fn persist_private_replacing(path: &Path, bytes: &[u8]) -> Result<(), CommandError> {
    let parent = path.parent().ok_or_else(|| {
        CommandError::new(
            "background_library_unavailable",
            "the private image destination has no parent directory",
        )
    })?;
    if fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_dir()) {
        return Err(CommandError::new(
            "background_library_unavailable",
            "the private image destination is unexpectedly a directory",
        ));
    }
    let mut temporary = NamedTempFile::new_in(parent)?;
    set_private_file(temporary.as_file())?;
    temporary.write_all(bytes)?;
    temporary.as_file_mut().flush()?;
    temporary.as_file().sync_all()?;
    match temporary.persist(path) {
        Ok(file) => {
            set_private_file(&file)?;
            file.sync_all()?;
            let _ = File::open(parent).and_then(|directory| directory.sync_all());
            Ok(())
        }
        Err(error) => Err(CommandError::from(error.error)),
    }
}

fn require_asset_id(value: &str) -> Result<(), CommandError> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        Ok(())
    } else {
        Err(CommandError::new(
            "invalid_background_asset_id",
            "background asset id must be a lowercase SHA-256 digest",
        ))
    }
}

pub fn display_name_for_path(path: &Path) -> String {
    let raw = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Background image");
    let cleaned = raw
        .chars()
        .filter(|character| !forbidden_display_name_character(*character))
        .take(MAX_DISPLAY_NAME_CHARS)
        .collect::<String>();
    if cleaned.trim().is_empty() {
        "Background image".to_string()
    } else {
        cleaned
    }
}

fn valid_display_name(value: &str) -> bool {
    !value.trim().is_empty()
        && value.chars().count() <= MAX_DISPLAY_NAME_CHARS
        && !value.chars().any(forbidden_display_name_character)
}

fn forbidden_display_name_character(character: char) -> bool {
    character.is_control()
        || matches!(
            character as u32,
            0x202A..=0x202E | 0x2066..=0x2069 | 0x200E | 0x200F
        )
}

fn summary(metadata: BackgroundAssetMetadata) -> BackgroundAssetSummary {
    BackgroundAssetSummary {
        large_image_warning: u64::from(metadata.width).saturating_mul(u64::from(metadata.height))
            >= LARGE_IMAGE_PIXELS,
        id: metadata.id,
        display_name: metadata.display_name,
        media_type: metadata.media_type,
        width: metadata.width,
        height: metadata.height,
        size_bytes: metadata.size_bytes,
        imported_at_ms: metadata.imported_at_ms,
        usage: BackgroundAssetUsage {
            status: "unknown".to_string(),
            references: Vec::new(),
        },
    }
}

fn unsupported_image() -> CommandError {
    CommandError::new(
        "background_image_unsupported_format",
        "Ghostty Studio accepts PNG and JPEG background images",
    )
}

fn corrupt_image() -> CommandError {
    CommandError::new(
        "background_image_corrupt",
        "the selected PNG or JPEG image could not be decoded completely",
    )
}

fn external_state() -> BackgroundImageState {
    BackgroundImageState {
        kind: "external".to_string(),
        asset_id: None,
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(unix)]
fn set_private_directory(path: &Path) -> Result<(), CommandError> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

    let mut options = OpenOptions::new();
    options
        .read(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_DIRECTORY | libc::O_NOFOLLOW);
    let directory = options.open(path)?;
    if !directory.metadata()?.is_dir() {
        return Err(CommandError::new(
            "background_library_unavailable",
            "the private image library path is not a regular directory",
        ));
    }
    directory.set_permissions(fs::Permissions::from_mode(0o700))?;
    Ok(())
}

#[cfg(not(unix))]
fn set_private_directory(_path: &Path) -> Result<(), CommandError> {
    Ok(())
}

#[cfg(unix)]
fn set_private_file(file: &File) -> Result<(), CommandError> {
    use std::os::unix::fs::PermissionsExt;

    file.set_permissions(fs::Permissions::from_mode(0o600))?;
    Ok(())
}

#[cfg(not(unix))]
fn set_private_file(_file: &File) -> Result<(), CommandError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::ImageEncoder;

    fn initialized_root(data_root: &Path) -> PathBuf {
        ensure_root(data_root).unwrap();
        library_root(data_root)
    }

    fn test_png() -> Vec<u8> {
        let image = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            8,
            6,
            image::Rgba([40, 80, 120, 255]),
        ));
        encode_image(&image, SupportedFormat::Png, 90).unwrap()
    }

    fn test_oriented_jpeg() -> Vec<u8> {
        let image = image::RgbImage::from_pixel(3, 2, image::Rgb([40, 80, 120]));
        let mut bytes = Vec::new();
        let mut encoder = JpegEncoder::new_with_quality(&mut bytes, 90);
        let exif = vec![
            b'I', b'I', 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0,
            0,
        ];
        encoder.set_exif_metadata(exif).unwrap();
        encoder
            .encode(
                image.as_raw(),
                image.width(),
                image.height(),
                ExtendedColorType::Rgb8,
            )
            .unwrap();
        bytes
    }

    #[test]
    fn asset_ids_reject_paths_and_uppercase() {
        assert!(require_asset_id("../background.png").is_err());
        assert!(require_asset_id(&"A".repeat(64)).is_err());
        assert!(require_asset_id(&"a".repeat(64)).is_ok());
    }

    #[test]
    fn display_names_remove_controls_and_direction_overrides() {
        let name = display_name_for_path(Path::new("/tmp/a\u{202e}bc\n.png"));
        assert_eq!(name, "abc.png");
        assert!(!valid_display_name("a\u{202e}bc.png"));
        assert!(!valid_display_name("a\nbc.png"));
    }

    #[test]
    fn display_name_limit_is_120_unicode_scalars_in_import_and_metadata() {
        let directory = tempfile::tempdir().unwrap();
        let root = initialized_root(directory.path());
        let long_name = "图".repeat(MAX_DISPLAY_NAME_CHARS + 1);
        let displayed = display_name_for_path(Path::new(&format!("/tmp/{long_name}")));
        assert_eq!(displayed.chars().count(), MAX_DISPLAY_NAME_CHARS);

        let id = "a".repeat(64);
        let path = root.join("metadata").join(format!("{id}.json"));
        let mut metadata = BackgroundAssetMetadata {
            id,
            display_name: "图".repeat(MAX_DISPLAY_NAME_CHARS),
            media_type: "image/png".to_string(),
            width: 1,
            height: 1,
            size_bytes: 1,
            imported_at_ms: 1,
        };
        persist_private_replacing(&path, &serde_json::to_vec(&metadata).unwrap()).unwrap();
        assert!(read_metadata(&root, &path).is_ok());

        metadata.display_name.push('图');
        persist_private_replacing(&path, &serde_json::to_vec(&metadata).unwrap()).unwrap();
        assert_eq!(
            read_metadata(&root, &path).unwrap_err().code,
            "background_asset_corrupt"
        );
    }

    #[test]
    fn unsupported_bytes_are_rejected_before_storage() {
        let directory = tempfile::tempdir().unwrap();
        let error = import(directory.path(), Path::new("/does/not/exist")).unwrap_err();
        assert_eq!(error.code, "background_image_unreadable");
        assert!(decode_supported(b"GIF89a").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn regular_read_rejects_a_same_size_inode_replacement() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("selected.png");
        let replacement = directory.path().join("replacement.png");
        fs::write(&source, b"first").unwrap();
        fs::write(&replacement, b"other").unwrap();

        let error = read_regular_limited_with_hook(&source, 16, || {
            fs::rename(&replacement, &source).unwrap();
        })
        .unwrap_err();

        assert_eq!(error.code, "background_image_changed");
    }

    #[cfg(unix)]
    #[test]
    fn regular_read_rejects_a_symlink_without_touching_its_target() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let outside = directory.path().join("outside.png");
        let selected = directory.path().join("selected.png");
        fs::write(&outside, b"outside sentinel").unwrap();
        symlink(&outside, &selected).unwrap();

        let error = read_regular_limited(&selected, 64).unwrap_err();

        assert_eq!(error.code, "background_image_unreadable");
        assert_eq!(fs::read(&outside).unwrap(), b"outside sentinel");
    }

    #[cfg(unix)]
    #[test]
    fn private_persist_replaces_a_symlink_without_chmodding_its_target() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        let directory = tempfile::tempdir().unwrap();
        let root = initialized_root(directory.path());
        let destination = root.join("assets").join(format!("{}.png", "a".repeat(64)));
        let outside = directory.path().join("outside-sentinel");
        fs::write(&outside, b"keep outside").unwrap();
        fs::set_permissions(&outside, fs::Permissions::from_mode(0o640)).unwrap();
        let outside_mode = fs::metadata(&outside).unwrap().permissions().mode() & 0o777;
        symlink(&outside, &destination).unwrap();

        persist_private_replacing(&destination, b"managed copy").unwrap();

        assert!(!fs::symlink_metadata(&destination)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read(&destination).unwrap(), b"managed copy");
        assert_eq!(
            fs::metadata(&destination).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(fs::read(&outside).unwrap(), b"keep outside");
        assert_eq!(
            fs::metadata(&outside).unwrap().permissions().mode() & 0o777,
            outside_mode
        );
    }

    #[cfg(unix)]
    #[test]
    fn private_root_rejects_a_symlinked_directory_without_chmodding_its_target() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        let directory = tempfile::tempdir().unwrap();
        let data_root = directory.path().join("app-data");
        let outside = directory.path().join("outside-directory");
        fs::create_dir(&data_root).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::set_permissions(&outside, fs::Permissions::from_mode(0o750)).unwrap();
        let outside_mode = fs::metadata(&outside).unwrap().permissions().mode() & 0o777;
        symlink(&outside, data_root.join("backgrounds")).unwrap();

        let error = ensure_root(&data_root).unwrap_err();

        assert_eq!(error.code, "background_library_unavailable");
        assert_eq!(
            fs::metadata(&outside).unwrap().permissions().mode() & 0o777,
            outside_mode
        );
    }

    #[test]
    fn jpeg_exif_orientation_is_applied_before_metadata_is_removed() {
        let source = test_oriented_jpeg();
        let raw = ImageReader::with_format(
            BufReader::new(Cursor::new(source.as_slice())),
            ImageFormat::Jpeg,
        )
        .decode()
        .unwrap();
        assert_eq!(raw.dimensions(), (3, 2));

        let (oriented, format) = decode_supported(&source).unwrap();
        assert_eq!(format, SupportedFormat::Jpeg);
        assert_eq!(oriented.dimensions(), (2, 3));

        let directory = tempfile::tempdir().unwrap();
        let source_path = directory.path().join("phone-photo.jpg");
        fs::write(&source_path, source).unwrap();
        let asset = import(directory.path(), &source_path).unwrap();
        assert_eq!((asset.width, asset.height), (2, 3));

        // resolve_asset_path reopens, decodes, hashes, and compares the managed bytes
        // against the imported metadata, including these oriented dimensions.
        resolve_asset_path(directory.path(), &asset.id).unwrap();
    }

    #[test]
    fn import_is_content_addressed_deduplicated_and_path_private() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("wallpaper actually jpeg.jpg");
        fs::write(&source, test_png()).unwrap();

        let first = import(directory.path(), &source).unwrap();
        let second = import(directory.path(), &source).unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(first.media_type, "image/png");
        assert_eq!((first.width, first.height), (8, 6));
        assert_eq!(list(directory.path()).unwrap().len(), 1);

        let managed = resolve_asset_path(directory.path(), &first.id).unwrap();
        assert!(managed.is_absolute());
        assert_eq!(
            managed.extension().and_then(|value| value.to_str()),
            Some("png")
        );
        let serialized = serde_json::to_string(&first).unwrap();
        assert!(!serialized.contains(directory.path().to_string_lossy().as_ref()));

        let preview = preview(directory.path(), &first.id).unwrap();
        assert!(preview.data_url.starts_with("data:image/png;base64,"));
        assert!(!preview
            .data_url
            .contains(directory.path().to_string_lossy().as_ref()));
    }

    #[test]
    fn import_limits_count_every_managed_artifact_id() {
        let directory = tempfile::tempdir().unwrap();
        let root = initialized_root(directory.path());
        for index in 0..MAX_LIBRARY_ASSETS {
            let id = format!("{index:064x}");
            fs::write(root.join("metadata").join(format!("{id}.json")), b"broken").unwrap();
        }
        let source = directory.path().join("one-too-many.png");
        fs::write(&source, test_png()).unwrap();
        assert_eq!(
            import(directory.path(), &source).unwrap_err().code,
            "background_library_full"
        );
    }

    #[test]
    fn import_counts_managed_asset_bytes_even_when_metadata_is_missing() {
        let directory = tempfile::tempdir().unwrap();
        let root = initialized_root(directory.path());
        let occupied_id = "b".repeat(64);
        let occupied = root.join("assets").join(format!("{occupied_id}.png"));
        File::create(occupied)
            .unwrap()
            .set_len(MAX_LIBRARY_BYTES)
            .unwrap();
        let source = directory.path().join("over-budget.png");
        fs::write(&source, test_png()).unwrap();
        assert_eq!(
            import(directory.path(), &source).unwrap_err().code,
            "background_library_full"
        );
    }

    #[test]
    fn reimport_atomically_repairs_missing_or_corrupt_artifacts() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("repair-me.png");
        fs::write(&source, test_png()).unwrap();
        let first = import(directory.path(), &source).unwrap();
        let root = initialized_root(directory.path());
        let metadata_path = root.join("metadata").join(format!("{}.json", first.id));
        let asset_path = root.join("assets").join(format!("{}.png", first.id));
        let preview_path = root.join("previews").join(format!("{}.png", first.id));

        fs::write(&preview_path, b"broken preview").unwrap();
        assert!(preview(directory.path(), &first.id).is_ok());
        fs::write(&preview_path, b"broken preview again").unwrap();
        let repaired = import(directory.path(), &source).unwrap();
        assert_eq!(repaired.id, first.id);
        assert!(preview(directory.path(), &first.id).is_ok());

        fs::write(&asset_path, b"broken asset").unwrap();
        import(directory.path(), &source).unwrap();
        assert!(resolve_asset_path(directory.path(), &first.id).is_ok());

        fs::write(&metadata_path, b"{not-json").unwrap();
        import(directory.path(), &source).unwrap();
        assert_eq!(list(directory.path()).unwrap().len(), 1);

        fs::remove_file(&asset_path).unwrap();
        import(directory.path(), &source).unwrap();
        assert!(resolve_asset_path(directory.path(), &first.id).is_ok());

        fs::remove_file(&preview_path).unwrap();
        assert!(preview(directory.path(), &first.id).is_ok());

        fs::remove_file(&metadata_path).unwrap();
        import(directory.path(), &source).unwrap();
        assert_eq!(list(directory.path()).unwrap().len(), 1);

        for subdirectory in ["assets", "previews", "metadata"] {
            assert!(fs::read_dir(root.join(subdirectory))
                .unwrap()
                .all(|entry| !entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".tmp")));
        }
    }

    #[test]
    fn remove_is_idempotent_and_removes_only_managed_asset_files() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("remove-me.png");
        fs::write(&source, test_png()).unwrap();
        let asset = import(directory.path(), &source).unwrap();
        let root = initialized_root(directory.path());
        let sentinel = root.join("metadata").join("keep-me.txt");
        fs::write(&sentinel, b"keep").unwrap();

        remove(directory.path(), &asset.id).unwrap();
        assert!(artifact_paths(&root, &asset.id)
            .iter()
            .all(|path| fs::symlink_metadata(path).is_err()));
        assert_eq!(fs::read(&sentinel).unwrap(), b"keep");
        remove(directory.path(), &asset.id).unwrap();

        assert!(remove(directory.path(), "../keep-me").is_err());
        assert_eq!(fs::read(&sentinel).unwrap(), b"keep");
    }

    #[cfg(unix)]
    #[test]
    fn remove_unlinks_a_managed_path_symlink_without_touching_its_target() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("symlink-remove.png");
        fs::write(&source, test_png()).unwrap();
        let asset = import(directory.path(), &source).unwrap();
        let root = initialized_root(directory.path());
        let asset_path = root.join("assets").join(format!("{}.png", asset.id));
        let outside = directory.path().join("outside-sentinel");
        fs::write(&outside, b"keep outside").unwrap();
        fs::remove_file(&asset_path).unwrap();
        symlink(&outside, &asset_path).unwrap();

        remove(directory.path(), &asset.id).unwrap();
        assert_eq!(fs::read(&outside).unwrap(), b"keep outside");
        assert!(fs::symlink_metadata(&asset_path).is_err());
    }

    #[test]
    fn partial_remove_failure_can_be_retried() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("retry-remove.png");
        fs::write(&source, test_png()).unwrap();
        let asset = import(directory.path(), &source).unwrap();
        let root = initialized_root(directory.path());
        let asset_path = root.join("assets").join(format!("{}.png", asset.id));
        let metadata_path = root.join("metadata").join(format!("{}.json", asset.id));
        let preview_path = root.join("previews").join(format!("{}.png", asset.id));

        fs::remove_file(&asset_path).unwrap();
        fs::create_dir(&asset_path).unwrap();
        assert_eq!(
            remove(directory.path(), &asset.id).unwrap_err().code,
            "background_asset_remove_failed"
        );
        assert!(!metadata_path.exists());
        assert!(!preview_path.exists());
        assert!(asset_path.is_dir());

        fs::remove_dir(&asset_path).unwrap();
        remove(directory.path(), &asset.id).unwrap();
        assert!(artifact_paths(&root, &asset.id)
            .iter()
            .all(|path| fs::symlink_metadata(path).is_err()));
    }

    #[test]
    fn managed_state_never_returns_the_real_path() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("safe.png");
        fs::write(&source, test_png()).unwrap();
        let asset = import(directory.path(), &source).unwrap();
        let path = resolve_asset_path(directory.path(), &asset.id).unwrap();

        let state = state_for_value(directory.path(), None, path.to_str());
        assert_eq!(state.kind, "managed");
        assert_eq!(state.asset_id.as_deref(), Some(asset.id.as_str()));
        let serialized = serde_json::to_string(&state).unwrap();
        assert!(!serialized.contains(directory.path().to_string_lossy().as_ref()));

        let external = state_for_value(directory.path(), None, Some("/private/secret/photo.png"));
        assert_eq!(external.kind, "external");
        assert_eq!(external.asset_id, None);
        assert!(!serde_json::to_string(&external).unwrap().contains("secret"));
    }

    #[test]
    fn managed_state_uses_the_same_ghostty_path_identity_as_reference_checks() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("safe.png");
        fs::write(&source, test_png()).unwrap();
        let asset = import(directory.path(), &source).unwrap();
        let managed = resolve_asset_path(directory.path(), &asset.id).unwrap();
        let private_root = initialized_root(directory.path());
        let declaring_config = private_root.join("config");

        let quoted = format!("\"{}\"", managed.display());
        let quoted_state =
            state_for_value(directory.path(), Some(&declaring_config), Some(&quoted));
        assert_eq!(quoted_state.kind, "managed");
        assert_eq!(quoted_state.asset_id.as_deref(), Some(asset.id.as_str()));

        let relative = format!("assets/{}.png", asset.id);
        let relative_state =
            state_for_value(directory.path(), Some(&declaring_config), Some(&relative));
        assert_eq!(relative_state.kind, "managed");
        assert_eq!(relative_state.asset_id.as_deref(), Some(asset.id.as_str()));

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;

            let alias = directory.path().join("managed-alias.png");
            symlink(&managed, &alias).unwrap();
            let alias_state = state_for_value(directory.path(), None, alias.to_str());
            assert_eq!(alias_state.kind, "managed");
            assert_eq!(alias_state.asset_id.as_deref(), Some(asset.id.as_str()));
        }
    }
}
