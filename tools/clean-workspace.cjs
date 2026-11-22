/* Only disposable browser profiles created by our isolated tests and Python bytecode. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, ".."),
  native = path.join(root, "tmp/verification/native");
function candidates() {
  const result = [path.join(root, "tools/__pycache__")];
  if (fs.existsSync(native))
    for (const entry of fs.readdirSync(native, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (/^native-client-[\w-]+$/.test(entry.name))
        result.push(path.join(native, entry.name, "data/webview"));
      if (/^gecko-[\w-]+$/.test(entry.name)) result.push(path.join(native, entry.name, "profile"));
    }
  return result.filter((target) => fs.existsSync(target));
}
function checked(target) {
  const real = fs.realpathSync(target),
    relative = path.relative(root, real);
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    fs.lstatSync(target).isSymbolicLink()
  )
    throw Error("Unsafe cleanup target: " + target);
  return real;
}
function measure(target) {
  let bytes = 0,
    files = 0;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const child = path.join(target, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      const size = measure(child);
      bytes += size.bytes;
      files += size.files;
    } else {
      bytes += fs.statSync(child).size;
      files++;
    }
  }
  return { bytes, files };
}
function clean(apply = false) {
  const targets = candidates().map((target) => ({
    path: path.relative(root, checked(target)),
    ...measure(target),
  }));
  for (const item of targets)
    if (apply) fs.rmSync(checked(path.join(root, item.path)), { recursive: true, force: true });
  return {
    applied: apply,
    bytes: targets.reduce((n, t) => n + t.bytes, 0),
    files: targets.reduce((n, t) => n + t.files, 0),
    targets,
  };
}
if (require.main === module)
  console.log(JSON.stringify(clean(process.argv.includes("--apply")), null, 2));
module.exports = { clean };
