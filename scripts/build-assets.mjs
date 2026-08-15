import { copyFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
const assets = [
  "index.html",
  "admin.html",
  "script.js",
  "admin.js",
  "employee.css",
  "employee-workflow.css",
  "employee-security.js",
  "style.css",
  "admin.css",
  "admin-reliability.js",
  "admin-delete.js",
  "admin-insights-bootstrap.js",
  "admin-insights.js",
  "admin-final-features.js",
  "admin-final-features.css",
  "admin-polish.js",
  "logo.png"
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(assets.map(file => copyFile(resolve(root, file), resolve(output, file))));
