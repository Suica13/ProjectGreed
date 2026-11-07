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
  let drawSamples = new WeakMap(),
    idleBakeSpent = 0;
  const idleImages = new Map(),
    staticAnimations = new WeakMap();
  function staticPose(animation) {
    if (!animation) return true;
    if (!staticAnimations.has(animation))
      staticAnimations.set(
        animation,
        Object.values(animation.curves || {}).every((fields) =>
          Object.values(fields).every((points) =>
            points.every((point) => point[1] === points[0][1]),
          ),
        ),
      );
    return staticAnimations.get(animation);
  }
  let idleImagePixels = 0,
    idleFrame = 0,
    idleMissing = 0,
    idleColdPending = false;
  let idleUpdateKeys = [],
    idleUpdateCursor = 0;
  function beginFrame() {
    drawSamples = new WeakMap();
    idleBakeSpent = 0;
    idleFrame++;
    idleColdPending = idleMissing > 0;
    idleMissing = 0;
    idleUpdateCursor = 0;
    idleUpdateKeys = [...idleImages.entries()]
      .filter(
        ([, entry]) => entry.seenFrame >= idleFrame - 1 && entry.desiredBucket !== entry.bucket,
      )
      .sort((a, b) => a[1].bakedFrame - b[1].bakedFrame)
      .map(([key]) => key);
  }
  function drawPose(model, clip, time, loop) {
    const animation = models[model].animations[clip];
    if (!animation) return {};
    const at = loop ? time % animation.duration : Math.min(time, animation.duration);
    const cached = drawSamples.get(animation);
    if (cached?.at === at) return cached.pose;
    const value = sample(animation, at);
    drawSamples.set(animation, { at, pose: value });
    return value;
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
    boostSkillActive = false,
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
    variables.boostSkillActive = boostSkillActive;
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
    if (!modules.length) return sampled;
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
    if (mount.root) {
      const theta = radians(actor.angle - 90),
        offset = mount.offset;
      return {
        x: actor.x + (Math.cos(theta) * offset.y - Math.sin(theta) * offset.x) * actor.scale,
        y: actor.y + (Math.sin(theta) * offset.y + Math.cos(theta) * offset.x) * actor.scale,
      };
    }
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
  let outlinePixels = 0;
  function turretOutline(asset, image, frame, columns, fw, fh, usable) {
    const key = [asset, frame, usable].join(":");
    if (outlineCache.has(key)) {
      const canvas = outlineCache.get(key);
      outlineCache.delete(key); outlineCache.set(key, canvas);
      return canvas;
    }
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
    outlinePixels += canvas.width * canvas.height;
    while (outlineCache.size > 128 || outlinePixels > 4 * 1024 * 1024) {
      const oldest = outlineCache.keys().next().value, removed = outlineCache.get(oldest);
      if (removed === canvas) break;
      outlineCache.delete(oldest); outlinePixels -= removed.width * removed.height;
      removed.width = removed.height = 0;
    }
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
  const modelRadii = new Map();
  function radius(model) {
    if (modelRadii.has(model)) return modelRadii.get(model);
    const unit = models[model],
      motion = {};
    // Enclose all poses and layers, including long weapons and engine flames.
    for (const animation of Object.values(unit.animations))
      for (const [bone, fields] of Object.entries(animation.curves || {})) {
        motion[bone] ||= { x: 0, y: 0, height: 0 };
        for (const key of ["x", "y", "height"])
          for (const [, value] of fields[key] || [])
            motion[bone][key] = Math.max(motion[bone][key], Math.abs(value));
      }
    let result = 0;
    for (const layer of unit.decals) {
      const image = images[layer.asset];
      // Missing assets may finish loading later; never cache an incomplete bound.
      if (!image) return Infinity;
      const bone = unit.bones[layer.bone],
        delta = motion[layer.bone] || {},
        offset = layer.offset || {};
      const width = layer.frameWidth || Math.floor(image.width / (layer.frames || 1)),
        height = layer.frameHeight || image.height;
      result = Math.max(
        result,
        Math.hypot(bone.x, bone.y) +
          (delta.x || 0) +
          (delta.y || 0) +
          (delta.height || 0) +
          Math.hypot(offset.x || 0, offset.y || 0) +
          Math.hypot(layer.worldOffset?.x || 0, layer.worldOffset?.y || 0) +
          Math.abs(layer.height || 0) +
          Math.hypot(
            width * Math.abs((layer.scale ?? 1) * (layer.scaleX ?? 1)),
            height * Math.abs((layer.scale ?? 1) * (layer.scaleY ?? 1)),
          ) /
            2,
      );
    }
    modelRadii.set(model, result);
    return result;
  }
  const shadowCache = new Map();
  let shadowPixels = 0;
  function drawUnitShadow(
    ctx,
    model,
    layers,
    sampled,
    angle,
    aimAngle,
    clip,
    time,
    moving,
    hidden,
    lighting,
  ) {
    const casters = layers.filter(
      (layer) =>
        !hidden.includes(layer.name) &&
        layer.castsShadow !== false &&
        layer.shadowCaster !== false &&
        layer.effect !== true &&
        !layer.independentClock &&
        layer.visibleInFog !== false &&
        !layer.visibleWhen?.thrustActive &&
        !layer.visibleWhen?.sustainedThrust &&
        !layer.visibleWhen?.moving,
    );
    const duration = models[model].animations[clip]?.duration || 1;
    const key = JSON.stringify([
      model,
      angle,
      aimAngle,
      clip,
      Math.floor((time % duration) * 24),
      moving,
      casters.map((layer) => [
        layer.name,
        layer.frameFps ? Math.floor(time * layer.frameFps) % (layer.frames || 1) : layer.frame || 0,
      ]),
      lighting.direction,
      lighting.horizontalAngle,
      lighting.distance,
      lighting.heightScale,
    ]);
    let entry = shadowCache.get(key);
    if (!entry) {
      let left = Infinity,
        top = Infinity,
        right = -Infinity,
        bottom = -Infinity;
      const items = [];
      for (const layer of casters) {
        const image = images[layer.asset];
        if (!image) return; // Do not cache a partially loaded silhouette.
        const transform = layerTransform(model, layer, angle, sampled),
          frames = layer.frames || 1;
        const fw = layer.frameWidth || Math.floor(image.width / frames),
          fh = layer.frameHeight || image.height;
        const frame =
          layer.frameFps && (!layer.onlyAnimateWhenMoving || moving)
            ? Math.floor(Math.max(0, time) * layer.frameFps) % frames
            : layer.frame || 0;
        const columns = Math.max(1, Math.floor(image.width / fw));
        const elevation = Math.max(0, (layer.height || 0) + (sampled[layer.bone]?.height || 0));
        const projection = MapShadowLighting.projection(lighting, 1 + elevation / 64);
        const x = transform.x + projection.x * 64,
          y = transform.y + elevation + projection.y * 64;
        const cos = Math.abs(Math.cos(transform.rotation)),
          sin = Math.abs(Math.sin(transform.rotation));
        const rx =
          (cos * Math.abs(fw * transform.scaleX) + sin * Math.abs(fh * transform.scaleY)) / 2;
        const ry =
          (sin * Math.abs(fw * transform.scaleX) + cos * Math.abs(fh * transform.scaleY)) / 2;
        left = Math.min(left, x - rx);
        right = Math.max(right, x + rx);
        top = Math.min(top, y - ry);
        bottom = Math.max(bottom, y + ry);
        items.push({ image, transform, fw, fh, frame, columns, x, y });
      }
      if (!items.length) return;
      left = Math.floor(left) - 1;
      top = Math.floor(top) - 1;
      const width = Math.ceil(right - left) + 1,
        height = Math.ceil(bottom - top) + 1;
      const resolution = Math.min(1, 2048 / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(width * resolution));
      canvas.height = Math.max(1, Math.ceil(height * resolution));
      const surface = canvas.getContext("2d");
      surface.scale(resolution, resolution);
      surface.translate(-left, -top);
      surface.imageSmoothingEnabled = false;
      for (const item of items) {
        const { image, transform, fw, fh, frame, columns, x, y } = item;
        surface.save();
        surface.translate(x, y);
        surface.rotate(transform.rotation);
        surface.scale(transform.scaleX, transform.scaleY);
        surface.drawImage(
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
        surface.restore();
      }
      // Merge all parts first; opacity is applied exactly once to the whole unit.
      surface.setTransform(1, 0, 0, 1, 0, 0);
      surface.globalCompositeOperation = "source-in";
      surface.fillStyle = "#000";
      surface.fillRect(0, 0, canvas.width, canvas.height);
      entry = {
        canvas,
        left,
        top,
        width,
        height,
        pixels: canvas.width * canvas.height,
      };
      shadowCache.set(key, entry);
      shadowPixels += entry.pixels;
      while (shadowCache.size > 256 || shadowPixels > 8 * 1024 * 1024) {
        const oldest = shadowCache.keys().next().value,
          removed = shadowCache.get(oldest);
        shadowCache.delete(oldest);
        shadowPixels -= removed.pixels;
        removed.canvas.width = removed.canvas.height = 0;
      }
    } else {
      shadowCache.delete(key);
      shadowCache.set(key, entry);
    }
    ctx.save();
    ctx.globalAlpha *= lighting.intensity;
    ctx.drawImage(entry.canvas, entry.left, entry.top, entry.width, entry.height);
    ctx.restore();
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
    boostSkillActive = false,
    hiddenLayers = [],
    idleRasterSize = 0,
  ) {
    const isFiring = attacking ?? (!!clip && /Shoot|Fire|Attack/.test(clip));
    // Overview idle poses are sampled at 12fps into reusable, bounded surfaces.
    // Position, camera scale, live effects, movement and combat remain frame-driven.
    if (
      idleRasterSize > 0 &&
      !effectsOnly &&
      !moving &&
      !isFiring &&
      !flying &&
      ART.models[model].movementType !== "air" &&
      !turretStatus &&
      !Object.values(brokenParts).some(Boolean)
    ) {
      const layers = visibleLayers(
        model,
        heldWeapon,
        shieldVisible,
        false,
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
        boostSkillActive,
      );
      const effects = layers
        .filter(
          (layer) =>
            layer.effect ||
            layer.independentClock ||
            layer.visibleWhen?.thrustActive ||
            layer.visibleWhen?.sustainedThrust ||
            layer.visibleInFog === false ||
            layer.animationVisibility ||
            layer.rotationSpeed ||
            layer.onlyAnimateWhenMoving ||
            layer.visibleWhen?.moving,
        )
        .map((layer) => layer.name);
      const lighting =
        environment !== "space" &&
        typeof ClientSettings !== "undefined" &&
        ClientSettings.unitShadows()
          ? MapShadowLighting.normalize(globalThis.ProjectGreedMapLighting || {})
          : null;
      const firstBody = layers.findIndex((layer) => !effects.includes(layer.name));
      let lastBody = layers.length - 1;
      while (lastBody >= 0 && effects.includes(layers[lastBody].name)) lastBody--;
      const interleaved = layers
        .slice(firstBody, lastBody + 1)
        .some((layer) => effects.includes(layer.name));
      const prefixEffects = layers.slice(0, firstBody).map((layer) => layer.name);
      // Preserve layer order and a single combined shadow for complex animated attachments.
      const dynamicCaster =
        lighting &&
        layers.some(
          (layer) =>
            effects.includes(layer.name) &&
            layer.castsShadow !== false &&
            layer.shadowCaster !== false &&
            layer.effect !== true &&
            !layer.independentClock &&
            layer.visibleInFog !== false &&
            !layer.visibleWhen?.thrustActive &&
            !layer.visibleWhen?.sustainedThrust &&
            !layer.visibleWhen?.moving,
        );
      if (firstBody < 0 || interleaved || dynamicCaster || (lighting && prefixEffects.length))
        return draw(
          ctx,
          model,
          x,
          y,
          scale,
          angle,
          clip,
          time,
          heldWeapon,
          loop,
          shieldVisible,
          moving,
          brokenParts,
          aimAngle,
          attacking,
          onLand,
          environment,
          attackWeapon,
          weaponDisplayIndex,
          flying,
          turretStatus,
          effectsOnly,
          boostSkillActive,
          hiddenLayers,
        );
      const key = JSON.stringify([
        model,
        angle,
        aimAngle,
        clip,
        heldWeapon,
        shieldVisible,
        onLand,
        environment,
        weaponDisplayIndex,
        boostSkillActive,
        hiddenLayers,
        lighting,
        idleRasterSize,
      ]);
      let entry = idleImages.get(key);
      const bucket =
        staticPose(models[model].animations[clip]) &&
        !layers.some(
          (layer) =>
            !effects.includes(layer.name) && layer.frameFps && !layer.onlyAnimateWhenMoving,
        )
          ? 0
          : Math.floor(time * 12);
      if (entry) {
        entry.desiredBucket = bucket;
        entry.seenFrame = idleFrame;
      }
      const mayUpdate =
        !entry ||
        (!idleColdPending && (!idleUpdateKeys.length || idleUpdateKeys[idleUpdateCursor] === key));
      if (
        (!entry || entry.bucket !== bucket) &&
        mayUpdate &&
        idleBakeSpent < 2 &&
        layers.every((layer) => images[layer.asset])
      ) {
        let extent = radius(model) + 4;
        if (lighting?.enabled && lighting.intensity > 0) {
          const projection = MapShadowLighting.projection(lighting, 1 + extent / 64);
          extent = extent * 2 + Math.hypot(projection.x, projection.y) * 64;
        }
        if (Number.isFinite(extent) && extent > 0) {
          const started = performance.now();
          if (!entry) {
            // Preserve native texels in overview, including large hulls and
            // the padding required by their combined shadow. Resolution stays
            // independent of zoom, so wheel/pinch never triggers rebaking.
            const resolution = Math.min(1, idleRasterSize / (extent * 2));
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = Math.ceil(extent * 2 * resolution);
            entry = { canvas, extent, resolution, bucket: null };
            idleImagePixels += canvas.width * canvas.height;
          }
          const surface = entry.canvas.getContext("2d");
          surface.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
          draw(
            surface,
            model,
            entry.extent * entry.resolution,
            entry.extent * entry.resolution,
            entry.resolution,
            angle,
            clip,
            bucket / 12,
            heldWeapon,
            loop,
            shieldVisible,
            false,
            brokenParts,
            aimAngle,
            attacking,
            onLand,
            environment,
            attackWeapon,
            weaponDisplayIndex,
            false,
            null,
            false,
            boostSkillActive,
            [...hiddenLayers, ...effects],
          );
          if (idleUpdateKeys[idleUpdateCursor] === key) idleUpdateCursor++;
          entry.bucket = entry.desiredBucket = bucket;
          entry.seenFrame = entry.bakedFrame = idleFrame;
          idleBakeSpent += performance.now() - started;
        }
      }
      if (!entry) idleMissing++;
      if (entry) {
        idleImages.delete(key);
        idleImages.set(key, entry);
        while (idleImages.size > 96 || idleImagePixels > 16 * 1024 * 1024) {
          const oldest = idleImages.keys().next().value,
            removed = idleImages.get(oldest);
          idleImages.delete(oldest);
          idleImagePixels -= removed.canvas.width * removed.canvas.height;
          removed.canvas.width = removed.canvas.height = 0;
        }
        const drawEffects = (names) => {
          if (!names.length) return;
          draw(
            ctx,
            model,
            x,
            y,
            scale,
            angle,
            clip,
            time,
            heldWeapon,
            loop,
            shieldVisible,
            false,
            brokenParts,
            aimAngle,
            attacking,
            onLand,
            environment,
            attackWeapon,
            weaponDisplayIndex,
            false,
            turretStatus,
            false,
            boostSkillActive,
            [
              ...hiddenLayers,
              ...layers.filter((layer) => !names.includes(layer.name)).map((layer) => layer.name),
            ],
          );
        };
        drawEffects(prefixEffects);
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
          entry.canvas,
          x - entry.extent * scale,
          y - entry.extent * scale,
          entry.extent * scale * 2,
          entry.extent * scale * 2,
        );
        ctx.restore();
        drawEffects(effects.filter((name) => !prefixEffects.includes(name)));
        return;
      }
    }

    const active = isFiring
      ? (ART.models[model].weapons.find((w) => w.id === heldWeapon)?.moduleIds || []).filter(
          (id) => !brokenParts[id],
        )
      : [];
    const sampled = turretPose(model, drawPose(model, clip, time, loop), angle, aimAngle, active);
    ctx.save();
    const flightClock = globalThis.ReplayPlayer?.active
      ? globalThis.ReplayPlayer.time * 1000
      : performance.now();
    ctx.translate(x, y + flightOffset(model, flightClock, flying, environment) * scale);
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = false;
    const outlines = [];
    const layers = visibleLayers(
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
      boostSkillActive,
    );
    if (
      !effectsOnly &&
      environment !== "space" &&
      typeof ClientSettings !== "undefined" &&
      ClientSettings.unitShadows()
    ) {
      const lighting = MapShadowLighting.normalize(globalThis.ProjectGreedMapLighting || {});
      if (lighting.enabled && lighting.intensity > 0)
        drawUnitShadow(
          ctx,
          model,
          layers,
          sampled,
          angle,
          aimAngle,
          clip,
          time,
          moving,
          hiddenLayers,
          lighting,
        );
    }
    for (const layer of layers) {
      if (hiddenLayers.includes(layer.name)) continue;
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
  function resetCaches() {
    for (const entry of [...idleImages.values(), ...shadowCache.values()])
      entry.canvas.width = entry.canvas.height = 0;
    for (const canvas of outlineCache.values()) canvas.width = canvas.height = 0;
    idleImages.clear(); shadowCache.clear(); outlineCache.clear(); modelRadii.clear();
    idleImagePixels = shadowPixels = outlinePixels = idleBakeSpent = idleFrame = idleMissing = 0;
    idleColdPending = false; idleUpdateKeys = []; idleUpdateCursor = 0;
    drawSamples = new WeakMap();
  }
  // One bounded queue serves startup, previews and battle preparation.
  const requests = new Map(),
    queue = [];
  let workers = 0, assetGeneration = 0;
  const pendingSources = new Set();
  let retainedSources = new Set();
  function releaseBattleResources(keys = []) {
    resetCaches();
    assetGeneration++;
    // Small menu icons are shared across screens; decoded battle sheets are
    // leased to the current battle, not retained for every battle ever played.
    const keep = new Set([...keys, ...ART.units.map(unit => unit.icon)]);
    retainedSources = new Set([...keep].map(key => ART.assets[key]).filter(Boolean));
    for (const key of Object.keys(images)) if (!keep.has(key)) delete images[key];
    for (const source of requests.keys())
      if (!retainedSources.has(source) && !pendingSources.has(source)) requests.delete(source);
    for (let i = queue.length - 1; i >= 0; i--) if (!retainedSources.has(queue[i].source)) {
      const [obsolete] = queue.splice(i, 1); obsolete.resolve(null);
    }
  }
  function cacheStats() {
    const decoded = new Set(Object.values(images));
    return { idle: idleImages.size, idlePixels: idleImagePixels, shadow: shadowCache.size,
      shadowPixels, outlines: outlineCache.size, outlinePixels, sources: requests.size,
      decoded: decoded.size, decodedPixels: [...decoded].reduce((sum, image) => sum + image.width * image.height, 0),
      pending: pendingSources.size };
  }
  function pump() {
    while (workers < 8 && queue.length) {
      const task = queue.shift();
      workers++;
      const image = new Image();
      pendingSources.add(task.source);
      image.onload = () => {
        image.onload = image.onerror = null;
        pendingSources.delete(task.source);
        if (task.generation !== assetGeneration && !retainedSources.has(task.source)) requests.delete(task.source);
        workers--;
        task.resolve(image);
        pump();
      };
      image.onerror = () => {
        image.onload = image.onerror = null;
        pendingSources.delete(task.source);
        workers--;
        requests.delete(task.source);
        task.reject(Error("Asset loading failed: " + task.key));
        pump();
      };
      image.src = task.source;
    }
  }
  function ensureAssets(keys, onProgress = () => {}) {
    keys = [...new Set(keys)].filter((key) => ART.assets[key]);
    for (const key of keys) retainedSources.add(ART.assets[key]);
    const generation = assetGeneration;
    let completed = 0;
    onProgress(0, keys.length);
    return Promise.all(
      keys.map((key) => {
        if (images[key]) {
          onProgress(++completed, keys.length);
          return images[key];
        }
        const source = ART.assets[key];
        if (!requests.has(source)) {
          const request = new Promise((resolve, reject) =>
            queue.push({ source, key, resolve, reject, generation }),
          );
          requests.set(source, request);
          pump();
        }
        return requests.get(source).then((image) => {
          if (generation === assetGeneration || retainedSources.has(source)) images[key] = image;
          onProgress(++completed, keys.length);
          return image;
        });
      }),
    );
  }
  const modelKeys = new Map();
  function keysForModels(ids) {
    return [
      ...new Set(
        ids.flatMap((id) => {
          if (!modelKeys.has(id)) {
            const unit = models[id];
            modelKeys.set(id, unit ? [unit.icon, ...unit.decals.map((layer) => layer.asset)] : []);
          }
          return modelKeys.get(id);
        }),
      ),
    ];
  }
  const modelsReady = (ids) => keysForModels(ids).every((key) => images[key]);
  const ensureModels = (ids) => ensureAssets(keysForModels(ids));
  const readyAssets = (keys) => keys.every((key) => images[key]);
  function battleKeys(snapshot) {
    const ids = new Set(),
      visited = new Set();
    function visit(value) {
      if (!value || typeof value !== "object" || visited.has(value)) return;
      visited.add(value);
      if (typeof value.model === "string" && models[value.model]) ids.add(value.model);
      for (const [key, child] of Object.entries(value))
        if (!["tiles", "log", "chat", "researched"].includes(key)) visit(child);
    }
    visit(snapshot);
    const prefabs = new Set([...ids].map((id) => ART.models[id].prefabId));
    // Preload explicit conversion/ejection destinations, including every mapped kit.
    for (const id of prefabs) {
      const prefab = ART.prefabs.find((prefab) => prefab.id === id);
      for (const skill of prefab?.skills || [])
        for (const target of [skill.formUnitId, skill.source?.unitId, skill.spawn?.unitId])
          if (target) prefabs.add(target);
    }
    for (const [id, model] of Object.entries(ART.models))
      if (prefabs.has(model.prefabId)) ids.add(id);
    return [
      ...new Set(
        [
          ...keysForModels([...ids]),
          ...Object.values(ART.effects).map((effect) => effect.asset),
          ...[...ids].flatMap((id) =>
            ART.models[id].weapons.flatMap((weapon) => [
              weapon.projectile?.asset,
              weapon.projectile?.cluster?.asset,
              ...(weapon.remote?.units || []).flatMap((unit) => [unit.asset, unit.trail?.asset]),
            ]),
          ),
        ].filter(Boolean),
      ),
    ];
  }
  function loadMenu(onProgress) {
    const owned = new Set(Object.keys(Economy.snapshot().licenses).slice(0, 12));
    let icons = ART.units
      .filter((unit) => owned.has(ART.models[unit.id].prefabId))
      .map((unit) => unit.icon);
    if (!icons.length) icons = ART.units.slice(0, 4).map((unit) => unit.icon);
    return ensureAssets(icons, onProgress);
  }
  const load = (onProgress) => ensureAssets(Object.keys(ART.assets), onProgress);

  return {
    draw,
    beginFrame,
    releaseBattleResources,
    cacheStats,
    radius,
    load,
    loadMenu,
    ensureAssets,
    ensureModels,
    modelsReady,
    battleKeys,
    readyAssets,
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
