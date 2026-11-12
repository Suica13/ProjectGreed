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
    const space = tile.environment === "space" || /space/.test(key),
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
    const light = space ? "#91a0a6" : snow ? "#c9d3d3" : desert ? "#afa184" : "#85917c";
    const n = hash(cellX, cellY, 71),
      variant = n % 6,
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
    const shadow = (points, opacity = 0.18) => {
      ctx.save();
      ctx.globalAlpha *= opacity;
      polygon(points, "#07131d", "#07131d");
      ctx.restore();
    };
    const line = (points, color, thickness = 1) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = thickness;
      ctx.beginPath();
      points.forEach(([a,b],i) => i ? ctx.lineTo(a,b) : ctx.moveTo(a,b));
      ctx.stroke();
    };
    if (!["cliff", "shore", "road", "details"].includes(role)) rect(land, 0, 0, 32, 32);
    // Broad, low-contrast ground shapes carry detail without photograph-like grain.
    // Keep overlay layers transparent so roads, banks and cliff faces still join.
    if (["ground", "plain", "forest", "rock", "rubble"].includes(role) && !space) {
      const tone = snow
        ? "#b4c2c5"
        : desert
          ? "#9c8b70"
          : urban
            ? "#62706b"
            : tropical
              ? "#6b8469"
              : "#71806a";
      const shift = n % 6;
      // World-space patches join across cells instead of stamping one mark per tile.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, 32, 32);
      ctx.clip();
      for (let gy = Math.floor(cellY / 3) - 1; gy <= Math.floor(cellY / 3) + 1; gy++)
        for (let gx = Math.floor(cellX / 3) - 1; gx <= Math.floor(cellX / 3) + 1; gx++) {
          const q = hash(gx, gy, 409),
            a = gx * 96 + 18 + (q % 60) - cellX * 32,
            b = gy * 96 + 18 + ((q >>> 8) % 60) - cellY * 32;
          if (a < -48 || b < -48 || a > 80 || b > 80) continue;
          const points = Array.from({ length: 8 }, (_, i) => {
            const angle = (i * Math.PI) / 4,
              radius = 26 + (hash(gx + i, gy, 71) % 18);
            return [a + Math.cos(angle) * radius, b + Math.sin(angle) * radius * 0.65];
          });
          const patchTone = q % 3 === 0 ? land : tone;
          polygon(points, patchTone, patchTone);
        }
      ctx.restore();
      if (urban) {
        if (cellY % 2 === 0) rect("#788077", 0, 0, 32, 1);
        if (cellX % 2 === 0) rect("#435452", 0, 0, 1, 32);
        if (n % 4 === 0) rect("#879083", 6, 7, 8, 2);
        if (variant === 1 || variant === 4) {
          ctx.strokeStyle = "#435452";
          ctx.beginPath();
          ctx.moveTo(8, 4);
          ctx.lineTo(13, 10);
          ctx.lineTo(11, 15);
          ctx.lineTo(18, 19);
          ctx.stroke();
        }
      } else if (desert) {
        rect("#b0a080", 3 + variant, 10 + shift, 12 + variant, 1);
        rect("#a69678", 8, 14 + shift, 16 - variant, 1);
        if (variant === 2)
          polygon(
            [
              [5, 24],
              [9, 21],
              [16, 22],
              [19, 25],
            ],
            "#a09072",
            "#a09072",
          );
      } else if (snow) {
        rect("#d0d9d8", 3 + variant, 11 + shift, 20 - variant, 2);
        rect("#c4d0d0", 9, 14 + shift, 12 + variant, 2);
        if (variant === 3) rect("#8da7b3", 18, 24, 8, 2);
      } else {
        // Six quiet surface accents: tufts, exposed soil, pebbles and worn tracks.
        const grass = tropical ? "#4d7155" : "#587151";
        if (variant === 0) {
          rect(grass, 7, 23, 2, 3);
          rect(grass, 10, 21, 2, 5);
          rect(light, 10, 21, 2, 1);
        }
        if (variant === 1)
          polygon(
            [
              [19, 23],
              [23, 20],
              [28, 22],
              [27, 25],
            ],
            "#7e8067",
            "#7e8067",
          );
        if (variant === 2) {
          rect(shade, 6, 25, 5, 2);
          rect(light, 7, 24, 3, 1);
        }
        if (variant === 3) {
          rect(grass, 22, 13, 2, 3);
          rect(grass, 25, 12, 2, 4);
        }
        if (variant === 4) {
          rect("#5a6c52", 6, 25, 13, 1);
          rect("#5a6c52", 10, 28, 13, 1);
        }
        if (variant === 5)
          polygon(
            [
              [4, 8],
              [9, 5],
              [14, 8],
              [12, 11],
              [6, 12],
            ],
            grass,
            grass,
          );
      }
    }
    if (["water", "shallow", "shore"].includes(role)) {
      if (role !== "shore") {
        rect(role === "shallow" ? "#537985" : "#3c6377", 0, 0, 32, 32);
        const offset = n % 5;
        rect("#487284", 2 + variant, 8 + offset, 17 - variant, 2);
        rect("#587e8c", 6 + variant, 8 + offset, 10 - variant, 1);
        rect("#487284", 12 + offset, 22 - offset, 16 - variant, 2);
        if (variant % 2 === 0) rect("#628593", 18, 22 - offset, 8, 1);
        line([[3,17],[8,16],[13,17],[17,16]], "#456e80");
        if (role === "shallow") {
          polygon([[20,26],[24,23],[28,24],[27,27]], "#66868a", "#66868a");
          rect("#7b9795",22,24,3,1);
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
      const trees =
        variant % 3 === 0
          ? [
              [9, 11, 8],
              [22, 22, 8],
            ]
          : variant % 3 === 1
            ? [
                [10, 9, 7],
                [24, 13, 6],
                [14, 23, 8],
              ]
            : [
                [8, 12, 7],
                [23, 9, 7],
                [21, 24, 7],
              ];
      for (const [a, b, r] of trees) {
        shadow(
          [
            [a - r + 3, b + 4],
            [a + r - 1, b + 3],
            [Math.min(31, a + r + 4), Math.min(31, b + 9)],
            [a + 2, Math.min(31, b + 11)],
            [a - r + 2, b + 8],
          ],
          0.23,
        );
        rect(shade, a - 1, b + 2, 2, 7);
        rect("#927e60", a, b + 5, 1, 4);
        polygon(
          [
            [a - r, b + 2],
            [a - r + 1, b - 3],
            [a - 1, b - r],
            [a + r - 1, b - 3],
            [a + r, b + 3],
            [a, b + 5],
          ],
          snow
            ? "#b8c8c5"
            : tropical
              ? variant % 2
                ? "#4b7057"
                : "#466c59"
              : variant % 2
                ? "#536c51"
                : "#4d6650",
        );
        polygon(
          [
            [a - r + 2, b],
            [a - 2, b - r + 2],
            [a + r - 2, b - 2],
            [a + 3, b + 2],
            [a - 2, b + 3],
          ],
          snow ? "#d3dcda" : tropical ? "#608568" : "#70865f",
          snow ? "#d3dcda" : tropical ? "#608568" : "#70865f",
        );
        ctx.strokeStyle = light;
        ctx.beginPath();
        ctx.moveTo(a - r + 2, b - 2);
        ctx.lineTo(a, b - r + 2);
        ctx.lineTo(a + r - 2, b - 2);
        ctx.stroke();
        // Distinct crown lobes, short branch forks and leaf shelves retain the
        // clean silhouette while making a forest read as layered vegetation.
        polygon([[a-r+2,b],[a-r+3,b-4],[a-3,b-5],[a-1,b-1],[a-4,b+2]],
          snow ? "#c6d4d1" : tropical ? "#557d60" : "#5d7857", shade);
        polygon([[a+1,b-4],[a+4,b-r+2],[a+r-1,b-3],[a+r-2,b+1],[a+3,b+2]],
          snow ? "#bacbc8" : tropical ? "#4b7358" : "#526e51", shade);
        line([[a,b+6],[a-3,b+3],[a-4,b+1]], "#6d6a51");
        rect(snow ? "#e0e6df" : "#89a171",a-3,b-5,3,1);
        rect(snow ? "#d6e0dc" : "#779365",a+2,b-3,3,1);
      }
    } else if (role === "rock" || role === "rubble") {
      const rocks =
        variant % 3 === 0
          ? [[13, 15, 10]]
          : variant % 3 === 1
            ? [
                [8, 11, 6],
                [23, 23, 7],
              ]
            : [
                [10, 19, 8],
                [25, 10, 5],
              ];
      for (const [a, b, r] of rocks) {
        shadow(
          [
            [a - r + 1, b + 3],
            [a + r, b],
            [Math.min(31, a + r + 5), b + 6],
            [a + 2, Math.min(31, b + 10)],
            [a - r + 2, b + 7],
          ],
          0.22,
        );
        polygon(
          [
            [a - r, b + 3],
            [a - r + 2, b - r],
            [a + 2, b - r - 2],
            [a + r, b - 1],
            [a + r - 2, b + 5],
          ],
          role === "rubble" ? space ? "#6f7e87" : "#7b8178" : light,
        );
        ctx.strokeStyle = shade;
        ctx.beginPath();
        ctx.moveTo(a - r, b + 3);
        ctx.lineTo(a, b - 1);
        ctx.lineTo(a + r, b - 1);
        ctx.stroke();
        polygon([[a-r+2,b-r],[a+2,b-r-2],[a,b-1],[a-r+3,b+2]],
          snow ? "#c8d5d7" : desert ? "#b2a180" : space ? "#879395" : "#a1a98f", light);
        polygon([[a,b-1],[a+r,b-1],[a+r-2,b+5],[a-1,b+3]],
          space ? "#53616a" : desert ? "#82765f" : "#6c7b70", shade);
        line([[a+1,b-r+1],[a+3,b-4],[a+1,b-1]], shade);
        rect(light,a-r+3,b+5,3,1);
        if (space) {
          polygon([[a-3,b-6],[a,b-7],[a+2,b-5],[a,b-3],[a-3,b-4]], "#485864", "#677780");
          rect("#8c999d",a-2,b-7,3,1);
        }
      }
      if (role === "rubble" && space) {
        // Orbital debris is fractured hull plating among asteroids, never
        // terrestrial walls/windows. All variants stay in the space palette.
        if (variant % 3 === 0) {
          polygon([[4,19],[12,12],[25,14],[28,18],[20,26],[8,24]], "#637781", "#344855");
          polygon([[8,24],[20,26],[28,18],[27,23],[20,29],[9,27]], "#3e5361");
          line([[8,18],[13,15],[23,16]], "#a0acaf");
          line([[15,16],[13,20],[19,23]], "#344855");
          line([[8,21],[13,22]], "#899b9f");
        } else if (variant % 3 === 1) {
          polygon([[4,12],[9,10],[23,24],[20,28]], "#697d85", "#364b58");
          line([[8,12],[20,24]], "#a0aeb0", 2);
          polygon([[17,9],[26,12],[24,17],[19,15],[17,12]], "#536b78");
          line([[19,10],[24,12]], "#8d9fa5");
          polygon([[3,25],[8,24],[10,28],[5,29]], "#657781");
        } else {
          polygon([[5,18],[12,11],[21,12],[27,18],[22,25],[14,23],[10,26]], "#596f7b");
          polygon([[10,18],[15,14],[20,15],[23,18],[19,21],[14,20]], "#253e4e", "#809399");
          line([[7,18],[13,13],[19,14]], "#9aa8aa");
          line([[22,23],[26,20],[28,24]], "#82969d");
        }
      } else if (role === "rubble") {
        // Broken walls and floor slabs read as ruins, rather than loose gravel.
        shadow(
          [
            [3, 19],
            [23, 16],
            [31, 23],
            [28, 30],
            [8, 29],
          ],
          0.25,
        );
        if (variant % 3 === 0) {
          rect("#7d8980", 5, 10, 6, 16);
          rect("#a0a89b", 5, 10, 6, 2);
          rect("#879087", 11, 20, 16, 6);
          rect("#626f68", 11, 24, 16, 4);
          rect("#414f4d", 16, 21, 4, 4);
          rect("#a3a89a", 11, 20, 16, 1);
        } else if (variant % 3 === 1) {
          rect("#879087", 3, 14, 16, 8);
          rect("#626f68", 3, 19, 16, 6);
          rect("#a3a89a", 3, 14, 16, 2);
          rect("#414f4d", 7, 17, 4, 5);
          rect("#414f4d", 14, 17, 3, 4);
          rect("#7d8980", 23, 9, 5, 15);
          rect("#a0a89b", 23, 9, 5, 2);
          rect("#586761", 21, 24, 8, 3);
          rect("#8e9689", 5, 27, 8, 2);
        } else {
          polygon(
            [
              [4, 18],
              [14, 10],
              [28, 15],
              [23, 26],
              [9, 27],
            ],
            "#7f897d",
          );
          polygon(
            [
              [4, 18],
              [9, 23],
              [23, 22],
              [23, 26],
              [9, 27],
            ],
            "#596b63",
          );
          rect("#a0a89b", 13, 14, 9, 2);
          rect("#465a56", 14, 19, 4, 3);
          rect(shade, 3, 28, 5, 2);
        }
        // Window recesses, broken masonry courses and exposed floor plates.
        for (let i=0;i<3;i++) {
          const a=5+i*7, b=variant%2 ? 20 : 26;
          rect("#485b56",a,b,3,2);
          rect("#a8afa0",a,b-1,4,1);
        }
        line([[6,12],[11,15],[10,19]], "#4d5d57");
        rect("#9da48f",23,27,5,2);
        rect("#576961",25,29,4,1);
      } else {
        polygon(
          [
            [3, 15],
            [7, 6],
            [14, 4],
            [12, 12],
          ],
          snow ? "#e0e5df" : desert ? "#c0ae88" : space ? "#819095" : "#a1ab94",
          light,
        );
        rect(shade, 4, 27, 12, 2);
      }
    } else if (role === "cliff") {
      const stripe = (a, b, w, h) => {
        rect(shade, a, b, w, h);
        rect(light, a, b, w, 1);
        if (h > 4) {
          rect(desert ? "#897b65" : "#607063", a, b + 3, w, 2);
          rect(desert ? "#aa9877" : "#82907b", a, b + 6, w, 1);
        }
      };
      if (mask & 4) stripe(0, 23, 32, 9);
      if (mask & 2) stripe(27, 0, 5, 32);
      if (mask & 8) stripe(0, 0, 5, 32);
      if (mask & 1) stripe(0, 0, 32, 3);
      if (mask & 4) {
        line([[3,24],[5,27],[4,30]],shade);
        line([[15,23],[17,26],[16,29],[19,31]],shade);
        rect(desert ? "#b8a581" : "#9ba58a",11,24,6,1);
        rect(shade,24,30,6,2);
      }
      if (mask & 2) line([[29,5],[31,10],[29,14],[30,20]],shade);
      if (mask & 8) line([[2,5],[4,10],[2,14],[3,20]],shade);
      if (mask & 4) {
        shadow(
          [
            [0, 29],
            [32, 29],
            [32, 32],
            [0, 32],
          ],
          0.3,
        );
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
      if (w > h) {
        rect("#a4aa94", 10, 15, 12, 1);
        rect("#65715e", 3, 4, 7, 1);
      } else {
        rect("#a4aa94", 15, 10, 1, 12);
        rect("#65715e", 4, 3, 1, 7);
      }
      if (urban) {
        rect("#4e625d",8,8,3,3);
        rect("#919b8b",8,8,3,1);
        line([[24,4],[23,11],[26,15]],"#55665e");
      } else {
        rect("#6b7562",a+3,b+3,Math.max(1,w-6),1);
        rect("#8e957e",a+3,b+h-4,Math.max(1,w-6),1);
      }
    } else if (role === "details") {
      if (!space) {
        shadow(
          [
            [8, 18],
            [19, 17],
            [23, 23],
            [10, 25],
          ],
          0.2,
        );
        if (variant === 0) {
          rect(shade, 7, 19, 12, 3);
          polygon(
            [
              [8, 18],
              [9, 12],
              [13, 10],
              [18, 13],
              [19, 19],
            ],
            desert ? "#8d8966" : snow ? "#a0b5af" : "#526e50",
          );
          rect(light, 10, 13, 5, 1);
          rect(shade, 24, 26, 4, 2);
        } else if (variant === 1) {
          rect(shade, 8, 21, 17, 3);
          rect(desert ? "#a49974" : snow ? "#c7d4ce" : "#7d8970", 9, 17, 8, 5);
          rect(light, 9, 17, 8, 1);
          rect("#475b53", 19, 12, 4, 10);
          rect(light, 19, 12, 4, 1);
        } else if (variant === 2) {
          polygon(
            [
              [7, 21],
              [13, 15],
              [24, 17],
              [26, 24],
              [14, 26],
            ],
            snow ? "#ccd5cd" : "#8a9381",
          );
          rect(shade, 13, 22, 10, 2);
          rect(light, 13, 17, 9, 1);
        } else if (variant === 3) {
          rect("#716951", 11, 11, 4, 13);
          rect(light, 11, 11, 4, 1);
          rect(shade, 15, 20, 9, 3);
          rect("#716951", 17, 15, 3, 7);
        } else if (variant === 4) {
          rect(shade, 8, 20, 18, 5);
          polygon(
            [
              [8, 17],
              [13, 13],
              [25, 15],
              [23, 21],
              [11, 22],
            ],
            "#667f78",
          );
          rect("#9bab9b", 13, 15, 8, 2);
        } else {
          polygon(
            [
              [7, 20],
              [9, 15],
              [15, 13],
              [18, 18],
              [15, 23],
            ],
            desert ? "#a99a78" : snow ? "#c3d3cc" : "#688661",
          );
          polygon(
            [
              [19, 25],
              [20, 21],
              [25, 20],
              [28, 24],
              [25, 27],
            ],
            light,
          );
          rect(shade, 10, 25, 8, 1);
        }
      } else if (space && variant < 2) {
        polygon(
          [
            [7, 17],
            [12, 11],
            [25, 15],
            [22, 21],
          ],
          "#596a72",
        );
        rect("#99a3a0", 12, 13, 9, 1);
        rect("#344a59", 18, 16, 4, 4);
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
