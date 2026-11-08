/* Continuous 32px terrain bases and neighbour-driven pixel shorelines.
 * Decoration sprites are transparent; changing a variant cannot create a ground seam. */
const BiomeTiles = (() => {
  const hash = (x, y, s) => {
    let n = Math.imul(x + 13, 374761393) ^ Math.imul(y + 71, 668265263) ^ s;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return (n ^ (n >>> 16)) >>> 0;
  };
  function terrain(doc) {
    const cells = new Array(doc.width * doc.height).fill(null),
      defs = new Map(doc.tiles.map((t) => [t.id, t]));
    for (const layer of doc.layers)
      if (layer.type === "tile" && !layer.decorative && layer.visible)
        layer.data.forEach((id, i) => {
          if (defs.has(id)) cells[i] = defs.get(id);
        });
    return cells;
  }
  let cached = new WeakMap();
  function data(doc) {
    if (!cached.has(doc)) cached.set(doc, terrain(doc));
    return cached.get(doc);
  }
  const water = (t) => ["water", "deep_water", "shallow_water"].includes(t?.terrain);
  function palette(doc) {
    const b = doc.biomeStyle?.biome;
    return b === "desert"
      ? ["#827454", "#8a7b59", "#a39670"]
      : b === "arctic"
        ? ["#a0adb5", "#a8b5bb", "#899b9f"]
        : b === "urban"
          ? ["#525d5c", "#596462", "#827e6e"]
          : ["#4b5d4b", "#52624e", "#85816a"];
  }
  function shoreMask(doc, x, y) {
    const cells = data(doc),
      at = (a, b) =>
        a < 0 || b < 0 || a >= doc.width || b >= doc.height ? null : cells[b * doc.width + a];
    let mask = 0;
    [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ].forEach(([dx, dy], i) => {
      const t = at(x + dx, y + dy);
      if (t && !water(t)) mask |= 1 << i;
    });
    return mask;
  }
  function draw(ctx, doc, view) {
    const cells = data(doc),
      { ox, oy, cellWidth: cw, cellHeight: ch, width, height } = view,
      [land, grain, bank] = palette(doc),
      seed = doc.biomeStyle.seed || 0;
    const x0 = Math.max(0, Math.floor(-ox / cw)),
      y0 = Math.max(0, Math.floor(-oy / ch)),
      x1 = Math.min(doc.width, Math.ceil((width - ox) / cw)),
      y1 = Math.min(doc.height, Math.ceil((height - oy) / ch));
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const t = cells[y * doc.width + x],
          space = t?.environment === "space",
          wet = water(t),
          px = ox + x * cw,
          py = oy + y * ch,
          sx = cw / 32,
          sy = ch / 32;
        const fill = (color, a, b, w, h) => {
          ctx.fillStyle = color;
          const left = Math.floor(px + a * sx),
            top = Math.floor(py + b * sy);
          ctx.fillRect(
            left,
            top,
            Math.ceil(px + (a + w) * sx) - left,
            Math.ceil(py + (b + h) * sy) - top,
          );
        };
        fill(space ? "#111c2b" : wet ? "#344f60" : land, 0, 0, 32, 32);
        const n = hash(x, y, seed);
        if (space) {
          if (n % 5 === 0) fill("#6b7483", n % 28, (n >>> 8) % 28, 1, 1);
          continue;
        }
        for (let j = 0; j < 5; j++) {
          const q = hash(x * 7 + j, y, seed);
          fill(wet ? "#3a5665" : grain, q % 30, (q >>> 8) % 30, 2, 1);
        }
        if (!wet) continue;
        const mask = shoreMask(doc, x, y),
          bands = [
            [land, 0, 3],
            [bank, 3, 2],
            ["#52696c", 5, 2],
          ];
        for (const [color, start, size] of bands) {
          if (mask & 1) fill(color, 0, start, 32, size);
          if (mask & 2) fill(color, 32 - start - size, 0, size, 32);
          if (mask & 4) fill(color, 0, 32 - start - size, 32, size);
          if (mask & 8) fill(color, start, 0, size, 32);
        }
        // Diagonal land corners join the cardinal shoreline strips without tile-edge gaps.
        for (const [dx, dy, b1, b2] of [
          [-1, -1, 8, 1],
          [1, -1, 2, 1],
          [1, 1, 2, 4],
          [-1, 1, 8, 4],
        ]) {
          const a = x + dx,
            b = y + dy,
            diagonal =
              a >= 0 && b >= 0 && a < doc.width && b < doc.height ? cells[b * doc.width + a] : null;
          if (!(mask & b1) && !(mask & b2) && diagonal && !water(diagonal))
            for (let i = 0; i < 3; i++)
              fill(
                i === 0 ? land : bank,
                dx < 0 ? 0 : 32 - (6 - i * 2),
                dy < 0 ? i * 2 : 30 - i * 2,
                6 - i * 2,
                2,
              );
        }
      }
  }
  // Generated transparent sheets may carry saturated matte pixels at the silhouette.
  // Resolve that colour key once on loading, never in the per-frame draw loop.
  function prepareSpriteImage(image) {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height),
      data = pixels.data;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2],
        max = Math.max(r, g, b),
        min = Math.min(r, g, b);
      if (
        max > 190 &&
        max - min > 150 &&
        (r > g * 1.8 || b > r * 1.8 || (g > r * 1.8 && b > r * 1.8))
      )
        data[i + 3] = 0;
    }
    ctx.putImageData(pixels, 0, 0);
    return canvas;
  }

  function drawAtlasTile(ctx, img, tile, set, x, y, width, height, cellX, cellY, options = {}) {
    const role = tile.biomeRole;
    if (!role) return false;
    // Clean tactical silhouettes are deterministic geometry, baked into the same
    // bounded world chunks. No image filtering, dithering or per-frame pixel reads.
    drawTacticalTile(ctx, tile, set, x, y, width, height, cellX, cellY);
    return true;
  }
  function drawTacticalTile(ctx, tile, set, x, y, width, height, cellX, cellY) {
    const role = tile.biomeRole,
      key = String(set.image) + String(set.id);
    const space = /space/.test(key),
      snow = /snow/.test(key),
      desert = /desert/.test(key),
      urban = /urban/.test(key),
      tropical = /tropical/.test(key);
    const land = space
      ? "#101c2b"
      : snow
        ? "#a9b8bd"
        : desert
          ? "#918167"
          : urban
            ? "#586765"
            : tropical
              ? "#647d65"
              : "#677661";
    const shade = space ? "#344351" : snow ? "#7c959e" : desert ? "#6e6659" : "#42544c";
    const light = snow ? "#c9d3d3" : desert ? "#afa184" : "#85917c";
    const n = hash(cellX, cellY, 71),
      mask = tile.mask || 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(width / 32, height / 32);
    const rect = (color, a, b, w, h) => {
      ctx.fillStyle = color;
      ctx.fillRect(a, b, w, h);
    };
    const polygon = (points, color, outline = shade) => {
      ctx.beginPath();
      points.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    };
    if (!["cliff", "shore", "road", "details"].includes(role)) rect(land, 0, 0, 32, 32);
    if (["water", "shallow", "shore"].includes(role)) {
      if (role !== "shore") {
        rect(role === "shallow" ? "#537985" : "#3c6377", 0, 0, 32, 32);
        if (n % 3 === 0) {
          rect("#628593", 4, 11, 10, 1);
          rect("#628593", 19, 24, 8, 1);
        }
      } else {
        // Neighbour masks share straight bank edges; retain small pixel steps at corners.
        const bands = [
          [land, 0, 3],
          [desert ? "#b5a581" : "#98a994", 3, 2],
          ["#688c91", 5, 1],
        ];
        for (const [color, start, size] of bands) {
          if (mask & 1) rect(color, 0, start, 32, size);
          if (mask & 2) rect(color, 32 - start - size, 0, size, 32);
          if (mask & 4) rect(color, 0, 32 - start - size, 32, size);
          if (mask & 8) rect(color, start, 0, size, 32);
        }
      }
    } else if (role === "forest") {
      for (const [a, b, r] of [
        [8, 10, 6],
        [23, 9, 5],
        [17, 22, 7],
      ]) {
        rect(shade, a - 1, b + 2, 2, 7);
        polygon(
          [
            [a - r, b + 2],
            [a - r + 1, b - 3],
            [a - 1, b - r],
            [a + r - 1, b - 3],
            [a + r, b + 3],
            [a, b + 5],
          ],
          snow ? "#b8c8c5" : tropical ? "#466c59" : "#4d6650",
        );
        ctx.strokeStyle = light;
        ctx.beginPath();
        ctx.moveTo(a - r + 2, b - 2);
        ctx.lineTo(a, b - r + 2);
        ctx.lineTo(a + r - 2, b - 2);
        ctx.stroke();
      }
    } else if (role === "rock" || role === "rubble") {
      for (const [a, b, r] of [
        [9, 12, 7],
        [23, 23, 6],
      ]) {
        polygon(
          [
            [a - r, b + 3],
            [a - r + 2, b - r],
            [a + 2, b - r - 2],
            [a + r, b - 1],
            [a + r - 2, b + 5],
          ],
          role === "rubble" ? "#7b8178" : light,
        );
        ctx.strokeStyle = shade;
        ctx.beginPath();
        ctx.moveTo(a - r, b + 3);
        ctx.lineTo(a, b - 1);
        ctx.lineTo(a + r, b - 1);
        ctx.stroke();
      }
      if (role === "rubble") rect(shade, 4, 25, 6, 2);
    } else if (role === "cliff") {
      const stripe = (a, b, w, h) => {
        rect(shade, a, b, w, h);
        rect(light, a, b, w, 1);
      };
      if (mask & 4) stripe(0, 23, 32, 9);
      if (mask & 2) stripe(27, 0, 5, 32);
      if (mask & 8) stripe(0, 0, 5, 32);
      if (mask & 1) stripe(0, 0, 32, 3);
      if (mask & 4) {
        rect("#34453f", 7, 27, 1, 5);
        rect("#34453f", 22, 26, 1, 6);
      }
    } else if (role === "road") {
      const a = mask & 8 ? 0 : 4,
        b = mask & 1 ? 0 : 4,
        w = (mask & 2 ? 32 : 28) - a,
        h = (mask & 4 ? 32 : 28) - b;
      rect(desert ? "#a1947b" : "#7c8376", a, b, w, h);
      rect("#929888", a, b, w, 1);
      rect(shade, a, b + h - 1, w, 1);
    } else if (role === "details") {
      if (n % 3 === 0) {
        rect(shade, 9, 16, 3, 1);
        rect(light, 11, 15, 3, 1);
      }
    } else if (!space && n % 4 === 0) {
      rect(light, 7, 15, 5, 1);
      rect(shade, 19, 24, 4, 1);
    } else if (space && n % 9 === 0) rect("#78909f", n % 29, (n >>> 8) % 29, 1, 1);
    ctx.restore();
  }
  return {
    drawAtlasTile,
    prepareSpriteImage,
    draw,
    shoreMask,
    terrain,
    data,
    reset: () => {
      cached = new WeakMap();
    },
  };
})();
if (typeof module !== "undefined") module.exports = BiomeTiles;
