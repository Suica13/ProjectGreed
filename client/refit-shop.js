/* Refit one owned hull atomically; display source-backed options and prices. */
const RefitShop = (() => {
  const node = (tag, text = "", cls = "") => {
    const el = document.createElement(tag);
    el.textContent = text;
    el.className = cls;
    return el;
  };
  const dialog = node("dialog", "", "refit-dialog"),
    viewer = node("dialog", "", "refit-dialog refit-viewer");
  dialog.id = "unitRefitDialog";
  viewer.id = "unitRefitViewer";
  const title = node("h3", "改装单位"),
    list = node("div", "", "refit-list"),
    price = node("div", "", "resource-balance"),
    status = node("p", "", "refit-status"),
    footer = node("div", "", "refit-footer"),
    cancel = node("button", "取消"),
    confirm = node("button", "改造");
  title.id = "unitRefitTitle";
  dialog.setAttribute("aria-labelledby", title.id);
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "可改装单位");
  status.setAttribute("role", "status");
  footer.append(cancel, confirm);
  dialog.append(title, list, price, status, footer);
  document.body.append(dialog, viewer);
  for (const modal of [dialog, viewer])
    modal.addEventListener("keydown", (event) => event.stopPropagation());
  let context = null,
    selected = null;
  const modelFor = (id) => UnitModels[Economy.baseModel(id)];
  function close() {
    if (viewer.open) viewer.close();
    if (dialog.open) dialog.close();
    context = null;
    selected = null;
  }
  function details(option) {
    const model = modelFor(option.unitId);
    if (!model) return;
    viewer.replaceChildren(node("h3", model.code + " " + model.name));
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 220;
    viewer.append(canvas, node("p", model.description));
    Formation.renderPreview(Economy.baseModel(option.unitId), canvas);
    const stats = node("dl", "", "unit-detail-metrics");
    for (const [label, value] of [
      ["HP", model.hp],
      ["EN", model.en],
      ["COST", model.cost],
      ["移动", model.move],
      ["视野距离", model.sensors.sight],
      ["侦察距离", model.sensors.radar],
      ["机动", model.speed ?? 100],
      ["反应系数", model.mobility],
      ["命中系数", model.accuracy + "%"],
    ])
      stats.append(node("dt", I18n.text(label)), node("dd", String(value)));
    const environmentNames = {
      ground: "地面适应性",
      space: "宇宙适应性",
      water: "水中适应性",
      air: "空中适应性",
      mountain: "山地适应性",
      rubble: "废墟适应性",
    };
    for (const [key, label] of Object.entries(environmentNames))
      if (model.adaptability?.[key] !== undefined)
        stats.append(node("dt", I18n.text(label)), node("dd", model.adaptability[key] + "%"));
    const defenseNames = { beam: "光束防护", shell: "实弹防护", melee: "格斗防护" };
    for (const [key, label] of Object.entries(defenseNames))
      if (model.defenses[key])
        stats.append(
          node("dt", I18n.text(label)),
          node("dd", model.defenses[key].percent + "% / " + model.defenses[key].flat),
        );
    viewer.append(stats);
    for (const skill of model.skills || [])
      viewer.append(node("p", skill.name + " · " + (skill.description || "")));

    for (const weapon of model.weapons)
      viewer.append(WeaponInfo.summary(weapon), WeaponInfo.inspector(weapon));
    for (const mechanic of model.mechanics || []) viewer.append(node("p", mechanic.name));
    const back = node("button", I18n.text("返回"));
    back.onclick = () => viewer.close();
    viewer.append(back);
    viewer.showModal();
  }
  function render() {
    if (!context) return;
    const scroll = list.scrollTop;
    list.replaceChildren();
    for (const option of Economy.refitOptions(context.unitId).filter((r) => !r.pilotId)) {
      const model = modelFor(option.unitId),
        row = node("div", "", "refit-option");
      row.dataset.refitId = option.id;
      row.setAttribute("role", "option");
      row.tabIndex = 0;
      row.setAttribute("aria-selected", String(option.id === selected?.id));
      const choose = () => {
        selected = option;
        render();
      };
      row.onclick = choose;
      row.onkeydown = (e) => {
        if (e.target !== row) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          choose();
        }
      };
      if (model) {
        const image = document.createElement("img");
        image.src = unitIcon(Economy.baseModel(option.unitId));
        image.alt = "";
        row.append(image);
      }
      const info = node("div", "", "refit-option-info");
      info.append(node("strong", model ? model.code + " " + model.name : option.unitId));
      const reason = Economy.refitReason(context.unitId, option.id, context.faction);
      if (reason) info.append(node("small", I18n.text(reason), "weapon-unavailable"));
      const detail = node("button", I18n.text("详细"));
      detail.disabled = !model;
      detail.onclick = (e) => {
        e.stopPropagation();
        details(option);
      };
      row.append(info, detail);
      list.append(row);
    }
    list.scrollTop = scroll;
    price.replaceChildren();
    if (selected) ProductionUI.resources(price, selected);
    const reason = selected
      ? Economy.refitReason(context.unitId, selected.id, context.faction)
      : "请选择改装单位";
    status.textContent = I18n.text(
      reason ||
        (!Economy.affordable(selected) ? "资金或物资不足" : "消耗1台原机体，改装为1台目标素体"),
    );
    confirm.disabled = !!reason || !Economy.affordable(selected);
  }
  cancel.onclick = close;
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  confirm.onclick = () => {
    if (!context || !selected) return;
    const active = context,
      option = selected;
    try {
      if (!Economy.refitUnit(active.unitId, option.id, active.faction)) {
        render();
        return;
      }
      close();
      active.onRefit(option.unitId);
    } catch (error) {
      status.textContent = Economy.errorMessage(error);
    }
  };
  window.addEventListener("page-changing", close);
  window.addEventListener("economy-changed", () => {
    if (dialog.open) render();
  });
  return {
    close,
    open(unitId, faction, onRefit) {
      close();
      context = { unitId, faction, onRefit };
      selected = Economy.refitOptions(unitId).filter((r) => !r.pilotId)[0] || null;
      render();
      dialog.showModal();
    },
  };
})();
