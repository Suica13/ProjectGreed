/* 规划箭头和地图移动都是本地演出，不阻塞队友的操作。 */
const PlanningUI = (() => {
  const moves = new Map();
  function reset() {
    moves.clear();
    lockStarts.clear();
  }
  function move(event) {
    const unit = getUnit(event.unitId);
    if (!unit) return;
    const start = performance.now();
    if (Rules.modelOf(unit).presentation.movement === "boost")
      WeaponAudio.play(ART.presentation.moveSound);
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
      const from = mapPosition(Rules.center(unit).x, Rules.center(unit).y),
        to = mapPosition(Rules.center(target).x, Rules.center(target).y);
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
      (unit) =>
        (unit.plan || unit.snipeOrder) &&
        (responding || viewerTeam === null || unit.team === viewerTeam),
    );
    plans.sort(
      (a, b) =>
        Number((a.plan || a.snipeOrder).target === focusTarget) -
        Number((b.plan || b.snipeOrder).target === focusTarget),
    );
    for (const unit of plans) {
      const order = unit.plan || unit.snipeOrder;
      const target = order.targetCell
        ? Rules.groundTarget(game, unit, order.targetCell.x, order.targetCell.y)
        : getUnit(order.target);
      if (draw(unit, target)) count++;
    }
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
    if (Rules.modelOf(unit).ship) return fallback;
    let targetId = (Net.snapshot?.counterPlans || []).find(
      (plan) => plan.attacker === unit.id,
    )?.target;
    if (phase === "reaction" && pending?.target === unit.id && response === "counter" && counterId)
      targetId = counterTargetId;
    const target = AttackControls.targetFor(unit) || (targetId && getUnit(targetId));
    if (!target) return fallback;
    // Draft facing is presentation-only: incoming snapshots still own unit.angle.
    // Use the same footprint centers as authority (including large targets).
    const preview = { ...unit, angle: fallback };
    Rules.faceTarget(preview, target);
    return preview.angle;
  }
  // White-only frames while charging; the native final red frame is reserved for a valid charged shot.
  const lockStarts = new Map();
  function sniperLocks(ctx, now) {
    const effect = ART.effects.SniperLock;
    if (!effect) return;
    const markers = new Map();
    if (!(battleView?.mapBattle || Net.snapshot?.phase === "playback")) {
      for (const unit of game.units) {
        const order = unit.snipeOrder || unit.plan;
        const weapon = order && Rules.modelOf(unit).weapons.find((w) => w.id === order.weapon);
        const target = order && getUnit(order.target);
        if (weapon?.special?.type === "snipe" && unit.hp > 0 && target?.hp > 0)
          markers.set(unit.id, { target, red: !!order.charged });
      }
    } else {
      for (const frame of MapCombat.frames.length
        ? MapCombat.frames
        : [MapCombat.frame].filter(Boolean))
        if (frame.weapon.special?.type === "snipe" && frame.time <= frame.plan.shots[0]?.impactAt)
          markers.set(frame.event.from, { target: frame.target.unit, red: true });
    }
    const result = [];
    for (const [id, { target, red }] of markers) {
      if (!lockStarts.has(id)) lockStarts.set(id, now);
      const index = red ? 19 : Math.min(2, Math.floor(Math.max(0, now - lockStarts.get(id)) / 100));
      const pos = mapPosition(Rules.center(target).x, Rules.center(target).y);
      SpriteEffects.draw(
        ctx,
        "SniperLock",
        pos.x,
        pos.y,
        mapGeo.tile / 64,
        (index + 0.01) / effect.fps,
        -Math.PI / 2,
      );
      result.push({ attacker: id, target: target.id, frame: index, red });
    }
    for (const id of lockStarts.keys()) if (!markers.has(id)) lockStarts.delete(id);
    return result;
  }
  return { reset, move, motion, arrows, facing, sniperLocks };
})();

// Target-first attack editor. Draft choices never change the authoritative unit or its resources.
const AttackControls = (() => {
  let current = null;
  function reset() {
    current = null;
  }
  function draft(unit) {
    if (
      current &&
      (current.round !== game.round || current.session !== session || current.unitId !== unit?.id)
    )
      current = null;
    return current;
  }
  function targetFor(unit) {
    if (mode !== "attack-weapons" || !current || current.unitId !== unit.id ||
        current.round !== game.round || current.session !== session) return null;
    const target = getUnit(current.targetId);
    return target?.hp > 0 ? target : null;
  }
  function ordinary(unit) {
    return Rules.modelOf(unit).weapons.filter((w) => w.slot !== "skill");
  }
  function canTarget(unit, target) {
    return ordinary(unit).some(
      (w) =>
        Rules.canAttack(game, unit, target, w) &&
        Rules.actionCost(w) <= Rules.actionPoints(unit) + (unit.plan?.actionCost ?? 0),
    );
  }
  function start(unit) {
    if (
      !unit ||
      unit.team !== game.team ||
      (unit.acted && !unit.plan) ||
      isBusy() ||
      isAI() ||
      (Net.active && (!Net.canControl(unit) || !Net.canAct()))
    )
      return;
    reset();
    mode = "attack-target";
    weaponId = null;
    update();
  }
  function choose(unit, target, existing = false) {
    if (!canTarget(unit, target)) return false;
    current = {
      unitId: unit.id,
      targetId: target.id,
      weapons: existing ? [...(unit.plan.weapons || [unit.plan.weapon])] : [],
      round: game.round,
      session,
    };
    mode = "attack-weapons";
    weaponId = null;
    GameAudio.play("lockonSound");
    update();
    return true;
  }
  function render(panel, unit, canCommand) {
    const plan = draft(unit),
      target = plan && getUnit(plan.targetId);
    if (!target || target.hp <= 0) {
      if (plan) reset();
      if (mode !== "attack-target") {
        const startButton = element("button", "", "选择攻击目标");
        startButton.id = "startAttackTarget";
        startButton.disabled = !canCommand || !game.units.some((enemy) => canTarget(unit, enemy));
        startButton.onclick = () => start(unit);
        panel.append(startButton);
        const catalog = element("div", "weapon-list");
        for (const weapon of ordinary(unit)) {
          const info = element("div", "weapon");
          info.innerHTML = htmlWeapon(weapon, unit);
          catalog.append(info);
        }
        panel.append(catalog);
        return;
      }
      panel.append(element("p", "helper", "先选择攻击目标，再按顺序加入武器。"));
      for (const enemy of game.units.filter((t) => canTarget(unit, t))) {
        const b = element(
          "button",
          "target-button",
          unitName(enemy) + " · " + Rules.dist(unit, enemy) + "格",
        );
        b.dataset.attackTarget = enemy.id;
        b.disabled = !canCommand;
        b.onclick = () => choose(unit, enemy);
        panel.append(b);
      }
      if (unit.plan)
        panel.append(
          element(
            "p",
            "helper",
            "已计划：" +
              (unit.plan.weapons || [unit.plan.weapon])
                .map((id) => getWeapon(unit, id)?.name || id)
                .join(" → "),
          ),
        );
      return;
    }
    const queue = plan.weapons.map((id) => getWeapon(unit, id));
    const cost = queue.reduce((n, w) => n + Rules.actionCost(w), 0),
      energy = queue.reduce((n, w) => n + Rules.weaponStats(w, unit).en, 0);
    const budget = Rules.actionPoints(unit) + (unit.plan?.actionCost ?? 0);
    const editor = element("div", "hud-attack-editor");
    editor.id = "attackEditor";
    panel.append(editor);
    const heading = element("div", "hud-attack-heading"),
      available = element("section", "hud-attack-available"),
      planned = element("section", "hud-attack-planned"),
      queueList = element("div", "hud-attack-queue");
    editor.append(heading, planned, available);
    heading.append(element("strong", "", "目标：" + unitName(target)));
    available.append(element("div", "section-title", "可用武器"));
    planned.append(element("div", "section-title", "当前攻击计划"), queueList);
    if (!queue.length) queueList.append(element("p", "helper", "尚未添加武器"));
    const summary = element(
      "div",
      "rule-box",
      `行动点 ${budget - cost}/${Rules.actionBudget(unit)} · 序列消耗 ${cost} AP · EN ${energy}/${unit.en}`,
    );
    summary.id = "attackQueueBudget";
    heading.append(summary);
    queue.forEach((w, index) => {
      const row = element("div", "actions");
      const label = element("div", "");
      label.append(element("div", "", `${index + 1}. ${w.name} · ${Rules.actionCost(w)} AP`));
      const forecast = attackForecast(unit, target, w);
      const detail = element("div", "helper attack-forecast", attackForecastText(forecast));
      detail.dataset.damage = forecast.damage;
      detail.dataset.hit = forecast.hit;
      label.append(detail);
      row.append(label);
      queueList.append(row);
    });
    const list = element("div", "weapon-list");
    for (const weapon of ordinary(unit)) {
      const b = element("button", "weapon");
      b.dataset.queueWeapon = weapon.id;
      b.innerHTML = htmlWeapon(weapon, unit, target);
      b.setAttribute("aria-label", "加入序列 " + weapon.name);
      try {
        Rules.attackQueue(game, unit, target, [...queue, weapon]);
        b.disabled = !canCommand;
      } catch {
        b.disabled = true;
      }
      b.onclick = () => {
        weaponId = weapon.id;
        plan.weapons.push(weapon.id);
        GameAudio.play("selectWeaponSound");
        update();
      };
      list.append(b);
    }
    available.append(list);
    const confirm = element("button", "", "确认攻击计划");
    confirm.id = "confirmAttackQueue";
    confirm.disabled = !canCommand || !queue.length;
    confirm.onclick = () => {
      try {
        Rules.attackQueue(game, unit, target, queue);
        if (Net.active)
          Net.request("attack", {
            unitId: unit.id,
            targetId: target.id,
            weaponId: queue[0].id,
            weaponIds: plan.weapons,
          });
        else beginAttack(unit, target, queue[0], queue);
        reset();
        selected = weaponId = null;
        mode = "select";
        update();
      } catch (e) {
        note(e.message);
      }
    };
    const change = element("button", "", "更换目标");
    change.disabled = !canCommand;
    change.onclick = () => {
      reset();
      mode = "attack-target";
      update();
    };
    const buttons = element("div", "hud-attack-confirm");
    const clear = element("button", "", "清空计划");
    clear.id = "clearAttackQueue";
    clear.disabled = !canCommand || !queue.length;
    clear.onclick = () => {
      plan.weapons = [];
      update();
    };
    buttons.append(confirm, clear, change);
    editor.append(buttons);
  }
  return { reset, draft, targetFor, canTarget, start, choose, render };
})();
