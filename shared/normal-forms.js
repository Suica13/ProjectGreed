/* Persistent chassis changes; temporary combat systems such as EXAM stay in battle. */
const NormalForms = (() => {
  function options(catalog, id) {
    const source = catalog.prefabs.find((p) => p.id === id);
    if (!source) return [];
    const result = [];
    for (const skill of source.skills || [])
      if (
        ["transform", "armor_purge"].includes(skill.type) &&
        skill.source?.mode === "transform" &&
        skill.source?.unitId
      )
        result.push({ unitId: skill.source.unitId, skillId: skill.id, type: skill.deploymentMode ? "deployment" : skill.type,
          name: skill.name, source: skill.source });
    // Workshop reattachment is allowed between explicitly paired base/BWS forms.
    for (const target of catalog.prefabs)
      if (
        target.id !== id &&
        !target.id.match(/EXAM|HADES|ALICE/) &&
        target.skills?.some(
          (s) =>
            ["transform", "armor_purge"].includes(s.type) &&
            s.source?.unitId === id,
        )
      )
        {
          const skill = target.skills.find((s) => ["transform", "armor_purge"].includes(s.type) && s.source?.unitId === id);
          result.push({ unitId: target.id, skillId: null, type: skill.deploymentMode ? "deployment" : skill.type,
            name: skill.deploymentMode ? "解除部署" : skill.type === "armor_purge" ? "装回装甲" : "变形", source: skill.source, reverse: true });
        }
    return result.filter((r, index) => catalog.prefabs.some((p) => p.id === r.unitId) &&
      result.findIndex((other) => other.unitId === r.unitId) === index);
  }
  function kit(catalog, from, to, currentKit, fallback) {
    const option = options(catalog, from).find((form) => form.unitId === to),
      kits = catalog.prefabs.find((prefab) => prefab.id === to)?.weaponKits || [];
    if (!option) return fallback;
    const source = option.source, mappings = Object.entries(source.kitMap || {});
    const mapped = option.reverse
      ? mappings.find(([key, value]) => value === currentKit && key === currentKit)?.[0] || mappings.find(([, value]) => value === currentKit)?.[0]
      : source.kitMap?.[currentKit] ?? source.kitId;
    return [mapped, currentKit, fallback, kits[0]?.id].find((id) => kits.some((entry) => entry.id === id));
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
  return { options, family, kit };
})();
if (typeof module !== "undefined") module.exports = NormalForms;
