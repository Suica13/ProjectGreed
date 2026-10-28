/* 演出只读取服务端逐发结果，不掷命中、不修改战局 HP。 */
const WeaponEffects = (() => {
  function animationSpeed(weapon) {
    if (weapon.remote) return 1;
    return weapon.type === "melee"
      ? ART.presentation.meleeAnimationSpeed
      : ART.presentation.animationSpeed;
  }
  // 开火挂点和可见机体共用同一根坐标，闪避后不会重复或遗漏位移。
  function firingPose(weapon, source, event, originalTime) {
    const animation = WeaponSequence.pose(weapon, originalTime);
    return {
      x: source.x,
      y: source.y + (event?.sourceDodgeSlot || 0) * ART.presentation.dodgeDistance * source.scale,
      angle: source.angle,
      clip: animation.clip,
      time: animation.time,
      weaponDisplayIndex: animation.weaponDisplayIndex,
    };
  }
  function deathEnvironment(unit) {
    if (unit.environment === "space") return "space";
    const tile = typeof game !== "undefined" ? game.tiles?.[unit.y]?.[unit.x] : null;
    return tile === "water" ? "water" : "ground";
  }
  function deathSequence(unit, forceStandard = false) {
    const model = ART.models[unit.model],
      environment = deathEnvironment(unit);
    const config = ART.presentation.deathEffects;
    const large =
      !forceStandard && (model.ship || model.largeUnit || model.presentation.deathType === "large");
    const effect =
      config?.[large ? "large" : "standard"]?.[environment] || model.presentation.deathEffect;
    const events = [];
    if (large && config?.largeSequence) {
      const sequence = config.largeSequence;
      let seed = Array.from(String(unit.id)).reduce(
        (value, c) => (Math.imul(value, 31) + c.charCodeAt(0)) >>> 0,
        7,
      );
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      for (let i = 0; i < sequence.count; i++)
        events.push({
          effect: config.largeBurst[environment],
          at: i * sequence.interval,
          x: (random() * 2 - 1) * sequence.spreadX,
          y: (random() * 2 - 1) * sequence.spreadY,
        });
      events.push({ effect, at: sequence.finalDelay, x: 0, y: 0 });
    } else events.push({ effect, at: 0, x: 0, y: 0 });
    return {
      effect,
      events,
      keepSpriteUntilEnd: model.ship === true,
      duration: Math.max(...events.map((e) => e.at + ART.effects[e.effect].duration)),
    };
  }
  function drawDeath(ctx, sequence, unit, x, y, scale, age) {
    const angle = (((unit.angle ?? 90) - 90) * Math.PI) / 180;
    for (const event of sequence.events) {
      const dx = Math.cos(angle) * event.y - Math.sin(angle) * event.x;
      const dy = Math.sin(angle) * event.y + Math.cos(angle) * event.x;
      SpriteEffects.draw(ctx, event.effect, x + dx * scale, y + dy * scale, scale, age - event.at);
    }
  }
  // Deterministic presentation paths: no simulation entities, timers or per-frame RNG.
  function remotePaths(weapon, source, target, event) {
    if (!weapon.remote) return [];
    const config = weapon.remote;
    let seed = 2166136261;
    for (const c of `${source.unit.id}:${target.unit.id}:${weapon.id}:${event?.id || event?.sequence || 0}`)
      seed = Math.imul(seed ^ c.charCodeAt(0), 16777619) >>> 0;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    const radius = Math.max(30, Math.min(90, 55 * (target.scale || 1)));
    return config.units.map((unit, index) => {
      const launch = index * config.staggerSeconds;
      const origin = SpriteRenderer.muzzle(source.unit.model, weapon, source, null, 0, index);
      const points = Array.from({ length: config.shotsPerUnit }, (_, cycle) => {
        const angle = (index / config.units.length + random() * 0.55 + cycle * 0.3) * Math.PI * 2;
        const distance = radius * (0.8 + random() * 0.65);
        return {
          x: target.x + Math.cos(angle) * distance,
          y: target.y + Math.sin(angle) * distance,
        };
      });
      const cycle = config.moveSeconds + config.settleSeconds + config.waitSeconds;
      const shots = points.map(
        (_, shot) => launch + config.moveSeconds + config.settleSeconds + shot * cycle,
      );
      const returnAt = shots.at(-1) + config.waitSeconds;
      return {
        index,
        unit,
        origin,
        points,
        shots,
        launch,
        returnAt,
        end: returnAt + config.returnSeconds,
      };
    });
  }
  function remoteState(path, config, time) {
    if (time < path.launch || time > path.end) return null;
    const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    if (time >= path.returnAt) {
      // Wired control pods retract along their remembered turning points.
      const route =
        config.kind === "funnel"
          ? [path.points.at(-1), path.origin]
          : [...path.points].reverse().concat(path.origin);
      const lengths = route
        .slice(1)
        .map((point, i) => Math.hypot(point.x - route[i].x, point.y - route[i].y));
      let remaining =
        (lengths.reduce((sum, v) => sum + v, 0) * (time - path.returnAt)) / config.returnSeconds;
      for (let i = 0; i < lengths.length; i++) {
        if (remaining <= lengths[i] || i === lengths.length - 1)
          return {
            ...lerp(route[i], route[i + 1], Math.min(1, remaining / Math.max(0.001, lengths[i]))),
            trail: [path.origin, ...route.slice(i + 1, -1).reverse()],
            moving: true,
            returning: true,
            angle: Math.atan2(route[i + 1].y - route[i].y, route[i + 1].x - route[i].x),
          };
        remaining -= lengths[i];
      }
    }
    let previous = path.origin;
    const trail = [path.origin];
    for (let i = 0; i < path.points.length; i++) {
      const start = i === 0 ? path.launch : path.shots[i - 1] + config.waitSeconds;
      const point = path.points[i];
      if (time <= path.shots[i]) {
        const t = Math.min(1, Math.max(0, (time - start) / config.moveSeconds));
        return {
          ...lerp(previous, point, t),
          trail,
          moving: t < 1,
          returning: false,
          angle: Math.atan2(point.y - previous.y, point.x - previous.x),
        };
      }
      if (time < path.shots[i] + config.waitSeconds)
        return { ...point, trail, moving: false, returning: false, angle: 0 };
      trail.push(point);
      previous = point;
    }
    return { ...previous, trail, moving: false, returning: false, angle: 0 };
  }
  function drawRemotes(ctx, weapon, plan, time, source, size) {
    for (const path of plan.remotes || []) {
      if (!plan.shots.some((shot) => shot.remoteIndex === path.index)) continue;
      const state = remoteState(path, weapon.remote, time);
      if (!state) continue;
      if (weapon.remote.kind !== "funnel") {
        ctx.save();
        ctx.strokeStyle = "#b2b7c2";
        ctx.lineWidth = Math.max(0.7, source.scale * 0.8);
        ctx.beginPath();
        ctx.moveTo(state.trail[0].x, state.trail[0].y);
        for (const point of state.trail.slice(1)) ctx.lineTo(point.x, point.y);
        ctx.lineTo(state.x, state.y);
        ctx.stroke();
        ctx.restore();
      }
      const image = SpriteRenderer.images[path.unit.asset];
      if (!image) continue;
      const target = plan.shots.find((shot) => shot.remoteIndex === path.index)?.destination;
      const angle = state.moving ? state.angle : Math.atan2(target.y - state.y, target.x - state.x);
      const scale = source.scale * path.unit.scale * size;
      ctx.save();
      ctx.translate(state.x, state.y);
      ctx.rotate(angle + Math.PI / 2);
      ctx.scale(scale * (path.unit.scaleX || 1), scale);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, -image.width / 2, -image.height / 2);
      ctx.restore();
    }
  }
  function plan(weapon, source, target, event = null, dodgeSchedule = null) {
    // 每发未命中子弹从发射起最多等待两秒；连射中的后续子弹独立计时。
    const missTimeout = 2,
      timedProjectile =
        weapon.projectile && !["bomb", "mortar", "tether"].includes(weapon.projectile.motion);
    const speed = animationSpeed(weapon),
      effectSpeed = ART.presentation.animationSpeed,
      lead =
        weapon.projectile?.motion === "bomb"
          ? 0.6
          : weapon.type === "melee" && weapon.projectile?.motion !== "tether"
            ? 0.35
            : 0,
      sourceY = (event?.sourceDodgeSlot || 0) * ART.presentation.dodgeDistance * source.scale,
      initialSlot = event?.targetDodgeSlot || 0;
    const remotes = remotePaths(weapon, source, target, event);
    const shots = weapon.attack.shots.map((originalAt, index) => {
      const at = lead + originalAt / speed,
        animation = firingPose(weapon, source, event, originalAt);
      const remoteIndex = weapon.remote ? weapon.attack.muzzleIndices[index] : null;
      const remote = remotes[remoteIndex];
      const remoteCycle = remote
        ? weapon.attack.muzzleIndices.slice(0, index).filter((i) => i === remoteIndex).length
        : 0;
      const origin = remote
        ? { ...remote.points[remoteCycle] }
        : weapon.projectile
          ? SpriteRenderer.muzzle(
              source.unit.model,
              weapon,
              { ...source, ...animation },
              animation.clip,
              animation.time,
              index,
            )
          : { x: target.x, y: target.y };
      // 命中和 Miss 使用相同弹道；由防守方回避动作表现未命中。
      const destination = {
        x: target.x,
        y: target.y + initialSlot * ART.presentation.dodgeDistance * target.scale,
      };
      const group = weapon.attack.shots
        .map((at, i) => (at === originalAt ? i : -1))
        .filter((i) => i >= 0);
      const spreadAngle =
        group.length > 1
          ? ((group.indexOf(index) / (group.length - 1) - 0.5) *
              (weapon.projectile?.spreadDegrees || 0) *
              Math.PI) /
            180
          : 0;
      const spreadY = Math.tan(spreadAngle) * Math.abs(destination.x - origin.x);
      destination.y += spreadY;
      if (weapon.projectile?.motion === "bomb") {
        const first = weapon.attack.shots[0],
          last = weapon.attack.shots.at(-1),
          drift =
            last === first ? 0 : ((originalAt - first) / (last - first) - 0.5) * 28 * source.scale;
        origin.x = target.x + drift;
        origin.y = target.y - 60 * source.scale;
        destination.x = origin.x;
        destination.y = target.y;
      }
      const flight =
        weapon.projectile?.motion === "tether"
          ? Math.max(
              0.18,
              Math.min(
                0.5,
                Math.hypot(destination.x - origin.x, destination.y - origin.y) /
                  (weapon.projectile.speed * 10 * source.scale),
              ),
            )
          : weapon.projectile?.motion === "mortar"
            ? 2 *
              Math.max(
                0.18,
                Math.min(
                  0.45,
                  Math.hypot(destination.x - origin.x, destination.y - origin.y) / 1800,
                ),
              )
            : weapon.projectile?.motion === "bomb"
              ? 0.6
              : weapon.projectile
                ? Math.max(
                    0.001,
                    Math.hypot(destination.x - origin.x, destination.y - origin.y) /
                      (weapon.projectile.speed *
                        60 *
                        source.scale *
                        ART.presentation.projectileSpeed),
                  )
                : 0;
      return {
        index,
        remoteIndex,
        at,
        origin,
        destination,
        spreadY,
        flight,
        impactAt: at + flight,
      };
    });
    const steps = weapon.attack.strikes;
    const contacts = steps
      .map((step, index) => {
        const shot = shots[step.shotIndex];
        const result = event?.strikes?.[index] || {
          hit: Boolean(event?.hit),
          executed: true,
          blocked: event?.blocked,
          damage: event?.hit
            ? Math.round(((event.damage || 0) * (index + 1)) / steps.length) -
              Math.round(((event.damage || 0) * index) / steps.length)
            : 0,
          shieldDamage: event?.hit
            ? Math.round(((event.shieldDamage || 0) * (index + 1)) / steps.length) -
              Math.round(((event.shieldDamage || 0) * index) / steps.length)
            : 0,
        };
        return {
          ...step,
          ...result,
          at: Math.min(
            shot.impactAt + (step.hitIndex * (weapon.attack.hitInterval || 0)) / speed,
            timedProjectile && !result.hit ? shot.at + missTimeout : Infinity,
          ),
        };
      })
      .filter((contact) => contact.executed !== false)
      .sort((a, b) => a.at - b.at);
    const moves = event?.empty ? [] : dodgeMoves(contacts, initialSlot, event, dodgeSchedule),
      motion = { moves, initialSlot };
    // Aim at the defender's current lane, without adding artificial Miss deviation.
    for (const shot of shots)
      shot.destination.y =
        target.y +
        position(motion, shot.impactAt) * ART.presentation.dodgeDistance * target.scale +
        shot.spreadY;
    const activeShots = shots.filter((shot) =>
      contacts.some((contact) => contact.shotIndex === shot.index),
    );
    const impacts = contacts.map((contact) => contact.at);
    const cues = [...new Set(activeShots.map((shot) => shot.at))].map((at) => ({
      at,
      sound: weapon.sound,
    }));
    for (const shot of activeShots) {
      shot.miss = contacts
        .filter((contact) => contact.shotIndex === shot.index)
        .every((contact) => !contact.hit);
      let travel = 1;
      if (
        shot.miss &&
        weapon.projectile &&
        !["bomb", "mortar", "tether"].includes(weapon.projectile.motion)
      ) {
        const image = SpriteRenderer.images[weapon.projectile.asset],
          margin =
            Math.max(image?.width || 64, image?.height || 64) *
              source.scale *
              weapon.projectile.scale +
            16,
          dx = shot.destination.x - shot.origin.x,
          dy = shot.destination.y - shot.origin.y,
          width = source.arenaWidth ?? Math.max(source.x, target.x) + Math.abs(dx),
          height = source.arenaHeight ?? Math.max(source.y, target.y) + Math.abs(dy) + margin;
        // 弹道先穿过哪条边就结束。只检测 X 会让近乎竖直的 Miss 在屏外飞行几十秒。
        const exitX =
            dx === 0 ? Infinity : ((dx > 0 ? width + margin : -margin) - shot.origin.x) / dx,
          exitY = dy === 0 ? Infinity : ((dy > 0 ? height + margin : -margin) - shot.origin.y) / dy,
          exit = Math.min(exitX, exitY);
        travel = Math.max(1, Number.isFinite(exit) ? exit : 1);
      }
      shot.visibleUntil =
        weapon.projectile?.motion === "tether"
          ? shot.impactAt +
            (weapon.projectile.tether.hold + weapon.projectile.tether.retract) / speed
          : shot.at + shot.flight * travel;
      if (timedProjectile && shot.miss)
        shot.visibleUntil = Math.min(shot.visibleUntil, shot.at + missTimeout);
    }
    let end = Math.max(
        lead + weapon.attack.duration / speed,
        ...impacts,
        ...activeShots.map((shot) => shot.visibleUntil),
        ...activeShots.map((shot) => {
          const id = weapon.muzzleEffects?.[weapon.attack.muzzleIndices[shot.index] ?? 0];
          return shot.at + (ART.effects[id]?.duration || 0) / effectSpeed;
        }),
      ),
      deathAt = null,
      deathEffect = null,
      deathElectricEffect = null,
      deathSoundAt = null,
      deathEnd = null,
      deathEvents = null;
    for (const [index, contact] of contacts.entries())
      if (contact.hit || ["bomb", "mortar"].includes(weapon.projectile?.motion)) {
        cues.push({ at: contact.at, sound: SpriteEffects.sound(weapon.hitEffect, index) });
        end = Math.max(end, contact.at + ART.effects[weapon.hitEffect].duration / effectSpeed);
      }
    for (const contact of contacts)
      if (ART.models[target.unit.model].modules?.length && contact.brokenParts?.length) {
        cues.push({
          at: contact.at,
          sound: SpriteEffects.sound(deathSequence(target.unit, true).effect),
        });
        end = Math.max(
          end,
          contact.at + ART.effects[deathSequence(target.unit, true).effect].duration / effectSpeed,
        );
      }
    const lethal = contacts.find(
      (contact) => contact.hit && contact.after === 0 && contact.before > 0,
    );
    if (lethal || (event?.hit && event.after <= 0 && event.before > 0 && !event.strikes)) {
      deathSoundAt = lethal?.at ?? impacts.at(-1);
      cues.push({ at: deathSoundAt, sound: ART.presentation.deathSound });
      deathAt = deathSoundAt + ART.presentation.deathDelay;
      deathElectricEffect = ART.presentation.deathElectricEffect;
      deathEvents = deathSequence(target.unit);
      deathEffect = deathEvents.effect;
      for (const explosion of deathEvents.events)
        cues.push({
          at: deathAt + explosion.at / effectSpeed,
          sound: SpriteEffects.sound(explosion.effect),
        });
      deathEnd = deathAt + deathEvents.duration / effectSpeed;
      end = Math.max(end, deathEnd);
    }
    const bomb =
      weapon.projectile?.motion === "bomb"
        ? {
            start: shots[0]?.at ?? lead,
            end: shots.at(-1)?.at ?? lead,
            returnAt: (shots.at(-1)?.impactAt ?? lead) + 0.15,
            retreat: 0.6,
            span: shots.length > 1 ? 14 * source.scale : 0,
            height: 60 * source.scale,
          }
        : null;
    if (bomb) end = Math.max(end, bomb.returnAt + bomb.retreat);
    const melee =
      weapon.type === "melee" && weapon.projectile?.motion !== "tether"
        ? {
            approach: lead,
            retreatAt: Math.max(
              lead + weapon.attack.duration / speed,
              (impacts.at(-1) || lead) + 0.2,
            ),
            retreat: 0.35,
          }
        : null;
    if (melee) end = Math.max(end, melee.retreatAt + melee.retreat);
    let duration = end + 0.35 / effectSpeed;
    if (timedProjectile && activeShots.length && activeShots.every((shot) => shot.miss))
      duration = Math.min(
        duration,
        Math.max(
          lead + weapon.attack.duration / speed + 0.35 / effectSpeed,
          ...activeShots.map((shot) => shot.at + missTimeout),
        ),
      );
    return {
      lead,
      melee,
      bomb,
      shots: activeShots,
      remotes,
      contacts,
      impacts,
      cues,
      deathAt,
      deathEffect,
      deathEvents,
      deathElectricEffect,
      deathSoundAt,
      deathEnd,
      deathHideAt: deathEvents?.keepSpriteUntilEnd ? deathEnd : deathAt,
      moves,
      initialSlot,
      sourceY,
      actionSpeed: speed,
      duration: Math.max(duration, ...remotes.map((path) => path.end)),
    };
  }
  function meleeMotion(plan, source, target, time, travel = 0.18) {
    if (!plan.melee) return { x: 0, y: 0, stage: "attack", time };
    const { approach, retreatAt, retreat } = plan.melee;
    const width = source.arenaWidth ?? Math.abs(target.x - source.x) * 2;
    const gap = Math.min(
      width * 0.2,
      Math.max(width * Math.max(0.05, 0.25 - travel), (source.scale + target.scale) * 20),
    );
    const direction = target.x >= source.x ? 1 : -1;
    const destination = {
      x: target.x - direction * gap,
      y: target.y + plan.initialSlot * ART.presentation.dodgeDistance * target.scale,
    };
    const smooth = (value) => (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, value)))) / 2;
    let progress = 1,
      stage = "attack",
      stageTime = time - approach;
    if (time < approach) {
      progress = smooth(time / approach);
      stage = "approach";
      stageTime = time;
    } else if (time >= retreatAt) {
      progress = 1 - smooth((time - retreatAt) / retreat);
      stage = "return";
      stageTime = time - retreatAt;
    }
    if (time >= retreatAt + retreat) {
      progress = 0;
      stage = "rest";
    }
    return {
      x: (destination.x - source.x) * progress,
      y: (destination.y - source.y - plan.sourceY) * progress,
      stage,
      time: Math.max(0, stageTime),
    };
  }
  function position(plan, time) {
    const move = plan.moves.filter((move) => move.at <= time).at(-1);
    if (!move) return plan.initialSlot;
    const t = Math.max(0, Math.min(1, (time - move.at) / move.duration));
    return move.from + ((move.to - move.from) * (1 - Math.cos(Math.PI * t))) / 2;
  }
  function dodgeMoves(contacts, initialSlot, event, schedule) {
    const misses = [],
      moves = [];
    // 同一目标每秒最多开始一次闪避；其他 Miss 只让子弹沿原弹道穿过。
    for (const contact of contacts) {
      if (contact.hit || contact.at - (misses.at(-1)?.at ?? -Infinity) < 1) continue;
      const at = (schedule?.start || 0) + contact.at;
      if (schedule?.starts.some((previous) => Math.abs(at - previous) < 1)) continue;
      misses.push(contact);
      schedule?.starts.push(at);
    }
    let goal = initialSlot,
      hash = 2166136261;
    for (const char of `${event?.from}:${event?.to}:${event?.weapon}:${event?.before}`)
      hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    misses.forEach((contact, index) => {
      hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0;
      const next = [-1, 0, 1].includes(contact.dodgeTo)
        ? contact.dodgeTo
        : goal === 0
          ? hash < 0x80000000
            ? -1
            : 1
          : 0;
      const from = position({ moves, initialSlot }, contact.at);
      moves.push({
        at: contact.at,
        from,
        to: next,
        duration: Math.max(
          0.001,
          Math.min(ART.presentation.dodgeOut, (misses[index + 1]?.at ?? Infinity) - contact.at),
        ),
      });
      goal = next;
    });
    return moves;
  }
  function dodge(event, plan, time, source, target) {
    const move = plan.moves.filter((move) => move.at <= time).at(-1),
      clip = ART.models[target.unit.model].presentation.dodge,
      duration =
        SpriteRenderer.models[target.unit.model].animations[clip].duration /
        ART.presentation.animationSpeed;
    return {
      x: 0,
      y: position(plan, time) * target.scale * ART.presentation.dodgeDistance,
      active: Boolean(move && time < move.at + duration),
      started: Boolean(move),
      time: move ? time - move.at : 0,
    };
  }
  function arrived(plan, time) {
    return plan.contacts.filter((contact) => contact.at <= time);
  }
  function health(event, plan, time, initialHp) {
    return Math.max(
      0,
      (event.before ?? initialHp) -
        arrived(plan, time).reduce((sum, contact) => sum + contact.damage, 0),
    );
  }
  function shield(event, plan, time, initialShield) {
    return Math.max(
      0,
      (event.shieldBefore ?? initialShield) -
        arrived(plan, time).reduce((sum, contact) => sum + (contact.shieldDamage || 0), 0),
    );
  }
  function bombPose(plan, time, source, target) {
    const b = plan.bomb,
      smooth = (v) => (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, v)))) / 2;
    const end = { x: target.x + b.span, y: target.y - b.height },
      start = { x: target.x - b.span, y: target.y - b.height };
    if (time < b.start) {
      const t = smooth(time / b.start);
      return { x: source.x + (start.x - source.x) * t, y: source.y + (start.y - source.y) * t };
    }
    if (time < b.end) {
      const t = (time - b.start) / Math.max(0.001, b.end - b.start);
      return { x: start.x + (end.x - start.x) * t, y: start.y };
    }
    const t = smooth((time - b.returnAt) / b.retreat);
    return { x: end.x + (source.x - end.x) * t, y: end.y + (source.y - end.y) * t };
  }
  function drawMuzzle(ctx, weapon, plan, time, source, event, pose = null) {
    if (!weapon.muzzleEffects?.length) return;
    const drawn = new Set();
    for (const shot of plan.shots) {
      const mountIndex = weapon.attack.muzzleIndices[shot.index] ?? 0,
        id = weapon.muzzleEffects[mountIndex],
        effect = ART.effects[id],
        age = (time - shot.at) * ART.presentation.animationSpeed,
        key = `${shot.at}:${mountIndex}`;
      if (!effect || age < 0 || age >= effect.duration || drawn.has(key)) continue;
      drawn.add(key);
      let origin = shot.origin;
      if (effect.attached && !weapon.remote) {
        const current =
          pose ||
          firingPose(weapon, source, event, Math.max(0, time - plan.lead) * plan.actionSpeed);
        origin = SpriteRenderer.muzzle(
          source.unit.model,
          weapon,
          { ...source, ...current },
          current.clip,
          current.time,
          shot.index,
        );
      }
      SpriteEffects.draw(
        ctx,
        id,
        origin.x,
        origin.y,
        source.scale,
        age,
        (((source.aimAngle ?? source.unit?.aimAngle ?? source.angle) - 90) * Math.PI) / 180,
      );
    }
  }
  // The tether remains attached to the animated hand, including any existing dodge displacement.
  function tetherState(weapon, plan, shot, time, source, event, pose = null) {
    if (time < shot.at || time > shot.visibleUntil) return null;
    const config = weapon.projectile.tether;
    const animation =
      pose || firingPose(weapon, source, event, Math.max(0, (time - plan.lead) * plan.actionSpeed));
    const anchor = SpriteRenderer.muzzle(
      source.unit.model,
      { ...weapon, muzzle: config.mount },
      { ...source, ...animation },
      animation.clip,
      animation.time,
      shot.index,
    );
    const holdUntil = shot.impactAt + config.hold / plan.actionSpeed;
    let head, stage;
    if (time < shot.impactAt) {
      const progress = Math.min(1, (time - shot.at) / shot.flight);
      head = {
        x: shot.origin.x + (shot.destination.x - shot.origin.x) * progress,
        y: shot.origin.y + (shot.destination.y - shot.origin.y) * progress,
      };
      stage = "extend";
    } else if (time < holdUntil) {
      head = { ...shot.destination };
      stage = "contact";
    } else {
      const progress = Math.min(1, (time - holdUntil) / (config.retract / plan.actionSpeed));
      head = {
        x: shot.destination.x + (anchor.x - shot.destination.x) * progress,
        y: shot.destination.y + (anchor.y - shot.destination.y) * progress,
      };
      stage = "retract";
    }
    return { anchor, head, stage };
  }
  function drawTether(ctx, weapon, plan, time, source, event, size, pose, layer) {
    const image = SpriteRenderer.images[weapon.projectile.asset],
      config = weapon.projectile.tether;
    for (const shot of plan.shots) {
      const state = tetherState(weapon, plan, shot, time, source, event, pose);
      if (!state) continue;
      const { anchor, head } = state;
      ctx.save();
      if (layer !== "foreground") {
        ctx.strokeStyle = config.color;
        ctx.lineWidth = config.width * source.scale * size;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(anchor.x, anchor.y);
        ctx.lineTo(head.x, head.y);
        ctx.stroke();
      }
      if (layer !== "underlay" && image) {
        ctx.translate(head.x, head.y);
        ctx.rotate(Math.atan2(head.y - anchor.y, head.x - anchor.x) + Math.PI / 2);
        ctx.scale(
          source.scale * weapon.projectile.scale * size,
          source.scale * weapon.projectile.scale * size,
        );
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(image, -image.width / 2, -image.height / 2);
      }
      ctx.restore();
    }
  }
  function draw(ctx, weapon, plan, time, source, event, size = 1, pose = null, layer = "all") {
    ctx.save();
    if (weapon.projectile?.visibleInFog === false) SpriteEffects.clipFog(ctx);
    try {
      drawUnclipped(ctx, weapon, plan, time, source, event, size, pose, layer);
    } finally {
      ctx.restore();
    }
  }
  function drawUnclipped(ctx, weapon, plan, time, source, event, size, pose, layer) {
    if (weapon.projectile?.motion === "tether") {
      drawTether(ctx, weapon, plan, time, source, event, size, pose, layer);
      return;
    }
    if (weapon.remote) drawRemotes(ctx, weapon, plan, time, source, size);
    drawMuzzle(ctx, weapon, plan, time, source, event, pose);
    if (!weapon.projectile) return;
    const image = SpriteRenderer.images[weapon.projectile.asset];
    if (!image) return;
    for (const shot of plan.shots) {
      const age = time - shot.at;
      if (age < 0 || time > shot.visibleUntil) continue;
      const travel = age / shot.flight,
        dx = shot.destination.x - shot.origin.x,
        dy = shot.destination.y - shot.origin.y,
        // The shell follows the tangent of the same arc used for its position.
        arcSlope =
          weapon.projectile.motion === "mortar" && travel < 1
            ? Math.PI * 80 * source.scale * Math.cos(Math.PI * Math.max(0, travel))
            : 0,
        angle = Math.atan2(dy - arcSlope, dx),
        scale = source.scale * weapon.projectile.scale * size,
        offset = ["bomb", "mortar"].includes(weapon.projectile.motion)
          ? 0
          : (source.projectileForwardOffset ?? weapon.projectile.forwardOffset) * source.scale;
      ctx.save();
      ctx.translate(
        shot.origin.x + dx * travel + Math.cos(angle) * offset,
        shot.origin.y +
          dy * travel +
          Math.sin(angle) * offset -
          (weapon.projectile.motion === "mortar"
            ? Math.sin(Math.PI * Math.min(1, travel)) * 80 * source.scale
            : 0),
      );
      ctx.rotate(angle + Math.PI / 2 + ((weapon.projectile.rotation || 0) * Math.PI) / 180);
      ctx.scale(scale, scale);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, -image.width / 2, -image.height / 2);
      ctx.restore();
    }
  }
  return {
    remotePaths,
    remoteState,
    deathSequence,
    drawDeath,
    plan,
    firingPose,
    meleeMotion,
    tetherState,
    dodge,
    position,
    animationSpeed,
    health,
    shield,
    arrived,
    drawMuzzle,
    bombPose,
    draw,
  };
})();
