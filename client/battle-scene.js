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
    RX_78_2: 1,
    RX_77_2: 1,
    RX_75: 1,
    meleeTravel: 0.18,
    shake: 3,
    shadowScale: 1,
    projectileScale: 1,
    muzzleY: -12,
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
        scale: baseScale * options[side + "Scale"] * options[unit.model],
      };
    });
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

    const { left, right, event, ratio, elapsed, time, completed, displayHp } = frame;
    const actors = geometry(width, height, left, right, options);
    const impact = ratio > 0.53;
    const source = actors.find((actor) => actor.unit.id === event.from);
    const target = actors.find((actor) => actor.unit.id === event.to);

    for (const actor of actors) {
      const { unit, x, y, angle, scale } = actor;
      const attacking = !completed && unit.id === event.from;
      const damaged = !completed && unit.id === event.to && impact && event.hit;
      let offsetX = damaged ? Math.sin((time * 1000) / 28) * options.shake : 0;
      if (attacking && event.type === "melee") {
        offsetX +=
          (unit.id === left.id ? 1 : -1) * Math.sin(ratio * Math.PI) * width * options.meleeTravel;
      }
      ctx.save();
      if (displayHp[unit.id] <= 0) ctx.globalAlpha = 0.25;
      ctx.fillStyle = unit.team ? "#ff9a8255" : "#6bcff855";
      ctx.beginPath();
      ctx.ellipse(
        x + offsetX,
        y + (35 * scale) / 2,
        26 * scale * options.shadowScale,
        6 * scale * options.shadowScale,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      const idleClip = unit.model === "RX_75" ? "neutral" : "Common_Idle";
      SpriteRenderer.draw(
        ctx,
        unit.model,
        x + offsetX,
        y,
        scale,
        angle,
        attacking ? event.clip : damaged ? "Common_Stagger" : idleClip,
        attacking ? elapsed * 1.3 : time,
        attacking ? event.eq : unit.eq,
        attacking ? event.hold : unit.hold,
        !attacking,
      );
      ctx.restore();
    }

    if (!completed && ratio > 0.22 && ratio < 0.6) {
      const travel = (ratio - 0.22) / 0.38;
      const x = source.x + (target.x - source.x) * travel;
      // 弹道随双方站位连线，起点偏移随各自机体尺寸变化。
      const sourceY = source.y + options.muzzleY * source.scale;
      const targetY = target.y + options.muzzleY * target.scale;
      const y = sourceY + (targetY - sourceY) * travel;
      const size = options.projectileScale;
      ctx.save();
      ctx.strokeStyle = "#ffe1f7";
      ctx.lineWidth = 5 * size;
      ctx.shadowColor = "#ff6ad5";
      ctx.shadowBlur = 15 * size;
      ctx.beginPath();
      if (event.type === "beam") {
        ctx.moveTo(x - (source.x < target.x ? 1 : -1) * width * 0.11, y);
        ctx.lineTo(x, y);
        ctx.stroke();
      } else if (event.type === "shell") {
        ctx.fillStyle = "#ffe7a6";
        ctx.ellipse(x, y, 8 * size, 3 * size, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.arc(target.x, target.y, 35 * size, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (!completed && impact && ratio < 0.87) {
      ctx.save();
      if (event.hit) {
        ctx.fillStyle = "#ffd8ad";
        ctx.globalAlpha = (0.87 - ratio) * 2;
        ctx.beginPath();
        ctx.arc(
          target.x,
          target.y,
          (35 + (ratio - 0.53) * 90) * options.impactScale,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = "center";
      ctx.font = `bold ${Math.max(18, width / 35) * options.damageSize}px system-ui`;
      ctx.fillStyle = event.hit ? "#ffe7aa" : "#b9dbe8";
      const label = event.hit ? "-" + Number(event.damage).toLocaleString("en-US") : "MISS";
      ctx.fillText(label, target.x + width * options.damageX, target.y + height * options.damageY);
      ctx.restore();
    }
    // 稳定参考框不随关键帧抖动；专供编辑器选择和缩放。
    return actors.map((actor) => ({
      ...actor,
      width: 64 * actor.scale,
      height: 64 * actor.scale,
    }));
  }

  return { defaults, settings, geometry, draw };
})();
