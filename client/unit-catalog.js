/* Shared formation/production catalog order and search semantics. */
const UnitCatalog = (() => {
  function select(query, filters, allows, includeForms = false) {
    query = query.trim().toLocaleLowerCase();
    const [kind, value] = (filters.type || "").split(":", 2);
    return Rules.catalog.prefabs
      .filter(
        (p) =>
          (includeForms || !p.formOnly) &&
          (!query ||
            [p.id, p.name, p.code, ...Object.values(p.localization || {}).map((l) => l.name)]
              .join(" ")
              .toLocaleLowerCase()
              .includes(query)) &&
          (!filters.faction || (p.availableFactions || [p.faction]).includes(filters.faction)) &&
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
  // Formation and encyclopedia share labels, groups, and available type filters.
  function populateTypeFilter(select, value = "") {
    const unitTypes = [
      ...new Set(
        Rules.catalog.prefabs
          .filter((prefab) => !prefab.formOnly)
          .flatMap((prefab) => prefab.unitTags || []),
      ),
    ].sort();
    const types = document.createElement("optgroup");
    types.label = I18n.text("\u5355\u4f4d\u7c7b\u578b");
    for (const tag of unitTypes)
      types.append(new Option(I18n.text(Rules.unitTagName(tag)), "type:" + tag));
    const environments = document.createElement("optgroup");
    environments.label = I18n.text("\u73af\u5883\u7b5b\u9009");
    for (const environment of ["ground", "space"])
      environments.append(
        new Option(
          I18n.text(environment === "ground" ? "\u5730\u9762" : "\u5b87\u5b99"),
          "environment:" + environment,
        ),
      );
    select.replaceChildren(new Option(I18n.text("\u4e0d\u9650"), ""), types, environments);
    if ([...select.options].some((option) => option.value === value)) select.value = value;
  }
  // Developed units first, then ascending minimum kit COST in both catalogs.
  function compareDevelopedCost(
    faction = PlayerProfile.faction(),
    allows = (prefab) => Development.allows(faction, prefab.id),
  ) {
    const minimumCost = (prefab) =>
      Math.min(...prefab.weaponKits.map((kit) => prefab.stats.cost + kit.cost));
    return (a, b) =>
      Number(allows(b)) - Number(allows(a)) ||
      minimumCost(a) - minimumCost(b) ||
      a.name.localeCompare(b.name, I18n.language, { numeric: true, sensitivity: "base" }) ||
      a.id.localeCompare(b.id, "en");
  }
  return { select, compareDevelopedCost, populateTypeFilter };
})();
