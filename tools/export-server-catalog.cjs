"use strict";
// Validate with the original importer; distribute only the resulting rule metadata.
// IDs, stats, weapon timing and maps stay identical to the normal server.
const catalog = require("./load-catalog.cjs").loadCatalog();
catalog.assets = {};
catalog.sounds = {};
process.stdout.write(
  JSON.stringify(catalog, (_key, value) =>
    typeof value === "string" && value.startsWith("data:") ? undefined : value,
  ),
);
