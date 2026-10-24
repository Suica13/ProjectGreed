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
      heldWeapon: heldWeapon || ART.models[model].weapons[0].id,
      shieldVisible: unit.presentation.shield,
      visorClosed: false,
    };
  }
  function visible(layer, variables, clip, time) {
    // 图层切换按骨骼动画时间采样，快速演出和暂停不会改变切换位置。
    const window = layer.animationVisibility;
    if (window) {
      const inside = clip === window.clip && time >= window.start && time < window.end;
      if (inside !== window.visibleInside) return false;
    }
    return Object.entries(layer.visibleWhen || {}).every(([key, expected]) => {
      if (Array.isArray(expected)) return expected.includes(variables[key]);
      if (expected && typeof expected === "object") return variables[key] !== expected.not;
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
    variables.boosting = models[model].presentation.movement === "boost";
    return models[model].decals.filter((layer) => visible(layer, variables, clip, at));
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
  // 在发射的那一刻采样，与枪的 PNG 同步移动、旋转、缩放和镜像。
  function muzzle(model, weapon, actor, clip, time, shotIndex = 0) {
    const mount = weapon.muzzle.mounts
        ? weapon.muzzle.mounts[weapon.attack.muzzleIndices[shotIndex] ?? 0]
        : weapon.muzzle,
      unit = models[model],
      sampled = pose(model, clip, time);
    const layer = mount.layer
      ? unit.decals.find((layer) => layer.name === mount.layer)
      : {
          bone: mount.bone,
          offset: {
            ...mount.offset,
            x: mount.offset.x + (shotIndex % 2) * (mount.alternatingOffsetX || 0),
          },
        };
    const transform = layerTransform(model, layer, actor.angle, sampled),
      point = { ...(mount.point || { x: 0, y: 0 }) };
    if (mount.pairSpacing) point.x += ((shotIndex % 2 ? 1 : -1) * mount.pairSpacing) / 2;
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
  ) {
    const sampled = pose(model, clip, time, loop);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = false;
    for (const layer of visibleLayers(model, heldWeapon, shieldVisible, moving, clip, time, loop)) {
      const image = images[layer.asset];
      if (!image) continue;
      const transform = layerTransform(model, layer, angle, sampled);
      const frames = layer.frames || 1,
        fw = layer.frameWidth || Math.floor(image.width / frames),
        fh = layer.frameHeight || image.height;
      const frame = layer.frameFps
          ? Math.floor(Math.max(0, time) * layer.frameFps) % frames
          : layer.frame || 0,
        columns = Math.floor(image.width / fw);
      ctx.save();
      ctx.translate(transform.x, transform.y);
      ctx.rotate(transform.rotation);
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
    ctx.restore();
  }
  function movement(model) {
    const presentation = models[model].presentation;
    return presentation.movement === "walk" ? presentation.walk : presentation.move;
  }
  async function load() {
    await Promise.all(
      Object.entries(ART.assets).map(
        ([key, source]) =>
          new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
              images[key] = image;
              resolve();
            };
            image.onerror = () => reject(Error("素材加载失败：" + key));
            image.src = source;
          }),
      ),
    );
  }
  return {
    draw,
    load,
    models,
    images,
    sample,
    pose,
    layerTransform,
    muzzle,
    visibleLayers,
    movement,
  };
})();
