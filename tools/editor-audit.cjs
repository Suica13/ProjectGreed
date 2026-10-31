/* Successful editor changes and the curated exception register share one transaction. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { isDeepStrictEqual: equal } = require("node:util");
const Codec = require("./weapon-store.cjs");
const Adjust = require("../shared/catalog-adjustments.cjs");
const exceptionFile = "MS与舰船例外列表.md";
const start = "<!-- catalog-editor-exceptions:start -->",
  end = "<!-- catalog-editor-exceptions:end -->";
const heading =
  "| 时间（日本时间） | 来源IP | 单位 | 修改对象 | 修改内容 | 详细日志 |\n|---|---|---|---|---|---|";
function differences(before, after, pointer = "") {
  if (equal(before, after)) return [];
  const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (object(before) && object(after))
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .sort()
      .flatMap((key) =>
        differences(
          before[key],
          after[key],
          pointer + "/" + key.replace(/~/g, "~0").replace(/\//g, "~1"),
        ),
      );
  return [
    {
      path: pointer || "/",
      kind: before === undefined ? "added" : after === undefined ? "removed" : "replaced",
      beforeExists: before !== undefined,
      afterExists: after !== undefined,
      before: before ?? null,
      after: after ?? null,
    },
  ];
}
function localTime(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
function planAudit(root, changes, metadata) {
  const text = (file, next) =>
    next && changes.has(file) ? changes.get(file) : fs.readFileSync(path.join(root, file), "utf8");
  const json = (file, next = false) => JSON.parse(text(file, next));
  const beforeLibrary = json("assets/weapons.json").definitions,
    afterLibrary = json("assets/weapons.json", true).definitions;
  const beforeAdjustments = json(Adjust.file),
    afterAdjustments = json(Adjust.file, true);
  const beforeProduction = Adjust.production(
      json("shared/production-catalog.json"),
      beforeAdjustments,
    ),
    afterProduction = Adjust.production(
      json("shared/production-catalog.json", true),
      afterAdjustments,
    );
  const beforeLocalization = json("assets/localization/units.json"),
    afterLocalization = json("assets/localization/units.json", true);
  const units = [];
  const snapshot = (raw, library, production, localization, adjustments) => ({
    ...Adjust.unit(
      require("./weapon-balance.cjs").applyWeaponBalance(Codec.expandPrefab(raw, library)),
      adjustments,
      raw.weapons,
    ),
    deploymentLicense: production.licenseOffers[raw.id] || null,
    displayLocalization: localization[raw.id] || null,
  });
  for (const ref of json("assets/unit-catalog.json").units) {
    const file = "assets/" + ref,
      before = json(file),
      after = json(file, true);
    const fields = differences(
      snapshot(before, beforeLibrary, beforeProduction, beforeLocalization, beforeAdjustments),
      snapshot(after, afterLibrary, afterProduction, afterLocalization, afterAdjustments),
    );
    if (fields.length)
      units.push({
        id: after.id,
        previousId: before.id,
        name: after.name,
        previousName: before.name,
        file,
        changes: fields,
      });
  }
  const date = new Date(),
    id = crypto.randomUUID(),
    displayTime = localTime(date);
  return {
    schemaVersion: 1,
    id,
    timestamp: date.toISOString(),
    localTimestamp: displayTime,
    timeZone: "Asia/Tokyo",
    operation: metadata.operation,
    target: metadata.target,
    source: {
      ip: String(metadata.actor?.ip || "local").replace(/^::ffff:/, ""),
      ...(metadata.actor?.sessionId ? { sessionId: metadata.actor.sessionId } : {}),
    },
    beforeRevision: metadata.revision,
    units,
    files: [...changes].map(([file]) => ({
      file,
      changes: differences(json(file), json(file, true)),
    })),
    logFile:
      "server-data/editor-changes/" +
      displayTime.slice(0, 10) +
      "/" +
      date.toISOString().replace(/[:.]/g, "-") +
      "-" +
      id +
      ".json",
  };
}
const cell = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "&#124;")
    .replace(/`/g, "&#96;")
    .replace(/\[/g, "&#91;")
    .replace(/\]/g, "&#93;")
    .replace(/\r?\n/g, "<br>");
function valueText(value, exists) {
  if (!exists) return "（无）";
  const result = JSON.stringify(value);
  return result.length > 100 ? result.slice(0, 100) + "…" : result;
}
function summary(fields) {
  const visible = fields;
  const result = (visible.length ? visible : fields)
    .slice(0, 8)
    .map(
      (field) =>
        cell(field.path) +
        "：" +
        cell(valueText(field.before, field.beforeExists)) +
        " → " +
        cell(valueText(field.after, field.afterExists)),
    )
    .join("<br>");
  return result + (visible.length > 8 ? "<br>另有" + (visible.length - 8) + "项，见详细日志" : "");
}
function exceptionDocument(existing, record) {
  const a = existing.indexOf(start),
    b = existing.indexOf(end);
  if (
    a < 0 !== b < 0 ||
    (a >= 0 && b < a) ||
    (a >= 0 &&
      (existing.indexOf(start, a + start.length) >= 0 ||
        existing.indexOf(end, b + end.length) >= 0))
  )
    throw Error("例外表格的自动登记标记不完整，请先修复文档。");
  const oldRows =
    a >= 0
      ? existing
          .slice(a + start.length, b)
          .split(/\r?\n/)
          .filter((line) => line.startsWith("| ") && line !== heading.split("\n")[0])
      : [];
  const label = record.operation === "unit" ? "单位特例" : "共用武器 " + record.target.id;
  const entries = record.units.length
    ? record.units
    : [
        {
          id: "（暂无受影响单位）",
          name: record.target.name,
          changes: record.files.flatMap((file) => file.changes),
        },
      ];
  const rows = entries.map(
    (unit) =>
      "| " +
      [
        cell(record.localTimestamp),
        cell(record.source.ip),
        cell(
          unit.name +
            "（" +
            (unit.previousId && unit.previousId !== unit.id ? unit.previousId + " → " : "") +
            unit.id +
            "）",
        ),
        cell(label),
        summary(unit.changes),
        "[JSON](" + record.logFile + ")",
      ].join(" | ") +
      " |",
  );
  const block = start + "\n\n" + heading + "\n" + [...rows, ...oldRows].join("\n") + "\n\n" + end;
  return a >= 0
    ? existing.slice(0, a) + block + existing.slice(b + end.length)
    : existing +
        "\n\n## 开发者编辑例外（自动登记）\n\n成功保存后自动登记，最新修改在前。详细字段前后值保存在服务器日志中；本节不改写上方人工维护的规则。\n\n" +
        block +
        "\n";
}
function auditOutputs(root, record, afterRevision) {
  record.afterRevision = afterRevision;
  const file = path.join(root, exceptionFile),
    existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "# MS、舰船例外列表\n";
  return new Map([
    [record.logFile, JSON.stringify(record, null, 2) + "\n"],
    [exceptionFile, exceptionDocument(existing, record)],
  ]);
}
module.exports = { differences, planAudit, auditOutputs, exceptionDocument, exceptionFile };
