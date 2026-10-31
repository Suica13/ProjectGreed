/* ACE-exclusive forms are automatic; this panel only explains the pairing. */
const SpecialTransforms = (() => {
  const dialog = element("dialog", "special-transforms-dialog");
  dialog.id = "specialTransformsDialog";
  dialog.setAttribute("aria-label", "特殊变换");
  dialog.addEventListener("keydown", (event) => event.stopPropagation());
  document.body.append(dialog);
  function close() {
    if (dialog.open) dialog.close();
  }
  function open(unitId) {
    const prefab = Rules.catalog.prefabs.find((p) => p.id === unitId);
    dialog.replaceChildren(element("h3", "", "特殊变换"));
    dialog.append(element("p", "muted", "配属对应ACE时自动变换，取消配属后恢复原机体。"));
    const list = element("div", "special-transforms-list");
    for (const form of prefab?.pilotForms || []) {
      const ace = PilotSystem.catalog.aces.find((p) => p.id === form.pilotId);
      const model = UnitModels[Economy.defaultModel(form.unitId)];
      if (!model) continue;
      const row = element("div", "special-transform-row");
      const icon = element("img");
      icon.src = unitIcon(Economy.defaultModel(form.unitId));
      icon.alt = "";
      row.append(
        icon,
        element(
          "span",
          "",
          (ace ? I18n.localized(ace) : form.pilotId) + " → " + model.code + " " + model.name,
        ),
      );
      list.append(row);
    }
    const done = element("button", "", "关闭");
    done.onclick = close;
    dialog.append(list, done);
    if (!dialog.open) dialog.showModal();
  }
  return { open, close };
})();
