"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");

// One atomic JSON file per match avoids rewriting an ever-growing history.
function createSettlementLog({ directory, version, now = Date.now }) {
  return (settlement) => {
    if (!directory) return;
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(settlement.matchId || ""))
      throw Error("Invalid settlement match ID");
    fs.mkdirSync(directory, { recursive: true });
    const destination = path.join(directory, settlement.matchId + ".json");
    if (fs.existsSync(destination)) {
      const saved = JSON.parse(fs.readFileSync(destination, "utf8"));
      if (saved.schemaVersion !== 1 || saved.matchId !== settlement.matchId)
        throw Error("Existing settlement log is invalid");
      return;
    }
    const record = { schemaVersion: 1, version, settledAt: new Date(now()).toISOString(), ...settlement };
    const temporary = destination + "." + crypto.randomUUID() + ".tmp";
    try {
      fs.writeFileSync(temporary, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
      fs.renameSync(temporary, destination);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  };
}
module.exports = { createSettlementLog };
