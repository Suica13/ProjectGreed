/* 搭载面板与出击落点选择。所有操作仍通过服务器/离线房间意图裁定。 */
const HangarUI = (() => {
  const dialog = element("dialog", "hangar-dialog");
  dialog.id = "hangarDialog";
  dialog.setAttribute("aria-label", "格纳库");
  document.body.append(dialog);
  let statusUnit = null, confirmingLaunch = false;
  const launchSelection = new Set();
  let launchingIds = [], launchLocationKey = null;
  function commonLaunchCells(ids) {
    const members = ids.map(getUnit).filter(Boolean);
    return members.length === ids.length ? Rules.hangars.launchSquadCells(game,members) : [];
  }
  function startLaunch(ids, carrier) {
    const locations = commonLaunchCells(ids);
    if (!locations.length) return note("所选单位没有共同的出击落点");
    launchingIds = ids; launching = ids[0]; launchLocations = locations;
    launchLocationKey = null;
    selected = carrier.id; mode = "hangar-launch"; weaponId = null;
    dialog.close(); update();
  }
  let inspected = null,
    launching = null,
    boarding = null,
    boardingCarrier = null,
    launchLocations = [],
    reopenCarrier = null;
  const mine = (u) =>
    Net.active
      ? Net.canControl(u)
      : Rules.ownerOf(u) === (phase === "deployment" ? Deployment.team() : game.team);
  const allowed = (u) =>
    !!u &&
    mine(u) &&
    !Net.awaiting &&
    !Net.snapshot?.returnCountdown &&
    (phase === "deployment"
      ? !game.deployment?.[Rules.ownerOf(u)]
      : phase === "idle" && (!Net.active || Net.canAct()));
  function button(label, fn, disabled = false) {
    const b = element("button", "", label);
    b.disabled = disabled;
    b.onclick = fn;
    return b;
  }
  function request(action, fields) {
    if (Net.active) return Net.request(action, fields);
    try {
      const u = getUnit(fields.unitId);
      if (action === "embark")
        Rules.hangars.embarkSquad(game, u, getUnit(fields.carrierId), fields.hangarId, fields.single === true);
      else PlanningUI.move(Rules.hangars.previewLaunchSquad(game, (fields.unitIds || [u.id]).map(getUnit), fields.x, fields.y));
      addLog(`${logUnit(u)} ${action === "embark" ? "搭载" : "出击"}。`);
      update();
    } catch (error) {
      note(error.message);
    }
  }
  function board(u, carrier, h) {
    cancel();
    dialog.close();
    request("embark", { unitId: u.id, carrierId: carrier.id, hangarId: h.id, single: squadSingleMove });
  }
  function row(u, hangar = null) {
    const box = element("div", "hangar-unit");
    const icon = element("img");
    icon.src = unitIcon(u.model, u.pilot);
    icon.alt = "";
    const info = element("div", "hangar-unit-info");
    const nested = Rules.hangars.cargo(game, u).length
      ? " · " + I18n.text("格纳库") + " " +
        Rules.hangars.of(u).map(h => Rules.hangars.used(game, u, h.id) + " / " + h.capacity).join(" · ") +
        " " + I18n.text("容量点")
      : "";
    const name = element("strong", "", unitName(u));
    name.setAttribute("data-i18n-ignore", "");
    info.append(
      name,
      element(
        "small",
        "muted",
        `${UnitIdentity.owner(u).name} · ${hangar?.kind === "sfs" || u.embarked?.exposed ? 1 : Rules.modelOf(u).transport.slotCost} ${I18n.text("容量点")} · HP ${formatNumber(u.hp)} / ${formatNumber(Rules.modelOf(u).hp)} · EN ${formatNumber(u.en)} / ${formatNumber(Rules.modelOf(u).en)}${nested}`,
      ),
    );
    box.append(icon, info);
    return box;
  }
  let renderedView = null;
  function render() {
    const key = JSON.stringify([session,inspected,statusUnit,boardingCarrier]);
    const view = renderedView === key ? capturePanelView(dialog) : null;
    try { renderContents(); }
    finally { restorePanelView(view); renderedView = key; }
  }
  function renderContents() {
    const selectedUnit = getUnit(inspected);
    if (
      !selectedUnit ||
      selectedUnit.hp <= 0 ||
      !["idle", "deployment"].includes(phase) ||
      pageView !== "game"
    ) {
      dialog.close();
      return;
    }
    dialog.replaceChildren();
    const header = element("div", "hangar-heading");
    header.append(
      element("strong", "", I18n.text("格纳库") + " · " + unitName(selectedUnit)),
      button("关闭", () => {
        dialog.close();
        if (boarding) {
          cancel();
          update();
        }
      }),
    );
    const content = element("div", "hangar-content");
    dialog.append(header, content);
    if (Net.active && Net.team() !== null && selectedUnit.team !== Net.team()) {
      content.append(element("p", "helper", "无法查看敌军格纳库的载员"));
      return;
    }
    const carrierMode = Rules.hangars.of(selectedUnit).length > 0 && !boardingCarrier;
    if (carrierMode && allowed(selectedUnit) && boardingTargets(selectedUnit).length) {
      const embarkButton = button("搭载", () => startBoarding(selectedUnit));
      embarkButton.dataset.boardCarrier = selectedUnit.id;
      content.append(embarkButton);
    }

    const carriers = carrierMode ? [selectedUnit] : [getUnit(boardingCarrier)].filter(Boolean);
    if (!carrierMode && carriers.length)
      content.append(element("p", "helper", "选择搭乘格纳库" + " · " + unitName(carriers[0])));
    if (!carriers.length) content.append(element("p", "empty", "没有可用的友军格纳库"));
    for (const carrier of carriers) {
      if (!carrierMode) content.append(element("h3", "", unitName(carrier)));
      for (const h of Rules.hangars.of(carrier)) {
        const section = element("section", "hangar-section");
        section.dataset.hangarId = h.id;
        section.append(
          element(
            "h4",
            "",
            `${h.kind === "sfs" ? "SFS" : I18n.text("格纳库") + " " + (Rules.hangars.of(carrier).indexOf(h) + 1)} · ${Rules.hangars.used(game, carrier, h.id)} / ${h.capacity} ${I18n.text("容量点")}`,
          ),
        );
        const compatible = ART.prefabs.filter(
          (p) => !p.formOnly && h.allowedTags.some((t) => p.transport?.loadTags.includes(t)),
        );
        const kinds = [...new Set(compatible.flatMap((p) => p.unitTags.slice(0, 1)))];
        if (carrierMode)
          section.append(
            element(
              "small",
              "muted",
              I18n.text("可搭载类型") + ": " + kinds.map(Rules.unitTagName).join(" / "),
            ),
          );
        for (const u of Rules.hangars.cargo(game, carrier, h.id)) {
          const item = row(u,h);
          item.dataset.cargoId = u.id;
          const inspect = button("查看状态", () => { statusUnit = u.id; render(); });
          inspect.dataset.inspectCargo = u.id;
          item.append(inspect);
          const ready = allowed(u) && !u.acted && (phase === "deployment" || u.embarked?.boardRound !== game.round);
          if (carrierMode && ready) {
            const icon = item.querySelector("img");
            icon.setAttribute("role","button"); icon.tabIndex = 0;
            icon.setAttribute("aria-label",I18n.text("选择出击单位") + " · " + unitName(u));
            icon.setAttribute("aria-pressed",String(launchSelection.has(u.id)));
            item.classList.toggle("is-selected",launchSelection.has(u.id));
            const toggle = () => {
              if (launchSelection.has(u.id)) launchSelection.delete(u.id);
              else if (launchSelection.size < 3) launchSelection.add(u.id);
              else return note("每个小队最多3台单位");
              render();
            };
            icon.onclick = toggle;
            icon.onkeydown = e => { if (["Enter"," "].includes(e.key)) { e.preventDefault(); toggle(); } };
          }
          if (carrierMode)
            item.append(
              button(
                "出击",
                () => {
                  startLaunch([u.id],carrier);
                },
                !ready,
              ),
            );
          section.append(item);
        }
        if (!carrierMode) {
          const embark = button(
            "搭乘",
            () => board(selectedUnit, carrier, h),
            !allowed(selectedUnit) || !Rules.hangars.boardingPlan(game, squadSingleMove ? [selectedUnit] : Rules.squadMembers(game, selectedUnit), carrier, h.id),
          );
          embark.dataset.boardId = selectedUnit.id;
          section.append(embark);
        }
        if (!Rules.hangars.cargo(game, carrier, h.id).length)
          section.append(element("p", "helper", "暂无载员"));
        content.append(section);
      }
    }
    if (carrierMode) {
      const valid = new Set(Rules.hangars.cargo(game,selectedUnit).filter(u => allowed(u) && !u.acted).map(u => u.id));
      for (const id of launchSelection) if (!valid.has(id)) launchSelection.delete(id);
      const actions = element("div","hangar-launch-selection");
      actions.append(element("span","",I18n.text("已选择") + " " + launchSelection.size + " / 3"),
        button("小队出击",() => startLaunch([...launchSelection],selectedUnit),!launchSelection.size));
      actions.dataset.squadLaunch = "";
      content.prepend(actions);
    }
    const cargo = getUnit(statusUnit);
    if (cargo && carriers.some(c => cargo.embarked?.carrierId === c.id)) {
      const m = Rules.modelOf(cargo);
      content.replaceChildren();
      const back = button("返回格纳库", () => { statusUnit = null; render(); });
      back.id = "hangarStatusBack";
      content.append(back, row(cargo));
      const panel = element("section", "hangar-section");
      panel.id = "hangarCargoStatus";
      const broken = Object.keys(cargo.brokenParts || {}).filter(k => cargo.brokenParts[k]);
      panel.append(element("h4", "", "当前状态"),
        element("p", "", `${m.name} · ${UnitIdentity.owner(cargo).team}`),
        element("p", "", `HP ${formatNumber(cargo.hp)} / ${formatNumber(m.hp)} · EN ${formatNumber(cargo.en)} / ${formatNumber(m.en)}`),
        element("p", "", `${I18n.text("盾牌")} ${formatNumber(cargo.shield || 0)} / ${formatNumber(m.shield?.hp || 0)} · ${I18n.text("AP参考")} ${formatNumber(m.actionPoints)}`),
        element("p", broken.length ? "red" : "muted", broken.length
          ? I18n.text("受损部位") + ": " + broken.map(k => I18n.text(Rules.partNames[k] || k)).join(" / ")
          : I18n.text("部位完好")));
      content.append(panel);
      const weapons = element("section", "hangar-section");
      weapons.append(element("h4", "", "武器状态"));
      for (const weapon of m.weapons) {
        weapons.append(WeaponInfo.card(weapon,null,{unit:cargo}));
      }
      content.append(weapons);
    } else statusUnit = null;
    const help = element("div", "hangar-help helper");
    for (const text of [
      "搭载结束本次行动，下次己方回合可出击；出击范围使用载员自身移动力。",
      "出击视为已移动，仍可攻击或使用技能；剩余行动点×75%并向上取整，所属舰船不能撤回移动。",
      "搭载中每次己方回合恢复25%最大耐久、50%最大EN，并随机修复最多两个受损零件。",
      "舰毁紧急退出损失25%最大耐久和最大盾牌；无合法落点或耐久归零则损失载员。",
    ]) help.append(element("p", "", I18n.text(text)));
    dialog.append(help);
  }
  function boardingTargets(u) {
    return game.units.filter((c) =>
      Rules.hangars.of(c).some((h) => Rules.hangars.boardingPlan(game, squadSingleMove ? [u] : Rules.squadMembers(game, u), c, h.id)),
    );
  }
  function startBoarding(u) {
    cancel();
    dialog.close();
    boarding = u.id;
    selected = u.id;
    mode = "hangar-board";
    weaponId = null;
    update();
  }
  function open(u) {
    statusUnit = null;
    if (inspected !== u.id) launchSelection.clear();
    if (!Rules.hangars.of(u).length) {
      if (!allowed(u) || !boardingTargets(u).length) return;
      startBoarding(u);
      return;
    }
    inspected = u.id;
    render();
    if (!dialog.open) dialog.showModal();
  }
  function actionButton(u) {
    const carrier = Rules.hangars.of(u).length > 0;
    if (
      !carrier &&
      !game.units.some((c) =>
        Rules.hangars.of(c).some((h) => Rules.hangars.boardingPlan(game, squadSingleMove ? [u] : Rules.squadMembers(game, u), c, h.id)),
      )
    )
      return null;
    const b = button(carrier ? "格纳库" : "搭载", () => open(u));
    b.disabled = !carrier && !allowed(u);
    b.dataset.unitCommand = "hangar";
    const hint = element("span", "", "(H)");
    hint.setAttribute("data-i18n-ignore", "");
    b.append(hint);
    b.setAttribute("aria-keyshortcuts", "H");
    return b;
  }
  function cancel() {
    launching = boarding = boardingCarrier = reopenCarrier = null;
    confirmingLaunch = false;
    launchingIds = []; launchLocationKey = null;
    launchLocations = [];
    if (["hangar-launch", "hangar-board"].includes(mode)) mode = "select";
  }
  function refresh() {
    const passenger = launching && getUnit(launching);
    if (passenger?.pendingMove?.launch) {
      confirmingLaunch = true;
      selected = passenger.id; mode = "move-confirm"; weaponId = null;
      if (dialog.open) dialog.close();
      return;
    }
    if (confirmingLaunch) {
      const carrier = getUnit(reopenCarrier);
      cancel();
      if (carrier?.hp > 0) {
        selected = carrier.id; mode = "select"; weaponId = null;
        const cargo = Rules.hangars.cargo(game, carrier);
        if (cargo.length) open(carrier);
        queueMicrotask(update);
      }
      return;
    }
    if (launching && (!getUnit(launching)?.embarked || !["idle", "deployment"].includes(phase))) {
      const carrier = getUnit(reopenCarrier);
      const hasCargo = carrier?.hp > 0 &&
        Rules.hangars.of(carrier).some((hangar) => Rules.hangars.cargo(game, carrier, hangar.id).length);
      cancel();
      if (hasCargo && ["idle", "deployment"].includes(phase)) open(carrier);
    }
    if (
      boarding &&
      (!allowed(getUnit(boarding)) ||
        selected !== boarding ||
        !boardingTargets(getUnit(boarding)).length)
    ) {
      cancel();
      dialog.close();
    }
    if (launching) {
      const key = JSON.stringify([launchingIds,game.round,game.deployment,
        game.units.map(u => [u.id,u.model,u.x,u.y,u.hp,u.angle,u.squadId,u.moved,u.acted,u.embarked,u.brokenParts])]);
      if (key !== launchLocationKey) {
        launchLocations = commonLaunchCells(launchingIds.length ? launchingIds : [launching]);
        launchLocationKey = key;
      }
    } else launchLocations = [];
    if (dialog.open) render();
  }
  function cells() {
    if (boarding && mode === "hangar-board")
      return new Set(
        boardingTargets(getUnit(boarding)).flatMap((c) =>
          Rules.cells(c).map((p) => Rules.key(p.x, p.y)),
        ),
      );
    return new Set(
      launching && mode === "hangar-launch" ? launchLocations.map((c) => Rules.key(c.x, c.y)) : [],
    );
  }
  function click(cell) {
    if (mode === "hangar-board") {
      const carrier = cell && Rules.at(game, cell.x, cell.y),
        passenger = getUnit(boarding);
      if (!carrier || !boardingTargets(passenger).some((c) => c.id === carrier.id)) {
        note("请选择相邻的可搭载友军舰船");
        return true;
      }
      boardingCarrier = carrier.id;
      inspected = passenger.id;
      render();
      if (!dialog.open) dialog.showModal();
      return true;
    }
    if (mode !== "hangar-launch") return false;
    if (!cell || !cells().has(Rules.key(cell.x, cell.y))) {
      note("请选择单位移动范围内的有效出击格子");
      return true;
    }
    reopenCarrier = getUnit(launching)?.embarked?.carrierId || null;
    selected = launching;
    request("launch", { unitId: launching, unitIds: launchingIds.length ? launchingIds : [launching], x: cell.x, y: cell.y });
    return true;
  }
  dialog.addEventListener("cancel", () => {
    inspected = null;
    cancel();
    update();
  });
  return { open, actionButton, refresh, cells, click, cancel };
})();
window.HangarUI = HangarUI;
