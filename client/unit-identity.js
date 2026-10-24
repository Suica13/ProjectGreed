/* 玩家视角与阵营分开：联机按 ownerSeat 判断自己的编组，离线 AI 始终以玩家0为视角。 */
const UnitIdentity = (() => {
  const colors = {
    own: { color: "#68e99a", fill: "#68e99a2c" },
    ally: { color: "#78ceef", fill: "#6acfff2d" },
    enemy: { color: "#fa8b79", fill: "#ff887c2c" },
  };
  function viewerSeat() {
    if (Net.active) return Net.seat;
    if (game.ai) return 0;
    return phase === "deployment" ? Deployment.team() : game.team;
  }
  function relation(unit) {
    const seat = viewerSeat();
    if (seat !== null && Rules.ownerOf(unit) === seat) return "own";
    const team = seat === null ? 0 : Rules.seatTeam(seat);
    return unit.team === team ? "ally" : "enemy";
  }
  function owner(unit) {
    const seat = Rules.ownerOf(unit);
    const member = Net.active ? Net.snapshot?.members.find((player) => player.seat === seat) : null;
    return {
      seat,
      member,
      name: Net.active
        ? member?.name || "空席位"
        : game.ai && seat === 1
          ? "AI"
          : "本机玩家" + (seat + 1),
      team: "队伍" + (unit.team + 1),
    };
  }
  function drawRing(ctx, unit, position, tile) {
    const palette = colors[relation(unit)];
    ctx.fillStyle = palette.fill;
    ctx.strokeStyle = palette.color;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(position.x, position.y, tile * 0.31, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  return { colors, viewerSeat, relation, owner, drawRing };
})();
