/* 规划箭头和地图移动都是本地演出，不阻塞队友的操作。 */
const PlanningUI = (() => {
  const moves = new Map();
  function reset() {
    moves.clear();
    lockStarts.clear();
  }
  function move(event, actor = null) {
    const unit = actor || getUnit(event.unitId);
    if (!unit) return;
    GameAudio.moveUnit(unit);
    moves.set(unit.id, {
      id: unit.id,
      from: event.from,
      path: event.path,
      // Start when the first map frame is drawn, after snapshot/UI work.
      start: null,
      step: MovementTiming.step(event.path, byId("quick").checked),
    });
  }
  function motion(unit, now) {
    const move = moves.get(unit.id);
    if (!move) return null;
    if (move.start === null) {
      move.start = now;
      if (getUnit(unit.id)?.pendingMove)
        setTimeout(() => {
          if (
            (!moves.has(unit.id) || moves.get(unit.id) === move) &&
            getUnit(unit.id)?.pendingMove
          )
            update();
        }, move.path.length * move.step + 20);
    }
    if (now < move.start + move.path.length * move.step) return move;
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
    const viewerTeam = Net.active
      ? (Net.snapshot?.viewTeam ?? (Net.isSpectator() ? null : Net.team()))
      : null;
    const responding = Net.active ? Net.snapshot?.phase === "reaction" : phase === "reaction";
    const focusTarget = responding ? pending?.target : null;
    function draw(unit, target, counter = false, candidate = false, label = "", draft = false) {
      if (!unit || !target || unit.hp <= 0 || target.hp <= 0) return false;
      const from = mapPosition(Rules.center(unit).x, Rules.center(unit).y),
        to = mapPosition((target.aimCell ?? Rules.center(target)).x, (target.aimCell ?? Rules.center(target)).y);
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
      ctx.setLineDash(draft ? [8, 5] : candidate ? [4, 6] : []);
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
      if (label) {
        const x = (from.x - Math.sin(angle) * offset + tip.x) / 2;
        const y = (from.y + Math.cos(angle) * offset + tip.y) / 2;
        const color = ctx.strokeStyle;
        ctx.shadowBlur = 0;
        ctx.font = "bold 12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const width = ctx.measureText(label).width + 12;
        ctx.fillStyle = "#202732";
        ctx.fillRect(x-width/2,y-11,width,22);
        ctx.strokeRect(x-width/2,y-11,width,22);
        ctx.fillStyle = color;
        ctx.fillText(label,x,y);
      }
      ctx.restore();
      return true;
    }
    let count = 0;
    // 先画淡化的其他交战，最后画当前来袭箭头，避免交叉处被覆盖。
    const plans = game.units.flatMap(unit => {
      if (!(responding || viewerTeam === null || unit.team === viewerTeam)) return [];
      const draftPlans = AttackControls.mapDraft(unit);
      if (draftPlans) return draftPlans.map(entry => ({unit,...entry}));
      const orders = Rules.attackOrders(unit);
      return (orders.length ? orders : unit.snipeOrder ? [unit.snipeOrder] : [])
        .map(order => ({ unit, order }));
    });
    plans.sort((a, b) => Number(a.order.target === focusTarget) - Number(b.order.target === focusTarget));
    for (const { unit, order, label, draft } of plans) {
      const target = order.targetCell
        ? Rules.groundTarget(game, unit, order.targetCell.x, order.targetCell.y)
        : getUnit(order.target);
      if (draw(unit, target && { ...target, aimCell: order.aimCell },false,false,label,draft)) count++;
    }
    let candidateCount = 0;
    for (const entry of legalCounterTargets())
      if (draw(getUnit(pending.target), getUnit(entry.attacker), true, true)) candidateCount++;
    canvas.dataset.counterCandidateCount = candidateCount;
    const counters = [...(Net.snapshot?.counterPlans || [])];
    if (phase === "reaction" && pending && response === "counter") {
      const entries = counterDraft(getUnit(pending.target)).entries;
      const labels = new Map();
      entries.forEach((entry,index) => {
        const list = labels.get(entry.targetId) || [];
        list.push(index+1); labels.set(entry.targetId,list);
      });
      for (const [target,label] of labels) counters.push({attacker:pending.target,target,
        draft:true,label:label.join(", ")});
    }
    let counterCount = 0;
    for (const plan of counters)
      if (draw(getUnit(plan.attacker),getUnit(plan.target),true,false,plan.label,plan.draft)) counterCount++;
    canvas.dataset.planCount = count;
    canvas.dataset.counterPlanCount = counterCount;
  }
  function facing(unit, fallback = unit.angle) {
    if (Rules.modelOf(unit).ship || Rules.modelOf(unit).fixedWeaponFacing) return fallback;
    let targetId = (Net.snapshot?.counterPlans || []).find(
      (plan) => plan.attacker === unit.id,
    )?.target;
    if (phase === "reaction" && pending?.target === unit.id && response === "counter")
      targetId = counterDraft(unit).entries[0]?.targetId || counterTargetId;
    const target = AttackControls.facingTarget(unit) || (targetId && getUnit(targetId));
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
        const order = unit.snipeOrder || Rules.attackOrders(unit).find(order =>
          (order.weapons || [order.weapon]).some(id => getWeapon(unit, id)?.special?.type === "snipe"));
        const weapon = order && (order.weapons || [order.weapon]).map(id => getWeapon(unit, id))
          .find(weapon => weapon?.special?.type === "snipe");
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
  return { reset, move, stop: (id) => moves.delete(id), motion, arrows, facing, sniperLocks };
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
  function stash() {
    if (!current) return;
    current.orders.set(current.targetId, { targetId: current.targetId,
      aimCell: current.aimCell, weaponIds: [...current.weapons] });
  }
  function previewUnit(unit) {
    if (!current || current.unitId !== unit.id) return unit;
    stash();
    const orders = new Map(Rules.attackOrders(unit).map(order => [order.target, {...order}]));
    for (const order of current.orders.values()) {
      if (!order.weaponIds.length) continue;
      orders.set(order.targetId, { target: order.targetId, aimCell: order.aimCell,
        weapons: order.weaponIds, actionCost: order.weaponIds.reduce((sum,id) =>
          sum + Rules.actionCost(getWeapon(unit,id)),0) });
    }
    const attacks = [...orders.values()];
    return { ...unit, actionPoints: Rules.actionPoints(unit) + (unit.plan?.actionCost || 0) -
      attacks.reduce((sum,order) => sum + order.actionCost,0),
      plan: { attacks, actionCost: attacks.reduce((sum,order) => sum + order.actionCost,0) } };
  }
  function resumeTarget() {
    if (!current) return;
    mode = "attack-weapons";
    update();
  }
  function changing() { return !!current && mode === "attack-target"; }
  function targetFor(unit) {
    if (
      mode !== "attack-weapons" ||
      !current ||
      current.unitId !== unit.id ||
      current.round !== game.round ||
      current.session !== session
    )
      return null;
    const target = getUnit(current.targetId);
    return target?.hp > 0 ? {...target, aimCell: current.aimCell} : null;
  }
  function facingTarget(unit) {
    const active = current && current.unitId === unit.id && current.round === game.round && current.session === session;
    const order = (active ? allOrders(unit) : Rules.attackOrders(unit)).find(order =>
      (order.weapons || [order.weapon]).length);
    if (order) {
      const target = getUnit(order.target);
      return target && {...target,aimCell:order.aimCell};
    }
    if (active) {
      const target = getUnit(current.targetId);
      return target && {...target,aimCell:current.aimCell};
    }
    return null;
  }
  function ordinary(unit) {
    return Rules.modelOf(unit).weapons.filter((w) => w.slot !== "skill");
  }
  function canTarget(unit, target) {
    const preview = previewUnit(unit);
    const existing = Rules.attackPlanFor(preview, target);
    return ordinary(unit).some(weapon => {
      const queue = (existing?.weapons || []).map(id => getWeapon(unit,id));
      try { Rules.attackQueue(game, preview, target, [...queue, weapon]); return true; }
      catch { return false; }
    });
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
    const committed = Rules.attackPlanFor(unit, target);
    existing = !!committed;
    if (existing && !target.aimCell && committed.aimCell) target = { ...target, aimCell: committed.aimCell };
    if (!target.aimCell) {
      const cell = Rules.cells(target).find(cell => canTarget(unit, {...target, aimCell:cell}));
      if (cell) target = {...target, aimCell:cell};
    }
    if (!canTarget(unit, target)) return false;
    stash();
    const orders = current?.unitId === unit.id ? current.orders : new Map();
    const saved = orders.get(target.id);
    current = {
      orders,
      unitId: unit.id,
      targetId: target.id,
      aimCell: saved?.aimCell ?? target.aimCell ?? committed?.aimCell,
      weapons: saved ? [...saved.weaponIds] : existing ? [...(committed.weapons || [committed.weapon])] : [],
      round: game.round,
      session,
    };
    mode = "attack-weapons";
    weaponId = null;
    GameAudio.play("lockonSound");
    update();
    return true;
  }
  function allOrders(unit) {
    return Rules.attackOrders(previewUnit(unit));
  }
  function mapDraft(unit) {
    if (!current || current.unitId !== unit.id || current.round !== game.round || current.session !== session)
      return null;
    let index = 0;
    return allOrders(unit).map(order => ({order,
      label:(order.weapons || [order.weapon]).map(() => ++index).join(", "),
      draft:current.orders.has(order.target) }));
  }
  function appendPlanRows(list, unit, orders) {
    let index = 0;
    for (const order of orders) {
      const target = order.targetCell
        ? Rules.groundTarget(game, unit, order.targetCell.x, order.targetCell.y) : getUnit(order.target);
      const targetName = target?.groundTarget ? Rules.columnLabel(target.x) + (target.y + 1) :
        target ? unitName(target) : I18n.text("目标已不可见");
      for (const id of order.weapons || [order.weapon]) {
        const row = element("div", "attack-plan-line");
        row.append(element("span", "weapon-plan-index", String(++index)),
          element("span", "attack-plan-weapon", getWeapon(unit,id)?.name || id),
          element("span", "attack-plan-arrow", "→"),
          element("span", "attack-plan-target", targetName));
        list.append(row);
      }
    }
    if (!index) list.append(element("p", "helper", "尚未添加武器"));
  }
  function renderSummary(panel, unit) {
    panel.replaceChildren();
    if (!unit) return false;
    const orders = allOrders(unit);
    if (!orders.some(order => (order.weapons || [order.weapon]).length)) return false;
    panel.append(element("div", "section-title", "当前攻击计划"));
    appendPlanRows(panel,unit,orders);
    return true;
  }
  function renderCommitted(panel, unit) {
    const list = element("div", "committed-attack-plans");
    if (renderSummary(list,unit)) panel.append(list);
  }
  function render(panel, unit, canCommand) {
    const plan = draft(unit),
      rawTarget = plan && getUnit(plan.targetId),
      target = rawTarget && {...rawTarget, aimCell: plan.aimCell};
    if (!target || target.hp <= 0) {
      if (plan) reset();
      renderCommitted(panel,unit);
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
          catalog.append(WeaponInfo.card(weapon, info, {unit}));
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
      return;
    }
    const queue = plan.weapons.map((id) => getWeapon(unit, id));
    const cost = queue.reduce((n, w) => n + Rules.actionCost(w), 0),
      energy = queue.reduce((n, w) => n + Rules.weaponStats(w, unit).en, 0);
    const preview = previewUnit(unit);
    const availableBudget = Rules.attackBudget(preview, target);
    const budget = availableBudget.ap;
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
    const orders = allOrders(unit);
    appendPlanRows(queueList,unit,orders);
    const totalCost = orders.reduce((sum,order) => sum + (order.actionCost || 0),0);
    const totalEnergy = orders.flatMap(order => order.weapons || [order.weapon]).reduce((sum,id) =>
      sum + Rules.weaponStats(getWeapon(unit,id),unit).en,0);
    const summary = element(
      "div",
      "rule-box",
      `行动点 ${Rules.actionPoints(preview)}/${Rules.actionBudget(unit)} · 序列消耗 ${totalCost} AP · EN ${totalEnergy}/${unit.en}`,
    );
    summary.id = "attackQueueBudget";
    heading.append(summary);
    const list = element("div", "weapon-list");
    for (const weapon of ordinary(unit)) {
      const b = element("button", "weapon");
      b.dataset.queueWeapon = weapon.id;
      b.innerHTML = htmlWeapon(weapon, unit, target);
      b.setAttribute("aria-label", "加入序列 " + weapon.name);
      try {
        Rules.attackQueue(game, preview, target, [...queue, weapon]);
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
      list.append(WeaponInfo.card(weapon, b, {unit, target}));
    }
    available.append(list);
    if (Rules.cells(target).length > 1) {
      const selector = element("select", "attack-cell-select");
      selector.setAttribute("aria-label", I18n.text("攻击格"));
      for (const cell of Rules.cells(target)) {
        const option = element("option", "", Rules.columnLabel(cell.x) + (cell.y + 1) +
          (Rules.weakPoint(target, cell) ? " · " + I18n.text("弱点 ×1.5") : ""));
        option.value = cell.x + "," + cell.y;
        option.selected = cell.x === plan.aimCell?.x && cell.y === plan.aimCell?.y;
        option.disabled = !canTarget(unit, {...target, aimCell:cell});
        selector.append(option);
      }
      selector.onchange = () => {
        const [x,y] = selector.value.split(",").map(Number);
        plan.aimCell = {x,y}; plan.weapons = []; update();
      };
      panel.append(selector);
    }
    const confirm = element("button", "", "确认攻击计划");
    confirm.id = "confirmAttackQueue";
    confirm.disabled = !canCommand || !(queue.length || [...plan.orders.values()].some(order => order.weaponIds.length));
    confirm.onclick = () => {
      try {
        stash();
        const orders = [...plan.orders.values()].filter(order => order.weaponIds.length);
        if (Net.active) Net.request("attack", { unitId: unit.id, orders });
        else {
          // Offline battle preview uses the same authoritative planner.
          const room = { game, plans: Rules.attackOrders(unit).map((order,index) =>
            ({...order, attacker:unit.id, seat:Rules.ownerOf(unit), order:index+1})),
            planSequence: Rules.attackOrders(unit).length };
          createAttackPlanner(Rules, () => crypto.randomUUID()).planBatch(room, unit, orders, Rules.ownerOf(unit));
        }
        reset();
        selected = null;
        weaponId = null;
        mode = "select";
        update();
      } catch (e) {
        note(e.message);
      }
    };
    const change = element("button", "", "更换目标");
    change.disabled = !canCommand || !game.units.some(enemy => canTarget(unit, enemy));
    change.onclick = () => {
      stash();
      mode = "attack-target";
      update();
    };
    const buttons = element("div", "hud-attack-confirm");
    const clear = element("button", "", "清空计划");
    clear.id = "clearAttackQueue";
    clear.disabled = !canCommand || ![...plan.orders.values()].some(order => order.weaponIds.length);
    clear.onclick = () => {
      plan.orders.clear();
      plan.weapons = [];
      update();
    };
    buttons.append(confirm, clear, change);
    editor.append(buttons);
  }
  return { reset, draft, targetFor, facingTarget, canTarget, start, choose, render, renderSummary, mapDraft, changing, resumeTarget };
})();
