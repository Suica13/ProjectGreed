/* Standalone preview uses the shared portrait, tags, skill descriptions and weapon cards. */
const Formation = (() => {
  let selectedId = null,
    kitId = null,
    trigger = null;
  function close() {
    byId("formationUnitDetail").hidden = true;
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
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
    byId("formationDetailTitle").textContent = model.name;
    byId("formationDetailTags").replaceChildren(UnitPreview.unitTags(model, {limit: Infinity}));
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
    byId("formationDetailAttributes").replaceChildren(UnitPreview.attributePages(model, "formation"));
    byId("formationDetailSlots").replaceChildren(
      ...model.weapons.map((weapon) => WeaponInfo.card(weapon, null, { encyclopediaLink: true })),
    );
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
