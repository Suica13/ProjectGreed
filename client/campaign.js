/* Strategic view uses room snapshots only. Personal formations, pilots and economy are never read. */
window.CampaignUI = (() => {
  const panel = element("section", "campaign-screen");
  panel.id = "campaignScreen";
  panel.hidden = true;
  document.body.append(panel);
  let selectedRegion = "jaburo",
    tab = "units",
    zoom = 1.25,
    lastRevision = -1;
  let autosaved = "",
    autosaveTimer = null;
  let focusedPreparation = null;
  const selectedUnits = new Set();
  let moveDraft = null,
    forceSide = "friendly",
    forceDetailsRegion = null,
    resumeForceDetails = false;
  const mapScale = 1.25,
    labelScale = 0.75 / mapScale;
  const replies = new Map();
  const storageKey = "projectgreed.campaign.backup.v1";
  const node = (tag, text = "", css = "") => element(tag, css, text);
  function button(text, action, disabled = false, local = false) {
    const result = node("button", text);
    result.type = "button";
    result.disabled = disabled || (!local && !!Net.awaiting);
    if (!local) result.dataset.campaignDisabled = String(disabled);
    result.onclick = () =>
      Promise.resolve()
        .then(action)
        .catch((error) => GameDialog.alert(error.message));
    return result;
  }
  function state() {
    return Net.snapshot?.campaign;
  }
  const headquarters = (region) =>
    CAMPAIGN_WORLD.settings.headquarters?.some((base) => base.region === region.id);
  const regionName = (region) => (headquarters(region) ? "★ " : "") + I18n.text(region.name);
  const campaignPilots = createCampaignPilotUI({ state, command, node, button });
  const campaignConsole = createCampaignConsole({ panel, state, node, button });
  const intelligenceDialog = node(
    "dialog",
    "",
    "campaign-order-dialog campaign-intelligence-dialog",
  );
  intelligenceDialog.id = "campaignIntelligenceDialog";
  const movementDialog = node("dialog", "", "campaign-order-dialog campaign-movement-dialog");
  movementDialog.id = "campaignMovementDialog";
  document.body.append(intelligenceDialog, movementDialog);
  let inspectedMovement = null;
  const regionYield = (s, id) => CampaignRules.regionIncome({ world: CAMPAIGN_WORLD }, s, id);
  const armyModels = new WeakMap();
  const regionIndexes = new WeakMap();
  const worldNodes = new WeakMap();
  function armyModel(unit) {
    const id = unit.unitId + "__" + unit.kitId;
    const factor =
      unit.campaignDurability ??
      unit.state?.campaignDurability ??
      state()?.options?.teams[unit.team]?.durability ??
      1;
    const cached = armyModels.get(unit);
    if (cached?.base === UnitModels[id] && cached.factor === factor) return cached.model;
    const model = Rules.modelOf({ model: id, campaignDurability: factor });
    armyModels.set(unit, { base: UnitModels[id], factor, model });
    return model;
  }
  // Room snapshots are immutable. Index each once instead of rescanning every army for every label.
  function regionIndex(s) {
    const cached = regionIndexes.get(s);
    if (cached?.seat === Net.seat) return cached;
    const index = {
      seat: Net.seat,
      reports: new Map((s.intelRegions || []).map((entry) => [entry.id, entry])),
      owners: new Map(s.regions.map((region) => [region.id, region.owner])),
      armies: new Map(),
      counts: new Map(),
      ownCounts: new Map(),
      regionalUnits: new Map(),
      boarding: new Map(),
    };
    for (const unit of s.units) {
      if (!index.regionalUnits.has(unit.region)) index.regionalUnits.set(unit.region, []);
      index.regionalUnits.get(unit.region).push(unit);
      if (unit.destroyed || unit.pendingTransfer) continue;
      if (!index.armies.has(unit.region)) {
        index.armies.set(unit.region, []);
        index.counts.set(unit.region, [0, 0]);
      }
      index.armies.get(unit.region).push(unit);
      index.counts.get(unit.region)[unit.team]++;
      if (Number.isInteger(Net.seat) && unit.ownerSeat === Net.seat)
        index.ownCounts.set(unit.region, (index.ownCounts.get(unit.region) || 0) + 1);
    }
    regionIndexes.set(s, index);
    return index;
  }
  function boardingOptions(s, unit) {
    const index = regionIndex(s);
    if (!index.boarding.has(unit.id)) {
      // Other regions cannot provide a carrier or occupy a local carrier's unique slots.
      const local = { ...s, units: index.regionalUnits.get(unit.region) || [] };
      index.boarding.set(unit.id, CampaignRules.embarkOptions({ G: Rules }, local, unit));
    }
    return index.boarding.get(unit.id);
  }
  const reportCount = (count, approximate = false) =>
    count === null
      ? I18n.text("未知")
      : (approximate ? I18n.text("约") : "") + formatNumber(count) + I18n.text(" 台");
  function regionCount(s, regionId, team) {
    const index = regionIndex(s);
    return s.intelRegions
      ? (index.reports.get(regionId)?.counts[team] ?? null)
      : index.counts.get(regionId)?.[team] || 0;
  }
  function regionReport(s, regionId) {
    const counts = [0, 1].map((team) => regionCount(s, regionId, team));
    const own = regionIndex(s).ownCounts.get(regionId) || 0;
    const report = counts.some((count) => count === null)
      ? I18n.text("敌军数量未知")
      : reportCount(
          counts[0] + counts[1],
          s.intel?.team !== null && s.intel?.progress < 75 && counts[1 - s.intel.team] > 0,
        );
    return report + (own ? ` (${formatNumber(own)})` : "");
  }
  function regionCostReport(s, regionId) {
    const costs = regionIndex(s).reports.get(regionId)?.costs;
    if (!costs || costs.some((cost) => cost === null)) return I18n.text("未知") + "C";
    const approximate =
      s.intel?.team !== null && s.intel?.progress < 75 && costs[1 - s.intel.team] > 0;
    return (approximate ? I18n.text("约") : "") + formatNumber(costs[0] + costs[1]) + "C";
  }
  function regionStrengthReport(s, regionId) {
    return (
      regionReport(s, regionId)
        .replace(/(\d)\s+(?=台|機)/g, "$1")
        .replace(" (", "(") +
      "/" +
      regionCostReport(s, regionId)
    );
  }
  function openIntelligence() {
    renderIntelligence();
    intelligenceDialog.showModal();
  }
  function renderIntelligence() {
    const s = state();
    if (!s) return;
    const intel = s.intel || { progress: 50, rules: CampaignRules.intelligenceRules };
    const rules = intel.rules;
    const header = node("header", "", "campaign-order-header");
    header.append(
      node("h3", "情报等级"),
      button("关闭", () => intelligenceDialog.close(), false, true),
    );
    const body = node("div", "", "campaign-intelligence-body");
    const meter = node("div", "", "campaign-intelligence-meter");
    meter.setAttribute("role", "progressbar");
    meter.setAttribute("aria-label", "情报进度");
    meter.setAttribute("aria-valuemin", "0");
    meter.setAttribute("aria-valuemax", "100");
    meter.setAttribute("aria-valuenow", intel.progress);
    const fill = node("span");
    fill.style.width = intel.progress + "%";
    meter.append(fill);
    body.append(node("strong", intel.progress + "%", "campaign-intelligence-value"), meter);
    for (const [level, text] of [
      [25, "显示敌军大致数量，误差不超过50%"],
      [50, "显示敌军大致数量，误差不超过25%"],
      [75, "显示准确数量、驻守单位名称与信息；耐久和EN保密"],
      [100, "显示敌军耐久、EN及配属驾驶员"],
    ]) {
      const row = node("p", level + "% · " + I18n.text(text), "campaign-intelligence-tier");
      row.dataset.active = intel.progress >= level;
      body.append(row);
    }
    body.append(
      node(
        "p",
        `每队每回合可投入一次：资金 ${formatNumber(rules.price)}，情报 +${rules.gain}%；战略回合结算后情报 −${rules.decay}%。`,
      ),
    );
    const team = Number.isInteger(Net.seat) ? Rules.seatTeam(Net.seat) : null;
    const funded = intel.fundedTurn === s.turn;
    const invest = button(
      funded ? "本回合已投入" : "投入谍报资金",
      () => command("campaign_intelligence"),
      team === null ||
        s.phase !== "strategy" ||
        s.winner !== null ||
        funded ||
        intel.progress >= 100 ||
        s.teams[team]?.money < rules.price,
    );
    invest.className = "primary";
    intelligenceDialog.replaceChildren(header, body, invest);
  }
  function openMovement(id) {
    inspectedMovement = id;
    renderMovement();
    if (inspectedMovement && !movementDialog.open) movementDialog.showModal();
  }
  function renderMovement() {
    const s = state(),
      move = s?.movements?.find((item) => item.id === inspectedMovement);
    if (!move) {
      inspectedMovement = null;
      if (movementDialog.open) movementDialog.close();
      return;
    }
    const header = node("header", "", "campaign-order-header");
    header.append(
      node("h3", "行进部队"),
      button("关闭", () => movementDialog.close(), false, true),
    );
    const region = (id) =>
      I18n.text(CAMPAIGN_WORLD.regions.find((item) => item.id === id)?.name || id);
    const body = node("div", "", "campaign-movement-body");
    body.append(
      node("p", region(move.from) + " → " + region(move.to)),
      node("strong", reportCount(move.count, move.approximate)),
    );
    const units = move.unitIds.map((id) => s.units.find((unit) => unit.id === id)).filter(Boolean);
    if (!units.length) body.append(node("p", "情报不足，无法查看部队名单"));
    for (const unit of units) {
      const m = armyModel(unit);
      const row = node("article", "", "campaign-movement-unit");
      const image = node("img");
      image.src = unitIcon(unit.unitId + "__" + unit.kitId);
      image.alt = "";
      image.loading = "lazy";
      const copy = node("div");
      copy.append(node("strong", m.name));
      if (!unit.intelRedacted)
        copy.append(
          node(
            "small",
            `HP ${formatNumber(unit.hp ?? m.hp)} · EN ${formatNumber(unit.en ?? m.en)} · ${unit.pilotName}`,
          ),
        );
      row.append(
        image,
        copy,
        button("详情", () => openArmy(unit.id)),
      );
      body.append(row);
    }
    movementDialog.replaceChildren(header, body);
  }
  function command(action, fields = {}) {
    if (Net.awaiting) return;
    Net.request(action, { turn: state()?.turn, ...fields });
  }
  function request(action, fields = {}) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const wait = () => {
        if (Date.now() - started > 120000) return reject(Error("战役请求超时，请重试"));
        if (!Net.active) return reject(Error("战役连接已断开"));
        if (Net.awaiting) return setTimeout(wait, 60);
        Net.request(action, { turn: state()?.turn, ...fields });
        const id = Net.awaiting?.id;
        if (!id) return reject(Error("未能提交战役请求"));
        replies.set(id, { resolve, reject });
        setTimeout(() => {
          if (!replies.has(id)) return;
          replies.delete(id);
          reject(Error("战役传输超时，请重试"));
        }, 120000);
      };
      wait();
    });
  }
  function download(save) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([JSON.stringify(save)], { type: "application/json" }));
    const name = (save.name || CAMPAIGN_WORLD.name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
    link.download = name + "-" + save.turn + ".json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  function reply(message) {
    const pending = replies.get(message.ack);
    replies.delete(message.ack);
    if (message.save) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(message.save));
        localStorage.setItem(storageKey + ".seat", String(Net.seat));
      } catch {
        GameDialog.alert("战役自动备份失败，请导出战役存档后再离开。");
      }
      if (!message.auto && !pending) download(message.save);
    }
    pending?.resolve(message);
  }
  const fittedMapWidth = (scroll) =>
    Math.max(1, Math.min(scroll.clientWidth, (scroll.clientHeight * 1200) / 560));
  function layout() {
    panel.style.top = "0px";
    panel.style.left = "0px";
    const scroll = panel.querySelector(".campaign-map-scroll"),
      svg = scroll?.querySelector("svg");
    if (svg && scroll.clientWidth) {
      const width = fittedMapWidth(scroll) * zoom * mapScale + "px";
      if (svg.style.width !== width) svg.style.width = width;
      highlightEncounter();
      regionEffect(
        svg,
        moveDraft?.destination || null,
        "campaign-move-outline",
        "data-move-region",
      );
    }
  }
  function open(nextTab = tab) {
    if (!state()) return;
    if (state().inLobby) {
      if (Net.memberId === Net.snapshot.hostId) Net.request("campaign_resume");
      else GameDialog.alert("请等待房主继续战役");
      return;
    }
    const workspace = ["production", "research"].includes(nextTab) ? nextTab : null;
    tab = workspace ? "units" : nextTab;
    setPageView("campaign");
    panel.hidden = false;
    layout();
    render();
    if (workspace) CampaignWorkspace.open(workspace, selectedRegion);
  }
  function receive(snapshot) {
    refreshBattleControls(snapshot);
    if (!snapshot.campaign) return;
    if (!snapshot.started) {
      if (snapshot.campaign.inLobby) {
        if (pageView !== "room") setPageView("room");
        panel.hidden = true;
        RoomPanel.render(snapshot);
        return;
      }
      if (pageView !== "campaign") open();
      else if (lastRevision !== snapshot.revision) render();
      if (Net.memberId === snapshot.hostId && !Net.awaiting) {
        const key = snapshot.room + ":" + snapshot.revision;
        if (autosaved !== key) {
          clearTimeout(autosaveTimer);
          autosaveTimer = setTimeout(() => {
            if (!Net.active || !state() || Net.started || Net.awaiting) return;
            autosaved = key;
            command("campaign_export", { auto: true });
          }, 350);
        }
      }
    }
  }
  function preview(canvas, campaign) {
    const ctx = canvas.getContext("2d");
    canvas.width = CAMPAIGN_WORLD.width;
    canvas.height = CAMPAIGN_WORLD.height;
    ctx.fillStyle = "#0e1b2b";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (CAMPAIGN_WORLD.landPath) {
      ctx.fillStyle = "#344552";
      ctx.fill(new Path2D(CAMPAIGN_WORLD.landPath));
    }
    const regions = [...CAMPAIGN_WORLD.regions].sort(
      (a, b) => Number(b.kind === "sea") - Number(a.kind === "sea"),
    );
    for (const region of regions) {
      const owner = campaign?.regions.find((item) => item.id === region.id)?.owner ?? region.owner;
      const outline = new Path2D(
        region.path || "M" + region.polygon.map((point) => point.join(",")).join("L") + "Z",
      );
      ctx.fillStyle =
        owner === 0
          ? region.kind === "sea"
            ? "#193b53"
            : "#346688"
          : region.kind === "sea"
            ? "#362735"
            : "#8b4d57";
      ctx.fill(outline, "evenodd");
      ctx.strokeStyle = region.kind === "sea" ? "#668397" : "#b0c0cc";
      ctx.lineWidth = 0.9;
      ctx.setLineDash(region.kind === "sea" ? [4, 4] : []);
      ctx.stroke(outline);
      if (!region.factory) continue;
      const [x, y] = region.center;
      ctx.fillStyle = "#fff4bf";
      ctx.fillRect(x - 3, y - 3, 6, 6);
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#102030";
      ctx.setLineDash([]);
      ctx.strokeText(regionName(region), x, y + 17);
      ctx.fillStyle = "#fff";
      ctx.fillText(regionName(region), x, y + 17);
    }
    canvas.setAttribute("aria-label", CAMPAIGN_WORLD.name);
  }
  function mapTitle(s) {
    const side = Number.isInteger(Net.seat) ? Rules.seatTeam(Net.seat) : Net.snapshot?.viewTeam;
    const faction = s.teams[side]?.faction;
    const names = { EFSF: "地球联邦军", ZEON: "吉翁公国军" };
    return (
      I18n.text(names[faction] || "观战") + " - " + I18n.text(CAMPAIGN_WORLD.areaName || "地球")
    );
  }
  function world(state) {
    const wrap = node("div", "", "campaign-world");
    wrap.dataset.language = I18n.language;
    const tools = node("div", "", "campaign-map-tools");
    tools.append(
      node("span", mapTitle(state), "campaign-map-title"),
      button("−", () => {
        zoomWorld(zoom - 0.25);
      }),
      button("＋", () => {
        zoomWorld(zoom + 0.25);
      }),
    );
    const scroll = node("div", "", "campaign-map-scroll");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 1200 560");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "地球战略区域地图");
    svg.style.width = zoom * mapScale * 100 + "%";
    const shape = (name, attributes, text = "") => {
      const result = document.createElementNS(svg.namespaceURI, name);
      for (const [key, value] of Object.entries(attributes)) result.setAttribute(key, value);
      result.textContent = text;
      return result;
    };
    svg.append(shape("rect", { x: 0, y: 0, width: 1200, height: 560, fill: "#0e1b2b" }));
    for (let x = 0; x <= 1200; x += 100)
      svg.append(
        shape("path", {
          d: `M${x} 0V560`,
          stroke: "#203349",
          "stroke-width": 0.6,
          "pointer-events": "none",
        }),
      );
    for (let y = 0; y <= 560; y += 80)
      svg.append(
        shape("path", {
          d: `M0 ${y}H1200`,
          stroke: "#203349",
          "stroke-width": 0.6,
          "pointer-events": "none",
        }),
      );
    svg.append(
      shape("path", {
        d: CAMPAIGN_WORLD.landPath || "",
        fill: "#344552",
        stroke: "#95a7b3",
        "stroke-width": 1,
        "pointer-events": "none",
        class: "campaign-coastline",
      }),
    );
    const routes = shape("g", { class: "campaign-world-routes", "pointer-events": "none" });
    for (const region of CAMPAIGN_WORLD.regions)
      for (const id of region.links.filter((id) => id > region.id)) {
        const other = CAMPAIGN_WORLD.regions.find((item) => item.id === id);
        const [x1, y1] = region.center,
          [x2, y2] = other.center;
        let d = `M${x1},${y1}L${x2},${y2}`;
        if (Math.abs(x1 - x2) > 600) {
          const left = x1 < x2 ? region : other,
            right = x1 < x2 ? other : region;
          const [lx, ly] = left.center,
            [rx, ry] = right.center;
          const crossing = ly + ((ry - ly) * -lx) / (rx - 1200 - lx);
          d = `M${lx},${ly}L0,${crossing}M1200,${crossing}L${rx},${ry}`;
        }
        routes.append(
          shape("path", {
            d,
            fill: "none",
            stroke: "#b4d6eb",
            "stroke-width": 1.4,
            "stroke-dasharray": "4 5",
            opacity: 0.13,
            "data-route-from": region.id,
            "data-route-to": other.id,
          }),
        );
      }
    const surfaces = shape("g", { class: "campaign-world-territories" });
    const labels = shape("g", { class: "campaign-world-labels" });
    const occupied = [];
    const measure = document.createElement("canvas").getContext("2d");
    measure.font = "12px sans-serif";
    const labelPositions = new Map();
    for (const region of [...CAMPAIGN_WORLD.regions].sort(
      (a, b) => Number(b.factory) - Number(a.factory),
    )) {
      const width =
          Math.min(190, Math.max(116, measure.measureText(regionName(region)).width + 18)) *
          labelScale,
        height = 32 * labelScale;
      const [x, y] = region.center,
        [dx, dy] = region.labelOffset || [0, 0];
      let best = { x: x + dx, y: y + dy, score: Infinity };
      for (const radius of [0, 24, 44, 64, 88]) {
        for (const [mx, my] of radius
          ? [
              [0, -radius],
              [0, radius],
              [-radius, 0],
              [radius, 0],
              [-radius, -radius],
              [radius, radius],
              [-radius, radius],
              [radius, -radius],
            ]
          : [[0, 0]]) {
          const cx = Math.max(width / 2 + 5, Math.min(1195 - width / 2, x + dx + mx)),
            cy = Math.max(21, Math.min(555 - (height - 14), y + dy + my));
          const rect = {
            left: cx - width / 2,
            right: cx + width / 2,
            top: cy - 14,
            bottom: cy + height - 14,
          };
          const overlap = occupied.reduce(
            (sum, item) =>
              sum +
              Math.max(0, Math.min(item.right, rect.right) - Math.max(item.left, rect.left)) *
                Math.max(0, Math.min(item.bottom, rect.bottom) - Math.max(item.top, rect.top)),
            0,
          );
          const score = overlap * 100 + Math.hypot(cx - x - dx, cy - y - dy);
          if (score < best.score) best = { x: cx, y: cy, score, rect };
        }
        if (best.score < 100) break;
      }
      occupied.push(best.rect);
      labelPositions.set(region.id, { ...best, width, height });
    }
    for (const region of [...CAMPAIGN_WORLD.regions].sort(
      (a, b) => Number(b.kind === "sea") - Number(a.kind === "sea"),
    )) {
      const holder = state.regions.find((item) => item.id === region.id);
      const group = shape("g", {
        tabindex: 0,
        role: "button",
        "data-region": region.id,
        "aria-label": region.name,
      });
      group.append(
        shape("path", {
          d: region.path || "M" + region.polygon.map((point) => point.join(",")).join("L") + "Z",
          class: "campaign-region-surface",
          "fill-rule": "evenodd",
          fill: (holder?.owner ?? region.owner) === 0 ? "#346688" : "#8b4d57",
          stroke: "#9db2c3",
          "stroke-width": 0.8,
          "stroke-linejoin": "round",
          "data-kind": region.kind || "land",
        }),
      );
      const { x, y, width, height } = labelPositions.get(region.id);
      const [cx, cy] = region.center;
      const label = shape("g", { "data-region-label": region.id, class: "campaign-region-label" });
      label.append(
        shape("path", {
          d: `M${cx},${cy}L${x},${y}`,
          stroke: "#b1c3cf",
          "stroke-width": 0.8,
          "pointer-events": "none",
        }),
      );
      label.append(
        shape(
          region.factory ? "rect" : "circle",
          region.factory
            ? { x: cx - 2.5, y: cy - 2.5, width: 5, height: 5, fill: "#ffe0a1" }
            : { cx, cy, r: 2, fill: "#d5e7ef" },
        ),
      );
      const info = shape("g", {
        class: "campaign-region-info",
        transform: `translate(${x},${y}) scale(${labelScale}) translate(${-x},${-y})`,
      });
      info.append(
        shape("rect", {
          x: x - width / labelScale / 2,
          y: y - 14,
          width: width / labelScale,
          height: height / labelScale,
          rx: 3,
          fill: "#111e2c",
          stroke: "#5c7487",
          "stroke-width": 0.7,
          opacity: 0.94,
          class: "campaign-region-label-box",
        }),
      );
      info.append(
        shape(
          "text",
          {
            x,
            y: y - 2,
            class: "campaign-region-name",
            "text-anchor": "middle",
            fill: region.factory ? "#ffdf9e" : "#edf5fc",
            "font-size": 12,
            "font-weight": region.factory ? 700 : 500,
          },
          regionName(region),
        ),
      );

      info.append(
        shape("text", {
          x,
          y: y + 10,
          "text-anchor": "middle",
          fill: "#bdd2e3",
          "font-size": 9,
          class: "campaign-region-count",
        }),
      );

      label.append(info);
      const select = () => {
        const current = Net.snapshot.campaign;
        if (
          moveDraft &&
          CAMPAIGN_WORLD.regions.find((r) => r.id === moveDraft.from)?.links.includes(region.id)
        ) {
          moveDraft.destination = region.id;
          renderMoveDraft();
          return;
        }
        moveDraft = null;
        const previous = selectedRegion;
        selectedRegion = region.id;
        selectedUnits.clear();
        const old = panel.querySelector(".campaign-detail"),
          scrollTop = previous === region.id ? old?.scrollTop || 0 : 0;
        const replacement = details(current);
        old.replaceWith(replacement);
        replacement.scrollTop = scrollTop;
        refreshWorld(current);
        if (current.phase === "encounters" && CampaignRules.disputed(current, region.id))
          openEncounter(region.id);
      };
      group.onclick = select;
      group.onmousedown = (event) => {
        if (event.button === 0) event.preventDefault();
      };
      group.onkeydown = (event) => {
        if (["Enter", " "].includes(event.key)) {
          event.preventDefault();
          select();
        }
      };
      label.onclick = select;
      label.onmousedown = group.onmousedown;
      surfaces.append(group);
      labels.append(label);
    }
    svg.append(surfaces, routes, labels);
    scroll.append(svg);
    enableMapGestures(scroll);
    wrap.append(tools, scroll);
    return wrap;
  }
  function zoomWorld(nextZoom, clientX, clientY) {
    const scroll = panel.querySelector(".campaign-map-scroll"),
      svg = scroll?.querySelector("svg");
    if (!svg) return;
    const viewport = scroll.getBoundingClientRect(),
      before = svg.getBoundingClientRect();
    const x = clientX ?? viewport.left + viewport.width / 2;
    const y = clientY ?? viewport.top + viewport.height / 2;
    const point = { x: (x - before.left) / before.width, y: (y - before.top) / before.height };
    zoom = Math.max(0.85 / mapScale, Math.min(2.5, nextZoom));
    svg.style.width = fittedMapWidth(scroll) * zoom * mapScale + "px";
    const after = svg.getBoundingClientRect();
    scroll.scrollLeft += after.left + point.x * after.width - x;
    scroll.scrollTop += after.top + point.y * after.height - y;
  }
  function enableMapGestures(scroll) {
    let drag = null,
      suppressClick = false,
      gestureFrame = null,
      pendingZoom = null,
      pendingPan = null;
    const flushGesture = () => {
      if (gestureFrame !== null) cancelAnimationFrame(gestureFrame);
      gestureFrame = null;
      const nextZoom = pendingZoom,
        nextPan = pendingPan;
      pendingZoom = pendingPan = null;
      if (!scroll.isConnected) return;
      if (nextZoom) zoomWorld(nextZoom.zoom, nextZoom.x, nextZoom.y);
      if (nextPan) {
        scroll.scrollLeft = nextPan.left;
        scroll.scrollTop = nextPan.top;
      }
    };
    const scheduleGesture = () => {
      if (gestureFrame === null) gestureFrame = requestAnimationFrame(flushGesture);
    };
    scroll.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const delta =
          event.deltaY *
          (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroll.clientHeight : 1);
        pendingZoom = {
          zoom: (pendingZoom?.zoom ?? zoom) * Math.exp(-delta * 0.0015),
          x: event.clientX,
          y: event.clientY,
        };
        scheduleGesture();
      },
      { passive: false },
    );
    scroll.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary || event.button !== 0) return;
      suppressClick = false;
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: scroll.scrollLeft,
        top: scroll.scrollTop,
        moved: false,
      };
    });
    scroll.addEventListener("pointermove", (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x,
        dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      if (!drag.moved) {
        drag.moved = true;
        scroll.setPointerCapture(event.pointerId);
        scroll.classList.add("is-dragging");
        scroll.querySelector("svg")?.pauseAnimations();
      }
      event.preventDefault();
      suppressClick = true;
      pendingPan = { left: drag.left - dx, top: drag.top - dy };
      scheduleGesture();
    });
    const stop = (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      flushGesture();
      drag = null;
      scroll.querySelector("svg")?.unpauseAnimations();
      scroll.classList.remove("is-dragging");
      if (scroll.hasPointerCapture(event.pointerId)) scroll.releasePointerCapture(event.pointerId);
    };
    scroll.addEventListener("pointerup", stop);
    scroll.addEventListener("pointercancel", stop);
    scroll.addEventListener("lostpointercapture", stop);
    scroll.addEventListener(
      "click",
      (event) => {
        if (!suppressClick) return;
        suppressClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true,
    );
  }
  function refreshWorld(s) {
    const svg = panel.querySelector(".campaign-map-scroll svg");
    if (!svg) return;
    const title = panel.querySelector(".campaign-map-title"),
      text = mapTitle(s);
    if (title.textContent !== text) title.textContent = text;
    const width = fittedMapWidth(svg.parentElement) * zoom * mapScale + "px";
    if (svg.style.width !== width) svg.style.width = width;
    let nodes = worldNodes.get(svg);
    if (!nodes) {
      nodes = { regions: new Map(), routes: [...svg.querySelectorAll("[data-route-from]")] };
      for (const region of CAMPAIGN_WORLD.regions) {
        const group = svg.querySelector(`[data-region="${region.id}"]`);
        const label = svg.querySelector(`[data-region-label="${region.id}"]`);
        nodes.regions.set(region.id, {
          group,
          surface: group.querySelector(".campaign-region-surface"),
          box: label.querySelector(".campaign-region-label-box"),
          count: label.querySelector(".campaign-region-count"),
        });
      }
      worldNodes.set(svg, nodes);
    }
    const index = regionIndex(s);
    const attribute = (element, key, value) => {
      if (element.getAttribute(key) !== String(value)) element.setAttribute(key, value);
    };
    for (const region of CAMPAIGN_WORLD.regions) {
      const { group, surface, box, count } = nodes.regions.get(region.id);
      const report = index.reports.get(region.id);
      const counts = index.counts.get(region.id) || [0, 0];
      const contested =
        s.phase === "encounters" && (report ? report.contested : counts.every((n) => n > 0));
      const owner = index.owners.get(region.id) ?? region.owner;
      attribute(group, "data-contested", contested);
      attribute(
        surface,
        "fill",
        contested
          ? "#927139"
          : owner === 0
            ? region.kind === "sea"
              ? "#20435d"
              : "#346688"
            : region.kind === "sea"
              ? "#4c2e3e"
              : "#8b4d57",
      );
      attribute(surface, "fill-opacity", region.kind === "sea" ? 0.7 : 1);
      attribute(
        surface,
        "stroke",
        selectedRegion === region.id ? "#e7f7ff" : contested ? "#ffcf61" : "#a0b0ba",
      );
      attribute(
        surface,
        "stroke-width",
        selectedRegion === region.id ? 2 : region.kind === "sea" ? 1.2 : 0.7,
      );
      attribute(surface, "stroke-dasharray", region.kind === "sea" ? "4 4" : "none");
      attribute(
        box,
        "stroke",
        contested
          ? "#ffcf61"
          : selectedRegion === region.id
            ? "#bce7ff"
            : owner === 0
              ? "#719cb6"
              : "#b87c84",
      );
      attribute(box, "stroke-width", selectedRegion === region.id ? 1.8 : 0.7);
      const strength = regionStrengthReport(s, region.id);
      if (count.textContent !== strength) count.textContent = strength;
    }
    for (const route of nodes.routes) {
      const active = [route.dataset.routeFrom, route.dataset.routeTo].includes(selectedRegion);
      attribute(route, "opacity", active ? 0.85 : 0.1);
      attribute(route, "stroke-width", active ? 1.8 : 1);
    }
    renderMovements(svg, s);
    highlightEncounter();
    renderMoveDraft();
    for (const button of panel.querySelectorAll(".campaign-map-tools button"))
      button.disabled = !!Net.awaiting;
  }
  function renderMovements(svg, s) {
    const previous = svg.querySelector(".campaign-moving-armies");
    const signature = JSON.stringify(s.movements || []);
    if (previous?.dataset.signature === signature) return;
    previous?.remove();
    const shape = (tag, attrs, text = "") => {
      const item = document.createElementNS(svg.namespaceURI, tag);
      for (const [name, value] of Object.entries(attrs)) item.setAttribute(name, value);
      item.textContent = text;
      return item;
    };
    const layer = shape("g", { class: "campaign-moving-armies" });
    layer.dataset.signature = signature;
    const defs = shape("defs", {});
    for (const team of [0, 1]) {
      const marker = shape("marker", {
        id: "campaignMoveArrow" + team,
        viewBox: "0 0 10 10",
        refX: 9,
        refY: 5,
        markerWidth: 6,
        markerHeight: 6,
        orient: "auto-start-reverse",
      });
      marker.append(
        shape("path", { d: "M0 0L10 5L0 10Z", fill: team === 0 ? "#8ad6ff" : "#ff9eaa" }),
      );
      defs.append(marker);
    }
    layer.append(defs);
    const occupied = [];
    for (const move of s.movements || []) {
      const from = CAMPAIGN_WORLD.regions.find((region) => region.id === move.from),
        to = CAMPAIGN_WORLD.regions.find((region) => region.id === move.to);
      if (!from || !to) continue;
      const [x1, y1] = from.center,
        [rawX2, y2] = to.center;
      const x2 = rawX2 + (rawX2 - x1 > 600 ? -1200 : rawX2 - x1 < -600 ? 1200 : 0);
      const d = `M${x1},${y1}L${x2},${y2}`;
      for (const offset of x2 === rawX2 ? [0] : [0, x2 < 0 ? 1200 : -1200])
        layer.append(
          shape("path", {
            d,
            transform: `translate(${offset},0)`,
            fill: "none",
            stroke: move.team === 0 ? "#8ad6ff" : "#ff9eaa",
            "stroke-width": 2,
            "stroke-dasharray": "6 3",
            "marker-end": `url(#campaignMoveArrow${move.team})`,
            "pointer-events": "none",
          }),
        );
      const x = Math.max(58, Math.min(1142, ((x1 + x2) / 2 + 1200) % 1200));
      let y = (y1 + y2) / 2 - 28;
      while (occupied.some((point) => Math.abs(point.x - x) < 115 && Math.abs(point.y - y) < 40))
        y += 42;
      y = Math.max(22, Math.min(535, y));
      occupied.push({ x, y });
      const label = shape("g", {
        class: "campaign-movement-label",
        transform: `translate(${x},${y}) scale(0.75) translate(${-x},${-y})`,
        "data-movement": move.id,
        role: "button",
        tabindex: 0,
        "aria-label": I18n.text("行进部队") + " · " + reportCount(move.count, move.approximate),
      });
      label.append(
        shape("rect", {
          x: x - 56,
          y: y - 19,
          width: 112,
          height: 38,
          rx: 3,
          fill: "#162332",
          stroke: move.team === 0 ? "#8ad6ff" : "#ff9eaa",
        }),
      );
      label.append(
        shape(
          "text",
          { x, y: y - 3, "text-anchor": "middle", fill: "#edf5fc", "font-size": 10 },
          I18n.text("行进部队") + " · " + reportCount(move.count, move.approximate),
        ),
      );
      label.append(
        shape(
          "text",
          { x, y: y + 11, "text-anchor": "middle", fill: "#a5dfff", "font-size": 9 },
          I18n.text("查看详情"),
        ),
      );
      label.onclick = () => openMovement(move.id);
      label.onkeydown = (event) => {
        if (["Enter", " "].includes(event.key)) {
          event.preventDefault();
          openMovement(move.id);
        }
      };
      layer.append(label);
    }
    svg.append(layer);
  }
  // Reuse one lightweight outline per active encounter or movement destination, below all labels.
  function regionEffect(svg, active, className, attribute) {
    if (!svg) return;
    const previous = svg.querySelector("." + className);
    const particleCount = window.matchMedia("(max-width: 700px), (pointer: coarse)").matches
      ? 4
      : 16;
    if (
      previous?.getAttribute(attribute) === active &&
      previous.dataset.particles === String(particleCount)
    )
      return;
    previous?.remove();
    if (!active) return;
    const surface = svg.querySelector(`[data-region="${active}"] .campaign-region-surface`);
    if (!surface) return;
    const shape = (name, attributes) => {
      const element = document.createElementNS(svg.namespaceURI, name);
      for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
      return element;
    };
    const effect = shape("g", {
      class: className,
      [attribute]: active,
      "aria-hidden": "true",
    });
    const path = surface.getAttribute("d");
    effect.append(shape("path", { d: path, class: "campaign-encounter-glow" }));
    const motionId = "campaignMotion-" + className;
    effect.append(shape("path", { id: motionId, d: path, class: "campaign-encounter-edge" }));
    effect.dataset.particles = String(particleCount);
    for (let index = 0; index < particleCount; index++) {
      const particle = shape("circle", {
        r: index % 3 === 0 ? 2.2 : 1.3,
        class: "campaign-encounter-particle",
      });
      const motion = shape("animateMotion", {
        dur: "10s",
        begin: `${(-index * 10) / particleCount}s`,
        repeatCount: "indefinite",
        calcMode: "paced",
        rotate: "auto",
      });
      const reference = shape("mpath", { href: "#" + motionId });
      motion.append(reference);
      particle.append(motion);
      effect.append(particle);
    }
    svg.insertBefore(effect, svg.querySelector(".campaign-world-labels"));
  }
  function highlightEncounter() {
    regionEffect(
      panel.querySelector(".campaign-map-scroll svg"),
      encounterDialog.open ? encounterRegion : null,
      "campaign-encounter-outline",
      "data-encounter-region",
    );
  }
  function focusEncounter() {
    const scroll = panel.querySelector(".campaign-map-scroll");
    const svg = scroll?.querySelector("svg");
    const region = CAMPAIGN_WORLD.regions.find((item) => item.id === encounterRegion);
    if (!svg || !region || !encounterDialog.open || Net.started) return;
    zoom = Math.max(zoom, 2);
    svg.style.width = fittedMapWidth(scroll) * zoom * mapScale + "px";
    // Leave enough scrollable ocean to center even territories at the map edges.
    scroll.style.paddingBlock = Math.round(scroll.clientHeight / 2) + "px";
    scroll.dataset.encounterFocus = "true";
    const rect = scroll.getBoundingClientRect(),
      map = svg.getBoundingClientRect();
    const drawerTop = encounterDialog.getBoundingClientRect().top;
    const visibleBottom = Math.min(rect.bottom, drawerTop);
    const visibleHeight = Math.max(40, visibleBottom - rect.top);
    const scale = map.width / 1200;
    scroll.scrollTo({
      left: scroll.scrollLeft + map.left + region.center[0] * scale - (rect.left + rect.width / 2),
      top: scroll.scrollTop + map.top + region.center[1] * scale - (rect.top + visibleHeight / 2),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
    scroll.dataset.focusRegion = region.id;
  }
  const encounterDialog = node("dialog", "", "campaign-encounter-dialog");
  encounterDialog.id = "campaignEncounterDialog";
  document.body.append(encounterDialog);
  let encounterRegion = null,
    encounterExpanded = false;
  encounterDialog.addEventListener("cancel", (event) => event.preventDefault());
  function openEncounter(id) {
    const next = state()?.preparation?.region || id;
    if (encounterRegion !== next || !encounterDialog.open) encounterExpanded = false;
    encounterRegion = next;
    renderEncounter();
    const map = panel.querySelector(".campaign-world");
    if (map && encounterDialog.parentElement !== map) map.append(encounterDialog);
    if (!encounterDialog.open) encounterDialog.show();
    highlightEncounter();
    // Run after render() restores ordinary scroll positions and the scene has laid out.
    requestAnimationFrame(focusEncounter);
  }
  encounterDialog.addEventListener("close", () => {
    highlightEncounter();
  });
  function renderEncounter() {
    const s = state();
    if (!s || s.phase !== "encounters" || !CampaignRules.disputed(s, encounterRegion)) {
      if (encounterDialog.open) encounterDialog.close();
      return;
    }
    const region = CAMPAIGN_WORLD.regions.find((item) => item.id === encounterRegion),
      encounter = s.encounters.find((item) => item.region === region.id);
    const previousMap = encounterDialog.querySelector("select")?.value;
    const bodyScroll = encounterDialog.querySelector(".campaign-encounter-body")?.scrollTop || 0;
    const folds = [...encounterDialog.querySelectorAll("details")].map((item) => item.open);
    const positions = [...encounterDialog.querySelectorAll(".campaign-encounter-roster")].map(
      (item) => item.scrollTop,
    );
    const header = node("header", "", "campaign-encounter-header"),
      title = node("h2", regionName(region) + " · " + I18n.text("交战状态"));
    title.id = "campaignEncounterTitle";
    encounterDialog.setAttribute("aria-labelledby", title.id);
    const expand = button(encounterExpanded ? "收起详情" : "展开详情", () => {
      encounterExpanded = !encounterExpanded;
      renderEncounter();
    });
    expand.disabled = false;
    expand.id = "campaignEncounterExpand";
    expand.setAttribute("aria-expanded", String(encounterExpanded));
    expand.setAttribute("aria-controls", "campaignEncounterBody");
    encounterDialog.dataset.expanded = encounterExpanded;
    header.append(title, expand);
    const body = node("div", "", "campaign-encounter-body");
    body.id = "campaignEncounterBody";
    const teams = node("div", "", "campaign-encounter-teams");
    if (!encounterExpanded) {
      for (const team of [0, 1]) {
        const count = regionCount(s, region.id, team);
        const card = node("article", "", "campaign-encounter-count");
        card.dataset.team = team;
        const relation = Number.isInteger(Net.seat)
          ? Rules.seatTeam(Net.seat) === team
            ? "己方"
            : "敌方"
          : "队伍" + (team + 1);
        card.append(
          node("small", relation + " · " + (team === 0 ? "地球联邦军" : "吉翁公国军")),
          node(
            "strong",
            reportCount(
              count,
              s.intel?.team !== null && s.intel?.team !== team && s.intel?.progress < 75,
            ),
          ),
        );
        teams.append(card);
      }
    }
    for (const team of encounterExpanded ? [0, 1] : []) {
      const army = s.units.filter((unit) => unit.region === region.id && unit.team === team),
        alive = army.filter((unit) => !unit.destroyed);
      const section = node("details", "", "campaign-encounter-team");
      section.dataset.team = team;
      section.open = folds[team] ?? true;
      section.append(
        node(
          "summary",
          (team === 0 ? I18n.text("地球联邦军") : I18n.text("吉翁公国军")) +
            " · " +
            reportCount(
              regionCount(s, region.id, team),
              s.intel?.team !== null && s.intel?.team !== team && s.intel?.progress < 75,
            ),
        ),
      );
      if (s.intel?.team === null || s.intel?.team === team || s.intel?.progress >= 100)
        section.append(
          node(
            "p",
            (s.regions.find((item) => item.id === region.id).owner === team
              ? I18n.text("防守方")
              : I18n.text("进攻方")) +
              " · " +
              I18n.text("损毁 ") +
              (army.length - alive.length),
          ),
        );
      const list = node("div", "", "campaign-encounter-roster");
      if (
        !army.length &&
        s.intel?.team !== null &&
        s.intel?.team !== team &&
        s.intel?.progress < 75
      )
        list.append(node("p", "情报不足，无法查看部队名单"));
      for (const unit of army) {
        const m = armyModel(unit),
          row = node("article", "", "campaign-encounter-unit");
        row.dataset.destroyed = unit.destroyed;
        const image = node("img");
        image.src = unitIcon(unit.unitId + "__" + unit.kitId);
        image.alt = "";
        image.loading = "lazy";
        const copy = node("div", "", "campaign-encounter-unit-copy");
        copy.append(node("strong", m.name));
        if (!unit.intelRedacted)
          copy.append(
            node("small", I18n.text("驾驶员：") + unit.pilotName),
            node(
              "small",
              unit.destroyed
                ? "已损毁"
                : unit.aboard
                  ? "搭载中"
                  : (unit.hp ?? m.hp) < m.hp
                    ? "受损"
                    : "待战",
            ),
          );
        const vitals = node("div", "", "campaign-encounter-vitals");
        vitals.append(
          node("span", `HP ${formatNumber(unit.hp ?? m.hp)} / ${formatNumber(m.hp)}`),
          node("span", `EN ${formatNumber(unit.en ?? m.en)} / ${formatNumber(m.en)}`),
        );
        row.append(image, copy);
        if (!unit.intelRedacted) row.append(vitals);
        list.append(row);
      }
      section.append(list);
      teams.append(section);
      list.scrollTop = positions[team] || 0;
    }
    body.append(teams);
    const maps = document.createElement("select");
    maps.id = "campaignEncounterMap";
    maps.setAttribute("aria-label", "局地战地图");
    const indexedMap =
      ART.scenarios[Net.snapshot.settings.scenarioId || "earth_0079_mid"].regions[region.id].mapId;
    const mapId = encounter?.mapId || indexedMap;
    const map = ART.maps[mapId];
    maps.append(new Option(map.name, map.id));
    maps.disabled = true;
    const preparation = s.preparation;
    const mapLabel = node("label", "局地战地图", "campaign-encounter-map");
    mapLabel.hidden = !encounterExpanded;
    mapLabel.append(maps);
    body.append(mapLabel);
    const pending = preparation?.region === region.id,
      player = preparation?.participants.find((item) => item.seat === Net.seat),
      canEnter = pending && !!player && !player.bot;
    const enter = (delegate) =>
      command("campaign_enter", {
        region: region.id,
        mapId: maps.value,
        delegate,
        preparationId: preparation.id,
      });
    const markers = node("div", "", "campaign-encounter-readiness");
    const viewerTeam = Number.isInteger(Net.seat) ? Rules.seatTeam(Net.seat) : 0;
    const readinessGroups = [viewerTeam, 1 - viewerTeam].map((team, index) => {
      const group = node("div", "", "campaign-ready-group");
      group.dataset.team = team;
      group.append(
        node("small", Number.isInteger(Net.seat) ? (index ? "敌军" : "我军") : "队伍" + (team + 1)),
      );
      markers.append(group);
      return group;
    });
    for (const participant of preparation?.participants || []) {
      const member = Net.snapshot.members.find((item) => item.seat === participant.seat);
      const marker = node("span", "", "campaign-ready-marker");
      marker.dataset.team = Rules.seatTeam(participant.seat);
      marker.dataset.ready = participant.ready;
      marker.title =
        (member?.name || "AI") +
        " · " +
        (participant.ready ? (participant.delegate ? "AI委任" : "手动指挥") : "等待选择");
      marker.setAttribute("aria-label", marker.title);
      readinessGroups[Rules.seatTeam(participant.seat) === viewerTeam ? 0 : 1].append(marker);
    }
    const footer = node("footer", "", "campaign-encounter-footer");
    const actions = node("div", "", "campaign-encounter-actions");
    if (s.hostControlsAI) {
      actions.classList.add("campaign-host-battle-actions");
      actions.append(
        button(
          "开始交战",
          () =>
            command("campaign_start_battle", {
              region: region.id,
              mapId: maps.value,
              preparationId: preparation.id,
            }),
          !pending || Net.memberId !== Net.snapshot.hostId,
        ),
      );
    } else
      for (const [delegate, label] of [
        [true, "AI委任"],
        [false, "手动指挥"],
      ]) {
        const choice = button(label, () => enter(delegate), !canEnter);
        choice.setAttribute(
          "aria-pressed",
          String(!!player?.ready && player.delegate === delegate),
        );
        actions.append(choice);
      }
    footer.append(
      markers,
      node(
        "small",
        s.hostControlsAI
          ? "等待房主开始交战"
          : canEnter
            ? "所有参战玩家准备后开始局地战"
            : "等待参战玩家准备",
      ),
      actions,
    );
    encounterDialog.replaceChildren(header, body, footer);
    body.scrollTop = bodyScroll;
    for (const [index, list] of [
      ...encounterDialog.querySelectorAll(".campaign-encounter-roster"),
    ].entries())
      list.scrollTop = positions[index] || 0;
  }
  const orderDialog = node("dialog", "", "campaign-order-dialog");
  orderDialog.id = "campaignOrderDialog";
  let embarkingArmy = null;
  orderDialog.addEventListener("close", () => {
    embarkingArmy = null;
  });
  document.body.append(orderDialog);
  function clearMoveDraft() {
    moveDraft = null;
    renderMoveDraft();
    if (resumeForceDetails && pageView === "campaign") {
      resumeForceDetails = false;
      openForceDetails(forceDetailsRegion);
    }
  }
  function renderMoveDraft() {
    const s = state(),
      map = panel.querySelector(".campaign-world"),
      svg = map?.querySelector("svg");
    if (!map || !s) return;
    if (
      moveDraft &&
      (s.phase !== "strategy" ||
        s.winner !== null ||
        Net.seat !== moveDraft.seat ||
        s.turn !== moveDraft.turn ||
        selectedRegion !== moveDraft.from ||
        moveDraft.ids.some((id) => {
          const unit = s.units.find((u) => u.id === id);
          return (
            !unit ||
            unit.destroyed ||
            unit.pendingTransfer ||
            unit.region !== moveDraft.from ||
            !selectedUnits.has(id) ||
            !CampaignRules.canRedeploy(s, unit) ||
            !CampaignRules.controls(s, Net.snapshot.members, Net.seat, unit)
          );
        }))
    )
      moveDraft = null;
    const targetScroll = map.querySelector(".campaign-move-targets")?.scrollTop || 0;
    map.querySelector(".campaign-move-dock")?.remove();
    map.dataset.moveDraft = String(!!moveDraft);
    const finish = map.querySelector(".campaign-end-turn");
    if (finish)
      finish.disabled =
        !!moveDraft ||
        !!Net.awaiting ||
        s.phase !== "strategy" ||
        (s.hostControlsAI ? Net.memberId !== Net.snapshot.hostId : Net.seat === null) ||
        s.winner !== null ||
        s.ready.includes(Net.seat);
    regionEffect(svg, moveDraft?.destination || null, "campaign-move-outline", "data-move-region");
    const signature = moveDraft?.destination ? moveDraft.from + ":" + moveDraft.destination : "";
    let arrow = svg?.querySelector(".campaign-move-preview");
    if ((arrow?.dataset.route || "") !== signature) {
      arrow?.remove();
      if (signature) {
        const shape = (tag, attrs) => {
          const e = document.createElementNS(svg.namespaceURI, tag);
          for (const [key, value] of Object.entries(attrs)) e.setAttribute(key, value);
          return e;
        };
        arrow = shape("g", {
          class: "campaign-move-preview",
          "data-route": signature,
          "pointer-events": "none",
        });
        const defs = shape("defs", {}),
          marker = shape("marker", {
            id: "campaignDraftArrow",
            viewBox: "0 0 10 10",
            refX: 9,
            refY: 5,
            markerWidth: 5,
            markerHeight: 5,
            orient: "auto-start-reverse",
          });
        marker.append(shape("path", { d: "M0 0L10 5L0 10Z", fill: "#ffd66b" }));
        defs.append(marker);
        arrow.append(defs);
        const from = CAMPAIGN_WORLD.regions.find((r) => r.id === moveDraft.from),
          target = CAMPAIGN_WORLD.regions.find((r) => r.id === moveDraft.destination),
          [x1, y1] = from.center,
          [rawX2, y2] = target.center,
          x2 = rawX2 + (rawX2 - x1 > 600 ? -1200 : rawX2 - x1 < -600 ? 1200 : 0);
        for (const offset of x2 === rawX2 ? [0] : [0, x2 < 0 ? 1200 : -1200])
          arrow.append(
            shape("path", {
              d: `M${x1},${y1}L${x2},${y2}`,
              transform: `translate(${offset},0)`,
              class: "campaign-march-arrow",
              fill: "none",
              stroke: "#ffd66b",
              "stroke-width": 3,
              "stroke-dasharray": "9 5",
              "marker-end": "url(#campaignDraftArrow)",
            }),
          );
        svg.insertBefore(arrow, svg.querySelector(".campaign-world-labels"));
      }
    }
    if (!moveDraft) return;
    const dock = node("section", "", "campaign-move-dock"),
      actions = node("div", "", "campaign-move-confirm-row");
    dock.id = "campaignMoveDock";
    dock.setAttribute("aria-label", I18n.text("调动部队"));
    actions.append(node("strong", I18n.text("调动部队") + " · " + moveDraft.ids.length));
    const confirm = button("确认调动", () => {
      if (!moveDraft?.destination || Net.awaiting) return;
      command("campaign_move", { ids: [...moveDraft.ids], region: moveDraft.destination });
      clearMoveDraft();
    });
    confirm.id = "campaignConfirmMove";
    confirm.className = "campaign-green-command";
    confirm.hidden = !moveDraft.destination;
    actions.append(confirm, button("取消", clearMoveDraft));
    const targets = node("div", "", "campaign-move-targets");
    const source = CAMPAIGN_WORLD.regions.find((r) => r.id === moveDraft.from);
    for (const id of source.links) {
      const region = CAMPAIGN_WORLD.regions.find((r) => r.id === id),
        owner = s.regions.find((r) => r.id === id).owner;
      const choice = button("", () => {
        moveDraft.destination = id;
        renderMoveDraft();
      });
      choice.dataset.destination = id;
      choice.setAttribute("aria-pressed", String(id === moveDraft.destination));
      choice.append(
        node("strong", regionName(region)),
        node("small", ["EFSF", "ZEON"][owner] + " · " + regionStrengthReport(s, id)),
      );
      targets.append(choice);
    }
    dock.append(actions, targets);
    map.append(dock);
    targets.scrollTop = targetScroll;
  }
  function openEmbark(armyId) {
    const s = state(),
      unit = s.units.find((item) => item.id === armyId);
    if (!unit || unit.destroyed || unit.aboard) return orderDialog.close();
    embarkingArmy = armyId;
    const header = node("header", "", "campaign-order-header"),
      title = node("h3", "搭载格纳库");
    title.id = "campaignOrderTitle";
    orderDialog.setAttribute("aria-labelledby", title.id);
    header.append(
      title,
      button("关闭", () => orderDialog.close(), false, true),
    );
    const targets = node("div", "", "campaign-order-targets");
    for (const option of boardingOptions(s, unit)) {
      const carrier = s.units.find((item) => item.id === option.carrierId);
      if (!CampaignRules.controls(s, Net.snapshot.members, Net.seat, carrier)) continue;
      const choice = button("", () => {
        command("campaign_embark", {
          armyId,
          carrierId: option.carrierId,
          hangarId: option.hangarId,
        });
        orderDialog.close();
      });
      choice.dataset.carrierId = option.carrierId;
      choice.dataset.hangarId = option.hangarId;
      choice.append(
        node("strong", armyModel(carrier).name + "[No." + carrier.id.split("-")[1] + "]"),
        node("small", option.name),
      );
      targets.append(choice);
    }
    if (!targets.children.length) targets.append(node("p", "没有可用的格纳库", "campaign-empty"));
    orderDialog.replaceChildren(header, targets);
    if (!orderDialog.open) orderDialog.showModal();
  }
  function chooseOrder(kind, ids, region) {
    embarkingArmy = null;
    if (kind === "move") {
      if (
        ids.some(
          (id) =>
            !CampaignRules.canRedeploy(
              state(),
              state().units.find((unit) => unit.id === id),
            ),
        )
      )
        throw Error("交战中的部队不能调动");
      if (forceDetailsDialog.open) {
        resumeForceDetails = true;
        forceDetailsDialog.close();
      }
      moveDraft = {
        ids: [...ids],
        from: region.id,
        destination: null,
        seat: Net.seat,
        turn: state().turn,
      };
      renderMoveDraft();
      return;
    }
    clearMoveDraft();
    const s = state(),
      team = Rules.seatTeam(Net.seat);
    const header = node("header", "", "campaign-order-header"),
      title = node("h3", "转交控制权");
    title.id = "campaignOrderTitle";
    orderDialog.setAttribute("aria-labelledby", title.id);
    header.append(
      title,
      button("关闭", () => orderDialog.close(), false, true),
    );
    const targets = node("div", "", "campaign-order-targets");
    for (const player of Net.snapshot.members.filter(
      (member) =>
        Number.isInteger(member.seat) &&
        !member.bot &&
        Rules.seatTeam(member.seat) === team &&
        member.seat !== Net.seat,
    )) {
      const already = ids.every(
        (id) => s.units.find((unit) => unit.id === id)?.ownerSeat === player.seat,
      );
      const choice = button(
        "",
        () => {
          command("campaign_transfer", { ids, to: player.seat });
          orderDialog.close();
        },
        already,
      );
      choice.dataset.recipient = player.seat;
      const name = node("strong", player.name);
      name.setAttribute("data-i18n-ignore", "");
      choice.append(name, node("small", already ? "已由该玩家控制" : "发送控制权转交请求"));
      targets.append(choice);
    }
    orderDialog.replaceChildren(header, node("p", `已选 ${ids.length} 台`), targets);
    orderDialog.showModal();
  }
  const armyDialog = node("dialog", "", "campaign-army-dialog");
  armyDialog.id = "campaignArmyDialog";
  document.body.append(armyDialog);
  let inspectedArmy = null,
    inspectedKit = null,
    armyTab = "stats";
  function openArmy(id) {
    inspectedArmy = id;
    inspectedKit = null;
    renderArmy();
    if (!armyDialog.open) armyDialog.showModal();
  }
  function renderArmy() {
    const s = state(),
      unit = s?.units.find((item) => item.id === inspectedArmy && !item.destroyed);
    if (!unit || Net.started) return armyDialog.close();
    const m = armyModel(unit),
      prefab = ART.prefabs.find((item) => item.id === unit.unitId);
    const editable =
      s.phase === "strategy" &&
      s.winner === null &&
      !unit.moveTo &&
      !s.transfers.some((item) => item.ids.includes(unit.id)) &&
      CampaignRules.controls(s, Net.snapshot.members, Net.seat, unit);
    const header = node("header", "", "campaign-order-header");
    const ctx = { G: Rules, production: PRODUCTION_CATALOG };
    const refund = CampaignRules.dismissalQuote(ctx, unit);
    const dismiss = button(
      "出售／解散",
      async () => {
        if (
          !refund ||
          !(await GameDialog.confirm(
            I18n.text("返还资金") +
              " " +
              formatNumber(refund.money) +
              " · " +
              I18n.text("物资") +
              " " +
              formatNumber(refund.supplies),
            { title: I18n.text("出售／解散") + " · " + m.name, confirmText: "确认" },
          ))
        )
          return;
        command("campaign_dismiss", { armyId: unit.id });
      },
      !CampaignRules.canDismiss(ctx, s, Net.snapshot.members, Net.seat, unit),
    );
    dismiss.id = "campaignDismissArmy";
    header.append(
      node("h3", m.name),
      dismiss,
      button("关闭", () => armyDialog.close(), false, true),
    );
    const content = node("div", "", "campaign-army-content");
    const canvas = node("canvas", "", "campaign-unit-preview");
    canvas.width = 440;
    canvas.height = 240;
    UnitPreview.renderPreview(unit.unitId + "__" + unit.kitId, canvas);
    content.append(canvas);
    const equipment = node("label", "装备套件", "campaign-kit-choice"),
      kits = node("select");
    kits.id = "campaignArmyKit";
    for (const kit of prefab.weaponKits) kits.append(new Option(I18n.localized(kit), kit.id));
    kits.value = prefab.weaponKits.some((kit) => kit.id === inspectedKit)
      ? inspectedKit
      : unit.kitId;
    kits.disabled = !editable || prefab.weaponKits.length < 2;
    equipment.append(kits);
    content.append(equipment);
    if (!unit.intelRedacted) {
      content.append(button("配属驾驶员", () => campaignPilots.open(unit.id), !editable));
      content.append(node("small", "驾驶员：" + unit.pilotName));
    } else content.append(node("small", "情报不足：耐久、EN及驾驶员信息保密"));
    kits.onchange = () => {
      inspectedKit = kits.value;
      renderArmyEquipment(unit, kits.value, equipment, editable);
    };
    renderArmyEquipment(unit, kits.value, equipment, editable);
    const tabs = node("nav", "", "campaign-tabs");
    for (const [id, label] of [
      ["stats", "属性"],
      ["weapons", "武装"],
      ["skills", "技能"],
    ]) {
      const b = button(label, () => {
        armyTab = id;
        renderArmy();
      });
      b.setAttribute("aria-pressed", String(armyTab === id));
      tabs.append(b);
    }
    content.append(tabs);
    if (armyTab === "stats") {
      const stats = node("dl", "", "campaign-metrics");
      for (const [label, value] of [
        ["HP", `${formatNumber(unit.hp ?? m.hp)} / ${formatNumber(m.hp)}`],
        ["EN", `${formatNumber(unit.en ?? m.en)} / ${formatNumber(m.en)}`],
        ["AP参考", m.actionPoints],
        ["移动", m.move],
        ["视野", m.sensors.sight],
        ["侦察", m.sensors.radar],
      ]) {
        if (unit.intelRedacted && ["HP", "EN"].includes(label)) continue;
        const entry = node("div");
        entry.append(node("dt", label), node("dd", String(value)));
        stats.append(entry);
      }
      content.append(stats);
    } else if (armyTab === "weapons") {
      for (const weapon of m.weapons) content.append(WeaponInfo.card(weapon));
    } else {
      const skills = [
        ...SkillControls.commandAbilities(m),
        ...SkillControls.defensiveAbilities(m),
        ...(m.skills || []),
      ];
      for (const skill of skills) {
        const card = node("article", "", "formation-weapon-detail");
        card.append(node("strong", skill.name), node("p", SkillControls.description(skill)));
        if (["transform", "flight"].includes(skill.type) && !skill.spawn && !skill.passive)
          card.append(
            button(
              "使用技能",
              () => command("campaign_unit_skill", { armyId: unit.id, skillId: skill.id }),
              !editable || unit.strategicSkillTurn === s.turn,
            ),
          );
        else if (!skill.passive) card.append(node("small", "局地战中使用"));
        content.append(card);
      }
      if (!skills.length) content.append(node("p", "无特殊能力"));
    }
    const scroll = armyDialog.querySelector(".campaign-army-content")?.scrollTop || 0;
    armyDialog.replaceChildren(header, content);
    content.scrollTop = scroll;
  }
  function renderArmyEquipment(unit, kitId, parent, editable) {
    parent.querySelector(".campaign-army-equip")?.remove();
    const row = node("div", "", "campaign-army-equip");
    if (kitId !== unit.kitId) {
      const quote = CampaignRules.equipmentQuote(
        { G: Rules, production: PRODUCTION_CATALOG },
        unit,
        kitId,
      );
      if (quote) {
        const price = node("span", "", "resource-balance");
        price.textContent = "免费换装";
        row.append(price);
        row.append(
          button(
            "更换套件",
            () => command("campaign_equip", { armyId: unit.id, kitId }),
            !editable,
          ),
        );
      } else row.append(node("small", "该套件暂不可换装"));
    }
    parent.append(row);
  }
  const forceDetailsDialog = node("dialog", "", "campaign-force-details-dialog");
  forceDetailsDialog.id = "campaignForceDetailsDialog";
  document.body.append(forceDetailsDialog);
  function openForceDetails(regionId = selectedRegion) {
    forceDetailsRegion = regionId;
    renderForceDetails();
    if (!forceDetailsDialog.open) forceDetailsDialog.showModal();
  }
  function renderForceDetails() {
    const s = state(),
      region = CAMPAIGN_WORLD.regions.find((r) => r.id === forceDetailsRegion);
    if (!s || !region) return forceDetailsDialog.close();
    const top = forceDetailsDialog.querySelector(".campaign-force-list")?.scrollTop || 0;
    const header = node("header", "", "campaign-order-header");
    header.append(
      node("h3", regionName(region) + " · " + I18n.text("区域部队")),
      button(
        "关闭",
        () => {
          resumeForceDetails = false;
          forceDetailsDialog.close();
        },
        false,
        true,
      ),
    );
    const locked =
      s.phase !== "strategy" ||
      Net.seat === null ||
      s.winner !== null ||
      s.ready.includes(Net.seat);
    forceDetailsDialog.replaceChildren(header, regionForces(s, region, locked, true));
    forceDetailsDialog.querySelector(".campaign-force-list").scrollTop = top;
  }
  function regionForces(s, region, locked, expanded = false) {
    const root = node("section", "", "campaign-forces");
    const friendlyTeam = Number.isInteger(Net.seat)
      ? Rules.seatTeam(Net.seat)
      : (Net.snapshot.viewTeam ?? 0);
    const sideTabs = node("nav", "", "campaign-force-tabs");
    for (const [id, label] of [
      ["friendly", "我军"],
      ["enemy", "敌军"],
    ]) {
      const choice = button(
        label,
        () => {
          forceSide = id;
          selectedUnits.clear();
          render();
        },
        false,
        true,
      );
      choice.dataset.forceSide = id;
      choice.setAttribute("aria-pressed", String(forceSide === id));
      sideTabs.append(choice);
    }
    if (!expanded) {
      const more = button("详情", () => openForceDetails(region.id), false, true);
      more.className = "campaign-forces-expand";
      sideTabs.append(more);
    }
    root.append(sideTabs);
    let units = [...(regionIndex(s).armies.get(region.id) || [])]
      .filter((unit) => (unit.team === friendlyTeam) === (forceSide === "friendly"))
      .sort(
        (a, b) =>
          UnitModels[a.unitId + "__" + a.kitId].cost - UnitModels[b.unitId + "__" + b.kitId].cost ||
          a.id.localeCompare(b.id, undefined, { numeric: true }),
      );
    const sorted = units, armyIds = new Set(sorted.map(unit => unit.id)), cargoByCarrier = new Map();
    for (const unit of sorted) {
      if (!unit.carrierArmyId) continue;
      if (!cargoByCarrier.has(unit.carrierArmyId)) cargoByCarrier.set(unit.carrierArmyId, []);
      cargoByCarrier.get(unit.carrierArmyId).push(unit);
    }
    for (const cargo of cargoByCarrier.values())
      cargo.sort((a,b) => (a.hangarId || "").localeCompare(b.hangarId || ""));
    units = [];
    const displayedCargo = new Set();
    function appendCargo(carrier) {
      if (displayedCargo.has(carrier.id)) return;
      displayedCargo.add(carrier.id);
      units.push(carrier);
      for (const child of cargoByCarrier.get(carrier.id) || []) appendCargo(child);
    }
    sorted.filter((unit) => !unit.carrierArmyId || !armyIds.has(unit.carrierArmyId))
      .forEach(appendCargo);
    const transferIds = new Set(s.transfers.flatMap(transfer => transfer.ids));
    const controllable = units.filter(
      (unit) =>
        !locked &&
        !transferIds.has(unit.id) &&
        CampaignRules.controls(s, Net.snapshot.members, Net.seat, unit),
    );
    const controllableIds = new Set(controllable.map(unit => unit.id));
    for (const id of selectedUnits)
      if (!controllableIds.has(id)) selectedUnits.delete(id);
    const selected = controllable.filter((unit) => selectedUnits.has(unit.id));
    const toolbar = node("div", "", "campaign-selection-toolbar");
    const selection = node("div", "", "campaign-selection-summary");
    selection.append(
      node(
        "strong",
        selected.length
          ? `已选 ${selected.length} 台`
          : I18n.text("区域部队") + " " + regionReport(s, region.id),
      ),
    );
    const all = controllable.length > 0 && selected.length === controllable.length;
    selection.append(
      button(
        all ? "清除" : "全选",
        () => {
          for (const unit of controllable)
            all ? selectedUnits.delete(unit.id) : selectedUnits.add(unit.id);
          render();
        },
        !controllable.length,
      ),
    );
    toolbar.append(selection);
    {
      const actions = node("div", "", "campaign-unit-actions");
      const recipients = Net.snapshot.members.filter(
        (member) =>
          Number.isInteger(member.seat) &&
          !member.bot &&
          Rules.seatTeam(member.seat) === Rules.seatTeam(Net.seat) &&
          member.seat !== Net.seat,
      );
      actions.append(
        button(
          "调动",
          () =>
            chooseOrder(
              "move",
              selected.map((unit) => unit.id),
              region,
            ),
          !selected.length || selected.some((unit) => !CampaignRules.canRedeploy(s, unit)),
        ),
        button(
          "转交",
          () =>
            chooseOrder(
              "transfer",
              selected.map((unit) => unit.id),
              region,
            ),
          !recipients.length || !selected.length,
        ),
      );
      if (selected.some((unit) => unit.moveTo))
        actions.append(
          button("撤销调动", () =>
            command("campaign_move", { ids: selected.map((unit) => unit.id), region: null }),
          ),
        );
      toolbar.append(actions);
    }
    root.append(toolbar);
    const list = node("div", "", "campaign-force-list");
    for (const unit of units) {
      const m = armyModel(unit),
        player = Net.snapshot.members.find((member) => member.seat === unit.ownerSeat);
      const prefab = ART.prefabs.find((item) => item.id === unit.unitId),
        kit = prefab?.weaponKits.find((item) => item.id === unit.kitId);
      const row = node("article", "", "campaign-force-card");
      row.dataset.unitId = unit.id;
      if (unit.carrierArmyId) {
        row.dataset.carrierId = unit.carrierArmyId;
        row.dataset.hangarId = unit.hangarId;
      }
      row.dataset.selected = selectedUnits.has(unit.id);
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = selectedUnits.has(unit.id);
      input.disabled = !controllable.includes(unit);
      input.setAttribute("aria-label", I18n.text("选择 ") + (m?.name || unit.unitId));
      input.onchange = () => {
        input.checked ? selectedUnits.add(unit.id) : selectedUnits.delete(unit.id);
        render();
      };
      const portrait = node("img", "", "campaign-force-portrait");
      portrait.src = unitIcon(unit.unitId + "__" + unit.kitId);
      portrait.alt = "";
      portrait.loading = "lazy";
      portrait.setAttribute("role", "checkbox");
      portrait.setAttribute("aria-checked", String(input.checked));
      portrait.setAttribute("aria-disabled", String(input.disabled));
      portrait.tabIndex = input.disabled ? -1 : 0;
      const toggleSelection = () => {
        if (!input.disabled) input.click();
      };
      portrait.onclick = toggleSelection;
      portrait.onkeydown = (event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          toggleSelection();
        }
      };
      const copy = node("div", "", "campaign-force-copy");
      const heading = node("div", "", "campaign-force-heading");
      const name = node("strong", m?.name || unit.unitId);
      name.title = name.textContent;
      heading.append(name);
      copy.append(node("small", kit ? I18n.localized(kit) : unit.kitId, "campaign-force-kit"));
      const owner = node("small", player?.name || "无人控制", "campaign-force-owner");
      owner.setAttribute("data-i18n-ignore", "");
      copy.append(owner);
      if (unit.pilotId) {
        const assigned = node("small", unit.pilotName, "campaign-force-assigned-pilot");
        assigned.title = unit.pilotName;
        assigned.setAttribute("data-i18n-ignore", "");
        copy.append(assigned);
      }
      const status = node("span", "", "campaign-force-status");
      const pending = s.transfers.find((transfer) => transfer.ids.includes(unit.id));
      status.append(
        node(
          "small",
          pending
            ? "等待接收"
            : !CampaignRules.canRedeploy(s, unit) && !unit.pendingTransfer
              ? "交战中"
              : unit.moveTo
                ? "→ " + CAMPAIGN_WORLD.regions.find((item) => item.id === unit.moveTo)?.name
                : unit.aboard
                  ? "搭载中"
                  : "待命",
        ),
      );
      copy.append(status);
      const vitals = node("div", "", "campaign-force-vitals");
      for (const [label, value, max] of [
        ["HP", unit.hp ?? m.hp, m.hp],
        ["EN", unit.en ?? m.en, m.en],
      ]) {
        const meter = node("div", "", "campaign-vital");
        meter.append(node("small", label + " " + formatNumber(value) + " / " + formatNumber(max)));
        const track = node("span", "", "campaign-vital-track");
        const fill = node("span", "", label === "HP" ? "hp" : "en");
        fill.style.width = Math.max(0, Math.min(100, max ? (value / max) * 100 : 0)) + "%";
        track.append(fill);
        meter.append(track);
        vitals.append(meter);
      }
      const operations = node("div", "", "campaign-force-operations");
      operations.append(button("详情", () => openArmy(unit.id)));
      const pilot = button(
        "配属驾驶员",
        () => campaignPilots.open(unit.id),
        locked || !controllable.includes(unit),
      );
      pilot.className = "campaign-force-pilot";
      pilot.title = I18n.text("驾驶员：") + (unit.pilotName || I18n.text("未知"));
      if (!unit.intelRedacted) operations.append(pilot);
      portrait.title = (m?.name || unit.unitId) + " · " + (kit ? I18n.localized(kit) : unit.kitId);
      heading.append(operations);
      row.append(input, heading, portrait, copy);
      if (!unit.intelRedacted) row.append(vitals);
      if (controllable.includes(unit)) {
        if (unit.aboard) {
          const parent = units.find((item) => item.id === unit.carrierArmyId);
          row.title = (parent ? armyModel(parent).name : "格纳库") + " · " + unit.hangarId;
          operations.append(
            button(
              "离舰",
              () => command("campaign_disembark", { armyId: unit.id }),
              locked || !!unit.moveTo,
            ),
          );
        } else {
          const options = boardingOptions(s, unit).filter((option) =>
            controllable.some((carrier) => carrier.id === option.carrierId),
          );
          if (options.length) operations.append(button("搭载", () => openEmbark(unit.id), locked));
        }
      }
      list.append(row);
    }
    const hiddenEnemies =
      forceSide === "enemy" &&
      s.intel &&
      s.intel.team !== null &&
      s.intel.progress < 75 &&
      regionCount(s, region.id, 1 - s.intel.team) !== 0;
    if (hiddenEnemies) list.append(node("p", "情报不足，无法查看敌军部队名单", "campaign-empty"));
    else if (!units.length) list.append(node("p", "该区域没有部队", "campaign-empty"));
    root.append(list);
    return root;
  }
  function details(s) {
    const detail = node("aside", "", "campaign-detail");
    const team = Net.seat === null ? null : Rules.seatTeam(Net.seat);
    const region =
      CAMPAIGN_WORLD.regions.find((item) => item.id === selectedRegion) ||
      CAMPAIGN_WORLD.regions[0];
    selectedRegion = region.id;
    const owner = s.regions.find((item) => item.id === region.id)?.owner ?? region.owner;
    const heading = node("h3", regionName(region));
    heading.title =
      I18n.text(owner === 0 ? "地球联邦军" : "吉翁公国军") +
      " · " +
      I18n.text(
        CAMPAIGN_WORLD.settings.headquarters?.some((base) => base.region === region.id)
          ? "指挥部"
          : region.factory
            ? "生产据点"
            : "普通区域",
      );
    const revenue = node("div", "", "campaign-region-revenue resource-balance");
    revenue.title = I18n.text("每回合收入");
    ProductionUI.resources(revenue, regionYield(s, region.id), {
      compact: true,
      technology: !!region.factory,
    });
    detail.append(heading, revenue);
    const report = s.intelRegions?.find((entry) => entry.id === region.id);
    for (const side of [0, 1]) {
      const approximate =
        Number.isInteger(s.intel?.team) && side !== s.intel.team && s.intel.progress < 75;
      const cost = report?.costs[side];
      const label = Number.isInteger(team)
        ? side === team
          ? "我军"
          : "敌军"
        : "队伍" + (side + 1);
      detail.append(
        node(
          "p",
          I18n.text(label) +
            " · " +
            reportCount(regionCount(s, region.id, side), approximate) +
            " / " +
            (cost == null
              ? I18n.text("未知")
              : (approximate && cost > 0 ? I18n.text("约") : "") + formatNumber(cost)) +
            "C",
          "campaign-region-count-summary",
        ),
      );
    }
    const tabs = node("div", "", "campaign-tabs");
    for (const [id, label] of [
      ["units", "部队"],
      ["orders", "订单"],
    ]) {
      const b = button(label, () => {
        tab = id;
        render();
      });
      b.setAttribute("aria-pressed", String(tab === id));
      tabs.append(b);
    }
    const actions = node("div", "", "campaign-side-actions");
    actions.append(
      button("生产", () => CampaignWorkspace.open("production", region.id)),
      button("科技", () => CampaignWorkspace.open("research", region.id)),
      button("驾驶员", () => campaignPilots.open(), Net.seat === null),
      button("谍报", openIntelligence),
    );
    detail.append(actions, tabs);
    const locked =
      s.phase !== "strategy" ||
      Net.seat === null ||
      s.winner !== null ||
      s.ready.includes(Net.seat);
    if (tab === "units") {
      detail.append(regionForces(s, region, locked));
      for (const transfer of s.transfers.filter((transfer) => transfer.to === Net.seat)) {
        const request = node("div", "转交请求：" + transfer.ids.length + "台", "campaign-order");
        request.append(
          button(
            "接收",
            () => command("campaign_accept_transfer", { transferId: transfer.id, accept: true }),
            locked,
          ),
          button(
            "拒绝",
            () => command("campaign_accept_transfer", { transferId: transfer.id, accept: false }),
            locked,
          ),
        );
        detail.append(request);
      }
    }
    if (tab === "orders") {
      const orders = node("div", "", "campaign-order-list");
      for (const order of s.orders.filter(
        (order) => order.team === team && order.region === region.id,
      )) {
        const player = Net.snapshot.members.find((member) => member.seat === order.ownerSeat);
        const row = node("div", "", "campaign-order");
        row.append(
          node("strong", UnitModels[order.unitId + "__" + order.kitId]?.name || order.unitId),
          node(
            "small",
            I18n.localized(
              ART.prefabs
                .find((prefab) => prefab.id === order.unitId)
                ?.weaponKits.find((kit) => kit.id === order.kitId) || { name: order.kitId },
            ),
          ),
          node(
            "small",
            `${player?.name} · ${CAMPAIGN_WORLD.regions.find((r) => r.id === order.region)?.name} · ${order.quantity}台 · ${{ waiting: "等待资源", queued: "排队", working: "生产中" }[order.status]} · 剩余${order.remaining}回合`,
          ),
        );
        if (order.ownerSeat === Net.seat && order.status !== "working")
          row.append(
            button(
              "取消订单",
              () => command("campaign_cancel_order", { orderId: order.id }),
              locked,
            ),
          );
        orders.append(row);
      }
      detail.append(orders);
    }
    if (s.phase === "encounters")
      detail.append(node("p", "点击黄色交战区域查看双方战况", "campaign-battle-hint"));
    return detail;
  }
  const seatsDialog = node("dialog", "", "campaign-order-dialog campaign-seats-dialog");
  seatsDialog.id = "campaignSeatsDialog";
  const seatsHeading = node("header", "", "campaign-order-header");
  const watchSeat = button("切换到观战席", () => Net.request("switch_seat", { seat: null }));
  watchSeat.id = "campaignBecomeSpectator";
  seatsHeading.append(
    node("h3", "玩家席位"),
    watchSeat,
    button("退出房间", requestMenu),
    button("关闭", () => seatsDialog.close(), false, true),
  );
  const seatsBody = node("div", "", "campaign-seats-body");
  const seatsPage = byId("roomSeatsPage"),
    seatsHome = document.createComment("campaign-seats-home");
  seatsPage.before(seatsHome);
  const memberDetail = byId("roomDetailPanel"),
    memberDetailHome = document.createComment("campaign-member-detail-home");
  memberDetail.before(memberDetailHome);
  seatsDialog.append(seatsHeading, seatsBody);
  document.body.append(seatsDialog);
  seatsDialog.addEventListener("close", () => {
    if (memberDetail.open) byId("closeRoomDetail").click();
    memberDetailHome.after(memberDetail);
    seatsHome.after(seatsPage);
  });
  function openSeats() {
    seatsBody.append(seatsPage);
    document.body.append(memberDetail);
    seatsDialog.showModal();
    refreshSeats();
  }
  function refreshSeats() {
    if (!seatsDialog.open) return;
    RoomPanel.render(Net.snapshot);
    watchSeat.disabled = !!Net.awaiting || Net.seat === null || !!Net.snapshot.returnCountdown;
    for (const control of seatsPage.querySelectorAll(".team-heading button")) control.hidden = true;
  }
  const saveDialog = node("dialog", "", "campaign-order-dialog campaign-save-dialog");
  saveDialog.id = "campaignSaveDialog";
  document.body.append(saveDialog);
  function openSaves() {
    const s = state();
    if (!s) return;
    const host = Net.memberId === Net.snapshot.hostId;
    const heading = node("header", "", "campaign-order-header");
    heading.append(
      node("h3", "战役存档"),
      button("关闭", () => saveDialog.close(), false, true),
    );
    const name = node("p", s.name || CAMPAIGN_WORLD.name, "campaign-save-name");
    name.setAttribute("data-i18n-ignore", "");
    const actions = node("div", "", "campaign-save-actions");
    actions.append(
      button(
        "导出战役",
        () => {
          command("campaign_export");
          saveDialog.close();
        },
        !host,
      ),
      button(
        "导入战役",
        () => {
          importFile.click();
          saveDialog.close();
        },
        !host,
      ),
    );
    saveDialog.replaceChildren(heading, name, node("p", `第${s.turn}大回合`), actions);
    saveDialog.showModal();
  }
  function render() {
    const s = state();
    if (!s) return;
    const preparationKey = s.preparation ? s.turn + ":" + s.preparation.id : null;
    if (preparationKey && preparationKey !== focusedPreparation) {
      selectedRegion = s.preparation.region;
      selectedUnits.clear();
      tab = "units";
    }
    focusedPreparation = preparationKey;
    const scroll = [".campaign-detail", ".campaign-map-scroll", ".campaign-force-list"].map(
      (selector) => {
        const item = panel.querySelector(selector);
        return [selector, item?.scrollLeft || 0, item?.scrollTop || 0];
      },
    );
    if (s.phase !== "strategy" && orderDialog.open) orderDialog.close();
    lastRevision = Net.snapshot.revision;
    const header = node("header", "", "campaign-header");
    const team = Net.seat === null ? (Net.snapshot.viewTeam ?? 0) : Rules.seatTeam(Net.seat),
      pool = s.teams[team];
    const overview = node("div", "", "campaign-header-overview");
    const identity = node("div", "", "campaign-header-identity");
    const title = node("div", "", "campaign-header-title");
    const divider = node("span", "", "campaign-title-divider");
    divider.setAttribute("aria-hidden", "true");
    const savedName = s.name || CAMPAIGN_WORLD.name;
    const caption = node(
      "span",
      savedName === CAMPAIGN_WORLD.name ? I18n.text(savedName) : savedName,
      "campaign-header-save-name",
    );
    caption.title = savedName;
    caption.setAttribute("data-i18n-ignore", "");
    title.append(node("h2", "历史战役模式"), divider, caption);
    identity.append(title);
    const utilities = node("div", "", "campaign-header-utilities");
    utilities.append(
      button("存档", openSaves),
      button("玩家席位", openSeats),
      button("离开房间", () => requestMenu()),
      button("设置", () => byId("shellSettings").click()),
    );
    overview.append(identity, utilities);
    const balances = node("div", "", "campaign-header-balances");
    const resources = node("span", "", "resource-balance campaign-header-resources");
    ProductionUI.resources(resources, pool, {
      compact: true,
      technology: true,
      income: CampaignRules.income({ world: CAMPAIGN_WORLD }, s, team),
    });
    balances.append(resources);
    const status = node("div", "", "campaign-header-state");
    const humans = Net.snapshot.members.filter((member) => member.seat !== null && !member.bot);
    status.append(
      node("strong", `第${s.turn}大回合 · ${s.phase === "strategy" ? "规划阶段" : "战斗阶段"}`),
      node(
        "small",
        (s.phase === "strategy"
          ? s.hostControlsAI
            ? I18n.text("由房主结束战略阶段")
            : `已结束指令 ${s.ready.length}/${humans.length}`
          : I18n.text("待处理战场 ") +
            s.encounters.filter(
              (item) => item.turn < s.turn && CampaignRules.disputed(s, item.region),
            ).length) + (s.commanders.includes(Net.seat) ? " · 总指挥官" : ""),
        "campaign-header-readiness",
      ),
    );
    const finish = button(
      s.ready.includes(Net.seat) ? "等待其他玩家思考中" : "结束战略回合",
      async () => {
        if (
          !(await GameDialog.confirm("确定结束本战略回合？", {
            title: "结束战略回合",
            confirmText: "确定",
          }))
        )
          return;
        const current = state();
        if (
          current?.turn === s.turn &&
          current.phase === "strategy" &&
          !current.ready.includes(Net.seat)
        )
          command("campaign_ready", { ready: true });
      },
      s.phase !== "strategy" ||
        (s.hostControlsAI ? Net.memberId !== Net.snapshot.hostId : Net.seat === null) ||
        s.winner !== null ||
        s.ready.includes(Net.seat),
    );
    finish.className = "campaign-green-command campaign-end-turn";
    header.append(overview, status, balances);
    const existing = panel.querySelector(".campaign-body");
    if (existing) {
      panel.querySelector(".campaign-header").replaceWith(header);
      const map = existing.querySelector(".campaign-world");
      if (map.dataset.language !== I18n.language) map.replaceWith(world(s));
      existing.querySelector(".campaign-detail").replaceWith(details(s));
      refreshWorld(s);
    } else {
      const body = node("div", "", "campaign-body");
      body.append(details(s), world(s));
      panel.append(header, body, campaignConsole.root);
      refreshWorld(s);
    }
    const map = panel.querySelector(".campaign-world");
    if (encounterDialog.parentElement !== map) map.append(encounterDialog);
    let commands = map.querySelector(".campaign-map-commands");
    if (!commands) {
      commands = node("div", "", "campaign-map-commands");
      map.append(commands);
    }
    commands.replaceChildren(finish);
    renderMoveDraft();
    panel.querySelector(".campaign-status")?.remove();
    panel.querySelector(".campaign-victory")?.remove();
    campaignConsole.refresh();
    if (s.winner !== null)
      panel.append(
        node(
          "p",
          (s.winner === 0 ? "地球联邦军" : "吉翁公国军") + "占领敌方指挥部，战役结束。",
          "campaign-victory",
        ),
      );
    if (s.preparation && !Net.started) {
      if (encounterRegion !== s.preparation.region || !encounterDialog.open)
        openEncounter(s.preparation.region);
      else renderEncounter();
    } else if (encounterDialog.open) encounterDialog.close();
    if (forceDetailsDialog.open) renderForceDetails();
    if (armyDialog.open) renderArmy();
    campaignPilots.refresh();
    if (intelligenceDialog.open) renderIntelligence();
    if (movementDialog.open) renderMovement();
    refreshSeats();
    layout();
    for (const [selector, x, y] of scroll) {
      const item = panel.querySelector(selector);
      if (item) {
        item.scrollLeft = x;
        item.scrollTop = y;
      }
    }
    if (orderDialog.open) {
      if (embarkingArmy) openEmbark(embarkingArmy);
      else
        for (const button of orderDialog.querySelectorAll("button[data-campaign-disabled]"))
          button.disabled = button.dataset.campaignDisabled === "true" || !!Net.awaiting;
    }
    window.CampaignWorkspace?.refresh();
  }
  async function create() {
    if (!assetsReady) return GameDialog.alert("请等待单位数据加载完成");
    if (state()) return open();
    if (!Net.active || Net.snapshot?.settings.mode !== "campaign")
      return GameDialog.alert("请先创建或加入历史战役模式房间");
    const dialog = document.createElement("dialog");
    dialog.className = "campaign-setup";
    const rounds = document.createElement("input");
    rounds.type = "number";
    rounds.min = 1;
    rounds.max = 10;
    rounds.value = 10;
    rounds.id = "campaignRounds";
    const label = node("label", "局地战持续回合（与战斗界面计数一致）");
    label.append(rounds);
    dialog.append(
      node("h2", "创建地球战役"),
      node("p", "共享阵营资源与科技，生产出的部队归申请人控制。每队首席为总指挥官。"),
      label,
      button("取消", () => {
        dialog.close();
        dialog.remove();
      }),
      button(
        "创建战役",
        () => {
          if (!rounds.reportValidity()) return;
          Net.request("start_game", { campaignRounds: Number(rounds.value) });
          dialog.close();
          dialog.remove();
        },
        Net.active && Net.memberId !== Net.snapshot.hostId,
      ),
    );
    document.body.append(dialog);
    dialog.showModal();
  }
  const importFile = document.createElement("input");
  importFile.type = "file";
  importFile.accept = ".json";
  importFile.hidden = true;
  document.body.append(importFile);
  async function upload(save) {
    const text = JSON.stringify(save);
    if (text.length >= 16 * 1024 * 1024) throw Error("战役存档过大");
    await request("campaign_import_begin", { length: text.length });
    for (let offset = 0, sequence = 0; offset < text.length; offset += 8000, sequence++)
      await request("campaign_import_chunk", { sequence, text: text.slice(offset, offset + 8000) });
    command("campaign_import_finish");
  }
  importFile.onchange = async () => {
    try {
      const file = importFile.files[0];
      if (!file) return;
      if (file.size > 16 * 1024 * 1024) throw Error("战役存档过大");
      const save = JSON.parse(await file.text());
      if (save?.format === "ProjectGreed-campaign" && save.name === undefined)
        save.name = file.name.replace(/\.json$/i, "").slice(0, 80);
      await upload(save);
    } catch (error) {
      GameDialog.alert(error.message);
    } finally {
      importFile.value = "";
    }
  };
  const roomImport = button("导入战役", () => importFile.click());
  roomImport.id = "importCampaignRoom";
  roomImport.hidden = true;
  byId("startRoomGame").parentElement.append(roomImport);
  const backup = button("恢复战役备份", async () => {
    const text = localStorage.getItem(storageKey);
    if (!text) return GameDialog.alert("没有自动保存的战役备份");
    if (!Net.active || Net.snapshot?.settings.mode !== "campaign")
      throw Error("请先进入历史战役模式房间");
    await upload(JSON.parse(text));
  });
  backup.id = "restoreCampaignBackup";
  backup.hidden = true;
  byId("startRoomGame").parentElement.append(backup);
  const delegationToggle = button("AI委任", () => {
    command("set_ai_delegate", {
      delegate: !(Net.snapshot?.delegatedSeats || state()?.delegatedSeats)?.includes(Net.seat),
    });
  });
  delegationToggle.id = "campaignDelegationToggle";
  delegationToggle.className = "campaign-delegation-toggle";
  delegationToggle.hidden = true;
  byId("showLog").after(delegationToggle);
  const presentationSpeed = button(
    "",
    () => {
      const previous = MovementTiming.presentationSpeed;
      const speeds = MovementTiming.speeds;
      const speed = speeds[(speeds.indexOf(previous) + 1) % speeds.length];
      MovementTiming.setPresentationSpeed(speed);
      window.dispatchEvent(
        new CustomEvent("presentation-speed-change", { detail: { previous, speed } }),
      );
      refreshBattleControls();
    },
    false,
    true,
  );
  presentationSpeed.id = "battlePresentationSpeed";
  presentationSpeed.hidden = true;
  delegationToggle.after(presentationSpeed);
  const battleSave = button("保存战役", () => command("campaign_export"));
  battleSave.id = "saveCampaignBattle";
  battleSave.hidden = true;
  document.querySelector("#matchRecordsDialog .record-actions").prepend(battleSave);
  function refreshBattleControls(snapshot = Net.snapshot) {
    const inBattle = snapshot?.started && !window.ReplayPlayer?.active;
    const delegated = (snapshot?.delegatedSeats || snapshot?.campaign?.delegatedSeats)?.includes(
      Net.seat,
    );
    delegationToggle.hidden = !inBattle;
    delegationToggle.textContent = I18n.text("AI委任");
    delegationToggle.setAttribute("aria-pressed", String(!!delegated));
    delegationToggle.disabled =
      !Number.isInteger(Net.seat) ||
      !!Net.awaiting ||
      !!snapshot?.returnCountdown ||
      snapshot?.game?.winner !== null;
    presentationSpeed.hidden = !snapshot?.started;
    presentationSpeed.textContent =
      I18n.text("演出速度") + " ×" + MovementTiming.presentationSpeed.toFixed(1);
    battleSave.hidden =
      !snapshot?.campaign || Net.memberId !== snapshot.hostId || !!window.ReplayPlayer?.active;
    battleSave.disabled = !!Net.awaiting;
  }
  window.addEventListener("page-changing", () => {
    resumeForceDetails = false;
    if (forceDetailsDialog.open) forceDetailsDialog.close();
    moveDraft = null;
    panel.hidden = true;
    window.CampaignWorkspace?.close();
    campaignPilots.close();
    if (seatsDialog.open) seatsDialog.close();
    if (saveDialog.open) saveDialog.close();
    if (orderDialog.open) orderDialog.close();
    if (armyDialog.open) armyDialog.close();
    if (intelligenceDialog.open) intelligenceDialog.close();
    if (movementDialog.open) movementDialog.close();
    if (encounterDialog.open) encounterDialog.close();
    setTimeout(() => {
      if (pageView === "campaign") panel.hidden = false;
      refreshBattleControls();
    }, 0);
  });
  window.addEventListener("resize", layout);
  window.addEventListener("language-change", () => {
    refreshBattleControls();
    if (pageView === "campaign" && state()) render();
  });
  function failure(id, message) {
    const pending = replies.get(id);
    if (pending) {
      replies.delete(id);
      pending.reject(Error(message));
    }
  }
  return { open, receive, reply, failure, create, render, preview, refreshBattleControls };
})();
