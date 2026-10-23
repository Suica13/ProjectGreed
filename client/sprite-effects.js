/* 原 MOD 序列帧。每个实例只播放一遍，不循环、不生成新的伤害。 */
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
  return { frame, sound, draw };
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
        unit = getUnit(event.to);
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
        BattleScene.settings().mapScale *
        UnitModels[item.unit.model].presentation.mapScale;
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
          BattleScene.settings().mapScale *
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
