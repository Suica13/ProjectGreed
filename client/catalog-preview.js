/* Standalone preview uses the shared portrait, tags, skill descriptions and weapon cards. */
const Formation = (() => {
  let selectedId = null,
    kitId = null,
    trigger = null;
  const metrics = (id, values) => {
    const parent = byId(id);
    parent.replaceChildren();
    for (const [label, value] of values) {
      const cell = element("div", "unit-detail-metric");
      cell.append(element("dt", "", label), element("dd", "", String(value)));
      parent.append(cell);
    }
  };
  function close() {
    byId("formationUnitDetail").hidden = true;
    trigger?.focus();
  }
  function previewUnit(id, focus = null) {
    const prefab = ART.prefabs.find((value) => value.id === id);
    if (!prefab) return false;
    if (selectedId !== id || !prefab.weaponKits.some((kit) => kit.id === kitId))
      kitId = PRODUCTION_CATALOG.defaultKits[id] || prefab.weaponKits[0].id;
    selectedId = id;
    trigger = focus;
    const modelId = id + "__" + kitId,
      model = UnitModels[modelId];
    byId("formationDetailTitle").textContent = model.code + " " + model.name;
    byId("formationDetailTags").replaceChildren(UnitPreview.unitTags(model));
    byId("formationDetailIntro").textContent = model.description || "";
    const kits = byId("formationDetailKit");
    kits.replaceChildren(...prefab.weaponKits.map((kit) => new Option(kit.name, kit.id)));
    kits.value = kitId;
    kits.disabled = false;
    kits.onchange = () => {
      kitId = kits.value;
      previewUnit(id, focus);
    };
    byId("formationDetailCarrierField").hidden = true;
    byId("formationDetailPilot").hidden = true;
    const hangars = byId("formationDetailHangars");
    hangars.replaceChildren();
    for (const hangar of model.hangars || [])
      hangars.append(element("p", "", `${hangar.name || hangar.id} · 容量 ${hangar.capacity}`));
    byId("formationDetailHangarsBlock").hidden = !hangars.childElementCount;
    const forms = byId("formationDetailForms");
    forms.replaceChildren();
    forms.inert = false;
    for (const skill of model.skills || []) {
      const target = skill.formUnitId || skill.spawn?.unitId;
      if (!target || !ART.prefabs.some((item) => item.id === target)) continue;
      const button = element("button", "", skill.name);
      button.type = "button";
      button.onclick = () => previewUnit(target, focus);
      forms.append(button);
    }
    forms.hidden = !forms.childElementCount;
    metrics("formationDetailStats", [
      ["HP", model.hp],
      ["EN", model.en],
      ["COST", model.cost],
      ["视野距离", formatDistance(model.sensors.sight)],
      ["侦察距离", formatDistance(model.sensors.radar)],
      ["机动", model.speed],
      ["反应系数", model.mobility],
      ["命中系数", model.accuracy + "%"],
      ["行动点", model.actionPoints],
      ["零件强度", model.partStructuralStrength],
    ]);
    metrics("formationDetailMovement", [
      ["移动", model.move],
      ["移动方式", model.movementType],
      ...Object.entries(model.adaptability).map(([key, value]) => [
        CatalogEditorSchema.labels[key] || key,
        value + "%",
      ]),
    ]);
    const defense = byId("formationDetailDefense"),
      table = element("table", "unit-defense-table");
    const heading = element("tr");
    for (const text of ["防护", "抗性", "固定减伤"]) heading.append(element("th", "", text));
    table.append(heading);
    for (const [key, value] of Object.entries(model.defenses)) {
      const row = element("tr");
      row.append(
        element("td", "", CatalogEditorSchema.labels[key] || key),
        element("td", "", value.percent + "%"),
        element("td", "", String(value.flat)),
      );
      table.append(row);
    }
    defense.replaceChildren(table);
    metrics("formationDetailShield", [
      ["盾牌HP", model.shield.hp],
      ["格挡率", Math.round(model.shield.blockChance * 100) + "%"],
    ]);
    metrics(
      "formationDetailBonuses",
      Object.entries(model.attackBonuses).map(([key, value]) => [
        CatalogEditorSchema.labels[key] || key,
        value + "%",
      ]),
    );
    byId("formationDetailSlots").replaceChildren(
      ...model.weapons.map((weapon) => WeaponInfo.card(weapon, null, { encyclopediaLink: true })),
    );
    const skills = byId("formationDetailSkills");
    skills.replaceChildren();
    for (const skill of [
      ...SkillControls.commandAbilities(model),
      ...SkillControls.defensiveAbilities(model),
      ...(model.skills || []),
    ]) {
      const card = element("div", "formation-weapon-detail");
      card.append(
        element("strong", "", skill.name),
        element("p", "muted", SkillControls.description(skill)),
      );
      if (WeaponClasses.isWeaponSkill(skill))
        card.append(WeaponInfo.classBadge(skill), WeaponInfo.conversionRules(skill));
      if (skill.sourceWeapon)
        card.append(WeaponInfo.encyclopediaLink(skill), Encyclopedia.usersButton(skill));
      if (skill.sourceWeapon && window.CatalogDeveloper)
        window.CatalogDeveloper.decorateWeapon(card, skill, true);
      skills.append(card);
    }
    byId("formationDetailSkillsBlock").hidden = !skills.childElementCount;
    const mechanics = byId("formationDetailMechanics");
    mechanics.replaceChildren();
    for (const mechanic of model.mechanics || []) mechanics.append(element("p", "", mechanic.name));
    byId("formationDetailMechanicsBlock").hidden = !mechanics.childElementCount;
    byId("formationUnitDetail").hidden = false;
    byId("formationDetailPreview").dataset.previewModel = modelId;
    window.dispatchEvent(new CustomEvent("unit-preview-rendered", { detail: { id } }));
    return true;
  }
  byId("closeFormationDetail").onclick = close;
  byId("formationUnitDetail").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      byId("closeFormationDetail").click();
    }
  });
  return { previewUnit, ...UnitPreview };
})();
