/* 地图视图与格子坐标分开；缩放和平移不会改变单位实际位置。 */
const MapCamera = (() => {
  const canvas = byId("map");
  let zoom = 1,
    centerX = Rules.W / 2,
    centerY = Rules.H / 2,
    drag = null,
    suppressClick = false;
  function geometry(width, height) {
    const tile = Math.min((width - 36) / Rules.W, (height - 36) / Rules.H) * zoom;
    const bound = (value, half, extent) =>
      half >= extent / 2 ? extent / 2 : Math.max(half, Math.min(extent - half, value));
    centerX = bound(centerX, width / (2 * tile), Rules.W);
    centerY = bound(centerY, height / (2 * tile), Rules.H);
    return { tile, ox: width / 2 - centerX * tile, oy: height / 2 - centerY * tile };
  }
  function refresh() {
    const box = canvas.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) mapGeo = geometry(box.width, box.height);
    byId("mapZoomLabel").textContent = Math.round(zoom * 100) + "%";
    byId("mapZoomOut").disabled = zoom <= 1;
    byId("mapZoomIn").disabled = zoom >= 3;
    canvas.style.cursor = zoom > 1 ? "grab" : "";
  }
  function setZoom(value, x, y) {
    const box = canvas.getBoundingClientRect(),
      old = geometry(box.width, box.height);
    x ??= box.width / 2;
    y ??= box.height / 2;
    const cellX = (x - old.ox) / old.tile,
      cellY = (y - old.oy) / old.tile;
    zoom = Math.max(1, Math.min(3, value));
    const tile = Math.min((box.width - 36) / Rules.W, (box.height - 36) / Rules.H) * zoom;
    centerX = cellX - (x - box.width / 2) / tile;
    centerY = cellY - (y - box.height / 2) / tile;
    refresh();
  }
  function reset() {
    zoom = 1;
    centerX = Rules.W / 2;
    centerY = Rules.H / 2;
    drag = null;
    suppressClick = false;
    refresh();
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
    if (zoom <= 1 || event.button !== 0 || window.GamePreview?.active) return;
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
  byId("mapZoomIn").onclick = () => setZoom(zoom * 1.25);
  byId("mapZoomOut").onclick = () => setZoom(zoom / 1.25);
  byId("mapZoomReset").onclick = reset;
  return {
    geometry,
    reset,
    setZoom,
    get zoom() {
      return zoom;
    },
  };
})();
