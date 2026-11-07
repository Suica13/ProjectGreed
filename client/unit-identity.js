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
  function owner(unit) {
    const seat = Rules.ownerOf(unit);
    const member = Net.active ? Net.snapshot?.members.find((player) => player.seat === seat) : null;
    return {
      seat,
      member,
      name: Net.active
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
  function drawMapSymbol(ctx, unit, position, tile) {
    const center = Rules.center(unit);
    ctx.save();
    ctx.strokeStyle = colors[relation(unit)].color;
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
    if (unit.pilot?.name) {
      const badge = Math.max(7, Math.min(12, size * 0.45));
      drawPilotPortrait(ctx, unit.pilot, x + size - badge * 0.8, y + size - badge * 0.8, badge);
    }
    ctx.restore();
  }
  function drawCommandAura(ctx, unit, position, tile, selectedUnit) {
    if (!selectedUnit || !Rules.modelOf(unit).supplyAura) return;
    if (
      selectedUnit.id !== unit.id &&
      (selectedUnit.team !== unit.team || !Rules.inSupplyRange(unit, selectedUnit))
    )
      return;
    const area = Rules.supplyCells(game, unit),
      center = Rules.center(unit);
    const occupied = new Set(area.map((c) => Rules.key(c.x, c.y)));
    ctx.save();
    ctx.fillStyle = "#35d6c130";
    ctx.strokeStyle = "#51e5d3bb";
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
    const palette = colors[relation(unit)];
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
    owner,
    drawRing,
    drawCommandAura,
    drawPilotPortrait,
    drawMapSymbol,
  };
})();
