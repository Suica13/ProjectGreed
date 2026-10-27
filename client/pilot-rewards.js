/* Private server awards drive temporary map labels; never infer XP from damage on the client. */
const PilotRewards = (() => {
  let match = null;
  const seen = new Set(),
    pending = [],
    active = [];
  function receive(snapshot) {
    if (snapshot.replay || snapshot.phase === "replay" || snapshot.startedFromSave) return;
    if (match !== snapshot.matchId) {
      match = snapshot.matchId;
      seen.clear();
      pending.length = active.length = 0;
    }
    for (const award of snapshot.pilotAwards || []) {
      if (seen.has(award.id) || Formation.hasPilotAward(award.id)) continue;
      seen.add(award.id);
      if (award.experiencePoints > 0 || award.leveledUp) pending.push(award);
    }
    if (snapshot.phase !== "playback") {
      const now = performance.now();
      for (const award of pending.splice(0)) active.push({ ...award, start: now });
    }
  }
  function draw(ctx, unit, x, y, now) {
    for (let i = active.length - 1; i >= 0; i--)
      if (now - active[i].start > 3500) active.splice(i, 1);
    const rewards = active.filter((a) => (a.carrierId || a.unitId) === unit.id);
    if (!rewards.length) return;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = "bold 13px system-ui";
    rewards.forEach((award, i) => {
      const age = now - award.start,
        top = y + i * 32 - age / 200;
      ctx.globalAlpha = Math.min(1, (3500 - age) / 700);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#10212a";
      const labels = [];
      if (award.experiencePoints > 0)
        labels.push([I18n.text("+" + award.experiencePoints + "经验值"), "#9cffa8"]);
      if (award.leveledUp) labels.push(["LEVEL UP", "#ffdc6e"]);
      labels.forEach(([text, color], j) => {
        ctx.fillStyle = color;
        ctx.strokeText(text, x, top + j * 16);
        ctx.fillText(text, x, top + j * 16);
      });
    });
    ctx.restore();
  }
  return { receive, draw };
})();
