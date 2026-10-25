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
  // Broken turrets remain attached. This is visual only; their weapons stay disabled by shared rules.
  function brokenModules(ctx, model, brokenParts, actor, time) {
    const config = ART.presentation.moduleDamage;
    const effect = ART.effects[config?.effect];
    if (!ART.models[model]?.ship || !effect || !Number.isFinite(time)) return 0;
    let count = 0;
    for (const module of ART.models[model].modules || []) {
      if (!brokenParts?.[module.id]) continue;
      const point = SpriteRenderer.modulePosition(model, module.id, actor);
      if (
        point &&
        draw(
          ctx,
          config.effect,
          point.x,
          point.y,
          actor.scale * config.scale,
          Math.max(0, time) % effect.duration,
        )
      )
        count++;
    }
    return count;
  }
  return { frame, sound, draw, lowHp, brokenModules };
})();

/* 脱出闪光留在原机体所在位置，不触发死亡电流或死亡爆炸。 */
const SkillEffects = (() => {
  const active = [];
  function start(event) {
    if (!ART.effects[event.effect]) return;
    active.push({ ...event, start: performance.now() });
    GameAudio.playSound(event.sound);
  }
  function reset() {
    active.length = 0;
  }
  function draw(ctx, now, position, tile) {
    for (let i = active.length - 1; i >= 0; i--) {
      const item = active[i],
        time = (now - item.start) / 1000;
      if (time >= Math.max(ART.effects[item.effect].duration, item.reconMode === "camera" ? 0.75 : 0)) {
        active.splice(i, 1);
        continue;
      }
      const location = item.reconMode === "camera" ? item.to : item.from;
      const point = position(location.x, location.y);
      SpriteEffects.draw(ctx, item.effect, point.x, point.y, tile / 64, time);
    }
  }
  function pose(unit, now) {
    const item = active.find(event => event.unitId === unit.id && event.reconMode === "camera" && now - event.start < 750);
    if (!item) return null;
    const point = Rules.center(unit);
    return { weaponDisplayIndex: item.weaponDisplayIndex, clip: "Common_Shoot_A", time: (now-item.start)/1000,
      angle: Math.atan2(item.to.x-point.x, -(item.to.y-point.y))*180/Math.PI };
  }
  return { start, reset, draw, pose };
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
        effect: WeaponEffects.deathSequence(unit).effect,
        sequence: WeaponEffects.deathSequence(unit),
        delay: view.deathSoundHeard?.has(event.to) ? 0 : ART.presentation.deathDelay,
      });
    }
  }
  function captureTurn(game) {
    const events = (game.turnEffects || [])
      .filter((e) => e.type === "overdrive" && e.hp <= 0)
      .map((e) => ({ hit: true, before: 1, after: 0, to: e.unitId }));
    if (events.length) capture({ networkId: "upkeep-" + game.round, events });
  }
  const pending = () => !!(queue.length || active.length);
  function after(callback) {
    if (pending()) callbacks.add(callback);
    else callback();
  }
  function reset() {
    SkillEffects.reset();
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
      if (age >= item.sequence.duration) {
        active.splice(i, 1);
        continue;
      }
      const center = typeof Rules !== "undefined" ? Rules.center(item.unit) : item.unit;
      const point = position(center.x, center.y);
      item.played ||= new Set();
      for (const [index, explosion] of item.sequence.events.entries())
        if (age >= explosion.at && !item.played.has(index)) {
          item.played.add(index);
          WeaponAudio.play(SpriteEffects.sound(explosion.effect));
        }
      const scale =
        (tile / 64) *
        1.2 *
        (BattleScene.settings().mapScale / (ART.presentation.mapCellScale || 1)) *
        UnitModels[item.unit.model].presentation.mapScale;
      if (age < 0 || item.sequence.keepSpriteUntilEnd)
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
      WeaponEffects.drawDeath(ctx, item.sequence, item.unit, point.x, point.y, scale, age);
    }
    if (!pending()) {
      const done = [...callbacks];
      callbacks.clear();
      for (const callback of done) callback();
    }
  }
  return { capture, captureTurn, draw, pending, after, reset };
})();
