/* Native caps and seamless middle tiles; no stretched textures or helper units. */
const IrradiationFX = (() => {
  const active = new Map();
  function reset() {
    active.clear();
  }
  function start(event, done = () => {}) {
    const id = event.id || "local-beam-" + performance.now();
    if (active.has(id)) return;
    active.set(id, {
      ...event,
      id,
      hitsById: new Map((event.hits || []).map((hit) => [hit.unitId, hit])),
      start: null,
      done,
      impacted: false,
    });
  }
  function pose(unit, now) {
    const beam = [...active.values()].find((e) => e.unitId === unit.id);
    if (!beam) return null;
    return {
      angle: (Math.atan2(beam.to.x - beam.from.x, -(beam.to.y - beam.from.y)) * 180) / Math.PI,
      clip: beam.clip,
      time: beam.start === null ? 0 : Math.min(beam.chargeSeconds, (now - beam.start) / 1000),
      weaponDisplayIndex: beam.weaponDisplayIndex,
    };
  }
  function units(roster, now) {
    const result = new Map(roster.map((u) => [u.id, u]));
    for (const beam of active.values())
      for (const actor of beam.actors || []) {
        const hit = beam.hitsById.get(actor.id);
        const waiting = beam.start === null || now - beam.start < beam.chargeSeconds * 1000;
        const current = result.get(actor.id) || actor;
        result.set(
          actor.id,
          waiting
            ? {
                ...actor,
                ...(hit
                  ? { hp: hit.before, shield: hit.shieldBefore, iFieldHp: hit.iFieldBefore }
                  : {}),
              }
            : result.has(actor.id)
              ? current
              : {
                  ...actor,
                  ...(hit
                    ? { hp: hit.after, shield: hit.shieldAfter, iFieldHp: hit.iFieldAfter }
                    : {}),
                },
        );
      }
    return [...result.values()].filter(
      (u) => !u.embarked || u.embarked.exposed || u.pendingMove?.launch,
    );
  }
  function draw(ctx, now, position, tile, actorPose = null) {
    for (const beam of active.values()) {
      const key = (part) => "Irradiation_" + part + "_" + beam.color;
      if (
        !["Charge", "Start", "Mid", "End"].every(
          (part) => SpriteRenderer.images[ART.effects[key(part)]?.asset],
        )
      )
        continue;
      if (beam.start === null) {
        beam.start = now - (beam.elapsedSeconds || 0) * 1000;
        if ((beam.elapsedSeconds || 0) < beam.chargeSeconds) GameAudio.playSound(beam.sound);
      }
      const time = (now - beam.start) / 1000;
      const origin = position(beam.from.x, beam.from.y);
      const model = ART.models[beam.model];
      const sampledActor = actorPose?.(beam.unitId);
      const scale =
        sampledActor?.scale ??
        (model
          ? (tile / 64) *
            1.2 *
            (BattleScene.settings().mapScale / (ART.presentation.mapCellScale || 1)) *
            model.presentation.mapScale
          : tile / 64);
      const actor = sampledActor || {
        x: origin.x,
        y: origin.y,
        scale,
        angle: (Math.atan2(beam.to.x - beam.from.x, -(beam.to.y - beam.from.y)) * 180) / Math.PI,
        clip: beam.clip,
        time: Math.min(time, beam.chargeSeconds),
      };
      const muzzle = time < beam.chargeSeconds ? beam.chargeMuzzle || beam.muzzle : beam.muzzle;
      let from = origin,
        to = position(beam.to.x, beam.to.y);
      // Native charge and beam attachments are distinct. Reuse the exact visible
      // hull pose, including height, hover and animation, instead of a tile anchor.
      if (model && muzzle)
        from = SpriteRenderer.muzzle(
          beam.model,
          { muzzle, attack: { muzzleIndices: [0] } },
          actor,
          actor.clip,
          actor.time,
        );
      to = { x: to.x + from.x - origin.x, y: to.y + from.y - origin.y };
      if (time >= beam.chargeSeconds + beam.fireSeconds) {
        active.delete(beam.id);
        MapEffects.after(beam.done);
        continue;
      }
      if (time < beam.chargeSeconds) {
        const effect = ART.effects[key("Charge")];
        SpriteEffects.draw(
          ctx,
          key("Charge"),
          from.x,
          from.y,
          scale * (beam.chargeScale ?? 1.3),
          Math.min(effect.duration - 0.001, (time / beam.chargeSeconds) * effect.duration),
        );
        continue;
      }
      if (!beam.impacted) {
        beam.impacted = true;
        if (beam.fireSound) GameAudio.playSound(beam.fireSound);
        MapEffects.capture({
          networkId: beam.id,
          actors: beam.actors,
          events: (beam.hits || []).map((h) => ({ ...h, to: h.unitId })),
        });
      }
      const length = Math.hypot(to.x - from.x, to.y - from.y),
        // Native sheet height 168 × imageScale 1.25 × imageScaleY 1.5.
        height = Math.max(tile * 0.72, Math.max(315, beam.beamWidth ?? 315) * scale),
        native = beam.beamSections || [
          { part: "Start", left: -101.25, width: 452.5 },
          { part: "Mid", left: 351.625, width: 173.75 },
          { part: "End", left: 525.375, width: 431.25 },
        ];
      const frame = Math.min(27, Math.floor(((time - beam.chargeSeconds) / beam.fireSeconds) * 28));
      ctx.save();
      ctx.translate(from.x, from.y);
      ctx.rotate(Math.atan2(to.y - from.y, to.x - from.x));
      const start = native.find((s) => s.part === "Start"),
        middle = native.find((s) => s.part === "Mid"),
        end = native.find((s) => s.part === "End"),
        startX = start.left * scale,
        startWidth = start.width * scale,
        endWidth = end.width * scale,
        endX = length - endWidth,
        overlap = startX + startWidth > endX,
        middleLeft = overlap ? length / 2 : startX + startWidth,
        middleRight = overlap ? length / 2 : endX;
      // Overlap natural caps at short ranges; crop only beyond the ray endpoints.
      // Crop the final partial tile in source coordinates. Their
      // pixel scale stays identical at every range, including point-blank beams.
      function section(part, x, width, left, right) {
        if (right <= left || width <= 0) return;
        const effect = ART.effects[key(part)],
          image = SpriteRenderer.images[effect.asset],
          fw = image.width / effect.frames,
          fraction = (right - left) / width;
        ctx.drawImage(
          image,
          frame * fw + ((left - x) / width) * fw,
          0,
          fraction * fw,
          image.height,
          left,
          -height / 2,
          right - left,
          height,
        );
      }
      section("Start", startX, startWidth, startX, Math.min(length, startX + startWidth));
      const period = middle.width * scale;
      if (period > 0)
        for (let x = middleLeft; x < middleRight; x += period)
          section("Mid", x, period, x, Math.min(x + period, middleRight));
      section("End", endX, endWidth, Math.max(0, endX), length);
      ctx.restore();
    }
  }
  function fieldImpact(id, now) {
    let age = Infinity;
    for (const beam of active.values())
      if (beam.start !== null && beam.hitsById.get(id)?.iFieldDamage > 0) {
        const time = (now - beam.start) / 1000 - beam.chargeSeconds;
        if (time >= 0) age = Math.min(age, time);
      }
    return age;
  }
  return {
    start,
    fieldImpact,
    reset,
    pose,
    units,
    draw,
    get active() {
      return active.size > 0;
    },
  };
})();
