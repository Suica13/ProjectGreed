/* 地图视图与格子坐标分开；缩放和平移不会改变单位实际位置。 */
const MapCamera = (() => {
  const canvas = byId("map");
  const cellScale = ART.presentation.mapCellScale || 1;
  const gridScale = Rules.mapCellPixels / 64;
  const zoomStep = 1.25;
  // baseTile already fits the viewport before presentation scaling is applied.
  const fitZoom = 1 / (cellScale * gridScale);
  const minimumZoom = fitZoom / zoomStep;
  const zoomEpsilon = 0.000001;
  let zoom = 1 / cellScale,
    centerX = Rules.mapWidth(game) / 2,
    centerY = Rules.mapHeight(game) / 2,
    drag = null,
    suppressClick = false;
  const touches = new Map();
  let pinch = null,
    pinchConsumed = false;
  function baseTile(width, height) {
    return (
      Math.min(
        (Math.max(37, width) - 36) / Rules.mapWidth(game),
        (Math.max(37, height) - 36) / Rules.mapHeight(game),
      ) *
      cellScale *
      gridScale
    );
  }
  function zoomLimit(width, height) {
    // Keep square cells; one axis reaches 8 columns / 4 rows.
    return Math.max(fitZoom, Math.max(width / 8, height / 4) / baseTile(width, height));
  }
  function maximumZoom(width, height) {
    if (!(width > 0 && height > 0)) {
      const box = canvas.getBoundingClientRect();
      width = box.width || 800;
      height = box.height || 600;
    }
    return zoomLimit(width, height);
  }
  function zoomPercent(width, height) {
    if (zoom < fitZoom - zoomEpsilon) return 0;
    const span = maximumZoom(width, height) - fitZoom;
    return span > zoomEpsilon ? 1 + 99 * Math.max(0, Math.min(1, (zoom - fitZoom) / span)) : 100;
  }
  function geometry(width, height) {
    const tile = baseTile(width, height) * zoom;
    // Allow space around the edges so panning also works at full-map zoom.
    // The camera center stays on the map to prevent losing it off screen.
    centerX = Math.max(0, Math.min(Rules.mapWidth(game), centerX));
    centerY = Math.max(0, Math.min(Rules.mapHeight(game), centerY));
    return { tile, ox: width / 2 - centerX * tile, oy: height / 2 - centerY * tile };
  }
  function refresh(box = null) {
    if (!box || typeof box.width !== "number") box = canvas.getBoundingClientRect();
    const maximum = maximumZoom(box.width || 800, box.height || 600);
    if (box.width > 0 && box.height > 0) {
      zoom = Math.min(zoom, maximum);
      mapGeo = geometry(box.width, box.height);
    }
    const label = Math.round(zoomPercent(box.width || 800, box.height || 600)) + "%";
    if (byId("mapZoomLabel").textContent !== label) byId("mapZoomLabel").textContent = label;
    byId("mapZoomOut").disabled = zoom <= minimumZoom;
    byId("mapZoomIn").disabled = zoom >= maximum;
    if (canvas.style.cursor !== "grab") canvas.style.cursor = "grab";
  }
  function setZoom(value, x, y, box = canvas.getBoundingClientRect()) {
    const old = geometry(box.width, box.height);
    x ??= box.width / 2;
    y ??= box.height / 2;
    const cellX = (x - old.ox) / old.tile,
      cellY = (y - old.oy) / old.tile;
    let nextZoom = Math.max(
      minimumZoom,
      Math.min(maximumZoom(box.width || 800, box.height || 600), value),
    );
    // Keep a distinct full-map stop before entering the one-step thumbnail view.
    // The same stops apply to buttons, wheel input and programmatic zoom changes.
    if (zoom < fitZoom - zoomEpsilon && nextZoom > zoom) nextZoom = Math.max(fitZoom, nextZoom);
    else if (nextZoom < fitZoom) {
      nextZoom = zoom > fitZoom + zoomEpsilon ? fitZoom : minimumZoom;
    }
    zoom = nextZoom;
    const tile = baseTile(box.width, box.height) * zoom;
    centerX = cellX - (x - box.width / 2) / tile;
    centerY = cellY - (y - box.height / 2) / tile;
    refresh(box);
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
  function reset(fullMap = false) {
    zoom = fullMap ? fitZoom : 1 / cellScale;
    centerX = Rules.mapWidth(game) / 2;
    centerY = Rules.mapHeight(game) / 2;
    drag = null;
    pinch = null;
    touches.clear();
    pinchConsumed = false;
    suppressClick = false;
    refresh();
  }
  function fit() {
    reset(true);
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
        box,
      );
    },
    { passive: false },
  );
  function touchPair() {
    const [a, b] = [...touches.values()];
    const box = canvas.getBoundingClientRect();
    return {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      x: (a.x + b.x) / 2 - box.left,
      y: (a.y + b.y) / 2 - box.top,
    };
  }
  canvas.addEventListener("pointerdown", (event) => {
    if (pageView !== "game" || window.GamePreview?.active || event.button !== 0) return;
    if (event.pointerType === "touch") {
      if (!touches.size) {
        suppressClick = false;
        pinchConsumed = false;
      }
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      canvas.setPointerCapture(event.pointerId);
      if (touches.size >= 2) {
        event.preventDefault();
        const pair = touchPair(),
          box = canvas.getBoundingClientRect(),
          old = geometry(box.width, box.height);
        pinch = {
          distance: Math.max(1, pair.distance),
          zoom,
          cellX: (pair.x - old.ox) / old.tile,
          cellY: (pair.y - old.oy) / old.tile,
        };
        Deployment.cancelDrag();
        drag = null;
        pinchConsumed = suppressClick = true;
        hover = null;
        return;
      }
    }
    suppressClick = false;
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      centerX,
      centerY,
      tile: mapGeo.tile,
      moved: false,
      unit: phase === "deployment" && Deployment.beginDrag(event),
    };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (touches.has(event.pointerId)) {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch && touches.size >= 2) {
        event.preventDefault();
        const pair = touchPair(),
          box = canvas.getBoundingClientRect();
        setZoom((pinch.zoom * pair.distance) / pinch.distance, pair.x, pair.y, box);
        const tile = baseTile(box.width, box.height) * zoom;
        centerX = pinch.cellX - (pair.x - box.width / 2) / tile;
        centerY = pinch.cellY - (pair.y - box.height / 2) / tile;
        refresh(box);
        return;
      }
      if (pinchConsumed) return;
    }
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 5) drag.moved = true;
    if (!drag.moved) return;
    if (drag.unit) {
      Deployment.moveDrag(event);
      canvas.style.cursor = "grabbing";
      hover = null;
      return;
    }
    centerX = drag.centerX - dx / drag.tile;
    centerY = drag.centerY - dy / drag.tile;
    refresh();
    canvas.style.cursor = "grabbing";
    hover = null;
  });
  function release(event) {
    const touch = touches.delete(event.pointerId);
    if (touch && pinchConsumed) {
      event.preventDefault();
      suppressClick = true;
      if (touches.size < 2) pinch = null;
      Deployment.cancelDrag();
      drag = null;
    } else if (drag?.id === event.pointerId) {
      suppressClick = drag.moved;
      if (drag.unit) {
        if (event.type === "pointercancel" || !drag.moved) Deployment.cancelDrag();
        else Deployment.drop(event);
      }
      drag = null;
    } else if (!touch) return;
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
    get pilotLabels() {
      return zoomPercent() >= 50 - zoomEpsilon;
    },
    get unitThumbnails() {
      return zoom <= minimumZoom + zoomEpsilon;
    },
    get zoomPercent() {
      return zoomPercent();
    },
    setPercent(value) {
      const box = canvas.getBoundingClientRect();
      if (value <= 0) {
        setZoom(minimumZoom, undefined, undefined, box);
        setZoom(minimumZoom, undefined, undefined, box);
      } else
        setZoom(
          fitZoom +
            ((maximumZoom(box.width || 800, box.height || 600) - fitZoom) *
              Math.max(0, Math.min(99, value - 1))) /
              99,
          undefined,
          undefined,
          box,
        );
    },
    pilotLabelsAt: (width, height) => zoomPercent(width, height) >= 50 - zoomEpsilon,
    get maxZoom() {
      return maximumZoom();
    },
    get zoom() {
      return zoom;
    },
  };
})();
