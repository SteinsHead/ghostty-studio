#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
capture_dir="${1:-}"
mp4_output="${2:-$repo_root/docs/media/ghostty-studio-demo.mp4}"
gif_output="${3:-$repo_root/docs/media/ghostty-studio-demo.gif}"

if [[ -z "$capture_dir" || ! -d "$capture_dir" ]]; then
  echo "Usage: scripts/build-demo-media.sh <60fps-frame-directory> [mp4-output] [gif-output]" >&2
  exit 2
fi

capture_dir="$(cd "$capture_dir" && pwd)"
cd "$repo_root"

frame_count="$(find "$capture_dir" -maxdepth 1 -type f -name 'frame-*.png' | wc -l | tr -d ' ')"
if [[ "$frame_count" != "1392" ]]; then
  echo "Expected 1392 frames for the 23.2-second demo; found $frame_count." >&2
  exit 1
fi

ffmpeg -hide_banner -loglevel error -y \
  -framerate 60 -c:v mjpeg -i "$capture_dir/frame-%06d.png" \
  -i "$repo_root/docs/media/source/demo-narration.en.m4a" \
  -filter_complex_script "$repo_root/docs/media/source/demo-edit.ffmpeg" \
  -map '[video]' -map '[audio]' -t 23.2 \
  -c:v libx264 -preset slow -crf 18 \
  -profile:v high -level:v 4.2 -pix_fmt yuv420p \
  -r 60 -fps_mode cfr -g 120 -keyint_min 120 -sc_threshold 0 \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv \
  -c:a aac -b:a 192k -ar 48000 -movflags +faststart \
  "$mp4_output"

ffmpeg -hide_banner -loglevel error -y \
  -i "$mp4_output" \
  -vf "fps=20,scale=720:405:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" \
  -loop 0 "$gif_output"

video_summary="$(ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height,r_frame_rate,avg_frame_rate,nb_frames,duration \
  -of default=noprint_wrappers=1 "$mp4_output")"

for expected in \
  'width=1920' \
  'height=1080' \
  'r_frame_rate=60/1' \
  'avg_frame_rate=60/1' \
  'nb_frames=1392' \
  'duration=23.200000'; do
  if [[ "$video_summary" != *"$expected"* ]]; then
    echo "Demo verification failed: missing $expected" >&2
    exit 1
  fi
done

audio_duration="$(ffprobe -v error -select_streams a:0 \
  -show_entries stream=duration -of default=noprint_wrappers=1:nokey=1 "$mp4_output")"
if [[ "$audio_duration" != "23.200000" ]]; then
  echo "Demo verification failed: audio duration is $audio_duration." >&2
  exit 1
fi

gif_summary="$(ffprobe -v error -select_streams v:0 -count_frames \
  -show_entries stream=width,height,r_frame_rate,avg_frame_rate,nb_read_frames,duration \
  -of default=noprint_wrappers=1 "$gif_output")"
for expected in \
  'width=720' \
  'height=405' \
  'r_frame_rate=20/1' \
  'avg_frame_rate=20/1' \
  'nb_read_frames=464' \
  'duration=23.200000'; do
  if [[ "$gif_summary" != *"$expected"* ]]; then
    echo "GIF verification failed: missing $expected" >&2
    exit 1
  fi
done

ffmpeg -v error -i "$mp4_output" -f null -

echo "Built $mp4_output (60fps) and $gif_output (20fps)."
