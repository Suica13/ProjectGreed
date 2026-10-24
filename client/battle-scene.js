/* 战斗画面的共用绘制器。
 * 只读取已经确定的演出数据；不计算命中、不扣血、不发送网络请求。
 * 正式游戏和开发者预览都调用 draw，避免出现两套演出逻辑。
 */
const BattleScene = (() => {
  const defaults = {
    leftX: 0.25,
    leftY: 0.52,
    rightX: 0.75,
    rightY: 0.52,
    scale: 1,
    leftScale: 1,
    rightScale: 1,
    meleeTravel: 0.18,
    shake: 3,
    shadowScale: 1,
    projectileScale: 1,
    impactScale: 1,
    damageSize: 1,
    damageX: 0,
    damageY: -0.24,
    mapScale: 1,
    mapLabelSize: 1,
    mapBarScale: 1,
  };

  function settings() {
    return { ...defaults, ...window.UILayout?.battle() };
  }

  // 返回 CSS 像素坐标。Canvas 的物理像素由设备像素比处理。
  function geometry(width, height, left, right, options = settings()) {
    const baseScale = Math.min(width / 150, height / 65) * 1.6 * options.scale;
    return [left, right].map((unit, index) => {
      const side = index ? "right" : "left";
      return {
        id: side,
        unit,
        x: width * options[side + "X"],
        y: height * options[side + "Y"],
        angle: index ? -90 : 90,
        arenaWidth: width,
        arenaHeight: height,
        scale:
          baseScale *
          options[side + "Scale"] *
          (options[unit.model] || 1) *
          (typeof UnitModels !== "undefined" ? UnitModels[unit.model].presentation.battleScale : 1),
      };
    });
  }

  function timeline(event, left, right, width, height, options = settings()) {
    const actors = geometry(width, height, left, right, options);
    const source = actors.find((actor) => actor.unit.id === event.from),
      target = actors.find((actor) => actor.unit.id === event.to);
    const weapon = UnitModels[source.unit.model].weapons.find((w) => w.id === event.weapon);
    const plan = WeaponEffects.plan(weapon, source, target, event);
    return { actors, source, target, weapon, plan };
  }
  function duration(event, left, right, canvas, options = settings()) {
    const box = canvas.getBoundingClientRect();
    return timeline(event, left, right, box.width, box.height, options).plan.duration;
  }
  function displayedHp(event, left, right, canvas, ratio, initialHp, options = settings()) {
    const box = canvas.getBoundingClientRect(),
      view = timeline(event, left, right, box.width, box.height, options);
    return WeaponEffects.health(event, view.plan, ratio * view.plan.duration, initialHp);
  }
  function draw(canvas, frame, options = settings()) {
    const bounds = canvas.getBoundingClientRect();
    const width = bounds.width,
      height = bounds.height;
    if (!width || !height) return [];
    const pixelRatio = window.devicePixelRatio || 1;
    if (
      canvas.width !== Math.round(width * pixelRatio) ||
      canvas.height !== Math.round(height * pixelRatio)
    ) {
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "#50707d22";
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    ctx.save();
    ctx.strokeStyle = "#83b0c5aa";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(width / 2, 8);
    ctx.lineTo(width / 2, height - 8);
    ctx.stroke();
    ctx.restore();

    const { left, right, event, ratio, elapsed, time, completed, displayHp } = frame;
    const actors = geometry(width, height, left, right, options);
    const { source, target, weapon, plan } = timeline(event, left, right, width, height, options);
    const attackTime = ratio * plan.duration;
    const resolved = WeaponEffects.arrived(plan, attackTime),
      latest = resolved.at(-1),
      impact = Boolean(latest);
    const animation = WeaponSequence.pose(
      weapon,
      Math.max(0, attackTime - plan.lead) * plan.actionSpeed,
    );
    const melee = WeaponEffects.meleeMotion(plan, source, target, attackTime, options.meleeTravel);
    const dodge = WeaponEffects.dodge(event, plan, attackTime, source, target);

    for (const actor of actors) {
      const { unit, x, y, angle, scale } = actor;
      const attacking = !completed && unit.id === event.from;
      const damaged =
        !completed && unit.id === event.to && latest?.hit && attackTime < latest.at + 0.18;
      let offsetX = damaged ? Math.sin((time * 1000) / 28) * options.shake : 0;
      const dodging = unit.id === event.to && dodge.active && !completed;
      let offsetY = unit.id === event.to ? dodge.y : plan.sourceY;
      if (dodging) offsetX += dodge.x;
      const destroyed = unit.id === event.to && plan.deathAt !== null && attackTime >= plan.deathAt;
      if (destroyed || (completed && displayHp[unit.id] <= 0)) continue;
      if (attacking && event.type === "melee") {
        offsetX += melee.x;
        offsetY += melee.y;
      }
      ctx.save();
      if (displayHp[unit.id] <= 0) ctx.globalAlpha = 0.25;
      const ring =
        typeof UnitIdentity !== "undefined"
          ? UnitIdentity.colors[UnitIdentity.relation(unit)]
          : {
              fill: unit.team ? "#ff9a8233" : "#6bcff833",
              color: unit.team ? "#ff9a82" : "#6bcff8",
            };
      ctx.fillStyle = ring.fill;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(x + offsetX, y + offsetY, 26 * scale * options.shadowScale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      SpriteRenderer.draw(
        ctx,
        unit.model,
        x + offsetX,
        y + offsetY,
        scale,
        angle,
        attacking
          ? plan.melee && ["approach", "return"].includes(melee.stage)
            ? UnitModels[unit.model].presentation.move
            : plan.melee && melee.stage === "rest"
              ? null
              : animation.clip
          : damaged
            ? UnitModels[unit.model].presentation.stagger
            : dodging
              ? UnitModels[unit.model].presentation.dodge
              : null,
        attacking
          ? plan.melee && ["approach", "return"].includes(melee.stage)
            ? melee.time * ART.presentation.meleeAnimationSpeed
            : animation.time
          : damaged
            ? (attackTime - latest.at) * ART.presentation.animationSpeed
            : dodging
              ? dodge.time * ART.presentation.animationSpeed
              : 0,
        attacking ? (event.heldWeapon ?? event.weapon) : unit.heldWeapon,
        false,
        unit.id === event.to && event.shieldBefore !== undefined
          ? WeaponEffects.shield(event, plan, attackTime, event.shieldBefore) > 0
          : (frame.displayShield?.[unit.id] ?? unit.shield ?? 1) > 0,
        dodging,
      );
      if (!completed && unit.id === event.to && dodge.started)
        SpriteEffects.boostStart(ctx, unit, x + offsetX, y + offsetY, scale, dodge.time, angle);
      const visibleHp =
        !completed && unit.id === event.to
          ? WeaponEffects.health(event, plan, attackTime, displayHp[unit.id] ?? unit.hp)
          : (displayHp[unit.id] ?? unit.hp);
      // 致命命中后播放一次电流，使用战斗时间轴，暂停、快进和重绘不会重复触发。
      const dying =
        !completed &&
        unit.id === event.to &&
        plan.deathSoundAt !== null &&
        attackTime >= plan.deathSoundAt;
      if (dying)
        SpriteEffects.draw(
          ctx,
          plan.deathElectricEffect,
          x + offsetX,
          y + offsetY,
          scale,
          attackTime - plan.deathSoundAt,
        );
      else SpriteEffects.lowHp(ctx, unit, x + offsetX, y + offsetY, scale, time, visibleHp);
      ctx.restore();
    }

    if (!completed && weapon.swingEffects?.length) {
      const facing = Math.atan2(target.y - source.y, target.x - source.x);
      for (const [index, contact] of plan.contacts.entries()) {
        SpriteEffects.draw(
          ctx,
          weapon.swingEffects[index % weapon.swingEffects.length],
          source.x + melee.x,
          source.y + plan.sourceY + melee.y,
          source.scale,
          (attackTime - contact.at) * plan.actionSpeed,
          facing,
        );
      }
    }
    if (!completed)
      WeaponEffects.draw(ctx, weapon, plan, attackTime, source, event, options.projectileScale);
    if (!completed && impact && attackTime < plan.impacts.at(-1) + 0.35) {
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.textAlign = "center";
      ctx.font = `bold ${Math.max(18, width / 35) * options.damageSize}px system-ui`;
      ctx.fillStyle = latest.hit ? "#ffe7aa" : "#b9dbe8";
      const damage = resolved.reduce((sum, contact) => sum + contact.damage, 0);
      const label = latest.hit
        ? (latest.blocked
            ? typeof I18n !== "undefined"
              ? I18n.text("格挡") + " "
              : "格挡 "
            : "") +
          "-" +
          damage.toLocaleString("en-US")
        : "MISS";
      ctx.fillText(
        label,
        target.x + width * options.damageX,
        target.y + dodge.y + height * options.damageY,
      );
      ctx.restore();
    }
    if (!completed && event.hit) {
      const angle = Math.atan2(target.y - source.y, target.x - source.x);
      for (const contact of plan.contacts.filter((contact) => contact.hit))
        SpriteEffects.draw(
          ctx,
          weapon.hitEffect,
          target.x,
          target.y +
            WeaponEffects.position(plan, contact.at) *
              ART.presentation.dodgeDistance *
              target.scale +
            (plan.shots.find((shot) => shot.index === contact.shotIndex)?.spreadY || 0),
          target.scale * options.impactScale,
          (attackTime - contact.at) * ART.presentation.animationSpeed,
          angle,
        );
      if (plan.deathAt !== null)
        SpriteEffects.draw(
          ctx,
          plan.deathEffect,
          target.x,
          target.y + dodge.y,
          target.scale,
          (attackTime - plan.deathAt) * ART.presentation.animationSpeed,
        );
    }
    // 稳定参考框不随关键帧抖动；专供编辑器选择和缩放。
    return actors.map((actor) => ({
      ...actor,
      width: 64 * actor.scale,
      height: 64 * actor.scale,
    }));
  }

  return { defaults, settings, geometry, timeline, duration, displayedHp, draw };
})();
