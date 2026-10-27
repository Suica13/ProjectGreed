/* Shared formation/production catalog order and search semantics. */
const UnitCatalog = (() => {
  function select(query, filters, allows) {
    query = query.trim().toLocaleLowerCase();
    const [kind, value] = (filters.type || "").split(":", 2);
    return Rules.catalog.prefabs
      .filter(
        (p) =>
          !p.formOnly &&
          (!query ||
            [p.id, p.name, p.code, ...Object.values(p.localization || {}).map((l) => l.name)]
              .join(" ")
              .toLocaleLowerCase()
              .includes(query)) &&
          (!filters.faction || p.faction === filters.faction) &&
          (!filters.era || p.tags.includes(filters.era)) &&
          (!filters.type ||
            (kind === "type" && (p.unitTags || []).includes(value)) ||
            (kind === "environment" && (p.stats.adaptability?.[value] ?? 0) >= 90)),
      )
      .sort(
        (a, b) =>
          Number(allows(b)) - Number(allows(a)) ||
          a.faction.localeCompare(b.faction, "en") ||
          a.name.localeCompare(b.name, I18n.language, { numeric: true, sensitivity: "base" }) ||
          a.id.localeCompare(b.id, "en"),
      );
  }
  // Both catalogs prioritize the active faction, then ascending COST.
  function compareFactionCost(faction = PlayerProfile.faction()) {
    const minimumCost = (prefab) =>
      Math.min(...prefab.weaponKits.map((kit) => prefab.stats.cost + kit.cost));
    return (a, b) =>
      Number(b.faction === faction) - Number(a.faction === faction) ||
      a.faction.localeCompare(b.faction, "en") ||
      minimumCost(a) - minimumCost(b) ||
      a.name.localeCompare(b.name, I18n.language, { numeric: true, sensitivity: "base" }) ||
      a.id.localeCompare(b.id, "en");
  }
  return { select, compareFactionCost };
})();
