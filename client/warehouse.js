/* Physical storage actions open in a modal, leaving the storage scene unobstructed. */
window.WarehouseUI = (() => {
  const screen = element("section", "warehouse-screen");
  screen.id = "warehouseScreen";
  screen.hidden = true;
  screen.innerHTML = `<section class="warehouse-main"><header><div class="warehouse-tabs">
    <button id="warehouseUnits" aria-pressed="true">机库</button><button id="warehouseShips" aria-pressed="false">船坞</button></div>
    <strong id="warehouseCapacity"></strong><button id="warehouseDeliveries" hidden></button></header>
    <div class="warehouse-yard" id="warehouseYard"><div id="warehouseBays"></div></div>
    <footer><button id="warehousePrevious">上一页</button><span id="warehousePage"></span><button id="warehouseNext">下一页</button></footer></section>`;
  const dialog = element("dialog", "warehouse-dialog");
  dialog.id = "warehouseDialog";
  dialog.setAttribute("aria-labelledby", "warehouseDialogTitle");
  dialog.innerHTML = `<header><h2 id="warehouseDialogTitle"></h2><button id="warehouseClose" aria-label="关闭">×</button></header><div id="warehouseDialogBody"></div>`;
  document.body.append(screen, dialog);
  let kind = "units",
    page = 0;
  byId("warehouseClose").onclick = () => dialog.close();
  function openPanel(title) {
    byId("warehouseDialogTitle").textContent = title;
    const body = byId("warehouseDialogBody");
    body.replaceChildren();
    if (!dialog.open) dialog.showModal();
    return body;
  }
  function showUnit(item) {
    const modelId = item.unitId + "__" + item.kitId,
      model = UnitModels[modelId];
    const body = openPanel(model.name),
      info = element("div", "warehouse-unit-details"),
      canvas = element("canvas", "warehouse-detail-sprite");
    canvas.width = 400;
    canvas.height = 320;
    UnitPreview.renderPreview(modelId, canvas, 180);
    info.append(canvas);
    const stats = element("div");
    stats.append(
      element(
        "p",
        "",
        `COST ${model.cost} · HP ${formatNumber(model.hp)} · EN ${formatNumber(model.en)}`,
      ),
    );
    const label = element("label", "", "武器套件"),
      select = element("select");
    for (const kit of Rules.catalog.prefabs.find((p) => p.id === item.unitId)?.weaponKits || []) {
      const option = element("option", "", kit.name);
      option.value = kit.id;
      select.append(option);
    }
    select.value = item.kitId;
    select.onchange = () => {
      try {
        if (Economy.changeStoredKit(item.id, select.value)) {
          const updated = Economy.snapshot().storage[kind].find((i) => i.id === item.id);
          if (updated) showUnit(updated);
        }
      } catch (error) {
        note(error.message);
      }
    };
    label.append(select);
    stats.append(label);
    const detail = element("button", "", "详细参数");
    detail.onclick = () => {
      dialog.close();
      ProductionUI.openUnit(item.unitId, { returnView: "warehouse" });
    };
    stats.append(detail);
    info.append(stats);
    body.append(info);
  }
  function showConstruction(slot) {
    const body = openPanel("生产"),
      balance = element("div", "resource-balance"),
      search = element("input");
    ProductionUI.resources(balance, Economy.snapshot());
    search.type = "search";
    search.placeholder = I18n.text("搜索单位");
    search.setAttribute("aria-label", search.placeholder);
    const list = element("div", "warehouse-production-list");
    list.id = "warehouseProductionList";
    body.append(balance, search, list);
    const prefabs = Rules.catalog.prefabs
      .filter((prefab) => {
        const kit = Economy.defaultKit(prefab.id),
          model = UnitModels[prefab.id + "__" + kit];
        return (
          model &&
          !model.formOnly &&
          !model.wip &&
          !model.facility &&
          Warehouse.category(model) === kind &&
          Economy.productionOffer(prefab.id, kit)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    function drawList() {
      list.replaceChildren();
      const query = search.value.trim().toLocaleLowerCase();
      for (const prefab of prefabs) {
        if (query && !`${prefab.name} ${prefab.id}`.toLocaleLowerCase().includes(query)) continue;
        const row = element("div", "warehouse-production-row"),
          image = element("img"),
          content = element("div");
        row.dataset.unitId = prefab.id;
        image.src = unitIcon(prefab.id + "__" + Economy.defaultKit(prefab.id));
        image.alt = "";
        image.loading = "lazy";
        content.append(element("strong", "", prefab.name));
        const select = element("select");
        select.setAttribute("aria-label", I18n.text("武器套件"));
        for (const kit of prefab.weaponKits) {
          if (!Economy.productionOffer(prefab.id, kit.id)) continue;
          const option = element("option", "", kit.name);
          option.value = kit.id;
          select.append(option);
        }
        select.value = Economy.defaultKit(prefab.id);
        const price = element("div", "resource-balance"),
          status = element("small"),
          action = element("button", "primary", "生产");
        function update() {
          const offer = Economy.productionOffer(prefab.id, select.value);
          ProductionUI.resources(price, offer || {}, { compact: true });
          const busy = Net.started && Net.snapshot?.phase !== "assembly";
          status.textContent = !Economy.available(
            Economy.licenseOffer(prefab.id),
            PlayerProfile.faction(),
          )
            ? I18n.text("未开发")
            : !Economy.hasLicense(prefab.id)
              ? I18n.text("未许可")
              : !Economy.affordable(offer)
                ? I18n.text("资源不足")
                : "";
          action.disabled =
            busy ||
            !Economy.mayProduce(prefab.id, PlayerProfile.faction()) ||
            !offer ||
            !Economy.affordable(offer) ||
            !Economy.canStore(prefab.id, select.value);
        }
        select.onchange = update;
        action.onclick = () => {
          try {
            if (Economy.produce(prefab.id, select.value, PlayerProfile.faction(), slot)) {
              dialog.close();
              render();
            } else note("生产条件不满足");
          } catch (error) {
            note(error.message);
          }
        };
        update();
        content.append(select, price, status);
        row.append(image, content, action);
        list.append(row);
      }
      if (!list.children.length) list.append(element("p", "", "没有符合条件的单位"));
    }
    search.oninput = drawList;
    drawList();
    search.focus();
  }
  function render() {
    if (pageView !== "warehouse") {
      if (dialog.open) dialog.close();
      return;
    }
    const storage = Economy.snapshot().storage,
      used = Economy.storageUsage(kind);
    byId("warehouseUnits").setAttribute("aria-pressed", String(kind === "units"));
    byId("warehouseShips").setAttribute("aria-pressed", String(kind === "ships"));
    byId("warehouseCapacity").textContent =
      `${I18n.text(kind === "units" ? "单位库存" : "战舰库存")} ${used.count} / ${used.slots}`;
    byId("warehouseDeliveries").hidden = !storage.deliveries.length;
    byId("warehouseDeliveries").textContent =
      `${I18n.text("领取待入库单位")} (${storage.deliveries.length})`;
    byId("warehouseYard").classList.toggle("warehouse-port", kind === "ships");
    const slots = kind === "ships" ? 3 : 8,
      bays = byId("warehouseBays");
    bays.className = "warehouse-bays " + (kind === "ships" ? "warehouse-docks" : "");
    bays.replaceChildren();
    for (let i = 0; i < slots; i++) {
      const slot = page * slots + i,
        item = storage[kind].find((item) => item.slot === slot),
        button = element("button", "warehouse-bay");
      button.type = "button";
      button.dataset.slot = String(slot);
      button.setAttribute(
        "aria-label",
        item ? UnitModels[item.unitId + "__" + item.kitId].name : I18n.text("空格纳库"),
      );
      button.innerHTML = `<span class="bay-rack"></span><span class="bay-number">${slot + 1}</span>`;
      if (item) {
        const modelId = item.unitId + "__" + item.kitId,
          canvas = element("canvas", "warehouse-sprite");
        canvas.width = 360;
        canvas.height = 320;
        button.append(canvas, element("span", "bay-unit-name", UnitModels[modelId].name));
        button.onclick = () => showUnit(item);
        UnitPreview.renderPreview(modelId, canvas, 180);
      } else {
        button.append(element("span", "bay-empty", "+"));
        button.onclick = () => showConstruction(slot);
      }
      bays.append(button);
    }
    byId("warehousePage").textContent = `${page + 1} / ${storage.pages[kind]} ${I18n.text("页")}`;
    byId("warehousePrevious").disabled = page === 0;
    byId("warehouseNext").disabled = page + 1 === storage.pages[kind];
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
  return {
    render,
    open() {
      setPageView("warehouse");
      render();
    },
  };
})();
