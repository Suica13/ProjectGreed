/* seat 是出生席位；seat%2 是阵营。所有者保持不变，操作权限可由房间或本人共享给友军。 */
const RoomPanel = (() => {
  let settingsKey = "",
    pendingSettings = null,
    submittedNumericSettings = null,
    numericSettingsTimer = null,
    queuedNumericSettings = {};
  const numericDrafts = { costLimit: null, unitCostLimit: null, unitLimit: null };
  const formationPresets = new Set([
    "1000,250,12",
    "2000,400,12",
    "4000,800,12",
    "6000,1200,12",
    "8000,1600,12",
    "10000,2000,12",
  ]);
  function showFormationPreset(settings) {
    const values = ["costLimit", "unitCostLimit", "unitLimit"].map(
      (key) => numericDrafts[key] ?? settings[key],
    );
    const preset = values.join(",");
    byId("roomFormationPreset").value = formationPresets.has(preset) ? preset : "custom";
  }
  const joinButtons = [byId("joinTeam1"), byId("joinTeam2")];
  let detail = null;
  // 只更新席位文字；倒计时无需请求服务器或重建房间面板。
  function updateReconnectCountdowns() {
    const snapshot = Net.snapshot;
    if (!snapshot) return;
    const now =
      Number.isFinite(snapshot.receivedAt) && Number.isFinite(snapshot.serverTime)
        ? snapshot.serverTime + performance.now() - snapshot.receivedAt
        : Date.now();
    for (const label of document.querySelectorAll("[data-reconnect-until]")) {
      const seconds = Math.max(0, Math.ceil((Number(label.dataset.reconnectUntil) - now) / 1000));
      label.textContent = "重连 " + seconds + "s";
    }
  }
  setInterval(updateReconnectCountdowns, 250);
  function playerLabel(member, self, snapshot) {
    const label = element("strong", "player-name player-other"),
      name = element("span", "", member.name);
    name.setAttribute("data-i18n-ignore", "");
    label.append(name);
    if (member.shareUnits || snapshot.settings.shareAlliedUnits)
      label.append(element("span", "host-badge", "共享"));
    if (member.bot) label.append(element("span", "host-badge", "AI"));
    return label;
  }
  function factionControl(member, self, snapshot) {
    const badge = PlayerProfile.badge(member, snapshot.settings.mode);
    if (!badge) return element("span", "faction-badge", "—");
    const editingAI = member.bot && self.id === snapshot.hostId;
    if ((!editingAI && member.id !== self.id) || snapshot.started) return badge;
    const forced =
      member.seat === null ? null : snapshot.settings.teamFactions?.[Rules.seatTeam(member.seat)];
    const select = element("select", badge.className);
    for (const faction of ["PMC", "EFSF", "ZEON"])
      select.add(new Option(PlayerProfile.displayFaction(faction), faction));
    select.value = member.characterFaction;
    select.disabled = !!Net.awaiting || !!forced || snapshot.settings.mode === "quick";
    select.title =
      snapshot.settings.mode === "quick"
        ? "快速战固定使用 PMC 阵营"
        : forced
          ? "本队已设置强制阵营"
          : editingAI
            ? "选择 AI 阵营"
            : "选择自己的阵营";
    select.setAttribute("aria-label", editingAI ? "选择 AI 阵营" : "选择自己的阵营");
    select.onchange = () =>
      editingAI
        ? Net.request("configure_ai", {
            seat: member.seat,
            characterFaction: select.value,
            config: {},
          })
        : Net.request("set_faction", { faction: select.value });
    return select;
  }
  function drawMap(map) {
    const canvas = byId("roomMapPreview"),
      ctx = canvas.getContext("2d");
    canvas.width = 520;
    canvas.height = 190;
    const cell = Math.min((canvas.width - 30) / map.width, (canvas.height - 24) / map.height);
    const ox = (canvas.width - map.width * cell) / 2,
      oy = (canvas.height - map.height * cell) / 2;
    ctx.fillStyle = "#16191e";
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
    ctx.fillStyle = map.environment === "space" ? "#b788ff" : "#f2a044";
    ctx.fillRect(6, 6, 56, 22);
    ctx.fillStyle = "#101521";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(I18n.text(map.environment === "space" ? "宇宙" : "地面"), 11, 22);
    canvas.setAttribute("aria-label", map.name + " · " + map.width + "×" + map.height);
    byId("roomMapTitle").textContent = "[" + map.spawns.length + "P]" + map.name;
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
      ["bannedTypes", "禁用类型", Rules.unitTags],
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
          selectedTags.length
            ? selectedTags
                .map((tag) => (key === "bannedTypes" ? I18n.text(Rules.unitTagName(tag)) : tag))
                .join(", ")
            : I18n.text("不禁用"),
          "",
        );
        summary.disabled = true;
        summary.selected = true;
        select.add(summary);
        select.add(new Option(I18n.text("不禁用"), "NONE"));
        select.add(new Option(I18n.text("禁用全部"), "ALL"));
        for (const tag of values)
          select.add(
            new Option(
              (key === "bannedTypes" ? I18n.text(Rules.unitTagName(tag)) : tag) +
                (selectedTags.includes(tag) ? " ✓" : ""),
              tag,
            ),
          );
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
    const restrictions = { bannedFactions: [], bannedEras: [], bannedTypes: [] };
    for (const select of parent.querySelectorAll("select[data-key]"))
      restrictions[select.dataset.key] = JSON.parse(select.dataset.bannedTags);
    return restrictions;
  }
  function renderSettings(snapshot, busy) {
    const settings = snapshot.settings || Rules.defaultRoomSettings();
    const mapSelect = byId("roomMapSelect");
    mapSelect.replaceChildren();
    for (const map of Object.values(Rules.catalog.maps)) {
      const option = new Option(map.name, map.id);
      option.disabled = !!map.supportedModes && !map.supportedModes.includes(settings.mode);
      mapSelect.add(option);
    }
    const nextKey = JSON.stringify([snapshot.room, snapshot.you?.id, snapshot.hostId]);
    if (nextKey !== settingsKey) {
      settingsKey = nextKey;
      numericDrafts.costLimit = numericDrafts.unitCostLimit = numericDrafts.unitLimit = null;
      submittedNumericSettings = null;
      queuedNumericSettings = {};
      clearTimeout(numericSettingsTimer);
      numericSettingsTimer = null;
    }
    mapSelect.value = settings.mapId;
    byId("roomUnitLimit").value = numericDrafts.unitLimit ?? settings.unitLimit;
    byId("roomCostLimit").value = numericDrafts.costLimit ?? settings.costLimit;
    byId("roomUnitCostLimit").value = numericDrafts.unitCostLimit ?? settings.unitCostLimit;
    const locked = snapshot.started || snapshot.you?.id !== snapshot.hostId || busy;
    showFormationPreset(settings);
    byId("roomFormationPreset").disabled = locked;
    byId("roomShareAlliedUnits").value = settings.shareAlliedUnits ? "enabled" : "disabled";
    byId("roomShareAlliedUnits").disabled = locked;
    byId("roomFogMode").value = settings.fogMode || "full";
    byId("roomBattleMode").value = settings.mode || "regular";
    for (const id of ["roomMapSelect", "roomFogMode", "roomBattleMode"])
      byId(id).disabled = locked || (id === "roomMapSelect" && !!snapshot.loadedSave);
    byId("roomMapChoiceHint").textContent = I18n.text(
      snapshot.loadedSave ? "存档地图已锁定" : locked ? "地图由房主选择" : "点击名称更换地图",
    );
    // 数值输入时仍可继续打字，不因上一笔请求未确认而失去焦点。
    for (const id of ["roomCostLimit", "roomUnitCostLimit", "roomUnitLimit"])
      byId(id).disabled = snapshot.started || snapshot.you?.id !== snapshot.hostId;
    tagControls(byId("roomTagRestrictions"), "roomBan", settings, locked, () => {
      sendSettings(readTags(byId("roomTagRestrictions")));
    });
    const teamRulesPanel = byId("roomTeamRestrictions");
    const expandedTeams = [...teamRulesPanel.querySelectorAll(".team-filters")].map(
      (item) => item.open,
    );
    teamRulesPanel.replaceChildren();
    byId("roomTeamRulesTitle").textContent =
      settings.mode === "quick" ? "队伍禁用标签" : "队伍强制阵营";
    if (settings.mode === "quick") {
      for (let team = 0; team < 2; team++) {
        const group = element("details", "team-filters");
        group.open = expandedTeams[team] || false;
        group.append(element("summary", "", "队伍" + (team + 1) + "禁用标签"));
        const controls = element("div", "tag-restrictions");
        tagControls(
          controls,
          "teamBan-" + team,
          settings.teamRestrictions?.[team] || {},
          locked,
          () => {
            const restrictions = [...(Net.snapshot.settings.teamRestrictions || [{}, {}])];
            restrictions[team] = readTags(controls);
            sendSettings({ teamRestrictions: restrictions });
          },
        );
        group.append(controls);
        teamRulesPanel.append(group);
      }
    } else {
      for (let team = 0; team < 2; team++) {
        const group = element("label", "room-team-rules");
        const select = element("select");
        select.id = "teamForcedFaction" + team;
        select.add(new Option("不限", ""));
        select.add(new Option("PMC", "PMC"));
        select.add(new Option("地球联邦军[0079]", "EFSF"));
        select.add(new Option("吉翁公国军[0079]", "ZEON"));
        select.value = settings.teamFactions?.[team] || "";
        select.disabled = locked;
        select.onchange = () => {
          const factions = [...(Net.snapshot.settings.teamFactions || [null, null])];
          factions[team] = select.value || null;
          sendSettings({ teamFactions: factions });
        };
        group.append(element("span", "", "队伍" + (team + 1) + "强制阵营"), select);
        teamRulesPanel.append(group);
      }
    }
    byId("roomCostLimit").step = Rules.catalog.formation.costStep;
    byId("roomCostLimit").min = Math.min(...Object.values(UnitModels).map((model) => model.cost));

    drawMap(Rules.getMap(mapSelect.value));
  }
  function closeDetail() {
    detail = null;
    byId("roomDetailPanel").close();
    byId("roomMain").inert = false;
  }
  function armyControls(player, snapshot, locked) {
    const panel = element("div", "ai-settings");
    const required =
      player.seat === null ? null : snapshot.settings.teamFactions?.[Rules.seatTeam(player.seat)];
    const factionLabel = element("label", "", "AI 阵营");
    const faction = element("select");
    for (const [value, label] of [
      ["PMC", "PMC"],
      ["EFSF", "地球联邦军[0079]"],
      ["ZEON", "吉翁公国军[0079]"],
    ])
      faction.add(new Option(label, value));
    faction.value = player.characterFaction || "PMC";
    faction.disabled = locked || !!required || snapshot.settings.mode === "quick";
    faction.onchange = () =>
      Net.request("configure_ai", {
        seat: player.seat,
        config: {},
        characterFaction: faction.value,
      });
    factionLabel.append(faction);
    const strengthLabel = element("label", "", "AI 单位强度");
    const strength = element("select");
    for (const percent of Rules.strengthPercentages)
      strength.add(new Option(percent + "%", String(percent)));
    const config = Rules.armySettings(player);
    strength.value = String(Rules.aiPerformance[config.difficulty] * 100);
    strength.disabled = locked;
    strength.onchange = () =>
      Net.request("configure_ai", {
        seat: player.seat,
        config: { difficulty: Number(strength.value) },
      });
    strengthLabel.append(strength);
    panel.append(factionLabel, strengthLabel);
    return panel;
  }
  function quickArmyControls(player, snapshot, locked) {
    const section = element("section", "room-detail-section");
    section.append(element("h3", "", "COST 与强度设置"));
    const grid = element("div", "room-army-rules");
    const config = Rules.armySettings(player);
    for (const [key, label, value] of [
      ["fill", "编组 COST 比例", config.fill],
      ["unitCostPercent", "单位 COST 比例", config.unitCostPercent],
      ["countPercent", "编组点数比例", config.countPercent],
      ["difficulty", "单位强度", Math.round(Rules.aiPerformance[config.difficulty] * 100)],
    ]) {
      const field = element("label", "", label);
      const select = element("select");
      for (const percent of key === "difficulty" ? Rules.strengthPercentages : Rules.armyPercentages)
        select.add(new Option(percent + "%", String(percent)));
      select.value = String(value);
      select.disabled = locked;
      select.onchange = () =>
        Net.request(
          player.bot ? "configure_ai" : "configure_player",
          player.bot
            ? { seat: player.seat, config: { [key]: Number(select.value) } }
            : { memberId: player.id, config: { [key]: Number(select.value) } },
        );
      field.append(select);
      grid.append(field);
    }
    section.append(grid);
    const budget = Rules.armyBudget(snapshot.settings, player);
    const unitLimit = Rules.armyUnitLimit(snapshot.settings, player);
    const unitCost = Rules.armyRestrictions(snapshot.settings, player).unitCostLimit;
    section.append(
      element(
        "p",
        "muted room-army-summary",
        "当前上限：编组 COST " + budget + " · 单位 COST " + unitCost + " · 单位点数 " + unitLimit,
      ),
    );
    return section;
  }
  function restrictionSummary(restrictions = {}) {
    const tags = [
      ...(restrictions.bannedFactions || []),
      ...(restrictions.bannedEras || []),
      ...(restrictions.bannedTypes || []).map((tag) => I18n.text(Rules.unitTagName(tag))),
    ];
    return tags.join("、") || "不禁用";
  }
  function appendTagDetails(content, restrictions) {
    for (const [key, title] of [
      ["bannedFactions", "禁用阵营"],
      ["bannedEras", "禁用年代"],
      ["bannedTypes", "禁用类型"],
    ]) {
      const tags = restrictions?.[key] || [];
      content.append(
        element(
          "p",
          "",
          title +
            "：" +
            (tags
              .map((tag) => (key === "bannedTypes" ? I18n.text(Rules.unitTagName(tag)) : tag))
              .join("、") || "不禁用"),
        ),
      );
    }
  }
  function renderDetail(snapshot) {
    if (!detail) return;
    if (Number.isInteger(detail.team)) {
      const team = detail.team;
      const quick = snapshot.settings.mode === "quick";
      byId("roomDetailTitle").textContent =
        "队伍" + (team + 1) + (quick ? " · 禁用标签" : " · 阵营规则");
      const content = byId("roomDetailContent");
      content.classList.remove("member-management");
      content.replaceChildren();
      if (quick) {
        content.append(element("h3", "", "队伍禁用标签"));
        appendTagDetails(content, snapshot.settings.teamRestrictions?.[team]);
      } else {
        content.append(
          element("p", "", "强制阵营：" + (snapshot.settings.teamFactions?.[team] || "不限")),
        );
      }
      content.append(element("h3", "", "房间禁用标签"));
      appendTagDetails(content, snapshot.settings);
      if (!byId("roomDetailPanel").open) byId("roomDetailPanel").showModal();
      byId("roomMain").inert = true;
      return;
    }
    const player = snapshot.members.find((member) => member.id === detail.memberId);
    if (!player) return closeDetail();
    const playerName = element("span", "", player.name);
    playerName.setAttribute("data-i18n-ignore", "");
    byId("roomDetailTitle").replaceChildren(
      playerName,
      element("span", "", " · " + I18n.text(player.bot ? "AI 管理" : "玩家管理")),
    );
    const content = byId("roomDetailContent");
    content.classList.add("member-management");
    content.replaceChildren();
    const locked = !!Net.awaiting || snapshot.started || snapshot.you.id !== snapshot.hostId;
    if (snapshot.settings.mode === "quick") {
      const switchView = element(
        "button",
        "room-detail-switch",
        detail.view === "rules" ? "返回玩家管理" : "COST 与强度设置",
      );
      switchView.type = "button";
      switchView.onclick = () => {
        detail.view = detail.view === "rules" ? "manage" : "rules";
        renderDetail(Net.snapshot);
        content.querySelector(".room-detail-switch")?.focus();
      };
      content.append(switchView);
      if (detail.view === "rules") {
        content.append(quickArmyControls(player, snapshot, locked));
        if (!byId("roomDetailPanel").open) byId("roomDetailPanel").showModal();
        byId("roomMain").inert = true;
        return;
      }
    } else if (player.bot) {
      const aiSection = element("section", "room-detail-section");
      aiSection.append(element("h3", "", "AI 设置"), armyControls(player, snapshot, locked));
      content.append(aiSection);
    }
    const seatSection = element("section", "room-detail-section");
    seatSection.append(element("h3", "", "席位"));
    const seatRow = element("div", "room-detail-seat-row");
    const label = element("label", "", "队伍 / 位置");
    const select = element("select");
    select.id = "managePlayerSeat";
    if (!player.bot) select.add(new Option(I18n.text("观战席"), "spectator"));
    for (const [seat, spawn] of Rules.getMap(snapshot.settings.mapId).spawns.entries()) {
      if (snapshot.members.some((member) => member.seat === seat && member.id !== player.id))
        continue;
      select.add(
        new Option(I18n.text("队伍" + (spawn.team + 1)) + " · 位置" + spawn.position, seat),
      );
    }
    select.value = player.seat === null ? "spectator" : String(player.seat);
    select.disabled = locked;
    label.append(select);
    const move = element("button", "primary", "调整席位");
    move.id = "applyPlayerSeat";
    move.disabled = locked;
    move.onclick = () =>
      Net.request("move_player", {
        memberId: player.id,
        seat: select.value === "spectator" ? null : Number(select.value),
      });
    seatRow.append(label, move);
    seatSection.append(seatRow);
    content.append(seatSection);
    if (player.bot || player.id !== snapshot.you.id) {
      const actionSection = element("section", "room-detail-section room-detail-danger");
      actionSection.append(element("h3", "", player.bot ? "移除 AI" : "玩家操作"));
      const remove = element("button", "danger", player.bot ? "移除 AI" : "踢出玩家");
      remove.id = player.bot ? "removeAI" + player.seat : "kickPlayer";
      remove.disabled = !!Net.awaiting || snapshot.started || snapshot.you.id !== snapshot.hostId;
      remove.onclick = () => {
        Net.request(
          player.bot ? "remove_ai" : "kick_player",
          player.bot ? { seat: player.seat } : { memberId: player.id },
        );
      };
      actionSection.append(remove);
      content.append(actionSection);
    }
    if (!byId("roomDetailPanel").open) byId("roomDetailPanel").showModal();
    byId("roomMain").inert = true;
  }
  function detailButton(player, snapshot) {
    const button = element("button", "room-member-button");
    button.type = "button";
    button.id =
      (player.bot ? "aiSettings" : "managePlayer-") + (player.bot ? player.seat : player.id);
    button.append(playerLabel(player, snapshot.you, snapshot));
    button.title = player.bot ? "管理 AI" : "管理玩家";
    button.setAttribute("aria-label", button.title + "：" + player.name);
    button.onclick = () => {
      detail = { memberId: player.id, view: "manage" };
      renderDetail(Net.snapshot);
      byId("closeRoomDetail").focus();
    };
    return button;
  }
  byId("closeRoomDetail").onclick = closeDetail;
  byId("roomDetailPanel").addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDetail();
  });
  window.addEventListener("page-changing", closeDetail);
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
    const active = snapshot.started && snapshot.phase === "assembly";
    byId("finalAssemblyPanel").hidden = !active;
    byId("roomLobbyContent").hidden = active;
    byId("roomActions").hidden = active;
    if (!active) return;
    byId("roomStatus").hidden = false;
    byId("roomStatus").textContent = snapshot.loadedSave
      ? "最终编组确认后继续存档对局。"
      : "最终编组确认后进入部署。";
    const squads = byId("finalSquads");
    squads.replaceChildren();
    const observing = snapshot.you?.seat === null;
    byId("finalAssemblyPanel").classList.toggle("is-observer", observing);
    squads.classList.toggle("team-grouped", observing);
    const teamLists = new Map();
    if (observing) for (const team of [0, 1]) {
      const section = element("section", "final-squad-team");
      section.dataset.team = team;
      section.setAttribute("aria-label", I18n.text("队伍" + (team + 1)));
      const list = element("div", "final-squad-team-list");
      section.append(element("h4", "", "队伍" + (team + 1)), list);
      squads.append(section);
      teamLists.set(team, list);
    }
    for (const player of snapshot.assembly?.players || []) {
      const card = element("section", "final-squad");
      card.dataset.memberId = player.memberId;
      const team = Rules.seatTeam(player.seat);
      card.dataset.team = team;
      const heading = element("div", "final-squad-heading"),
        name = element("strong", playerNameClass(player.memberId), player.name);
      name.setAttribute("data-i18n-ignore", "");
      const member = snapshot.members.find((entry) => entry.id === player.memberId);
      const badge = PlayerProfile.badge(member, snapshot.settings.mode);
      if (badge) heading.append(badge);
      heading.append(
        name,
        element(
          "span",
          "",
          "编组COST: " +
            player.totalCost +
            " / " +
            (player.assignedPreset ? I18n.text("无限") : player.limit) +
            " · 单位COST上限: " +
            (player.assignedPreset ? I18n.text("无限") : player.unitCostLimit) +
            " · 单位点数: " +
            Rules.formationPoints(player.entries) +
            " / " +
            player.unitLimit,
        ),
        element(
          "span",
          "ready-status " + (player.ready ? "is-ready" : "not-ready"),
          player.ready ? "已确认" : "待确认",
        ),
      );
      const icons = element("div", "final-unit-icons");
      player.entries.forEach((entry, index) => {
        const id = entry.unitId + "__" + entry.kitId,
          model = UnitModels[id];
        const icon = element(
          "div",
          "final-unit-icon" +
            (player.disabled.includes(index) && player.reasons?.[index] !== "not_developed"
              ? " unit-disabled " +
                (["not_allowed", "not_developed", "wip"].includes(player.reasons?.[index])
                  ? "not-allowed"
                  : "overcost")
              : ""),
        );
        if (player.dead?.includes(index)) {
          icon.classList.add("unit-dead");
          icon.setAttribute("aria-label", I18n.text("阵亡"));
        }
        icon.dataset.index = index;
        icon.dataset.model = id;
        icon.title =
          (entry.customName || model.name) + " · " + model.kitName + " · COST " + model.cost;
        if (entry.customName) icon.setAttribute("data-i18n-ignore", "");
        const image = element("img");
        image.src = unitIcon(id, entry.customPilot);
        image.alt = entry.customName || model.name;
        icon.append(image);
        if (player.reasons?.[index] === "not_developed")
          icon.append(element("span", "unit-undeveloped", "⚠︎ 尚未开发"));
        if (player.disabled.includes(index) && player.reasons?.[index] !== "not_developed")
          icon.append(
            element("span", "disabled-panel"),
            element(
              "span",
              "overcost-label",
              player.reasons?.[index] === "license"
                ? "未获得部署许可"
                : player.reasons?.[index] === "wip"
                  ? "WIP"
                  : player.reasons?.[index] === "faction_mismatch"
                    ? "阵营不匹配"
                    : player.reasons?.[index] === "not_developed"
                      ? "尚未开发"
                      : player.reasons?.[index] === "count"
                        ? "超过单位点数"
                        : player.reasons?.[index] === "not_allowed"
                          ? "不被允许的单位"
                          : "OVER COST",
            ),
          );
        icons.append(icon);
      });
      card.append(heading, icons);
      (teamLists.get(team) || squads).append(card);
    }
    const own = snapshot.assembly?.players.find((player) => player.memberId === snapshot.you?.id);
    byId("editFinalFormation").hidden = true;
    const allBots =
      snapshot.you?.id === snapshot.hostId &&
      snapshot.members.filter((player) => player.seat !== null).every((player) => player.bot);
    byId("confirmFinalFormation").hidden = !own && !allBots;
    byId("returnAssemblyToRoom").hidden = snapshot.you?.id !== snapshot.hostId;
    byId("returnAssemblyToRoom").disabled = busy || !!snapshot.returnCountdown;
    byId("editFinalFormation").disabled = busy || !!own?.assignedPreset;
    byId("confirmFinalFormation").disabled =
      busy ||
      !!own?.ready ||
      (!!snapshot.loadedSave && Object.keys(own?.reasons || {}).length > 0) ||
      (!snapshot.loadedSave && !allBots && !own?.entries.length) ||
      !snapshot.connected.every(Boolean);
    byId("confirmFinalFormation").textContent = own?.ready
      ? "已确认，等待其他玩家"
      : "确认出击编组";
    byId("finalAssemblyStatus").textContent = !snapshot.connected.every(Boolean)
      ? "等待全部席位玩家连接。"
      : snapshot.loadedSave
        ? "存档编组不可修改；黑色遮罩表示阵亡单位。"
        : own && !own.deployable.length
          ? "至少需要一台可出击单位"
          : "超限时从编组末尾向前禁用；不符合标签限制的单位无法出击。";
  }
  function render(snapshot) {
    Formation.alignWithRoom(snapshot);
    if (!Net.awaiting) {
      pendingSettings = null;
      for (const [key, value] of Object.entries(submittedNumericSettings || {})) {
        if (snapshot.settings?.[key] === value && Number(numericDrafts[key]) === value)
          numericDrafts[key] = null;
      }
      submittedNumericSettings = null;
      if (numericSettingsTimer === null && Object.keys(queuedNumericSettings).length)
        queueMicrotask(flushNumericSettings);
    }
    // 选择后立即预览；操作仍由服务端确认，失败时恢复已确认的设置。
    if (pendingSettings) snapshot = { ...snapshot, settings: pendingSettings };
    const roster = snapshot.members || [],
      self = snapshot.you || {},
      own = roster.find((member) => member.id === self.id);
    const busy = !!Net.awaiting,
      map = Rules.getMap(snapshot.settings?.mapId),
      limit = Rules.armyBudget(snapshot.settings, own);
    Chat.refreshStatus();
    Chat.refreshNames(snapshot);
    renderSettings(snapshot, busy);
    const inBattle = snapshot.started && snapshot.phase !== "assembly";
    byId("roomMain").dataset.inBattle = String(inBattle);
    byId("roomFormationControls").hidden = inBattle;
    const shareButton = byId("shareUnitsToAllies");
    shareButton.hidden = !inBattle;
    shareButton.disabled =
      busy ||
      self.seat === null ||
      !!own?.shareUnits ||
      !!snapshot.settings.shareAlliedUnits ||
      snapshot.phase === "finished";
    shareButton.textContent =
      snapshot.settings.shareAlliedUnits || own?.shareUnits ? "已共享单位给友军" : "共享单位给友军";
    byId("roomFormation").disabled =
      !!snapshot.loadedSave || snapshot.started || busy || !!own?.formationPreset;
    const formationSelect = byId("roomFormationSelect");
    formationSelect.replaceChildren();
    const presets = Formation.presets();
    presets.forEach((preset, index) => {
      const option = new Option(I18n.text("编组") + ": " + preset.name, String(index));
      option.setAttribute("data-i18n-ignore", "");
      formationSelect.add(option);
    });
    if (own?.formationPreset) {
      const option = new Option(
        I18n.text("房主指定") + ": " + own.formationPreset.name,
        "assigned",
      );
      option.setAttribute("data-i18n-ignore", "");
      formationSelect.add(option);
      formationSelect.value = "assigned";
    } else formationSelect.value = String(Formation.presetIndex());
    if (snapshot.loadedSave) {
      formationSelect.replaceChildren(new Option(I18n.text("存档编组"), "saved"));
    }
    formationSelect.disabled =
      !!snapshot.loadedSave || snapshot.started || busy || !!own?.formationPreset;
    let disabledCount = 0,
      valid = true;
    try {
      const units = own?.formationPreset?.units || Formation.current();
      Rules.validateFormation(units, Infinity, Rules.armyUnitLimit(snapshot.settings, own));
      const plan = Rules.planFormation(
        units,
        limit,
        { ...Rules.armyRestrictions(snapshot.settings, own), licenses: undefined },
        Rules.armyUnitLimit(snapshot.settings, own),
      );
      valid = !!plan.deployable.length;
      disabledCount = plan.disabled.length;
    } catch {
      valid = false;
    }
    if (snapshot.loadedSave) {
      valid = true;
      disabledCount = 0;
    }
    const warning = byId("roomFormationWarning");
    warning.textContent = !valid || disabledCount ? "不符合编组规则" : "";
    warning.hidden = valid && !disabledCount;
    byId("roomFormation").classList.toggle(
      "action-attention",
      !snapshot.started && (!valid || disabledCount > 0),
    );
    formationSelect.setAttribute("aria-invalid", String(!valid || !!disabledCount));
    byId("roomTitle").textContent = Net.local
      ? "离线" + (snapshot.settings.mode === "quick" ? "快速战" : "常规战") + "房间"
      : "房间 " + snapshot.room;
    byId("roomStatus").hidden = !snapshot.started && !snapshot.loadedSave;
    byId("roomStatus").textContent = snapshot.connected.every(Boolean)
      ? "游戏进行中，可切换席位或返回战斗。"
      : "等待空队伍补位或离线玩家恢复，战局已暂停。";
    if (snapshot.loadedSave)
      byId("roomStatus").textContent =
        I18n.text("已加载存档") +
        " · " +
        I18n.text("回合") +
        snapshot.loadedSave.round +
        " · " +
        I18n.text("编组已锁定");
    const teams = byId("teamSlots");
    teams.classList.toggle("observer-teams", self.seat === null);
    for (const button of joinButtons) button.remove();
    teams.replaceChildren();
    for (let team = 0; team < 2; team++) {
      const column = element("section", "team-slot");
      column.dataset.team = String(team);
      const teamHeading = element("div", "team-heading");
      const forced = snapshot.settings.teamFactions?.[team];
      const summary = element(
        "button",
        "team-ban-summary",
        snapshot.settings.mode === "quick"
          ? "队伍禁用：" + restrictionSummary(snapshot.settings.teamRestrictions?.[team])
          : "强制阵营：" + (forced || "不限"),
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
      column.setAttribute("role", "table");
      column.setAttribute("aria-label", "队伍" + (team + 1));
      const seats = map.spawns
        .map((spawn, seat) => ({ spawn, seat }))
        .filter((item) => item.spawn.team === team);
      const header = element("div", "lineup-header");
      header.append(
        element("span", "", "玩家ID / 空位"),
        element("span", "", "位置"),
        element("span", "", "阵营"),
        element("span", "", "状态"),
      );
      header.setAttribute("role", "row");
      for (const cell of header.children) cell.setAttribute("role", "columnheader");
      column.append(header);
      for (const { spawn, seat } of seats) {
        const member = roster.find((player) => player.seat === seat);
        const reserved = snapshot.reservedSeats?.find((item) => item.seat === seat);
        const slot = element("div", "spawn-slot");
        slot.dataset.seat = seat;
        slot.setAttribute("role", "row");
        const nameCell = element("div", "lineup-name");
        nameCell.append(
          member
            ? detailButton(member, snapshot)
            : element("strong", "player-name player-other", reserved ? "等待重连" : "空位"),
        );
        if (reserved && self.id === snapshot.hostId) {
          const kick = element("button", "choose-spawn danger", "踢出");
          kick.dataset.kickReservedSeat = seat;
          kick.disabled = busy;
          kick.onclick = () => Net.request("kick_player", { memberId: reserved.memberId });
          nameCell.append(kick);
        }
        if (!snapshot.started && self.id === snapshot.hostId && !member && !reserved) {
          const addAI = element("button", "choose-spawn", "添加 AI");
          addAI.id = "addAI" + seat;
          addAI.disabled = busy;
          addAI.onclick = () => Net.request("add_ai", { seat });
          nameCell.append(addAI);
        }
        const positionCell = element("div", "spawn-cell");
        if (member || reserved) {
          positionCell.append(element("span", "spawn-position", "位置" + spawn.position));
        } else {
          const choose = element(
            "button",
            "choose-spawn",
            (inBattle ? "接管" : "位置") + spawn.position,
          );
          choose.id = "chooseSeat" + seat;
          choose.title = inBattle ? "接管位置" + spawn.position : "选择位置" + spawn.position;
          choose.disabled = busy;
          choose.onclick = () => Net.request("switch_seat", { seat });
          positionCell.append(choose);
        }
        const factionCell = element("div", "lineup-faction");
        factionCell.append(
          member ? factionControl(member, self, snapshot) : element("span", "faction-badge", "—"),
        );
        const ready = element(
          "span",
          "lineup-ready " +
            (member?.connected && !snapshot.started
              ? "ready-status " +
                (member.id === snapshot.hostId || member.ready ? "is-ready" : "not-ready")
              : "muted"),
          !member
            ? reserved
              ? "重连"
              : "—"
            : !member.connected
              ? "离线"
              : snapshot.started
                ? "游戏中"
                : member.id === snapshot.hostId
                  ? "房主"
                  : member.ready
                    ? "已准备"
                    : "未准备",
        );
        if (reserved && !member) {
          ready.dataset.reconnectUntil = reserved.until;
          ready.setAttribute("data-i18n-ignore", "");
        }
        slot.append(nameCell, positionCell, factionCell, ready);
        for (const cell of slot.children) cell.setAttribute("role", "cell");
        column.append(slot);
      }
      updateReconnectCountdowns();
      const button = joinButtons[team];
      const current =
        self.seat !== null && self.seat !== undefined && Rules.seatTeam(self.seat) === team;
      const full = !seats.some(
        (item) =>
          !roster.some((player) => player.seat === item.seat) &&
          !snapshot.reservedSeats?.some((reserved) => reserved.seat === item.seat),
      );
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
      slot.append(detailButton(member, snapshot), factionControl(member, self, snapshot));
      if (!member.connected) slot.append(element("span", "", " · 离线"));
      spectators.append(slot);
    }
    if (!watching.length) spectators.append(element("p", "muted", "暂无观战玩家"));
    byId("becomeSpectator").disabled = busy || self.seat === null;
    byId("returnAllToRoom").hidden =
      !snapshot.started || snapshot.phase === "assembly" || self.id !== snapshot.hostId;
    byId("returnAllToRoom").disabled = busy;
    byId("toggleReady").hidden =
      snapshot.started || self.seat === null || self.id === snapshot.hostId;
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

  byId("confirmFinalFormation").onclick = () => {
    const snapshot = Net.snapshot;
    const own = snapshot?.assembly?.players.find((p) => p.memberId === snapshot.you?.id);
    const proceed = () => Net.request("confirm_formation");
    if (!snapshot?.loadedSave && own) Formation.checkLicenses(own.entries, proceed);
    else proceed();
  };
  byId("joinTeam1").onclick = () => joinTeam(0);
  byId("joinTeam2").onclick = () => joinTeam(1);
  byId("becomeSpectator").onclick = () => Net.request("switch_seat", { seat: null });
  byId("returnAllToRoom").onclick = () => BattlePrompts.requestReturn();
  byId("returnAssemblyToRoom").onclick = () => BattlePrompts.requestReturn();
  byId("toggleReady").onclick = () => {
    const self = Net.snapshot?.members.find((member) => member.id === Net.memberId);
    const entries = self?.formationPreset?.units || Formation.current();
    const proceed = () => Net.request("set_ready", { ready: !self?.ready, formation: entries });
    if (!self?.ready && !Net.snapshot?.loadedSave) Formation.checkLicenses(entries, proceed);
    else proceed();
  };
  byId("roomFormationSelect").onchange = () => {
    const snapshot = Net.snapshot;
    if (!snapshot || snapshot.started || Net.awaiting) return;
    if (!Formation.selectPreset(Number(byId("roomFormationSelect").value))) return;
    const units = Formation.current();
    if (snapshot.you?.seat !== null) {
      try {
        if (units.length) Rules.validateFormation(
          units,
          Infinity,
          Rules.armyUnitLimit(
            snapshot.settings,
            snapshot.members.find((p) => p.id === snapshot.you?.id),
          ),
        );
      } catch {
        render(snapshot);
        return;
      }
      Net.request("update_formation", { formation: units });
    } else render(snapshot);
  };
  byId("startRoomGame").onclick = () => {
    const snapshot = Net.snapshot;
    if (!snapshot || snapshot.started || snapshot.you?.id !== snapshot.hostId || Net.awaiting)
      return;
    const own = snapshot.members.find((p) => p.id === snapshot.you?.id);
    const entries = own?.formationPreset?.units || Formation.current();
    const proceed = () => Net.request("start_game", { formation: entries });
    if (!snapshot.loadedSave && own?.seat !== null) Formation.checkLicenses(entries, proceed);
    else proceed();
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
  byId("roomFormationPreset").onchange = () => {
    const preset = byId("roomFormationPreset").value;
    if (!formationPresets.has(preset)) return;
    const [costLimit, unitCostLimit, unitLimit] = preset.split(",").map(Number);
    clearTimeout(numericSettingsTimer);
    numericSettingsTimer = null;
    queuedNumericSettings = {};
    submittedNumericSettings = null;
    numericDrafts.costLimit = numericDrafts.unitCostLimit = numericDrafts.unitLimit = null;
    byId("roomCostLimit").value = costLimit;
    byId("roomUnitCostLimit").value = unitCostLimit;
    byId("roomUnitLimit").value = unitLimit;
    sendSettings({ costLimit, unitCostLimit, unitLimit });
  };
  function flushNumericSettings() {
    clearTimeout(numericSettingsTimer);
    numericSettingsTimer = null;
    const snapshot = Net.snapshot;
    if (!Net.active || !snapshot || snapshot.started || snapshot.you?.id !== snapshot.hostId) {
      queuedNumericSettings = {};
      return;
    }
    // 先等正在进行的操作确认；render 会提交这期间继续输入的最新值。
    if (Net.awaiting || Net.socket?.readyState !== WebSocket.OPEN) return;
    const patch = Object.fromEntries(
      Object.entries(queuedNumericSettings).filter(
        ([key, value]) => value !== snapshot.settings[key],
      ),
    );
    queuedNumericSettings = {};
    if (!Object.keys(patch).length) return;
    submittedNumericSettings = patch;
    sendSettings(patch);
  }
  for (const [id, key, validate, maximum] of [
    ["roomCostLimit", "costLimit", Rules.validateCostLimit, Rules.maxCostLimit],
    ["roomUnitCostLimit", "unitCostLimit", Rules.validateUnitCostLimit, Rules.maxCostLimit],
    ["roomUnitLimit", "unitLimit", Rules.validateUnitLimit, Rules.catalog.formation.maxUnits],
  ]) {
    const input = byId(id);
    input.max = String(maximum);
    input.oninput = () => {
      if (Number(input.value) > maximum) input.value = String(maximum);
      numericDrafts[key] = input.value;
      showFormationPreset(Net.snapshot?.settings || Rules.defaultRoomSettings());
      delete queuedNumericSettings[key];
      try {
        if (!input.value.trim()) throw Error("empty");
        queuedNumericSettings[key] = validate(Number(input.value));
      } catch {}
      clearTimeout(numericSettingsTimer);
      numericSettingsTimer = Object.keys(queuedNumericSettings).length
        ? setTimeout(flushNumericSettings, 300)
        : null;
    };
    input.onchange = flushNumericSettings;
    input.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        flushNumericSettings();
      }
    };
  }
  byId("roomShareAlliedUnits").onchange = () =>
    sendSettings({ shareAlliedUnits: byId("roomShareAlliedUnits").value === "enabled" });
  byId("roomFogMode").onchange = () => sendSettings({ fogMode: byId("roomFogMode").value });
  byId("roomBattleMode").onchange = () =>
    sendSettings({ battleMode: byId("roomBattleMode").value });
  byId("shareUnitsToAllies").onclick = () => Net.request("share_units");
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

// Reuse the live room controls in a top-layer sheet on narrow screens.
(() => {
  const room = byId("roomMain");
  const settings = byId("roomSettingsPage");
  const anchor = document.createComment("room settings home");
  settings.before(anchor);
  const sheet = document.createElement("dialog");
  sheet.id = "roomSettingsSheet";
  sheet.setAttribute("aria-labelledby", "roomSettingsSheetTitle");
  const heading = element("div", "room-sheet-heading");
  const title = element("h2", "", "房间设置");
  title.id = "roomSettingsSheetTitle";
  const close = element("button", "", "关闭");
  close.type = "button";
  close.id = "closeRoomSettingsSheet";
  heading.append(title, close);
  sheet.append(heading);
  room.append(sheet);
  const mobile = matchMedia("(max-width:700px), (max-height:600px) and (orientation:landscape)");
  function selectTab(name) {
    room.dataset.mobileTab = name;
    for (const tab of document.querySelectorAll("[data-room-tab]"))
      tab.setAttribute("aria-pressed", String(tab.dataset.roomTab === name));
  }
  close.onclick = () => sheet.close();
  sheet.addEventListener("close", () => {
    anchor.after(settings);
    selectTab("seats");
  });
  for (const button of document.querySelectorAll("[data-room-tab]")) {
    button.onclick = () => {
      const name = button.dataset.roomTab;
      selectTab(name);
      if (name === "settings" && mobile.matches) {
        sheet.append(settings);
        if (!sheet.open) sheet.showModal();
        close.focus();
      }
    };
  }
  mobile.addEventListener("change", () => { if (sheet.open) sheet.close(); });
  window.addEventListener("page-changing", () => { if (sheet.open) sheet.close(); });
})();
