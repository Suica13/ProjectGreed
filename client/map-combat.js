/* 大地图交战演出：使用地图坐标和已裁定逐发结果，不修改权威战局。 */
const MapCombat = (() => {
  const restingPoses = new Map();
  const visibleActors = new Set();
  const displayed = new Map(),
    unitStartDelays = new Map();
  let frame = null,
    lanes = [];
  const initialHp = new Map(),
    initialShield = new Map(),
    initialEn = new Map(),
    initialParts = new Map();
  const clone = (value) => JSON.parse(JSON.stringify(value));
  function reset() {
    displayed.clear();
    visibleActors.clear();
    restingPoses.clear();
    unitStartDelays.clear();
    frame = null;
    lanes = [];
    initialHp.clear();
    initialShield.clear();
    initialEn.clear();
    initialParts.clear();
    byId("mapCombatControls").hidden = true;
  }
  function seed(battles) {
    for (const battle of battles) {
      for (const id of battle.visibleActorIds || []) visibleActors.add(id);
      for (const actor of battle.actors)
        if (!displayed.has(actor.id)) displayed.set(actor.id, clone(actor));
    }
  }
  function begin(view, random = Math.random) {
    frame = null;
    view.mapBattle = true;
    const now = performance.now();
    // 每台执行攻击或反击的单位独立抽取一次，本地随机数不使用战斗判定 seed。
    unitStartDelays.clear();
    for (const battle of view.battles || [])
      for (const event of battle.events)
        if (!unitStartDelays.has(event.from)) unitStartDelays.set(event.from, random());
    lanes = (view.battles || []).map((battle) => ({
      view: { ...battle, index: 0, displayHp: { ...battle.before }, start: now },
      delayElapsed: 0,
      delayAt: now,
      started: false,
      frame: null,
      finished: [],
      dependencies: new Map(),
    }));
    // 不同交战仍并行。致命攻击需等待该单位此前已结算的交战（含合法反击）播完，
    // 防止慢弹道的早期反击晚于另一条战线的死亡爆炸出现。
    const earlier = [];
    for (const lane of lanes)
      lane.view.events.forEach((event, index) => {
        const queueDependencies = earlier.filter(
          (entry) =>
            entry.lane !== lane &&
            lane.view.attackQueue?.length > 1 &&
            entry.lane.view.attackQueue?.attacker === lane.view.attackQueue.attacker,
        );
        if (
          queueDependencies.length ||
          (event.after <= 0 && event.before > 0) ||
          event.brokenParts?.length
        )
          lane.dependencies.set(index, [
            ...queueDependencies,
            ...earlier.filter(
              (entry) =>
                entry.lane !== lane &&
                (entry.event.from === event.to ||
                  (event.after <= 0 && entry.event.to === event.to)),
            ),
          ]);
        earlier.push({ lane, index, event });
      });
    for (const [id, unit] of displayed) {
      initialHp.set(id, unit.hp);
      initialShield.set(id, unit.shield);
      initialEn.set(id, unit.en);
      initialParts.set(id, { ...unit.brokenParts });
    }
    byId("mapQuick").checked = byId("quick").checked;
    byId("battle").hidden = true;
    byId("mapCombatControls").hidden = false;
    // 演出沿用玩家当前的镜头位置与倍率。
  }
  function setup(view) {
    const event = { ...view.events[view.index] };
    const previousPoses = poses();
    const actors = [event.from, event.to].map((id) => {
      const unit = displayed.get(id) || view.actors.find((unit) => unit.id === id);
      return {
        unit,
        x: (Rules.center(unit).x + 0.5) * 64,
        y: (Rules.center(unit).y + 0.5 + EnvironmentVisuals.pose(unit, unit).offset) * 64,
        scale:
          1.2 *
          (BattleScene.settings().mapScale / (ART.presentation.mapCellScale || 1)) *
          Rules.modelOf(unit).presentation.mapScale,
        projectileForwardOffset: 0,
        arenaWidth: Rules.mapWidth(game) * 64,
        arenaHeight: Rules.mapHeight(game) * 64,
      };
    });
    const [source, target] = actors;
    // Use the actual visible dodge position across weapon queues and counter delays.
    for (const [actor, field] of [
      [source, "sourceDodgeSlot"],
      [target, "targetDodgeSlot"],
    ]) {
      const previous = previousPoses.get(actor.unit.id);
      if (previous)
        event[field] = Math.max(
          -1,
          Math.min(1, (previous.y - actor.y) / (ART.presentation.dodgeDistance * actor.scale)),
        );
    }
    const aim = (Math.atan2(target.x - source.x, -(target.y - source.y)) * 180) / Math.PI;
    source.angle = Rules.modelOf(source.unit).ship ? source.unit.angle : aim;
    source.aimAngle = aim;
    source.unit.aimAngle = aim;
    target.angle = Rules.modelOf(target.unit).ship ? target.unit.angle : aim + 180;
    const weapon = Rules.eventWeapon(source.unit, event);
    const plan = WeaponEffects.plan(weapon, source, target, event);
    frame = { view, index: view.index, event, source, target, weapon, plan, time: 0 };
    byId("mapCombatStatus").textContent = event.effectsOnly
      ? I18n.text("战斗演出")
      : `${unitName(source.unit)} → ${event.empty ? "空地" : unitName(target.unit)} · ${weapon.name}`;
    return frame;
  }
  function commit(view, parallel = false) {
    for (const [id, pose] of framePoses())
      restingPoses.set(id, {
        x: pose.x,
        y: pose.y,
        angle: pose.angle,
        clip: null,
        time: 0,
        moving: false,
        hidden: pose.hidden,
      });
    const event = view.events[view.index],
      target = displayed.get(event.to),
      source = displayed.get(event.from);
    if (target) {
      if (event.targetModelAfter) target.model = event.targetModelAfter;
      if (event.overdriveEnded) delete target.overdrive;
      const finalStrike = event.strikes?.at(-1);
      if (finalStrike?.flyingAfter !== undefined) target.flying = finalStrike.flyingAfter;
      target.hp = event.after;
      target.shield = event.shieldAfter ?? target.shield;
      if (event.partsAfter) target.brokenParts = { ...event.partsAfter };
    }
    // EN 的显示以此次交战结束值为准；最终状态仍由服务端快照覆盖。
    if (source)
      source.en = Math.max(
        0,
        source.en - (event.energySpent ?? getWeapon(source, event.weapon).en),
      );
    if (source && frame && !Rules.modelOf(source).ship) source.angle = frame.source.angle;
    if (target && frame && !Rules.modelOf(target).ship) target.angle = frame.target.angle;
    view.displayHp[event.to] = event.after;
    view.index++;
    frame = null;
    if (!parallel) WeaponAudio.releaseBattle();
    if (view.index >= view.events.length) {
      view.completed = true;
      if (!parallel) CombatPlayback.finish();
    } else view.start = performance.now();
  }
  function updateSingle(now) {
    const view = battleView;
    if (!view?.mapBattle || view.suspendedAt !== undefined || pageView !== "game") return;
    const current = frame?.view === view && frame.index === view.index ? frame : setup(view);
    const rate = window.ReplayPlayer?.active ? 1 : byId("quick").checked ? 1 / 0.35 : 1;
    // 累积时间允许播放中切换速度，不会令演出倒退或重复触发音效。
    current.time += (Math.max(0, now - (current.lastNow ?? now)) / 1000) * rate;
    current.lastNow = now;
    WeaponAudio.setBattleMuted(byId("quick").checked);
    WeaponAudio.sync(view, view.index, current.weapon, current.time, rate, current.plan.cues);
    if (current.time >= current.plan.duration) commit(view);
  }
  function framePoses() {
    const result = new Map();
    if (!frame || !battleView?.mapBattle) return result;
    const { source, target, plan, event, weapon, time } = frame;
    const animation = WeaponEffects.firingPose(
      weapon,
      source,
      event,
      Math.max(0, time - plan.lead) * plan.actionSpeed,
    );
    // 沿地图中的真实两点接近，适用于任意朝向的格斗。
    const distance = Math.hypot(target.x - source.x, target.y - source.y);
    const gap = Math.min(distance * 0.45, 20 * (source.scale + target.scale));
    const smooth = (value) => (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, value)))) / 2;
    let progress = 0,
      stage = "attack",
      stageTime = time;
    if (plan.melee) {
      const { approach, retreatAt, retreat } = plan.melee;
      progress =
        time < approach
          ? smooth(time / approach)
          : time < retreatAt
            ? 1
            : 1 - smooth((time - retreatAt) / retreat);
      stage = time < approach ? "approach" : time < retreatAt ? "attack" : "return";
      stageTime = time < approach ? time : Math.max(0, time - retreatAt);
      if (time >= retreatAt + retreat) stage = "rest";
    }
    const reach = Math.max(0, distance - gap) * progress;
    const moving = plan.melee && ["approach", "return"].includes(stage);
    let sourcePose = {
      targetId: target.unit.id,
      x: animation.x + (distance ? ((target.x - source.x) / distance) * reach : 0),
      y:
        animation.y +
        (distance ? ((target.y - source.y) / distance) * reach : 0) -
        plan.sourceY * progress,
      angle: source.angle,
      aimAngle: source.aimAngle,
      clip: moving
        ? SpriteRenderer.movement(source.unit.model)
        : stage === "rest"
          ? null
          : animation.clip,
      time: moving ? stageTime : animation.time,
      moving,
      heldWeapon: event.heldWeapon ?? event.weapon,
      attackWeapon: event.weapon,
      weaponDisplayIndex: animation.weaponDisplayIndex,
      attacking: time >= plan.lead && time <= plan.lead + weapon.attack.duration / plan.actionSpeed,
    };
    if (plan.bomb)
      sourcePose = {
        ...sourcePose,
        ...WeaponEffects.bombPose(plan, time, source, target),
        clip: SpriteRenderer.movement(source.unit.model),
        moving: true,
      };
    const dodge = WeaponEffects.dodge(event, plan, time, source, target);
    const arrived = WeaponEffects.arrived(plan, time),
      latest = arrived.at(-1);
    const stagger = latest?.hit && time < latest.at + 0.18;
    const hp = WeaponEffects.health(event, plan, time, target.unit.hp);
    const dying = plan.deathSoundAt !== null && time >= plan.deathSoundAt;
    result.set(source.unit.id, sourcePose);
    result.set(target.unit.id, {
      model: latest?.modelAfter ?? target.unit.model,
      flying: latest?.flyingAfter ?? !!target.unit.flying,
      x: target.x + dodge.x,
      y: target.y + dodge.y,
      angle: target.angle,
      clip: dodge.active
        ? Rules.modelOf(target.unit).presentation.dodge
        : stagger
          ? Rules.modelOf(target.unit).presentation.stagger
          : null,
      time: dodge.active
        ? dodge.time * ART.presentation.animationSpeed
        : latest
          ? (time - latest.at) * ART.presentation.animationSpeed
          : 0,
      moving: dodge.active,
      hp,
      shield: WeaponEffects.shield(event, plan, time, target.unit.shield),
      dying,
      keepVisible: plan.deathHideAt !== null && time < plan.deathHideAt,
      hidden: plan.deathHideAt !== null && time >= plan.deathHideAt,
      dodge,
      sourcePose,
    });
    return result;
  }
  // 每个攻击计划有自己的时间轴；不同交战同时推进，单场中的反击仍在受击后开始。
  function update(now) {
    if (!lanes.length) return updateSingle(now);
    if (!battleView?.mapBattle || battleView.suspendedAt !== undefined || pageView !== "game")
      return;
    const rate = window.ReplayPlayer?.active ? 1 : byId("quick").checked ? 1 / 0.35 : 1;
    WeaponAudio.setBattleMuted(byId("quick").checked);
    for (const lane of lanes) {
      if (lane.view.completed) continue;
      const dependencies = lane.dependencies.get(lane.view.index) || [];
      if (dependencies.some((entry) => entry.lane.view.index <= entry.index)) {
        lane.delayAt = now;
        continue;
      }
      if (!lane.started) {
        lane.delayElapsed += (Math.max(0, now - lane.delayAt) / 1000) * rate;
        lane.delayAt = now;
        const startDelay = unitStartDelays.get(lane.view.events[lane.view.index].from) || 0;
        if (lane.delayElapsed < startDelay) continue;
        lane.started = true;
        lane.frame = setup(lane.view);
        // 保留跨越起播时刻的这一帧时间，低帧率下也不会把延迟额外拉长。
        lane.frame.lastNow = now - ((lane.delayElapsed - startDelay) * 1000) / rate;
      }
      frame = lane.frame || setup(lane.view);
      frame.time += (Math.max(0, now - (frame.lastNow ?? now)) / 1000) * rate;
      frame.lastNow = now;
      frame.heard ||= new Set();
      for (const [index, cue] of frame.plan.cues.entries())
        if (cue.at <= frame.time && !frame.heard.has(index)) {
          frame.heard.add(index);
          if (!byId("quick").checked) WeaponAudio.play(cue.sound, undefined, 1, "battle");
        }
      lane.frame = frame;
      if (frame.time >= frame.plan.duration) {
        lane.finished.push(frame);
        commit(lane.view, true);
        lane.frame = null;
        // 先攻结束后，反击由反击单位自己的随机延迟决定起播时间。
        lane.started = false;
        lane.delayElapsed = 0;
        lane.delayAt = now;
      }
    }
    frame = lanes.find((lane) => !lane.view.completed)?.frame || null;
    byId("mapCombatStatus").textContent =
      I18n.text("交战演出") +
      " · " +
      lanes.filter((lane) => !lane.view.completed).length +
      "/" +
      lanes.length;
    if (lanes.every((lane) => lane.view.completed)) {
      battleView.completed = true;
      WeaponAudio.releaseBattle();
      CombatPlayback.finish();
    }
  }
  function poses() {
    if (!lanes.length) return new Map([...restingPoses, ...framePoses()]);
    const result = new Map(restingPoses),
      priority = new Map(),
      saved = frame;
    for (const lane of lanes)
      if (lane.frame && !lane.view.completed) {
        frame = lane.frame;
        for (const [id, pose] of framePoses()) {
          const weight = pose.hidden ? 4 : pose.dying ? 3 : id === frame.event.from ? 2 : 1;
          if ((priority.get(id) || 0) <= weight) {
            result.set(id, pose);
            priority.set(id, weight);
          }
        }
      }
    frame = saved;
    return result;
  }
  function health(id, shield = false) {
    let value = (shield ? initialShield : initialHp).get(id);
    if (value === undefined) return undefined;
    for (const lane of lanes)
      for (const item of [...lane.finished, ...(lane.frame ? [lane.frame] : [])])
        if (item.event.to === id)
          value -= WeaponEffects.arrived(item.plan, item.time).reduce(
            (sum, contact) => sum + (shield ? contact.shieldDamage || 0 : contact.damage),
            0,
          );
    return Math.max(0, value);
  }
  function energy(id) {
    let value = initialEn.get(id);
    if (value === undefined) return undefined;
    for (const lane of lanes)
      for (const item of [...lane.finished, ...(lane.frame ? [lane.frame] : [])])
        if (item.event.from === id && item.time >= (item.plan.shots[0]?.at ?? 0))
          value -= item.weapon.en;
    return Math.max(0, value);
  }
  function draw(ctx, geometry, underlay = false) {
    if (!lanes.length) drawSingle(ctx, geometry, underlay);
    else {
      const saved = frame;
      for (const lane of lanes)
        if (lane.frame && !lane.view.completed) {
          frame = lane.frame;
          drawSingle(ctx, geometry, underlay);
        }
      frame = saved;
    }
  }
  function visibleParts(unit) {
    const state = { ...(initialParts.get(unit.id) || unit.brokenParts) };
    const items = lanes.length
      ? lanes.flatMap((lane) => [...lane.finished, ...(lane.frame ? [lane.frame] : [])])
      : frame
        ? [frame]
        : [];
    for (const item of items)
      if (item.event.to === unit.id)
        for (const contact of WeaponEffects.arrived(item.plan, item.time))
          for (const part of contact.brokenParts || []) state[part] = true;
    return state;
  }
  function units() {
    const pose = poses();
    const pendingExits = new Set(),
      visibleExits = new Set();
    for (const lane of lanes) {
      for (const event of lane.view.events)
        for (const exit of event.evacuations || []) pendingExits.add(exit.unitId);
      for (const item of [...lane.finished, ...(lane.frame ? [lane.frame] : [])])
        if (
          item.time >= item.plan.duration ||
          WeaponEffects.arrived(item.plan, item.time).some((contact) => contact.after <= 0)
        )
          for (const exit of item.event.evacuations || []) visibleExits.add(exit.unitId);
    }
    // Actors were authorized when combat happened. The final fog snapshot can
    // omit them after a scout dies; keep them only for this playback's lifetime.
    const roster = new Map(game.units.map((unit) => [unit.id, unit]));
    for (const [id, unit] of displayed)
      if (!roster.has(id) && visibleActors.has(id) && !unit.visualOnly) roster.set(id, unit);
    return [...roster.values()]
      .filter((u) => !u.embarked && (!pendingExits.has(u.id) || visibleExits.has(u.id)))
      .map((unit) => {
        const visual = displayed.get(unit.id) || unit;
        const effect = pose.get(unit.id);
        return {
          ...visual,
          brokenParts: visibleParts(visual),
          hp: (lanes.length ? health(unit.id) : effect?.hp) ?? visual.hp,
          shield: (lanes.length ? health(unit.id, true) : effect?.shield) ?? visual.shield,
          en: (lanes.length ? energy(unit.id) : undefined) ?? visual.en,
          model: effect?.model ?? unit.model,
          mapDying: effect?.keepVisible,
          mapPose: effect,
        };
      });
  }
  function drawSingle(ctx, geometry, underlay = false) {
    if (!frame || !battleView?.mapBattle) return;
    const { plan, event, source, target, time, weapon } = frame;
    if (underlay && weapon.projectile?.motion !== "tether") return;
    const pose = framePoses(),
      targetPose = pose.get(target.unit.id),
      sourcePose = pose.get(source.unit.id);
    ctx.save();
    ctx.translate(geometry.ox, geometry.oy);
    ctx.scale(geometry.tile / 64, geometry.tile / 64);
    const facing = Math.atan2(target.y - source.y, target.x - source.x);
    WeaponEffects.draw(
      ctx,
      weapon,
      plan,
      time,
      source,
      event,
      1,
      sourcePose,
      underlay ? "underlay" : "foreground",
    );
    if (underlay) {
      ctx.restore();
      return;
    }
    for (const [index, contact] of plan.contacts.entries()) {
      if (weapon.swingEffects?.length)
        SpriteEffects.draw(
          ctx,
          weapon.swingEffects[index % weapon.swingEffects.length],
          sourcePose.x,
          sourcePose.y,
          source.scale,
          (time - contact.at) * plan.actionSpeed,
          facing,
        );
      if (
        contact.hit ||
        weapon.projectile?.motion === "mortar" ||
        weapon.projectile?.motion === "bomb"
      )
        SpriteEffects.draw(
          ctx,
          weapon.hitEffect,
          target.x,
          target.y +
            WeaponEffects.position(plan, contact.at) *
              target.scale *
              ART.presentation.dodgeDistance,
          target.scale,
          (time - contact.at) * ART.presentation.animationSpeed,
          facing,
        );
    }
    if (targetPose.dying && !targetPose.hidden)
      SpriteEffects.draw(
        ctx,
        plan.deathElectricEffect,
        targetPose.x,
        targetPose.y,
        target.scale,
        time - plan.deathSoundAt,
      );
    if (plan.deathAt !== null)
      WeaponEffects.drawDeath(
        ctx,
        plan.deathEvents,
        target.unit,
        targetPose.x,
        targetPose.y,
        target.scale,
        (time - plan.deathAt) * ART.presentation.animationSpeed,
      );
    const contacts = WeaponEffects.arrived(plan, time),
      latest = contacts.at(-1);
    if (
      !event.effectsOnly &&
      !window.ReplayPresentation?.immersive &&
      latest &&
      time < latest.at + 0.65
    ) {
      ctx.font = "bold 12px system-ui";
      ctx.textAlign = "center";
      ctx.fillStyle = latest.hit ? "#ffe7aa" : "#b9dbe8";
      ctx.fillText(
        latest.hit
          ? "-" + contacts.reduce((sum, c) => sum + c.damage, 0).toLocaleString("en-US")
          : "MISS",
        targetPose.x,
        targetPose.y - 32,
      );
    }
    const partContact = contacts.filter((contact) => contact.brokenParts?.length).at(-1);
    if (
      !event.effectsOnly &&
      !window.ReplayPresentation?.immersive &&
      partContact &&
      time < partContact.at + 1.2
    ) {
      ctx.font = "bold 12px system-ui";
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffad65";
      ctx.fillText(
        partContact.brokenParts.map((part) => I18n.text(Rules.partNames[part])).join(" / ") +
          " · " +
          I18n.text("部位破坏"),
        targetPose.x,
        targetPose.y - 48,
      );
    }
    ctx.restore();
  }
  byId("mapQuick").onchange = () => {
    byId("quick").checked = byId("mapQuick").checked;
  };
  byId("mapSkipBattle").onclick = () => {
    if (!battleView?.mapBattle) return;
    WeaponAudio.stopBattle();
    if (lanes.length) {
      battleView.completed = true;
      CombatPlayback.finish();
    } else {
      const view = battleView;
      for (; view.index < view.events.length - 1; view.index++) {
        const event = view.events[view.index],
          target = displayed.get(event.to);
        if (target) target.hp = event.after;
      }
      commit(view);
    }
  };
  function suspend(view) {
    view.suspendedAt ??= performance.now();
  }
  function resume(view) {
    if (view.suspendedAt !== undefined) {
      delete view.suspendedAt;
      const now = performance.now();
      if (frame) frame.lastNow = now;
      for (const lane of lanes) {
        lane.delayAt = now;
        if (lane.frame) lane.frame.lastNow = now;
      }
    }
  }
  return {
    reset,
    seed,
    begin,
    update,
    units,
    draw,
    drawUnderlay: (ctx, geometry) => draw(ctx, geometry, true),
    suspend,
    resume,
    get frames() {
      return lanes.filter((lane) => lane.frame && !lane.view.completed).map((lane) => lane.frame);
    },
    get frame() {
      return frame;
    },
  };
})();
