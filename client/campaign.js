/* Strategic view uses room snapshots only. Personal formations, pilots and economy are never read. */
window.CampaignUI = (() => {
  const panel = element("section", "campaign-screen");
  panel.id = "campaignScreen";
  panel.hidden = true;
  document.body.append(panel);
  let selectedRegion = "jaburo",
    tab = "units",
    zoom = 1,
    lastRevision = -1;
  let autosaved = "",
    autosaveTimer = null;
  const selectedUnits = new Set();
  const replies = new Map();
  const storageKey = "projectgreed.campaign.backup.v1";
  const node = (tag, text = "", css = "") => element(tag, css, text);
  function button(text, action, disabled = false) {
    const result = node("button", text);
    result.type = "button";
    result.disabled = disabled || !!Net.awaiting;
    result.onclick = () =>
      Promise.resolve()
        .then(action)
        .catch((error) => GameDialog.alert(error.message));
    return result;
  }
  function state() {
    return Net.snapshot?.campaign;
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
    link.download = "ProjectGreed-campaign-turn-" + save.turn + ".json";
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
  function layout() {
    panel.style.top = "0px";
    panel.style.left = "0px";
  }
  function open(nextTab = tab) {
    if (!state()) return;
    const workspace = ["production", "research"].includes(nextTab) ? nextTab : null;
    tab = workspace ? "units" : nextTab;
    setPageView("campaign");
    panel.hidden = false;
    layout();
    render();
    if (workspace) CampaignWorkspace.open(workspace, selectedRegion);
  }
  function receive(snapshot) {
    if (!snapshot.campaign) return;
    if (!snapshot.started) {
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
      ctx.strokeText(I18n.text(region.name), x, y + 17);
      ctx.fillStyle = "#fff";
      ctx.fillText(I18n.text(region.name), x, y + 17);
    }
    canvas.setAttribute("aria-label", CAMPAIGN_WORLD.name);
  }
  function world(state) {
    const wrap = node("div", "", "campaign-world");
    wrap.dataset.language = I18n.language;
    const tools = node("div", "", "campaign-map-tools");
    tools.append(
      node("span", "地球战区 · 蓝：联邦 / 红：吉翁 / 黄：交战"),
      button("−", () => {
        zoom = Math.max(1, zoom - 0.25);
        render();
      }),
      button("＋", () => {
        zoom = Math.min(2.5, zoom + 0.25);
        render();
      }),
    );
    const scroll = node("div", "", "campaign-map-scroll");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 1200 560");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "地球战略区域地图");
    svg.style.width = zoom * 100 + "%";
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
      const width = Math.min(
          190,
          Math.max(42, measure.measureText(I18n.text(region.name)).width + 18),
        ),
        height = 33;
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
            cy = Math.max(21, Math.min(535, y + dy + my));
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
      label.append(
        shape("rect", {
          x: x - width / 2,
          y: y - 14,
          width,
          height,
          rx: 3,
          fill: "#111e2c",
          stroke: "#5c7487",
          "stroke-width": 0.7,
          opacity: 0.94,
          class: "campaign-region-label-box",
        }),
      );
      label.append(
        shape(
          "text",
          {
            x,
            y: y - 1,
            "text-anchor": "middle",
            fill: region.factory ? "#ffdf9e" : "#edf5fc",
            "font-size": 12,
            "font-weight": region.factory ? 700 : 500,
          },
          I18n.text(region.name),
        ),
      );
      label.append(
        shape(
          "text",
          {
            x,
            y: y + 13,
            "text-anchor": "middle",
            fill: "#b7d0e2",
            "font-size": 10,
            class: "campaign-region-count",
          },
          "",
        ),
      );
      const select = () => {
        const current = Net.snapshot.campaign;
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
    wrap.append(tools, scroll);
    return wrap;
  }
  function refreshWorld(s) {
    const svg = panel.querySelector(".campaign-map-scroll svg");
    if (!svg) return;
    svg.style.width = zoom * 100 + "%";
    for (const region of CAMPAIGN_WORLD.regions) {
      const group = svg.querySelector(`[data-region="${region.id}"]`),
        surface = group.querySelector(".campaign-region-surface"),
        label = svg.querySelector(`[data-region-label="${region.id}"]`);
      const units = s.units
        .filter((unit) => !unit.destroyed && unit.region === region.id)
        .sort(
          (a, b) =>
            UnitModels[a.unitId + "__" + a.kitId].cost -
              UnitModels[b.unitId + "__" + b.kitId].cost ||
            a.id.localeCompare(b.id, undefined, { numeric: true }),
        );
      const contested =
        s.phase === "encounters" && new Set(units.map((unit) => unit.team)).size > 1;
      const owner = s.regions.find((item) => item.id === region.id)?.owner ?? region.owner;
      group.dataset.contested = String(contested);
      surface.setAttribute(
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
      surface.setAttribute("fill-opacity", region.kind === "sea" ? 0.7 : 1);
      surface.setAttribute(
        "stroke",
        selectedRegion === region.id ? "#e7f7ff" : contested ? "#ffcf61" : "#a0b0ba",
      );
      surface.setAttribute(
        "stroke-width",
        selectedRegion === region.id ? 2 : region.kind === "sea" ? 1.2 : 0.7,
      );
      surface.setAttribute("stroke-dasharray", region.kind === "sea" ? "4 4" : "none");
      label.querySelector(".campaign-region-count").textContent =
        units.length + I18n.text(" 台") + (contested ? I18n.text(" · 交战") : "");
      label
        .querySelector(".campaign-region-label-box")
        .setAttribute(
          "stroke",
          contested
            ? "#ffcf61"
            : selectedRegion === region.id
              ? "#bce7ff"
              : owner === 0
                ? "#719cb6"
                : "#b87c84",
        );
      label
        .querySelector(".campaign-region-label-box")
        .setAttribute("stroke-width", selectedRegion === region.id ? 1.8 : 0.7);
    }
    for (const route of svg.querySelectorAll("[data-route-from]")) {
      const active = [route.dataset.routeFrom, route.dataset.routeTo].includes(selectedRegion);
      route.setAttribute("opacity", active ? 0.85 : 0.1);
      route.setAttribute("stroke-width", active ? 1.8 : 1);
    }
    for (const button of panel.querySelectorAll(".campaign-map-tools button"))
      button.disabled = !!Net.awaiting;
  }
  const encounterDialog = node("dialog", "", "campaign-encounter-dialog");
  encounterDialog.id = "campaignEncounterDialog";
  document.body.append(encounterDialog);
  let encounterRegion = null;
  encounterDialog.addEventListener("cancel", (event) => event.preventDefault());
  function openEncounter(id) {
    encounterRegion = state()?.preparation?.region || id;
    renderEncounter();
    if (!encounterDialog.open) encounterDialog.showModal();
  }
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
      title = node("h2", region.name + " · " + I18n.text("交战状态"));
    title.id = "campaignEncounterTitle";
    encounterDialog.setAttribute("aria-labelledby", title.id);
    header.append(title);
    const body = node("div", "", "campaign-encounter-body");
    const teams = node("div", "", "campaign-encounter-teams");
    for (const team of [0, 1]) {
      const army = s.units.filter((unit) => unit.region === region.id && unit.team === team),
        alive = army.filter((unit) => !unit.destroyed);
      const section = node("details", "", "campaign-encounter-team");
      section.dataset.team = team;
      section.open = folds[team] ?? true;
      section.append(
        node(
          "summary",
          (team === 0 ? I18n.text("地球联邦军") : I18n.text("吉翁公国军")) +
            ` · ${alive.length} 台`,
        ),
      );
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
      for (const unit of army) {
        const m = UnitModels[unit.unitId + "__" + unit.kitId],
          row = node("article", "", "campaign-encounter-unit");
        row.dataset.destroyed = unit.destroyed;
        const image = node("img");
        image.src = unitIcon(unit.unitId + "__" + unit.kitId);
        image.alt = "";
        image.loading = "lazy";
        const copy = node("div", "", "campaign-encounter-unit-copy");
        copy.append(
          node("strong", m.name),
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
        row.append(image, copy, vitals);
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
    for (const map of Object.values(ART.maps).filter(
      (map) =>
        map.environment !== "space" &&
        map.spawns.length === Rules.getMap(Net.snapshot.settings.mapId).spawns.length &&
        (!map.supportedModes || map.supportedModes.includes("regular")),
    ))
      maps.append(new Option(map.name, map.id));
    if (encounter?.mapId) maps.value = encounter.mapId;
    else if (
      [...maps.options].some(
        (option) => option.value === (previousMap || Net.snapshot.settings.mapId),
      )
    )
      maps.value = previousMap || Net.snapshot.settings.mapId;
    const preparation = s.preparation;
    if (preparation?.mapId) maps.value = preparation.mapId;
    maps.disabled = !!encounter?.hasBattle || !!preparation?.mapId;
    const mapLabel = node("label", "局地战地图", "campaign-encounter-map");
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
      markers.append(marker);
    }
    const footer = node("footer", "", "campaign-encounter-footer");
    const actions = node("div", "", "campaign-encounter-actions");
    for (const [delegate, label] of [
      [true, "AI委任"],
      [false, "手动指挥"],
    ]) {
      const choice = button(label, () => enter(delegate), !canEnter);
      choice.setAttribute("aria-pressed", String(!!player?.ready && player.delegate === delegate));
      actions.append(choice);
    }
    footer.append(
      markers,
      node("small", canEnter ? "所有参战玩家准备后开始局地战" : "等待参战玩家准备"),
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
  document.body.append(orderDialog);
  function chooseOrder(kind, ids, region) {
    const s = state(),
      team = Rules.seatTeam(Net.seat);
    const header = node("header", "", "campaign-order-header");
    const title = node("h3", kind === "move" ? "调动部队" : "转交控制权");
    title.id = "campaignOrderTitle";
    orderDialog.setAttribute("aria-labelledby", title.id);
    header.append(
      title,
      button("关闭", () => orderDialog.close()),
    );
    const targets = node("div", "", "campaign-order-targets");
    if (kind === "move")
      for (const id of region.links) {
        const target = CAMPAIGN_WORLD.regions.find((item) => item.id === id);
        const owner = s.regions.find((item) => item.id === id).owner;
        const forces = s.units.filter((unit) => !unit.destroyed && unit.region === id);
        const choice = button("", () => {
          command("campaign_move", { ids, region: id });
          orderDialog.close();
        });
        choice.dataset.destination = id;
        choice.append(
          node("strong", target.name),
          node(
            "small",
            (owner === 0 ? "地球联邦军" : "吉翁公国军") + " · " + forces.length + I18n.text("台"),
          ),
        );
        targets.append(choice);
      }
    if (kind === "transfer")
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
    const m = UnitModels[unit.unitId + "__" + unit.kitId],
      prefab = ART.prefabs.find((item) => item.id === unit.unitId);
    const editable =
      s.phase === "strategy" &&
      s.winner === null &&
      !unit.moveTo &&
      !s.transfers.some((item) => item.ids.includes(unit.id)) &&
      CampaignRules.controls(s, Net.snapshot.members, Net.seat, unit);
    const header = node("header", "", "campaign-order-header");
    header.append(
      node("h3", m.name),
      button("关闭", () => armyDialog.close()),
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
        ["行动点", m.actionPoints],
        ["移动", m.move],
        ["视野", m.sensors.sight],
        ["侦察", m.sensors.radar],
      ]) {
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
        ProductionUI.resources(price, quote);
        row.append(price);
        row.append(
          button(
            "确认换装",
            () => command("campaign_equip", { armyId: unit.id, kitId }),
            !editable,
          ),
        );
      } else row.append(node("small", "该套件暂不可换装"));
    }
    parent.append(row);
  }
  function regionForces(s, region, locked) {
    const root = node("section", "", "campaign-forces");
    const units = s.units
      .filter((unit) => !unit.destroyed && unit.region === region.id)
      .sort(
        (a, b) =>
          UnitModels[a.unitId + "__" + a.kitId].cost - UnitModels[b.unitId + "__" + b.kitId].cost ||
          a.id.localeCompare(b.id, undefined, { numeric: true }),
      );
    const controllable = units.filter(
      (unit) =>
        !locked &&
        !s.transfers.some((transfer) => transfer.ids.includes(unit.id)) &&
        CampaignRules.controls(s, Net.snapshot.members, Net.seat, unit),
    );
    for (const id of selectedUnits)
      if (!controllable.some((unit) => unit.id === id)) selectedUnits.delete(id);
    const selected = controllable.filter((unit) => selectedUnits.has(unit.id));
    const toolbar = node("div", "", "campaign-selection-toolbar");
    const selection = node("div", "", "campaign-selection-summary");
    selection.append(
      node(
        "strong",
        selected.length ? `已选 ${selected.length} 台` : `区域部队 ${units.length} 台`,
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
          !selected.length,
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
      const m = UnitModels[unit.unitId + "__" + unit.kitId],
        player = Net.snapshot.members.find((member) => member.seat === unit.ownerSeat);
      const prefab = ART.prefabs.find((item) => item.id === unit.unitId),
        kit = prefab?.weaponKits.find((item) => item.id === unit.kitId);
      const row = node("article", "", "campaign-force-card");
      row.dataset.unitId = unit.id;
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
      const copy = node("div", "", "campaign-force-copy");
      copy.append(
        node("strong", m?.name || unit.unitId),
        node("small", kit ? I18n.localized(kit) : unit.kitId),
      );
      const owner = node("small", player?.name || "无人控制", "campaign-force-owner");
      owner.setAttribute("data-i18n-ignore", "");
      copy.append(owner);
      const status = node("span", "", "campaign-force-status");
      const pending = s.transfers.find((transfer) => transfer.ids.includes(unit.id));
      status.append(
        node(
          "small",
          pending
            ? "等待接收"
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
      operations.append(button("预览 / 装备 / 技能", () => openArmy(unit.id)));
      row.append(input, portrait, copy, vitals, operations);
      list.append(row);
    }
    if (!units.length) list.append(node("p", "该区域没有部队", "campaign-empty"));
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
    detail.append(
      node("h3", region.name),
      node(
        "p",
        (owner === 0 ? "地球联邦军" : "吉翁公国军") +
          (region.factory ? " · 生产据点" : " · 普通区域"),
      ),
    );
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
      button("生产单位", () => CampaignWorkspace.open("production", region.id)),
      button("科技开发", () => CampaignWorkspace.open("research", region.id)),
    );
    detail.append(actions, tabs);
    const locked = s.phase !== "strategy" || Net.seat === null || s.winner !== null;
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
      for (const order of s.orders.filter((order) => order.team === team)) {
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
  function render() {
    const s = state();
    if (!s) return;
    const scroll = [".campaign-detail", ".campaign-map-scroll", ".campaign-force-list"].map(
      (selector) => {
        const item = panel.querySelector(selector);
        return [selector, item?.scrollLeft || 0, item?.scrollTop || 0];
      },
    );
    if (s.phase !== "strategy" && orderDialog.open) orderDialog.close();
    lastRevision = Net.snapshot.revision;
    const header = node("header", "", "campaign-header");
    const team = Net.seat === null ? 0 : Rules.seatTeam(Net.seat),
      pool = s.teams[team];
    header.append(
      node("h2", "战略模式"),
      node("strong", `第${s.turn}大回合 · ${s.phase === "strategy" ? "规划阶段" : "战斗阶段"}`),
    );
    const resources = node("span", "", "resource-balance campaign-header-resources");
    ProductionUI.resources(resources, pool);
    header.append(resources, node("span", I18n.text("科技 ") + formatNumber(pool.technology)));
    const humans = Net.snapshot.members.filter((member) => member.seat !== null && !member.bot);
    header.append(
      node(
        "small",
        (s.phase === "strategy"
          ? `已结束指令 ${s.ready.length}/${humans.length}`
          : I18n.text("待处理战场 ") +
            s.encounters.filter(
              (item) => item.turn < s.turn && CampaignRules.disputed(s, item.region),
            ).length) + (s.commanders.includes(Net.seat) ? " · 总指挥官" : ""),
      ),
    );
    if (Net.memberId === Net.snapshot.hostId)
      header.append(
        button("导出战役", () => command("campaign_export")),
        button("导入战役", () => importFile.click()),
      );
    header.append(
      button(
        s.ready.includes(Net.seat) ? "撤销结束回合" : "结束战略回合",
        () => command("campaign_ready", { ready: !s.ready.includes(Net.seat) }),
        s.phase !== "strategy" || Net.seat === null || s.winner !== null,
      ),
    );
    header.append(
      button("设置", () => byId("shellSettings").click()),
      button("离开房间", () => requestMenu()),
    );
    const existing = panel.querySelector(".campaign-body");
    if (existing) {
      panel.querySelector(".campaign-header").replaceWith(header);
      const map = existing.querySelector(".campaign-world");
      if (map.dataset.language !== I18n.language) map.replaceWith(world(s));
      existing.querySelector(".campaign-detail").replaceWith(details(s));
      refreshWorld(s);
    } else {
      const body = node("div", "", "campaign-body");
      body.append(world(s), details(s));
      panel.append(header, body);
      refreshWorld(s);
    }
    panel.querySelector(".campaign-status")?.remove();
    panel.querySelector(".campaign-victory")?.remove();
    if (s.history.length) panel.append(node("small", s.history.at(-1), "campaign-status"));
    if (s.winner !== null)
      panel.append(
        node(
          "p",
          (s.winner === 0 ? "地球联邦军" : "吉翁公国军") + "完成地球统一，战役结束。",
          "campaign-victory",
        ),
      );
    if (s.preparation && !Net.started) {
      if (encounterRegion !== s.preparation.region || !encounterDialog.open)
        openEncounter(s.preparation.region);
      else renderEncounter();
    } else if (encounterDialog.open) encounterDialog.close();
    if (armyDialog.open) renderArmy();
    layout();
    for (const [selector, x, y] of scroll) {
      const item = panel.querySelector(selector);
      if (item) {
        item.scrollLeft = x;
        item.scrollTop = y;
      }
    }
    window.CampaignWorkspace?.refresh();
  }
  async function create() {
    if (!assetsReady) return GameDialog.alert("请等待单位数据加载完成");
    if (state()) return open();
    if (!Net.active || Net.snapshot?.settings.mode !== "campaign")
      return GameDialog.alert("请先创建或加入战略模式房间");
    const dialog = document.createElement("dialog");
    dialog.className = "campaign-setup";
    const rounds = document.createElement("input");
    rounds.type = "number";
    rounds.min = 1;
    rounds.max = 10;
    rounds.value = 10;
    rounds.id = "campaignRounds";
    const label = node("label", "局地战持续回合（双方各行动一次）");
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
      await upload(JSON.parse(await file.text()));
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
      throw Error("请先进入战略模式房间");
    await upload(JSON.parse(text));
  });
  backup.id = "restoreCampaignBackup";
  backup.hidden = true;
  byId("startRoomGame").parentElement.append(backup);
  const delegationBadge = node("div", "AI委任中（本阶段）", "campaign-delegation-badge");
  document.body.append(delegationBadge);
  const battleSave = button("保存战役", () => command("campaign_export"));
  battleSave.id = "saveCampaignBattle";
  battleSave.className = "campaign-battle-save";
  battleSave.hidden = true;
  document.body.append(battleSave);
  window.addEventListener("page-changing", () => {
    panel.hidden = true;
    window.CampaignWorkspace?.close();
    if (orderDialog.open) orderDialog.close();
    if (armyDialog.open) armyDialog.close();
    if (encounterDialog.open) encounterDialog.close();
    setTimeout(() => {
      if (pageView === "campaign") panel.hidden = false;
      battleSave.hidden = pageView !== "game" || !state() || Net.memberId !== Net.snapshot?.hostId;
    }, 0);
  });
  window.addEventListener("resize", layout);
  window.addEventListener("language-change", () => {
    if (pageView === "campaign" && state()) render();
  });
  function failure(id, message) {
    const pending = replies.get(id);
    if (pending) {
      replies.delete(id);
      pending.reject(Error(message));
    }
  }
  return { open, receive, reply, failure, create, render, preview };
})();
