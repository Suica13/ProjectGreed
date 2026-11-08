/* Marker coordinates are validated by the server and travel only on the team channel. */
window.TeamMarkers = (() => {
  const kinds = {
    attack: ["进攻", "#ef866e", "⚔"],
    defend: ["防守", "#72baff", "◇"],
    retreat: ["撤退", "#ecc275", "↩"],
    move: ["移动", "#83d9b7", "➜"],
  };
  const panel = document.createElement("div");
  panel.className = "team-marker-controls";
  const toggle = element("button", "", "标记"),
    choices = element("div", "team-marker-choices");
  choices.hidden = true;
  let armed = null,
    currentMatch = null,
    marks = [];
  toggle.type = "button";
  toggle.onclick = () => {
    choices.hidden = !choices.hidden;
    if (choices.hidden) arm(null);
  };
  function arm(kind) {
    armed = kind;
    toggle.textContent = kind ? kinds[kind][0] + " · 选择地块" : "标记";
    for (const button of choices.children)
      button.setAttribute("aria-pressed", String(button.dataset.kind === kind));
  }
  for (const [kind, [label]] of Object.entries(kinds)) {
    const button = element("button", "", label);
    button.type = "button";
    button.dataset.kind = kind;
    button.onclick = () => arm(armed === kind ? null : kind);
    choices.append(button);
  }
  panel.append(toggle, choices);
  byId("mapZoomIn").parentElement.append(panel);
  function receive(message) {
    const m = message?.marker;
    if (
      !m ||
      m.matchId !== currentMatch ||
      !kinds[m.kind] ||
      Date.now() - message.at > 15000 ||
      marks.some((old) => old.id === message.id)
    )
      return;
    marks.push({
      ...m,
      id: message.id,
      name: message.name,
      until: performance.now() + Math.max(0, 15000 - (Date.now() - message.at)),
    });
    marks = marks.slice(-8);
  }
  function snapshot(s) {
    if (s.matchId !== currentMatch) {
      currentMatch = s.matchId;
      marks = [];
      arm(null);
    }
    panel.hidden = !s.started || s.you?.seat === null || !!window.ReplayPlayer?.active;
    for (const message of s.chat || []) receive(message);
  }
  function click(cell) {
    if (!armed) return false;
    if (!cell || !Net.snapshot?.started) return true;
    const kind = armed,
      channel = ChatChannels.teamChannel(Net.seat);
    if (channel)
      Net.sendChat(kinds[kind][0] + " " + Rules.columnLabel(cell.x) + (cell.y + 1), null, channel, {
        kind,
        x: cell.x,
        y: cell.y,
      });
    arm(null);
    choices.hidden = true;
    return true;
  }
  function draw(ctx, geo, now) {
    if (!marks.length) return;
    marks = marks.filter((m) => m.until > now);
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const m of marks) {
      const [label, color, symbol] = kinds[m.kind],
        x = geo.ox + (m.x + 0.5) * geo.tile,
        y = geo.oy + (m.y + 0.5) * geo.tile;
      const size = Math.max(18, Math.min(36, geo.tile));
      ctx.fillStyle = "#10202cdd";
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, size * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = "bold " + size + "px sans-serif";
      ctx.fillText(symbol, x, y);
      ctx.font = "12px sans-serif";
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#10202c";
      ctx.lineWidth = 3;
      ctx.strokeText(m.name + " · " + label, x, y + size);
      ctx.fillText(m.name + " · " + label, x, y + size);
    }
    ctx.restore();
  }
  return { snapshot, receive, click, draw };
})();
