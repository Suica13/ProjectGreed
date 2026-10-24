/* 规划箭头和地图移动都是本地演出，不阻塞队友的操作。 */
const PlanningUI = (() => {
  const moves = new Map();
  function reset() {
    moves.clear();
  }
  function move(event) {
    const unit = getUnit(event.unitId);
    if (!unit) return;
    const start = performance.now();
    if (Rules.modelOf(unit).presentation.movement === "boost")
      WeaponAudio.play(ART.presentation.moveSound);
    MovementEffects.start(unit, event.from, event.path[0], start);
    moves.set(unit.id, {
      id: unit.id,
      from: event.from,
      path: event.path,
      start,
      step: byId("quick").checked ? 50 : 120,
    });
  }
  function motion(unit, now) {
    const move = moves.get(unit.id);
    if (move && now < move.start + move.path.length * move.step) return move;
    moves.delete(unit.id);
    return null;
  }
  function arrows(ctx) {
    const canvas = byId("map");
    canvas.dataset.planCount =
      canvas.dataset.counterPlanCount =
      canvas.dataset.counterCandidateCount =
        0;
    if (battleView?.mapBattle || Net.snapshot?.phase === "playback") return;
    const viewerTeam = Net.active && !Net.isSpectator() ? Net.team() : null;
    const responding = Net.active ? Net.snapshot?.phase === "reaction" : phase === "reaction";
    const focusTarget = responding ? pending?.target : null;
    function draw(unit, target, counter = false, candidate = false) {
      if (!unit || !target || unit.hp <= 0 || target.hp <= 0) return false;
      const from = mapPosition(unit.x, unit.y),
        to = mapPosition(target.x, target.y);
      const angle = Math.atan2(to.y - from.y, to.x - from.x),
        gap = mapGeo.tile * 0.32;
      const offset = candidate ? 10 : counter ? 6 : 0;
      const tip = {
        x: to.x - Math.cos(angle) * gap - Math.sin(angle) * offset,
        y: to.y - Math.sin(angle) * gap + Math.cos(angle) * offset,
      };
      const incoming = !counter && target.id === focusTarget;
      ctx.save();
      ctx.globalAlpha = focusTarget && !incoming && unit.id !== focusTarget ? 0.18 : 1;
      ctx.strokeStyle = ctx.fillStyle = incoming
        ? "#ff5f6d"
        : counter
          ? "#f5d86e"
          : unit.team
            ? "#ff998a"
            : "#99efaa";
      ctx.lineWidth = incoming ? 5 : candidate ? 2 : counter ? 3.5 : 3;
      if (incoming) {
        ctx.shadowColor = "#ff5f6d";
        ctx.shadowBlur = 10;
      }
      ctx.setLineDash(candidate ? [5, 4] : []);
      ctx.beginPath();
      ctx.moveTo(from.x - Math.sin(angle) * offset, from.y + Math.cos(angle) * offset);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x - Math.cos(angle - 0.5) * 14, tip.y - Math.sin(angle - 0.5) * 14);
      ctx.lineTo(tip.x - Math.cos(angle + 0.5) * 14, tip.y - Math.sin(angle + 0.5) * 14);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return true;
    }
    let count = 0;
    // 先画淡化的其他交战，最后画当前来袭箭头，避免交叉处被覆盖。
    const plans = game.units.filter(
      (unit) => unit.plan && (responding || viewerTeam === null || unit.team === viewerTeam),
    );
    plans.sort(
      (a, b) => Number(a.plan.target === focusTarget) - Number(b.plan.target === focusTarget),
    );
    for (const unit of plans) if (draw(unit, getUnit(unit.plan.target))) count++;
    let candidateCount = 0;
    for (const entry of legalCounterTargets())
      if (draw(getUnit(pending.target), getUnit(entry.attacker), true, true)) candidateCount++;
    canvas.dataset.counterCandidateCount = candidateCount;
    const counters = new Map(
      (Net.snapshot?.counterPlans || []).map((plan) => [plan.attacker, plan]),
    );
    if (phase === "reaction" && pending && response === "counter" && counterId && counterTargetId)
      counters.set(pending.target, { attacker: pending.target, target: counterTargetId });
    let counterCount = 0;
    for (const plan of counters.values())
      if (draw(getUnit(plan.attacker), getUnit(plan.target), true)) counterCount++;
    canvas.dataset.planCount = count;
    canvas.dataset.counterPlanCount = counterCount;
  }
  function facing(unit, fallback = unit.angle) {
    let targetId = (Net.snapshot?.counterPlans || []).find(
      (plan) => plan.attacker === unit.id,
    )?.target;
    if (phase === "reaction" && pending?.target === unit.id && response === "counter" && counterId)
      targetId = counterTargetId;
    const target = targetId && getUnit(targetId);
    return target
      ? (Math.atan2(target.x - unit.x, -(target.y - unit.y)) * 180) / Math.PI
      : fallback;
  }
  return { reset, move, motion, arrows, facing };
})();
