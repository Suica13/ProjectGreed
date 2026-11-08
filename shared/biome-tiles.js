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

  // Textures are reduced to native game pixels once, then mirrored at world-cell
  // boundaries. Adjacent terrain of the same type shares identical edge pixels.
  const textureCache = new WeakMap();
  function texture(img, tile, kind = "base") {
    let frames = textureCache.get(img);
    if (!frames) textureCache.set(img, (frames = new Map()));
    const key = [tile.x, tile.y, tile.frameWidth, tile.frameHeight, tile.biomeRole, kind].join(":");
    if (frames.has(key)) return frames.get(key);
    const c = document.createElement("canvas");
    const integrated = ["forest", "rock", "rubble"].includes(tile.biomeRole);
    const span = integrated ? 64 : 128,
      size = span * 2;
    c.width = c.height = size;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    const fw = tile.frameWidth || 32,
      fh = tile.frameHeight || 32;
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 2; x++) {
        g.save();
        g.translate(x ? size : 0, y ? size : 0);
        g.scale(x ? -1 : 1, y ? -1 : 1);
        g.drawImage(img, tile.x, tile.y, fw, fh, 0, 0, span, span);
        g.restore();
      }
    if (integrated) {
      const pixels = g.getImageData(0, 0, size, size),
        data = pixels.data;
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const px = x % 64,
            py = y % 64,
            edge = Math.min(px, py, 63 - px, 63 - py);
          data[(y * size + x) * 4 + 3] *= Math.min(1, edge / 4);
        }
      g.putImageData(pixels, 0, 0);
    }
    frames.set(key, c);
    return c;
  }
  function drawAtlasTile(ctx, img, tile, set, x, y, width, height, cellX, cellY, options = {}) {
    const role = tile.biomeRole;
    if (!role) return false;
    const tex = texture(img, tile),
      sx = (cellX & (tex.width === 128 ? 1 : 3)) * 64,
      sy = (cellY & (tex.width === 128 ? 1 : 3)) * 64;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(width / 32, height / 32);
    ctx.imageSmoothingEnabled = false;
    const patch = (dx = 0, dy = 0, w = 32, h = 32) =>
      ctx.drawImage(tex, sx + dx*2, sy + dy*2, w*2, h*2, dx, dy, w, h);
    if (role === "shore") {
      const mask = tile.mask,
        edge = (side, depth) => {
          if (side === 0) return [0, 0, 32, depth];
          if (side === 1) return [32 - depth, 0, depth, 32];
          if (side === 2) return [0, 32 - depth, 32, depth];
          return [0, 0, depth, 32];
        };
      // Pixel steps follow the same shoreline phase on neighbouring cells.
      for (let side = 0; side < 4; side++)
        if (mask & (1 << side)) {
          for (let k = 0; k < 8; k++) {
            const depth =
              (options.shoreWidth || 7) -
              1 +
              ((hash(side & 1 ? cellY * 8 + k : cellX * 8 + k, side, 7) >>> 2) % 3);
            let [a, b, w, h] = edge(side, depth);
            if (side & 1) {
              b = k * 4;
              h = 4;
            } else {
              a = k * 4;
              w = 4;
            }
            ctx.fillStyle = "#8fa9a3";
            ctx.fillRect(a, b, w, h);
            if (side === 0) h -= 2;
            else if (side === 1) {
              a += 2;
              w -= 2;
            } else if (side === 2) {
              b += 2;
              h -= 2;
            } else w -= 2;
            patch(a, b, w, h);
          }
        }
    } else if (role === "cliff") {
      const mask = tile.mask,
        fw = tile.frameWidth || 32,
        fh = tile.frameHeight || 32;
      const stripe = (dx, dy, w, h) =>
        ctx.drawImage(
          img,
          tile.x + fw * 0.12,
          tile.y + fh * 0.58,
          fw * 0.76,
          fh * 0.35,
          dx,
          dy,
          w,
          h,
        );
      if (mask & 4)
        stripe(
          0,
          32 - (options.cliffHeight || 10) - (tile.elevation > 1 ? 3 : 0),
          32,
          (options.cliffHeight || 10) + (tile.elevation > 1 ? 3 : 0),
        );
      if (mask & 2) stripe(27, 0, 5, 32);
      if (mask & 8) stripe(0, 0, 5, 32);
      if (mask & 1) {
        ctx.fillStyle = "rgba(22,29,28,.5)";
        ctx.fillRect(0, 0, 32, 2);
      }
    } else if (role === "road") {
      const inset = options.roadInset ?? 3;
      const left = tile.mask & 8 ? 0 : inset,
        top = tile.mask & 1 ? 0 : inset;
      const right = tile.mask & 2 ? 32 : 32 - inset,
        bottom = tile.mask & 4 ? 32 : 32 - inset;
      ctx.beginPath();
      ctx.rect(left, top, right - left, bottom - top);
      ctx.clip();
      patch();
    } else if (role === "details") {
      ctx.globalAlpha *= 0.7;
      ctx.drawImage(img, tile.x, tile.y, tile.frameWidth, tile.frameHeight, 2, 2, 28, 28);
    } else {
      if (tile.underlay) {
        const f = tile.underlay,
          base = texture(img, {
            x: f.x,
            y: f.y,
            frameWidth: f.width,
            frameHeight: f.height,
            biomeRole: "plain",
          });
        ctx.drawImage(base, (cellX & 3) * 64, (cellY & 3) * 64, 64, 64, 0, 0, 32, 32);
      }
      patch();
    }
    ctx.restore();
    return true;
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
