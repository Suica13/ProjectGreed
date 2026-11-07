/* Presentation only: strength, capture sites and authoritative reinforcement arrivals. */
const BattlefieldUI = (() => {
  const hud = element("section", "battlefield-status");
  hud.id = "battlefieldStatus";
  hud.hidden = true;
  hud.setAttribute("aria-label", "战地模式战况");
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
  `;
  document.head.append(style);
  let identity = "",
    arrivals = new Map();
  const pointIcon = new Image(), pointHighlight = new Image();
  let pointGlows = [];
  pointHighlight.onload = () => {
    pointGlows = ["#73caf7", "#fb9688"].map((color) => {
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
      if (pointIcon.complete && pointIcon.naturalWidth) {
        // Preserve the SL artwork's aspect ratio, including matching light layers.
        const scale = tile * 2 / Math.max(pointIcon.naturalWidth, pointIcon.naturalHeight);
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
  function drawDrops(ctx, poses, now, tile) {
    if (!game.battlefield) return;
    ctx.save();
    for (const { u, pos } of poses) {
      if (!dropHeight(u, now)) continue;
      const size = Math.max(10, tile * 0.6),
        top = pos.y - size * 1.4;
      ctx.strokeStyle = "#e1e9ed";
      ctx.fillStyle = "#b5c7d6dd";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pos.x, top, size, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      for (const side of [-1, 0, 1]) {
        ctx.beginPath();
        ctx.moveTo(pos.x + side * size, top);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  return { refresh, draw, dropHeight, drawDrops };
})();
window.BattlefieldUI = BattlefieldUI;
