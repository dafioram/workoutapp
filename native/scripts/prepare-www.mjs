// Copies the web app from the repository root into native/www, which Capacitor
// bundles into the APK. The web app itself is not changed.
//
// Keep FILES and DIRS in step with the web app: anything the pages load must be
// listed here, and sw.js is left out because the Android app doesn't use one.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const out = path.resolve(here, "../www");

const FILES = [
  "index.html",
  "timer.html",
  "history.html",
  "analysis.html",
  "exercises.html",
  "warm_up.html",
  "app.js",
  "database.js",
  "manifest.json",
];
const DIRS = ["static"];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const file of FILES) {
  cpSync(path.join(root, file), path.join(out, file));
}
for (const dir of DIRS) {
  cpSync(path.join(root, dir), path.join(out, dir), { recursive: true });
}

console.log(`Copied ${FILES.length} files and ${DIRS.join(", ")} into ${path.relative(process.cwd(), out)}`);
