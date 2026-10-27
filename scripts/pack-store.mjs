import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const outDir = join(root, "dist");
const zipPath = join(outDir, `${pkg.name}-${pkg.version}-chrome-web-store.zip`);
const include = [
  "manifest.json",
  "background.js",
  "content.js",
  "content.css",
  "chat-tools.js",
  "diagnostics.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "assets"
];

mkdirSync(outDir, { recursive: true });
rmSync(zipPath, { force: true });

try {
  execFileSync("zip", ["-r", "-X", zipPath, ...include], { cwd: root, stdio: "inherit" });
} catch (error) {
  if (error?.code === "ENOENT") {
    console.error("The zip command is required. Install it, then run npm run pack again.");
  }
  process.exit(error?.status || 1);
}

console.log(`Wrote ${zipPath}`);
console.log("Excluded tests, docs, previews, markdown, node_modules, and other development files.");
