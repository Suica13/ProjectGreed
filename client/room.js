/* seat 是出生席位；seat%2 是阵营。每个玩家只控制该席位自己的编组。 */
const RoomPanel = (() => {
  let settingsKey = "",
    pendingSettings = null,
    submittedCosts = null,
    costTimer = null,
    queuedCosts = {};
  const costDrafts = { costLimit: null, unitCostLimit: null };
  const joinButtons = [byId("joinTeam1"), byId("joinTeam2")];
  let detail = null;
  function playerLabel(member, self, snapshot) {
    const label = element("strong", playerNameClass(member.id, snapshot.hostId, self.id)),
      name = element("span", "", member.name);
    name.setAttribute("data-i18n-ignore", "");
    label.append(name);
    if (member.bot) label.append(element("span", "host-badge", "AI"));
    if (member.id === snapshot.hostId) label.append(element("span", "host-badge", "房主"));
    return label;
  }
  function drawMap(map) {
    const canvas = byId("roomMapPreview"),
      ctx = canvas.getContext("2d");
    canvas.width = 520;
    canvas.height = 190;
    const cell = Math.min((canvas.width - 30) / map.width, (canvas.height - 24) / map.height);
    const ox = (canvas.width - map.width * cell) / 2,
      oy = (canvas.height - map.height * cell) / 2;
    ctx.fillStyle = "#0b1921";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < map.height; y++)
      for (let x = 0; x < map.width; x++) {
        ctx.fillStyle = Rules.terrainStyle(map.id, map.tiles[y][x]).color;
        ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
      }
    for (const [seat, spawn] of map.spawns.entries()) {
      ctx.strokeStyle = spawn.team === 0 ? "#6bd5ff" : "#ff9a8e";
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        ox + (spawn.x - map.deploymentRadius) * cell,
        oy + (spawn.y - map.deploymentRadius) * cell,
        (map.deploymentRadius * 2 + 1) * cell,
        (map.deploymentRadius * 2 + 1) * cell,
      );
      ctx.beginPath();
      ctx.arc(
        ox + (spawn.x + 0.5) * cell,
        oy + (spawn.y + 0.5) * cell,
        Math.max(4, cell * 0.6),
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.font = "bold 11px sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(
        (spawn.team === 0 ? "A" : "B") + spawn.position,
        ox + (spawn.x + 1) * cell + 5,
        oy + (spawn.y + 0.5) * cell + 3,
      );
    }
    canvas.setAttribute("aria-label", map.name + " · " + map.width + "×" + map.height);
    byId("roomMapInfo").textContent =
      map.name +
      " · " +
      map.width +
      "×" +
      map.height +
      " · " +
      map.spawns.length +
      "人" +
      (map.description ? " · " + map.description : "");
  }
  function tagControls(parent, prefix, restrictions, locked, changed) {
    parent.replaceChildren();
    for (const [key, title, values] of [
      ["bannedFactions", "禁用阵营", Rules.factions],
      ["bannedEras", "禁用年代", Rules.eras],
    ]) {
      const group = element("label", "tag-dropdown"),
        select = element("select");
      select.id = prefix + "-" + key;
      select.dataset.key = key;
      select.setAttribute(
        "aria-label",
        title + (prefix === "roomBan" ? " 房间" : " 队伍" + (Number(prefix.split("-")[1]) + 1)),
      );
      select.disabled = locked;
      let selectedTags = [...(restrictions[key] || [])];
      function refresh() {
        select.dataset.bannedTags = JSON.stringify(selectedTags);
        select.replaceChildren();
        const summary = new Option(
          selectedTags.length ? selectedTags.join(", ") : I18n.text("不禁用"),
          "",
        );
        summary.disabled = true;
        summary.selected = true;
        select.add(summary);
        select.add(new Option(I18n.text("不禁用"), "NONE"));
        select.add(new Option(I18n.text("禁用全部"), "ALL"));
        for (const tag of values)
          select.add(new Option(tag + (selectedTags.includes(tag) ? " ✓" : ""), tag));
      }
      select.onchange = () => {
        const value = select.value;
        if (value === "NONE") selectedTags = [];
        else if (value === "ALL") selectedTags = [...values];
        else
          selectedTags = selectedTags.includes(value)
            ? selectedTags.filter((tag) => tag !== value)
            : [...selectedTags, value];
        refresh();
        changed();
      };
      refresh();
      group.append(element("span", "", title), select);
      parent.append(group);
    }
  }
  function readTags(parent) {
    const restrictions = { bannedFactions: [], bannedEras: [] };
    for (const select of parent.querySelectorAll("select[data-key]"))
      restrictions[select.dataset.key] = JSON.parse(select.dataset.bannedTags);
    return restrictions;
  }
  function renderSettings(snapshot, busy) {
    const settings = snapshot.settings || Rules.defaultRoomSettings();
    const mapSelect = byId("roomMapSelect");
    mapSelect.replaceChildren();
    for (const map of Object.values(Rules.catalog.maps))
      mapSelect.add(new Option(map.name, map.id));
    const nextKey = JSON.stringify([snapshot.room, snapshot.you?.id, snapshot.hostId]);
    if (nextKey !== settingsKey) {
      settingsKey = nextKey;
      costDrafts.costLimit = costDrafts.unitCostLimit = null;
      submittedCosts = null;
      queuedCosts = {};
      clearTimeout(costTimer);
      costTimer = null;
    }
    mapSelect.value = settings.mapId;
    byId("roomUnitLimit").value = settings.unitLimit;
    byId("roomCostLimit").value = costDrafts.costLimit ?? settings.costLimit;
    byId("roomUnitCostLimit").value = costDrafts.unitCostLimit ?? settings.unitCostLimit;
    const locked = snapshot.started || snapshot.you?.id !== snapshot.hostId || busy;
    for (const id of ["roomMapSelect", "roomUnitLimit"]) byId(id).disabled = locked;
    // COST 输入时仍可继续打字，不因上一笔请求未确认而失去焦点。
    for (const id of ["roomCostLimit", "roomUnitCostLimit"])
      byId(id).disabled = snapshot.started || snapshot.you?.id !== snapshot.hostId;
    tagControls(byId("roomTagRestrictions"), "roomBan", settings, locked, () => {
      sendSettings(readTags(byId("roomTagRestrictions")));
    });
    byId("roomCostLimit").step = Rules.catalog.formation.costStep;
    byId("roomCostLimit").min = Math.min(...Object.values(UnitModels).map((model) => model.cost));
    byId("roomSettingsHint").textContent = snapshot.started
      ? "对局开始后不能修改房间设置"
      : snapshot.you?.id === snapshot.hostId
        ? "所有房间设置自动生效；COST输入有效数值后自动更新。修改后全员需重新准备。"
        : "房间与队伍限制由房主设置。";
    drawMap(Rules.getMap(mapSelect.value));
  }
  function closeDetail() {
    detail = null;
    byId("roomDetailPanel").hidden = true;
    byId("roomMain").inert = false;
  }
  function renderDetail(snapshot) {
    if (!detail) return;
    if (Number.isInteger(detail.team)) {
      const team = detail.team,
        settings = snapshot.settings;
      byId("roomDetailTitle").textContent =
        I18n.text("队伍" + (team + 1)) + " · " + I18n.text("队伍禁用标签");
      const content = byId("roomDetailContent");
      content.replaceChildren();
      for (const [title, rules] of [
        ["房间禁用标签", settings],
        ["队伍禁用标签", settings.teamRestrictions[team]],
      ]) {
        content.append(element("h3", "", title));
        for (const [key, label] of [
          ["bannedFactions", "禁用阵营"],
          ["bannedEras", "禁用年代"],
        ])
          content.append(
            element(
              "p",
              "",
              I18n.text(label) + ": " + (rules[key].join(", ") || I18n.text("不禁用")),
            ),
          );
      }
      byId("roomDetailPanel").hidden = false;
      byId("roomMain").inert = true;
      return;
    }
    const player = snapshot.members.find((member) => member.id === detail.memberId);
    if (!player) return closeDetail();
    const playerName = element("span", "", player.name);
    playerName.setAttribute("data-i18n-ignore", "");
    byId("roomDetailTitle").replaceChildren(
      playerName,
      element("span", "", " · " + I18n.text(player.bot ? "AI 设置" : "玩家管理")),
    );
    const content = byId("roomDetailContent");
    content.replaceChildren();
    const locked = !!Net.awaiting || snapshot.started || snapshot.you.id !== snapshot.hostId;
    if (player.bot) {
      const panel = element("div", "ai-settings"),
        config = player.aiSettings || Rules.aiDefaults;
      for (const [key, title, options] of [
        [
          "difficulty",
          "难度",
          [
            ["easy", "简单 · 75%"],
            ["medium", "中等 · 100%"],
            ["hard", "困难 · 125%"],
          ],
        ],
        ["fill", "编组COST比例", [50, 75, 100, 125, 150].map((n) => [n, n + "%"])],
        ["countPercent", "编组数量比例", Rules.aiCountPercentages.map((n) => [n, n + "%"])],
      ]) {
        const label = element("label", "", title),
          select = element("select");
        select.id = "ai-" + key + "-" + player.seat;
        select.setAttribute("aria-label", title + " AI " + (player.seat + 1));
        for (const [value, text] of options) select.add(new Option(text, value));
        select.value = config[key];
        select.disabled = locked;
        select.onchange = () =>
          Net.request("configure_ai", {
            seat: player.seat,
            config: {
              ...config,
              [key]: key === "difficulty" ? select.value : Number(select.value),
            },
          });
        label.append(select);
        panel.append(label);
      }
      panel.append(
        element("p", "muted", "编组COST: " + Rules.aiBudget(snapshot.settings.costLimit, config)),
        element(
          "p",
          "muted",
          `单位数量上限: ${Rules.aiUnitLimit(snapshot.settings.unitLimit, config)} 台（房间上限 ${snapshot.settings.unitLimit} 台 × ${config.countPercent}%）`,
        ),
        element("p", "muted", "优先填满单位槽位，遵守房间与所在队伍的标签限制。"),
      );
      content.append(panel);
    } else {
      const label = element("label", "", "队伍 / 出生地"),
        select = element("select");
      select.id = "managePlayerSeat";
      select.add(new Option(I18n.text("观战席"), "spectator"));
      for (const [seat, spawn] of Rules.getMap(snapshot.settings.mapId).spawns.entries()) {
        if (snapshot.members.some((member) => member.seat === seat && member.id !== player.id))
          continue;
        select.add(
          new Option(
            I18n.text("队伍" + (spawn.team + 1)) + " · " + I18n.text("出生点" + spawn.position),
            seat,
          ),
        );
      }
      select.value = player.seat === null ? "spectator" : String(player.seat);
      select.disabled = locked;
      label.append(select);
      content.append(label);
      const move = element("button", "primary", "调整席位");
      move.id = "applyPlayerSeat";
      move.disabled = locked;
      move.onclick = () =>
        Net.request("move_player", {
          memberId: player.id,
          seat: select.value === "spectator" ? null : Number(select.value),
        });
      content.append(move);
      if (player.id !== snapshot.you.id) {
        const kick = element("button", "danger", "踢出玩家");
        kick.id = "kickPlayer";
        kick.disabled = !!Net.awaiting || snapshot.you.id !== snapshot.hostId;
        kick.onclick = () => Net.request("kick_player", { memberId: player.id });
        content.append(kick);
      }
    }
    byId("roomDetailPanel").hidden = false;
    byId("roomMain").inert = true;
  }
  function detailButton(player, snapshot) {
    const button = element("button", "choose-spawn", player.bot ? "设置" : "管理");
    button.id =
      (player.bot ? "aiSettings" : "managePlayer-") + (player.bot ? player.seat : player.id);
    button.onclick = () => {
      detail = { memberId: player.id };
      renderDetail(Net.snapshot);
      byId("closeRoomDetail").focus();
    };
    return button;
  }
  byId("closeRoomDetail").onclick = closeDetail;
  byId("roomDetailPanel").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeDetail();
    }
    if (event.key === "Tab") {
      const controls = [
        ...byId("roomDetailPanel").querySelectorAll("button:not(:disabled),select:not(:disabled)"),
      ];
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  });
  function renderFinalAssembly(snapshot, busy) {
    const active = snapshot.phase === "assembly";
    byId("finalAssemblyPanel").hidden = !active;
    byId("roomLobbyContent").hidden = active;
    byId("roomActions").hidden = active;
    if (!active) return;
    byId("roomStatus").textContent = "最终编组确认后进入部署。";
    const squads = byId("finalSquads");
    squads.replaceChildren();
    for (const player of snapshot.assembly?.players || []) {
      const card = element("section", "final-squad");
      card.dataset.memberId = player.memberId;
      const heading = element("div", "final-squad-heading"),
        name = element("strong", playerNameClass(player.memberId), player.name);
      name.setAttribute("data-i18n-ignore", "");
      heading.append(
        name,
        element(
          "span",
          "",
          "编组COST: " +
            player.totalCost +
            " / " +
            player.limit +
            " · 单位COST上限: " +
            snapshot.settings.unitCostLimit +
            " · 单位数量: " +
            player.entries.length +
            " / " +
            player.unitLimit,
        ),
        element("span", "muted", player.ready ? "已确认" : "待确认"),
      );
      const icons = element("div", "final-unit-icons");
      player.entries.forEach((entry, index) => {
        const id = entry.unitId + "__" + entry.kitId,
          model = UnitModels[id];
        const icon = element(
          "div",
          "final-unit-icon" +
            (player.disabled.includes(index)
              ? " unit-disabled " +
                (player.reasons?.[index] === "not_allowed" ? "not-allowed" : "overcost")
              : ""),
        );
        icon.dataset.index = index;
        icon.dataset.model = id;
        icon.title = model.name + " · " + model.kitName + " · COST " + model.cost;
        const image = element("img");
        image.src = unitIcon(id);
        image.alt = model.name;
        icon.append(image);
        if (player.disabled.includes(index))
          icon.append(
            element("span", "disabled-panel"),
            element(
              "span",
              "overcost-label",
              player.reasons?.[index] === "not_allowed" ? "不被允许的单位" : "OVER COST",
            ),
          );
        icons.append(icon);
      });
      card.append(heading, icons);
      squads.append(card);
    }
    const own = snapshot.assembly?.players.find((player) => player.memberId === snapshot.you?.id);
    byId("editFinalFormation").hidden = !own;
    const allBots =
      snapshot.you?.id === snapshot.hostId &&
      snapshot.members.filter((player) => player.seat !== null).every((player) => player.bot);
    byId("confirmFinalFormation").hidden = !own && !allBots;
    byId("editFinalFormation").disabled = busy;
    byId("confirmFinalFormation").disabled =
      busy ||
      !!own?.ready ||
      (!allBots && !own?.deployable.length) ||
      !snapshot.connected.every(Boolean);
    byId("confirmFinalFormation").textContent = own?.ready
      ? "已确认，等待其他玩家"
      : "确认出击编组";
    byId("finalAssemblyStatus").textContent = !snapshot.connected.every(Boolean)
      ? "等待全部席位玩家连接。"
      : own && !own.deployable.length
        ? "至少需要一台可出击单位"
        : "超限时从编组末尾向前禁用；不符合标签限制的单位无法出击。";
  }
  function render(snapshot) {
    if (!Net.awaiting) {
      pendingSettings = null;
      for (const [key, value] of Object.entries(submittedCosts || {})) {
        if (snapshot.settings?.[key] === value && Number(costDrafts[key]) === value)
          costDrafts[key] = null;
      }
      submittedCosts = null;
      if (costTimer === null && Object.keys(queuedCosts).length) queueMicrotask(flushCosts);
    }
    // 选择后立即预览；操作仍由服务端确认，失败时恢复已确认的设置。
    if (pendingSettings) snapshot = { ...snapshot, settings: pendingSettings };
    const roster = snapshot.members || [],
      self = snapshot.you || {},
      own = roster.find((member) => member.id === self.id);
    const busy = !!Net.awaiting,
      map = Rules.getMap(snapshot.settings?.mapId),
      limit = snapshot.settings?.costLimit ?? Rules.catalog.formation.maxCost;
    Chat.refreshStatus();
    Chat.refreshNames(snapshot);
    renderSettings(snapshot, busy);
    byId("roomFormation").disabled = snapshot.started || !!own?.ready || busy;
    const squadName = element("span", "", Formation.name());
    squadName.setAttribute("data-i18n-ignore", "");
    let cost = 0,
      disabledCount = 0,
      valid = true;
    try {
      const units = Formation.current();
      cost = units.reduce((sum, e) => sum + UnitModels[e.unitId + "__" + e.kitId].cost, 0);
      Rules.validateFormation(units, Infinity, snapshot.settings.unitLimit);
      const plan = Rules.planFormation(
        units,
        limit,
        Rules.formationRestrictions(snapshot.settings, self.seat),
      );
      valid = !!plan.deployable.length;
      disabledCount = plan.disabled.length;
    } catch {
      valid = false;
    }
    byId("roomFormationSummary").replaceChildren(
      element("span", "", "出战编组："),
      squadName,
      element(
        "span",
        "",
        " · 编组COST: " +
          cost +
          " / " +
          limit +
          " · 单位COST上限: " +
          snapshot.settings.unitCostLimit,
      ),
    );
    byId("roomFormationWarning").textContent = !valid
      ? "编组无效，请调整编组。"
      : disabledCount
        ? "部分单位超限或不被允许，进入对局时无法出击。"
        : "";
    byId("roomTitle").textContent = Net.local ? "离线遭遇战房间" : "房间 " + snapshot.room;
    byId("roomStatus").textContent = snapshot.started
      ? snapshot.connected.every(Boolean)
        ? "游戏进行中，可切换席位或返回战斗。"
        : "等待空队伍补位或离线玩家恢复，战局已暂停。"
      : "房主可在出生席位未满时开始；其他出战玩家需先准备。";
    const teams = byId("teamSlots");
    const expandedFilters = [...teams.querySelectorAll(".team-filters")].map((panel) => panel.open);
    for (const button of joinButtons) button.remove();
    teams.replaceChildren();
    for (let team = 0; team < 2; team++) {
      const column = element("section", "team-slot");
      const teamHeading = element("div", "team-heading");
      const effective = Rules.formationRestrictions(snapshot.settings, team);
      const banned = [...effective.bannedFactions, ...effective.bannedEras];
      const summary = element(
        "button",
        "team-ban-summary",
        banned.length ? I18n.text("禁用标签") + ": " + banned.join(", ") : I18n.text("不禁用"),
      );
      summary.id = "teamBanSummary" + team;
      summary.title = summary.textContent;
      summary.setAttribute("aria-haspopup", "dialog");
      summary.onclick = () => {
        detail = { team };
        renderDetail(Net.snapshot);
        byId("closeRoomDetail").focus();
      };
      teamHeading.append(element("h3", "", "队伍" + (team + 1)), summary, joinButtons[team]);
      column.append(teamHeading);
      const filterDetails = element("details", "team-filters"),
        filterControls = element("div", "tag-restrictions");
      filterDetails.append(element("summary", "", "队伍禁用标签"));
      const locked = snapshot.started || self.id !== snapshot.hostId || busy;
      filterDetails.open = expandedFilters[team] ?? false;
      const teamRules = snapshot.settings.teamRestrictions[team];
      tagControls(filterControls, "teamBan-" + team, teamRules, locked, () => {
        const restrictions = structuredClone(Net.snapshot.settings.teamRestrictions);
        restrictions[team] = readTags(filterControls);
        sendSettings({ teamRestrictions: restrictions });
      });
      filterDetails.append(filterControls);
      column.append(filterDetails);
      column.setAttribute("role", "table");
      column.setAttribute("aria-label", "队伍" + (team + 1));
      const seats = map.spawns
        .map((spawn, seat) => ({ spawn, seat }))
        .filter((item) => item.spawn.team === team);
      const header = element("div", "lineup-header");
      header.append(
        element("span", "", "玩家ID/空位"),
        element("span", "", "出生地"),
        element("span", "", "准备状态"),
      );
      header.setAttribute("role", "row");
      for (const cell of header.children) cell.setAttribute("role", "columnheader");
      column.append(header);
      for (const { spawn, seat } of seats) {
        const member = roster.find((player) => player.seat === seat);
        const slot = element("div", "spawn-slot");
        slot.dataset.seat = seat;
        slot.setAttribute("role", "row");
        const nameCell = element("div", "lineup-name");
        nameCell.append(
          member
            ? playerLabel(member, self, snapshot)
            : element("strong", "player-name player-other", "空位"),
        );
        if (member?.bot || (member && self.id === snapshot.hostId))
          nameCell.append(detailButton(member, snapshot));
        slot.append(nameCell);
        const spawnCell = element("div", "spawn-cell");
        const choose = element(
          "button",
          "choose-spawn",
          "出生点" + spawn.position + " · " + String.fromCharCode(65 + spawn.x) + (spawn.y + 1),
        );
        choose.id = "chooseSeat" + seat;
        choose.title = self.seat === seat ? "当前出生点" : "选择出生点" + spawn.position;
        choose.disabled = busy || !!member;
        choose.onclick = () => Net.request("switch_seat", { seat });
        spawnCell.append(choose);
        if (!snapshot.started && self.id === snapshot.hostId && (!member || member.bot)) {
          const aiButton = element("button", "choose-spawn", member ? "移除 AI" : "添加 AI");
          aiButton.id = (member ? "removeAI" : "addAI") + seat;
          aiButton.disabled = busy;
          aiButton.onclick = () => Net.request(member ? "remove_ai" : "add_ai", { seat });
          spawnCell.append(aiButton);
        }
        const ready = element(
          "span",
          "lineup-ready muted",
          !member
            ? "—"
            : !member.connected
              ? "离线 · 保留席位"
              : snapshot.started
                ? "游戏中"
                : member.ready
                  ? "已准备"
                  : "未准备",
        );

        slot.append(spawnCell, ready);
        for (const cell of slot.children) cell.setAttribute("role", "cell");
        column.append(slot);
      }
      const button = joinButtons[team];
      const current =
        self.seat !== null && self.seat !== undefined && Rules.seatTeam(self.seat) === team;
      const full = !seats.some((item) => !roster.some((player) => player.seat === item.seat));
      button.disabled = busy || current || full;
      button.textContent = current
        ? "当前队伍" + (team + 1)
        : full
          ? "队伍" + (team + 1) + "已满"
          : "加入队伍" + (team + 1);
      button.title = full && !current ? "该队伍没有空出生点，请先腾出席位。" : "";
      teams.append(column);
    }
    const spectators = byId("spectatorSlots");
    spectators.replaceChildren();
    const watching = roster.filter((member) => member.seat === null);
    for (const member of watching) {
      const slot = element("div", "spectator-slot");
      slot.append(playerLabel(member, self, snapshot));
      if (self.id === snapshot.hostId) slot.append(detailButton(member, snapshot));
      if (!member.connected) slot.append(element("span", "", " · 离线"));
      spectators.append(slot);
    }
    if (!watching.length) spectators.append(element("p", "muted", "暂无观战玩家"));
    byId("becomeSpectator").disabled = busy || self.seat === null;
    byId("returnAllToRoom").hidden =
      !snapshot.started || snapshot.phase === "assembly" || self.id !== snapshot.hostId;
    byId("returnAllToRoom").disabled = busy;
    byId("toggleReady").hidden = snapshot.started || self.seat === null;
    byId("toggleReady").disabled = busy || (!own?.ready && !valid);
    byId("toggleReady").textContent = own?.ready ? "取消准备" : "准备";
    const participants = roster.filter((player) => player.seat !== null);
    byId("startRoomGame").hidden = snapshot.started || self.id !== snapshot.hostId;
    byId("startRoomGame").disabled =
      busy ||
      (self.seat !== null && !valid) ||
      participants.some(
        (player) => !player.connected || (player.id !== self.id && !player.ready),
      ) ||
      ![0, 1].every((team) => participants.some((player) => Rules.seatTeam(player.seat) === team));
    byId("roomMainMenu").textContent =
      snapshot.started && snapshot.phase !== "assembly" ? "返回战斗" : "主菜单";
    renderFinalAssembly(snapshot, busy);
    renderDetail(snapshot);
  }
  function joinTeam(team) {
    const snapshot = Net.snapshot;
    if (!snapshot || Net.awaiting) return;
    // Send a team intent; the authority chooses a currently empty spawn.
    Net.request("join_team", { team });
  }
  byId("editFinalFormation").onclick = () => Formation.open();
  byId("confirmFinalFormation").onclick = () => Net.request("confirm_formation");
  byId("joinTeam1").onclick = () => joinTeam(0);
  byId("joinTeam2").onclick = () => joinTeam(1);
  byId("becomeSpectator").onclick = () => Net.request("switch_seat", { seat: null });
  byId("returnAllToRoom").onclick = () => {
    const snapshot = Net.snapshot;
    if (!snapshot?.started || snapshot.you?.id !== snapshot.hostId || Net.awaiting) return;
    Net.request("return_room", { matchId: snapshot.matchId });
  };
  byId("toggleReady").onclick = () => {
    const self = Net.snapshot?.members.find((member) => member.id === Net.memberId);
    Net.request("set_ready", { ready: !self?.ready, formation: Formation.current() });
  };
  byId("startRoomGame").onclick = () => {
    const snapshot = Net.snapshot;
    if (!snapshot || snapshot.started || snapshot.you?.id !== snapshot.hostId || Net.awaiting)
      return;
    Net.request("start_game", { formation: Formation.current() });
  };
  function sendSettings(patch) {
    const snapshot = Net.snapshot;
    if (!snapshot || snapshot.started || snapshot.you?.id !== snapshot.hostId || Net.awaiting)
      return;
    // 每次只提交本次修改，保留服务端已确认的其他设置。
    pendingSettings = { ...snapshot.settings, ...patch };
    Net.request("configure_room", pendingSettings);
  }
  byId("roomMapSelect").onchange = () => sendSettings({ mapId: byId("roomMapSelect").value });
  byId("roomUnitLimit").oninput = () => {
    const value = Number(byId("roomUnitLimit").value);
    if (Number.isInteger(value) && value >= 3 && value <= Rules.catalog.formation.maxUnits)
      sendSettings({ unitLimit: value });
  };
  function flushCosts() {
    clearTimeout(costTimer);
    costTimer = null;
    const snapshot = Net.snapshot;
    if (!Net.active || !snapshot || snapshot.started || snapshot.you?.id !== snapshot.hostId) {
      queuedCosts = {};
      return;
    }
    // 先等正在进行的操作确认；render 会提交这期间继续输入的最新值。
    if (Net.awaiting || Net.socket?.readyState !== WebSocket.OPEN) return;
    const patch = Object.fromEntries(
      Object.entries(queuedCosts).filter(([key, value]) => value !== snapshot.settings[key]),
    );
    queuedCosts = {};
    if (!Object.keys(patch).length) return;
    submittedCosts = patch;
    sendSettings(patch);
  }
  for (const [id, key, validate] of [
    ["roomCostLimit", "costLimit", Rules.validateCostLimit],
    ["roomUnitCostLimit", "unitCostLimit", Rules.validateUnitCostLimit],
  ]) {
    const input = byId(id);
    input.oninput = () => {
      costDrafts[key] = input.value;
      delete queuedCosts[key];
      try {
        if (!input.value.trim()) throw Error("empty");
        queuedCosts[key] = validate(Number(input.value));
      } catch {}
      clearTimeout(costTimer);
      costTimer = Object.keys(queuedCosts).length ? setTimeout(flushCosts, 300) : null;
    };
    input.onchange = flushCosts;
    input.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        flushCosts();
      }
    };
  }
  byId("roomSettings").onclick = () => {
    setPageView("room");
    render(Net.snapshot);
  };
  byId("roomMainMenu").onclick = () => {
    if (Net.snapshot?.started && Net.snapshot.phase !== "assembly") {
      setPageView("game");
      Net.applySnapshot(Net.snapshot);
    } else requestMenu();
  };
  window.addEventListener("language-change", () => {
    if (pageView === "room" && Net.snapshot) render(Net.snapshot);
  });
  return { render };
})();
