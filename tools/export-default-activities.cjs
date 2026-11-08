"use strict";
const fs = require("node:fs"), path = require("node:path");
// Only reusable activity definitions are distributed, never server identity or player records.
const fields = ["id", "title", "text", "mode", "enabled", "createdAt", "updatedAt",
  "startsAt", "endsAt", "rewards", "multipliers", "targetCost", "loginDays"];
function exportDefaults(source) {
  if (![1, 2].includes(source.schemaVersion) || !Array.isArray(source.activities))
    throw Error("Invalid activity source; packaging aborted");
  const ids = new Set();
  const activities = source.activities.map(activity => {
    if (!activity.id || ids.has(activity.id)) throw Error("Invalid or duplicate activity ID");
    ids.add(activity.id);
    const result = Object.fromEntries(fields.filter(key => Object.hasOwn(activity, key))
      .map(key => [key, structuredClone(activity[key])]));
    if (result.rewards) { const { kits, ...rewards } = result.rewards; result.rewards = rewards; }
    return result;
  });
  return {schemaVersion: 1, activities};
}
if (require.main === module) {
  const source = process.argv[2] || path.join(__dirname, "../server-data/activities.json");
  process.stdout.write(JSON.stringify(exportDefaults(JSON.parse(fs.readFileSync(source, "utf8"))), null, 2) + "\n");
}
module.exports = {exportDefaults};
