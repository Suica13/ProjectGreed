"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const esbuild = require("esbuild"),
  postcss = require("postcss"),
  preset = require("postcss-preset-env");
function transformScript(source) {
  return esbuild.transformSync(source, {
    target: "chrome80",
    charset: "utf8",
    legalComments: "inline",
  }).code;
}
function transformCss(source) {
  // :where has zero specificity, which old Chromium cannot express. Keep this
  // approximation strictly in the legacy sheet; modern engines retain the source CSS.
  const where = {
    postcssPlugin: "projectgreed-legacy-where",
    Rule(rule) {
      if (rule.selector) rule.selector = rule.selector.replace(/:where\(/g, ":is(");
    },
  };
  return postcss([
    where,
    preset({
      browsers: "Chrome 80",
      stage: 2,
      features: { "has-pseudo-class": true, "is-pseudo-class": { preserve: false } },
    }),
  ]).process(source, { from: undefined }).css;
}
function prepareLegacy(html, root, output) {
  const bundle = esbuild.buildSync({
    entryPoints: [path.join(root, "apps/common/legacy-compat.js")],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    target: "chrome80",
    minify: true,
    legalComments: "eof",
  });
  fs.writeFileSync(path.join(output, "legacy-compat.js"), bundle.outputFiles[0].contents);
  const notices = [
    ["core-js", "LICENSE"],
    ["wicg-inert", "LICENSE.md"],
    ["css-has-pseudo", "LICENSE.md"],
    ["esbuild", "LICENSE.md"],
  ].map(
    ([name, license]) =>
      name + "\n" + fs.readFileSync(path.join(root, "node_modules", name, license), "utf8"),
  );
  fs.writeFileSync(
    path.join(output, "THIRD-PARTY-NOTICES.txt"),
    notices.join("\n\n--------------------\n\n"),
  );
  const styles = [];
  let inserted = false;
  html = html.replace(/<style([^>]*)>([\s\S]*?)<\/style>/g, (whole, attrs, css) => {
    if (/\bmedia\s*=/.test(attrs))
      throw Error("Add media handling before packaging a scoped style");
    styles.push(css);
    if (inserted) return "";
    inserted = true;
    return '<script src="app-styles.js"></script>';
  });
  const css = styles.join("\n");
  fs.writeFileSync(path.join(output, "app-modern.css"), css);
  fs.writeFileSync(
    path.join(output, "app-legacy.css"),
    transformCss(
      css + "\n" + fs.readFileSync(path.join(root, "apps/common/legacy-layout.css"), "utf8"),
    ),
  );
  // Parser-inserted stylesheet blocks following game scripts until it is loaded.
  fs.writeFileSync(
    path.join(output, "app-styles.js"),
    `document.write('<link rel="stylesheet" href="'+(window.AppCompat.legacyLayout?'app-legacy.css':'app-modern.css')+'">');`,
  );
  return html;
}
module.exports = { transformScript, transformCss, prepareLegacy };
