/* 演出只读取服务端逐发结果，不掷命中、不修改战局 HP。 */
const WeaponEffects = (() => {
  function animationSpeed(weapon) {
    return weapon.type === "melee"
      ? ART.presentation.meleeAnimationSpeed
      : ART.presentation.animationSpeed;
  }
  function plan(weapon, source, target, event = null) {
    const speed = animationSpeed(weapon),
      effectSpeed = ART.presentation.animationSpeed,
      sourceY = (event?.sourceDodgeSlot || 0) * ART.presentation.dodgeDistance * source.scale,
      initialSlot = event?.targetDodgeSlot || 0;
    const shots = weapon.attack.shots.map((originalAt, index) => {
      const at = originalAt / speed,
        animation = WeaponSequence.pose(weapon, originalAt);
      const origin = weapon.projectile
        ? SpriteRenderer.muzzle(
            source.unit.model,
            weapon,
            { ...source, y: source.y + sourceY },
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
      const flight = weapon.projectile
        ? Math.max(
            0.001,
            Math.hypot(destination.x - origin.x, destination.y - origin.y) /
              (weapon.projectile.speed * 60 * source.scale * ART.presentation.projectileSpeed),
          )
        : 0;
      return { index, at, origin, destination, flight, impactAt: at + flight };
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
    const moves = dodgeMoves(contacts, initialSlot, event),
      motion = { moves, initialSlot };
    // Aim at the defender's current lane, without adding artificial Miss deviation.
    for (const shot of shots)
      shot.destination.y =
        target.y + position(motion, shot.impactAt) * ART.presentation.dodgeDistance * target.scale;
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
      if (shot.miss && weapon.projectile) {
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
        travel = Math.max(
          1,
          Math.abs(dx) > 0.001
            ? ((dx > 0 ? width + margin : -margin) - shot.origin.x) / dx
            : Math.abs(dy) > 0.001
              ? ((dy > 0 ? height + margin : -margin) - shot.origin.y) / dy
              : 1,
        );
      }
      shot.visibleUntil = shot.at + shot.flight * travel;
    }
    let end = Math.max(
        weapon.attack.duration / speed,
        ...impacts,
        ...activeShots.map((shot) => shot.visibleUntil),
      ),
      deathAt = null,
      deathEffect = null,
      deathSoundAt = null,
      deathEnd = null;
    for (const [index, contact] of contacts.entries())
      if (contact.hit) {
        cues.push({ at: contact.at, sound: SpriteEffects.sound(weapon.hitEffect, index) });
        end = Math.max(end, contact.at + ART.effects[weapon.hitEffect].duration / effectSpeed);
      }
    const lethal = contacts.find(
      (contact) => contact.hit && contact.after === 0 && contact.before > 0,
    );
    if (lethal || (event?.hit && event.after <= 0 && event.before > 0 && !event.strikes)) {
      deathSoundAt = lethal?.at ?? impacts.at(-1);
      cues.push({ at: deathSoundAt, sound: ART.presentation.deathSound });
      deathAt = deathSoundAt + ART.presentation.deathDelay;
      deathEffect = ART.models[target.unit.model].presentation.deathEffect;
      cues.push({ at: deathAt, sound: SpriteEffects.sound(deathEffect) });
      deathEnd = deathAt + ART.effects[deathEffect].duration / effectSpeed;
      end = Math.max(end, deathEnd);
    }
    return {
      shots: activeShots,
      contacts,
      impacts,
      cues,
      deathAt,
      deathEffect,
      deathSoundAt,
      deathEnd,
      moves,
      initialSlot,
      sourceY,
      actionSpeed: speed,
      duration: end + 0.35 / effectSpeed,
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
  function draw(ctx, weapon, plan, time, source, event, size = 1) {
    if (!weapon.projectile) return;
    const image = SpriteRenderer.images[weapon.projectile.asset];
    if (!image) return;
    for (const shot of plan.shots) {
      const age = time - shot.at;
      if (age < 0 || time > shot.visibleUntil) continue;
      const travel = age / shot.flight,
        dx = shot.destination.x - shot.origin.x,
        dy = shot.destination.y - shot.origin.y,
        angle = Math.atan2(dy, dx),
        scale = source.scale * weapon.projectile.scale * size,
        offset = weapon.projectile.forwardOffset * source.scale;
      ctx.save();
      ctx.translate(
        shot.origin.x + dx * travel + Math.cos(angle) * offset,
        shot.origin.y + dy * travel + Math.sin(angle) * offset,
      );
      ctx.rotate(angle + Math.PI / 2 + ((weapon.projectile.rotation || 0) * Math.PI) / 180);
      ctx.scale(scale, scale);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, -image.width / 2, -image.height / 2);
      ctx.restore();
    }
  }
  return { plan, dodge, position, animationSpeed, health, shield, arrived, draw };
})();
