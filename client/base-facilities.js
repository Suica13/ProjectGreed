/* Facility management shares the eight-card inventory layout. */
window.BaseFacilitiesUI = (() => {
  const screen = element("section", "warehouse-screen base-facilities-screen");
  screen.id = "baseFacilitiesScreen";
  screen.hidden = true;
  screen.innerHTML = `<section class="warehouse-main"><header><h2>设施</h2><span id="facilitySummary"></span></header><div class="warehouse-yard"><div id="facilityCards" class="warehouse-bays"></div></div><footer><span>1 / 1 页</span></footer></section>`;
  const dialog = element("dialog", "facility-dialog");
  dialog.id = "facilityDialog";
  dialog.innerHTML =
    '<header><h2 id="facilityDialogTitle"></h2><button id="closeFacilityDialog">关闭</button></header><div id="facilityDialogBody"></div>';
  dialog.setAttribute("aria-labelledby", "facilityDialogTitle");
  document.body.append(screen, dialog);
  byId("closeFacilityDialog").onclick = () => dialog.close();
  const images = new Map();
  function image(src) {
    if (!images.has(src)) {
      const img = new Image();
      img.onload = render;
      img.src = src;
      images.set(src, img);
    }
    return images.get(src);
  }
  function icon(canvas, id) {
    const layers = BaseFacilities.art[id]?.layers || [],
      ctx = canvas.getContext("2d");
    const ready = layers
      .map((layer) => ({ layer, img: image(layer.src) }))
      .filter(({ img }) => img.naturalWidth);
    if (!ready.length) return;
    const x0 = Math.min(...ready.map(({ layer: l, img }) => l.x - (img.width * l.scale) / 2)),
      x1 = Math.max(...ready.map(({ layer: l, img }) => l.x + (img.width * l.scale) / 2)),
      y0 = Math.min(...ready.map(({ layer: l, img }) => l.y - (img.height * l.scale) / 2)),
      y1 = Math.max(...ready.map(({ layer: l, img }) => l.y + (img.height * l.scale) / 2));
    const scale = Math.min((canvas.width - 48) / (x1 - x0), (canvas.height - 48) / (y1 - y0));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    for (const { layer: l, img } of ready)
      ctx.drawImage(
        img,
        canvas.width / 2 + (l.x - (x0 + x1) / 2) * scale - (img.width * l.scale * scale) / 2,
        canvas.height / 2 + (l.y - (y0 + y1) / 2) * scale - (img.height * l.scale * scale) / 2,
        img.width * l.scale * scale,
        img.height * l.scale * scale,
      );
  }
  function panel(id, upgrade) {
    const state = Economy.snapshot().baseFacilities,
      def = BaseFacilities.definitions[id],
      level = state.levels[id];
    byId("facilityDialogTitle").textContent = I18n.text(def.name) + " · Lv." + level;
    const body = byId("facilityDialogBody");
    body.replaceChildren();
    if (upgrade) {
      const offer = Economy.facilityUpgradeOffer(id),
        cost = element("dl", "facility-cost");
      body.append(element("h3", "", offer.max ? "已达最高等级" : `Lv.${level} → Lv.${offer.next}`));
      for (const [label, text] of [
        ["资金", offer.money === null ? "-" : formatNumber(offer.money)],
        ["物资", offer.supplies === null ? "-" : formatNumber(offer.supplies)],
      ]) {
        const dt = element("dt", "", label);
        if (label === "资金" || label === "物资")
          dt.prepend(ProductionUI.resourceIcon(label === "资金" ? "money" : "supplies"));
        cost.append(dt, element("dd", "", text));
      }
      body.append(cost);
      const requirements = element("section", "facility-upgrade-requirements");
      requirements.setAttribute("aria-label", I18n.text("升级条件"));
      requirements.append(
        element("h3", "", "升级条件"),
        element("p", offer.unlocked ? "is-met" : "", offer.condition),
      );
      if (offer.hqRequired)
        requirements.append(element("p", "helper", `需要HQ达到${offer.next}级。`));
      body.append(requirements);
      const buttons = element("div", "facility-dialog-actions"),
        confirm = element("button", "primary", "确认"),
        cancel = element("button", "", "取消");
      confirm.id = "confirmFacilityUpgrade";
      confirm.disabled = Net.started || !offer.available || !Economy.affordable(offer);
      confirm.onclick = () => {
        try {
          if (!Net.started && Economy.upgradeFacility(id, offer)) {
            dialog.close();
            render();
          }
        } catch (error) {
          note(Economy.errorMessage(error));
        }
      };
      cancel.onclick = () => dialog.close();
      buttons.append(confirm, cancel);
      body.append(buttons);
    } else {
      body.append(element("p", "", def.description));
      for (let n = 1; n <= def.maxLevel; n++) {
        const row = element("div", "facility-unlock" + (n === level ? " is-current" : ""));
        row.append(
          element("span", "facility-level", `Lv.${n}`),
          element("span", "", BaseFacilities.unlock(id, n)),
        );
        body.append(row);
      }
    }
    if (!dialog.open) dialog.showModal();
  }
  function render() {
    if (screen.hidden) return;
    const state = Economy.snapshot().baseFacilities,
      cards = byId("facilityCards"),
      capacity = BaseFacilities.capacity(state);
    byId("facilitySummary").textContent =
      `单位 ${capacity.units} 格 · 舰船 ${capacity.ships} 格 · PMC ${BaseFacilities.pilotLimit(state)} 名`;
    cards.replaceChildren();
    const entries = Object.entries(BaseFacilities.definitions);
    for (let i = 0; i < 8; i++) {
      const card = element("article", "warehouse-bay facility-card");
      if (i >= entries.length) {
        card.classList.add("is-empty");
        card.append(element("span", "", "未开放"));
        cards.append(card);
        continue;
      }
      const [id, def] = entries[i],
        heading = element("div", "warehouse-card-heading"),
        title = element("span", "bay-unit-name", def.name);
      card.dataset.facility = id;
      heading.append(
        element("span", "bay-number", i + 1 + "."),
        title,
        element("span", "facility-level", `Lv.${state.levels[id]}`),
      );
      const frame = element("div", "warehouse-icon-frame"),
        canvas = element("canvas", "warehouse-card-icon");
      canvas.width = 360;
      canvas.height = 320;
      canvas.setAttribute("aria-label", def.name);
      frame.append(canvas);
      icon(canvas, id);
      const footer = element("footer", "facility-card-actions"),
        upgrade = element("button", "", "升级"),
        info = element("button", "", "信息");
      upgrade.dataset.facilityUpgrade = id;
      upgrade.disabled = state.levels[id] >= def.maxLevel;
      upgrade.onclick = () => panel(id, true);
      info.dataset.facilityInfo = id;
      info.onclick = () => panel(id, false);
      footer.append(upgrade, info);
      card.append(heading, frame, footer);
      cards.append(card);
    }
  }
  window.addEventListener("economy-changed", render);
  window.addEventListener("language-change", render);
  window.addEventListener("page-changing", () => dialog.close());
  function open() {
    setPageView("facilities");
    render();
  }
  return { open, render };
})();
