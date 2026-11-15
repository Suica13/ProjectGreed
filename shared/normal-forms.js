/* Ordinary form changes only; EXAM/HADES and deployment stances are excluded. */
const NormalForms = (() => {
  function options(catalog, id) {
    const source = catalog.prefabs.find((p) => p.id === id);
    if (!source) return [];
    const result = [];
    for (const skill of source.skills || [])
      if (
        ["transform", "armor_purge"].includes(skill.type) &&
        !skill.deploymentMode &&
        skill.source?.unitId
      )
        result.push({ unitId: skill.source.unitId, skillId: skill.id });
    // Workshop reattachment is allowed between explicitly paired base/BWS forms.
    for (const target of catalog.prefabs)
      if (
        target.id !== id &&
        !target.id.match(/EXAM|HADES|ALICE/) &&
        target.skills?.some(
          (s) =>
            ["transform", "armor_purge"].includes(s.type) &&
            !s.deploymentMode &&
            s.source?.unitId === id,
        )
      )
        result.push({ unitId: target.id, skillId: null });
    return [
      ...new Map(
        result
          .filter((r) => catalog.prefabs.some((p) => p.id === r.unitId))
          .map((r) => [r.unitId, r]),
      ).values(),
    ];
  }
  function family(catalog, id) {
    const found = new Set([id]),
      queue = [id];
    while (queue.length)
      for (const option of options(catalog, queue.shift()))
        if (!found.has(option.unitId)) {
          found.add(option.unitId);
          queue.push(option.unitId);
        }
    return [...found];
  }
  return { options, family };
})();
if (typeof module !== "undefined") module.exports = NormalForms;
