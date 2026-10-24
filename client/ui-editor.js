/* 开发者版入口。阅读顺序：界面 → 预览 → 属性与历史 → 选择与拖动 → 文件。
 * 所有游戏点击都留在独立 iframe 内拦截，实际对局状态不参与编辑。
 */
(() => {
  "use strict";
  const U = window.UILayout;
  const storageKey = "slg-ui-layout-dev-v1";
  const byId = (id) => document.getElementById(id);
  const clone = (value) => structuredClone(value);
  let layout = U.get();
  let selected = "battleStage";
  let active = false;
  let previewWindow = null;
  let zoom = 1;
  let gesture = null;
  const history = [],
    future = [];
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) layout = U.validate(JSON.parse(saved));
  } catch (error) {
    console.warn("未读取本地布局：", error.message);
  }
  U.apply(layout);

  // 工具栏模板与样式单独保存，便于修改中文文案和 CSS。
  const launcher = document.createElement("button");
  launcher.id = "ui-dev-launch";
  launcher.dataset.developerOnly = "";
  launcher.textContent = "开发者 · UI布局";
  document.body.append(launcher);
  const panel = document.createElement("section");
  panel.id = "ui-editor-panel";
  panel.dataset.developerOnly = "";
  panel.hidden = true;
  panel.setAttribute("aria-label", "UI布局编辑器");
  panel.innerHTML = byId("ui-editor-template").innerHTML;
  document.body.append(panel);
  const area = document.createElement("div");
  area.id = "ui-preview-area";
  area.dataset.developerOnly = "";
  area.hidden = true;
  area.innerHTML =
    '<span id="ui-preview-title">独立预览 · 正在载入</span><div id="ui-preview-space"><iframe id="ui-preview-frame" title="独立游戏预览"></iframe></div>';
  document.body.append(area);
  const iframe = byId("ui-preview-frame");
  const selectionFrame = document.createElement("div");
  selectionFrame.id = "ui-selection";
  selectionFrame.dataset.developerOnly = "";
  selectionFrame.hidden = true;
  selectionFrame.innerHTML =
    '<span id="ui-selection-label"></span><span id="ui-resize" title="拉伸选中元素"></span>';
  document.body.append(selectionFrame);

  const fieldNames = {
    x: "X 偏移 px",
    y: "Y 偏移 px",
    width: "宽度 px",
    height: "高度 px",
    fontSize: "字号 px",
    padding: "内边距 px",
    gap: "间距 px",
    opacity: "不透明度",
    borderRadius: "圆角 px",
    borderWidth: "边框 px",
    zIndex: "层级",
    gridColumns: "等宽网格列数",
    color: "文字颜色",
    background: "背景颜色",
  };
  const battleNames = {
    scale: "整体机体倍率",
    leftX: "左机体 X 比例",
    leftY: "左机体 Y 比例",
    rightX: "右机体 X 比例",
    rightY: "右机体 Y 比例",
    leftScale: "左机体倍率",
    rightScale: "右机体倍率",
    meleeTravel: "近战前冲比例",
    shake: "受击抖动 px",
    shadowScale: "阴影倍率",
    projectileScale: "弹道倍率",
    impactScale: "命中特效倍率",
    damageSize: "伤害字号倍率",
    damageX: "伤害 X 比例偏移",
    damageY: "伤害 Y 比例偏移",
    mapScale: "地图机体倍率",
    mapLabelSize: "地图名称倍率",
    mapBarScale: "地图血条宽倍率",
  };
  const anchorNames = {
    flow: "跟随原布局（偏移）",
    "top-left": "屏幕左上",
    "top-right": "屏幕右上",
    "bottom-left": "屏幕左下",
    "bottom-right": "屏幕右下",
    center: "屏幕中心",
    "parent-top-left": "父容器左上",
    "parent-top-right": "父容器右上",
    "parent-bottom-left": "父容器左下",
    "parent-bottom-right": "父容器右下",
    "parent-center": "父容器中心",
  };
  for (const [id, model] of Object.entries(UnitModels))
    battleNames[id] = model.code + " · " + model.kitName + " 倍率";
  for (const anchor of U.anchors) byId("uie-anchor").add(new Option(anchorNames[anchor], anchor));
  for (const [key, label] of Object.entries(fieldNames))
    addField("uie-fields", key, label, U.fields[key], false);
  for (const [key, label] of Object.entries(battleNames))
    addField("uie-battle-fields", key, label, U.battleFields[key], true);
  for (const [id, model] of Object.entries(UnitModels)) {
    byId("uie-left").add(new Option(model.name + " · " + model.kitName, id));
    byId("uie-right").add(new Option(model.name + " · " + model.kitName, id));
  }
  byId("uie-right").value = Object.keys(UnitModels)[1] || Object.keys(UnitModels)[0];
  refreshWeapons();

  function addField(container, key, label, range, battle) {
    const wrapper = document.createElement("label");
    wrapper.textContent = label;
    const input = document.createElement("input");
    input.id = (battle ? "uie-b-" : "uie-") + key;
    input.type = ["color", "background"].includes(key) ? "color" : "number";
    if (range) {
      input.min = range[0];
      input.max = range[1];
      input.step = battle || key === "opacity" ? "0.01" : "1";
    }
    wrapper.append(input);
    byId(container).append(wrapper);
    input.onchange = () =>
      change(() => {
        const entries = layout.profiles[profile()];
        const id = battle ? "$battle" : selected;
        entries[id] ||= {};
        if (input.value === "") delete entries[id][key];
        else entries[id][key] = input.type === "color" ? input.value : Number(input.value);
      });
  }

  // 预览的实际 viewport 决定响应式分组，缩放只影响编辑器显示大小。
  function profile() {
    return previewWindow?.UILayout.profile() || "desktop";
  }
  function status(message) {
    byId("uie-status").textContent = message;
  }
  function actorSide() {
    return selected.startsWith("actor-") ? selected.slice(6) : null;
  }
  function target() {
    return U.targets.find((item) => item.id === selected);
  }
  function visible(element) {
    return !!element?.getClientRects().length;
  }
  function selectedElement() {
    return (
      target() && [...previewWindow.document.querySelectorAll(target().selector)].find(visible)
    );
  }
  function apply() {
    U.apply(layout);
    previewWindow?.UILayout.apply(layout);
    sync();
  }
  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(layout));
      status("已自动保存到本浏览器；工程发布请导出 JSON 后构建。");
    } catch {
      status("浏览器无法保存，请导出 JSON。");
    }
  }
  function commit(before) {
    if (JSON.stringify(before) === JSON.stringify(layout)) return;
    history.push(before);
    if (history.length > 80) history.shift();
    future.length = 0;
    persist();
    sync();
  }
  function change(mutate) {
    const before = clone(layout);
    try {
      mutate();
      layout = U.validate(layout);
      apply();
      commit(before);
    } catch (error) {
      layout = before;
      apply();
      status(error.message);
    }
  }

  function refreshWeapons() {
    const old = byId("uie-weapon").value;
    byId("uie-weapon").replaceChildren(
      ...UnitModels[byId("uie-left").value].weapons.map(
        (weapon) => new Option(weapon.name, weapon.id),
      ),
    );
    if (UnitModels[byId("uie-left").value].weapons.some((weapon) => weapon.id === old))
      byId("uie-weapon").value = old;
  }
  function configurePreview() {
    previewWindow?.GamePreview.configure({
      scene: byId("uie-scene").value,
      leftModel: byId("uie-left").value,
      rightModel: byId("uie-right").value,
      weapon: byId("uie-weapon").value,
      response: byId("uie-response").value,
      result: byId("uie-result").value,
      unitState: byId("uie-unit-state").value,
      connection: byId("uie-connection").value,
    });
    refreshTree();
    sync();
  }
  function resizePreview() {
    endGesture();
    const width = Math.max(320, Math.min(2560, Number(byId("uie-view-width").value) || 1440));
    const height = Math.max(320, Math.min(1600, Number(byId("uie-view-height").value) || 900));
    byId("uie-view-width").value = width;
    byId("uie-view-height").value = height;
    iframe.style.width = width + "px";
    iframe.style.height = height + "px";
    zoom = Math.min(
      1,
      Math.max(0.1, (innerWidth - 344) / width),
      Math.max(0.1, (innerHeight - 56) / height),
    );
    iframe.style.transform = `scale(${zoom})`;
    byId("ui-preview-space").style.width = width * zoom + "px";
    byId("ui-preview-space").style.height = height * zoom + "px";
    requestAnimationFrame(() => {
      sync();
      refreshTree();
    });
  }
  function openPreview() {
    if (iframe.srcdoc) return;
    iframe.onload = () => {
      previewWindow = iframe.contentWindow;
      previewWindow.GamePreview.suspended = !active;
      previewWindow.UILayout.apply(layout);
      configurePreview();
      const doc = previewWindow.document;
      doc.addEventListener("pointerdown", pointerDown, true);
      doc.addEventListener("pointermove", pointerMove, true);
      doc.addEventListener("pointerup", endGesture, true);
      doc.addEventListener("pointercancel", endGesture, true);
      doc.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopImmediatePropagation();
        },
        true,
      );
      doc.addEventListener("keydown", keyboard, true);
      // 使用一次性的就绪事件，避免定时刷新打断正在输入的属性值。
      previewWindow.addEventListener(
        "ui-preview-ready",
        () => {
          refreshTree();
          sync();
        },
        { once: true },
      );
    };
    const base = JSON.parse(byId("ui-release-template").textContent);
    const source = JSON.parse(byId("ui-preview-source").textContent);
    // 标记必须早于游戏脚本执行，防止继承的 sessionStorage 自动恢复真实玩家席位。
    const previewHTML = base.replace(
      "<head>",
      "<head><script>window.isLayoutPreview=true;</script>",
    );
    iframe.srcdoc = previewHTML.replace("</body>", `<script>${source}</script></body>`);
  }
  function toggle() {
    active = !active;
    panel.hidden = area.hidden = !active;
    launcher.hidden = active;
    if (active) {
      if (previewWindow) previewWindow.GamePreview.suspended = false;
      openPreview();
      resizePreview();
    } else {
      endGesture();
      selectionFrame.hidden = true;
      if (previewWindow) {
        previewWindow.GamePreview.playing = false;
        previewWindow.GamePreview.suspended = true;
        previewWindow.GamePreview.stopAudio();
      }
      byId("uie-play").textContent = "播放";
    }
  }

  // 元素树同时列出静态节点和可复用的同类样式。静态节点按真实父子深度缩进。
  function refreshTree() {
    if (!previewWindow) return;
    const search = byId("uie-search").value.toLowerCase();
    const doc = previewWindow.document;
    const options = [];
    const scene = byId("uie-scene").value;
    const sceneRoot =
      { rooms: "start", formation: "formationScreen", deployment: "map" }[scene] || scene;
    for (const item of U.targets) {
      const elements = [...doc.querySelectorAll(item.selector)];
      const shown = elements.some(visible);
      if (!byId("uie-all").checked && item.id !== selected) {
        const belongsToScene = elements.some(
          (element) => (element.closest(".overlay,.menu-screen")?.id || "map") === sceneRoot,
        );
        if (!shown || !belongsToScene) continue;
      }
      if (search && !`${item.name} ${item.id} ${item.selector}`.toLowerCase().includes(search))
        continue;
      const element = elements.find(visible) || elements[0];
      let depth = 0;
      for (
        let parent = element?.parentElement;
        parent && parent !== doc.body;
        parent = parent.parentElement
      )
        depth++;
      options.push(
        new Option(
          `${"　".repeat(Math.min(depth, 5))}${item.name}${shown ? "" : "（未显示）"}`,
          item.id,
        ),
      );
    }
    if (byId("uie-scene").value === "battle") {
      options.unshift(
        new Option("画布 / 左方机体", "actor-left"),
        new Option("画布 / 右方机体", "actor-right"),
      );
    }
    byId("uie-target").replaceChildren(...options);
    byId("uie-target").value = selected;
  }
  function sync() {
    const group = profile();
    byId("uie-viewport").textContent =
      `${byId("uie-view-width").value} × ${byId("uie-view-height").value} · ${group} · 显示缩放 ${Math.round(zoom * 100)}%`;
    byId("ui-preview-title").textContent =
      "独立预览 · " + byId("uie-scene").selectedOptions[0].textContent;
    byId("uie-target").value = selected;
    const side = actorSide();
    byId("uie-anchor-label").hidden = byId("uie-hidden-label").hidden = !!side;
    byId("uie-fields").hidden = !!side;
    byId("uie-clear-color").hidden = !!side;
    byId("uie-selected-note").textContent = side
      ? `${side === "left" ? "左" : "右"}机体：拖动改站位，拉伸改倍率。其余参数在下方“战斗与地图画布参数”。`
      : target()?.selector || "请选择元素";
    const props = layout.profiles[group][selected] || {};
    byId("uie-anchor").value = props.anchor || "flow";
    byId("uie-hidden").checked = !!props.hidden;
    for (const key of Object.keys(fieldNames)) {
      const input = byId("uie-" + key);
      input.value = props[key] ?? (input.type === "color" ? "#ffffff" : "");
      input.placeholder = "沿用原布局";
    }
    const settings = {
      ...BattleScene.defaults,
      ...layout.profiles[group].$battle,
    };
    for (const key of Object.keys(battleNames)) byId("uie-b-" + key).value = settings[key];
    byId("uie-undo").disabled = !history.length;
    byId("uie-redo").disabled = !future.length;
  }

  function select(id) {
    selected = id;
    sync();
  }
  function pick(element) {
    for (
      let node = element;
      node && node !== previewWindow.document.body;
      node = node.parentElement
    ) {
      const item = U.targets.find((item) => node.matches(item.selector));
      if (item) return { id: item.id, element: node };
    }
    return null;
  }
  function point(event) {
    const rect = iframe.getBoundingClientRect();
    return event.view === previewWindow
      ? { x: event.clientX, y: event.clientY }
      : {
          x: (event.clientX - rect.left) / zoom,
          y: (event.clientY - rect.top) / zoom,
        };
  }
  function actorBounds(side) {
    const box = previewWindow?.GamePreview.boxes.find((item) => item.id === side);
    if (!box) return null;
    const canvas = previewWindow.document.getElementById("battleCanvas").getBoundingClientRect();
    return {
      left: canvas.left + box.x - box.width / 2,
      top: canvas.top + box.y - box.height / 2,
      width: box.width,
      height: box.height,
    };
  }
  function pointerDown(event) {
    if (!active || !previewWindow) return;
    const resize = event.target.id === "ui-resize";
    const p = point(event);
    let id = resize ? selected : null;
    if (!resize) {
      if (previewWindow.GamePreview.scene === "battle" && event.target.id === "battleCanvas") {
        for (const side of ["right", "left"]) {
          const box = actorBounds(side);
          if (
            box &&
            p.x >= box.left &&
            p.x <= box.left + box.width &&
            p.y >= box.top &&
            p.y <= box.top + box.height
          ) {
            id = "actor-" + side;
            break;
          }
        }
      }
      id ||= pick(event.target)?.id;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!id) return;
    select(id);
    const side = actorSide();
    const rect = side ? actorBounds(side) : selectedElement()?.getBoundingClientRect();
    if (!rect) return;
    const props = layout.profiles[profile()][selected] || {};
    gesture = {
      before: clone(layout),
      profile: profile(),
      id,
      side,
      resize,
      start: p,
      rect,
      x: props.x || 0,
      y: props.y || 0,
    };
    // 拖动机体时冻结演出，选框保持稳定；松手后由用户继续播放。
    if (side) {
      previewWindow.GamePreview.playing = false;
      byId("uie-play").textContent = "播放";
    }
  }
  function pointerMove(event) {
    if (!active) return;
    if (event.view === previewWindow) event.stopImmediatePropagation();
    if (!gesture) return;
    event.preventDefault();
    const current = point(event),
      g = gesture;
    const dx = current.x - g.start.x,
      dy = current.y - g.start.y;
    const entries = layout.profiles[g.profile];
    if (g.side) {
      entries.$battle ||= {};
      const base = {
        ...BattleScene.defaults,
        ...g.before.profiles[g.profile].$battle,
      };
      const canvas = previewWindow.document.getElementById("battleCanvas").getBoundingClientRect();
      if (g.resize)
        entries.$battle[g.side + "Scale"] = clamp(
          base[g.side + "Scale"] * (1 + Math.max(dx, dy) / g.rect.width),
          0.1,
          4,
        );
      else {
        entries.$battle[g.side + "X"] = clamp(base[g.side + "X"] + dx / canvas.width, 0, 1);
        entries.$battle[g.side + "Y"] = clamp(base[g.side + "Y"] + dy / canvas.height, 0, 1);
      }
    } else {
      entries[g.id] ||= {};
      if (g.resize) {
        entries[g.id].width = clamp(Math.round(g.rect.width + dx), 1, 4096);
        entries[g.id].height = clamp(Math.round(g.rect.height + dy), 1, 4096);
      } else {
        entries[g.id].x = clamp(Math.round(g.x + dx), -4096, 4096);
        entries[g.id].y = clamp(Math.round(g.y + dy), -4096, 4096);
      }
    }
    U.apply(layout);
    previewWindow.UILayout.apply(layout);
  }
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  function endGesture() {
    if (!gesture) return;
    const before = gesture.before;
    gesture = null;
    commit(before);
    sync();
  }
  function keyboard(event) {
    if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    if ((event.shiftKey && event.code === "KeyU") || (active && event.code === "Escape")) {
      event.preventDefault();
      toggle();
      return;
    }
    if (active && (event.ctrlKey || event.metaKey) && event.code === "KeyZ") {
      event.preventDefault();
      (event.shiftKey ? byId("uie-redo") : byId("uie-undo")).click();
    }
    if (active && event.view === previewWindow) event.stopImmediatePropagation();
  }

  launcher.onclick = byId("uie-close").onclick = toggle;
  byId("uie-scene").onchange = () => {
    endGesture();
    configurePreview();
    select(
      {
        start: "startModal",
        serverConnect: "serverModal",
        rooms: "roomList",
        roomPreparation: "preparationModal",
        formation: "formationModal",
        deployment: "deploymentPanel",
        leaveConfirm: "leaveModal",
        map: "map",
        reaction: "reactionModal",
        battle: "battleStage",
        help: "helpModal",
        victory: "victoryModal",
      }[byId("uie-scene").value],
    );
    refreshTree();
  };
  byId("uie-size").onchange = () => {
    const [width, height] = byId("uie-size").value.split(",");
    byId("uie-view-width").value = width;
    byId("uie-view-height").value = height;
    resizePreview();
  };
  byId("uie-view-width").onchange = byId("uie-view-height").onchange = resizePreview;
  for (const id of ["right", "weapon", "response", "result", "unit-state", "connection"])
    byId("uie-" + id).onchange = configurePreview;
  byId("uie-left").onchange = () => {
    refreshWeapons();
    configurePreview();
  };
  byId("uie-play").onclick = () => {
    const p = previewWindow.GamePreview;
    p.unlockAudio();
    p.playing = !p.playing;
    byId("uie-play").textContent = p.playing ? "暂停" : "播放";
  };
  byId("uie-replay").onclick = () => {
    const p = previewWindow.GamePreview;
    p.stopAudio();
    p.unlockAudio();
    p.progress = 0;
    p.playing = true;
    byId("uie-play").textContent = "暂停";
  };
  byId("uie-progress").oninput = () => {
    const p = previewWindow.GamePreview;
    p.playing = false;
    p.progress = Number(byId("uie-progress").value);
    byId("uie-play").textContent = "播放";
  };
  for (const side of ["left", "right"])
    byId("uie-" + side + "-actor").onclick = () => {
      byId("uie-scene").value = "battle";
      configurePreview();
      select("actor-" + side);
      refreshTree();
    };
  byId("uie-target").onchange = () => select(byId("uie-target").value);
  byId("uie-search").oninput = byId("uie-all").onchange = refreshTree;
  byId("uie-parent").onclick = () => {
    const parent = selectedElement()?.parentElement;
    const hit = parent && pick(parent);
    if (hit) select(hit.id);
  };
  byId("uie-anchor").onchange = () =>
    change(() => {
      const p = layout.profiles[profile()];
      p[selected] ||= {};
      Object.assign(p[selected], { anchor: byId("uie-anchor").value, x: 0, y: 0 });
    });
  byId("uie-hidden").onchange = () =>
    change(() => {
      const p = layout.profiles[profile()];
      p[selected] ||= {};
      p[selected].hidden = byId("uie-hidden").checked;
    });
  byId("uie-clear-color").onclick = () =>
    change(() => {
      const p = layout.profiles[profile()][selected];
      if (p) {
        delete p.color;
        delete p.background;
      }
    });
  byId("uie-reset").onclick = () =>
    change(() => {
      const entries = layout.profiles[profile()];
      const side = actorSide();
      if (side && entries.$battle) {
        for (const key of ["X", "Y", "Scale"]) delete entries.$battle[side + key];
      } else delete entries[selected];
    });
  byId("uie-reset-profile").onclick = () =>
    change(() => {
      layout.profiles[profile()] = {};
    });
  byId("uie-undo").onclick = () => {
    if (history.length) {
      future.push(clone(layout));
      layout = history.pop();
      apply();
      persist();
    }
  };
  byId("uie-redo").onclick = () => {
    if (future.length) {
      history.push(clone(layout));
      layout = future.pop();
      apply();
      persist();
    }
  };

  function download(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status("已导出 " + filename);
  }
  byId("uie-export").onclick = () =>
    download("ui-layout.json", JSON.stringify(layout, null, 2), "application/json");
  byId("uie-import").onclick = () => byId("uie-file").click();
  byId("uie-file").onchange = async () => {
    try {
      const file = byId("uie-file").files[0];
      if (!file) return;
      if (file.size > 1048576) throw Error("文件超过1MB");
      const parsed = U.validate(JSON.parse(await file.text()));
      change(() => {
        layout = parsed;
      });
    } catch (error) {
      status("导入失败：" + error.message);
    } finally {
      byId("uie-file").value = "";
    }
  };
  byId("uie-publish").onclick = () => {
    const base = JSON.parse(byId("ui-release-template").textContent);
    const data = JSON.stringify(U.validate(layout)).replace(/</g, "\\u003c");
    const result = base.replace(
      /(<script type="application\/json" id="ui-layout-data">)[\s\S]*?(<\/script>)/,
      (_, start, end) => start + data + end,
    );
    download(`${PROJECT.name}_${PROJECT.version}_Release.html`, result, "text/html");
  };
  byId("ui-resize").addEventListener("pointerdown", pointerDown);
  document.addEventListener("pointermove", pointerMove);
  document.addEventListener("pointerup", endGesture);
  document.addEventListener("pointercancel", endGesture);
  document.addEventListener("keydown", keyboard, true);
  window.addEventListener("blur", endGesture);
  window.addEventListener("resize", () => {
    if (active) resizePreview();
  });
  function trackSelection() {
    if (active && previewWindow) {
      const rect = actorSide()
        ? actorBounds(actorSide())
        : selectedElement()?.getBoundingClientRect();
      selectionFrame.hidden = !rect;
      if (rect) {
        const frame = iframe.getBoundingClientRect();
        Object.assign(selectionFrame.style, {
          left: frame.left + rect.left * zoom + "px",
          top: frame.top + rect.top * zoom + "px",
          width: rect.width * zoom + "px",
          height: rect.height * zoom + "px",
        });
        byId("ui-selection-label").textContent = actorSide()
          ? `${actorSide() === "left" ? "左" : "右"}机体（参考框）`
          : target().name;
      }
      byId("uie-progress").value = previewWindow.GamePreview.progress;
    }
    requestAnimationFrame(trackSelection);
  }
  trackSelection();
})();
