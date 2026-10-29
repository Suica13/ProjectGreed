/* Canvas TileMap rendering shared by the standalone editor and battle renderer. */
const TileMapView = (() => {
  function create({ changed = () => {}, loadImage } = {}) {
    const images = new Map();
    let indexes = new WeakMap();
    function image(src) {
      if (!images.has(src)) {
        if (loadImage) images.set(src, loadImage(src));
        else {
          const img = new Image();
          images.set(src, img);
          img.onload = changed;
          img.onerror = changed;
          img.src = src;
        }
      }
      const img = images.get(src);
      return img && img.complete !== false && (img.naturalWidth || img.width) > 0 ? img : null;
    }
    function index(doc) {
      if (!indexes.has(doc))
        indexes.set(doc, {
          tiles: new Map(doc.tiles.map((t) => [t.id, t])),
          sets: new Map(doc.tilesets.map((s) => [s.id, s])),
        });
      return indexes.get(doc);
    }
    function drawTile(ctx, doc, id, x, y, width, height) {
      const lookup = index(doc),
        tile = lookup.tiles.get(id);
      if (!tile) return;
      const set = lookup.sets.get(tile.tilesetId),
        img = set && image(set.image);
      if (set) {
        if (img)
          ctx.drawImage(img, tile.x, tile.y, set.tileWidth, set.tileHeight, x, y, width, height);
      } else {
        ctx.fillStyle = tile.color;
        ctx.fillRect(x, y, width, height);
      }
    }
    function draw(ctx, doc, placement, view) {
      const { ox, oy, cellWidth: cw, cellHeight: ch, width, height } = view;
      const x0 = Math.max(0, Math.floor(-ox / cw)),
        y0 = Math.max(0, Math.floor(-oy / ch));
      const x1 = Math.min(doc.width, Math.ceil((width - ox) / cw)),
        y1 = Math.min(doc.height, Math.ceil((height - oy) / ch));
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, doc.width * cw, doc.height * ch);
      ctx.clip();
      ctx.imageSmoothingEnabled = false;
      for (const layer of doc.layers) {
        if (!layer.visible || layer.opacity <= 0 || layer.placement !== placement) continue;
        ctx.globalAlpha = layer.opacity;
        if (layer.type === "image") {
          const i = layer.image,
            img = image(i.src);
          if (img) ctx.drawImage(img, ox + i.x * cw, oy + i.y * ch, i.width * cw, i.height * ch);
        } else {
          for (let y = y0; y < y1; y++)
            for (let x = x0; x < x1; x++) {
              const id = layer.data[y * doc.width + x];
              if (id !== null) drawTile(ctx, doc, id, ox + x * cw, oy + y * ch, cw, ch);
            }
        }
      }
      ctx.restore();
    }
    return {
      draw,
      drawTile,
      image,
      invalidate: () => {
        indexes = new WeakMap();
      },
    };
  }
  return { create };
})();
if (typeof module !== "undefined") module.exports = TileMapView;
