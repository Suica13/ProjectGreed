/* 规划箭头和地图移动都是本地演出，不阻塞队友的操作。 */
const PlanningUI = (() => {
  const moves = new Map();
  window.addEventListener("presentation-speed-change", ({ detail: { previous, speed } }) => {
    const now = performance.now(),
      ratio = speed / previous;
    for (const move of moves.values()) {
      if (move.start !== null) move.start = now - (now - move.start) / ratio;
      move.step /= ratio;
      if (move.start !== null && getUnit(move.id)?.pendingMove)
        setTimeout(update, Math.max(0, move.start + move.path.length * move.step - now) + 20);
    }
  });
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
    for (const id of event.squadIds || []) {
      if (id === unit.id) continue;
      const member = getUnit(id);
      if (member)
        moves.set(id, { ...moves.get(unit.id), id, path: event.squadPaths?.[id] || event.path });
    }
    const group = (event.squadIds || [unit.id]).map((id) => moves.get(id)).filter(Boolean);
    const duration = Math.max(
      ...group.map(
        (entry) => entry.path.length * MovementTiming.step(entry.path, byId("quick").checked),
      ),
    );
    for (const entry of group) entry.step = duration / Math.max(1, entry.path.length);
  }
  function motion(unit, now) {
    const move = moves.get(unit.id);
    if (!move) return null;
    if (move.start === null) {
      move.start = now;
      if (getUnit(unit.id)?.pendingMove)
        setTimeout(
          () => {
            if (
              (!moves.has(unit.id) || moves.get(unit.id) === move) &&
              getUnit(unit.id)?.pendingMove
            )
              update();
          },
          move.path.length * move.step + 20,
        );
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
        to = mapPosition(
          (target.aimCell ?? Rules.center(target)).x,
          (target.aimCell ?? Rules.center(target)).y,
        );
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
        ctx.fillRect(x - width / 2, y - 11, width, 22);
        ctx.strokeRect(x - width / 2, y - 11, width, 22);
        ctx.fillStyle = color;
        ctx.fillText(label, x, y);
      }
      ctx.restore();
      return true;
    }
    let count = 0;
    // 先画淡化的其他交战，最后画当前来袭箭头，避免交叉处被覆盖。
    const plans = game.units.flatMap((unit) => {
      if (!(responding || viewerTeam === null || unit.team === viewerTeam)) return [];
      const draftPlans = AttackControls.mapDraft(unit);
      if (draftPlans) return draftPlans.map((entry) => ({ unit, ...entry }));
      const orders = Rules.attackOrders(unit);
      return (orders.length ? orders : unit.snipeOrder ? [unit.snipeOrder] : []).map((order) => ({
        unit,
        order,
      }));
    });
    plans.sort(
      (a, b) => Number(a.order.target === focusTarget) - Number(b.order.target === focusTarget),
    );
    for (const { unit, order, label, draft } of plans) {
      const target = order.targetCell
        ? Rules.groundTarget(game, unit, order.targetCell.x, order.targetCell.y)
        : getUnit(order.target);
      if (draw(unit, target && { ...target, aimCell: order.aimCell }, false, false, label, draft))
        count++;
    }
    let candidateCount = 0;
    for (const entry of legalCounterTargets())
      if (draw(getUnit(pending.target), getUnit(entry.attacker), true, true)) candidateCount++;
    canvas.dataset.counterCandidateCount = candidateCount;
    const counters = [...(Net.snapshot?.counterPlans || [])];
    if (phase === "reaction" && pending && response === "counter") {
      const target = counterDraft(getUnit(pending.target)).entries[0]?.targetId;
      if (target) counters.push({ attacker: pending.target, target, draft: true, label: "" });
    }
    let counterCount = 0;
    for (const plan of counters)
      if (draw(getUnit(plan.attacker), getUnit(plan.target), true, false, plan.label, plan.draft))
        counterCount++;
    canvas.dataset.planCount = count;
    canvas.dataset.counterPlanCount = counterCount;
  }
  function facing(unit, fallback = unit.angle, frameModel = null) {
    const model = frameModel || Rules.modelOf(unit);
    if (model.ship || model.fixedWeaponFacing) return fallback;
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
        const order =
          unit.snipeOrder ||
          Rules.attackOrders(unit).find((order) =>
            (order.weapons || [order.weapon]).some(
              (id) => getWeapon(unit, id)?.special?.type === "snipe",
            ),
          );
        const weapon =
          order &&
          (order.weapons || [order.weapon])
            .map((id) => getWeapon(unit, id))
            .find((weapon) => weapon?.special?.type === "snipe");
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
        mapGeo.tile / Rules.mapCellPixels,
        (index + 0.01) / effect.fps,
        -Math.PI / 2,
      );
      result.push({ attacker: id, target: target.id, frame: index, red });
    }
    for (const id of lockStarts.keys()) if (!markers.has(id)) lockStarts.delete(id);
    return result;
  }
  function selectionFrames(poses, marks, tile) {
    const groups = new Map();
    const key = (unit) =>
      unit.squadId
        ? [unit.squadId, unit.team, Rules.controllerOf(game, unit), unit.x, unit.y].join(":")
        : unit.id;
    for (const mark of marks) {
      const pose = poses.find(({ u }) => u.id === mark.unitId);
      if (!pose) continue;
      const groupKey = mark.group ? key(pose.u) : pose.u.id;
      const id = mark.kind + ":" + groupKey;
      if (groups.has(id)) continue;
      if (mark.group) {
        const center = Rules.center(pose.u);
        const pos = mapPosition(center.x, center.y);
        const size = Rules.dimensions(pose.u);
        groups.set(id, {
          kind: mark.kind,
          x: pos.x - (tile * size.width) / 2,
          y: pos.y - (tile * size.height) / 2,
          width: tile * size.width,
          height: tile * size.height,
        });
        continue;
      }
      const members = mark.group ? poses.filter(({ u }) => key(u) === groupKey) : [pose];
      const spriteTile = (tile * 64) / Rules.mapCellPixels;
      const left = Math.min(
        ...members.map((p) => p.pos.x - spriteTile * (p.unitSize.width / 2 - 0.07)),
      );
      const right = Math.max(
        ...members.map((p) => p.pos.x + spriteTile * (p.unitSize.width / 2 - 0.07)),
      );
      const top = Math.min(
        ...members.map((p) => p.pos.y - spriteTile * (p.unitSize.height / 2 - 0.07)),
      );
      const bottom = Math.max(
        ...members.map((p) => p.pos.y + spriteTile * (p.unitSize.height / 2 - 0.07)),
      );
      groups.set(id, {
        kind: mark.kind,
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      });
    }
    return [...groups.values()];
  }
  return {
    reset,
    move,
    stop: (id) => moves.delete(id),
    motion,
    arrows,
    facing,
    sniperLocks,
    selectionFrames,
  };
})();

// Target-first attack editor. Draft choices never change the authoritative unit or its resources.
const AttackControls = (() => {
  let current = null;
  function reset() {
    current = null;
  }
  function draft(unit) {
    if (current && (current.round !== game.round || current.session !== session)) current = null;
    return current?.unitId === unit?.id ? current : null;
  }
  function targetFor(unit) {
    const plan = draft(unit);
    return plan ? getUnit(plan.targetId) : null;
  }
  function groupDraft(unit) {
    const root = current && getUnit(current.unitId);
    if (!root || !draft(root)) return null;
    return unit?.id === root.id ||
      (!current.single && Rules.squadMembers(game, root).some((member) => member.id === unit?.id))
      ? current
      : null;
  }
  function members(unit) {
    return squadSingleMove ? [unit] : Rules.squadMembers(game, unit);
  }
  function targetLabel(unit) {
    const count = Rules.squadMembers(game, unit).length;
    return unitName(unit) + (count > 1 ? ` · ${I18n.text("小队")} ${count}` : "");
  }
  function facingTarget(unit) {
    const plan = groupDraft(unit);
    return (plan && getUnit(plan.targetId)) || getUnit(Rules.attackOrders(unit)[0]?.target);
  }
  function hasPlan(unit) { return members(unit).some(member=>!!member.plan); }
  function editable(unit) {
    return !!unit && members(unit).every(member=>member.attackSkillRound!==game.round &&
      (!member.acted || member.plan || member.squadOrder));
  }
  function cancelPlan(unit) {
    if(!editable(unit) || !hasPlan(unit) || !Net.active) return;
    Net.request("cancel_attack",{unitId:unit.id,single:squadSingleMove});
    reset();mode="select";update();
  }
  function canTarget(unit, target) {
    return (
      !!unit &&
      !!target &&
      target.team !== unit.team &&
      Rules.onMap(target) &&
      !target.embarked &&
      editable(unit) &&
      members(unit).some((member) =>
        Rules.automaticWeapons(game, member, target).some(
          (w) => squadCombatMode !== "shooting" || w.type !== "melee",
        ),
      )
    );
  }
  function start(unit) {
    if (
      !unit ||
      unit.team !== game.team ||
      !editable(unit) ||
      isBusy() ||
      isAI() ||
      (Net.active && (!Net.canControl(unit) || !Net.canAct()))
    )
      return;
    reset();
    const order=members(unit).flatMap(member=>Rules.attackOrders(member))[0];
    const target=order && getUnit(order.target);
    if(target && canTarget(unit,target)) {choose(unit,target);return;}
    mode = "attack-target";
    weaponId = null;
    update();
    window.BattleHUD?.setTab("weapons");
  }
  function choose(unit, target) {
    if (!canTarget(unit, target)) return false;
    current = {
      unitId: unit.id,
      single: squadSingleMove,
      targetId: target.id,
      round: game.round,
      session,
      weapons: Rules.automaticSquadQueue(game, unit, target).map((w) => w.id),
    };
    mode = "attack-weapons";
    weaponId = null;
    GameAudio.play("lockonSound");
    update();
    return true;
  }
  function memberPlan(unit, target) {
    const draft = groupDraft(unit);
    if (draft?.cache?.[unit.id]) return draft.cache[unit.id];
    const plan = Rules.firePlan(game, unit, target, { combatMode: squadCombatMode });
    if (draft) (draft.cache ??= {})[unit.id] = plan;
    return plan;
  }
  function orderFor(unit) {
    const plan = groupDraft(unit);
    return plan
      ? {
          target: plan.targetId,
          weapons: memberPlan(unit, getUnit(plan.targetId)).weapons.map((w) => w.id),
          actionCost: 0,
        }
      : Rules.attackOrders(unit)[0];
  }
  function mapDraft(unit) {
    const order = orderFor(unit);
    return order ? [{ order, label: "", draft: !!groupDraft(unit) }] : null;
  }
  function rows(panel, unit, target, queue, options = {}) {
    const counts = new Map();
    for (const w of queue) counts.set(w.id, (counts.get(w.id) || 0) + 1);
    for (const [id, count] of counts) {
      const weapon = getWeapon(unit, id);
      panel.append(WeaponInfo.card(weapon, null, { unit, target, rounds: count, compact: true, ...options }));
    }
  }
  function memberCard(panel, unit, target, queue, options = {}) {
    const card = element("article", "hud-attack-member");
    card.dataset.attackMember = unit.id;
    const header = element("header", "hud-attack-member-heading"),
      image = document.createElement("img"),
      stats = Rules.modelOf(unit);
    image.src = unitIcon(unit.model, unit.pilot);
    image.alt = unitName(unit);
    header.append(
      image,
      element("strong", "", unitName(unit)),
      element(
        "span",
        "",
        I18n.text("耐久") +
          ` ${formatNumber(unit.hp)} / ${formatNumber(stats.hp)} · EN ${formatNumber(unit.en)} / ${formatNumber(stats.en)}`,
      ),
    );
    const weapons = element("div", "hud-attack-member-weapons");
    rows(weapons, unit, target, queue, options);
    if (!queue.length)
      weapons.append(element("p", "helper", I18n.text(options.emptyMessage || "无可用武器")));
    card.append(header, weapons);
    const enUsed = queue.reduce((sum, w) => sum + (Rules.weaponStats(w, unit).en || 0), 0);
    header.append(element("small", "", `EN ${enUsed}/${unit.en}`));
    panel.append(card);
  }
  function renderSummary(panel, unit) {
    panel.replaceChildren();
    const order = unit && orderFor(unit);
    if (!order) return false;
    const target = getUnit(order.target);
    panel.append(
      element(
        "strong",
        "",
        I18n.text("自动交火") + " → " + (target ? targetLabel(target) : I18n.text("目标已不可见")),
      ),
    );
    return true;
  }
  function render(panel, unit, canCommand) {
    if (current) current.cache = {};
    if(unit && hasPlan(unit) && editable(unit) && Net.active) {
      const remove=element("button","","取消攻击计划");
      remove.id="cancelConfirmedAttack";remove.disabled=!canCommand;
      remove.onclick=()=>cancelPlan(unit);panel.append(remove);
    }
    const target = targetFor(unit);
    if (!target || target.hp <= 0) {
      if (current) reset();
      renderSummary(panel, unit);
      for (const member of unit ? members(unit) : []) {
        const order = Rules.attackOrders(member)[0],
          plannedTarget = order && getUnit(order.target);
        if (plannedTarget)
          memberCard(
            panel,
            member,
            plannedTarget,
            (order.weapons || [order.weapon]).map((id) => getWeapon(member, id)).filter(Boolean),
          );
      }
      if (mode !== "attack-target") {
        const startButton = element("button", "", "选择攻击目标");
        startButton.id = "startAttackTarget";
        startButton.disabled = !canCommand || !game.units.some((t) => canTarget(unit, t));
        startButton.onclick = () => start(unit);
        panel.append(startButton);
        return;
      }
      const picker=element("div","hud-attack-editor");picker.id="attackEditor";
      const remove=panel.querySelector("#cancelConfirmedAttack");
      if(remove)picker.append(remove);
      panel.append(picker);panel=picker;
      panel.append(element("p", "helper", "选择目标后自动使用所有可用且符合射程的武器。"));
      const seen = new Set();
      for (const enemy of game.units.filter((t) => canTarget(unit, t))) {
        const squad = Rules.squadMembers(game, enemy),
          key = squad.map((member) => member.id).join(":");
        if (seen.has(key)) continue;
        seen.add(key);
        const button = element(
          "button",
          "target-button",
          unitName(enemy) +
            (squad.length > 1 ? ` · ${I18n.text("小队")} ${squad.length}` : "") +
            " · " +
            Rules.dist(unit, enemy) +
            I18n.text("格"),
        );
        button.dataset.attackTarget = enemy.id;
        button.disabled = !canCommand;
        button.onclick = () => choose(unit, enemy);
        panel.append(button);
      }
      return;
    }
    const editor = element("div", "hud-attack-editor");
    editor.id = "attackEditor";
    const heading = element("div", "hud-attack-heading"),
      list = element("section", "hud-attack-planned");
    heading.append(
      element("strong", "", I18n.text("目标：") + targetLabel(target)),
      element("p", "helper", "按类型轮数自动使用可用武器，不消耗AP；射击结束后进行格斗。"),
    );
    const queue = [];
    for (const member of members(unit)) {
      const weapons = memberPlan(member, target).weapons;
      queue.push(...weapons);
      memberCard(list, member, target, weapons);
    }
    const actions = element("div", "hud-attack-confirm"),
      confirm = element("button", "", "确认攻击计划");
    confirm.id = "confirmAttackQueue";
    confirm.disabled = !canCommand || !queue.length;
    confirm.onclick = () => {
      try {
        if (Net.active)
          Net.request("attack", {
            unitId: unit.id,
            targetId: target.id,
            combatMode: squadCombatMode,
            single: squadSingleMove,
          });
        else beginAttack(unit, target, queue[0], queue);
        reset();
        selected = null;
        weaponId = null;
        mode = "select";
        update();
      } catch (error) {
        note(error.message);
      }
    };
    const cancel = element("button", "", "取消");
    cancel.onclick = () => {
      reset();
      mode = "select";
      update();
    };
    const change=element("button","","更换目标");
    change.id="changeConfirmedTarget";change.disabled=!canCommand;
    change.onclick=()=>{reset();mode="attack-target";update();window.BattleHUD?.setTab("weapons");};
    actions.append(confirm,change,cancel);
    const remove=panel.querySelector("#cancelConfirmedAttack");
    if(remove) actions.append(remove);
    editor.append(heading, list, actions);
    panel.append(editor);
  }
  return {
    memberCard,
    editable,
    hasPlan,
    cancelPlan,
    reset,
    draft,
    targetFor,
    facingTarget,
    canTarget,
    start,
    choose,
    render,
    renderSummary,
    mapDraft,
    changing: () => mode === "attack-target",
    resumeTarget: () => {
      const unit=getUnit(selected), order=unit && members(unit).flatMap(member=>Rules.attackOrders(member))[0];
      const target=order && getUnit(order.target);
      if(!current && target && canTarget(unit,target)) {choose(unit,target);return;}
      mode=current ? "attack-weapons" : "select";
      update();
    },
  };
})();
