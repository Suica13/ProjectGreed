/* Contract UI only sends intents; objective state and rewards come from the room. */
const ContractUI = (() => {
  const bar = element("div", "contract-hud"),
    summary = element("span"),
    listButton = element("button", "", "事件目标"),
    entryButton = element("button", "", "入场区"),
    exitButton = element("button", "", "撤离区"),
    extract = element("button", "contract-extract", "撤离"),
    notice = element("div", "contract-evacuated");
  bar.id = "contractHud";
  bar.hidden = true;
  extract.id = "hudContractExtract";
  notice.id = "contractEvacuationStatus";
  notice.hidden = true;
  bar.append(summary, entryButton, exitButton, listButton);
  byId("mapWrap").append(bar, notice);
  const dialog = element("dialog", "contract-objectives"),
    heading = element("header"),
    title = element("h2", "", "合约事件"),
    close = element("button", "", "关闭"),
    body = element("div");
  dialog.id = "contractObjectives";
  const briefingButton=element("button","","作战简报");
  briefingButton.onclick=()=>{dialog.close();BriefingUI.open(Net.snapshot);};
  heading.append(title,briefingButton,close);
  dialog.append(heading, body);
  document.body.append(dialog);
  close.onclick = () => dialog.close();
  let snapshot = null;
  const cutin = element("div", "contract-cutin"),
    cutinCard = element("div", "contract-cutin-card"),
    cueKind = element("div", "contract-cutin-kind"),
    cueName = element("strong", "contract-cutin-name");
  cutin.id = "contractCutin";
  cutin.hidden = true;
  cutin.setAttribute("role", "status");
  cutin.setAttribute("aria-live", "polite");
  cutinCard.append(cueKind, cueName);
  cutin.append(cutinCard);
  document.body.append(cutin);
  let presentationMatch = null,
    seenCue = 0,
    cueQueue = [],
    cueTimer = null,
    cueActive = false;
  function resetPresentation() {
    clearTimeout(cueTimer);
    cueTimer = null;
    cueQueue = [];
    cueActive = false;
    cutin.hidden = true;
    seenCue = 0;
  }
  function presentNext() {
    if (cueActive || !cueQueue.length || !snapshot?.started || snapshot.game?.winner !== null)
      return;
    if (snapshot.phase !== "idle" || TurnFlow.active) {
      clearTimeout(cueTimer);
      cueTimer = setTimeout(presentNext, 100);
      return;
    }
    const cue = cueQueue.shift();
    cueActive = true;
    dialog.close();
    BriefingUI.close();
    cutin.dataset.cueId = String(cue.id);
    cutin.dataset.kind = cue.type;
    cueKind.textContent = I18n.text(
      cue.type === "started" ? "事件开始" : cue.type === "completed" ? "事件完成" : "全部目标完成",
    );
    cueName.textContent = I18n.text(cue.name);
    cutin.hidden = false;
    cueTimer = setTimeout(() => {
      cutin.hidden = true;
      cueActive = false;
      presentNext();
    }, 1600);
  }
  function receivePresentation(value) {
    const state = value.contract;
    if(state)SpriteRenderer.ensureModels(state.objectives.filter(o=>o.wreckModel).map(o=>o.wreckModel));
    if (presentationMatch !== value.matchId) {
      resetPresentation();
      presentationMatch = value.matchId;
      // A client joining an ongoing match sees current objectives, without replaying old cut-ins.
      seenCue = state.cueSerial || 0;
    }
    for (const cue of state.cues || [])
      if (cue.id > seenCue) {
        cueQueue.push(cue);
        seenCue = cue.id;
      }
    queueMicrotask(presentNext);
  }

  const label = (o) =>
    o.status === "completed"
      ? "已完成"
      : o.status === "active"
        ? I18n.text("执行中") + " " + o.progress + "/" + o.required
        : "未完成";
  const focus = (point) => MapCamera.focus(point.x, point.y);
  function renderList() {
    body.replaceChildren();
    const state = snapshot?.contract;
    if (!state) return;
    for (const [index, o] of state.objectives.entries()) {
      const row = element("article", "contract-objective"),
        name = element("h3", "", index + 1 + ". " + I18n.text(o.name)),
        status = element("strong", "", label(o)),
        locate = element("button", "", "定位");
      row.dataset.objectiveId = o.id;
      row.dataset.status = o.status;
      locate.onclick = () => {
        dialog.close();
        focus(o);
      };
      row.append(name, status, element("p", "", o.hint), locate);
      body.append(row);
    }
    const bottom = element("p", "muted", "可提前撤离；收益按已完成事件数量结算。");
    body.append(bottom);
  }
  listButton.onclick = () => {
    renderList();
    dialog.showModal();
  };
  const areaFocus = (area) => focus({ x: area.x + area.width / 2, y: area.y + area.height / 2 });
  entryButton.onclick = () => snapshot?.contract && areaFocus(snapshot.contract.entry);
  exitButton.onclick = () => snapshot?.contract && areaFocus(snapshot.contract.extraction);
  extract.onclick = () => {
    const actor = getUnit(selected);
    if (actor && ContractMode.canExtract(game, Rules, actor, Net.seat) && !Net.awaiting)
      Net.request("contract_extract", { unitId: actor.id });
  };
  let terrainMap = null,
    terrainMatch = null;
  function actionButton(actor) {
    const visible = snapshot?.contract && ContractMode.canExtract(game, Rules, actor, Net.seat);
    extract.hidden = !visible;
    extract.disabled = !!Net.awaiting || snapshot?.phase !== "idle" || game.team !== 0;
    return visible ? extract : null;
  }
  function receive(value) {
    snapshot = value;
    if (value.game?.units.some((u) => u.id === selected && u.contractExtracted)) {
      selected = null;
      mode = "select";
    }
    const state = value.contract;
    bar.hidden = !value.started || !state || value.game?.winner !== null;
    if (bar.hidden) {
      dialog.close();
      resetPresentation();
      presentationMatch = null;
      notice.hidden = true;
      if (!value.started) {
        terrainMap = null;
        terrainMatch = null;
      }
      return;
    }
    summary.textContent =
      I18n.text("合约模式") +
      " · " +
      I18n.text(state.difficulty.name) +
      " · " +
      I18n.text("事件") +
      " " +
      state.completed +
      "/" +
      state.objectives.length;
    if (terrainMatch !== value.matchId) {
      terrainMap = ContractMode.visualMap(Rules.catalog, value.game);
      terrainMatch = value.matchId;
      queueMicrotask(() => {
        if (Net.snapshot?.matchId !== value.matchId || Net.snapshot.phase !== "deployment") return;
        const actor = value.game.units.find(
          (u) => Rules.ownerOf(u) === value.you?.seat && !u.embarked && u.hp > 0,
        );
        if (actor) focus(Rules.center(actor));
        else areaFocus(state.entry);
      });
    }
    entryButton.hidden = value.phase !== "deployment";
    const own = state.participants?.find((p) => p.seat === value.you?.seat),
      remaining = state.participants?.reduce((n, p) => n + p.remaining, 0) || 0;
    notice.hidden = !own || !!own.remaining || value.phase === "deployment";
    notice.textContent =
      I18n.text(
        own?.extracted ? "部队已撤离，等待其他玩家完成撤离" : "部队已无可行动单位，等待队友",
      ) +
      " · " +
      I18n.text("剩余单位") +
      " " +
      remaining;
    if (dialog.open) renderList();
    receivePresentation(value);
  }
  function drawCoverage(ctx, geo) {
    const state = snapshot?.contract;
    if (!state || snapshot.game?.winner !== null) return;
    ctx.save();
    ctx.lineWidth = 2;
    for (const o of state.objectives) {
      if (!["salvage", "capture"].includes(o.type)) continue;
      const radius = o.type === "salvage" ? 1 : 2,
        color = o.status === "completed" ? "#72d5a2" : o.type === "salvage" ? "#ffffff" : "#ed6c67",
        left = geo.ox + (o.x - radius) * geo.tile,
        top = geo.oy + (o.y - radius) * geo.tile,
        span = (radius * 2 + 1) * geo.tile;
      ctx.fillStyle = color + "23";
      ctx.fillRect(left, top, span, span);
      ctx.strokeStyle = color;
      ctx.strokeRect(left, top, span, span);
      ctx.lineWidth = 1;
      ctx.strokeStyle = color + "44";
      for (let i = 1; i < radius * 2 + 1; i++) {
        ctx.beginPath();
        ctx.moveTo(left + i * geo.tile, top);
        ctx.lineTo(left + i * geo.tile, top + span);
        ctx.moveTo(left, top + i * geo.tile);
        ctx.lineTo(left + span, top + i * geo.tile);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  function recoveryObjective(actor) {
    if (!snapshot?.contract || !actor || !Rules.onMap(actor)) return null;
    return snapshot.contract.objectives.find(
      (o) =>
        o.type === "salvage" &&
        o.status === "available" &&
        Rules.cells(actor).some(
          (cell) => Math.max(Math.abs(cell.x - o.x), Math.abs(cell.y - o.y)) <= 1,
        ),
    );
  }
  function draw(ctx, geo) {
    const state = snapshot?.contract;
    if (!state || snapshot.game?.winner !== null) return;
    ctx.save();
    const r = state.extraction;
    ctx.fillStyle = "#5ebaaa18";
    ctx.strokeStyle = "#71d6ba";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.fillRect(
      geo.ox + r.x * geo.tile,
      geo.oy + r.y * geo.tile,
      r.width * geo.tile,
      r.height * geo.tile,
    );
    ctx.strokeRect(
      geo.ox + r.x * geo.tile,
      geo.oy + r.y * geo.tile,
      r.width * geo.tile,
      r.height * geo.tile,
    );
    ctx.setLineDash([]);
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#a0ffe4";
    ctx.fillText(
      I18n.text("撤离区"),
      geo.ox + (r.x + r.width / 2) * geo.tile,
      geo.oy + (r.y + r.height / 2) * geo.tile,
    );
    for (const [index, o] of state.objectives.entries()) {
      const x = geo.ox + (o.x + 0.5) * geo.tile,
        y = geo.oy + (o.y + 0.5) * geo.tile,
        size = Math.max(10, Math.min(18, geo.tile * 0.6));
      if(o.wreckModel && Rules.models[o.wreckModel]) {
        const model=Rules.models[o.wreckModel];ctx.save();ctx.filter="grayscale(1) brightness(.45)";ctx.globalAlpha=.85;
        SpriteRenderer.draw(ctx,o.wreckModel,x,y+geo.tile*.5,geo.tile/Rules.mapCellPixels*ART.presentation.unitMapScale*model.presentation.mapScale,90,model.presentation.idle,0,null,true,false,false,{},90,false,true,"ground");
        ctx.restore();
      }
      if (o.type === "capture") {
        BattlefieldUI.drawCampaignObjective(
          ctx,
          { kind: "point" },
          o.status === "completed" ? 0 : 1,
          x,
          y,
          geo.tile,
        );
        const width = Math.max(40, geo.tile * 2.3),
          gap = 2,
          cell = (width - gap * 4) / 5,
          top = y + geo.tile * 0.95;
        ctx.fillStyle = "#09121fe8";
        ctx.fillRect(x - width / 2 - 3, top - 3, width + 6, 14);
        for (let j = 0; j < 5; j++) {
          ctx.fillStyle = j < o.progress ? "#55b9f5" : "#e56d65";
          ctx.fillRect(x - width / 2 + j * (cell + gap), top, cell, 8);
        }
      }
      const markerY = o.type === "capture" ? y - geo.tile * 1.15 : y;
      ctx.strokeStyle =
        o.status === "completed" ? "#72d5a2" : o.status === "active" ? "#79d5ff" : "#f3c965";
      ctx.fillStyle = "#10202de8";
      ctx.lineWidth = 2;
      ctx.beginPath();
      // Four distinct silhouettes: data square, elimination diamond, factory, outpost ring.
      if (o.type === "salvage") ctx.rect(x - size, markerY - size, size * 2, size * 2);
      else if (o.type === "command") {
        ctx.moveTo(x, markerY - size);
        ctx.lineTo(x + size, markerY);
        ctx.lineTo(x, markerY + size);
        ctx.lineTo(x - size, markerY);
        ctx.closePath();
      } else if (o.type === "factory") {
        ctx.moveTo(x - size, markerY + size);
        ctx.lineTo(x - size, markerY - size * 0.3);
        ctx.lineTo(x - size * 0.3, markerY);
        ctx.lineTo(x - size * 0.3, markerY - size * 0.3);
        ctx.lineTo(x + size * 0.4, markerY);
        ctx.lineTo(x + size * 0.4, markerY - size);
        ctx.lineTo(x + size, markerY - size);
        ctx.lineTo(x + size, markerY + size);
        ctx.closePath();
      } else ctx.arc(x, markerY, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.textBaseline = "middle";
      ctx.fillText(o.status === "completed" ? "✓" : String(index + 1), x, markerY);
      if (o.type === "command" && o.status !== "completed")
        for (const id of o.targets) {
          const target = game.units.find((u) => u.id === id);
          if (
            !target ||
            !Rules.onMap(target) ||
            (game.intel && !game.intel.visibleIds.includes(id))
          )
            continue;
          const center = Rules.center(target),
            tx = geo.ox + (center.x + 0.5) * geo.tile,
            ty = geo.oy + (center.y - 0.75) * geo.tile,
            text = I18n.text("目标"),
            width = Math.max(12, Math.min(54, geo.tile * 0.92)),
            half = width / 2,
            height = Math.min(30, width * 0.8);
          ctx.beginPath();
          ctx.moveTo(tx - half, ty - height);
          ctx.lineTo(tx + half, ty - height);
          ctx.lineTo(tx, ty + 3);
          ctx.closePath();
          ctx.fillStyle = "#9e252eea";
          ctx.fill();
          ctx.strokeStyle = "#ff9c97";
          ctx.stroke();
          if (width >= 20) {
            ctx.save();
            ctx.fillStyle = "#fff";
            ctx.font = "bold " + Math.max(8, Math.min(12, width * 0.4)) + "px sans-serif";
            // Fit longer translations inside the triangle instead of overlapping adjacent targets.
            ctx.fillText(text, tx, ty - height * 0.7, width * 0.68);
            ctx.restore();
          }
        }
    }
    ctx.restore();
  }
  window.addEventListener("page-changing", () => {
    dialog.close();
    clearTimeout(cueTimer);
    cueTimer = null;
    cueQueue = [];
    cueActive = false;
    cutin.hidden = true;
  });
  for (const type of ["keydown", "keyup"])
    dialog.addEventListener(type, (event) => event.stopPropagation());
  return {
    receive,
    draw,
    drawCoverage,
    recoveryObjective,
    actionButton,
    get presenting() {
      return cueActive || !!cueQueue.length;
    },
    get map() {
      return terrainMap;
    },
  };
})();
