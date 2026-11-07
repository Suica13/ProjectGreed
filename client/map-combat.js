/* 大地图交战演出：使用地图坐标和已裁定逐发结果，不修改权威战局。 */
const MapCombat = (() => {
  const restingPoses = new Map(),
    meleeExchanges = new Map();
  const dodgeTracks = new Map();
  const facingTargets = new Map();
  const formationOffsets = new Map();
  const pendingExits = new Set(), startedActors = new Set();
  let stateCache = null, poseCache = new WeakMap(), contactCache = new WeakMap(), setupPoses = null;
  function invalidateFrame() {
    stateCache = null;
    poseCache = new WeakMap();
    contactCache = new WeakMap();
    setupPoses = null;
  }
  function contactsFor(item) {
    const cached = contactCache.get(item);
    if (cached?.time === item.time) return cached.contacts;
    const contacts = WeaponEffects.arrived(item.plan,item.time);
    contactCache.set(item,{time:item.time,contacts});
    return contacts;
  }
  let dodgeClock = 0,
    dodgeLastNow = null;
  const visibleActors = new Set();
  const displayed = new Map(),
    unitStartDelays = new Map();
  let frame = null,
    lanes = [];
  const initialHp = new Map(),
    initialShield = new Map(),
    initialEn = new Map(),
    initialParts = new Map(),
    initialIField = new Map();
  const clone = (value) => JSON.parse(JSON.stringify(value));
  function reset() {
    invalidateFrame();
    pendingExits.clear();
    startedActors.clear();
    displayed.clear();
    meleeExchanges.clear();
    visibleActors.clear();
    restingPoses.clear();
    dodgeTracks.clear();
    facingTargets.clear();
    formationOffsets.clear();
    dodgeClock = 0;
    dodgeLastNow = null;
    unitStartDelays.clear();
    frame = null;
    lanes = [];
    initialHp.clear();
    initialShield.clear();
    initialEn.clear();
    initialParts.clear();
    initialIField.clear();
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
    invalidateFrame();
    pendingExits.clear();
    startedActors.clear();
    frame = null;
    view.mapBattle = true;
    // The authoritative snapshot already contains combat deaths. Keep the initial
    // visible roster's slots until playback ends, rather than stacking dead members
    // at slot zero or reflowing survivors midway through counterfire.
    const roster = new Map(game.units.map((unit) => [unit.id, unit]));
    for (const [id, unit] of displayed) roster.set(id, unit);
    const visualGame = { ...game, units: [...roster.values()] };
    formationOffsets.clear();
    const groups = new Map();
    for (const unit of visualGame.units) {
      if (!unit.squadId) continue;
      if (!groups.has(unit.squadId)) groups.set(unit.squadId, []);
      groups.get(unit.squadId).push(unit);
    }
    for (const unit of visualGame.units) {
      const group = unit.squadId ? { ...visualGame, units: groups.get(unit.squadId) } : visualGame;
      formationOffsets.set(unit.id, Rules.squadOffset(group, unit));
    }
    meleeExchanges.clear();
    for (const battle of view.battles || [])
      if (battle.meleeExchange) {
        const pair = battle.meleeExchange;
        meleeExchanges.set(pair.id || pair.attacker + ":" + pair.defender, pair);
      }
    const now = performance.now();
    dodgeTracks.clear();
    facingTargets.clear();
    dodgeClock = 0;
    // Initial UI and asset preparation must never consume the opening volley.
    // Establish the playback epoch only when a map frame can actually be shown.
    dodgeLastNow = null;
    // 每台执行攻击或反击的单位独立抽取一次，本地随机数不使用战斗判定 seed。
    unitStartDelays.clear();
    for (const battle of view.battles || [])
      for (const event of battle.events)
        if (!unitStartDelays.has(event.from)) unitStartDelays.set(event.from, random() * 0.12);
    // A nuclear launch produces one damage record per victim, but one visual blast.
    for (const battle of view.battles || [])
      for (const event of battle.events)
        for (const exit of event.evacuations || []) pendingExits.add(exit.unitId);
    const nuclearLaunches = new Map();
    const orderedBattles = [...(view.battles || [])].sort((a, b) =>
      Number.isInteger(a.combatWave) && Number.isInteger(b.combatWave)
        ? a.combatWave - b.combatWave ||
          Number(a.combatStage === "counter") - Number(b.combatStage === "counter")
        : 0,
    );
    // A mortar victim may die on the first shell. Use the longest surviving
    // victim lane for the shared salvo's visuals, so later shells stay visible.
    for (const battle of orderedBattles)
      for (const event of battle.events) {
        if (!event.blastId || !event.impactCell) continue;
        const previous = nuclearLaunches.get(event.blastId);
        if (!previous || (event.shotIndices?.length || 1) > (previous.shotIndices?.length || 1))
          nuclearLaunches.set(event.blastId, event);
      }
    const visualBattles = orderedBattles.map((battle) => ({
      ...battle,
      events: battle.events.map((event) => {
        const actor = displayed.get(event.from) || battle.actors.find((u) => u.id === event.from);
        if (
          !actor ||
          !event.impactCell ||
          !["nuke", "blast"].includes(Rules.eventWeapon(actor, event)?.special?.type)
        )
          return event;
        const key = event.blastId || JSON.stringify([event.from, event.weapon, event.impactCell]);
        const representative = nuclearLaunches.get(key);
        const nuclearFollowup = !!representative && representative !== event;
        if (!representative) nuclearLaunches.set(key, event);
        return { ...event, nuclearFollowup };
      }),
    }));
    lanes = visualBattles.map((battle) => ({
      view: { ...battle, index: 0, displayHp: { ...battle.before }, start: now },
      delayElapsed: 0,
      delayAt: null,
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
        if (lane.view.crossfire) return;
        const queueDependencies = earlier.filter(
          (entry) =>
            entry.lane !== lane &&
            lane.view.attackQueue?.length > 1 &&
            entry.lane.view.attackQueue?.attacker === lane.view.attackQueue.attacker,
        );
        const waveDependencies = Number.isInteger(lane.view.combatWave)
          ? earlier.filter(
              (entry) =>
                entry.lane !== lane &&
                (entry.lane.view.combatWave < lane.view.combatWave ||
                  (entry.lane.view.combatWave === lane.view.combatWave &&
                    lane.view.combatStage === "counter" &&
                    entry.lane.view.combatStage !== "counter")),
            )
          : lane.view.combatStage === "counter"
            ? earlier.filter(
                (entry) => entry.lane !== lane && entry.lane.view.combatStage !== "counter",
              )
            : [];
        if (
          waveDependencies.length ||
          queueDependencies.length ||
          (event.after <= 0 && event.before > 0) ||
          event.brokenParts?.length
        )
          lane.dependencies.set(index, [
            ...waveDependencies,
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
    const firstFieldHealth = new Map();
    for (const battle of view.battles || [])
      for (const event of battle.events)
        if (event.iFieldBefore !== undefined && !firstFieldHealth.has(event.to))
          firstFieldHealth.set(event.to,event.iFieldBefore);
    for (const [id, unit] of displayed) {
      initialHp.set(id, unit.hp);
      initialShield.set(id, unit.shield);
      initialEn.set(id, unit.en);
      initialIField.set(
        id,
        unit.iFieldHp ?? firstFieldHealth.get(id) ?? 0,
      );
      initialParts.set(id, { ...unit.brokenParts });
    }
    byId("mapQuick").checked = byId("quick").checked;
    byId("battle").hidden = true;
    byId("mapCombatControls").hidden = false;
    // 演出沿用玩家当前的镜头位置与倍率。
  }
  function formationOffset(unit, facing = null, members = null) {
    if (battleView?.mapBattle && unit.embarked?.exposed) {
      const carrier = displayed.get(unit.embarked.carrierId);
      const slot = carrier && Rules.hangars.of(carrier).find(h => h.id === unit.embarked.hangarId);
      if (slot) {
        const parent = formationOffset(carrier);
        const angle = (facing ?? carrier.angle ?? 0) * Math.PI / 180;
        const scale = ART.presentation.unitMapScale * BattleScene.settings().mapScale /
          (ART.presentation.mapCellScale || 1) * Rules.modelOf(carrier).presentation.mapScale / Rules.mapCellPixels;
        const {x,y,height} = slot.offset;
        return {x:parent.x+(x*Math.cos(angle)+y*Math.sin(angle))*scale,
          y:parent.y+(x*Math.sin(angle)-y*Math.cos(angle)-height)*scale,scale:1};
      }
    }
    return (
      (battleView?.mapBattle && formationOffsets.get(unit.id)) ||
      Rules.squadOffset(game, unit, facing, members)
    );
  }
  function meleeAnchor(pair) {
    const a = displayed.get(pair.attacker),
      b = displayed.get(pair.defender);
    if (!a || !b) return null;
    const point = (u) => ({
      x: (Rules.center(u).x + 0.5 + formationOffset(u).x) * Rules.mapCellPixels,
      y:
        (Rules.center(u).y + 0.5 + formationOffset(u).y + EnvironmentVisuals.pose(u, u).offset) *
        Rules.mapCellPixels,
    });
    const origin = point(a),
      target = point(b),
      distance = Math.hypot(target.x - origin.x, target.y - origin.y);
    const scale = (u) =>
      ART.presentation.unitMapScale *
      (BattleScene.settings().mapScale / (ART.presentation.mapCellScale || 1)) *
      Rules.modelOf(u).presentation.mapScale *
      formationOffset(u).scale;
    const gap = Math.min(distance * 0.45, 20 * (scale(a) + scale(b))),
      ratio = distance ? Math.max(0, 1 - gap / distance) : 0;
    return {
      origin,
      target,
      engaged: {
        x: origin.x + (target.x - origin.x) * ratio,
        y: origin.y + (target.y - origin.y) * ratio,
      },
      angle: (Math.atan2(target.x - origin.x, -(target.y - origin.y)) * 180) / Math.PI,
    };
  }
  function meleePoses(result) {
    const current = new Map();
    for (const pair of meleeExchanges.values())
      if (pair.start <= dodgeClock && (!current.has(pair.attacker) || pair.start > current.get(pair.attacker).start))
        current.set(pair.attacker, pair);
    for (const pair of meleeExchanges.values()) {
      if (current.get(pair.attacker) !== pair) continue;
      if (dodgeClock < pair.start) continue;
      const anchor = meleeAnchor(pair);
      if (!anchor) continue;
      // The approach/hold interval can have no active firing lane. Sample the
      // shared dodge track here too, so counterfire cannot suddenly add an old
      // ranged dodge that was missing while only choreography was visible.
      const track = dodgeTracks.get(pair.attacker);
      const dodge = track ? WeaponEffects.dodge(
        null, {moves:track.moves, initialSlot:track.initialSlot}, dodgeClock,
        null, {unit:displayed.get(pair.attacker), scale:track.base.scale},
      ) : result.get(pair.attacker)?.dodge;
      if (dodgeClock > pair.end) {
        const pose = result.get(pair.attacker);
        if (pose && health(pair.attacker) > 0)
          result.set(pair.attacker, {
            ...pose,
            x: anchor.origin.x + (dodge?.x || 0),
            y: anchor.origin.y + (dodge?.y || 0),
          });
        continue;
      }
      const dead = health(pair.attacker) <= 0,
        approach = pair.approach || 0.35,
        retreat = pair.retreat || 0.35;
      let progress = dead
        ? 1
        : dodgeClock < pair.start + approach
          ? (dodgeClock - pair.start) / approach
          : dodgeClock < pair.end - retreat
            ? 1
            : Math.max(0, (pair.end - dodgeClock) / retreat);
      progress = (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, progress)))) / 2;
      const pose = result.get(pair.attacker) || {},
        moving = !dead && progress > 0 && progress < 1;
      result.set(pair.attacker, {
        ...pose,
        x: anchor.origin.x + (anchor.engaged.x - anchor.origin.x) * progress + (dodge?.x || 0),
        y: anchor.origin.y + (anchor.engaged.y - anchor.origin.y) * progress + (dodge?.y || 0),
        dodge,
        angle: anchor.angle,
        aimAngle: anchor.angle,
        moving: moving || !!pose.moving,
        ...(moving
          ? {
              clip: SpriteRenderer.movement(displayed.get(pair.attacker).model),
              time: dodgeClock - pair.start,
            }
          : {}),
        ...(dodgeClock >= pair.end && !dead ? { clip: null, moving: false } : {}),
      });
      const actor = displayed.get(pair.attacker);
      if (actor && !Rules.modelOf(actor).ship && !Rules.modelOf(actor).fixedWeaponFacing)
        actor.angle = actor.aimAngle = anchor.angle;
      const defender = displayed.get(pair.defender), defenderPose = result.get(pair.defender);
      if (defender && defenderPose && !defenderPose.firing &&
          !Rules.modelOf(defender).ship && !Rules.modelOf(defender).fixedWeaponFacing) {
        const facing = (anchor.angle + 180) % 360;
        defender.angle = defender.aimAngle = facing;
        result.set(pair.defender, { ...defenderPose, angle: facing, aimAngle: facing });
      }
    }
    return result;
  }
  function setup(view, start = dodgeClock) {
    const event = { ...view.events[view.index] };
    // Simultaneously starting lanes share the same previous rendered frame.
    // Rebuilding every active lane for each new lane makes startup quadratic.
    const previousPoses = setupPoses || (setupPoses = poses());
    const actors = [event.from, event.to].map((id) => {
      const unit = displayed.get(id) || view.actors.find((unit) => unit.id === id);
      return {
        unit,
        x: (Rules.center(unit).x + 0.5 + formationOffset(unit).x) * Rules.mapCellPixels,
        y:
          (Rules.center(unit).y +
            0.5 +
            formationOffset(unit).y +
            EnvironmentVisuals.pose(unit, unit).offset) *
          Rules.mapCellPixels,
        scale:
          ART.presentation.unitMapScale *
          (BattleScene.settings().mapScale / (ART.presentation.mapCellScale || 1)) *
          Rules.modelOf(unit).presentation.mapScale *
          formationOffset(unit).scale,
        arenaWidth: Rules.mapWidth(game) * Rules.mapCellPixels,
        arenaHeight: Rules.mapHeight(game) * Rules.mapCellPixels,
      };
    });
    for (const actor of actors) {
      actor.homeX = actor.x;
      actor.homeY = actor.y;
    }
    if (event.meleeExchange) {
      const anchor = meleeAnchor(event.meleeExchange);
      const attacker = actors.find((actor) => actor.unit.id === event.meleeExchange.attacker);
      if (anchor && attacker) Object.assign(attacker, anchor.engaged);
      const defender = actors.find((actor) => actor.unit.id === event.meleeExchange.defender);
      if (anchor && defender) Object.assign(defender, anchor.target);
    }
    const [source, target] = actors;
    // Use the actual visible dodge position across weapon queues and counter delays.
    for (const [actor, field] of [
      [source, "sourceDodgeSlot"],
      [target, "targetDodgeSlot"],
    ]) {
      const previous = previousPoses.get(actor.unit.id);
      // Closing into melee is choreography, not a dodge. Reinterpreting the
      // approach displacement as evasion teleports the attacker on counterfire.
      if (event.meleeExchange) {
        event[field] = (previous?.dodge?.y || 0) / (ART.presentation.dodgeDistance * actor.scale);
        if (field === "sourceDodgeSlot") event.sourceDodgeX = previous?.dodge?.x || 0;
        continue;
      }
      if (previous)
        event[field] = Math.max(
          -1.35,
          Math.min(1.35, (previous.y - actor.y) / (ART.presentation.dodgeDistance * actor.scale)),
        );
      if (previous && field === "sourceDodgeSlot") event.sourceDodgeX = previous.x - actor.x;
    }
    const weapon = Rules.eventWeapon(source.unit, event);
    const impact =
      ["nuke", "blast"].includes(weapon.special?.type) && event.impactCell
        ? {
            x: (event.impactCell.x + 0.5) * Rules.mapCellPixels,
            y: (event.impactCell.y + 0.5) * Rules.mapCellPixels,
          }
        : target;
    const firingX = source.x + (event.sourceDodgeX || 0);
    const firingY = source.y + (event.sourceDodgeSlot || 0) * ART.presentation.dodgeDistance * source.scale;
    const targetY = impact.y + (impact === target
      ? (event.targetDodgeSlot || 0) * ART.presentation.dodgeDistance * target.scale : 0);
    const aim = (Math.atan2(impact.x - firingX, -(targetY - firingY)) * 180) / Math.PI;
    const canTurn = unit => !Rules.modelOf(unit).ship && !Rules.modelOf(unit).fixedWeaponFacing;
    // Body, animated muzzle and projectile share the visible world-space target.
    // Ship hulls and fixed emplacements keep their facing and aim their turrets.
    if (canTurn(source.unit)) source.unit.angle = aim;
    if (canTurn(target.unit)) target.unit.angle = (aim + 180) % 360;
    source.angle = source.unit.angle;
    source.aimAngle = aim;
    source.unit.aimAngle = aim;
    facingTargets.set(event.from, event.to);
    target.angle = target.unit.angle;
    if (!dodgeTracks.has(event.to))
      dodgeTracks.set(event.to, {
        moves: [],
        initialSlot: event.targetDodgeSlot || 0,
        base: { x: target.homeX, y: target.homeY, scale: target.scale },
      });
    const plan = WeaponEffects.plan(weapon, source, target, event, {
      start,
      track: dodgeTracks.get(event.to),
    });
    frame = { view, index: view.index, event, source, target, weapon, plan, time: 0,
      shotsByIndex:new Map(plan.shots.map(shot=>[shot.index,shot])) };
    byId("mapCombatStatus").textContent = event.effectsOnly
      ? I18n.text("战斗演出")
      : `${unitName(source.unit)} → ${event.empty ? "空地" : unitName(target.unit)} · ${weapon.name}`;
    return frame;
  }
  function commit(view, parallel = false) {
    setupPoses = null;
    for (const [id, pose] of framePoses())
      restingPoses.set(id, {
        x: pose.x,
        y: pose.y,
        angle: pose.angle,
        clip: null,
        time: 0,
        moving: false,
        hidden: pose.hidden,
        heldWeapon: pose.heldWeapon,
        weaponDisplayIndex: pose.weaponDisplayIndex,
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
    if (source && frame) {
      const weapon = frame.weapon, finalDisplay = weapon.attack.displayStates?.at(-1)?.index;
      if (weapon.changeHeldWeapon !== false) source.heldWeapon = event.heldWeapon ?? event.weapon;
      if (finalDisplay !== undefined || weapon.changeHeldWeapon !== false)
        source.weaponDisplayIndex = finalDisplay ?? weapon.displayIndex ?? 0;
      const pose = restingPoses.get(source.id);
      if (pose) Object.assign(pose, { heldWeapon: source.heldWeapon, weaponDisplayIndex: source.weaponDisplayIndex });
    }
    if (source)
      source.en = Math.max(
        0,
        source.en - (event.energySpent ?? getWeapon(source, event.weapon).en),
      );
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
    const rate = MovementTiming.combatRate(byId("quick").checked, !!window.ReplayPlayer?.active);
    // 累积时间允许播放中切换速度，不会令演出倒退或重复触发音效。
    current.time += (Math.max(0, now - (current.lastNow ?? now)) / 1000) * rate;
    current.lastNow = now;
    WeaponAudio.setBattleMuted(byId("quick").checked);
    WeaponAudio.sync(view, view.index, current.weapon, current.time, rate, current.plan.cues);
    if (current.time >= current.plan.duration) commit(view);
  }
  function framePoses() {
    if (!frame) return new Map();
    const cached = poseCache.get(frame);
    if (cached?.time === frame.time) return cached.poses;
    const result = computeFramePoses();
    poseCache.set(frame, {time:frame.time, poses:result});
    return result;
  }
  function computeFramePoses() {
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
      firing: true,
      x:
        animation.x +
        (distance ? ((target.x - source.x) / distance) * reach : 0) -
        (plan.sourceX || 0) * progress,
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
      hiddenLayers: (plan.remotes || [])
        .filter(
          (path) =>
            time >= path.launch &&
            time < path.end &&
            plan.shots.some((shot) => shot.remoteIndex === path.index),
        )
        .flatMap((path) => path.unit.hideLayers || []),
      weaponDisplayIndex: animation.weaponDisplayIndex ?? (weapon.changeHeldWeapon === false ? source.unit.weaponDisplayIndex : weapon.displayIndex),
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
    const arrived = contactsFor(frame),
      latest = arrived.at(-1);
    const stagger = latest?.hit && time < latest.at + 0.18;
    const hp = Math.max(0, (event.before ?? target.unit.hp) - arrived.reduce((sum,c)=>sum+c.damage,0));
    const dying = plan.deathSoundAt !== null && time >= plan.deathSoundAt;
    if (!event.nuclearFollowup) result.set(source.unit.id, sourcePose);
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
      shield: Math.max(0, (event.shieldBefore ?? target.unit.shield) - arrived.reduce((sum,c)=>sum+(c.shieldDamage || 0),0)),
      dying,
      keepVisible: plan.deathHideAt !== null && time < plan.deathHideAt,
      hidden: plan.deathHideAt !== null && time >= plan.deathHideAt,
      dodge,
      sourcePose,
    });
    return result;
  }
  // 同一波全体单位并行；全部攻击演完才反击，全部反击演完才进入下一波。
  function update(now) {
    invalidateFrame();
    if (globalThis.BattleAssets?.loading) {
      dodgeLastNow = null;
      for (const lane of lanes) {
        lane.delayAt = now;
        if (lane.frame) lane.frame.lastNow = now;
      }
      if (frame) frame.lastNow = now;
      return;
    }
    const dodgeRate = MovementTiming.combatRate(
      byId("quick").checked,
      !!window.ReplayPlayer?.active,
    );
    if (battleView?.mapBattle && battleView.suspendedAt === undefined && pageView === "game")
      dodgeClock += (Math.max(0, now - (dodgeLastNow ?? now)) / 1000) * dodgeRate;
    dodgeLastNow = now;
    if (!lanes.length) return updateSingle(now);
    if (!battleView?.mapBattle || battleView.suspendedAt !== undefined || pageView !== "game")
      return;
    const rate = MovementTiming.combatRate(byId("quick").checked, !!window.ReplayPlayer?.active);
    WeaponAudio.setBattleMuted(byId("quick").checked);
    for (const lane of lanes) {
      if (lane.view.completed) continue;
      const dependencies = lane.dependencies.get(lane.view.index) || [];
      if (dependencies.some((entry) => entry.lane.view.index <= entry.index)) {
        lane.delayAt = now;
        continue;
      }
      if (!lane.started) {
        if (lane.view.crossfire) {
          if (dodgeClock < lane.view.timelineStart) continue;
          lane.started = true;
          lane.frame = setup(lane.view, lane.view.timelineStart);
        } else {
          lane.delayElapsed += (Math.max(0, now - (lane.delayAt ?? now)) / 1000) * rate;
          lane.delayAt = now;
          const actorId = lane.view.events[lane.view.index].from;
          const startDelay = startedActors.has(actorId) ? 0 : unitStartDelays.get(actorId) || 0;
          if (lane.delayElapsed < startDelay) continue;
          lane.started = true;
          startedActors.add(actorId);
          lane.frame = setup(lane.view, dodgeClock - (lane.delayElapsed - startDelay));
          // 保留跨越起播时刻的这一帧时间，低帧率下也不会把延迟额外拉长。
          lane.frame.lastNow = now - ((lane.delayElapsed - startDelay) * 1000) / rate;
        }
      }
      frame = lane.frame || setup(lane.view);
      if (lane.view.crossfire) frame.time = dodgeClock - lane.view.timelineStart;
      else frame.time += (Math.max(0, now - (frame.lastNow ?? now)) / 1000) * rate;
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
        // Only an actor's first appearance is staggered; later volleys start immediately.
        lane.started = false;
        lane.delayElapsed = 0;
        lane.delayAt = now;
      }
    }
    frame = lanes.find((lane) => !lane.view.completed)?.frame || null;
    const statusText =
      I18n.text("交战演出") +
      " · " +
      lanes.filter((lane) => !lane.view.completed).length +
      "/" +
      lanes.length;
    const status = byId("mapCombatStatus");
    if (status.textContent !== statusText) status.textContent = statusText;
    if (
      lanes.every((lane) => lane.view.completed) &&
      [...meleeExchanges.values()].every((pair) => dodgeClock >= pair.end)
    ) {
      battleView.completed = true;
      WeaponAudio.releaseBattle();
      CombatPlayback.finish();
    }
  }
  function dodgePoses(result) {
    for (const [id, track] of dodgeTracks) {
      const pose = result.get(id),
        unit = displayed.get(id);
      if (
        !pose ||
        !unit ||
        pose.dying ||
        pose.hidden ||
        !track.moves.length ||
        dodgeClock < track.moves[0].at
      )
        continue;
      if (
        [...meleeExchanges.values()].some(
          (pair) =>
            (pair.attacker === id || pair.defender === id) &&
            dodgeClock >= pair.start &&
            dodgeClock < pair.end,
        )
      )
        continue;
      const dodge = WeaponEffects.dodge(
        null,
        { moves: track.moves, initialSlot: track.initialSlot },
        dodgeClock,
        null,
        { unit, scale: track.base.scale },
      );
      // Face the actual incoming attacker during evasion, then resume the
      // current attack lock. Both hull and weapon aim must forget the old shot.
      let facing = {};
      const model = ART.models[unit.model];
      if (!pose.attacking && !model.ship && !model.fixedWeaponFacing) {
        let incoming;
        for (let index = track.moves.length - 1; index >= 0; index--)
          if (track.moves[index].at <= dodgeClock) { incoming = track.moves[index].sourceId; break; }
        const targetId = dodge.active ? incoming : facingTargets.get(id) || Rules.attackOrders(unit)[0]?.target || incoming;
        const target = result.get(targetId), enemy = displayed.get(targetId);
        if (enemy) {
          const center = Rules.center(enemy);
          const x = target?.x ?? (center.x + .5 + formationOffset(enemy).x) * Rules.mapCellPixels;
          const y = target?.y ?? (center.y + .5 + formationOffset(enemy).y) * Rules.mapCellPixels;
          const angle = Math.atan2(x - track.base.x - dodge.x, -(y - track.base.y - dodge.y)) * 180 / Math.PI;
          unit.angle = unit.aimAngle = angle;
          facing = { angle, aimAngle: angle };
        }
      }
      result.set(id, {
        ...pose,
        ...facing,
        x: track.base.x + dodge.x,
        y: track.base.y + dodge.y,
        dodge,
        moving: pose.moving || dodge.active,
        ...(dodge.active && !pose.attacking
          ? {
              clip: Rules.modelOf(unit).presentation.dodge,
              time: dodge.time * ART.presentation.animationSpeed,
            }
          : {}),
      });
    }
    return result;
  }
  function poses() {
    if (!lanes.length) return dodgePoses(new Map([...restingPoses, ...framePoses()]));
    const result = new Map(restingPoses),
      priority = new Map(
        [...restingPoses].filter(([, pose]) => pose.hidden).map(([id]) => [id, 7]),
      ),
      saved = frame;
    for (const lane of lanes)
      if (lane.frame && !lane.view.completed) {
        frame = lane.frame;
        for (const [id, pose] of framePoses()) {
          const weight = pose.hidden
            ? 7
            : pose.dying
              ? 6
              : id === frame.event.from
                ? 5
                : pose.moving
                  ? 3
                  : 1;
          if ((priority.get(id) || 0) <= weight) {
            result.set(id, pose);
            priority.set(id, weight);
          }
        }
      }
    frame = saved;
    const composed = meleePoses(dodgePoses(result));
    // An older volley may finish after a newer incoming attack. Keep the most
    // recent command/attack facing, rather than restoring that lane's old angle.
    for (const [id, pose] of composed) {
      const unit = displayed.get(id);
      if (unit && !pose.firing) pose.angle = unit.angle;
    }
    return composed;
  }
  // One traversal per rendered frame, rather than one traversal per unit/field.
  function statistics() {
    if (stateCache) return stateCache;
    const values = new Map(), exits = new Set();
    function state(id) {
      if (!values.has(id)) values.set(id, {
        hp:initialHp.get(id), shield:initialShield.get(id), en:initialEn.get(id),
        iFieldHp:initialIField.get(id), parts:{...initialParts.get(id)}, impact:Infinity,
      });
      return values.get(id);
    }
    const sources = lanes.length ? lanes : frame ? [{finished:[],frame,view:frame.view}] : [];
    for (const lane of sources) {
      for (const item of [...lane.finished, ...(lane.frame ? [lane.frame] : [])]) {
        const target = state(item.event.to), source = state(item.event.from);
        const contacts = contactsFor(item);
        for (const contact of contacts) {
          if (target.hp !== undefined) target.hp -= contact.damage || 0;
          if (target.shield !== undefined) target.shield -= contact.shieldDamage || 0;
          if (target.iFieldHp !== undefined) target.iFieldHp -= contact.iFieldDamage || 0;
          for (const part of contact.brokenParts || []) target.parts[part] = true;
          if (item === lane.frame && !lane.view.completed && contact.iFieldDamage > 0)
            target.impact = Math.min(target.impact, item.time - contact.at);
        }
        if (source.en !== undefined && item.time >= (item.plan.shots[0]?.at ?? 0))
          source.en -= item.event.energySpent ?? item.weapon.en;
        if (item.time >= item.plan.duration || contacts.some(contact => contact.after <= 0))
          for (const exit of item.event.evacuations || []) exits.add(exit.unitId);
      }
    }
    for (const value of values.values())
      for (const field of ["hp","shield","en"])
        if (value[field] !== undefined) value[field] = Math.max(0, value[field]);
    stateCache = {values,exits};
    return stateCache;
  }
  // Melee choreography must use the same merged damage as the visible roster.
  function health(id) {
    return statistics().values.get(id)?.hp ?? initialHp.get(id) ?? displayed.get(id)?.hp ?? 0;
  }
  function fieldImpact(id) { return statistics().values.get(id)?.impact ?? Infinity; }
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
  function units() {
    if (!battleView?.mapBattle)
      return game.units.filter(u => !u.embarked || u.embarked.exposed || u.pendingMove?.launch);
    // Also refresh when inspection tools seek a frame without advancing its clock.
    stateCache = null;
    const pose = poses(), stats = statistics();
    // Actors were authorized when combat happened. The final fog snapshot can
    // omit them after a scout dies; keep them only for this playback's lifetime.
    const roster = new Map(game.units.map((unit) => [unit.id, unit]));
    for (const [id, unit] of displayed)
      if (!roster.has(id) && visibleActors.has(id) && !unit.visualOnly) roster.set(id, unit);
    return [...roster.values()]
      .filter(
        (u) =>
          (!u.embarked || u.embarked.exposed || u.pendingMove?.launch) &&
          (!pendingExits.has(u.id) || stats.exits.has(u.id)),
      )
      .map((unit) => {
        const visual = displayed.get(unit.id) || unit;
        const effect = pose.get(unit.id);
        const state = stats.values.get(unit.id);
        return {
          ...visual,
          brokenParts: state?.parts ?? initialParts.get(unit.id) ?? visual.brokenParts,
          hp: (lanes.length ? state?.hp ?? initialHp.get(unit.id) : effect?.hp) ?? visual.hp,
          shield: (lanes.length ? state?.shield ?? initialShield.get(unit.id) : effect?.shield) ?? visual.shield,
          en: (lanes.length ? state?.en ?? initialEn.get(unit.id) : undefined) ?? visual.en,
          iFieldHp: (lanes.length ? state?.iFieldHp ?? initialIField.get(unit.id) : undefined) ?? visual.iFieldHp,
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
    ctx.scale(geometry.tile / Rules.mapCellPixels, geometry.tile / Rules.mapCellPixels);
    const facing = Math.atan2(target.y - source.y, target.x - source.x);
    if (!event.nuclearFollowup)
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
    const effectVisible = (id, at) => Array.isArray(id)
      ? id.some(effect => SpriteEffects.frame(effect, at) !== null)
      : SpriteEffects.frame(id, at) !== null;
    for (const [index, contact] of (event.nuclearFollowup ? [] : plan.contacts).entries()) {
      const contactShot = frame.shotsByIndex.get(contact.shotIndex);
      const scatterPoint =
        contact.clusterRole === "carrier"
          ? contactShot?.splitPoint
          : contact.clusterRole === "fragment"
            ? contactShot?.destination
            : null;
      const swingEffect = contact.swingEffects ?? (Array.isArray(weapon.swingEffects)
        ? weapon.swingEffects[index % weapon.swingEffects.length] : weapon.swingEffects);
      const swingTime = (time - contact.at) * plan.actionSpeed;
      if (swingEffect && effectVisible(swingEffect, swingTime))
        SpriteEffects.draw(
          ctx,
          swingEffect,
          sourcePose.x,
          sourcePose.y,
          source.scale,
          swingTime,
          facing,
        );
      const hitEffect = contact.clusterRole === "fragment"
        ? weapon.projectile.cluster.hitEffect : weapon.hitEffects || weapon.hitEffect;
      const hitTime = (time - contact.at) * ART.presentation.animationSpeed;
      if (effectVisible(hitEffect, hitTime) && (
        plan.blastPoint ||
        contact.hit ||
        weapon.projectile?.motion === "mortar" ||
        weapon.projectile?.motion === "bomb"
      ))
        SpriteEffects.draw(
          ctx,
          hitEffect,
          scatterPoint?.x ??
            plan.blastPoint?.x ??
            target.x +
              WeaponEffects.dodgeOffset(plan, contact.at).x *
                target.scale *
                ART.presentation.dodgeDistance,
          scatterPoint?.y ??
            plan.blastPoint?.y ??
            target.y +
              WeaponEffects.position(plan, contact.at) *
                target.scale *
                ART.presentation.dodgeDistance,
          target.scale,
          hitTime,
          facing,
        );
    }
    if (targetPose.dying && !targetPose.hidden)
      SpriteEffects.deathElectric(
        ctx,
        targetPose.x,
        targetPose.y,
        target.scale,
        time - plan.deathSoundAt,
        plan.deathAt - plan.deathSoundAt,
        plan.deathAt - plan.deathSoundAt,
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
    const contacts = contactsFor(frame),
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
      dodgeLastNow = now;
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
    formationOffset,
    fieldImpact,
    health,
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
