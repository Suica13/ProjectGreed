/* 贴图、骨骼与挂点共用同一套变换。配置只使用普通数值与命名变量。 */
const SpriteRenderer = (() => {
  const models = Object.fromEntries(ART.units.map((unit) => [unit.id, unit])),
    images = {};
  const radians = (degrees) => (degrees * Math.PI) / 180;

  function sample(animation, time) {
    const result = {};
    for (const [bone, fields] of Object.entries(animation?.curves || {})) {
      result[bone] = {};
      for (const [field, points] of Object.entries(fields)) {
        let value = points.at(-1)[1];
        if (time <= points[0][0]) value = points[0][1];
        else
          for (let i = 0; i < points.length - 1; i++) {
            const [start, a] = points[i],
              [end, b] = points[i + 1];
            if (time >= start && time <= end) {
              value = a + ((b - a) * (time - start)) / (end - start);
              break;
            }
          }
        result[bone][field] = value;
      }
    }
    return result;
  }
  function pose(model, clip, time, loop = false) {
    const animation = models[model].animations[clip];
    const at = animation
      ? loop
        ? time % animation.duration
        : Math.min(time, animation.duration)
      : 0;
    return sample(animation, at);
  }
  function state(model, heldWeapon) {
    const unit = models[model];
    return {
      kit: unit.kit,
      keepBrokenModules: !!ART.models[model].modules?.length,
      heldWeapon: heldWeapon || ART.models[model].weapons[0]?.id || null,
      shieldVisible: unit.presentation.shield,
      visorClosed: false,
    };
  }
  function visible(layer, variables, clip, time) {
    if (layer.hidden) return false;
    if (variables.attacking && layer.hideWhenFiringIndex === variables.weaponDisplayIndex)
      return false;
    if (layer.moduleId && variables.brokenParts?.[layer.moduleId] && !variables.keepBrokenModules)
      return false;
    if (layer.requiredParts?.some((part) => variables.brokenParts?.[part])) return false;
    // 图层切换按骨骼动画时间采样，快速演出和暂停不会改变切换位置。
    const window = layer.animationVisibility;
    if (window) {
      const inside = clip === window.clip && time >= window.start && time < window.end;
      if (inside !== window.visibleInside) return false;
    }
    return Object.entries(layer.visibleWhen || {}).every(([key, expected]) => {
      if (Array.isArray(expected)) return expected.includes(variables[key]);
      if (expected && typeof expected === "object")
        return Array.isArray(expected.not)
          ? !expected.not.includes(variables[key])
          : variables[key] !== expected.not;
      return variables[key] === expected;
    });
  }
  function visibleLayers(
    model,
    heldWeapon,
    shieldVisible = true,
    moving = false,
    clip = null,
    time = 0,
    loop = false,
    brokenParts = {},
    attacking = null,
    onLand = false,
    environment = "ground",
    attackWeapon = null,
    weaponDisplayIndex = null,
    flying = false,
  ) {
    const animation = models[model].animations[clip];
    const at = animation
      ? loop
        ? time % animation.duration
        : Math.min(time, animation.duration)
      : 0;
    const variables = state(model, heldWeapon);
    variables.shieldVisible = variables.shieldVisible && shieldVisible;
    variables.moving = moving;
    variables.onLand = onLand;
    variables.attacking = attacking ?? (!!clip && /Shoot|Fire|Attack/.test(clip));
    variables.heldAttacking =
      variables.attacking &&
      (!attackWeapon ||
        attackWeapon === variables.heldWeapon ||
        ART.models[model].weapons.find((w) => w.id === attackWeapon)?.special?.baseWeapon ===
          variables.heldWeapon);
    variables.weaponDisplayIndex =
      weaponDisplayIndex ??
      ART.models[model].weapons.find((w) => w.id === variables.heldWeapon)?.displayIndex ??
      0;
    variables.brokenParts = brokenParts;
    const thrusters = ART.models[model].presentation.thrusters !== false;
    variables.boosting = thrusters && models[model].presentation.movement === "boost";
    const airborne = flying || ART.models[model].movementType === "air";
    variables.sustainedThrust = thrusters && (environment === "space" || airborne);
    // Aircraft need their native engine flames as well as the smaller reversing jets.
    variables.thrustActive =
      (moving && variables.boosting) ||
      ((ART.models[model].ship || airborne) && variables.sustainedThrust);
    return models[model].decals.filter((layer) => visible(layer, variables, clip, at));
  }
  function turretPose(model, sampled, angle, aimAngle = angle, firingModules = []) {
    const modules = [
      ...(ART.models[model].modules || []),
      ...(ART.models[model].visualTurrets || []),
    ];
    if (!modules) return sampled;
    sampled = { ...sampled };
    for (const module of modules) {
      const delta = ((((aimAngle - angle - module.idleDir + 180) % 360) + 360) % 360) - 180;
      sampled[module.bone] = {
        ...(sampled[module.bone] || {}),
        dir:
          ART.models[model].modules?.length &&
          (!firingModules.includes(module.id) || Math.abs(delta) > module.arc)
            ? 0
            : Math.max(-module.arc, Math.min(module.arc, delta)),
      };
    }
    return sampled;
  }
  // offset.x 横向，offset.y 向前。贴图坐标则 x 向右、y 向下。
  function layerTransform(model, layer, angle, pose) {
    const bone = models[model].bones[layer.bone],
      animation = pose[layer.bone] || {};
    const theta = radians(angle - 90),
      bx = bone.x + (animation.x || 0),
      by = bone.y + (animation.y || 0);
    const facing =
      angle - 90 + (bone.endDirOffset || 0) + (bone.drawDirOffset || 0) + (animation.dir || 0);
    const rotation = radians(facing + (layer.pivot || 0)),
      offset = layer.offset || {};
    return {
      x:
        Math.cos(theta) * by -
        Math.sin(theta) * bx +
        Math.cos(rotation) * (offset.y || 0) -
        Math.sin(rotation) * (offset.x || 0) +
        (layer.worldOffset?.x || 0),
      y:
        Math.sin(theta) * by +
        Math.cos(theta) * bx +
        Math.sin(rotation) * (offset.y || 0) +
        Math.cos(rotation) * (offset.x || 0) +
        (layer.worldOffset?.y || 0) -
        (layer.height || 0) -
        (animation.height || 0),
      rotation: radians(facing + 90 + (layer.rotation || 0)),
      scaleX: (layer.scale ?? 1) * (layer.scaleX ?? 1),
      scaleY: (layer.scale ?? 1) * (layer.scaleY ?? 1),
    };
  }
  function modulePosition(model, moduleId, actor) {
    const module = ART.models[model].modules?.find((m) => m.id === moduleId);
    if (!module) return null;
    const transform = layerTransform(model, { bone: module.bone }, actor.angle, {});
    return { x: actor.x + transform.x * actor.scale, y: actor.y + transform.y * actor.scale };
  }
  // 在发射的那一刻采样，与枪的 PNG 同步移动、旋转、缩放和镜像。
  function muzzle(model, weapon, actor, clip, time, shotIndex = 0) {
    const mountShotIndex = weapon.attack.muzzleShotIndices?.[shotIndex] ?? shotIndex;
    const mount = weapon.muzzle.mounts
        ? weapon.muzzle.mounts[weapon.attack.muzzleIndices[shotIndex] ?? 0]
        : weapon.muzzle,
      unit = models[model],
      sampled = turretPose(
        model,
        pose(model, clip, time),
        actor.angle,
        actor.aimAngle ?? actor.unit?.aimAngle ?? actor.angle,
        weapon.moduleIds || [],
      );
    const layer = mount.layer
      ? unit.decals.find((layer) => layer.name === mount.layer)
      : {
          bone: mount.bone,
          offset: {
            ...mount.offset,
            x: mount.offset.x + (mountShotIndex % 2) * (mount.alternatingOffsetX || 0),
          },
        };
    const transform = layerTransform(model, layer, actor.angle, sampled),
      point = { ...(mount.point || { x: 0, y: 0 }) };
    if (mount.layer && mount.alternatingPoint && mountShotIndex % 2) {
      point.x += mount.alternatingPoint.x;
      point.y += mount.alternatingPoint.y;
    }
    if (mount.pairSpacing) point.x += ((mountShotIndex % 2 ? 1 : -1) * mount.pairSpacing) / 2;
    const px = point.x * transform.scaleX,
      py = point.y * transform.scaleY;
    return {
      x:
        actor.x +
        (transform.x + Math.cos(transform.rotation) * px - Math.sin(transform.rotation) * py) *
          actor.scale,
      y:
        actor.y +
        (transform.y + Math.sin(transform.rotation) * px + Math.cos(transform.rotation) * py) *
          actor.scale,
    };
  }
  const outlineCache = new Map();
  function turretOutline(asset, image, frame, columns, fw, fh, usable) {
    const key = [asset, frame, usable].join(":");
    if (outlineCache.has(key)) return outlineCache.get(key);
    const canvas = document.createElement("canvas");
    canvas.width = fw + 4;
    canvas.height = fh + 4;
    const c = canvas.getContext("2d");
    const stamp = (x, y) =>
      c.drawImage(
        image,
        (frame % columns) * fw,
        Math.floor(frame / columns) * fh,
        fw,
        fh,
        x,
        y,
        fw,
        fh,
      );
    for (const [x, y] of [
      [0, 0],
      [2, 0],
      [4, 0],
      [0, 2],
      [4, 2],
      [0, 4],
      [2, 4],
      [4, 4],
    ])
      stamp(x, y);
    c.globalCompositeOperation = "source-in";
    c.fillStyle = usable ? "#48ff72" : "#ff4545";
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.globalCompositeOperation = "destination-out";
    stamp(2, 2);
    outlineCache.set(key, canvas);
    return canvas;
  }
  // A small visual-only height variation in source pixels. Shadows and map cells stay fixed.
  function flightOffset(model, now, flying = false, environment = "ground") {
    if (environment === "space" || !(flying || ART.models[model].movementType === "air")) return 0;
    let phase = 0;
    for (const character of model) phase = (phase * 31 + character.charCodeAt(0)) >>> 0;
    const t = now / 1000,
      seed = (phase % 628) / 100;
    return Math.sin(t * 2.1 + seed) * 1.1 + Math.sin(t * 3.7 + seed * 1.3) * 0.3;
  }
  function draw(
    ctx,
    model,
    x,
    y,
    scale,
    angle = 0,
    clip = "Common_Idle",
    time = 0,
    heldWeapon = null,
    loop = true,
    shieldVisible = true,
    moving = false,
    brokenParts = {},
    aimAngle = angle,
    attacking = null,
    onLand = false,
    environment = "ground",
    attackWeapon = null,
    weaponDisplayIndex = null,
    flying = false,
    turretStatus = null,
    effectsOnly = false,
  ) {
    const isFiring = attacking ?? (!!clip && /Shoot|Fire|Attack/.test(clip));
    const active = isFiring
      ? (ART.models[model].weapons.find((w) => w.id === heldWeapon)?.moduleIds || []).filter(
          (id) => !brokenParts[id],
        )
      : [];
    const sampled = turretPose(model, pose(model, clip, time, loop), angle, aimAngle, active);
    ctx.save();
    const flightClock = globalThis.ReplayPlayer?.active
      ? globalThis.ReplayPlayer.time * 1000
      : performance.now();
    ctx.translate(x, y + flightOffset(model, flightClock, flying, environment) * scale);
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = false;
    const outlines = [];
    for (const layer of visibleLayers(
      model,
      heldWeapon,
      shieldVisible,
      moving,
      clip,
      time,
      loop,
      brokenParts,
      attacking,
      onLand,
      environment,
      attackWeapon,
      weaponDisplayIndex,
      flying,
    )) {
      const effectLayer =
        layer.effect === true ||
        layer.visibleWhen?.thrustActive ||
        layer.visibleWhen?.sustainedThrust ||
        layer.independentClock;
      const movementEffect =
        layer.visibleWhen?.thrustActive ||
        layer.visibleWhen?.sustainedThrust ||
        layer.visibleWhen?.moving ||
        layer.onlyAnimateWhenMoving;
      if (effectsOnly && (!effectLayer || movementEffect || layer.visibleInFog === false)) continue;
      const image = images[layer.asset];
      if (!image) continue;
      const transform = layerTransform(model, layer, angle, sampled);
      const frames = layer.frames || 1,
        fw = layer.frameWidth || Math.floor(image.width / frames),
        fh = layer.frameHeight || image.height;
      const useWallClock =
        layer.independentClock &&
        (!layer.visibleWhen?.thrustActive ||
          environment === "space" ||
          flying ||
          ART.models[model].movementType === "air");
      const effectTime =
        useWallClock && typeof performance !== "undefined"
          ? globalThis.ReplayPlayer?.active
            ? globalThis.ReplayPlayer.time
            : performance.now() / 1000
          : time;
      const attackFrame = layer.attackFrame;
      const firing = attacking ?? (!!clip && /Shoot|Fire|Attack/.test(clip));
      const frame =
          attackFrame && firing && attackFrame.weapons.includes(attackWeapon || heldWeapon)
            ? attackFrame.frame
            : layer.frameFps && (!layer.onlyAnimateWhenMoving || moving)
              ? Math.floor(Math.max(0, effectTime) * layer.frameFps) % frames
              : layer.frame || 0,
        columns = Math.floor(image.width / fw);
      if (layer.moduleId && turretStatus && Object.hasOwn(turretStatus, layer.moduleId))
        outlines.push({
          transform,
          fw,
          fh,
          image: turretOutline(
            layer.asset,
            image,
            frame,
            columns,
            fw,
            fh,
            turretStatus[layer.moduleId],
          ),
        });
      ctx.save();
      if (movementEffect || layer.visibleInFog === false) SpriteEffects.clipFog(ctx);
      ctx.translate(transform.x, transform.y);
      ctx.rotate(
        transform.rotation +
          radians(
            (layer.rotationSpeed || 0) *
              (typeof performance !== "undefined"
                ? globalThis.ReplayPlayer?.active
                  ? globalThis.ReplayPlayer.time
                  : performance.now() / 1000
                : time),
          ),
      );
      ctx.scale(transform.scaleX, transform.scaleY);
      ctx.globalAlpha *= layer.alpha ?? 1;
      ctx.drawImage(
        image,
        (frame % columns) * fw,
        Math.floor(frame / columns) * fh,
        fw,
        fh,
        -fw / 2,
        -fh / 2,
        fw,
        fh,
      );
      ctx.restore();
    }
    for (const outline of outlines) {
      const t = outline.transform;
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(t.rotation);
      ctx.scale(t.scaleX, t.scaleY);
      ctx.drawImage(outline.image, -outline.fw / 2 - 2, -outline.fh / 2 - 2);
      ctx.restore();
    }
    ctx.restore();
    if (typeof SpriteEffects !== "undefined")
      SpriteEffects.brokenModules(
        ctx,
        model,
        brokenParts,
        { x, y, scale, angle },
        typeof performance !== "undefined"
          ? globalThis.ReplayPlayer?.active
            ? globalThis.ReplayPlayer.time
            : performance.now() / 1000
          : time,
      );
  }
  function movement(model) {
    const presentation = models[model].presentation;
    return presentation.movement === "walk" ? presentation.walk : presentation.move;
  }
  async function load(onProgress = () => {}) {
    const groups = new Map();
    for (const [key, source] of Object.entries(ART.assets)) {
      if (!groups.has(source)) groups.set(source, []);
      groups.get(source).push(key);
    }
    const entries = [...groups],
      total = Object.keys(ART.assets).length;
    let loaded = 0,
      cursor = 0;
    onProgress(0, total);
    // Reuse decoded images and bound concurrent decoding, especially on phones.
    async function worker() {
      while (cursor < entries.length) {
        const [source, keys] = entries[cursor++];
        await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => {
            for (const key of keys) images[key] = image;
            loaded += keys.length;
            onProgress(loaded, total);
            resolve();
          };
          image.onerror = () => reject(Error("Asset loading failed: " + keys[0]));
          image.src = source;
        });
      }
    }
    await Promise.all(Array.from({ length: Math.min(8, entries.length) }, () => worker()));
  }
  return {
    draw,
    load,
    models,
    images,
    sample,
    pose,
    layerTransform,
    modulePosition,
    muzzle,
    visibleLayers,
    movement,
    flightOffset,
  };
})();
