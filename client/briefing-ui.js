/* Local briefing presentation; objectives and map always come from the authoritative snapshot. */
const BriefingUI = (() => {
  const panel = element("dialog", "operation-briefing"),
    header = element("header"),
    title = element("h2", "", "作战简报"),
    subtitle = element("p", "briefing-subtitle"),
    preview = element("div", "briefing-preview"),
    canvas = element("canvas"),
    markers = element("div", "briefing-markers"),
    sweep = element("div", "briefing-radar-sweep"),
    mapCaption = element("div", "briefing-map-caption"),
    heading = element("h3", "", "任务目标"),
    current = element("section", "briefing-current"),
    currentTitle = element("strong"),
    currentText = element("p"),
    list = element("div", "briefing-goals"),
    footer = element("footer"),
    status = element("span", "briefing-status"),
    replay = element("button", "", "重新播放"),
    closeButton = element("button", "primary", "关闭");
  panel.id = "operationBriefing";
  title.id = "operationBriefingTitle";
  panel.setAttribute("aria-labelledby", title.id);
  preview.append(canvas, markers, sweep, mapCaption);
  header.append(title, subtitle);
  current.setAttribute("aria-live", "polite");
  current.append(currentTitle, currentText);
  footer.append(status, replay, closeButton);
  panel.append(header, preview, heading, current, list, footer);
  document.body.append(panel);
  let snapshot = null,
    rows = [],
    map = null,
    active = 0,
    timer = null,
    frame = null,
    key = "",
    geometry = null;
  let updateTimer = null;
  const missionUpdates = new Map();
  const seen = new Set(),
    painter = TileMapView.create({ changed: () => schedulePaint() });
  const labels = {
    main_force: "消灭敌军主力",
    all_enemies: "消灭所有敌人",
    escort: "护送目标抵达指定地点",
    hold: "抵达后存活回合",
    survive: "坚持至指定回合",
    defeat_actor: "击破目标单位",
    pmc_destroyed: "玩家PMC部队全灭",
    protected_destroyed: "保护目标被击坠",
  };
  const center = (points) =>
    points.length
      ? {
          x: points.reduce((n, p) => n + p.x, 0) / points.length,
          y: points.reduce((n, p) => n + p.y, 0) / points.length,
        }
      : null;
  function goals(value) {
    const game = value.game;
    if (value.contract) {
      const state = value.contract;
      return [
        ...ContractMode.deploymentZones(state).map((entry, index) => ({
          id: "deployment-" + index,
          label: I18n.text("入场区") + " " + (index + 1),
          text: "部署阶段",
          kind: "deployment",
          tactical: "move",
          area: entry,
          points: [{x:entry.x+(entry.width-1)/2,y:entry.y+(entry.height-1)/2}],
        })),
        ...state.objectives.map((o) => ({
          id: o.id,
          label: o.name,
          text: o.hint,
          kind: "victory",
          count:
            o.status === "completed"
              ? "✓"
              : o.status === "failed" ? I18n.text("事件失败") : o.required > 1
                ? `${o.progress}/${o.required}`
                : I18n.text("未完成"),
          points: [{ x: o.x, y: o.y }],
          tactical: ["capture","defend","rescue","upload"].includes(o.type) ? "defend" : o.type === "salvage" ? "move" : "attack",
          radius: ["defend","rescue"].includes(o.type) ? 5 : o.type === "capture" ? 2 : ["salvage","upload"].includes(o.type) ? 1 : 0,
        })),
        ...ContractMode.extractionZones(state).map((exit, index) => ({
          id: "extraction-" + index,
          label: I18n.text("前往撤离区") + " " + (index + 1),
          text: "可提前撤离；收益按已完成事件数量结算。",
          kind: "extraction",
          tactical: "retreat",
          points: [{ x: exit.x + exit.width / 2, y: exit.y + exit.height / 2 }],
        })),
      ];
    }
    const config = Rules.getMap(game.mapId).mission,
      mission = game.mission,
      progress = mission?.objectives || MissionMode.objectives(game, Rules),
      actor = (id) =>
        game.units.find((u) => u.missionActor === id) || config.actors.find((a) => a.id === id),
      initial = config.actors.filter((a) => a.initial),
      primary = config.victory;
    const battlefield = Rules.getMap(game.mapId),
      spawns = game.spawns || battlefield.spawns,
      areas = game.deploymentAreas || battlefield.deploymentAreas,
      deployments = [], seenAreas = new Set();
    for (let seat = 0; seat < spawns.length; seat += 2) {
      const spawn = spawns[seat], radius = battlefield.deploymentRadius || 2,
        area = areas?.[seat] || {x:Math.max(0,spawn.x-radius),y:Math.max(0,spawn.y-radius),width:radius*2+1,height:radius*2+1},
        signature = JSON.stringify(area);
      if (seenAreas.has(signature)) continue;
      seenAreas.add(signature);
      deployments.push({id:"deployment-"+deployments.length,label:I18n.text("入场区")+" "+(deployments.length+1),
        text:"部署阶段",kind:"deployment",tactical:"move",area,
        points:[{x:area.x+(area.width-1)/2,y:area.y+(area.height-1)/2}]});
    }
    return deployments.concat(["victory", "failure"].flatMap((kind) =>
      progress[kind].map((item, index) => {
        const model =
            item.unitId && Object.values(Rules.models).find((m) => m.prefabId === item.unitId),
          name = item.unitId ? model?.name || item.unitId : null,
          label =
            I18n.text(item.label || labels[item.kind] || "任务目标") +
            (name ? " · " + I18n.text(name) : "");
        let points = [];
        if (item.kind === "protected_destroyed") {
          points = mission.protect
            .map(actor)
            .filter(
              (a) =>
                a &&
                (!item.unitId ||
                  a.unitId === item.unitId ||
                  Rules.models[a.model]?.prefabId === item.unitId),
            );
          if (!points.length && primary.type === "defend_group")
            points = initial.filter((a) => a.group === primary.group);
        } else if (item.kind === "pmc_destroyed")
          points = game.units.filter((u) => u.team === 0 && !u.missionActor && !u.embarked);
        else if (["escort", "hold"].includes(item.kind)) {
          points = (primary.route || []).map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p));
          if (!points.length && primary.actor) points = [actor(primary.actor)].filter(Boolean);
        } else if (item.kind === "defeat_actor") points = [actor(primary.actor)].filter(Boolean);
        else if (["main_force", "group_targets", "defended"].includes(item.kind))
          points = config.actors.filter((a) => a.group === primary.group);
        else if (item.kind === "extraction") {
          const r = primary.region;
          if (r) points = [{ x: r.x + r.width / 2, y: r.y + r.height / 2 }];
        } else if (item.kind === "all_enemies") points = initial.filter((a) => a.team === 1);
        else if (item.kind === "survive")
          points = initial.filter(
            (a) => a.group === primary.group || (primary.actor && a.id === primary.actor),
          );
        return {
          id: kind + "-" + index,
          tactical: item.kind === "extraction" ? "retreat" : ["escort", "hold"].includes(item.kind) ? "move" : kind === "failure" || item.kind === "survive" ? "defend" : "attack",
          kind,
          label,
          text: I18n.text(kind === "victory" ? "胜利条件" : "失败条件") + " · " + label,
          count: `${item.current}/${item.total}`,
          points: points
            .map((p) => ({ x: p.x, y: p.y }))
            .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
        };
      }),
    ));
  }
  function schedulePaint() {
    if (!panel.open || frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      paint();
    });
  }
  function paint() {
    if (!panel.open || !map || !snapshot?.game) return;
    const width = Math.max(1, preview.clientWidth),
      height = Math.max(1, preview.clientHeight),
      ratio = Math.min(2, devicePixelRatio || 1),
      game = snapshot.game,
      tiles = game.tiles,
      w = tiles[0].length,
      h = tiles.length,
      tile = Math.min((width - 24) / w, (height - 24) / h),
      ox = (width - w * tile) / 2,
      oy = (height - h * tile) / 2;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = "#081725";
    ctx.fillRect(0, 0, width, height);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        ctx.fillStyle = Rules.terrainStyle(game.mapId, tiles[y][x]).color;
        ctx.fillRect(ox + x * tile, oy + y * tile, tile + 0.5, tile + 0.5);
      }
    if (map.tileMap)
      for (const placement of ["below", "above"])
        painter.draw(ctx, map.tileMap, placement, {
          ox,
          oy,
          cellWidth: tile,
          cellHeight: tile,
          width,
          height,
        });
    const actors = snapshot.contract ? [] : (map.mission?.actors || []).filter((a) => a.initial);
    for (const a of actors) {
      ctx.fillStyle = a.team === 0 ? "#74c4fa" : "#e88780";
      ctx.fillRect(
        ox + (a.x + 0.25) * tile,
        oy + (a.y + 0.25) * tile,
        Math.max(2, tile * 0.5),
        Math.max(2, tile * 0.5),
      );
    }
    geometry = { width, height, tile, ox, oy };
    paintMarkers();
  }
  function paintMarkers() {
    if (!geometry) return;
    markers.replaceChildren();
    const { tile, ox, oy, width, height } = geometry;
    for (const [index, row] of rows.entries()) {
      const p = center(row.points);
      if (!p) continue;
      const marker = element(
        "button",
        "briefing-marker" + (index === active ? " active" : ""),
        String(index + 1),
      );
      marker.type = "button";
      marker.dataset.goalId = row.id;
      marker.dataset.kind = row.kind;
      marker.dataset.tactical = row.tactical;
      const shape = element("span", "briefing-tactical-symbol");
      const paths = {
        attack: "M5 23L23 5M12 5H23V16M5 14L5 23L14 23",
        move: "M5 6L13 14L5 22M14 6L22 14L14 22",
        defend: "M5 5L14 2L23 5V14Q22 22 14 26Q6 22 5 14ZM14 8V19M9 13H19",
        retreat: "M23 7H14V2L3 14L14 26V21H23Z",
      };
      shape.innerHTML = '<svg viewBox="0 0 28 28" aria-hidden="true"><path d="' + (paths[row.tactical] || paths.attack) + '"/></svg>';
      marker.prepend(shape);
      marker.style.left = ((ox + (p.x + 0.5) * tile) / width) * 100 + "%";
      marker.style.top = ((oy + (p.y + 0.5) * tile) / height) * 100 + "%";
      marker.setAttribute("aria-label", I18n.text(row.label));
      marker.onclick = () => select(index, true);
      markers.append(marker);
      if (row.area || (index === active && (row.points.length > 1 || row.radius))) {
        const radius = row.radius || 1,
          x0 = row.area?.x ?? Math.min(...row.points.map((p) => p.x)) - radius,
          y0 = row.area?.y ?? Math.min(...row.points.map((p) => p.y)) - radius,
          x1 = row.area ? x0 + row.area.width : Math.max(...row.points.map((p) => p.x)) + radius + 1,
          y1 = row.area ? y0 + row.area.height : Math.max(...row.points.map((p) => p.y)) + radius + 1,
          area = element("span", "briefing-target-area" + (row.kind === "deployment" ? " briefing-deployment-area" : ""));
        area.style.cssText = `left:${((ox + x0 * tile) / width) * 100}%;top:${((oy + y0 * tile) / height) * 100}%;width:${(((x1 - x0) * tile) / width) * 100}%;height:${(((y1 - y0) * tile) / height) * 100}%`;
        markers.prepend(area);
      }
    }
  }
  function select(index, manual = false) {
    clearTimeout(timer);
    active = Math.max(0, Math.min(rows.length - 1, index));
    const row = rows[active];
    if (!row) return;
    currentTitle.textContent = `${active + 1}. ${I18n.text(row.label)}`;
    currentText.textContent = I18n.text(row.text);
    mapCaption.textContent = currentTitle.textContent;
    status.textContent = `${active + 1} / ${rows.length}`;
    for (const [i, button] of [...list.children].entries()) {
      button.classList.toggle("active", i === active);
      button.setAttribute("aria-current", String(i === active));
      if (i === active)
        list.scrollTo({
          top: Math.max(
            0,
            button.getBoundingClientRect().top -
              list.getBoundingClientRect().top +
              list.scrollTop -
              4,
          ),
          behavior: "smooth",
        });
    }
    paintMarkers();
    if (!manual && active < rows.length - 1) timer = setTimeout(() => select(active + 1), 4500);
  }
  function renderRows() {
    list.replaceChildren(
      ...rows.map((row, index) => {
        const button = element("button", "briefing-goal"),
          number = element("span", "briefing-number", String(index + 1)),
          name = element("span", "", I18n.text(row.label)),
          count = element("small", "", row.count || "");
        button.type = "button";
        button.dataset.kind = row.kind;
        button.dataset.goalId = row.id;
        button.append(number, name, count);
        button.onclick = () => select(index, true);
        return button;
      }),
    );
  }
  function open(value = snapshot, { sound = true } = {}) {
    if (!value?.started || !["sweep", "mission"].includes(value.settings?.mode) || !value.game)
      return;
    snapshot = value;
    rows = goals(value);
    map = value.contract
      ? ContractUI.map || ContractMode.visualMap(Rules.catalog, value.game)
      : Rules.getMap(value.game.mapId);
    title.textContent = I18n.text("作战简报");
    subtitle.textContent = I18n.text(map.name);
    heading.textContent = I18n.text("任务目标");
    replay.textContent = I18n.text("重新播放");
    closeButton.textContent = I18n.text("关闭");
    key = JSON.stringify(rows) + I18n.language;
    renderRows();
    if (!panel.open) panel.showModal();
    panel.dataset.mode = value.settings.mode;
    panel.dataset.matchId = value.matchId;
    painter.retainImages?.([
      ...(map.tileMap?.tilesets || []).map((t) => t.image),
      ...(map.tileMap?.layers || []).filter((l) => l.type === "image").map((l) => l.image.src),
    ]);
    paint();
    select(0);
    if (sound) GameAudio.play("sonarSound");
  }
  function close() {
    if (panel.open) panel.close();
  }
  closeButton.onclick = close;
  replay.onclick = () => select(0);
  panel.addEventListener("close", () => {
    clearTimeout(timer);
    timer = null;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  });
  panel.addEventListener("keydown", (event) => event.stopPropagation());
  new ResizeObserver(() => {
    schedulePaint();
    const button = list.children[active];
    if (panel.open && button)
      list.scrollTo({
        top: Math.max(
          0,
          button.getBoundingClientRect().top -
            list.getBoundingClientRect().top +
            list.scrollTop -
            4,
        ),
        behavior: "auto",
      });
  }).observe(preview);
  function receive(value) {
    snapshot = value;
    if (
      !value?.started ||
      !["sweep", "mission"].includes(value.settings?.mode) ||
      value.game?.winner !== null
    ) {
      close();
      return;
    }
    const mission = value.game.mission;
    if (value.settings.mode === "mission" && mission) {
      const objectives = mission.objectives || MissionMode.objectives(value.game, Rules);
      const stamp = JSON.stringify({
        fired: mission.fired, protect: mission.protect, choices: mission.choices,
        conditions: Object.fromEntries(["victory", "failure"].map(kind => [kind,
          (objectives?.[kind] || []).map(({kind, total, unitId, label}) => ({kind, total, unitId, label}))])),
      });
      const previous = missionUpdates.get(value.matchId);
      if (!previous) missionUpdates.set(value.matchId, {stamp, pending:false});
      else if (previous.stamp !== stamp) {
        previous.stamp = stamp;
        previous.pending = true;
      }
      if (missionUpdates.size > 12) missionUpdates.delete(missionUpdates.keys().next().value);
    }
    if (mission?.dialogue || mission?.choice || mission?.continuation || mission?.error ||
      !["deployment", "idle"].includes(value.phase)) {
      close();
      return;
    }
    if (panel.open && panel.dataset.matchId === value.matchId) {
      const next = goals(value),
        stamp = JSON.stringify(next) + I18n.language;
      if (stamp !== key) {
        key = stamp;
        rows = next;
        const selectedId = list.children[active]?.dataset.goalId;
        renderRows();
        select(
          Math.max(
            0,
            rows.findIndex((r) => r.id === selectedId),
          ),
          true,
        );
      }
    }
    if (!seen.has(value.matchId) || missionUpdates.get(value.matchId)?.pending) {
      clearTimeout(updateTimer);
      updateTimer = setTimeout(() => {
        updateTimer = null;
        if (!snapshot?.started || snapshot.matchId !== value.matchId || snapshot.game.winner !== null) return;
        if (snapshot.game.mission?.dialogue || snapshot.game.mission?.choice || snapshot.game.mission?.continuation ||
          !["deployment", "idle"].includes(snapshot.phase)) return;
        if (MapCombat.frames.length || window.TurnFlow?.active) {
          updateTimer = setTimeout(() => receive(snapshot), 150);
          return;
        }
        const state = missionUpdates.get(value.matchId);
        if (seen.has(value.matchId) && !state?.pending) return;
        seen.add(value.matchId);
        if (seen.size > 12) seen.delete(seen.values().next().value);
        if (state) state.pending = false;
        open(snapshot, { sound: true });
      }, 80);
    }
  }

  window.addEventListener("page-changing", close);
  return {
    open,
    close,
    goals,
    receive,
    clear() {
      close();
      snapshot = null;
      clearTimeout(updateTimer);
      updateTimer = null;
    },
    get active() {
      return panel.open;
    },
  };
})();
