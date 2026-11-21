/* Stored units use paginated icon cards; actions open in a modal. */
window.WarehouseUI = (() => {
  const screen = element("section", "warehouse-screen");
  screen.id = "warehouseScreen";
  screen.hidden = true;
  screen.innerHTML = `<section class="warehouse-main"><header><div class="warehouse-tabs">
    <button id="warehouseUnits" aria-pressed="true">单位</button><button id="warehouseShips" aria-pressed="false">舰船</button></div>
    <strong id="warehouseCapacity"></strong><button id="warehouseDeliveries" hidden></button></header>
    <div class="base-page-toolbar" id="warehouseToolbar"><label for="warehouseSearch"><span>搜索单位</span><input id="warehouseSearch" type="search" placeholder="按名称或编号搜索" /></label><label for="warehouseFaction"><span>阵营筛选</span><select id="warehouseFaction" aria-label="阵营筛选"></select></label><div id="warehouseSortControl"></div></div>
    <div class="warehouse-yard" id="warehouseYard"><div id="warehouseBays"></div></div>
    <footer><button id="warehouseRepairAll">一键修复</button><div class="warehouse-pagination"><button id="warehousePrevious">上一页</button><span id="warehousePage"></span><button id="warehouseNext">下一页</button></div></footer></section>`;
  const dialog = element("dialog", "warehouse-dialog");
  dialog.id = "warehouseDialog";
  dialog.setAttribute("aria-labelledby", "warehouseDialogTitle");
  dialog.innerHTML = `<header><div class="warehouse-dialog-heading"><h2 id="warehouseDialogTitle"></h2><div id="warehouseDialogTags" hidden></div></div><button id="warehouseClose" aria-label="关闭">关闭</button></header><div id="warehouseDialogBody"></div>`;
  document.body.append(screen, dialog);
  let kind = "units",
    page = 0, externalReturn = null, attributePage = "warehousePrimaryAttributes";
  const defaultScale = UnitPreview.storageScale;
  const storedItems = () => [...Economy.snapshot().storage.units, ...Economy.snapshot().storage.ships];
  const currentItem = (item) => storedItems().find((record) => record.id === item.id) || item;
  const statusNames = { destroyed: "完全损毁", damaged: "需要修理", healthy: "状态良好" };
  let repairPending = false;
  byId("warehouseRepairAll").onclick = async () => {
    if (Net.started || repairPending) return;
    repairPending = true;render();
    try {
      const scope = await GameDialog.scope("一键修复");
      if (!scope || Net.started) return;
      const ids = scope === "page" ? [...byId("warehouseBays").querySelectorAll("[data-stock-id]")].map(node=>node.dataset.stockId) : null;
      const quote = Economy.repairQuote(ids);
      if (!quote.items.length) return await GameDialog.alert("没有需要修复的单位");
      const confirmed = await GameDialog.confirm(I18n.text("修复机库单位：{count}台，消耗物资 {supplies}。是否继续？")
        .replace("{count}",quote.items.length).replace("{supplies}",formatNumber(quote.supplies)),{title:I18n.text("一键修复")});
      if (confirmed && !Net.started && Economy.repairAllStoredUnits(quote)) note("全部单位已修复");
    } catch (error) { note(error.message); }
    finally { repairPending = false;render(); }
  };
  function populateFactions() {
    const select=byId("warehouseFaction"), selected=select.value || "all";
    select.replaceChildren(new Option(I18n.text("全部阵营"),"all"), ...[...new Set(["PMC",...Rules.factions])]
      .map(faction=>new Option(PlayerProfile.displayFaction(faction),faction)));
    select.value=selected;
  }
  populateFactions();
  window.addEventListener("language-change",populateFactions);
  for(const id of ["warehouseSearch","warehouseFaction"]) byId(id)[id==="warehouseSearch"?"oninput":"onchange"]=()=>{page=0;render();};
  BasePageControls.sortMenu("warehouseSortControl",[["name","名称排序"],["era","年代排序"],["cost","COST排序"]],rule=>{
    const records=Economy.snapshot().storage[kind];
    const model=item=>UnitModels[item.unitId+"__"+item.kitId];
    const era=item=>Math.min(...(model(item).tags || []).filter(tag=>Rules.eras.includes(tag)).map(Rules.technologyWeight),Infinity);
    records.sort((a,b)=>(rule==="cost"?model(a).cost-model(b).cost:rule==="era"?era(a)-era(b):0) ||
      model(a).name.localeCompare(model(b).name,I18n.language) || a.slot-b.slot);
    Economy.reorderStoredUnits(kind,records.map(item=>item.id));page=0;render();
  });
  function finishExternal() { const callback = externalReturn; externalReturn = null; callback?.(); }
  byId("warehouseClose").onclick = () => { dialog.close(); finishExternal(); };
  dialog.addEventListener("cancel", finishExternal);
  function openPanel(title) {
    dialog.classList.remove("is-unit-details");
    byId("warehouseDialogTitle").textContent = title;
    byId("warehouseDialogTags").replaceChildren();
    byId("warehouseDialogTags").hidden = true;
    const body = byId("warehouseDialogBody");
    body.replaceChildren();
    if (!dialog.open) dialog.showModal();
    return body;
  }
  function resourcesPanel(item, model) {
    const resources = element("div", "warehouse-card-resources");
    for (const [key, label] of [["hp", "HP"], ["en", "EN"]]) {
      const bar = element("div", "warehouse-resource " + key), fill = element("span", "warehouse-resource-fill"),
        value = Math.max(0, Math.min(model[key], item[key] ?? model[key]));
      fill.style.width = (value / Math.max(1, model[key])) * 100 + "%";
      bar.setAttribute("role", "meter");
      bar.setAttribute("aria-label", label);
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", String(model[key]));
      bar.setAttribute("aria-valuenow", String(value));
      bar.append(fill, element("span", "warehouse-resource-label", `${label} ${formatNumber(value)} / ${formatNumber(model[key])}`));
      resources.append(bar);
    }
    const state = Warehouse.status(item, model), status = element("span", "warehouse-condition " + state, I18n.text(statusNames[state]));
    status.setAttribute("role","button");status.tabIndex=0;
    status.onclick = event => { event.stopPropagation();showRepair(item); };
    status.onkeydown = event => { if (["Enter"," "].includes(event.key)) {event.preventDefault();event.stopPropagation();showRepair(item);} };
    resources.append(status);
    return resources;
  }
  async function showRepair(item) {
    if (Net.started || repairPending) return;
    const quote=Economy.repairQuote([item.id]);
    const title=I18n.text("单位修复");
    if (!quote.items.length) return GameDialog.alert("状态良好，无需修复",{title});
    repairPending=true;
    try {
      const confirm=await GameDialog.confirm(I18n.text("修复机库单位：{count}台，消耗物资 {supplies}。是否继续？").replace("{count}",1).replace("{supplies}",formatNumber(quote.supplies)),{title,confirmText:"修复"});
      if(confirm && !Net.started && Economy.repairAllStoredUnits(quote)) {
        render();if(dialog.open)showUnit(currentItem(item));note("单位已修复");
      }
    } catch(error){note(error.message);} finally {repairPending=false;render();}
  }
  function assignedPilot(item) {
    if (Object.hasOwn(item, "pilotId")) return Formation.storedPilot(item);
    if (item.destroyed) return null;
    try {
      const bound = Formation.current().find(entry => entry.stockId === item.id);
      if (bound) return (bound.customPilot && !bound.customPilot.hired ? bound.customPilot : null) || Formation.storedPilot(item);
      const siblings = storedItems().filter((record) => !record.destroyed && record.unitId === item.unitId && record.kitId === item.kitId).sort((a, b) => a.slot - b.slot),
        entries = Formation.current().filter((entry) => !entry.stockId && entry.unitId === item.unitId && entry.kitId === item.kitId);
      const assigned = entries[siblings.findIndex((record) => record.id === item.id)]?.customPilot;
      return (assigned && !assigned.hired ? assigned : null) || Formation.storedPilot(item);
    } catch { return Formation.storedPilot(item); }
  }
  function showPilotPicker(item) {
    item = currentItem(item);
    const model = UnitModels[item.unitId + "__" + item.kitId], body = openPanel("配属驾驶员"),
      search = element("input"), list = element("div", "warehouse-pilot-list"), back = element("button", "", "取消");
    search.type = "search";
    search.placeholder = I18n.text("搜索驾驶员");
    search.setAttribute("aria-label", search.placeholder);
    back.onclick = () => showUnit(item);
    body.append(search, list, back);
    function draw() {
      list.replaceChildren();
      const profiles = [PilotSystem.generalPMC("pmc-general-"+item.id,PilotSystem.commandUnit(model)),
        ...Formation.availablePilots().filter(profile=>PilotSystem.canAssign(profile,PlayerProfile.faction()))];
      for (const profile of profiles) {
        const id = profile?.hired ? "crew:" + profile.grade : profile?.id || null,
          name = profile ? I18n.pilotName(profile) : PilotSystem.defaultName(model),
          query = search.value.trim().toLocaleLowerCase();
        if (query && !name.toLocaleLowerCase().includes(query)) continue;
        const card = element("button", "warehouse-pilot-choice"), image = element("img"), text = element("span");
        card.type = "button";
        card.dataset.pilotId = profile?.pmcGeneral ? "general" : id || "general";
        image.src = PilotSystem.portrait(profile || { faction: model.faction });
        image.alt = "";
        text.append(element("strong", "", name + (profile && !profile.hired && !profile.pmcGeneral ? " Lv." + profile.level : "")));
        const stats = profile?.stats;
        if (stats) text.append(element("small", "", Object.entries(PilotSystem.labels).map(([key, label]) => I18n.text(label) + " " + stats[key]).join(" · ")));
        if (profile && !profile.hired) text.append(SkillControls.pilotSummary(profile));
        const occupied = storedItems().filter((record) => !record.destroyed && record.id !== item.id && record.pilotId === id);
        card.disabled = profile?.hired ? occupied.length >= (Economy.snapshot().crewStock[profile.grade] || 0) : !!id && !!occupied.length;
        if (card.disabled) text.append(element("small", "", profile?.hired ? "驾驶员库存不足" : "已配属其他单位"));
        card.onclick = () => {
          try { if (Economy.setStoredPilot(item.id, id)) showUnit(currentItem(item)); }
          catch (error) { note(error.message); }
        };
        card.append(image, text);
        list.append(card);
      }
    }
    search.oninput = draw;
    draw();
  }
  function availableForms(item) {
    if (item.destroyed || (Net.started && Net.snapshot?.phase !== "assembly")) return [];
    const oldKind = Warehouse.category(UnitModels[item.unitId + "__" + item.kitId]);
    return NormalForms.options(ART, item.unitId).filter((form) => {
      const kit = NormalForms.kit(ART, item.unitId, form.unitId, item.kitId, Economy.defaultKit(form.unitId)),
        model = UnitModels[form.unitId + "__" + kit];
      if (!model) return false;
      const needed = { units: 0, ships: 0 };
      needed[oldKind]--;
      needed[Warehouse.category(model)]++;
      return Object.entries(needed).every(([kind, extra]) => {
        const usage = Economy.storageUsage(kind);
        return usage.count + extra <= usage.slots;
      });
    });
  }
  function showTransforms(item, type, title) {
    const body = openPanel(title);
    for (const form of availableForms(item).filter((form) => form.type === type && form.name === title)) {
      const target = ART.prefabs.find((prefab) => prefab.id === form.unitId),
        kitId = NormalForms.kit(ART, item.unitId, form.unitId, item.kitId, Economy.defaultKit(form.unitId)),
        button = element("button", "warehouse-form-choice"), image = element("img");
      image.src = unitIcon(form.unitId + "__" + kitId);
      image.alt = "";
      const targetRow = element("span", "warehouse-form-target");
      targetRow.append(image, element("strong", "", target.name));
      button.append(targetRow);
      button.type = "button";
      button.dataset.formId = form.unitId;
      button.onclick = () => {
        try {
          Economy.transformStock(item.unitId, form.unitId, item.id);
          const updated = currentItem(item);
          kind = Warehouse.category(UnitModels[updated.unitId + "__" + updated.kitId]);
          page = Math.floor(updated.slot / 8);
          render();
          showUnit(updated);
        } catch (error) { note(error.message); }
      };
      body.append(button);
    }
    const back = element("button", "", "取消");
    back.onclick = () => showUnit(item);
    body.append(back);
  }
  function showUnit(item) {
    item = currentItem(item);
    const modelId = item.unitId + "__" + item.kitId,
      model = UnitModels[modelId];
    const body = openPanel(model.name),
      info = element("div", "warehouse-unit-details"),
      preview = element("div", "warehouse-detail-preview"),
      canvas = element("canvas", "warehouse-detail-sprite warehouse-sprite");
    dialog.classList.add("is-unit-details");
    byId("warehouseDialogTitle").append(UnitPreview.roleIcon(model));
    byId("warehouseDialogTags").append(UnitPreview.unitTags(model, { limit: Infinity }));
    byId("warehouseDialogTags").hidden = false;
    canvas.width = 480;
    canvas.height = 400;
    canvas.dataset.cardZoom = String(defaultScale(model));
    canvas.previewParts = item.brokenParts;
    canvas.dataset.previewParked = "true";
    UnitPreview.renderPreview(modelId, canvas, 180, "card");
    preview.dataset.condition = Warehouse.status(item,model);
    preview.append(canvas, element("span", "warehouse-preview-cost unit-summary-tag cost", model.cost + "C"));
    if (item.destroyed || item.hp === 0) preview.append(element("div","warehouse-wreck-warning","机体大破，需要维修（0耐久）"));
    const catalog = element("button", "warehouse-preview-catalog", "图鉴");
    catalog.id = "warehouseOpenCatalog";
    catalog.type = "button";
    catalog.onclick = () => {
      dialog.close();
      if (!Formation.previewUnit(item.unitId, catalog, { kitId: item.kitId, onClose: () => {
        showUnit(currentItem(item));
        byId("warehouseOpenCatalog").focus();
      } })) showUnit(item);
    };
    preview.append(catalog);
    info.append(preview);
    const stats = element("div", "warehouse-detail-status");
    stats.append(resourcesPanel(item, model));
    const parts = element("section", "warehouse-detail-parts" + (Warehouse.category(model) === "ships" ? " is-ship" : "")),
      partList = element("div", "warehouse-parts-grid");
    parts.append(element("h3", "", "部位状态"));
    const definitions = model.modules?.length ? model.modules.map((part) => [part.id, part.name, part.hp]) :
      model.partsBreakable === false ? [] : ["head", "backpack", "leftArm", "rightArm", "leftLeg", "rightLeg"].map((id) => [id, Rules.partNames[id]]);
    for (const [id, name, max] of definitions) {
      const broken = item.destroyed || item.brokenParts?.[id], row = element("div", "warehouse-part " + (broken ? "is-broken" : ""));
      row.dataset.partId = id;
      row.append(element("span", "", name), element("strong", "", broken ? "损毁" : max ? `${formatNumber(item.moduleHp?.[id] ?? max)} / ${formatNumber(max)}` : "完好"));
      partList.append(row);
    }
    if (!definitions.length) partList.append(element("p", "", "无可破坏部位"));
    partList.classList.toggle("is-empty", !definitions.length);
    parts.append(partList);
    stats.append(parts);
    const pilot = assignedPilot(item), pilotRow = element("div", "warehouse-detail-pilot"), portrait = element("img"),
      pilotInfo = element("div", "warehouse-detail-pilot-info"), pilotName = element("div", "warehouse-pilot-name");
    portrait.src = PilotSystem.portrait(pilot || { faction: model.faction });
    portrait.alt = "";
    pilotName.append(element("strong", "", pilot ? I18n.pilotName(pilot) : PilotSystem.defaultName(model)));
    pilotName.title = pilotName.textContent;
    pilotInfo.append(pilotName);
    if (pilot) pilotInfo.append(element("span", "unit-summary-tag cost", "COST " + PilotSystem.cost(pilot)));
    pilotRow.append(portrait, pilotInfo);
    const actions = element("div", "warehouse-detail-actions"), assign = element("button", "", "配属驾驶员"),
      formActions = element("div", "warehouse-form-actions"),
      busy = Net.started && Net.snapshot?.phase !== "assembly";
    assign.type = "button";
    assign.id = "warehouseAssignPilot";
    assign.disabled = busy || !!item.destroyed;
    assign.onclick = () => showPilotPicker(item);
    pilotRow.append(assign);
    const groups = new Set(), ids = { transform: "warehouseTransform", armor_purge: "warehouseArmorPurge", deployment: "warehouseDeployment" };
    for (const form of availableForms(item)) {
      const key = form.type + "/" + form.name;
      if (groups.has(key)) continue;
      groups.add(key);
      const button = element("button", "", form.name);
      button.type = "button";
      button.id = [...formActions.children].some((child) => child.id === ids[form.type]) ? ids[form.type] + "-" + groups.size : ids[form.type];
      button.dataset.formType = form.type;
      button.onclick = () => showTransforms(item, form.type, form.name);
      formActions.append(button);
    }
    if (!formActions.querySelector('[data-form-type="transform"]')) {
      const transform = element("button", "", "变形");
      transform.id = "warehouseTransform";
      transform.type = "button";
      transform.dataset.formType = "transform";
      transform.disabled = true;
      formActions.prepend(transform);
    }
    const sale = Economy.saleOffer(item.unitId), discard = !!item.destroyed || !sale,
      relocate = element("button", "", "调动位置"), sell = element("button", "danger", discard ? "销毁" : "出售");
    relocate.id = "warehouseRelocate";
    relocate.type = "button";
    relocate.onclick = () => showRelocatePicker(item);
    sell.id = "warehouseSellUnit";
    sell.type = "button";
    sell.disabled = Net.started;
    if (discard) sell.title = I18n.text("销毁不返还资金或物资");
    sell.onclick = async () => {
      if (sell.disabled) return;
      sell.disabled = true;
      dialog.close();
      try {
        const confirmed = await GameDialog.confirm(discard
          ? I18n.text("销毁这台库存单位，不返还资金或物资，且无法撤销。是否继续？")
          : I18n.text(`出售1台库存单位，获得资金 ${formatNumber(sale.money)}、物资 ${formatNumber(sale.supplies)}，是否继续？`), { title: I18n.text(discard ? "销毁库存单位" : "出售库存单位") });
        if (!confirmed || Net.started) return showUnit(currentItem(item));
        if (discard ? Economy.discardStoredUnit(item.id) : Economy.sellUnit(item.unitId, item.id)) { render(); finishExternal(); note(discard ? "库存单位已销毁" : "库存单位已出售"); }
        else showUnit(currentItem(item));
      } catch (error) { note(error.message); showUnit(currentItem(item)); }
    };
    actions.append(relocate, sell);
    const label = element("label", "", "武器套件"),
      select = element("select");
    for (const kit of Rules.catalog.prefabs.find((p) => p.id === item.unitId)?.weaponKits || []) {
      const option = element("option", "", kit.name);
      option.value = kit.id;
      select.append(option);
    }
    select.value = item.kitId;
    select.id = "warehouseDetailKit";
    select.disabled = busy || !!item.destroyed;
    select.onchange = () => {
      try {
        if (Economy.changeStoredKit(item.id, select.value)) {
          const updated = storedItems().find((i) => i.id === item.id);
          if (updated) showUnit(updated);
        }
      } catch (error) {
        note(error.message);
      }
    };
    select.setAttribute("aria-label", I18n.text("武器套件"));
    const kitField = element("div", "warehouse-kit-field" + (select.disabled ? " is-disabled" : "")),
      kitName = element("div", "warehouse-kit-name"), loadout = element("div", "warehouse-loadout");
    kitName.append(element("strong", "", select.selectedOptions[0]?.textContent || ""));
    kitName.title = kitName.textContent;
    kitField.append(select, kitName);
    label.append(kitField);
    loadout.append(label, formActions);
    stats.append(loadout, pilotRow, actions);
    info.append(stats);
    const basic = UnitPreview.attributePages(model, "warehouse", pilot ? { model: item.unitId + "__" + item.kitId, pilot } : null, {
      selectedPage: attributePage,
      onPageChange: id => { attributePage = id; },
    });
    const bottom = element("div", "warehouse-detail-bottom"), slots = element("section", "warehouse-part-slots");
    slots.append(element("h3", "", "零件槽位"), element("div", "warehouse-slots-wip", "WIP"));
    bottom.append(basic, slots);
    body.append(info, bottom);
    requestAnimationFrame(refreshPilotName);
  }
  function refreshPilotName() {
    for (const name of dialog.querySelectorAll(".warehouse-pilot-name, .warehouse-kit-name")) {
      const overflow = Math.max(0, name.firstElementChild.scrollWidth - name.clientWidth);
      name.classList.toggle("is-scrolling", overflow > 1);
      name.style.setProperty("--name-overflow", -overflow + "px");
      name.style.setProperty("--name-duration", Math.max(5, overflow / 24 + 3) + "s");
    }
  }
  function showRelocatePicker(item) {
    item = currentItem(item);
    const itemKind = Warehouse.category(UnitModels[item.unitId + "__" + item.kitId]),
      body = openPanel("调动位置"), list = element("div", "warehouse-relocate-grid"), back = element("button", "", "取消"),
      limit = Economy.storageUsage(itemKind).slots, pages = Math.ceil(limit / 8);
    let targetPage = Math.floor(item.slot / 8);
    const footer = element("div", "warehouse-relocate-pages"), previous = element("button", "", "上一页"),
      pageLabel = element("span"), next = element("button", "", "下一页");
    previous.id = "warehouseRelocatePrevious";
    next.id = "warehouseRelocateNext";
    pageLabel.id = "warehouseRelocatePage";
    previous.type = next.type = "button";
    footer.append(previous, pageLabel, next);
    function draw() {
      list.replaceChildren();
      const items = Economy.snapshot().storage[itemKind], start = targetPage * 8;
      previous.disabled = targetPage === 0;
      next.disabled = targetPage === pages - 1;
      pageLabel.textContent = (targetPage + 1) + " / " + pages + " " + I18n.text("页");
      for (let slot = start; slot < Math.min(start + 8, limit); slot++) {
        const target = items.find((entry) => entry.slot === slot), card = element("button", "warehouse-relocate-choice");
        card.type = "button";
        card.dataset.slot = slot;
        card.disabled = target?.id === item.id;
        if (target) {
          const model = UnitModels[target.unitId + "__" + target.kitId], icon = element("img");
          icon.src = unitIcon(target.unitId + "__" + target.kitId);
          icon.alt = "";
          card.append(icon, element("strong", "", (slot + 1) + ". " + model.name), element("small", "", model.kitName));
        } else card.append(element("span", "bay-empty", "+"), element("strong", "", (slot + 1) + ". " + I18n.text("空格纳库")));
        card.onclick = () => {
          try {
            if (Economy.moveStoredUnit(item.id, slot, true)) {
              kind = itemKind;
              page = Math.floor(slot / 8);
              render();
              showUnit(currentItem(item));
            }
          } catch (error) { note(error.message); }
        };
        list.append(card);
      }
    }
    previous.onclick = () => { targetPage--; draw(); };
    next.onclick = () => { targetPage++; draw(); };
    back.onclick = () => showUnit(currentItem(item));
    body.append(list, footer, back);
    draw();
  }
  function showEmptySlot(slot) {
    const body = openPanel("空格纳库"), actions = element("div", "warehouse-empty-actions"),
      move = element("button", "", "移动已有单位到此处"), produce = element("button", "primary", "生产新单位");
    move.id = "warehouseMoveHere";
    produce.id = "warehouseProduceNew";
    move.type = produce.type = "button";
    move.disabled = !Economy.snapshot().storage[kind].length;
    move.onclick = () => showMovePicker(slot);
    produce.onclick = () => {
      dialog.close();
      ProductionUI.openUnit(null, { returnView: "warehouse", storageTarget: { kind, slot }, onReturn: render });
    };
    actions.append(move, produce);
    body.append(actions);
  }
  function showMovePicker(slot) {
    const body = openPanel("移动已有单位到此处"), selector = element("select"), list = element("div", "warehouse-move-list"),
      back = element("button", "", "返回");
    selector.id = "warehouseMovePage";
    selector.setAttribute("aria-label", I18n.text("来源页"));
    for (let i = 0; i < Math.ceil(Economy.storageUsage(kind).slots / 8); i++) {
      const option = element("option", "", (i + 1) + " / " + Math.ceil(Economy.storageUsage(kind).slots / 8) + " " + I18n.text("页"));
      option.value = i;
      selector.append(option);
    }
    selector.value = page;
    function draw() {
      list.replaceChildren();
      for (const item of Economy.snapshot().storage[kind].filter((item) => Math.floor(item.slot / 8) === Number(selector.value)).sort((a, b) => a.slot - b.slot)) {
        const model = UnitModels[item.unitId + "__" + item.kitId], card = element("button", "warehouse-move-choice"), image = element("img"), text = element("span");
        card.type = "button";
        card.dataset.stockId = item.id;
        image.src = unitIcon(item.unitId + "__" + item.kitId);
        image.alt = "";
        text.append(element("strong", "", (item.slot + 1) + ". " + model.name), element("small", "", model.kitName),
          element("small", "", I18n.text(statusNames[Warehouse.status(item,model)])));
        card.append(image, text);
        card.onclick = () => {
          try { if (Economy.moveStoredUnit(item.id, slot)) { dialog.close(); render(); } }
          catch (error) { note(error.message); }
        };
        list.append(card);
      }
      if (!list.children.length) list.append(element("p", "", "本页没有单位"));
    }
    selector.onchange = draw;
    back.onclick = () => showEmptySlot(slot);
    body.append(selector, list, back);
    draw();
  }
  function render() {
    if (pageView !== "warehouse") {
      if (!externalReturn && dialog.open) dialog.close();
      return;
    }
    const storage = Economy.snapshot().storage,
      used = Economy.storageUsage(kind);
    byId("warehouseUnits").setAttribute("aria-pressed", String(kind === "units"));
    byId("warehouseShips").setAttribute("aria-pressed", String(kind === "ships"));
    byId("warehouseRepairAll").disabled = Net.started || repairPending || !Economy.repairQuote().items.length;
    byId("warehouseCapacity").textContent =
      `${I18n.text(kind === "units" ? "单位库存" : "战舰库存")} ${used.count} / ${used.slots}`;
    byId("warehouseDeliveries").hidden = !storage.deliveries.length;
    byId("warehouseDeliveries").textContent =
      `${I18n.text("领取待入库单位")} (${storage.deliveries.length})`;
    const query=byId("warehouseSearch").value.trim().toLocaleLowerCase(), faction=byId("warehouseFaction").value;
    const filtering=!!query || faction!=="all";
    const matching=storage[kind].filter(item=>{
      const model=UnitModels[item.unitId+"__"+item.kitId];
      return (!query || [model.name,model.code,item.unitId,model.kitName].join(" ").toLocaleLowerCase().includes(query)) &&
        (faction==="all" || [model.faction,...(model.availableFactions || []),...(model.tags || [])].includes(faction));
    }).sort((a,b)=>a.slot-b.slot);
    const slots = 8, displayCount=filtering?matching.length:used.slots,
      pageCount = Math.max(1,Math.ceil(displayCount / slots)),
      bays = byId("warehouseBays");
    bays.className = "warehouse-bays";
    page = Math.min(page, pageCount - 1);
    let entries = [];
    try { entries = [...Formation.current()]; } catch {}
    const assigned = new Map();
    for (const stored of [...storage[kind]].sort((a, b) => a.slot - b.slot)) {
      if (stored.destroyed) continue;
      let index = entries.findIndex((entry) => entry.stockId === stored.id);
      if (index < 0) index = entries.findIndex((entry) => !entry.stockId && entry.unitId === stored.unitId && entry.kitId === stored.kitId);
      if (index >= 0) assigned.set(stored.id, entries.splice(index, 1)[0]);
    }
    bays.replaceChildren();
    if(!displayCount)bays.append(element("p","warehouse-empty-results","没有符合条件的单位。"));
    for (let i = 0; i < slots && page * slots + i < displayCount; i++) {
      const item = filtering?matching[page*slots+i]:storage[kind].find(item=>item.slot===page*slots+i),
        slot = filtering?item.slot:page*slots+i,
        button = element("article", "warehouse-bay");
      button.tabIndex = 0;
      button.setAttribute("role", "button");
      button.onkeydown = (event) => {
        if (event.target === button && ["Enter", " "].includes(event.key)) { event.preventDefault(); button.click(); }
      };
      button.dataset.slot = String(slot);
      if(item)button.dataset.stockId=item.id;
      button.dataset.storageKind = kind;
      button.setAttribute(
        "aria-label",
        item ? UnitModels[item.unitId + "__" + item.kitId].name : I18n.text("空格纳库"),
      );
      const heading = element("div", "warehouse-card-heading");
      heading.append(element("span", "bay-number", String(slot + 1) + "."));
      button.append(heading);
      if (item) {
        const modelId = item.unitId + "__" + item.kitId,
          model = UnitModels[modelId],
          image = element("canvas", "warehouse-card-icon warehouse-sprite"),
          imageFrame = element("div", "warehouse-icon-frame"),
          footer = element("div", "warehouse-card-footer"),
          pilot = element("div", "warehouse-card-pilot"),
          profile = !item.destroyed && (Object.hasOwn(item, "pilotId") ? Formation.storedPilot(item) :
            (assigned.get(item.id)?.customPilot?.hired ? null : assigned.get(item.id)?.customPilot) || Formation.storedPilot(item)),
          portrait = element("img"),
          name = element("span", "", profile ? I18n.pilotName(profile) : PilotSystem.defaultName(model));

        image.width = 360;
        image.height = 320;
        image.previewParts = item.brokenParts;
        image.dataset.cardZoom = String(defaultScale(model));
        image.dataset.previewParked = "true";
        UnitPreview.renderPreview(modelId, image, 180, "card");
        image.dataset.cardReady = "true";
        portrait.src = PilotSystem.portrait(profile || { faction: model.faction });
        portrait.alt = "";
        pilot.append(portrait, name);
        pilot.title = name.textContent;
        const resources = resourcesPanel(item, model);
        const title = element("span", "bay-unit-name"), titleText = element("strong", "", model.name);
        title.append(titleText);
        title.title = model.name;
        heading.append(title, UnitPreview.roleIcon(model), element("span", "unit-summary-tag cost", model.cost + "C"));
        imageFrame.append(image, UnitPreview.identityTags(model));
        const environments = element("div", "warehouse-environments");
        for (const [key, label] of [["ground", "地面"], ["space", "宇宙"]]) {
          const tag = element("span", "warehouse-environment", label);
          tag.dataset.environment = key;
          tag.classList.toggle("is-active", (model.adaptability?.[key] ?? 0) > 90);
          environments.append(tag);
        }
        imageFrame.append(environments);
        if (item.destroyed || item.hp === 0) imageFrame.append(element("div","warehouse-wreck-warning","机体大破，需要维修（0耐久）"));
        footer.append(resources, pilot);
        button.append(imageFrame, footer);
        button.dataset.condition = Warehouse.status(item,model);
        requestAnimationFrame(() => {
          if (!title.isConnected) return;
          const overflow = titleText.scrollWidth - title.clientWidth;
          if (overflow > 1) {
            title.classList.add("is-scrolling");
            title.style.setProperty("--name-overflow", -overflow + "px");
            title.style.setProperty("--name-duration", Math.max(5, overflow / 24 + 3) + "s");
          }
        });
        button.onclick = () => showUnit(item);
      } else {
        const frame = element("div", "warehouse-icon-frame warehouse-empty-preview");
        frame.append(element("span", "bay-empty", "+"));
        const footer = element("div", "warehouse-card-footer");
        footer.setAttribute("aria-hidden", "true");
        button.append(frame, footer);
        button.onclick = () => showEmptySlot(slot);
      }
      bays.append(button);
    }
    byId("warehousePage").textContent = `${page + 1} / ${pageCount} ${I18n.text("页")}`;
    byId("warehousePrevious").disabled = page === 0;
    byId("warehouseNext").disabled = page + 1 >= pageCount;
  }
  for (const [id, value] of [
    ["warehouseUnits", "units"],
    ["warehouseShips", "ships"],
  ])
    byId(id).onclick = () => {
      kind = value;
      page = 0;
      render();
    };
  byId("warehousePrevious").onclick = () => {
    page--;
    render();
  };
  byId("warehouseNext").onclick = () => {
    page++;
    render();
  };
  byId("warehouseDeliveries").onclick = () => {
    try {
      Economy.receiveDeliveries();
    } catch (error) {
      note(error.message);
    }
  };
  for (const event of ["economy-changed", "game-assets-ready", "language-change"])
    window.addEventListener(event, render);
  let resizeFrame;
  window.addEventListener("resize", () => {
    if (pageView !== "warehouse" && !externalReturn) return;
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => { render(); refreshPilotName(); });
  });
  return {
    render,
    openItem(id, onClose) {
      const item = storedItems().find((item) => item.id === id);
      if (!item) { note("库存单位不存在"); return false; }
      externalReturn = onClose || null;
      showUnit(item);
      return true;
    },
    open() {
      setPageView("warehouse");
      render();
    },
  };
})();
