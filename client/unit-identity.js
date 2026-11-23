/* 玩家视角与阵营分开：联机按 ownerSeat 判断自己的编组，离线 AI 始终以玩家0为视角。 */
const UnitIdentity = (() => {
  const colors = {
    own: { color: "#68e99a", fill: "#68e99a2c" },
    ally: { color: "#78ceef", fill: "#6acfff2d" },
    enemy: { color: "#fa8b79", fill: "#ff887c2c" },
  };
  function viewerSeat() {
    if (globalThis.ReplayPlayer?.active) return null;
    if (Net.active) return Net.seat;
    if (game.ai) return 0;
    return phase === "deployment" ? Deployment.team() : game.team;
  }
  function relation(unit) {
    const seat = viewerSeat();
    if (seat !== null && Rules.ownerOf(unit) === seat) return "own";
    const team = globalThis.ReplayPlayer?.active
      ? (Net.snapshot?.viewTeam ?? 0)
      : seat === null
        ? 0
        : Rules.seatTeam(seat);
    return unit.team === team ? "ally" : "enemy";
  }
  function healthColor(unit) {
    const controlled = Net.active
      ? Net.canControl(unit)
      : !globalThis.ReplayPlayer?.active && Rules.ownerOf(unit) === viewerSeat();
    return controlled ? colors.own.color : game.contract?.noAllies && unit.team > 0
      ? ["", "#f06464", "#ff7848", "#f18bb8"][unit.team] || "#f06464"
      : unit.team ? "#ed9685" : "#83d6ee";
  }
  function style(unit) {
    if(game.contract?.noAllies && unit.team>0) {
      const color=["", "#f06464", "#ff7848", "#f18bb8"][unit.team] || "#f06464";
      return {color,fill:color+"2c"};
    }
    return colors[relation(unit)];
  }
  function owner(unit) {
    const seat = Rules.ownerOf(unit);
    const member = Net.active ? Net.snapshot?.members.find((player) => player.seat === seat) : null;
    return {
      seat,
      member,
      name: unit.missionAutonomous ? "任务友军" : Net.active
        ? member?.name || "空席位"
        : game.ai && seat === 1
          ? "AI"
          : "本机玩家" + (seat + 1),
      team: "队伍" + (unit.team + 1),
    };
  }
  const portraitImages = new Map(),
    portraitQueue = [];
  let portraitLoads = 0;
  function loadPortraits() {
    while (portraitLoads < 4 && portraitQueue.length) {
      const entry = portraitQueue.shift();
      if (portraitImages.get(entry.source) !== entry) continue;
      portraitLoads++;
      const image = new Image();
      image.decoding = "async";
      const finish = () => {
        image.onload = image.onerror = null;
        image.removeAttribute("src");
        portraitLoads--;
        loadPortraits();
      };
      image.onload = () => {
        try {
          if (
            portraitImages.get(entry.source) === entry &&
            image.naturalWidth &&
            image.naturalHeight
          ) {
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 64;
            const crop = Math.min(image.naturalWidth, image.naturalHeight);
            canvas
              .getContext("2d")
              .drawImage(
                image,
                (image.naturalWidth - crop) / 2,
                (image.naturalHeight - crop) / 2,
                crop,
                crop,
                0,
                0,
                64,
                64,
              );
            entry.surface = canvas;
          }
        } finally {
          finish();
        }
      };
      image.onerror = finish;
      image.src = entry.source;
    }
  }
  function drawPilotPortrait(ctx, pilot, x, y, size) {
    const source = PilotSystem.portrait(pilot);
    let entry = portraitImages.get(source);
    if (!entry) {
      entry = { source, surface: null };
      portraitImages.set(source, entry);
      portraitQueue.push(entry);
      // 512 fixed-size thumbnails use at most 8 MiB of pixel data.
      if (portraitImages.size > 512) {
        const oldest = portraitImages.keys().next().value,
          removed = portraitImages.get(oldest);
        portraitImages.delete(oldest);
        if (removed.surface) removed.surface.width = removed.surface.height = 0;
      }
      loadPortraits();
    } else {
      portraitImages.delete(source);
      portraitImages.set(source, entry);
    }
    ctx.save();
    ctx.fillStyle = "#30343b";
    ctx.fillRect(x, y, size, size);
    if (entry.surface) ctx.drawImage(entry.surface, x, y, size, size);
    ctx.strokeStyle = "#a9b8c8";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, size, size);
    ctx.restore();
  }
  const unitImages = new Map();
  const roleBadges = new Map();
  const roleStyles = {
    general: ["✂\uFE0E", "#76baff", "#173e67"],
    support: ["✋\uFE0E", "#91efb3", "#1c503a"],
    raid: ["✊\uFE0E", "#ff9298", "#5d2935"],
    normal: ["●", "#c7d2dc", "#344451"],
  };
  function drawStatusBadges(ctx, unit, model, barX, barY, barWidth, size, portrait) {
    const role = Object.hasOwn(roleStyles, model.combatRole) ? model.combatRole : "normal";
    let badge = roleBadges.get(role);
    if (!badge) {
      badge = document.createElement("canvas");
      badge.width = badge.height = 64;
      const paint = badge.getContext("2d"), [glyph, color, background] = roleStyles[role];
      paint.fillStyle = background;
      paint.fillRect(0, 0, 64, 64);
      paint.strokeStyle = color;
      paint.lineWidth = 3;
      paint.strokeRect(1.5, 1.5, 61, 61);
      paint.translate(32, 32);
      if (role === "general") paint.rotate(-Math.PI / 4);
      paint.font = '48px "Segoe UI Symbol", "Noto Sans Symbols 2", sans-serif';
      paint.textAlign = "center";
      paint.textBaseline = "middle";
      paint.fillStyle = color;
      paint.fillText(glyph, 0, 1);
      roleBadges.set(role, badge);
    }
    const y = barY + (9 - size) / 2;
    ctx.drawImage(badge, barX + barWidth + 3, y, size, size);
    if (portrait && unit.pilot?.name) drawPilotPortrait(ctx, unit.pilot, barX - size - 3, y, size);
  }
  function drawMapSymbol(ctx, unit, position, tile) {
    const center = Rules.center(unit);
    ctx.save();
    ctx.strokeStyle = style(unit).color;
    ctx.lineWidth = 1.25;
    for (const cell of Rules.cells(unit))
      ctx.strokeRect(
        position.x + (cell.x - center.x - 0.5) * tile,
        position.y + (cell.y - center.y - 0.5) * tile,
        tile,
        tile,
      );
    const key = unit.model + ":" + (unit.pilot?.aceId || "");
    let image = unitImages.get(key);
    if (!image) {
      image = new Image();
      if (unitImages.size >= 256) unitImages.delete(unitImages.keys().next().value);
      unitImages.set(key, image);
      image.src = unitIcon(unit.model, unit.pilot);
    }
    const size = Math.max(10, Math.min(28, tile * 0.9));
    const x = position.x - size / 2,
      y = position.y - size / 2;
    if (image.complete && image.naturalWidth) ctx.drawImage(image, x, y, size, size);
    ctx.restore();
  }
  function drawCommandAura(ctx, unit, position, tile, selectedUnit) {
    if (!selectedUnit) return;
    const self = selectedUnit.id === unit.id, ally = selectedUnit.team === unit.team,
      aura = Rules.commandAura(unit);
    if (aura.active && (self || (ally && Rules.dist(unit, selectedUnit) <= aura.radius))) {
      const colors = {cmdAtk:["#f5797130","#f57971bb"],cmdDef:["#f3ce6830","#f3ce68bb"],cmdCom:["#73baff30","#73baffbb"]},
        palette = colors[aura.kinds[0]?.type] || colors.cmdCom;
      drawAuraArea(ctx, unit, position, tile, Rules.commandCells(game, unit), ...palette);
    }
    if (Rules.modelOf(unit).supplyAura && (self || (ally && Rules.inSupplyRange(unit, selectedUnit))))
      drawAuraArea(ctx, unit, position, tile, Rules.supplyCells(game, unit), "#35d6c130", "#51e5d3bb");
  }
  function drawAuraArea(ctx, unit, position, tile, area, fill, stroke) {
    const center = Rules.center(unit);
    const occupied = new Set(area.map((c) => Rules.key(c.x, c.y)));
    ctx.save();
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const c of area) {
      const x = position.x + (c.x - center.x - 0.5) * tile;
      const y = position.y + (c.y - center.y - 0.5) * tile;
      ctx.fillRect(x, y, tile, tile);
      for (const [dx, dy, ax, ay, bx, by] of [
        [0, -1, 0, 0, 1, 0],
        [1, 0, 1, 0, 1, 1],
        [0, 1, 1, 1, 0, 1],
        [-1, 0, 0, 1, 0, 0],
      ])
        if (!occupied.has(Rules.key(c.x + dx, c.y + dy))) {
          ctx.moveTo(x + ax * tile, y + ay * tile);
          ctx.lineTo(x + bx * tile, y + by * tile);
        }
    }
    ctx.stroke();
    ctx.restore();
  }
  function drawRing(ctx, unit, position, tile) {
    const palette = unit.missionAutonomous ? {color:"#f5d66f",fill:"#f5d66f2c"} : style(unit);
    ctx.fillStyle = palette.fill;
    ctx.strokeStyle = palette.color;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(
      position.x,
      position.y,
      tile * (Rules.models?.[unit.model]?.ship ? 0.45 : 0.31),
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.stroke();
  }
  return {
    colors,
    viewerSeat,
    relation,
    healthColor,
    style,
    owner,
    drawRing,
    drawCommandAura,
    drawPilotPortrait,
    drawStatusBadges,
    drawMapSymbol,
  };
})();
