/* 原 MOD 序列帧。命中/爆炸播放一次，低耐久电流单独循环；都不生成伤害。 */
const SpriteEffects = (() => {
  function frame(id, time) {
    const effect = ART.effects[id];
    if (!effect || time < 0 || time >= effect.duration) return null;
    return Math.min(effect.endFrame, effect.startFrame + Math.floor(time * effect.fps));
  }
  function sound(id, index = 0) {
    const sounds = ART.effects[id]?.sounds || [];
    return sounds[Math.abs(index) % sounds.length] || null;
  }
  function draw(ctx, id, x, y, scale, time, angle = 0) {
    const effect = ART.effects[id],
      index = frame(id, time);
    if (index === null) return false;
    const image = SpriteRenderer.images[effect.asset];
    if (!image) return false;
    const width = image.width / effect.frames,
      height = image.height;
    const size =
      scale * (effect.scaleFrom + ((effect.scaleTo - effect.scaleFrom) * time) / effect.duration);
    const forward = effect.offset.y + effect.drift * time,
      lateral = effect.offset.x;
    ctx.save();
    ctx.translate(
      x + (Math.cos(angle) * forward - Math.sin(angle) * lateral) * scale,
      y + (Math.sin(angle) * forward + Math.cos(angle) * lateral) * scale,
    );
    ctx.rotate(angle + ((effect.rotation + 90) * Math.PI) / 180);
    ctx.scale(size, size);
    ctx.globalAlpha *= effect.alpha;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, index * width, 0, width, height, -width / 2, -height / 2, width, height);
    ctx.restore();
    return true;
  }
  // 与原 MOD 一样，仅在存活且 HP 严格低于25%时显示；使用统一演出时钟，不创建计时器。
  function lowHp(ctx, unit, x, y, scale, time, hp = unit.hp) {
    const config = ART.presentation.lowHp,
      effect = ART.effects[config?.effect];
    if (!effect || !Number.isFinite(time)) return false;
    const maxHp =
      typeof Rules !== "undefined"
        ? Rules.modelOf(unit).hp
        : UnitModels[unit.model].hp * (unit.performance ?? 1);
    if (!(hp > 0 && hp < maxHp * config.threshold)) return false;
    return draw(ctx, config.effect, x, y, scale, Math.max(0, time) % effect.duration);
  }
  function boostStart(ctx, unit, x, y, scale, time, angle = unit.angle) {
    if (UnitModels[unit.model].presentation.movement !== "boost") return false;
    return draw(
      ctx,
      ART.presentation.boostStartEffect,
      x,
      y,
      scale,
      time,
      ((angle - 90) * Math.PI) / 180,
    );
  }
  return { frame, sound, draw, lowHp, boostStart };
})();

/* 推进启动爆光留在起步位置，短距离移动结束后也会自然播完，不影响行动。 */
const MovementEffects = (() => {
  const active = [];
  function start(unit, from, next, now) {
    if (!next || UnitModels[unit.model].presentation.movement !== "boost") return;
    active.push({
      unit: { ...unit },
      from,
      start: now,
      angle: (Math.atan2(next.x - from.x, -(next.y - from.y)) * 180) / Math.PI,
    });
  }
  function reset() {
    active.length = 0;
  }
  function draw(ctx, now, position, tile) {
    for (let i = active.length - 1; i >= 0; i--) {
      const item = active[i],
        time = (now - item.start) / 1000;
      if (time >= ART.effects[ART.presentation.boostStartEffect].duration) {
        active.splice(i, 1);
        continue;
      }
      const point = position(item.from.x, item.from.y);
      const scale =
        (tile / 64) *
        1.2 *
        (BattleScene.settings().mapScale / (ART.presentation.mapCellScale || 1)) *
        UnitModels[item.unit.model].presentation.mapScale;
      SpriteEffects.boostStart(ctx, item.unit, point.x, point.y, scale, time, item.angle);
    }
  }
  return { start, reset, draw };
})();

/* 战斗之后才在地图播放死亡爆炸。按战斗与单位去重，不从每帧 HP 检查触发。 */
const MapEffects = (() => {
  const seen = new Set(),
    queue = [],
    active = [],
    callbacks = new Set();
  let sequence = 0;
  function capture(view) {
    if (!view) return;
    const battleId = view.networkId || (view.effectId ||= "local-" + ++sequence);
    for (const event of view.events) {
      if (!event.hit || event.after > 0 || !(event.before > 0)) continue;
      const key = battleId + ":" + event.to,
        unit = view.actors?.find((unit) => unit.id === event.to) || getUnit(event.to);
      if (seen.has(key) || !unit) continue;
      seen.add(key);
      queue.push({
        key,
        unit: { ...unit },
        effect: UnitModels[unit.model].presentation.deathEffect,
        delay: view.deathSoundHeard?.has(event.to) ? 0 : ART.presentation.deathDelay,
      });
    }
  }
  const pending = () => !!(queue.length || active.length);
  function after(callback) {
    if (pending()) callbacks.add(callback);
    else callback();
  }
  function reset() {
    MovementEffects.reset();
    queue.length = active.length = 0;
    seen.clear();
    callbacks.clear();
  }
  function draw(ctx, now, position, tile) {
    if (!byId("battle").hidden || pageView !== "game") return;
    for (const item of queue.splice(0)) {
      item.start = now;
      active.push(item);
      if (item.delay) WeaponAudio.play(ART.presentation.deathSound);
    }
    for (let i = active.length - 1; i >= 0; i--) {
      const item = active[i],
        age = ((now - item.start) / 1000 - item.delay) * ART.presentation.animationSpeed;
      if (age >= ART.effects[item.effect].duration) {
        active.splice(i, 1);
        continue;
      }
      const point = position(item.unit.x, item.unit.y);
      if (age >= 0 && !item.explosionPlayed) {
        item.explosionPlayed = true;
        WeaponAudio.play(SpriteEffects.sound(item.effect));
      }
      const scale =
        (tile / 64) *
        1.2 *
        (BattleScene.settings().mapScale / (ART.presentation.mapCellScale || 1)) *
        UnitModels[item.unit.model].presentation.mapScale;
      if (age < 0)
        SpriteRenderer.draw(
          ctx,
          item.unit.model,
          point.x,
          point.y + tile * 0.035,
          scale,
          item.unit.angle,
          null,
          0,
          item.unit.heldWeapon,
          false,
          (item.unit.shield ?? 0) > 0,
        );
      SpriteEffects.draw(
        ctx,
        item.effect,
        point.x,
        point.y,
        (tile / 64) *
          1.2 *
          (BattleScene.settings().mapScale / (ART.presentation.mapCellScale || 1)) *
          UnitModels[item.unit.model].presentation.mapScale,
        age,
      );
    }
    if (!pending()) {
      const done = [...callbacks];
      callbacks.clear();
      for (const callback of done) callback();
    }
  }
  return { capture, draw, pending, after, reset };
})();
