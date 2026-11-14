/* Personal progress only: never copy connection credentials or an ongoing match. */
const ProfileSave = (() => {
  const factions = ["PMC", "EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON", "EFSF_0093", "NEO_ZEON_0093", "OMNI", "ZAFT"];
  const pilotKey = "projectgreed.custom-pilots.v2.",
    formationKey = "slg-formations-v1.";
  const { packClaims, unpackClaims } = SaveCodec;
  function encodeData(value = exportData()) {
    const clean = validate(value);
    const roster = Object.values(clean.pilots).flatMap((store) => store.pilots);
    const formations = Object.fromEntries(
      Object.entries(clean.formations).map(([faction, formation]) => [
        faction,
        formation
          ? { ...formation, squads: ProfileStorage.compactSquads(formation.squads, roster, true) }
          : null,
      ]),
    );
    return {
      ...clean,
      schemaVersion: 3,
      createdAt: value.createdAt || new Date().toISOString(),
      formations,
      development: packClaims(clean.development),
      economy: packClaims(clean.economy),
    };
  }
  function validate(value) {
    // Detect the file format, independently of the client receiving it.
    if (value?.format === "ProjectGreed-app-store") return fromNativeSnapshot(value);
    if (value?.format !== "ProjectGreed-profile" || ![1, 2, 3].includes(value.schemaVersion))
      throw Error("不支持的个人存档格式");
    if (value.schemaVersion >= 2)
      value = {
        ...value,
        development: unpackClaims(value.development),
        economy: unpackClaims(value.economy),
      };
    if (value.schemaVersion === 3) {
      const roster = Object.values(value.pilots || {}).flatMap((store) => store?.pilots || []);
      const ids = new Set(roster.map((pilot) => pilot?.id));
      for (const formation of Object.values(value.formations || {}))
        for (const squad of formation?.squads || [])
          for (const unit of squad.units || [])
            if (
              unit.customPilot &&
              Object.keys(unit.customPilot).length === 1 &&
              !ids.has(unit.customPilot.id)
            )
              throw Error("编组引用了不存在的驾驶员");
      value = {
        ...value,
        formations: Object.fromEntries(
          Object.entries(value.formations || {}).map(([faction, formation]) => [
            faction,
            formation
              ? { ...formation, squads: ProfileStorage.expandSquads(formation.squads, roster) }
              : null,
          ]),
        ),
      };
    }
    const result = {
      format: value.format,
      schemaVersion: 1,
      identity: value.identity
        ? ProfileIdentity.validate(value.identity)
        : ProfileIdentity.snapshot(),
      pilots: {},
      formations: {},
      development: Development.validateProgress(value.development),
      economy: Economy.validate(ProfileMigrations.economy(value.economy)),
    };
    for (const faction of factions) {
      const addedFaction = ["AEUG", "TITANS", "NEO_ZEON"].includes(faction);
      const store =
        value.pilots?.[faction] ?? (addedFaction ? { pilots: [], awards: [] } : undefined);
      if (
        !Array.isArray(store?.pilots) ||
        !Array.isArray(store.awards) ||
        store.pilots.length > 10000 ||
        store.awards.some((id) => typeof id !== "string" || id.length > 200)
      )
        throw Error("驾驶员存档无效");
      const pilots = store.pilots.map((p) => {
        if (p.faction !== faction) throw Error("驾驶员阵营无效");
        return PilotSystem.custom(p);
      });
      if (new Set(pilots.map((p) => p.id)).size !== pilots.length) throw Error("驾驶员编号重复");
      result.pilots[faction] = { pilots, awards: [...new Set(store.awards)] };
      const formation =
        value.formations?.[faction] ?? (addedFaction ? null : value.formations?.[faction]);
      if (formation === null) {
        result.formations[faction] = null;
        continue;
      }
      if (
        formation?.version !== 3 ||
        !Array.isArray(formation.squads) ||
        !formation.squads.length ||
        formation.squads.length > (faction === "PMC" ? 6000 : 1000) ||
        !Number.isInteger(formation.index) ||
        formation.index < 0 ||
        formation.index >= formation.squads.length
      )
        throw Error("编组存档无效");
      result.formations[faction] = {
        version: 3,
        index: formation.index,
        squads: formation.squads.map((squad) => {
          if (typeof squad.name !== "string" || !squad.name.trim() || squad.name.length > 100)
            throw Error("编组名称无效");
          return {
            name: squad.name,
            units:
              Array.isArray(squad.units) && !squad.units.length
                ? []
                : Rules.validateFleetFormation(squad.units, Infinity, Rules.catalog.formation.maxUnits),
          };
        }),
      };
    }
    return result;
  }
  function exportData() {
    const formations = {};
    const pilots = Formation.exportPilotStores();
    const roster = Object.values(pilots).flatMap((store) => store.pilots);
    for (const faction of factions) {
      const saved = JSON.parse(localStorage.getItem(formationKey + faction) || "null");
      formations[faction] = saved
        ? {
            ...saved,
            squads: ProfileStorage.expandSquads(saved.squads, roster),
            index: Number(localStorage.getItem(formationKey + faction + "-active") || 0),
          }
        : null;
    }
    return {
      ...validate({
        format: "ProjectGreed-profile",
        schemaVersion: 1,
        pilots,
        formations,
        development: Development.exportProgress(),
        economy: Economy.exportProgress(),
      }),
      createdAt: new Date().toISOString(),
    };
  }
  function fromNativeSnapshot(value) {
    if (
      value?.format !== "ProjectGreed-app-store" ||
      value.version !== 1 ||
      !value.values ||
      Object.values(value.values).some((v) => typeof v !== "string")
    )
      throw Error("原生存档格式无效");
    const read = (key, fallback = null) =>
      value.values[key] === undefined ? fallback : SaveCodec.parse(value.values[key]);
    const shared = read("projectgreed.custom-pilots.v3.shared", { pilots: [], awards: [] });
    const old = factions.map((f) => read(pilotKey + f, { pilots: [], awards: [] }));
    const roster = [...shared.pilots, ...old.flatMap((store) => store.pilots)];
    const unique = new Map();
    for (const pilot of roster)
      if (!unique.has(pilot.id) || pilot.level > unique.get(pilot.id).level)
        unique.set(pilot.id, pilot);
    const pilots = {},
      formations = {};
    for (const faction of factions) {
      pilots[faction] = {
        pilots: [...unique.values()].filter((p) => p.faction === faction),
        awards: [...new Set([...shared.awards, ...old.flatMap((store) => store.awards)])],
      };
      const saved = read(formationKey + faction);
      formations[faction] = saved
        ? {
            ...saved,
            index: Number(value.values[formationKey + faction + "-active"] || 0),
            squads: ProfileStorage.expandSquads(saved.squads, [...unique.values()]),
          }
        : null;
    }
    const economy = read(Economy.key);
    if (!economy) throw Error("原生存档中缺少个人进度");
    return validate({
      format: "ProjectGreed-profile",
      schemaVersion: 1,
      pilots,
      formations,
      economy,
      identity: read(ProfileIdentity.key),
      development: read("projectgreed.developmentProgress.v1", Development.exportProgress()),
    });
  }
  function storageEntries(value) {
    const clean = validate(value),
      writes = new Map();
    // Older faction archives can contain copies of the same pilot; retain the
    // most advanced copy, matching the existing shared-roster migration.
    const uniquePilots = new Map();
    for (const pilot of Object.values(clean.pilots).flatMap((store) => store.pilots)) {
      const previous = uniquePilots.get(pilot.id);
      if (
        !previous ||
        pilot.level > previous.level ||
        (pilot.level === previous.level && pilot.experience > previous.experience)
      )
        uniquePilots.set(pilot.id, pilot);
    }
    const roster = [...uniquePilots.values()];
    for (const faction of factions) {
      writes.set(pilotKey + faction, null);
      const save = clean.formations[faction];
      writes.set(
        formationKey + faction,
        save
          ? JSON.stringify({
              version: 3,
              squads: ProfileStorage.compactSquads(save.squads, roster),
            })
          : null,
      );
      writes.set(formationKey + faction + "-active", save ? String(save.index) : null);
    }
    writes.set(
      "projectgreed.custom-pilots.v3.shared",
      JSON.stringify({
        pilots: roster,
        awards: [...new Set(Object.values(clean.pilots).flatMap((store) => store.awards))],
      }),
    );
    writes.set("projectgreed.custom-pilots.v1", null);
    // A replaced personal profile must not retain large recovery copies of its old wallet.
    // These removals participate in the same rollback as the new profile.
    for (const suffix of [".before-counted-stock", ".before-unit-inventory", ".recovery-backup"])
      writes.set(Economy.key + suffix, null);
    writes.set("slg-formations-v1", null);
    writes.set("slg-formations-v1-active", null);
    writes.set("slg-formations-v1.pmc-unified", null);
    writes.set(ProfileIdentity.key, JSON.stringify(clean.identity));
    writes.set(Economy.key, SaveCodec.stringify(clean.economy));
    writes.set(pilotKey + "migrated", "imported");
    writes.set("projectgreed.developmentProgress.v1", SaveCodec.stringify(clean.development));
    return writes;
  }
  function importData(value) {
    ProfileStorage.replace(storageEntries(value));
  }
  return { validate, exportData, encodeData, importData, fromNativeSnapshot, storageEntries };
})();
