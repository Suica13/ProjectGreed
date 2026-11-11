/* Shared mission map; all choices are action intents, never local rewards. */
const SweepUI = (() => {
  const panel = document.createElement("section");
  panel.id = "sweepMission";
  panel.hidden = true;
  panel.innerHTML =
    '<header><h2>合约模式 · 战场扫荡</h2><button id="sweepExtract">撤离战场</button></header><div id="sweepSummary"></div><p id="sweepNotice"></p><div class="sweep-workspace"><details class="sweep-fleet-panel"><summary>作战单位</summary><div id="sweepFleet"></div></details><div class="sweep-stage"><div id="sweepRoute"></div><div id="sweepEvent"></div></div></div><footer><button id="sweepConfirm" class="primary">确认前进</button></footer>';
  byId("mapWrap").append(panel);
  const style = document.createElement("style");
  style.textContent = `
    #sweepMission{position:absolute;inset:0;z-index:8;background:#101d27;color:var(--text);padding:12px;box-sizing:border-box;display:flex;flex-direction:column;gap:8px;overflow:hidden}
    #sweepMission[hidden]{display:none}#sweepMission header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:8px;border-bottom:1px solid var(--line)}
    #sweepMission h2{font-size:18px;margin:0}#sweepExtract{margin-left:auto;flex:none}#sweepSummary{font-size:13px;color:#c8dce7}#sweepNotice{font-size:12px;color:var(--muted);margin:0}
    #sweepMission .sweep-workspace{display:grid;grid-template-columns:240px minmax(0,1fr);gap:12px;flex:1;min-height:0;overflow:hidden}
    #sweepMission .sweep-fleet-panel{overflow:auto;border:1px solid var(--line);background:#162632;padding:8px;min-width:0}
    #sweepMission .sweep-fleet-panel>summary{cursor:pointer;font-weight:bold;color:#bce4f6;padding:4px}
    #sweepMission .sweep-stage{min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;background:#132532;border:1px solid var(--line)}
    #sweepRoute{position:relative;width:min(860px,100%);height:100%;min-height:380px;margin:auto}
    #sweepRoute svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}#sweepRoute button{position:absolute;transform:translate(-50%,-50%);width:110px;min-height:42px;background:#233e50;border:1px solid #55788e;color:#deedf5}
    #gameScene #sweepRoute button.selected{border-color:#ffd46c;background:#5a4d2c}#gameScene #sweepRoute button:disabled{opacity:1;color:#718997;background:#1b2f3d;border-color:#344e60}#sweepMission footer{flex:none;display:flex;justify-content:flex-end;gap:8px}#sweepMission footer[hidden]{display:none}
    #sweepEvent{max-width:800px;padding:16px;margin:auto}#sweepEvent:empty{display:none}#sweepEvent button{margin:6px;padding:10px}#sweepEvent input,#sweepEvent select{max-width:100%;margin:6px 0}
    #sweepFleet article{padding:6px 0;border-bottom:1px solid var(--line)}#sweepFleet h3{font-size:13px;margin:6px 0}#sweepFleet img{width:40px;height:40px;object-fit:contain;image-rendering:pixelated;flex:none}#sweepFleet p{display:flex;align-items:center;gap:8px;font-size:12px;margin:4px 0}
    #gameScene[data-sweep-mission=true] #mapWrap>:not(#sweepMission){visibility:hidden;pointer-events:none}
    #gameScene[data-sweep-mission=true] :is(#hudRosterPanel,#hudUnitPanel,#hudAttackPlanSummary,#hudToggleRoster,#hudToggleLegend,#hudSelectionSummary,#mapCombatControls,#battlefieldRoundHud,#battlefieldRedeployButton,#campaignDelegationToggle,#battlePresentationTools,.team-marker-controls,#turnBadge){display:none!important}
    #gameScene[data-sweep-mission=true]{--hud-planner:0px!important;--hud-action:0px!important}
    @media(max-width:700px){#sweepMission{padding:8px;gap:6px}#sweepMission h2{font-size:15px}#sweepMission header{gap:8px}#sweepSummary,#sweepNotice{font-size:11px}#sweepMission .sweep-workspace{display:flex;flex-direction:column;gap:6px}#sweepMission .sweep-stage{order:0;flex:1}#sweepMission .sweep-fleet-panel{order:1;flex:none;max-height:30%;padding:4px}#sweepRoute{min-height:340px}#sweepRoute button{width:86px;min-height:38px;font-size:12px}#sweepEvent{padding:8px}}
  `;
  style.textContent += `
    #sweepFleet article{border:1px solid var(--line);border-radius:5px;padding:8px;margin:6px 0;background:#1c3040}
    #sweepInfo{width:min(460px,88vw);max-height:76vh;overflow:auto;color:var(--text);background:#162632;border:1px solid var(--line);border-radius:8px;padding:12px}
    #sweepInfo::backdrop{background:#071019aa}#sweepInfo header{display:flex;align-items:center;justify-content:space-between;gap:12px}
    #sweepInfo h3{margin:0}#sweepInfo p{display:flex;align-items:center;gap:10px;padding:8px 0;margin:0;border-bottom:1px solid var(--line)}
    #sweepInfo img{width:42px;height:42px;object-fit:contain;image-rendering:pixelated}
  `;
  document.head.append(style);
  const info = document.createElement("dialog");
  info.id = "sweepInfo";
  info.setAttribute("aria-labelledby", "sweepInfoTitle");
  info.innerHTML =
    '<header><h3 id="sweepInfoTitle"></h3><button type="button">关闭</button></header><div class="sweep-info-list"></div>';
  document.body.append(info);
  const list = info.lastElementChild;
  let mission, selectedTeam;
  info.querySelector("button").onclick = () => info.close();
  window.addEventListener("page-changing", () => {
    if (info.open) info.close();
  });
  function showInfo(teamId) {
    selectedTeam = teamId;
    renderInfo();
    if (!info.open) info.showModal();
  }
  const lootButton = byId("sweepLootButton"), lootButtonHome = lootButton.parentElement;
  lootButton.onclick = () => showInfo(null);
  function infoRow(modelId, text) {
    const row = element("p");
    if (Rules.models[modelId]) {
      const img = element("img");
      img.alt = "";
      img.src = unitIcon(modelId);
      row.append(img);
    }
    row.append(document.createTextNode(text));
    list.append(row);
  }
  function renderInfo() {
    list.replaceChildren();
    if (selectedTeam === null) {
      byId("sweepInfoTitle").textContent = I18n.text("本次收获单位");
      for (const [id, count] of Object.entries(mission.pending.inventory)) {
        const prefab = ART.prefabs.find((p) => p.id === id);
        infoRow(
          id + "__" + prefab?.weaponKits?.[0]?.id,
          I18n.text(prefab?.name || id) + " × " + count,
        );
      }
      if (!list.childElementCount) list.append(element("p", "", "本次扫荡尚未获得机体"));
      return;
    }
    const team = mission.teams.find((team) => team.id === selectedTeam);
    byId("sweepInfoTitle").textContent = team?.name || "PMC";
    for (const u of team?.units || []) {
      const m = Rules.models[u.model];
      const parts = Object.keys(u.brokenParts || {}).filter((k) => u.brokenParts[k]);
      const details = [
        I18n.text(m?.name || u.unitId),
        `HP ${u.hp}/${m?.hp}`,
        `EN ${u.en}/${m?.en}`,
      ];
      if (m?.shield?.hp && u.shield != null)
        details.push(I18n.text("盾牌HP") + ` ${u.shield}/${m.shield.hp}`);
      if (parts.length)
        details.push(parts.map((k) => I18n.text(Rules.partNames[k] || k)).join(" / "));
      infoRow(u.model, details.join(" · "));
    }
    if (!list.childElementCount) list.append(element("p", "", "没有剩余单位"));
  }
  let wasActive = false, routePosition = null;
  const format = (source, values) =>
    I18n.text(source.replace(/\{(\w+)\}/g, (_, key) => values[key]));
  const request = (action, data = {}) => Net.request(action, data);
  function scene(index, className = "") {
    const image = element("div", "sweep-scene " + className);
    image.style.backgroundPosition =
      ((index % 4) * 100) / 3 + "% " + (Math.floor(index / 4) * 100) / 3 + "%";
    image.setAttribute("aria-hidden", "true");
    return image;
  }
  function receive(snapshot) {
    const s = snapshot.sweep,
      active = !!s && ["sweep_map", "sweep_event", "sweep_resupply"].includes(snapshot.phase);
    panel.hidden = !active;
    byId("gameScene").dataset.sweepMission = String(active);
    if (active && !wasActive)
      panel.querySelector("details").open = !matchMedia("(max-width:700px)").matches;
    mission = s;
    lootButton.hidden = !s || s.ended;
    if (!active && lootButton.parentElement !== lootButtonHome) lootButtonHome.prepend(lootButton);
    if (info.open) {
      if (!s || s.ended || (selectedTeam !== null && !active)) info.close();
      else renderInfo();
    }
    wasActive = active;
    if (!active || snapshot.phase !== "sweep_map") routePosition = null;
    if (snapshot.phase !== "sweep_resupply") SweepRestock.reset();
    if (!active) return;
    const host = snapshot.you?.id === snapshot.hostId;
    ProductionUI.resources(byId("sweepSummary"), s.pending, { technology: true });
    const progress = element("span", "sweep-progress");
    progress.append(
      element(
        "span",
        "",
        "节点 " +
          (s.depth + 1) +
          " · 获得机体 " +
          Object.values(s.pending.inventory).reduce((a, b) => a + b, 0) +
          "台",
      ),
      lootButton,
    );
    byId("sweepSummary").append(progress);
    byId("sweepNotice").textContent =
      I18n.text("本局收益撤离时发放；全灭保留机体库存，资金、物资和科技点减半。") +
      (host ? "" : " " + I18n.text("路线由房主选择并确认。"));
    byId("sweepExtract").disabled = !host || snapshot.phase !== "sweep_map" || s.depth < 0;
    byId("sweepExtract").onclick = async () => {
      if (await GameDialog.confirm("全队将结束本次扫荡并结算暂存收益，确定撤离？"))
        request("sweep_extract");
    };
    const route = byId("sweepRoute"),
      event = byId("sweepEvent");
    route.replaceChildren();
    event.replaceChildren();
    route.hidden = snapshot.phase !== "sweep_map";
    const confirm = byId("sweepConfirm");
    confirm.hidden = snapshot.phase !== "sweep_map";
    confirm.parentElement.hidden = confirm.hidden;
    confirm.disabled = !host || !s.selected;
    confirm.onclick = () => request("sweep_confirm");
    if (!route.hidden) {
      const start = Math.max(0, s.depth);
      const nextBoss = Math.min(...s.nodes.filter((n) => n.type === "boss" && n.depth > s.depth).map((n) => n.depth));
      const end = Number.isFinite(nextBoss) ? nextBoss : start + 4;
      const nodes = s.nodes.filter((n) => n.depth >= start && n.depth <= end);
      // Keep a readable fixed pitch and reveal only the route to the next boss.
      const rowPitch = 150, routeHeight = (end - start) * rowPitch + 140, bottom = routeHeight - 70;
      route.style.height = routeHeight + "px";
      route.style.minHeight = routeHeight + "px";
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 600 " + routeHeight);
      svg.setAttribute("preserveAspectRatio", "none");
      const defs = document.createElementNS(svg.namespaceURI, "defs");
      const marker = document.createElementNS(svg.namespaceURI, "marker");
      for (const [key, value] of Object.entries({ id: "sweepRouteArrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 9, markerHeight: 9, markerUnits: "userSpaceOnUse", orient: "auto" })) marker.setAttribute(key, value);
      const head = document.createElementNS(svg.namespaceURI, "path");
      head.setAttribute("d", "M 0 0 L 10 5 L 0 10 Z");
      head.setAttribute("fill", "#8ab4cc");
      marker.append(head); defs.append(marker); svg.append(defs);
      for (const n of nodes)
        for (const next of n.next) {
          const t = nodes.find((t) => t.id === next);
          if (!t) continue;
          const line = document.createElementNS(svg.namespaceURI, "line");
          for (const [k, v] of Object.entries({
            x1: 100 + n.lane * 200,
            y1: bottom - (n.depth - start) * rowPitch - 43,
            x2: 100 + t.lane * 200,
            y2: bottom - (t.depth - start) * rowPitch + 43,
            stroke: "#8ab4cc",
            "stroke-width": 3.5,
            "marker-end": "url(#sweepRouteArrow)",
          }))
            line.setAttribute(k, v);
          svg.append(line);
        }
      route.append(svg);
      for (const n of nodes) {
        const button = element(
          "button",
          s.selected === n.id ? "selected" : "",
          { battle: "战斗", elite: "精英战", boss: "BOSS战", rest: "休息区", event: "随机事件" }[
            n.type
          ],
        );
        const label = button.textContent;
        const slot = { battle: 0, elite: 1, boss: 2, rest: 3, event: 8 }[n.type];
        button.classList.add("sweep-node");
        button.replaceChildren(
          scene(snapshot.settings.sweepEnvironment === "space" && slot < 4 ? slot + 12 : slot),
          element("strong", "", n.depth + 1 + " · " + label),
        );
        button.setAttribute("aria-label", n.depth + 1 + " · " + label);
        button.dataset.sweepNode = n.id;
        button.style.left = (100 + n.lane * 200) / 6 + "%";
        button.style.top = bottom - (n.depth - start) * rowPitch + "px";
        button.disabled = !host || !s.reachable.includes(n.id);
        button.onclick = () => request("sweep_select", { nodeId: n.id });
        route.append(button);
      }
      const position = snapshot.matchId + ":" + s.depth;
      if (routePosition !== position) {
        routePosition = position;
        // The game scene becomes visible after receive(), so scroll after that layout change.
        requestAnimationFrame(() => {
          if (!route.hidden && routePosition === position)
            route.parentElement.scrollTop = route.parentElement.scrollHeight;
        });
      }
    }
    if (s.event) {
      const illustration =
        s.event.id === "rest" ? 3 : 4 + SweepMode.events.findIndex((e) => e.id === s.event.id);
      if (snapshot.phase !== "sweep_resupply")
        event.append(scene(illustration, "sweep-event-scene"));
      event.append(element("h3", "", s.event.name), element("p", "", s.event.text));
      if (snapshot.phase === "sweep_event")
        s.event.choices.forEach((text, choice) => {
          const b = element("button", "", text);
          b.disabled = !host;
          b.onclick = () => request("sweep_event", { choice });
          event.append(b);
        });
      else {
        SweepRestock.render(event, snapshot);
      }
    }
    const fleet = byId("sweepFleet");
    fleet.replaceChildren();
    for (const team of s.teams) {
      const article = element("article");
      const cost = team.units.reduce(
        (sum, u) => sum + (Rules.models[u.unitId + "__" + u.kitId]?.cost || 0),
        0,
      );
      const detail = element("button", "", "详情");
      detail.setAttribute("aria-haspopup", "dialog");
      detail.onclick = () => showInfo(team.id);
      article.append(
        element("h3", "", team.name),
        element(
          "p",
          "",
          format("剩余 {count} 台 · 编组 COST {cost}", { count: team.units.length, cost }),
        ),
        detail,
      );
      fleet.append(article);
    }
  }
  return {
    receive,
    get active() {
      return wasActive;
    },
  };
})();
