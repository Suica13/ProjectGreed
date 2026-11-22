/* A one-time progress reset, also applied to pre-reset imported profiles. */
const ProfileReset = (() => {
  const epoch = 2,
    marker = "projectgreed.progress-reset.v1";
  const factions = [
    "PMC",
    "EFSF",
    "ZEON",
    "AEUG",
    "TITANS",
    "NEO_ZEON",
    "EFSF_0093",
    "NEO_ZEON_0093",
    "OMNI",
    "ZAFT",
  ];
  const pilots = () => (typeof PilotSystem !== "undefined" ? PilotSystem : require("./pilots.js"));
  function roster(values) {
    const unique = new Map();
    for (const p of values) {
      if (!p || p.ace || p.aceId || p.hired || p.pmcGeneral || !p.id || !p.name) continue;
      if (unique.has(p.id)) continue;
      const custom = pilots().custom({ ...p, faction: "PMC" });
      unique.set(p.id, custom);
    }
    return [...unique.values()].map((p, i) => {
      const kept = { ...p };
      if (i >= 10) kept.inDormStorage = true;
      else delete kept.inDormStorage;
      return kept;
    });
  }
  function apply(storage, replace) {
    if (storage.getItem(marker) === String(epoch)) return false;
    const read = (key) => {
      const raw = storage.getItem(key);
      if (raw === null) return null;
      return JSON.parse(raw);
    };
    const stores = [
      read("projectgreed.custom-pilots.v3.shared"),
      read("projectgreed.custom-pilots.v1"),
      ...factions.map((f) => read("projectgreed.custom-pilots.v2." + f)),
    ];
    const kept = roster(stores.flatMap((s) => (Array.isArray(s?.pilots) ? s.pilots : [])));
    const writes = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (
        /^(slg-formations-|projectgreed\.(economy\.|development|custom-pilots\.|campaign\.|room-rule-presets))/.test(
          key,
        )
      )
        writes.push([key, null]);
    }
    writes.push(
      ["projectgreed.custom-pilots.v3.shared", JSON.stringify({ pilots: kept, awards: [] })],
      [marker, String(epoch)],
    );
    replace(writes, storage);
    return true;
  }
  const needsReset = (economy) => economy?.progressEpoch !== epoch;
  function portable(value, economy) {
    const kept = roster(Object.values(value.pilots || {}).flatMap((s) => s?.pilots || []));
    return {
      ...value,
      schemaVersion: 1,
      economy,
      development: { points: {}, claimed: {}, researched: {} },
      formations: Object.fromEntries(factions.map((f) => [f, null])),
      pilots: Object.fromEntries(
        factions.map((f) => [f, { pilots: f === "PMC" ? kept : [], awards: [] }]),
      ),
    };
  }
  return { epoch, marker, roster, apply, needsReset, portable };
})();
if (typeof module !== "undefined") module.exports = ProfileReset;
