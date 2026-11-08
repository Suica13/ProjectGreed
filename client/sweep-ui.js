/* Shared mission map; all choices are action intents, never local rewards. */
const SweepUI = (() => {
  const panel = document.createElement("section");
  panel.id = "sweepMission";
  panel.hidden = true;
  panel.innerHTML =
    '<header><h2>合约模式 · 战场扫荡</h2><button id="sweepExtract">撤离战场</button></header><div id="sweepSummary"></div><p id="sweepNotice"></p><div id="sweepRoute"></div><div id="sweepEvent"></div><div id="sweepFleet"></div><footer><button id="sweepConfirm">确认前进</button></footer>';
  document.body.append(panel);
  const style = document.createElement("style");
  style.textContent = `#sweepMission{position:fixed;inset:0;z-index:180;background:#101d29;color:#deebf4;overflow:auto;padding:20px;box-sizing:border-box}#sweepMission[hidden]{display:none}#sweepMission header{display:flex;align-items:center;justify-content:space-between;gap:12px}#sweepExtract{margin-left:auto}#sweepRoute{position:relative;width:min(760px,100%);height:650px;margin:20px auto;background:#142633;border:1px solid #476578}#sweepRoute svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}#sweepRoute button{position:absolute;transform:translate(-50%,-50%);width:100px;min-height:52px;border-radius:20px;background:#234459;border:2px solid #5d7c8b;color:white}#sweepRoute button.selected{border-color:#ffd46c;background:#60522d}#sweepRoute button:disabled{opacity:.4}#sweepMission footer{position:sticky;bottom:0;background:#101d29;padding:12px;display:flex;justify-content:center}#sweepEvent{max-width:800px;margin:20px auto}#sweepEvent button{margin:8px;padding:12px}#sweepFleet{display:flex;flex-wrap:wrap;gap:10px}#sweepFleet article{padding:10px;border:1px solid #486579;max-width:360px}#sweepFleet img{width:40px;height:40px;object-fit:contain}#sweepFleet p{margin:5px 0}@media(max-width:600px){#sweepMission{padding:10px}#sweepMission h2{font-size:18px}#sweepRoute button{width:84px;font-size:12px}}`;
  document.head.append(style);
  let current;
  const format = (source, values) =>
    I18n.text(source.replace(/\{(\w+)\}/g, (_, key) => values[key]));
  const request = (action, data = {}) => Net.request(action, data);
  function receive(snapshot) {
    current = snapshot;
    const s = snapshot.sweep,
      active = !!s && ["sweep_map", "sweep_event", "sweep_resupply"].includes(snapshot.phase);
    panel.hidden = !active;
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
        button.style.top = 600 - (n.depth - start) * 96 + "px";
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
  return { receive };
})();
