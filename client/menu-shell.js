/* Persistent pre-battle navigation. Pages share the existing room/socket and editors. */
window.MenuShell = (() => {
  const shell = byId("menuShell");
  const subnav = byId("shellSubnav");
  const sectionFor = (view) =>
    ({
      menu: "lobby",
      campaign: "lobby",
      room: "lobby",
      formation: "hangar",
      production: "hangar",
      development: "hangar",
      encyclopedia: "hangar",
      records: "records",
    })[view];
  let navigating = false;
  function leaveEditor() {
    if (pageView === "formation") byId("saveFormation").click();
  }
  function go(view) {
    if (Net.snapshot?.campaign && !Net.started && ["formation", "pilots", "production", "development"].includes(view)) {
      window.CampaignUI?.open(view === "production" ? "production" : view === "development" ? "research" : "units");
      return;
    }
    if (navigating || (Net.started && Net.snapshot?.phase !== "assembly")) return;
    navigating = true;
    try {
      if (view === "pilots" || view === "formation") {
        if (pageView !== "formation") {
          leaveEditor();
          byId("openFormation").click();
        }
        byId(view === "pilots" ? "formationPilotsTab" : "formationUnitsTab").click();
      } else {
        if (pageView === view) return;
        leaveEditor();
        if (view === "production") byId("openProduction").click();
        else if (view === "development") byId("openDevelopment").click();
        else if (view === "encyclopedia") Encyclopedia.open();
        else {
          setPageView(view);
          if (view === "room" && Net.snapshot) RoomPanel.render(Net.snapshot);
        }
      }
      refresh();
    } finally {
      navigating = false;
    }
  }
  function tab(label, action, selected = false, disabled = false) {
    const button = element("button", "shell-subtab", label);
    button.type = "button";
    button.setAttribute("aria-pressed", String(selected));
    button.disabled = disabled;
    button.onclick = action;
    return button;
  }
  function refresh() {
    const inBattle = pageView === "campaign" || pageView === "game" || (Net.started && Net.snapshot?.phase !== "assembly");
    shell.hidden = inBattle;
    byId("shellSidebar").hidden = inBattle;
    document.body.classList.toggle("menu-shell-active", !inBattle);
    document.body.dataset.page = pageView;
    byId("shellRecordsScreen").hidden = pageView !== "records";
    if (inBattle) return;
    const section = sectionFor(pageView) || "lobby";
    byId("formationPageTitle").textContent = I18n.text(
      byId("formationMain").dataset.page === "pilots" ? "驾驶员" : "编组",
    );
    byId("mainLobbyTitle").textContent = I18n.text(Lobby.endpoint() ? "服务器列表" : "大厅");
    for (const button of shell.querySelectorAll("[data-shell-section]"))
      button.setAttribute("aria-pressed", String(button.dataset.shellSection === section));
    const tabs = [];
    if (section === "lobby") {
      if (Net.snapshot?.campaign) tabs.push(tab("战略地图", () => window.CampaignUI?.open(), pageView === "campaign"));
      tabs.push(tab("作战大厅", () => go("menu"), pageView === "menu"));
      tabs.push(tab("当前房间", () => go("room"), pageView === "room", !Net.active));
      tabs.push(
        tab(
          "服务器活动",
          () => byId("openServerActivities").click(),
          false,
          byId("openServerActivities").disabled,
        ),
      );
      tabs.at(-1).id = "shellActivities";
      tabs.at(-1).classList.toggle(
        "has-unclaimed",
        Number(byId("openServerActivities").dataset.unread) > 0,
      );
    } else if (section === "hangar") {
      const pilots = pageView === "formation" && byId("formationMain").dataset.page === "pilots";
      tabs.push(tab("编组", () => go("formation"), pageView === "formation" && !pilots));
      tabs.push(tab("驾驶员", () => go("pilots"), pilots));
      tabs.push(tab("部署许可", () => go("production"), pageView === "production"));
      tabs[2].id = "shellProduction";
      tabs.push(tab("开发", () => go("development"), pageView === "development"));
      tabs[3].id = "shellDevelopment";
      tabs.push(tab("图鉴", () => go("encyclopedia"), pageView === "encyclopedia"));
      tabs[4].id = "shellEncyclopedia";
    } else {
      tabs.push(tab("回放文件", () => byId("openReplayFile").click()));
    }
    subnav.replaceChildren(...tabs);
    const status = byId("shellRoomStatus");
    status.textContent = Net.active
      ? I18n.text("房间") +
        " " +
        Net.room +
        " · " +
        I18n.text(Net.snapshot?.phase === "assembly" ? "最终编组" : "已连接")
      : "";
    status.classList.toggle("connected", Net.active);
    status.disabled = !Net.active;
    status.hidden = !Net.active;
    byId("shellRoomControls").hidden = !Net.active;
    byId("shellLeaveRoom").hidden = !Net.active;
    byId("openSkirmish").textContent = I18n.text(Net.active ? "返回房间" : "开始战斗");
    byId("openSkirmish").disabled = !assetsReady || (!!Lobby.endpoint() && !Net.active);
    // Room identity is fixed at join time; keep account controls consistent with it.
    byId("menuFactionSelect").disabled = Net.active;
    byId("playerId").disabled = Net.active;
    byId("shellSettings").textContent = I18n.text("设置");
  }
  // Keep the battle-creation overlay outside the fixed, clipped lobby content pane.
  document.body.append(byId("skirmishSetup"));
  window.addEventListener("page-changing", () => { byId("skirmishSetup").hidden = true; });
  // Keep a single instance of editable profile controls and their existing handlers.
  const profileRow = byId("playerId").closest(".menu-profile-row");
  profileRow.prepend(byId("menuResources"));
  byId("shellProfile").append(profileRow);
  byId("shellIdentity").append(byId("menuFactionSelect").closest(".menu-faction"));
  const progressRow = element("div", "menu-faction-progress");
  progressRow.id = "menuFactionProgress";
  byId("menuTechProgress").before(progressRow);
  progressRow.append(byId("shellIdentity"), byId("menuTechProgress"));
  byId("start").removeAttribute("aria-modal");
  byId("start").setAttribute("role", "region");
  byId("shellLobby").onclick = () => go(Net.active ? "room" : "menu");
  byId("shellHangar").onclick = () => go("formation");
  byId("shellRecords").onclick = () => go("records");
  byId("shellSettings").onclick = () => byId("openClientSettings").click();
  byId("shellRoomStatus").onclick = () => go("room");
  byId("shellLeaveRoom").onclick = requestMenu;
  byId("openSkirmish").addEventListener(
    "click",
    (event) => {
      if (!Net.active) return;
      event.stopImmediatePropagation();
      go("room");
    },
    true,
  );
  byId("shellOpenReplay").onclick = () => byId("openReplayFile").click();
  byId("shellOpenRecords").onclick = () => byId("openMatchRecords").click();
  for (const id of ["formationUnitsTab", "formationPilotsTab"])
    byId(id).addEventListener("click", refresh);
  for (const event of [
    "character-selected",
    "language-change",
    "economy-changed",
    "lobby-connection-changed",
    "server-activities-changed",
    "game-assets-ready",
  ])
    window.addEventListener(event, refresh);
  new MutationObserver(refresh).observe(byId("openServerActivities"), {
    attributes: true,
    attributeFilter: ["disabled"],
  });
  function updateShellMetrics() {
    if (shell.hidden) return;
    document.body.style.setProperty("--shell-height", shell.getBoundingClientRect().height + "px");
    const sidebar = byId("shellSidebar");
    const mobileHeight = window.matchMedia("(max-width: 720px)").matches && !sidebar.hidden
      ? sidebar.getBoundingClientRect().height : 0;
    document.body.style.setProperty("--shell-subnav-height", mobileHeight + "px");
  }
  const shellResizeObserver = new ResizeObserver(updateShellMetrics);
  shellResizeObserver.observe(shell);
  shellResizeObserver.observe(byId("shellSidebar"));
  window.addEventListener("resize", updateShellMetrics);
  refresh();
  return { refresh, go, returnView: () => (Net.active ? "room" : "menu") };
})();
