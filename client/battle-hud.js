/* 战斗界面的视图控制。复用原指令按钮，不参与战局裁定。 */
const BattleHUD = (() => {
  const scene = byId("gameScene"),
    roster = byId("hudRosterPanel"),
    panel = byId("hudUnitPanel"),
    commands = byId("hudUnitCommands"),
    legend = scene.querySelector(".legend"),
    settings = byId("openClientSettings"),
    settingsHome = document.createComment("settings-button-home"),
    music = byId("musicPlayer"),
    musicHome = document.createComment("music-player-home");
  music.before(musicHome);
  settings.before(settingsHome);
  const terrainInfo = element("div", "hud-terrain-strip");
  terrainInfo.id = "hudTerrainInfo";
  terrainInfo.append(byId("mapEnvironment"), byId("hoverInfo"));
  byId("mapWrap").append(terrainInfo, byId("hudActionBand"));
  const pickingAction = () =>
    ["move", "attack-target", "attack-weapons", "target", "hangar-launch", "hangar-board"].includes(
      mode,
    ) || mode.startsWith("skill:");
  scene.append(byId("reaction"));
  const defender = byId("reaction").querySelector(".response-defender"),
    responseBody = element("div", "hud-response-body"),
    confirm = byId("confirmResponse");
  responseBody.append(...[...defender.childNodes].filter((node) => node !== confirm));
  defender.append(responseBody, confirm);
  byId("hudTurnActions").append(byId("confirmDeployment"), byId("endTurn"));
  // 查看资料是玩家主动打开的开关，不随单位选择重置。
  let infoEnabled = false;
  const infoButton = element("button", "", "信息");
  infoButton.dataset.unitCommand = "info";
  infoButton.setAttribute("aria-controls", "hudUnitPanel");
  infoButton.onclick = () => {
    infoEnabled = !infoEnabled;
    refresh();
  };
  let tab = "overview",
    lastSelection = null,
    lastMode = "select",
    rosterOpen = false,
    consoleSize = "normal";
  const tabs = [...scene.querySelectorAll("[data-hud-tab]")];
  legend.hidden = true;
  function applyTab() {
    for (const button of tabs) {
      const active = button.dataset.hudTab === tab;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    }
    for (const pane of byId("unitPanel").querySelectorAll("[data-hud-pane]")) {
      pane.hidden = pane.dataset.hudPane !== tab;
      pane.id = "hudPane-" + pane.dataset.hudPane;
      pane.setAttribute("role", "tabpanel");
      pane.setAttribute(
        "aria-labelledby",
        tabs.find((b) => b.dataset.hudTab === pane.dataset.hudPane).id,
      );
    }
    for (const button of tabs)
      button.setAttribute("aria-controls", "hudPane-" + button.dataset.hudTab);
  }
  function setTab(value) {
    tab = value;
    infoEnabled = true;
    refresh();
    byId("unitPanel").scrollTop = 0;
  }
  for (const button of tabs) {
    button.onclick = () => setTab(button.dataset.hudTab);
    button.onkeydown = (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const next =
        tabs[(tabs.indexOf(button) + (event.key === "ArrowRight" ? 1 : 2)) % tabs.length];
      setTab(next.dataset.hudTab);
      next.focus();
    };
  }
  function toggleRoster(value = !rosterOpen) {
    rosterOpen = value;
    roster.hidden = !value;
    byId("hudToggleRoster").setAttribute("aria-expanded", String(value));
  }
  byId("hudToggleRoster").onclick = () => toggleRoster();
  byId("hudCloseRoster").onclick = () => toggleRoster(false);
  byId("hudToggleLegend").onclick = () => {
    legend.hidden = !legend.hidden;
    byId("hudToggleLegend").setAttribute("aria-expanded", String(!legend.hidden));
  };
  function resizeConsole(size) {
    consoleSize = size;
    scene.dataset.consoleSize = size;
    const open = size !== "collapsed";
    byId("hudCollapseConsole").textContent = open ? "−" : "+";
    byId("hudCollapseConsole").setAttribute("aria-expanded", String(open));
    byId("hudCollapseConsole").setAttribute(
      "aria-label",
      I18n.text(open ? "收起信息栏" : "展开信息栏"),
    );
    byId("hudExpandConsole").setAttribute("aria-pressed", String(size === "expanded"));
    MapCamera.refresh();
  }
  byId("hudCollapseConsole").onclick = () =>
    resizeConsole(consoleSize === "collapsed" ? "normal" : "collapsed");
  byId("hudExpandConsole").onclick = () =>
    resizeConsole(consoleSize === "expanded" ? "normal" : "expanded");
  for (const id of ["showLog", "showChat"])
    byId(id).addEventListener("click", () => {
      if (consoleSize === "collapsed") resizeConsole("normal");
    });
  function clearSelection() {
    if (pageView !== "game" || !["idle", "deployment"].includes(phase)) return;
    selected = weaponId = null;
    mode = "select";
    AttackControls.reset();
    update();
  }
  function cancelAction() {
    if (pageView !== "game" || !["idle", "deployment"].includes(phase) || !pickingAction()) return;
    window.HangarUI?.cancel();
    AttackControls.reset();
    weaponId = null;
    mode = "select";
    update();
  }
  byId("hudCancelAction").onclick = cancelAction;
  byId("hudCloseUnit").onclick = () => {
    infoEnabled = false;
    refresh();
  };
  byId("hudSelectionSummary").onclick = () => {
    infoEnabled = true;
    refresh();
  };
  document.addEventListener("keydown", (event) => {
    if (
      event.repeat ||
      event.defaultPrevented ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      pageView !== "game" ||
      phase !== "idle" ||
      event.target.closest("input,textarea,select,[contenteditable=true]") ||
      document.querySelector("dialog[open], .overlay:not([hidden])")
    )
      return;
    const command = { q: "move", w: "attack", e: "skills", h: "hangar", v: "wait" }[
      event.key.toLowerCase()
    ];
    if (!command) return;
    const button = [...document.querySelectorAll(`[data-unit-command="${command}"]`)].find(
      (b) => !b.disabled && b.getClientRects().length,
    );
    if (button) {
      event.preventDefault();
      button.click();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key !== "Escape" ||
      event.defaultPrevented ||
      pageView !== "game" ||
      event.target.closest("input,textarea,select") ||
      document.querySelector("dialog[open], .overlay:not([hidden])")
    )
      return;
    if (pickingAction()) cancelAction();
    else if (rosterOpen) toggleRoster(false);
    else clearSelection();
  });
  function refreshRoomStatus() {
    const snapshot = Net.active ? Net.snapshot : null;
    const roomName = Net.local ? I18n.text("离线遭遇战") : snapshot?.room || Net.room || "—";
    const roomLabel = byId("hudRoomName");
    roomLabel.textContent = I18n.text("房间名") + ": " + roomName;
    roomLabel.title = roomName;
    byId("hudPing").textContent =
      "PING " + (Net.local ? I18n.text("离线") : Net.pingMs === null ? "—" : Net.pingMs + " ms");
    const members = (snapshot?.members || []).filter((member) => member.connected);
    const players = members.filter((member) => member.seat !== null).length;
    const spectators = members.length - players;
    byId("hudPlayerCount").textContent =
      I18n.text("玩家人数") +
      ": " +
      players +
      "/" +
      (snapshot?.connected?.length || 0) +
      (spectators ? " · " + I18n.text("观战玩家") + ": " + spectators : "");
    byId("hudPlayerCount").title = byId("hudPlayerCount").textContent;
  }
  byId("spectatorView").onchange = () => {
    const value = byId("spectatorView").value;
    Net.request("spectate", { team: value === "global" ? null : Number(value) });
  };
  function refresh() {
    const active = pageView === "game",
      unit = getUnit(selected),
      inCombat = ["battle", "reaction", "reaction_wait", "playback_wait", "moving"].includes(phase);
    document.body.classList.toggle("battle-hud-active", active);
    if (active) refreshRoomStatus();
    const headerButtons = scene.querySelector(".header-buttons");
    if (active && settings.parentElement !== headerButtons) headerButtons.append(settings);
    else if (!active && settings.previousSibling !== settingsHome) settingsHome.after(settings);
    if (active && music.parentElement !== byId("hudMusicSlot")) byId("hudMusicSlot").append(music);
    else if (!active && music.previousSibling !== musicHome) musicHome.after(music);
    if (lastSelection !== selected) {
      tab = "overview";
      byId("unitPanel").scrollTop = 0;
      if (selected) toggleRoster(false);
    }
    if (lastMode !== mode) {
      if (mode === "target" || mode.startsWith("skill:")) tab = "skills";
    }
    lastMode = mode;
    lastSelection = selected;
    const actionActive =
      active && !!unit && ["idle", "deployment"].includes(phase) && pickingAction();
    scene.dataset.actionStage = actionActive ? mode : "none";
    const spectating = active && Net.active && Net.seat === null && Net.started;
    byId("hudActionBand").hidden = !actionActive && !spectating;
    byId("hudCancelAction").hidden = spectating;
    byId("spectatorViewControl").hidden = !spectating;
    if (spectating) {
      const select = byId("spectatorView"),
        values = ["global", ...(Net.snapshot?.viewTeams || []).map(String)];
      if (
        Array.from(select.options)
          .map((option) => option.value)
          .join("|") !== values.join("|")
      ) {
        select.replaceChildren();
        for (const value of values) select.add(new Option("", value));
      }
      for (const option of select.options)
        option.textContent =
          option.value === "global"
            ? I18n.text("上帝视角")
            : I18n.text("队伍") + (Number(option.value) + 1);
      select.value = Net.snapshot?.viewTeam === null ? "global" : String(Net.snapshot?.viewTeam);
      select.disabled = !!Net.awaiting || Net.socket?.readyState !== WebSocket.OPEN;
    }
    const attackPlanner = byId("hudAttackPlanner"),
      editor = byId("attackEditor");
    attackPlanner.replaceChildren();
    attackPlanner.hidden = !actionActive || mode !== "attack-weapons" || !editor;
    if (!attackPlanner.hidden) attackPlanner.append(editor);
    // 攻击编排临时使用同一个右侧栏，不改变信息开关。
    panel.hidden =
      !active || !unit || inCombat || (attackPlanner.hidden && (!infoEnabled || actionActive));
    panel.dataset.planning = String(!attackPlanner.hidden);
    panel.querySelector(".hud-panel-heading span").textContent = I18n.text(
      attackPlanner.hidden ? "单位信息" : "武器与攻击计划",
    );
    byId("unitPanel").hidden = !attackPlanner.hidden;
    scene.querySelector(".hud-unit-tabs").hidden = !attackPlanner.hidden;
    byId("hudCloseUnit").hidden = !attackPlanner.hidden;
    infoButton.setAttribute("aria-pressed", String(infoEnabled));
    if (actionActive) {
      const moving = mode === "move",
        attacking = mode.startsWith("attack");
      byId("hudCancelAction").textContent = I18n.text(
        moving
          ? "取消移动"
          : attacking
            ? "取消攻击"
            : mode === "hangar-launch"
              ? "取消出击"
              : mode === "hangar-board"
                ? "取消搭载"
                : "取消技能",
      );
    }
    roster.hidden = !active || !rosterOpen || inCombat;
    const actions = byId("unitActions");
    commands.replaceChildren();
    const own = unit && unit.team === game.team && (!Net.active || Net.canControl(unit));
    commands.hidden =
      !active || !unit || inCombat || actionActive || !["idle", "deployment"].includes(phase);
    scene.dataset.unitCommands = String(!commands.hidden);
    if (!commands.hidden) {
      const row = actions || element("div", "actions");
      const canCommand =
        own &&
        phase === "idle" &&
        !(unit.acted && !unit.plan) &&
        !isAI() &&
        (!Net.active || Net.canAct()) &&
        !isBusy();
      for (const button of row.children)
        button.hidden =
          button.dataset.unitCommand === "hangar"
            ? !["idle", "deployment"].includes(phase)
            : !canCommand;
      row.prepend(infoButton);
      infoButton.hidden = false;
      row.hidden = false;
      commands.append(row);
    } else if (actions) actions.hidden = true;
    byId("hudSelectionSummary").textContent = unit ? unitName(unit) : "";
    byId("hudSelectionSummary").setAttribute("data-i18n-ignore", "");
    if (!active) {
      toggleRoster(false);
      legend.hidden = true;
      byId("hudToggleLegend").setAttribute("aria-expanded", "false");
    }
    applyTab();
  }
  window.BattleHUD = { refresh, refreshRoomStatus, setTab, clearSelection };
  refresh();
  return window.BattleHUD;
})();
