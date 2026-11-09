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
  document.head.append(style);
  let wasActive = false;
  const format = (source, values) =>
    I18n.text(source.replace(/\{(\w+)\}/g, (_, key) => values[key]));
  const request = (action, data = {}) => Net.request(action, data);
  function receive(snapshot) {
    const s = snapshot.sweep,
      active = !!s && ["sweep_map", "sweep_event", "sweep_resupply"].includes(snapshot.phase);
    panel.hidden = !active;
    byId("gameScene").dataset.sweepMission = String(active);
    if (active && !wasActive)
      panel.querySelector("details").open = !matchMedia("(max-width:700px)").matches;
    wasActive = active;
    if (!active) return;
    const host = snapshot.you?.id === snapshot.hostId;
    byId("sweepSummary").textContent = format(
      "已推进 {depth} 处 · 暂存资金 {money} · 物资 {supplies} · 科技点 {technology} · 获得机体 {units}台",
      {
        depth: s.depth + 1,
        money: s.pending.money,
        supplies: s.pending.supplies,
        technology: s.pending.technology,
        units: Object.values(s.pending.inventory).reduce((a, b) => a + b, 0),
      },
    );
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
      const nodes = s.nodes.filter(
          (n) => n.depth >= Math.max(0, s.depth) && n.depth <= s.depth + 6,
        ),
        start = Math.max(0, s.depth);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 600 650");
      svg.setAttribute("preserveAspectRatio", "none");
      for (const n of nodes)
        for (const next of n.next) {
          const t = nodes.find((t) => t.id === next);
          if (!t) continue;
          const line = document.createElementNS(svg.namespaceURI, "line");
          for (const [k, v] of Object.entries({
            x1: 100 + n.lane * 200,
            y1: 600 - (n.depth - start) * 96,
            x2: 100 + t.lane * 200,
            y2: 600 - (t.depth - start) * 96,
            stroke: "#5e7e91",
            "stroke-width": 2,
          }))
            line.setAttribute(k, v);
          svg.append(line);
        }
      route.append(svg);
      for (const n of nodes) {
        const button = element(
          "button",
          s.selected === n.id ? "selected" : "",
          { battle: "⚔ 战斗", elite: "★ 精英战", rest: "＋ 休息区", event: "？ 随机事件" }[n.type],
        );
        button.dataset.sweepNode = n.id;
        button.style.left = (100 + n.lane * 200) / 6 + "%";
        button.style.top = (600 - (n.depth - start) * 96) / 6.5 + "%";
        button.disabled =
          !host || n.depth !== s.depth + 1 || (s.depth >= 0 && Math.abs(n.lane - s.lane) > 1);
        button.onclick = () => request("sweep_select", { nodeId: n.id });
        route.append(button);
      }
    }
    if (s.event) {
      event.append(element("h3", "", s.event.name), element("p", "", s.event.text));
      if (snapshot.phase === "sweep_event")
        s.event.choices.forEach((text, choice) => {
          const b = element("button", "", text);
          b.disabled = !host;
          b.onclick = () => request("sweep_event", { choice });
          event.append(b);
        });
      else {
        const select = document.createElement("select"),
          search = document.createElement("input");
        search.placeholder = "搜索可补员单位";
        const refresh = () => {
          select.replaceChildren();
          for (const p of ART.prefabs
            .filter(
              (p) =>
                !p.formOnly &&
                Economy.quantity(p.id) > 0 &&
                (p.name + p.id).toLowerCase().includes(search.value.toLowerCase()),
            )
            .sort((a, b) => a.stats.cost - b.stats.cost))
            select.add(new Option(p.name + " · 库存" + Economy.quantity(p.id), p.id));
        };
        search.oninput = refresh;
        refresh();
        const add = element("button", "", "从机库补员");
        add.onclick = () => {
          const id = select.value;
          if (id)
            request("sweep_reinforce", { entry: { unitId: id, kitId: Economy.defaultKit(id) } });
        };
        const done = element("button", "", "完成补员并返回任务地图");
        done.disabled = !host;
        done.onclick = () => request("sweep_resupply_done");
        event.append(search, select, add, done);
      }
    }
    const fleet = byId("sweepFleet");
    fleet.replaceChildren();
    for (const team of s.teams) {
      const article = element("article");
      article.append(
        element(
          "h3",
          "",
          format("{name} · {count}台", { name: team.name, count: team.units.length }),
        ),
      );
      for (const u of team.units) {
        const row = element("p"),
          m = Rules.models[u.model],
          img = element("img");
        img.src = unitIcon(u.model);
        row.append(
          img,
          document.createTextNode(
            `${m?.name || u.unitId} · HP ${u.hp}/${m?.hp} · EN ${u.en}/${m?.en}`,
          ),
        );
        article.append(row);
      }
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
