/* Numeric editor exceptions are additive and survive source/policy refreshes. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const file = "shared/editor-adjustments.json";
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const escape = (key) => String(key).replace(/~/g, "~0").replace(/\//g, "~1");
function keys(pointer) {
  if (!pointer.startsWith("/")) throw Error("Invalid adjustment path");
  const result = pointer
    .slice(1)
    .split("/")
    .map((key) => key.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (result.some((key) => forbidden.has(key))) throw Error("Invalid adjustment path");
  return result;
}
function read(root = path.resolve(__dirname, "..")) {
  const result = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  if (result.schemaVersion !== 1 || !result.units || !result.weapons || !result.prices)
    throw Error("Invalid editor adjustments");
  return result;
}
function fallback(pointer) {
  return /\/(targetModifiers|antiSize)\//.test(pointer) ||
    /\/(previewScale|partBreakModifier|damageMultiplier|coverage)$/.test(pointer)
    ? 1
    : 0;
}
function apply(value, deltas = {}) {
  for (const [pointer, delta] of Object.entries(deltas)) {
    if (!Number.isFinite(delta)) throw Error("Invalid numeric adjustment: " + pointer);
    const parts = keys(pointer),
      last = parts.pop();
    let parent = value;
    for (const part of parts) {
      if (parent[part] === undefined) parent[part] = {};
      parent = parent[part];
      if (!parent || typeof parent !== "object")
        throw Error("Adjustment target changed: " + pointer);
    }
    const base = parent[last] ?? fallback(pointer);
    if (!Number.isFinite(base)) throw Error("Adjustment target is not numeric: " + pointer);
    parent[last] = Number((base + delta).toPrecision(14));
  }
  return value;
}
function capture(source, current, candidate, existing = {}, skip = () => false) {
  const deltas = structuredClone(existing);
  const visit = (raw, old, next, pointer = "") => {
    if (skip(pointer)) return structuredClone(next);
    if (typeof next === "number") {
      const before = typeof old === "number" ? old : fallback(pointer);
      if (next !== before) {
        const delta = Number(((deltas[pointer] || 0) + next - before).toPrecision(14));
        if (Math.abs(delta) < 1e-10) delete deltas[pointer];
        else deltas[pointer] = delta;
      }
      return raw;
    }
    if (next && typeof next === "object") {
      const result = Array.isArray(next) ? [] : {};
      for (const [key, child] of Object.entries(next)) {
        if (forbidden.has(key)) throw Error("Invalid adjustment field");
        const value = visit(raw?.[key], old?.[key], child, pointer + "/" + escape(key));
        if (value !== undefined) result[key] = value;
      }
      return raw === undefined && Object.keys(result).length === 0 ? undefined : result;
    }
    return next;
  };
  const result = visit(source, current, candidate);
  // A removed shield/mechanism must not be resurrected by its old numeric offsets.
  for (const pointer of Object.keys(deltas)) {
    let value = candidate;
    for (const key of keys(pointer)) value = value?.[key];
    if (value === undefined) delete deltas[pointer];
  }
  return { source: result, deltas };
}
function unit(prefab, registry, refs = {}) {
  for (const [id, weapon] of Object.entries(prefab.weapons || {})) {
    const ref = refs[id]?.ref || (weapon.sourceName || id) + "__lv" + (weapon.level || 1);
    const common = registry.weapons[ref] || {};
    // Native per-unit overrides still mask common fields; editor offsets stack after them.
    const masked = refs[id]?.overrides || {};
    apply(
      weapon,
      Object.fromEntries(
        Object.entries(common).filter(([pointer]) => !Object.hasOwn(masked, keys(pointer)[0])),
      ),
    );
  }
  return apply(prefab, registry.units[prefab.id]);
}
function production(catalog, registry = read()) {
  const result = structuredClone(catalog);
  for (const [id, patch] of Object.entries(registry.prices)) {
    if (!result.licenseOffers[id]) throw Error("Adjustment license missing: " + id);
    apply(result.licenseOffers[id], patch);
    for (const key of ["money", "supplies"])
      if (!Number.isInteger(result.licenseOffers[id][key]) || result.licenseOffers[id][key] < 0)
        throw Error("Invalid adjusted license price: " + id);
  }
  return result;
}
module.exports = { file, read, apply, capture, unit, production };
