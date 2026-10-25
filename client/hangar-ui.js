/* 搭载面板与出击落点选择。所有操作仍通过服务器/离线房间意图裁定。 */
const HangarUI = (() => {
  const dialog = element("dialog", "hangar-dialog");
  dialog.id = "hangarDialog";
  dialog.setAttribute("aria-label", "格纳库");
  document.body.append(dialog);
  let inspected = null,
    launching = null,
    boarding = null,
    boardingCarrier = null,
    launchLocations = [];
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
        Rules.hangars.embark(game, u, getUnit(fields.carrierId), fields.hangarId);
      else PlanningUI.move(Rules.hangars.launch(game, u, fields.x, fields.y));
      addLog(`${logUnit(u)} ${action === "embark" ? "搭载" : "出击"}。`);
      update();
    } catch (error) {
      note(error.message);
    }
  }
  function board(u, carrier, h) {
    cancel();
    dialog.close();
    request("embark", { unitId: u.id, carrierId: carrier.id, hangarId: h.id });
  }
  function row(u) {
    const box = element("div", "hangar-unit");
    const icon = element("img");
    icon.src = unitIcon(u.model);
    icon.alt = "";
    const info = element("div", "hangar-unit-info");
    const name = element("strong", "", unitName(u));
    name.setAttribute("data-i18n-ignore", "");
    info.append(
      name,
      element(
        "small",
        "muted",
        `${UnitIdentity.owner(u).name} · ${Rules.modelOf(u).transport.slotCost} ${I18n.text("容量点")} · HP ${formatNumber(u.hp)} · EN ${formatNumber(u.en)}`,
      ),
    );
    box.append(icon, info);
    return box;
  }
  function render() {
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
    dialog.append(
      header,
      element(
        "p",
        "helper",
        "搭载结束本次行动；下次己方回合可出击。出击视为已移动，仍可攻击。部署阶段可预装。",
      ),
      element("p", "helper", "出击后行动点减少25%（向上取整），舰船不能撤回移动。"),
      element("p", "helper", "搭载中每次己方回合恢复25%耐久、50% EN，并随机修复两个受损零件。"),
      content,
    );
    if (Net.active && Net.team() !== null && selectedUnit.team !== Net.team()) {
      content.append(element("p", "helper", "无法查看敌军格纳库的载员"));
      return;
    }
    const carrierMode = Rules.hangars.of(selectedUnit).length > 0;
    if (!carrierMode) dialog.querySelectorAll(":scope > .helper").forEach((node) => node.remove());
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
            `${I18n.text("格纳库")} ${Rules.hangars.of(carrier).indexOf(h) + 1} · ${Rules.hangars.used(game, carrier, h.id)} / ${h.capacity} ${I18n.text("容量点")}`,
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
          const item = row(u);
          item.dataset.cargoId = u.id;
          const locations = allowed(u) ? Rules.hangars.launchCells(game, u) : [];
          if (carrierMode)
            item.append(
              button(
                "出击",
                () => {
                  launching = u.id;
                  selected = carrier.id;
                  mode = "hangar-launch";
                  weaponId = null;
                  dialog.close();
                  update();
                },
                !locations.length,
              ),
            );
          section.append(item);
        }
        if (!carrierMode) {
          const embark = button(
            "搭乘",
            () => board(selectedUnit, carrier, h),
            !allowed(selectedUnit) || !Rules.hangars.canEmbark(game, selectedUnit, carrier, h.id),
          );
          embark.dataset.boardId = selectedUnit.id;
          section.append(embark);
        }
        if (!Rules.hangars.cargo(game, carrier, h.id).length)
          section.append(element("p", "helper", "暂无载员"));
        content.append(section);
      }
    }
    if (carrierMode)
      dialog.append(
        element("p", "helper", "舰毁紧急退出会损失25%最大耐久和盾牌，无有效落点则损失载员。"),
      );
  }
  function boardingTargets(u) {
    return game.units.filter((c) =>
      Rules.hangars.of(c).some((h) => Rules.hangars.canEmbark(game, u, c, h.id)),
    );
  }
  function open(u) {
    if (!Rules.hangars.of(u).length) {
      if (!allowed(u) || !boardingTargets(u).length) return;
      cancel();
      boarding = u.id;
      selected = u.id;
      mode = "hangar-board";
      weaponId = null;
      update();
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
        Rules.hangars.of(c).some((h) => Rules.hangars.canEmbark(game, u, c, h.id)),
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
    launching = boarding = boardingCarrier = null;
    launchLocations = [];
    if (["hangar-launch", "hangar-board"].includes(mode)) mode = "select";
  }
  function refresh() {
    if (launching && (!getUnit(launching)?.embarked || !["idle", "deployment"].includes(phase)))
      cancel();
    if (
      boarding &&
      (!allowed(getUnit(boarding)) ||
        selected !== boarding ||
        !boardingTargets(getUnit(boarding)).length)
    ) {
      cancel();
      dialog.close();
    }
    launchLocations = launching ? Rules.hangars.launchCells(game, getUnit(launching)) : [];
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
    request("launch", { unitId: launching, x: cell.x, y: cell.y });
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
