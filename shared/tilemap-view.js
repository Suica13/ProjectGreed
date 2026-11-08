/* Canvas TileMap rendering shared by the standalone editor and battle renderer. */
const TileMapView = (() => {
  function resolveSource(src) {
    if (!src.startsWith("asset:")) return src;
    return (
      (typeof ART !== "undefined" ? ART.assets[src] : globalThis.ProjectGreedMapAssets?.[src]) || ""
    );
  }
  function create({ changed = () => {}, loadImage } = {}) {
    const images = new Map();
    let indexes = new WeakMap();
    function image(src) {
      if (!images.has(src)) {
        if (loadImage) images.set(src, loadImage(src));
        else {
          const img = new Image();
          images.set(src, img);
          img.onload = () => {
            if (src === "asset:encounter-pixel-props-v1" && typeof BiomeTiles !== "undefined") {
              images.set(src, BiomeTiles.prepareSpriteImage(img));
              img.onload = img.onerror = null;
              img.src = "";
            }
            changed();
          };
          img.onerror = changed;
          img.src = resolveSource(src);
        }
      }
      const img = images.get(src);
      return img && img.complete !== false && (img.naturalWidth || img.width) > 0 ? img : null;
    }
    function retainImages(sources = []) {
      const keep = new Set(sources);
      for (const [src, img] of images)
        if (!keep.has(src)) {
          if (!loadImage) {
            img.onload = img.onerror = null;
            if (img.getContext) img.width = img.height = 0;
            else img.src = "";
          }
          images.delete(src);
        }
      indexes = new WeakMap();
    }
    function index(doc) {
      if (!indexes.has(doc))
        indexes.set(doc, {
          tiles: new Map(doc.tiles.map((t) => [t.id, t])),
          sets: new Map(doc.tilesets.map((s) => [s.id, s])),
        });
      return indexes.get(doc);
    }
    let currentOrigin = {x:0,y:0};
    function drawTile(ctx, doc, id, x, y, width, height) {
      const lookup = index(doc),
        tile = lookup.tiles.get(id);
      if (!tile || (doc.biomeStyle && tile.noSprite)) return;
      const set = lookup.sets.get(tile.tilesetId),
        img = set && image(set.image);
      if (set) {
        if (img) {
          const handled = doc.biomeStyle?.version === 2 && typeof BiomeTiles !== "undefined" &&
            BiomeTiles.drawAtlasTile(ctx,img,tile,set,x,y,width,height,
              Math.round((x - currentOrigin.x) / width),Math.round((y - currentOrigin.y) / height),doc.biomeStyle.autotile);
          if (!handled) ctx.drawImage(img, tile.x, tile.y, tile.frameWidth || set.tileWidth, tile.frameHeight || set.tileHeight, x, y, width, height);
        }
      }
      if (!img) {
        ctx.fillStyle = tile.color;
        ctx.fillRect(x, y, width, height);
      }
    }
    function draw(ctx, doc, placement, view) {
      const { ox, oy, cellWidth: cw, cellHeight: ch, width, height } = view;
      currentOrigin = {x:ox,y:oy};
      const x0 = Math.max(0, Math.floor(-ox / cw)),
        y0 = Math.max(0, Math.floor(-oy / ch));
      const x1 = Math.min(doc.width, Math.ceil((width - ox) / cw)),
        y1 = Math.min(doc.height, Math.ceil((height - oy) / ch));
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, doc.width * cw, doc.height * ch);
      ctx.clip();
      ctx.imageSmoothingEnabled = false;
      if (doc.biomeStyle && doc.biomeStyle.version !== 2 && placement === "below" && typeof BiomeTiles !== "undefined")
        BiomeTiles.draw(ctx, doc, view);
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
      retainImages,
      image,
      invalidate: () => {
        indexes = new WeakMap();
      },
    };
  }
  return { create, resolveSource };
})();
if (typeof module !== "undefined") module.exports = TileMapView;
