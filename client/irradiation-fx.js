/* Three native sprite sections, one draw per section; no helper units or per-tile sprites. */
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
  function draw(ctx, now, position, tile) {
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
        GameAudio.playSound(beam.sound);
      }
      const time = (now - beam.start) / 1000;
      const origin = position(beam.from.x, beam.from.y);
      let from = origin,
        to = position(beam.to.x, beam.to.y);
      // Sample the same native gun attachment and animation as the firing hull.
      const model = ART.models[beam.model];
      if (model && beam.muzzle) {
        const scale =
          (tile / 64) *
          1.2 *
          (BattleScene.settings().mapScale / (ART.presentation.mapCellScale || 1)) *
          model.presentation.mapScale;
        from = SpriteRenderer.muzzle(
          beam.model,
          { muzzle: beam.muzzle, attack: { muzzleIndices: [0] } },
          {
            x: from.x,
            y: from.y,
            scale,
            angle:
              (Math.atan2(beam.to.x - beam.from.x, -(beam.to.y - beam.from.y)) * 180) / Math.PI,
          },
          beam.clip,
          Math.min(time, beam.chargeSeconds),
        );
      }
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
          tile / 48,
          Math.min(effect.duration - 0.001, (time / beam.chargeSeconds) * effect.duration),
        );
        continue;
      }
      if (!beam.impacted) {
        beam.impacted = true;
        MapEffects.capture({
          networkId: beam.id,
          actors: beam.actors,
          events: (beam.hits || []).map((h) => ({ ...h, to: h.unitId })),
        });
      }
      const length = Math.hypot(to.x - from.x, to.y - from.y),
        cap = Math.min(tile * 0.8, length / 2),
        height = tile * 0.72;
      const frame = Math.min(27, Math.floor(((time - beam.chargeSeconds) / beam.fireSeconds) * 28));
      ctx.save();
      ctx.translate(from.x, from.y);
      ctx.rotate(Math.atan2(to.y - from.y, to.x - from.x));
      for (const [part, x, width] of [
        ["Start", 0, cap],
        ["Mid", cap, Math.max(0, length - 2 * cap)],
        ["End", length - cap, cap],
      ]) {
        if (width <= 0) continue;
        const effect = ART.effects[key(part)],
          image = SpriteRenderer.images[effect.asset],
          fw = image.width / effect.frames;
        ctx.drawImage(image, frame * fw, 0, fw, image.height, x, -height / 2, width, height);
      }
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
