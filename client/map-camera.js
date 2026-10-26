/* 地图视图与格子坐标分开；缩放和平移不会改变单位实际位置。 */
const MapCamera = (() => {
  const canvas = byId("map");
  const cellScale = ART.presentation.mapCellScale || 1;
  const zoomStep = 1.25;
  // baseTile already fits the viewport before presentation scaling is applied.
  const fitZoom = 1 / cellScale;
  const minimumZoom = fitZoom / zoomStep;
  const zoomEpsilon = 0.000001;
  let zoom = fitZoom,
    centerX = Rules.mapWidth(game) / 2,
    centerY = Rules.mapHeight(game) / 2,
    drag = null,
    suppressClick = false;
  // Larger maps need more magnification to reach the same readable cell size.
  const readableCellPixels = 160;
  function baseTile(width, height) {
    return (
      Math.min(
        (Math.max(37, width) - 36) / Rules.mapWidth(game),
        (Math.max(37, height) - 36) / Rules.mapHeight(game),
      ) * cellScale
    );
  }
  function zoomLimit(width, height) {
    return Math.max(5, Math.ceil((readableCellPixels / baseTile(width, height)) * 2) / 2);
  }
  function maximumZoom() {
    const box = canvas.getBoundingClientRect();
    return zoomLimit(box.width || 800, box.height || 600);
  }
  function geometry(width, height) {
    const tile = baseTile(width, height) * zoom;
    const bound = (value, half, extent) =>
      half >= extent / 2 ? extent / 2 : Math.max(half, Math.min(extent - half, value));
    centerX = bound(centerX, width / (2 * tile), Rules.mapWidth(game));
    centerY = bound(centerY, height / (2 * tile), Rules.mapHeight(game));
    return { tile, ox: width / 2 - centerX * tile, oy: height / 2 - centerY * tile };
  }
  function refresh() {
    const box = canvas.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) {
      zoom = Math.min(zoom, zoomLimit(box.width, box.height));
      mapGeo = geometry(box.width, box.height);
    }
    byId("mapZoomLabel").textContent = Math.round(zoom * 100) + "%";
    byId("mapZoomOut").disabled = zoom <= minimumZoom;
    byId("mapZoomIn").disabled = zoom >= maximumZoom();
    canvas.style.cursor = zoom * cellScale > 1 ? "grab" : "";
  }
  function setZoom(value, x, y) {
    const box = canvas.getBoundingClientRect(),
      old = geometry(box.width, box.height);
    x ??= box.width / 2;
    y ??= box.height / 2;
    const cellX = (x - old.ox) / old.tile,
      cellY = (y - old.oy) / old.tile;
    let nextZoom = Math.max(minimumZoom, Math.min(maximumZoom(), value));
    // Keep a distinct full-map stop before entering the one-step thumbnail view.
    // The same stops apply to buttons, wheel input and programmatic zoom changes.
    if (zoom < fitZoom - zoomEpsilon && nextZoom > zoom)
      nextZoom = Math.max(fitZoom, nextZoom);
    else if (nextZoom < fitZoom) {
      nextZoom = zoom > fitZoom + zoomEpsilon ? fitZoom : minimumZoom;
    }
    zoom = nextZoom;
    const tile = baseTile(box.width, box.height) * zoom;
    centerX = cellX - (x - box.width / 2) / tile;
    centerY = cellY - (y - box.height / 2) / tile;
    refresh();
  }
  function focus(x, y, { preserveZoom = false } = {}) {
    if (!preserveZoom) zoom = Math.max(zoom, 1.75);
    centerX = x + 0.5;
    centerY = y + 0.5;
    drag = null;
    suppressClick = false;
    hover = null;
    refresh();
  }
  function frame(a, b) {
    focus((a.x + b.x) / 2, (a.y + b.y) / 2, { preserveZoom: true });
  }
  function reset() {
    zoom = fitZoom;
    centerX = Rules.mapWidth(game) / 2;
    centerY = Rules.mapHeight(game) / 2;
    drag = null;
    suppressClick = false;
    refresh();
  }
  function fit() {
    reset();
  }
  canvas.addEventListener(
    "wheel",
    (event) => {
      if (window.GamePreview?.active || pageView !== "game") return;
      event.preventDefault();
      const box = canvas.getBoundingClientRect();
      setZoom(
        zoom * Math.exp(-event.deltaY * 0.0015),
        event.clientX - box.left,
        event.clientY - box.top,
      );
    },
    { passive: false },
  );
  canvas.addEventListener("pointerdown", (event) => {
    if (zoom * cellScale <= 1 || event.button !== 0 || window.GamePreview?.active) return;
    suppressClick = false;
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      centerX,
      centerY,
      tile: mapGeo.tile,
      moved: false,
    };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 5) drag.moved = true;
    if (!drag.moved) return;
    centerX = drag.centerX - dx / drag.tile;
    centerY = drag.centerY - dy / drag.tile;
    refresh();
    canvas.style.cursor = "grabbing";
    hover = null;
  });
  function release(event) {
    if (drag?.id !== event.pointerId) return;
    suppressClick = drag.moved;
    drag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    refresh();
  }
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener(
    "click",
    (event) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
  window.addEventListener("resize", refresh);
  byId("mapZoomIn").onclick = () => setZoom(zoom * zoomStep);
  byId("mapZoomOut").onclick = () => setZoom(zoom / zoomStep);
  byId("mapZoomReset").onclick = fit;
  return {
    geometry,
    frame,
    focus,
    reset,
    fit,
    setZoom,
    get unitThumbnails() {
      return zoom <= minimumZoom + zoomEpsilon;
    },
    get maxZoom() {
      return maximumZoom();
    },
    get zoom() {
      return zoom;
    },
  };
})();
