"use strict";
const fs = require("node:fs"), path = require("node:path");
const root = path.resolve(__dirname, "..");
const ignored = new Set([".git", "node_modules", "build", "public", "tmp", ".openai", ".codex"]);
function markdownFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (ignored.has(entry.name)) return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(file) : entry.name.endsWith(".md") ? [file] : [];
  });
}
const files = markdownFiles(root), failures = [];
let checked = 0;
for (const file of files) {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  if (!relative.startsWith("docs/") && !["README.md", "AGENTS.md"].includes(relative) &&
      !/^\.agents\/skills\/[^/]+\/SKILL\.md$/.test(relative))
    failures.push(relative + ": Markdown must be stored under docs/");
  const content = fs.readFileSync(file, "utf8").replace(/```[^]*?```/g, "");
  for (const match of content.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    const link = match[1].replace(/^<|>$/g, "").split("#")[0];
    if (!link || /^(?:[a-z]+:|\/)/i.test(link)) continue;
    const target = path.resolve(path.dirname(file), link);
    // Append-only audit ledgers may refer to private logs absent from a checkout.
    if (target.includes(path.sep + "server-data" + path.sep)) continue;
    checked++;
    if (!fs.existsSync(target)) failures.push(relative + ": missing " + link);
  }
}
if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
else console.log(`Documentation: ${files.length} Markdown files, ${checked} local links checked.`);
