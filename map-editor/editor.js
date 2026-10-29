/* Standalone map authoring. No server or browser storage is required. */
const MapEditor = (() => {
  "use strict";
  const M = MapDocument,
    $ = (id) => document.getElementById(id);
  let doc = M.create(),
    layerId = doc.layers[0].id,
    tileId = doc.tiles[0].id;
  let tool = "brush",
    ruleId = "",
    selectedArea = null,
    stamp = null,
    clipboard = null;
  let history = [],
    future = [],
    drag = null,
    hover = null,
    space = false,
    dirty = false;
  let camera = { x: 20, y: 20, zoom: 1 },
    pendingFrame = false,
    filePurpose = "map",
    atlasStart = null,
    terrainCache = null,
    paintRevision = 0;
  const canvas = $("mapCanvas"),
    viewport = $("viewport"),
    ctx = canvas.getContext("2d");
  const layerCaches = new Map();
  const renderer = TileMapView.create({
    changed: () => {
      paintRevision++;
      drawSoon();
      drawAtlas();
    },
  });
  const activeLayer = () => doc.layers.find((l) => l.id === layerId);
  const activeTile = () => doc.tiles.find((t) => t.id === tileId);
  const activeRule = () => doc.rules.find((r) => r.id === ruleId);
  const number = (id) => Number($(id).value);
  function status(text) {
    $("status").textContent = text;
  }
  function node(tag, text, className) {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (className) e.className = className;
    return e;
  }
  function message(title, text, confirm = null) {
    const dialog = $("editorDialog");
    $("dialogTitle").textContent = title;
    $("dialogMessage").textContent = text;
    const actions = $("dialogActions");
    actions.replaceChildren();
    const close = node("button", confirm ? "取消" : "确认");
    close.onclick = () => dialog.close();
    actions.append(close);
    if (confirm) {
      const ok = node("button", "确认", "primary");
      ok.onclick = () => {
        dialog.close();
        run(confirm);
      };
      actions.append(ok);
    }
    if (!dialog.open) dialog.showModal();
  }
  function run(fn) {
    try {
      const result = fn();
      if (result?.catch) result.catch((e) => message("操作失败", e.message));
    } catch (error) {
      message("操作失败", error.message);
    }
  }
  function checkpoint() {
    history.push(M.snapshot(doc));
    if (history.length > 40) history.shift();
    future = [];
    dirty = true;
  }
  function changed(text = "已修改地图") {
    terrainCache = null;
    paintRevision++;
    renderer.invalidate();
    refresh();
    drawSoon();
    status(text);
  }
  function undo(redo = false) {
    const from = redo ? future : history,
      to = redo ? history : future;
    if (!from.length) return;
    to.push(M.snapshot(doc));
    doc = from.pop();
    if (!doc.layers.some((l) => l.id === layerId)) layerId = doc.layers[0].id;
    if (!doc.tiles.some((t) => t.id === tileId)) tileId = doc.tiles[0].id;
    if (!doc.rules.some((r) => r.id === ruleId)) ruleId = "";
    if (
      clipboard &&
      clipboard.data.some((id) => id !== null && !doc.tiles.some((t) => t.id === id))
    )
      clipboard = null;
    selectedArea = stamp = null;
    dirty = true;
    changed(redo ? "已重做" : "已撤销");
  }
  function chooseTool(next) {
    tool = next;
    document
      .querySelectorAll("[data-tool]")
      .forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
    status(
      {
        spawn: "点击地图设置所选玩家的出生地",
        deployment: "拖动框选所选玩家的部署区域",
        paste: "点击地图粘贴选区",
      }[tool] || "当前工具：" + tool,
    );
  }
  function tab(name) {
    document.querySelectorAll("[data-page]").forEach((e) => (e.hidden = e.dataset.page !== name));
    document
      .querySelectorAll("[data-tab]")
      .forEach((e) => e.classList.toggle("active", e.dataset.tab === name));
    drawAtlas();
  }
  function options(select, list, value) {
    if (
      select.options.length !== list.length ||
      list.some(([id], i) => select.options[i].value !== String(id))
    )
      select.replaceChildren(
        ...list.map(([id, label]) => {
          const o = node("option", label);
          o.value = id;
          return o;
        }),
      );
    else
      list.forEach(([, label], i) => {
        if (select.options[i].textContent !== label) select.options[i].textContent = label;
      });
    select.value = value;
  }
  for (const id of ["defaultTerrain", "tileTerrain"])
    options(
      $(id),
      Object.entries(M.terrains).map(([k, v]) => [k, v.name]),
      "plain",
    );
  function refresh() {
    for (const [id, value] of Object.entries({
      mapId: doc.id,
      mapName: doc.name,
      mapDescription: doc.description,
      mapWidth: doc.width,
      mapHeight: doc.height,
      tileWidth: doc.tileWidth,
      tileHeight: doc.tileHeight,
      mapEnvironment: doc.environment,
      defaultTerrain: doc.defaultTerrain,
      maxTeams: doc.maxTeams,
      playersPerTeam: doc.playersPerTeam,
      randomSeed: doc.seed,
    }))
      $(id).value = value;
    $("modeRegular").checked = doc.supportedModes.includes("regular");
    $("modeQuick").checked = doc.supportedModes.includes("quick");
    $("playerCount").textContent = "共 " + doc.spawns.length + " 名玩家 · " + doc.maxTeams + " 队";
    const seat = Math.min(Number($("spawnSeat").value) || 0, doc.spawns.length - 1);
    options(
      $("spawnSeat"),
      doc.spawns.map((s, i) => [i, "队伍" + (s.team + 1) + " / 玩家" + s.position]),
      String(seat),
    );
    refreshSpawn();
    const selectedSet = doc.tilesets.some((s) => s.id === $("tilesetList").value)
      ? $("tilesetList").value
      : "builtin";
    options(
      $("tilesetList"),
      [["builtin", "地形色块"], ...doc.tilesets.map((s) => [s.id, s.name])],
      selectedSet,
    );
    const visibleTiles = doc.tiles.filter((t) =>
      selectedSet === "builtin" ? !t.tilesetId : t.tilesetId === selectedSet,
    );
    options(
      $("tileList"),
      visibleTiles.map((t) => [t.id, t.name]),
      tileId,
    );
    const tile = activeTile();
    if (tile) {
      $("tileName").value = tile.name;
      $("tileTerrain").value = tile.terrain;
      $("tileEnvironment").value = tile.environment;
      $("tileDecorative").checked = !!tile.decorative;
      $("tileDynamic").checked = !!tile.dynamic;
    }
    const palette = $("terrainPalette");
    palette.replaceChildren();
    palette.hidden = selectedSet !== "builtin";
    for (const t of doc.tiles.filter((t) => !t.tilesetId)) {
      const button = node("button", t.name, t.id === tileId ? "active" : "");
      button.style.setProperty("--swatch", t.color);
      button.dataset.tile = t.id;
      button.onclick = (e) => pickTile(t.id, e.ctrlKey || e.metaKey);
      palette.append(button);
    }
    const list = $("layerList");
    list.replaceChildren();
    for (const l of [...doc.layers].reverse()) {
      const button = node("button", l.name, l.id === layerId ? "active" : "");
      button.dataset.layer = l.id;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(l.id === layerId));
      button.append(
        node(
          "small",
          (l.visible ? "显示" : "隐藏") +
            " · " +
            (l.placement === "above" ? "单位上方" : "单位下方") +
            (l.decorative ? " · 装饰" : ""),
        ),
      );
      button.onclick = () => {
        layerId = l.id;
        selectedArea = null;
        refresh();
        drawSoon();
      };
      list.append(button);
    }
    const l = activeLayer();
    if (l) {
      $("layerName").value = l.name;
      $("layerPlacement").value = l.placement;
      $("layerOpacity").value = l.opacity;
      $("layerVisible").checked = l.visible;
      $("layerDecorative").checked = l.decorative;
      $("layerDynamic").checked = !!l.dynamic;
      $("imageProperties").hidden = l.type !== "image";
      if (l.image)
        for (const key of ["x", "y", "width", "height"])
          $("image" + key[0].toUpperCase() + key.slice(1)).value = l.image[key];
    }
    $("deleteLayer").disabled = doc.layers.length <= 1;
    $("undo").disabled = !history.length;
    $("redo").disabled = !future.length;
    options(
      $("paintRule"),
      [["", "单Tile / 多格画笔"], ...doc.rules.map((r) => [r.id, r.name])],
      ruleId,
    );
    refreshRule();
    drawAtlas();
  }
  function refreshSpawn() {
    const i = Number($("spawnSeat").value) || 0,
      s = doc.spawns[i],
      a = doc.deploymentAreas[i];
    if (!s) return;
    for (const [id, v] of Object.entries({
      spawnX: s.x,
      spawnY: s.y,
      areaX: a.x,
      areaY: a.y,
      areaWidth: a.width,
      areaHeight: a.height,
    }))
      $(id).value = v;
    drawSoon();
  }
  function refreshRule() {
    const rule = activeRule(),
      panel = $("ruleEditor");
    panel.replaceChildren();
    $("ruleName").value = rule?.name || "";
    $("ruleName").disabled = !rule;
    $("deleteRule").disabled = !rule;
    $("addVariant").disabled = rule?.type !== "random";
    if (!rule) return;
    if (rule.type === "random") {
      rule.variants.forEach((v, i) => {
        const row = node("div", undefined, "variant");
        row.append(node("span", doc.tiles.find((t) => t.id === v.tileId)?.name || v.tileId));
        const weight = node("input");
        weight.type = "number";
        weight.min = "0.01";
        weight.step = "0.1";
        weight.value = v.weight;
        weight.setAttribute("aria-label", "候选" + (i + 1) + "权重");
        weight.onchange = () =>
          run(() => {
            if (!(Number(weight.value) > 0)) throw Error("权重必须大于0。");
            checkpoint();
            v.weight = Number(weight.value);
            changed("已更新随机权重");
          });
        const remove = node("button", "×");
        remove.disabled = rule.variants.length === 1;
        remove.onclick = () => {
          checkpoint();
          rule.variants.splice(i, 1);
          changed();
        };
        row.append(weight, remove);
        panel.append(row);
      });
    } else {
      const grid = node("div", undefined, "nine-grid");
      rule.tiles.forEach((id, i) => {
        const button = node(
          "button",
          ["左上", "上", "右上", "左", "中心", "右", "左下", "下", "右下"][i],
        );
        button.title = doc.tiles.find((t) => t.id === id)?.name || id;
        button.style.borderTop =
          "6px solid " + (doc.tiles.find((t) => t.id === id)?.color || "#777");
        button.onclick = () => {
          checkpoint();
          rule.tiles[i] = tileId;
          changed("已将当前Tile绑定到九宫格位置" + (i + 1));
        };
        grid.append(button);
      });
      panel.append(grid);
    }
  }
  function pickTile(id, addRandom = false) {
    tileId = id;
    stamp = null;
    if (addRandom) run(addVariant);
    refresh();
    drawSoon();
    status("已选择：" + activeTile().name);
  }
  function addVariant() {
    const r = activeRule();
    if (!r || r.type !== "random") throw Error("先在“规则”页新建或选择随机规则。");
    if (!r.variants.some((v) => v.tileId === tileId)) {
      checkpoint();
      r.variants.push({ tileId, weight: 1 });
      changed("已添加随机候选");
    }
  }
  function drawAtlas() {
    const canvas = $("atlasCanvas"),
      set = doc.tilesets.find((s) => s.id === $("tilesetList").value);
    canvas.hidden = !set;
    if (!set) return;
    const image = renderer.image(set.image);
    if (!image) return;
    const scale = Math.min(1, 1024 / Math.max(set.width, set.height));
    canvas.width = Math.round(set.width * scale);
    canvas.height = Math.round(set.height * scale);
    const c = canvas.getContext("2d");
    c.imageSmoothingEnabled = false;
    c.drawImage(image, 0, 0, canvas.width, canvas.height);
    c.strokeStyle = "#ffffff40";
    c.lineWidth = 0.5;
    for (const t of doc.tiles.filter((t) => t.tilesetId === set.id)) {
      c.strokeRect(t.x * scale, t.y * scale, set.tileWidth * scale, set.tileHeight * scale);
      if (t.id === tileId) {
        c.strokeStyle = "#ffdf64";
        c.lineWidth = 2;
        c.strokeRect(
          t.x * scale + 1,
          t.y * scale + 1,
          set.tileWidth * scale - 2,
          set.tileHeight * scale - 2,
        );
        c.strokeStyle = "#ffffff40";
        c.lineWidth = 0.5;
      }
    }
  }
  function atlasTile(event) {
    const set = doc.tilesets.find((s) => s.id === $("tilesetList").value);
    if (!set) return null;
    const r = $("atlasCanvas").getBoundingClientRect(),
      x = ((event.clientX - r.left) / r.width) * set.width,
      y = ((event.clientY - r.top) / r.height) * set.height;
    return doc.tiles.find(
      (t) =>
        t.tilesetId === set.id &&
        x >= t.x &&
        y >= t.y &&
        x < t.x + set.tileWidth &&
        y < t.y + set.tileHeight,
    );
  }
  $("atlasCanvas").onpointerdown = (e) => {
    const t = atlasTile(e);
    if (t) {
      atlasStart = t;
      pickTile(t.id, e.ctrlKey || e.metaKey);
      $("atlasCanvas").setPointerCapture(e.pointerId);
    }
  };
  $("atlasCanvas").onpointerup = (e) => {
    const end = atlasTile(e),
      start = atlasStart;
    atlasStart = null;
    if (!e.shiftKey || !start || !end) return;
    const set = doc.tilesets.find((s) => s.id === start.tilesetId),
      left = Math.min(start.x, end.x),
      top = Math.min(start.y, end.y);
    const width = Math.abs(start.x - end.x) / (set.tileWidth + set.spacing) + 1,
      height = Math.abs(start.y - end.y) / (set.tileHeight + set.spacing) + 1;
    stamp = { width, height, data: [] };
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        stamp.data.push(
          doc.tiles.find(
            (t) =>
              t.tilesetId === set.id &&
              t.x === left + x * (set.tileWidth + set.spacing) &&
              t.y === top + y * (set.tileHeight + set.spacing),
          )?.id || null,
        );
    ruleId = "";
    refresh();
    status("多格画笔：" + width + "×" + height);
  };
  function metrics() {
    return { cw: doc.tileWidth * camera.zoom, ch: doc.tileHeight * camera.zoom };
  }
  function cell(e) {
    const r = canvas.getBoundingClientRect(),
      { cw, ch } = metrics();
    return {
      x: Math.floor((e.clientX - r.left - camera.x) / cw),
      y: Math.floor((e.clientY - r.top - camera.y) / ch),
    };
  }
  function drawSoon() {
    if (pendingFrame) return;
    pendingFrame = true;
    requestAnimationFrame(() => {
      pendingFrame = false;
      draw();
    });
  }
  function drawLayers(placement, view) {
    let entry = layerCaches.get(placement);
    if (!entry) {
      entry = { canvas: document.createElement("canvas") };
      layerCaches.set(placement, entry);
    }
    const key = [
      paintRevision,
      view.width,
      view.height,
      view.ox,
      view.oy,
      view.cellWidth,
      view.cellHeight,
    ].join(":");
    if (entry.doc !== doc || entry.key !== key) {
      entry.canvas.width = Math.ceil(view.width);
      entry.canvas.height = Math.ceil(view.height);
      renderer.draw(entry.canvas.getContext("2d"), doc, placement, view);
      entry.key = key;
      entry.doc = doc;
    }
    ctx.drawImage(entry.canvas, 0, 0, view.width, view.height);
  }
  function draw() {
    const box = viewport.getBoundingClientRect(),
      dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(1, box.width),
      h = Math.max(1, box.height);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const { cw, ch } = metrics(),
      ox = camera.x,
      oy = camera.y;
    ctx.fillStyle = doc.environment === "space" ? "#151c2a" : M.terrains[doc.defaultTerrain].color;
    ctx.fillRect(ox, oy, doc.width * cw, doc.height * ch);
    const view = { ox, oy, cellWidth: cw, cellHeight: ch, width: w, height: h };
    drawLayers("below", view);
    if ($("showUnit").checked) {
      const x = ox + (doc.width / 2 + 0.5) * cw,
        y = oy + (doc.height / 2 + 0.5) * ch;
      ctx.fillStyle = "#d9e5f2";
      ctx.fillRect(x - cw * 0.3, y - ch * 0.35, cw * 0.6, ch * 0.7);
      ctx.strokeStyle = "#70c6ff";
      ctx.lineWidth = 3;
      ctx.strokeRect(x - cw * 0.3, y - ch * 0.35, cw * 0.6, ch * 0.7);
    }
    drawLayers("above", view);
    const x0 = Math.max(0, Math.floor(-ox / cw)),
      y0 = Math.max(0, Math.floor(-oy / ch));
    const x1 = Math.min(doc.width, Math.ceil((w - ox) / cw)),
      y1 = Math.min(doc.height, Math.ceil((h - oy) / ch));
    if ($("showTerrain").checked) {
      const map = terrainCache || (terrainCache = M.terrainData(doc));
      ctx.globalAlpha = 0.55;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          ctx.fillStyle = M.terrains[map.tiles[y][x]].color;
          ctx.fillRect(ox + x * cw, oy + y * ch, cw, ch);
        }
      ctx.globalAlpha = 1;
    }
    if ($("showGrid").checked && cw >= 6 && ch >= 6) {
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = "#17253799";
      ctx.beginPath();
      for (let x = x0; x <= x1; x++) {
        ctx.moveTo(ox + x * cw, oy + y0 * ch);
        ctx.lineTo(ox + x * cw, oy + y1 * ch);
      }
      for (let y = y0; y <= y1; y++) {
        ctx.moveTo(ox + x0 * cw, oy + y * ch);
        ctx.lineTo(ox + x1 * cw, oy + y * ch);
      }
      ctx.stroke();
    }
    if ($("showDeployment").checked) {
      const colors = [
        "#69c9ff",
        "#ff8598",
        "#9beb8a",
        "#e8ce6a",
        "#c397ee",
        "#65dece",
        "#f09f63",
        "#e99fe0",
      ];
      for (const [i, area] of doc.deploymentAreas.entries()) {
        const s = doc.spawns[i],
          color = colors[s.team];
        ctx.fillStyle = color + "22";
        ctx.strokeStyle = color;
        ctx.lineWidth = Number($("spawnSeat").value) === i ? 2 : 1;
        ctx.fillRect(ox + area.x * cw, oy + area.y * ch, area.width * cw, area.height * ch);
        ctx.strokeRect(ox + area.x * cw, oy + area.y * ch, area.width * cw, area.height * ch);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(
          ox + (s.x + 0.5) * cw,
          oy + (s.y + 0.5) * ch,
          Math.max(3, Math.min(cw, ch) * 0.25),
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 11px sans-serif";
        ctx.fillText(s.team + 1 + "-" + s.position, ox + s.x * cw, oy + s.y * ch - 2);
      }
    }
    const bounds =
      drag && ["rect", "select", "deployment"].includes(drag.tool)
        ? M.rect(drag.start, drag.last)
        : selectedArea;
    if (bounds) {
      ctx.strokeStyle = "#ffe17b";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(ox + bounds.x * cw, oy + bounds.y * ch, bounds.width * cw, bounds.height * ch);
      ctx.setLineDash([]);
    }
    if (hover && M.inside(doc, hover.x, hover.y)) {
      ctx.strokeStyle = "#e1f3ff";
      ctx.lineWidth = 1;
      ctx.strokeRect(ox + hover.x * cw, oy + hover.y * ch, cw, ch);
    }
    $("zoomValue").textContent = Math.round(camera.zoom * 100) + "%";
  }
  function fit() {
    const r = viewport.getBoundingClientRect();
    camera.zoom = Math.max(
      0.05,
      Math.min(
        (r.width - 40) / (doc.width * doc.tileWidth),
        (r.height - 40) / (doc.height * doc.tileHeight),
        2,
      ),
    );
    camera.x = (r.width - doc.width * doc.tileWidth * camera.zoom) / 2;
    camera.y = (r.height - doc.height * doc.tileHeight * camera.zoom) / 2;
    drawSoon();
  }
  function zoom(factor, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2) {
    const before = camera.zoom,
      next = Math.max(0.05, Math.min(4, before * factor));
    camera.x = x - ((x - camera.x) * next) / before;
    camera.y = y - ((y - camera.y) * next) / before;
    camera.zoom = next;
    drawSoon();
  }
  function paintAt(x, y, erase = false) {
    const l = activeLayer();
    if (!M.inside(doc, x, y) || l?.type !== "tile") return;
    terrainCache = null;
    paintRevision++;
    if (erase) l.data[y * doc.width + x] = null;
    else if (stamp && !ruleId) M.paste(doc, l, stamp, x, y);
    else
      l.data[y * doc.width + x] = M.ruleTile(doc, activeRule(), tileId, x, y, {
        x: x - 1,
        y: y - 1,
        width: 3,
        height: 3,
      });
  }
  canvas.onpointerdown = (e) =>
    run(() => {
      if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
      canvas.focus();
      const p = cell(e),
        current = e.button === 1 || space ? "pan" : e.button === 2 ? "erase" : tool;
      if (current !== "pan" && !M.inside(doc, p.x, p.y)) return;
      if (!["pan", "spawn", "deployment"].includes(current) && activeLayer()?.type !== "tile")
        throw Error("请先选择图块图层；整图图层可在右侧修改位置与尺寸。");
      if (current === "spawn") {
        checkpoint();
        const s = doc.spawns[Number($("spawnSeat").value)];
        s.x = p.x;
        s.y = p.y;
        changed("已设置出生地");
        chooseTool("brush");
        return;
      }
      if (current === "paste") {
        if (clipboard) {
          checkpoint();
          M.paste(doc, activeLayer(), clipboard, p.x, p.y);
          selectedArea = { ...p, width: clipboard.width, height: clipboard.height };
          changed("已粘贴选区");
        }
        chooseTool("select");
        return;
      }
      if (
        current === "select" &&
        selectedArea &&
        p.x >= selectedArea.x &&
        p.x < selectedArea.x + selectedArea.width &&
        p.y >= selectedArea.y &&
        p.y < selectedArea.y + selectedArea.height
      ) {
        drag = {
          tool: "move-selection",
          start: p,
          last: p,
          source: { ...selectedArea },
          block: M.selection(doc, activeLayer(), selectedArea),
        };
      } else
        drag = {
          tool: current,
          start: p,
          last: p,
          screen: { x: e.clientX, y: e.clientY },
          camera: { ...camera },
        };
      canvas.setPointerCapture(e.pointerId);
      if (["brush", "erase", "fill"].includes(current)) {
        checkpoint();
        terrainCache = null;
        paintRevision++;
        if (current === "fill") M.fill(doc, activeLayer(), p.x, p.y, tileId, activeRule());
        else paintAt(p.x, p.y, current === "erase");
        renderer.invalidate();
      }
      drawSoon();
    });
  canvas.onpointermove = (e) => {
    const p = cell(e);
    hover = p;
    $("coordinates").textContent = "X " + p.x + " · Y " + p.y;
    if (drag) {
      p.x = Math.max(0, Math.min(doc.width - 1, p.x));
      p.y = Math.max(0, Math.min(doc.height - 1, p.y));
      if (drag.tool === "pan") {
        camera.x = drag.camera.x + e.clientX - drag.screen.x;
        camera.y = drag.camera.y + e.clientY - drag.screen.y;
      } else if (["brush", "erase"].includes(drag.tool))
        M.line(drag.last, p, (x, y) => paintAt(x, y, drag.tool === "erase"));
      drag.last = p;
    }
    drawSoon();
  };
  canvas.onpointerup = () =>
    run(() => {
      if (!drag) return;
      const d = drag;
      drag = null;
      const bounds = M.rect(d.start, d.last);
      if (["rect", "line", "deployment", "move-selection"].includes(d.tool)) checkpoint();
      if (d.tool === "rect")
        M.paintRect(doc, activeLayer(), bounds, tileId, activeRule(), $("outline").checked);
      if (d.tool === "line") M.line(d.start, d.last, paintAt);
      if (d.tool === "select") selectedArea = bounds;
      if (d.tool === "deployment") {
        doc.deploymentAreas[Number($("spawnSeat").value)] = bounds;
        chooseTool("brush");
      }
      if (d.tool === "move-selection") {
        M.paintRect(doc, activeLayer(), d.source, null);
        const x = Math.max(
            0,
            Math.min(doc.width - d.block.width, d.source.x + d.last.x - d.start.x),
          ),
          y = Math.max(0, Math.min(doc.height - d.block.height, d.source.y + d.last.y - d.start.y));
        M.paste(doc, activeLayer(), d.block, x, y);
        selectedArea = { x, y, width: d.block.width, height: d.block.height };
      }
      if (d.tool !== "pan") changed("操作完成");
      else drawSoon();
    });
  canvas.onpointercancel = () => {
    drag = null;
    drawSoon();
  };
  canvas.oncontextmenu = (e) => e.preventDefault();
  canvas.onwheel = (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
  };
  function deleteSelection(cut = false) {
    const l = activeLayer();
    if (!selectedArea || l?.type !== "tile") return;
    if (cut) clipboard = M.selection(doc, l, selectedArea);
    checkpoint();
    M.paintRect(doc, l, selectedArea, null);
    changed(cut ? "已剪切选区" : "已删除选区");
  }
  function copySelection() {
    if (selectedArea && activeLayer()?.type === "tile") {
      clipboard = M.selection(doc, activeLayer(), selectedArea);
      status("已复制选区；点击粘贴后在地图上选择落点");
    }
  }
  function validate() {
    const issues = M.gameIssues(doc);
    $("validation").replaceChildren(
      ...(issues.length ? issues : ["地图可导出为两队对战地图。"]).map((t) => node("li", t)),
    );
    status(
      issues.length ? "检查发现" + issues.length + "项问题，可保存工程继续编辑" : "地图检查通过",
    );
    return issues;
  }
  function download(value, suffix) {
    const blob = new Blob([JSON.stringify(value)], { type: "application/json" });
    if (blob.size > 64 * 1024 * 1024) throw Error("导出文件超过64MB，请减少或缩小图片后再导出。");
    const url = URL.createObjectURL(blob);
    const a = node("a");
    a.href = url;
    a.download = doc.id + suffix;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    dirty = false;
    status("已导出 " + a.download);
  }
  function replaceMap(value) {
    const next = M.importMap(value);
    const apply = () => {
      doc = next;
      layerId = doc.layers[0].id;
      tileId = doc.tiles[0].id;
      ruleId = "";
      history = [];
      future = [];
      selectedArea = stamp = clipboard = null;
      dirty = false;
      changed("已导入地图");
      fit();
      validate();
    };
    if (dirty) message("导入地图", "当前未导出的修改会被替换，是否继续？", apply);
    else apply();
  }
  function pickFile(purpose) {
    filePurpose = purpose;
    $("fileInput").accept =
      purpose === "map"
        ? ".json,.greed,application/json"
        : "image/png,image/jpeg,image/webp,image/gif";
    $("fileInput").click();
  }
  async function importFile(file, purpose = "map") {
    if (!file) return;
    if (file.size > 64 * 1024 * 1024) throw Error("文件超过64MB，请先缩小图片或图集。");
    if (purpose === "map") {
      replaceMap(JSON.parse((await file.text()).replace(/^\uFEFF/, "")));
      return;
    }
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw Error("支持PNG/JPEG/WebP/GIF图片。");
    if (file.size > 36 * 1024 * 1024) throw Error("单张图片不得超过36MB。");
    const src = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const image = new Image();
    image.src = src;
    await image.decode();
    if (image.naturalWidth > 8192 || image.naturalHeight > 8192)
      throw Error("图片长宽最多8192像素。");
    if (purpose === "atlas") {
      const tw = number("atlasTileWidth"),
        th = number("atlasTileHeight"),
        margin = number("atlasMargin"),
        spacing = number("atlasSpacing");
      if (
        ![tw, th].every((n) => Number.isInteger(n) && n >= 4 && n <= 512) ||
        ![margin, spacing].every((n) => Number.isInteger(n) && n >= 0 && n <= 512)
      )
        throw Error("切片宽高应为4–512的整数，间距/边距为0–512。");
      const count =
        Math.floor((image.naturalWidth - margin * 2 + spacing) / (tw + spacing)) *
        Math.floor((image.naturalHeight - margin * 2 + spacing) / (th + spacing));
      if (count <= 0 || count + doc.tiles.length > 16384)
        throw Error("切片尺寸超出图片，或Tile总数超过16384。");
      checkpoint();
      const id = M.addTileset(doc, {
        name: file.name,
        image: src,
        width: image.naturalWidth,
        height: image.naturalHeight,
        tileWidth: tw,
        tileHeight: th,
        margin,
        spacing,
      });
      refresh();
      $("tilesetList").value = id;
      tileId = doc.tiles.find((t) => t.tilesetId === id).id;
      tab("tiles");
    } else {
      if (doc.layers.length >= 32) throw Error("最多32个图层。");
      checkpoint();
      const l = {
        id: M.uid("image"),
        name: file.name,
        type: "image",
        placement: "below",
        decorative: true,
        dynamic: false,
        visible: true,
        opacity: 1,
        image: { src, x: 0, y: 0, width: doc.width, height: doc.height },
      };
      doc.layers.push(l);
      layerId = l.id;
    }
    changed("图片已嵌入工程，可随地图导出");
  }
  $("fileInput").onchange = (e) => {
    run(() => importFile(e.target.files[0], filePurpose));
    e.target.value = "";
  };
  document.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => tab(b.dataset.tab)));
  document
    .querySelectorAll("[data-tool]")
    .forEach((b) => (b.onclick = () => chooseTool(b.dataset.tool)));
  $("newMap").onclick = () =>
    message("新建地图", "新建会清空当前地图。请先导出需要保留的修改。", () => {
      dirty = false;
      replaceMap(M.create());
    });
  $("importMap").onclick = () => pickFile("map");
  $("addAtlas").onclick = () => pickFile("atlas");
  $("addImage").onclick = () => pickFile("image");
  $("exportProject").onclick = () =>
    run(() => {
      M.validate(doc);
      download(doc, ".pgmap.json");
    });
  $("exportGame").onclick = () =>
    run(() => {
      const issues = validate();
      if (issues.length) throw Error(issues.join("\n"));
      download(M.compile(doc), ".json");
    });
  $("validateMap").onclick = validate;
  $("help").onclick = () =>
    message(
      "地图编辑器",
      "1. 在地图页设置大小、Tile尺寸、队伍、出生地和部署区。\n2. 图块页可导入图集；也可导入整张图片作为装饰地图。\n3. 选择图层，用画笔、油漆桶、方框或直线绘制。图层和Tile的地形属性独立于视觉层级。透明度为0的非装饰层仍提供地形。\n4. 选择工具框选后，可拖动选区，或复制/剪切后粘贴。空格/中键平移，滚轮缩放。\n5. 随机规则支持权重，九宫格使用矩形工具。\n6. 导出工程可继续编辑；导出游戏地图先检查两队兼容性。\n7. 将游戏地图注册到项目：npm run maps:import -- 文件路径，再构建客户端并重启服务器。\n8. 当前游戏支持2队；3–8队配置、动态Tile均保留在工程中供后续功能使用。",
    );
  $("resizeMap").onclick = () =>
    run(() => {
      const next = M.snapshot(doc);
      M.resize(next, number("mapWidth"), number("mapHeight"));
      checkpoint();
      doc = next;
      selectedArea = null;
      changed("地图尺寸已更新，超出新边界的Tile已裁切");
      fit();
    });
  $("applyPlayers").onclick = () =>
    message("重设玩家配置", "将重新生成出生地及部署区，保留图块和图层。", () => {
      const next = M.snapshot(doc);
      M.setPlayers(next, number("maxTeams"), number("playersPerTeam"));
      checkpoint();
      doc = next;
      changed("已生成玩家席位与部署区");
      validate();
    });
  $("spawnSeat").onchange = refreshSpawn;
  $("placeSpawn").onclick = () => chooseTool("spawn");
  $("drawDeployment").onclick = () => chooseTool("deployment");
  $("tilesetList").onchange = () => {
    tileId =
      doc.tiles.find((t) =>
        $("tilesetList").value === "builtin"
          ? !t.tilesetId
          : t.tilesetId === $("tilesetList").value,
      )?.id || tileId;
    stamp = null;
    refresh();
  };
  $("tileList").onchange = () => pickTile($("tileList").value);
  $("paintRule").onchange = () => {
    ruleId = $("paintRule").value;
    stamp = null;
    refreshRule();
  };
  $("newRandom").onclick = () => {
    checkpoint();
    const r = {
      id: M.uid("random"),
      name: "随机规则 " + (doc.rules.length + 1),
      type: "random",
      variants: [{ tileId, weight: 1 }],
    };
    doc.rules.push(r);
    ruleId = r.id;
    changed();
  };
  $("newNine").onclick = () => {
    checkpoint();
    const t = activeTile(),
      set = doc.tilesets.find((s) => s.id === t.tilesetId);
    const tiles = Array.from({ length: 9 }, (_, i) =>
      set
        ? doc.tiles.find(
            (other) =>
              other.tilesetId === set.id &&
              other.x === t.x + (i % 3) * (set.tileWidth + set.spacing) &&
              other.y === t.y + Math.floor(i / 3) * (set.tileHeight + set.spacing),
          )?.id || tileId
        : tileId,
    );
    const r = { id: M.uid("nine"), name: "九宫格 " + (doc.rules.length + 1), type: "nine", tiles };
    doc.rules.push(r);
    ruleId = r.id;
    chooseTool("rect");
    changed();
  };
  $("addVariant").onclick = () => run(addVariant);
  $("deleteRule").onclick = () => {
    if (ruleId) {
      checkpoint();
      doc.rules = doc.rules.filter((r) => r.id !== ruleId);
      ruleId = "";
      changed();
    }
  };
  $("addLayer").onclick = () =>
    run(() => {
      if (doc.layers.length >= 32) throw Error("最多32个图层。");
      checkpoint();
      const l = M.layer(doc, "图层 " + (doc.layers.length + 1));
      doc.layers.push(l);
      layerId = l.id;
      changed();
    });
  $("deleteLayer").onclick = () =>
    message("删除图层", "删除当前图层及其中的内容？可以撤销。", () => {
      if (doc.layers.length <= 1) return;
      checkpoint();
      doc.layers = doc.layers.filter((l) => l.id !== layerId);
      layerId = doc.layers.at(-1).id;
      selectedArea = null;
      changed();
    });
  function moveLayer(delta) {
    const i = doc.layers.findIndex((l) => l.id === layerId),
      j = i + delta;
    if (j < 0 || j >= doc.layers.length) return;
    checkpoint();
    [doc.layers[i], doc.layers[j]] = [doc.layers[j], doc.layers[i]];
    changed();
  }
  $("layerUp").onclick = () => moveLayer(1);
  $("layerDown").onclick = () => moveLayer(-1);
  function bind(id, target, key, convert = (e) => e.value) {
    $(id).onchange = () =>
      run(() => {
        const object = target();
        if (!object) return;
        const next = convert($(id));
        checkpoint();
        object[key] = next;
        changed();
      });
  }
  bind("mapId", () => doc, "id");
  bind("mapName", () => doc, "name");
  bind("mapDescription", () => doc, "description");
  bind("mapEnvironment", () => doc, "environment");
  bind("defaultTerrain", () => doc, "defaultTerrain");
  for (const id of ["tileWidth", "tileHeight"])
    bind(
      id,
      () => doc,
      id,
      (e) => {
        const n = Number(e.value);
        if (!Number.isInteger(n) || n < 4 || n > 512) throw Error("Tile尺寸应为4–512的整数。");
        return n;
      },
    );
  bind(
    "randomSeed",
    () => doc,
    "seed",
    (e) => {
      const n = Number(e.value);
      if (!Number.isSafeInteger(n)) throw Error("种子必须为整数。");
      return n;
    },
  );
  for (const [id, key] of [
    ["tileName", "name"],
    ["tileTerrain", "terrain"],
    ["tileEnvironment", "environment"],
  ])
    bind(id, activeTile, key);
  for (const [id, key] of [
    ["tileDecorative", "decorative"],
    ["tileDynamic", "dynamic"],
  ])
    bind(id, activeTile, key, (e) => e.checked);
  for (const [id, key] of [
    ["layerName", "name"],
    ["layerPlacement", "placement"],
  ])
    bind(id, activeLayer, key);
  bind("layerOpacity", activeLayer, "opacity", (e) => Number(e.value));
  for (const [id, key] of [
    ["layerVisible", "visible"],
    ["layerDecorative", "decorative"],
    ["layerDynamic", "dynamic"],
  ])
    bind(id, activeLayer, key, (e) => e.checked);
  bind("ruleName", activeRule, "name");
  for (const [id, key] of [
    ["spawnX", "x"],
    ["spawnY", "y"],
  ])
    bind(
      id,
      () => doc.spawns[Number($("spawnSeat").value)],
      key,
      (e) => {
        const n = Number(e.value),
          max = key === "x" ? doc.width : doc.height;
        if (!Number.isInteger(n) || n < 0 || n >= max) throw Error("出生地坐标超出地图。");
        return n;
      },
    );
  for (const [id, key] of [
    ["areaX", "x"],
    ["areaY", "y"],
    ["areaWidth", "width"],
    ["areaHeight", "height"],
  ])
    bind(
      id,
      () => doc.deploymentAreas[Number($("spawnSeat").value)],
      key,
      (e) => {
        const n = Number(e.value);
        if (!Number.isInteger(n) || n < (key === "x" || key === "y" ? 0 : 1))
          throw Error("区域必须使用有效整数。");
        return n;
      },
    );
  for (const key of ["x", "y", "width", "height"])
    bind(
      "image" + key[0].toUpperCase() + key.slice(1),
      () => activeLayer()?.image,
      key,
      (e) => {
        const n = Number(e.value);
        if (!Number.isFinite(n) || (["width", "height"].includes(key) && n <= 0))
          throw Error("图片尺寸或位置无效。");
        return n;
      },
    );
  for (const id of ["modeRegular", "modeQuick"])
    $(id).onchange = () => {
      checkpoint();
      doc.supportedModes = [
        $("modeRegular").checked && "regular",
        $("modeQuick").checked && "quick",
      ].filter(Boolean);
      changed();
    };
  $("undo").onclick = () => undo();
  $("redo").onclick = () => undo(true);
  $("copy").onclick = copySelection;
  $("cut").onclick = () => deleteSelection(true);
  $("deleteSelection").onclick = () => deleteSelection();
  $("paste").onclick = () => {
    if (clipboard) chooseTool("paste");
    else status("请先选择并复制一片区域");
  };
  $("fit").onclick = fit;
  $("zoomIn").onclick = () => zoom(1.2);
  $("zoomOut").onclick = () => zoom(1 / 1.2);
  for (const id of ["showGrid", "showTerrain", "showDeployment", "showUnit"])
    $(id).onchange = drawSoon;
  window.addEventListener("keydown", (e) => {
    if ($("editorDialog").open || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const cmd = e.ctrlKey || e.metaKey,
      key = e.key.toLowerCase();
    if (e.code === "Space") {
      space = true;
      e.preventDefault();
      return;
    }
    if (cmd && ["z", "y", "c", "x", "v", "s"].includes(key)) {
      e.preventDefault();
      run(() => {
        if (key === "z") undo(e.shiftKey);
        if (key === "y") undo(true);
        if (key === "c") copySelection();
        if (key === "x") deleteSelection(true);
        if (key === "v" && clipboard) chooseTool("paste");
        if (key === "s") $("exportProject").click();
      });
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      deleteSelection();
    }
    if (e.key === "Escape") {
      selectedArea = null;
      chooseTool("brush");
      drawSoon();
    }
    const tools = { b: "brush", e: "erase", f: "fill", r: "rect", l: "line", m: "select" };
    if (!cmd && tools[key]) chooseTool(tools[key]);
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") space = false;
  });
  window.addEventListener("blur", () => {
    space = false;
    drag = null;
  });
  viewport.ondragover = (e) => {
    e.preventDefault();
    $("dropHint").hidden = false;
  };
  viewport.ondragleave = (e) => {
    if (!viewport.contains(e.relatedTarget)) $("dropHint").hidden = true;
  };
  viewport.ondrop = (e) => {
    e.preventDefault();
    $("dropHint").hidden = true;
    const file = e.dataTransfer.files[0];
    if (file) run(() => importFile(file, file.type.startsWith("image/") ? "image" : "map"));
  };
  new ResizeObserver(drawSoon).observe(viewport);
  refresh();
  requestAnimationFrame(fit);
  return {
    get document() {
      return doc;
    },
    get selection() {
      return selectedArea;
    },
    get camera() {
      return { ...camera };
    },
    importMap: replaceMap,
    importFile,
    exportMap: () => M.compile(doc),
    validate,
    draw,
    fit,
    chooseTool,
    tab,
    get activeLayer() {
      return activeLayer();
    },
    get activeTile() {
      return activeTile();
    },
  };
})();
