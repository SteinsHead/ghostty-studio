import { cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "site");
const output = path.join(root, "dist-site");
const assets = path.join(output, "assets");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

await rm(output, { recursive: true, force: true });
await cp(source, output, { recursive: true });
await mkdir(assets, { recursive: true });

const media = [
  ["docs/media/ghostty-studio-demo.mp4", "ghostty-studio-demo.mp4"],
  ["docs/media/ghostty-studio-social-preview.png", "ghostty-studio-social-preview.png"],
  ["docs/media/source/demo-captions.en.vtt", "demo-captions.en.vtt"],
  ["src-tauri/icons/icon.png", "icon.png"],
  ["public/favicon.svg", "favicon.svg"],
];

for (const [from, to] of media) {
  await cp(path.join(root, from), path.join(assets, to));
}

const privatePatterns = [/\/Users\//i, /BEGIN [A-Z ]*PRIVATE KEY/i, /gh[pousr]_[A-Za-z0-9_]{20,}/];
for (const relative of [
  "index.html",
  "app.js",
  "styles.css",
  "manifest.webmanifest",
  "robots.txt",
  "sitemap.xml",
  "assets/demo-captions.en.vtt",
]) {
  const contents = await readFile(path.join(output, relative), "utf8");
  if (privatePatterns.some((pattern) => pattern.test(contents))) {
    throw new Error(`Site privacy check failed for ${relative}`);
  }
}

console.log(`Built Ghostty Studio ${packageJson.version} site in ${path.relative(root, output)}`);
