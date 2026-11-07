/* Presentation only: strength, capture sites and authoritative reinforcement arrivals. */
const BattlefieldUI = (() => {
  const hud = element("section", "battlefield-status");
  hud.id = "battlefieldStatus";
  hud.hidden = true;
  hud.setAttribute("aria-label", "雇佣兵战争模式战况");
  const topLine = byId("mapWrap").querySelector(".hud-top-line");
  topLine.append(hud);
  const rounds = element("strong", "battlefield-rounds");
  rounds.id = "battlefieldRounds";
  const bars = [0, 1].map((team) => {
    const bar = element("div", "battlefield-strength team-" + team);
    const fill = element("span", "battlefield-strength-fill");
    const text = element("strong", "battlefield-strength-text");
    bar.append(fill, text);
    hud.append(bar);
    return { bar, fill, text };
  });
  hud.prepend(rounds);
  const style = document.createElement("style");
  style.textContent = `
    .battlefield-status{position:relative;z-index:8;grid-column:1/-1;grid-row:2;justify-self:center;display:grid;grid-template-columns:1fr auto 1fr;gap:7px;align-items:center;width:min(560px,100%);box-sizing:border-box;padding:6px 9px;background:#102332ed;border:1px solid #7898aa;border-radius:5px;pointer-events:none;font-size:12px}
    .battlefield-status[hidden]{display:none}
    .battlefield-rounds{grid-column:2;grid-row:1;white-space:nowrap;color:#f0e1ab}
    .battlefield-strength{height:29px;position:relative;overflow:hidden;background:#101920;border:1px solid #518ab1}
    .battlefield-strength.team-0{grid-column:1;grid-row:1}.battlefield-strength.team-1{grid-column:3;grid-row:1;border-color:#bf786d}
    .battlefield-strength-fill{position:absolute;inset:0 auto 0 0;background:#246e9b;width:100%}.team-1 .battlefield-strength-fill{background:#9e5045}
    .battlefield-strength-text{position:relative;display:flex;align-items:center;justify-content:center;height:100%;white-space:nowrap;text-shadow:0 1px 2px #000}
    @media(max-width:760px){.battlefield-status{font-size:11px;padding:4px;gap:4px}.battlefield-strength{height:25px}}
    #battlefieldDeploymentDialog{width:min(620px,calc(100vw - 24px));max-height:80vh;box-sizing:border-box;padding:16px;background:#152633;color:#e3edf4;border:1px solid #739bb7}
    .battlefield-deployment-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}
    .battlefield-reserves{display:grid;gap:6px;overflow-y:auto;max-height:55vh}
    .battlefield-reserve{display:grid;grid-template-columns:52px minmax(0,1fr) 104px;align-items:center;gap:10px;padding:8px;background:#203747}
    .battlefield-reserve img{width:52px;height:52px;object-fit:contain}.battlefield-reserve strong{display:block;overflow-wrap:anywhere}.battlefield-reserve small{display:block;color:#a8c4d8;margin-top:4px}
    .battlefield-reserve button{min-height:38px;width:100%;white-space:normal}
    @media(max-width:480px){.battlefield-reserve{grid-template-columns:40px minmax(0,1fr) 84px;gap:7px;padding:6px;font-size:13px}.battlefield-reserve img{width:40px;height:40px}}
  `;
  document.head.append(style);
  const deploymentDialog = element("dialog", "");
  deploymentDialog.id = "battlefieldDeploymentDialog";
  deploymentDialog.setAttribute("aria-label", "申请部署");
  document.body.append(deploymentDialog);
  let deploymentSiteId = null;
  window.addEventListener("page-changing", () => deploymentDialog.close());
  for (const type of ["keydown", "keyup"]) deploymentDialog.addEventListener(type, event => event.stopPropagation());
  function renderDeployment() {
    if (!deploymentDialog.open) return;
    if (!game.battlefield || pageView !== "game" || game.winner !== null) { deploymentDialog.close(); return; }
    const site = Rules.battlefieldMode.deploymentSites(Rules, game, Net.team()).find(item => item.id === deploymentSiteId);
    const heading = element("div", "battlefield-deployment-heading");
    heading.append(element("h3", "", (site?.name || "部署地点已失守") + " · 申请部署"));
    const close = element("button", "", "关闭");
    close.onclick = () => deploymentDialog.close();
    heading.append(close);
    const description = element("p", "", "阵亡单位维修完成后可申请部署，下一回合空投入场。落点被占满时等待空位。");
    const list = element("div", "battlefield-reserves");
    const reserves = (game.battlefield.reserves || []).filter(item => item.ownerSeat === Net.seat && item.readyRound !== null);
    for (const reserve of reserves) {
      const modelId = reserve.unitId + "__" + reserve.kitId, model = Rules.models[modelId];
      const row = element("div", "battlefield-reserve");
      row.dataset.reserveId = reserve.id;
      const image = element("img", ""); image.src = unitIcon(modelId); image.alt = "";
      const info = element("div", "");
      info.append(element("strong", "", (reserve.formationIndex + 1) + ". " + (model?.name || reserve.unitId)));
      const remaining = Math.max(0, reserve.readyRound - game.round);
      const status = reserve.request ? (reserve.request.arrivalRound > game.round ? "已申请 · 下一回合空投" : "等待可用落点") :
        reserve.stockAvailable === false ? "库存已耗尽" : remaining ? `维修中 · 剩余${remaining}回合` : "维修完成";
      info.append(element("small", "", status));
      const button = element("button", "", "申请部署");
      button.disabled = !site || reserve.stockAvailable === false || !!reserve.request || remaining > 0 || !Net.canAct() || !!Net.awaiting;
      button.onclick = () => {
        button.disabled = true;
        Net.request("battlefield_deploy", { reserveId: reserve.id, siteId: deploymentSiteId });
      };
      row.append(image, info, button); list.append(row);
    }
    if (!reserves.length) list.append(element("p", "", "暂无阵亡单位。"));
    const scroll = deploymentDialog.querySelector(".battlefield-reserves")?.scrollTop || 0;
    deploymentDialog.replaceChildren(heading, description, list);
    list.scrollTop = scroll;
  }
  function click(cell) {
    if (!game.battlefield || !cell || phase !== "idle" || !Net.canAct()) return false;
    const base = Rules.at(game, cell.x, cell.y);
    const site = Rules.battlefieldMode.deploymentSites(Rules, game, Net.team()).find(item =>
      item.id === "base:" + base?.facility?.id || item.id.startsWith("point:") && item.x === cell.x && item.y === cell.y);
    if (!site) return false;
    deploymentSiteId = site.id;
    deploymentDialog.showModal();
    renderDeployment();
    return true;
  }
  let identity = "",
    arrivals = new Map();
  const pointIcon = new Image(), pointHighlight = new Image();
  let pointGlows = [];
  const teamColors = ["#73caf7", "#fb9688"];
  // Build the capture perimeter once; drawing must not rebuild geometry each frame.
  const captureEdges = (() => {
    const radius = Rules.battlefieldMode.captureRadius, area = new Set(), edges = [];
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++)
      if (Math.hypot(dx, dy) <= radius) area.add(dx + "," + dy);
    for (const cell of area) {
      const [dx, dy] = cell.split(",").map(Number);
      for (const [nx, ny, ax, ay, bx, by] of [
        [0, -1, 0, 0, 1, 0], [1, 0, 1, 0, 1, 1],
        [0, 1, 1, 1, 0, 1], [-1, 0, 0, 1, 0, 0],
      ]) if (!area.has((dx + nx) + "," + (dy + ny)))
        edges.push([dx - 0.5 + ax, dy - 0.5 + ay, dx - 0.5 + bx, dy - 0.5 + by]);
    }
    return edges;
  })();
  pointHighlight.onload = () => {
    pointGlows = teamColors.map((color) => {
      const canvas = document.createElement("canvas");
      canvas.width = pointHighlight.naturalWidth;
      canvas.height = pointHighlight.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(pointHighlight, 0, 0);
      ctx.globalCompositeOperation = "source-in";
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return canvas;
    });
  };
  function refresh() {
    renderDeployment();
    const state = game?.battlefield;
    hud.hidden = !state || !Net.started || pageView !== "game";
    topLine.classList.toggle("battlefield-top-line", !hud.hidden);
    if (!state) return;
    const key = Net.snapshot?.matchId || game;
    if (key !== identity) {
      identity = key;
      arrivals.clear();
      const config = Rules.getMap(game.mapId).battlefield;
      pointIcon.src = config.pointIcon || "";
      pointGlows = [];
      pointHighlight.src = config.pointHighlight || "";
    }
    rounds.textContent = state.completed + "/" + state.maxRounds;
    for (const team of [0, 1]) {
      bars[team].fill.style.width = (100 * state.strength[team]) / state.maximum[team] + "%";
      bars[team].text.textContent =
        state.strength[team].toLocaleString() + "/" + state.maximum[team].toLocaleString();
      bars[team].bar.title = "队伍" + (team + 1) + " · " + state.teams[team].faction;
    }
  }
  function dropHeight(unit, now) {
    if (!game.battlefield || unit.airdropRound !== game.round) return 0;
    if (!arrivals.has(unit.id)) arrivals.set(unit.id, now);
    return Math.max(0, 1 - (now - arrivals.get(unit.id)) / 1400) * 5;
  }
  function draw(ctx, ox, oy, tile) {
    if (!game.battlefield) return;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `bold ${Math.max(10, Math.min(15, tile * 0.5))}px system-ui`;
    for (const point of game.battlefield.points) {
      const x = ox + (point.x + 0.5) * tile,
        y = oy + (point.y + 0.5) * tile;
      ctx.strokeStyle = teamColors[point.owner] || "#b8c6cd";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [ax, ay, bx, by] of captureEdges) {
        ctx.moveTo(x + ax * tile, y + ay * tile);
        ctx.lineTo(x + bx * tile, y + by * tile);
      }
      ctx.stroke();
      if (pointIcon.complete && pointIcon.naturalWidth) {
        // Preserve the SL artwork's aspect ratio, including matching light layers.
        const scale = tile * 1.7 / Math.max(pointIcon.naturalWidth, pointIcon.naturalHeight);
        const width = pointIcon.naturalWidth * scale, height = pointIcon.naturalHeight * scale;
        ctx.drawImage(pointIcon, x - width / 2, y - height / 2, width, height);
        const glow = pointGlows[point.owner];
        if (glow) ctx.drawImage(glow, x - glow.width * scale / 2,
          y - glow.height * scale / 2, glow.width * scale, glow.height * scale);
      }
      ctx.fillStyle = "#fff4d4";
      ctx.fillText(point.name, x, y + tile * 1.2);
    }
    ctx.restore();
  }
  return { refresh, draw, dropHeight, click };
})();
window.BattlefieldUI = BattlefieldUI;
