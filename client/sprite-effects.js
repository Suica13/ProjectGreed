/* 原 MOD 序列帧。命中/爆炸播放一次，低耐久电流单独循环；都不生成伤害。 */
const SpriteEffects = (() => {
  let fogClip = null,
    fogTransform = null;
  // Every effect is visible through fog by default. Catalog entries may opt out.
  function setFogClip(path, ctx) {
    fogClip = path;
    fogTransform = ctx?.getTransform();
  }
  function clipFog(ctx) {
    if (!fogClip || !fogTransform) return;
    const transform = ctx.getTransform();
    ctx.setTransform(fogTransform);
    ctx.clip(fogClip);
    ctx.setTransform(transform);
  }

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
    if (effect.visibleInFog === false) clipFog(ctx);
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
  // 死亡到爆炸之间持续循环电流；爆炸开始的同一帧停止。
  function deathElectric(ctx, x, y, scale, elapsed, explosionDelay) {
    const id = ART.presentation.deathElectricEffect,
      effect = ART.effects[id];
    if (!effect || !(effect.duration > 0) || elapsed < 0 || elapsed >= explosionDelay) return false;
    return SpriteEffects.draw(ctx, id, x, y, scale, elapsed % effect.duration);
  }
  // 死亡到爆炸之间持续循环电流；爆炸开始的同一帧停止。
  function deathElectric(ctx, x, y, scale, elapsed, explosionDelay) {
    const id = ART.presentation.deathElectricEffect,
      effect = ART.effects[id];
    if (!effect || !(effect.duration > 0) || elapsed < 0 || elapsed >= explosionDelay) return false;
    return SpriteEffects.draw(ctx, id, x, y, scale, elapsed % effect.duration);
  }
  // Broken turrets remain attached. This is visual only; their weapons stay disabled by shared rules.
  function brokenModules(ctx, model, brokenParts, actor, time) {
    const config = ART.presentation.moduleDamage;
    const effect = ART.effects[config?.effect];
    if (!ART.models[model]?.modules?.length || !effect || !Number.isFinite(time)) return 0;
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
  return { frame, sound, draw, lowHp, deathElectric, brokenModules, setFogClip, clipFog };
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
    IrradiationFX.reset();
    active.length = 0;
  }
  function draw(ctx, now, position, tile) {
    for (let i = active.length - 1; i >= 0; i--) {
      const item = active[i],
        time = (now - item.start) / 1000;
      if (
        time >=
        Math.max(
          ART.effects[item.effect].duration + (item.targetEffect ? 0.5 : 0),
          item.reconMode === "camera" ? 0.75 : 0,
        )
      ) {
        active.splice(i, 1);
        continue;
      }
      if (item.targetEffect && time < 0.5) {
        const from = position(item.from.x, item.from.y),
          to = position(item.to.x, item.to.y),
          t = time / 0.5;
        ctx.save();
        ctx.strokeStyle = "#dffbff";
        ctx.lineWidth = Math.max(2, tile * 0.07);
        ctx.beginPath();
        ctx.moveTo(
          from.x + (to.x - from.x) * Math.max(0, t - 0.1),
          from.y + (to.y - from.y) * Math.max(0, t - 0.1),
        );
        ctx.lineTo(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
        ctx.stroke();
        ctx.restore();
        continue;
      }
      const location = item.reconMode === "camera" || item.targetEffect ? item.to : item.from;
      const point = position(location.x, location.y);
      SpriteEffects.draw(
        ctx,
        item.effect,
        point.x,
        point.y,
        tile / 64,
        time - (item.targetEffect ? 0.5 : 0),
      );
    }
  }
  function pose(unit, now) {
    const irradiation = IrradiationFX.pose(unit, now);
    if (irradiation) return irradiation;
    const item = active.find(
      (event) =>
        event.unitId === unit.id && event.reconMode === "camera" && now - event.start < 750,
    );
    if (!item) return null;
    const point = Rules.center(unit);
    return {
      weaponDisplayIndex: item.weaponDisplayIndex,
      clip: "Common_Shoot_A",
      time: (now - item.start) / 1000,
      angle: (Math.atan2(item.to.x - point.x, -(item.to.y - point.y)) * 180) / Math.PI,
    };
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
      .filter((e) => (e.type === "overdrive" && e.hp <= 0) || (e.type === "burn" && e.after <= 0))
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
      SpriteEffects.deathElectric(
        ctx,
        point.x,
        point.y,
        scale,
        (now - item.start) / 1000,
        item.delay,
      );
      SpriteEffects.deathElectric(
        ctx,
        point.x,
        point.y,
        scale,
        (now - item.start) / 1000,
        item.delay,
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

/* Presentation-only altitude, water entry and cached soft fog. No gameplay mutations. */
const EnvironmentVisuals = (() => {
  let matchKey = null,
    fogKey = null,
    fogCanvas = null,
    smoothFogCanvas = null,
    fogCells = null,
    fogWidth = 0,
    fogHeight = 0,
    smoothRadius = null,
    visibleMapPath = null,
    screenClip = null,
    screenClipKey = null;
  const fogPixelsPerCell = 8;
  const water = new Map(),
    splashes = [];
  function pose(unit, cell) {
    // Exposed SFS cargo inherits its carrier's altitude, not the terrain below it.
    const carrier = unit.embarked?.exposed && !unit.pendingMove?.launch
      ? getUnit(unit.embarked.carrierId) : null;
    const environment = Rules.environmentOf(game, carrier || unit, cell.x, cell.y);
    return {
      environment,
      offset: environment === "air" ? -0.2 : environment === "water" ? 0.14 : 0,
      alpha: environment === "water" ? 0.58 : 1,
    };
  }
  function observe(unit, cell, now) {
    const currentMatch = typeof Net !== "undefined" && Net.active ? Net.snapshot?.matchId : game;
    if (currentMatch !== matchKey) {
      water.clear();
      splashes.length = 0;
      matchKey = currentMatch;
    }
    const submerged = pose(unit, cell).environment === "water";
    if (water.get(unit.id) === false && submerged) splashes.push({ ...cell, start: now });
    water.set(unit.id, submerged);
  }
  function drawWater(ctx, now, position, tile) {
    // TODO: Find and import the original MOD water-entry effect; replace this procedural fallback.
    for (let i = splashes.length - 1; i >= 0; i--) {
      const splash = splashes[i],
        age = (now - splash.start) / 700;
      if (age >= 1) {
        splashes.splice(i, 1);
        continue;
      }
      const p = position(splash.x, splash.y);
      ctx.save();
      SpriteEffects.clipFog(ctx);
      ctx.strokeStyle = `rgba(175,230,255,${1 - age})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(
        p.x,
        p.y,
        tile * (0.15 + age * 0.55),
        tile * (0.06 + age * 0.22),
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      for (let n = 0; n < 8; n++) {
        const a = (n * Math.PI) / 4;
        ctx.beginPath();
        ctx.arc(
          p.x + Math.cos(a) * age * tile * 0.45,
          p.y + Math.sin(a) * age * tile * 0.18 - Math.sin(age * Math.PI) * tile * 0.3,
          Math.max(1, tile * 0.025),
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  function prepareFog(intel) {
    const width = Rules.mapWidth(game),
      height = Rules.mapHeight(game);
    // Visibility lists are immutable snapshots. Compare their contents only when
    // a new snapshot arrives, not on every animation frame.
    if (fogCells === intel.visibleCells && fogWidth === width && fogHeight === height) return;
    fogCells = intel.visibleCells;
    fogWidth = width;
    fogHeight = height;
    const key = JSON.stringify([width, height, intel.visibleCells]);
    if (key === fogKey) return;
    fogKey = key;
    fogCanvas = document.createElement("canvas");
    fogCanvas.width = width * fogPixelsPerCell;
    fogCanvas.height = height * fogPixelsPerCell;
    const c = fogCanvas.getContext("2d"),
      visible = new Set(intel.visibleCells);
    c.fillStyle = "rgba(3,10,18,0.78)";
    visibleMapPath = new Path2D();
    // Merge each horizontal run: effect layers no longer clip thousands of
    // individual rectangles when the entire battlefield is on screen.
    for (let y = 0; y < height; y++) {
      let run = -1;
      for (let x = 0; x <= width; x++) {
        const seen = x < width && visible.has(x + "," + y);
        if (seen && run < 0) run = x;
        if (!seen && run >= 0) {
          visibleMapPath.rect(run, y, x - run, 1);
          run = -1;
        }
        if (!seen && x < width)
          c.fillRect(
            x * fogPixelsPerCell,
            y * fogPixelsPerCell,
            fogPixelsPerCell,
            fogPixelsPerCell,
          );
      }
    }
    smoothRadius = null;
    screenClipKey = null;
  }
  function visibilityClip(intel, ox, oy, tile) {
    if (!intel) return null;
    prepareFog(intel);
    const key = [ox, oy, tile].join(":");
    if (screenClipKey !== key) {
      screenClipKey = key;
      screenClip = new Path2D();
      screenClip.addPath(visibleMapPath, new DOMMatrix([tile, 0, 0, tile, ox, oy]));
    }
    return screenClip;
  }
  function fog(ctx, intel, ox, oy, tile) {
    if (!intel) return;
    prepareFog(intel);
    // Apply blur to the small cached mask. Most zoom levels share one radius;
    // very small cells retain the original minimum one-screen-pixel softness.
    const radius = Math.ceil(Math.max(0.12 * fogPixelsPerCell, fogPixelsPerCell / tile) * 4) / 4;
    if (smoothRadius !== radius) {
      smoothRadius = radius;
      smoothFogCanvas ??= document.createElement("canvas");
      smoothFogCanvas.width = fogCanvas.width;
      smoothFogCanvas.height = fogCanvas.height;
      const c = smoothFogCanvas.getContext("2d");
      c.filter = `blur(${radius}px)`;
      c.drawImage(fogCanvas, 0, 0);
      c.filter = "none";
    }
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(smoothFogCanvas, ox, oy, fogWidth * tile, fogHeight * tile);
    ctx.restore();
  }
  let smokeStamp = null;
  function smoke(ctx, game, position, tile) {
    const fields = (game.smokeFields || []).filter((field) => field.expiresRound > game.round);
    if (!fields.length) return;
    if (!smokeStamp) {
      smokeStamp = document.createElement("canvas");
      smokeStamp.width = smokeStamp.height = 192;
      const c = smokeStamp.getContext("2d"),
        gradient = c.createRadialGradient(96, 96, 40, 96, 96, 96);
      gradient.addColorStop(0, "rgba(246,249,252,.84)");
      gradient.addColorStop(0.65, "rgba(238,244,250,.76)");
      gradient.addColorStop(1, "rgba(236,242,248,0)");
      c.fillStyle = gradient;
      c.fillRect(0, 0, 192, 192);
    }
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    for (const field of fields) {
      const point = position(field.x, field.y),
        radius = (field.radius + 0.5) * tile;
      ctx.drawImage(smokeStamp, point.x - radius, point.y - radius, radius * 2, radius * 2);
    }
    ctx.restore();
  }
  return { pose, observe, drawWater, fog, visibilityClip, smoke };
})();
