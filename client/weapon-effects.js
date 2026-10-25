/* 演出只读取服务端逐发结果，不掷命中、不修改战局 HP。 */
const WeaponEffects = (() => {
  function animationSpeed(weapon) {
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
  function plan(weapon, source, target, event = null) {
    const speed = animationSpeed(weapon),
      effectSpeed = ART.presentation.animationSpeed,
      lead = weapon.projectile?.motion === "bomb" ? 0.6 : weapon.type === "melee" ? 0.35 : 0,
      sourceY = (event?.sourceDodgeSlot || 0) * ART.presentation.dodgeDistance * source.scale,
      initialSlot = event?.targetDodgeSlot || 0;
    const shots = weapon.attack.shots.map((originalAt, index) => {
      const at = lead + originalAt / speed,
        animation = firingPose(weapon, source, event, originalAt);
      const origin = weapon.projectile
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
        weapon.projectile?.motion === "mortar"
          ? 2 *
            Math.max(
              0.18,
              Math.min(0.45, Math.hypot(destination.x - origin.x, destination.y - origin.y) / 1800),
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
      return { index, at, origin, destination, spreadY, flight, impactAt: at + flight };
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
          at: shot.impactAt + (step.hitIndex * (weapon.attack.hitInterval || 0)) / speed,
        };
      })
      .filter((contact) => contact.executed !== false)
      .sort((a, b) => a.at - b.at);
    const moves = event?.empty ? [] : dodgeMoves(contacts, initialSlot, event),
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
        !["bomb", "mortar"].includes(weapon.projectile.motion)
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
      shot.visibleUntil = shot.at + shot.flight * travel;
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
      if (ART.models[target.unit.model].ship && contact.brokenParts?.length) {
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
      weapon.type === "melee"
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
    return {
      lead,
      melee,
      bomb,
      shots: activeShots,
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
      duration: end + 0.35 / effectSpeed,
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
  function dodgeMoves(contacts, initialSlot, event) {
    const misses = contacts.filter((contact) => !contact.hit),
      moves = [];
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
      if (effect.attached) {
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
  function draw(ctx, weapon, plan, time, source, event, size = 1, pose = null) {
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
    deathSequence,
    drawDeath,
    plan,
    firingPose,
    meleeMotion,
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
