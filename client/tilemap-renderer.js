/* Static authored layers are cached at viewport size, never at huge atlas/map resolution. */
const TileMapRenderer = (() => {
  let revision = 0;
  const painter = TileMapView.create({ changed: () => revision++ });
  const caches = new Map();
  function draw(ctx, map, placement, geometry, width, height) {
    if (!map.tileMap) return;
    let entry = caches.get(placement);
    if (!entry) {
      entry = { canvas: document.createElement("canvas"), key: "" };
      caches.set(placement, entry);
    }
    const { tile, ox, oy } = geometry;
    const key = [map.id, revision, tile, ox, oy, width, height].join(":");
    if (entry.key !== key) {
      entry.canvas.width = Math.max(1, Math.ceil(width));
      entry.canvas.height = Math.max(1, Math.ceil(height));
      painter.draw(entry.canvas.getContext("2d"), map.tileMap, placement, {
        ox,
        oy,
        cellWidth: tile,
        cellHeight: tile,
        width,
        height,
      });
      entry.key = key;
    }
    ctx.drawImage(entry.canvas, 0, 0, width, height);
  }
  return { draw };
})();
