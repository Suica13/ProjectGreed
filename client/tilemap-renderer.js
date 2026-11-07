/* Cache bounded world-space chunks so zoom/pan never rasterizes the whole viewport. */
const TileMapRenderer = (() => {
  let revision = 0, cachedRevision = -1, documentMap = null, pixels = 0;
  const painter = TileMapView.create({ changed: () => revision++ });
  const chunks = new Map(), chunkCells = 16, pixelLimit = 8 * 1024 * 1024;
  function clearChunks() {
    for (const entry of chunks.values()) entry.canvas.width = entry.canvas.height = 0;
    chunks.clear(); pixels = 0;
  }
  function reset(doc = null) {
    clearChunks();
    documentMap = doc; cachedRevision = revision;
    painter.retainImages?.([
      ...(doc?.tilesets || []).map(set => set.image),
      ...(doc?.layers || []).filter(layer => layer.type === "image").map(layer => layer.image.src),
    ]);
  }
  function draw(ctx, map, placement, geometry, width, height) {
    const doc = map.tileMap;
    if (!doc || !doc.layers.some(layer => layer.visible && layer.opacity > 0 && layer.placement === placement)) return;
    if (documentMap !== doc || cachedRevision !== revision) {
      if (documentMap !== doc) reset(doc);
      else { clearChunks(); cachedRevision = revision; }
    }
    const {tile, ox, oy} = geometry;
    if (!(tile > 0)) return;
    // Overview chunks stay small; close-up chunks retain the native 32px tile detail.
    const resolution = tile < 16 ? 8 : 32;
    const x0 = Math.max(0, Math.floor(-ox / (tile * chunkCells)));
    const y0 = Math.max(0, Math.floor(-oy / (tile * chunkCells)));
    const x1 = Math.min(Math.ceil(doc.width / chunkCells), Math.ceil((width - ox) / (tile * chunkCells)));
    const y1 = Math.min(Math.ceil(doc.height / chunkCells), Math.ceil((height - oy) / (tile * chunkCells)));
    ctx.save(); ctx.imageSmoothingEnabled = false;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const key = [placement, resolution, x, y].join(":");
      let entry = chunks.get(key);
      if (!entry) {
        const cellsWide = Math.min(chunkCells, doc.width - x * chunkCells);
        const cellsHigh = Math.min(chunkCells, doc.height - y * chunkCells);
        const canvas = document.createElement("canvas");
        canvas.width = cellsWide * resolution; canvas.height = cellsHigh * resolution;
        painter.draw(canvas.getContext("2d"), doc, placement, {
          ox: -x * chunkCells * resolution, oy: -y * chunkCells * resolution,
          cellWidth: resolution, cellHeight: resolution, width: canvas.width, height: canvas.height,
        });
        entry = {canvas, cellsWide, cellsHigh}; pixels += canvas.width * canvas.height;
      } else chunks.delete(key);
      chunks.set(key, entry);
      while (pixels > pixelLimit || chunks.size > 128) {
        const oldest = chunks.keys().next().value, removed = chunks.get(oldest);
        chunks.delete(oldest); pixels -= removed.canvas.width * removed.canvas.height;
        removed.canvas.width = removed.canvas.height = 0;
      }
      ctx.drawImage(entry.canvas, ox + x * chunkCells * tile, oy + y * chunkCells * tile,
        entry.cellsWide * tile, entry.cellsHigh * tile);
    }
    ctx.restore();
  }
  return {draw, reset, cacheStats: () => ({ chunks: chunks.size, pixels })};
})();
