/* seat 是出生席位；seat%2 是阵营。所有者保持不变，操作权限可由房间或本人共享给友军。 */
const RoomPanel = (() => {
  let settingsKey = "",
    pendingSettings = null,
    submittedNumericSettings = null,
    numericSettingsTimer = null,
    queuedNumericSettings = {};
  const numericDrafts = { costLimit: null, unitCostLimit: null, unitLimit: null };
  const formationPresets = new Set([
    "2000,250,36",
    "2000,400,36",
    "4000,800,36",
    "6000,1200,36",
    "8000,1600,36",
    "10000,2000,36",
  ]);
  const presetStorageKey = "projectgreed.room-rule-presets.v1";
  function presetRules(settings) {
    if (typeof settings.shareAlliedUnits !== "boolean") throw Error("友军共享设置无效");
    return {
      costLimit: Rules.validateCostLimit(settings.costLimit),
      unitCostLimit: Rules.validateUnitCostLimit(settings.unitCostLimit),
      unitLimit: Rules.validateUnitLimit(settings.unitLimit),
      fogMode: Rules.validateFogMode(settings.fogMode),
      shareAlliedUnits: settings.shareAlliedUnits,
      pilotPolicy: Rules.validatePilotPolicy(settings.pilotPolicy),
      ...Rules.validateTagRestrictions(Object.fromEntries(
        ["bannedFactions", "bannedEras", "bannedTypes"].map(key => [key, settings[key]])
      )),
      teamRestrictions: Rules.validateTeamRestrictions(settings.teamRestrictions),
    };
  }
  let savedPresets = [];
  try {
    const stored = JSON.parse(localStorage.getItem(presetStorageKey) || "[]");
    if (Array.isArray(stored)) for (const item of stored.slice(0, 30)) {
      try {
        if (typeof item.name !== "string" || !item.name.trim() || item.name.length > 40 ||
            typeof item.id !== "string" || !/^saved-[a-z0-9-]{1,80}$/.test(item.id) ||
            savedPresets.some(p => p.id === item.id || p.name === item.name.trim())) continue;
        savedPresets.push({id:item.id, name:item.name.trim(), rules:presetRules(item.rules)});
      } catch { /* Ignore an invalid entry without losing other saved presets. */ }
    }
  } catch { /* A damaged browser setting must not prevent room creation. */ }
  function savedPresetOptions() {
    const select = byId("roomFormationPreset");
    select.querySelector("optgroup[data-saved-presets]")?.remove();
    if (!savedPresets.length) return;
    const group = document.createElement("optgroup");
    group.label = I18n.text("已保存预设");
    group.dataset.savedPresets = "";
    for (const preset of savedPresets) {
      const option = new Option(preset.name, preset.id);
      option.dataset.i18nIgnore = "";
      group.append(option);
    }
    select.insertBefore(group, select.querySelector('option[value="custom"]'));
  }
  savedPresetOptions();
  function showFormationPreset(settings) {
    const values = ["costLimit", "unitCostLimit", "unitLimit"].map(
      key => numericDrafts[key] ?? settings[key],
    );
    let saved;
    try {
      const current = presetRules({...settings, ...Object.fromEntries(
        ["costLimit", "unitCostLimit", "unitLimit"].map((key, i) => [key, Number(values[i])])
      )});
      saved = savedPresets.find(p => JSON.stringify(p.rules) === JSON.stringify(current));
    } catch { /* An unfinished numeric input is a custom draft. */ }
    const preset = values.join(",");
    byId("roomFormationPreset").value = saved?.id || (formationPresets.has(preset) ? preset : "custom");
    byId("deleteRoomPreset").disabled = !saved || byId("roomFormationPreset").disabled;
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
    if (!badge) return document.createDocumentFragment();
    return badge;
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
  function tagLabel(key, tag) {
    if (tag.startsWith("pilot:"))
      return I18n.text("驾驶员") + " · " + (tag === "pilot:custom" ? "PMC" : tag.slice(6));
    return key === "bannedTypes" ? I18n.text(Rules.unitTagName(tag)) : tag;
  }
  function tagControls(parent, prefix, restrictions, locked, changed) {
    parent.replaceChildren();
    for (const [key, title, values] of [
      ["bannedFactions", "禁用阵营", Rules.factionTags],
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
            ? selectedTags.map((tag) => tagLabel(key, tag)).join(", ")
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
            new Option(tagLabel(key, tag) + (selectedTags.includes(tag) ? " ✓" : ""), tag),
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
  function renderBattlefieldOptions(snapshot, locked) {
    const panel = byId("battlefieldRoomOptions");
    byId("battlefieldRoomRules").hidden = snapshot.settings.mode !== "battlefield";
    if (snapshot.settings.mode !== "battlefield") return;
    panel.replaceChildren();
    const config = Rules.battlefieldMode.teams(Rules, snapshot.settings.battlefieldTeams);
    for (const team of [0, 1]) {
      const group = element("fieldset", "battlefield-team-options"), legend = element("legend", "", "队伍" + (team + 1) + " · 固定阵营 AI");
      group.append(legend);
      for (const [key, label, choices] of [["faction", "阵营", Rules.battlefieldMode.factions], ["era", "年代上限", Rules.eras]]) {
        const container = element("label", "", label), select = element("select");
        select.id = "battlefieldTeam" + team + key;
        for (const value of choices) {
          const option = new Option(value, value);
          if (key === "era") option.disabled = !Rules.battlefieldMode.erasForFaction(Rules, config[team].faction).includes(value);
          select.add(option);
        }
        select.value = config[team][key]; select.disabled = locked;
        select.onchange = () => {
          config[team][key] = select.value;
          if (key === "faction") {
            const eras = Rules.battlefieldMode.erasForFaction(Rules, config[team].faction);
            if (!eras.includes(config[team].era)) config[team].era = eras[0];
          }
          sendSettings({battlefieldTeams:config});
        };
        container.append(select); group.append(container);
      }
      panel.append(group);
    }
    panel.append(element("p", "muted", "100回合 · 初始战力20000 · 每5回合空投增援 · 本模式不扣库存、不产生收益"));
  }
  function renderCampaignOptions(snapshot, locked) {
    let panel = byId("campaignRoomOptions");
    if (!panel) {
      panel = element("section", "campaign-room-options");
      panel.id = "campaignRoomOptions";
      byId("roomBattleMode").closest("details").append(panel);
    }
    panel.hidden = snapshot.settings.mode !== "campaign";
    if (panel.hidden) return;
    panel.replaceChildren();
    const config = Rules.aiTactics.settings(snapshot.settings.campaignOptions);
    const option = (parent, label, choices, value, change, id) => {
      const row = element("label", "", label),
        select = element("select");
      select.id = id;
      for (const [key, text] of choices) select.add(new Option(I18n.text(text), String(key)));
      select.value = String(value);
      select.disabled = locked || !!snapshot.campaign;
      select.onchange = () => {
        change(select.value);
        sendSettings({ campaignOptions: config });
      };
      row.append(select);
      parent.append(row);
    };
    const general = element("div", "campaign-room-ai-options");
    option(
      general,
      "AI难度",
      [
        ["easy", "简单"],
        ["normal", "标准"],
        ["hard", "困难"],
      ],
      config.difficulty,
      (v) => (config.difficulty = v),
      "campaignAIDifficulty",
    );
    option(
      general,
      "进攻欲望",
      [
        ["low", "低"],
        ["normal", "中"],
        ["high", "高"],
      ],
      config.aggression,
      (v) => (config.aggression = v),
      "campaignAIAggression",
    );
    panel.append(general);
    for (let team = 0; team < 2; team++) {
      const group = element("fieldset", "campaign-room-team-options");
      group.append(element("legend", "", ["地球联邦军", "吉翁公国军"][team]));
      option(
        group,
        "科技速度",
        [
          [0.75, "慢 75%"],
          [1, "中 100%"],
          [1.25, "快 125%"],
        ],
        config.teams[team].research,
        (v) => (config.teams[team].research = Number(v)),
        "campaignResearch" + team,
      );
      option(
        group,
        "单位强度（耐久）",
        [0.75, 1, 1.25].map((v) => [v, v * 100 + "%"]),
        config.teams[team].durability,
        (v) => (config.teams[team].durability = Number(v)),
        "campaignDurability" + team,
      );
      option(
        group,
        "初始资源",
        [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => [v, v * 100 + "%"]),
        config.teams[team].resources,
        (v) => (config.teams[team].resources = Number(v)),
        "campaignResources" + team,
      );
      panel.append(group);
    }
  }
  function renderSettings(snapshot, busy) {
    const settings = snapshot.settings || Rules.defaultRoomSettings();
    const mapSelect = byId("roomMapSelect");
    mapSelect.replaceChildren();
    for (const map of Object.values(Rules.catalog.maps).filter(
      (map) => settings.mode !== "campaign" && map.scope !== "strategic" &&
        (map.supportedModes || ["regular", "quick"]).includes(settings.mode || "regular"),
    )) {
      mapSelect.add(new Option(map.name, map.id));
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
    byId("roomPresetName").disabled = locked;
    byId("saveRoomPreset").disabled = locked;
    byId("deleteRoomPreset").disabled = locked || !savedPresets.some(p => p.id === byId("roomFormationPreset").value);
    byId("roomShareAlliedUnits").value = settings.shareAlliedUnits ? "enabled" : "disabled";
    byId("roomShareAlliedUnits").disabled = locked;
    byId("roomFogMode").value = settings.fogMode || "full";
    byId("roomPilotDialogue").value = settings.pilotDialogue === false ? "disabled" : "enabled";
    byId("roomSurfaceCover").value = settings.surfaceCover === false ? "disabled" : "enabled";
    byId("roomSurfaceCover").disabled = locked;
    byId("roomWeather").value = settings.weather || "map";
    byId("roomDayNight").value = settings.dayNight || "map";
    byId("roomWeatherCycle").value = settings.weatherCycle === false ? "disabled" : "enabled";
    byId("roomTimeCycle").value = settings.timeCycle === false ? "disabled" : "enabled";
    byId("roomClimateBuffs").value = settings.climateBuffs === false ? "disabled" : "enabled";
    const spaceMap = (() => { try { return Rules.getMap(settings.mapId).environment === "space"; } catch { return false; } })();
    for (const id of ["roomPilotDialogue","roomWeather","roomDayNight","roomWeatherCycle","roomTimeCycle","roomClimateBuffs"]) byId(id).disabled = locked || (spaceMap && id !== "roomPilotDialogue");
    byId("roomPilotPolicy").value = settings.pilotPolicy || "allow";
    byId("roomPilotPolicy").disabled = locked;
    byId("roomPilotPolicy").closest("label").hidden = settings.mode === "campaign";
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
    byId("roomTeamRulesTitle").textContent = "队伍禁用标签";
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
    }
    byId("roomCostLimit").step = Rules.catalog.formation.costStep;
    byId("roomCostLimit").min = Math.min(...Object.values(UnitModels).map((model) => model.cost));

    const strategic = settings.mode === "campaign";
    byId("roomScenarioSelect").hidden = !strategic;
    byId("roomScenarioSelect").disabled = locked;
    mapSelect.hidden = strategic;
    for (const id of ["roomFormationPreset", "roomTagRestrictions"])
      byId(id).closest("details").hidden = strategic;
    teamRulesPanel.closest("details").hidden = settings.mode !== "quick";
    for (const id of ["roomFogMode", "roomShareAlliedUnits"])
      byId(id).closest("label").hidden = strategic;
    let summary = byId("campaignRoomRuleSummary");
    if (!summary) {
      summary = element(
        "p",
        "muted",
        "历史战役模式使用剧本部队与共享资源，不限制编组COST、单位点数或禁用标签。",
      );
      summary.id = "campaignRoomRuleSummary";
      byId("roomBattleMode").closest("details").append(summary);
    }
    summary.hidden = !strategic;
    renderCampaignOptions(snapshot, locked);
    renderBattlefieldOptions(snapshot, locked);
    if (strategic) {
      window.CampaignUI.preview(byId("roomMapPreview"), snapshot.campaign);
      byId("roomMapTitle").textContent = CAMPAIGN_WORLD.name;
      byId("roomMapInfo").textContent =
        I18n.text("地球") +
        " · " +
        CAMPAIGN_WORLD.regions.length +
        I18n.text("个区域") +
        " · EFSF / ZEON";
      byId("roomMapChoiceHint").textContent = I18n.text("战役剧本");
    } else drawMap(Rules.getMap(mapSelect.value));
  }
  function closeDetail() {
    detail = null;
    byId("roomDetailPanel").close();
    byId("roomMain").inert = false;
  }
  function armyControls(player, snapshot, locked) {
    const panel = element("div", "ai-settings");
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
    panel.append(strengthLabel);
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
      for (const percent of key === "difficulty"
        ? Rules.strengthPercentages
        : Rules.armyPercentages)
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
      ...(restrictions.bannedFactions || []).map((tag) => tagLabel("bannedFactions", tag)),
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
          title + "：" + (tags.map((tag) => tagLabel(key, tag)).join("、") || "不禁用"),
        ),
      );
    }
  }
  function renderDetail(snapshot) {
    if (!detail) return;
    if (Number.isInteger(detail.team)) {
      const team = detail.team;
      const quick = snapshot.settings.mode === "quick";
      byId("roomDetailTitle").textContent = "队伍" + (team + 1) + " · 禁用标签";
      const content = byId("roomDetailContent");
      content.classList.remove("member-management");
      content.replaceChildren();
      if (quick) {
        content.append(element("h3", "", "队伍禁用标签"));
        appendTagDetails(content, snapshot.settings.teamRestrictions?.[team]);
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
    const locked =
      !!Net.awaiting ||
      snapshot.started ||
      !!snapshot.campaign ||
      snapshot.you.id !== snapshot.hostId ||
      (snapshot.settings.mode === "battlefield" && player.bot && player.seat < 2);
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
    if ((player.bot || player.id !== snapshot.you.id) && !(snapshot.settings.mode === "battlefield" && player.bot && player.seat < 2)) {
      const actionSection = element("section", "room-detail-section room-detail-danger");
      actionSection.append(element("h3", "", player.bot ? "移除 AI" : "玩家操作"));
      const remove = element("button", "danger", player.bot ? "移除 AI" : "踢出玩家");
      remove.id = player.bot ? "removeAI" + player.seat : "kickPlayer";
      remove.disabled =
        !!Net.awaiting ||
        (snapshot.started && !snapshot.campaign) ||
        (!!snapshot.campaign && !player.bot) ||
        snapshot.you.id !== snapshot.hostId;
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
    if (snapshot.settings.mode === "campaign" && Number.isInteger(player.seat)) {
      const team = Rules.seatTeam(player.seat);
      const leader =
        snapshot.campaign?.commanders?.[team] ??
        snapshot.members
          .filter((member) => Number.isInteger(member.seat) && Rules.seatTeam(member.seat) === team)
          .sort((a, b) => a.seat - b.seat)[0]?.seat;
      if (leader === player.seat) {
        const badge = element("span", "commander-badge", "★");
        badge.title = I18n.text("主指挥官");
        badge.setAttribute("role", "img");
        badge.setAttribute("aria-label", I18n.text("主指挥官"));
        badge.dataset.commanderSeat = player.seat;
        button.append(badge);
      }
    }
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
    if (observing)
      for (const team of [0, 1]) {
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
        icon.title = model.name + " · " + model.kitName + " · COST " + model.cost;
        const image = element("img");
        image.src = unitIcon(id, entry.customPilot);
        image.alt = model.name;
        icon.append(image);
        if (player.reasons?.[index] === "not_developed")
          icon.append(element("span", "unit-undeveloped", "⚠︎ 尚未开发"));
        if (player.disabled.includes(index) && player.reasons?.[index] !== "not_developed")
          icon.append(
            element("span", "disabled-panel"),
            element(
              "span",
              "overcost-label",
              player.reasons?.[index] === "pilot_banned"
                ? "驾驶员被禁用，请解除配属"
                : player.reasons?.[index] === "stock"
                  ? "机体库存不足"
                  : player.reasons?.[index] === "kit_stock"
                    ? "套件库存不足"
                    : player.reasons?.[index] === "license"
                      ? "未许可"
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
    byId("editFinalFormation").hidden = !own || !!snapshot.loadedSave || !!own.ready;
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
    if (snapshot.settings.mode !== "campaign") Formation.alignWithRoom(snapshot);
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
    byId("roomFormation").disabled = busy || !Formation.canEditRoom();
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
    formationSelect.disabled = busy || !Formation.canEditRoom();
    let disabledCount = 0,
      valid = true;
    try {
      const units = own?.formationPreset?.units || Formation.current();
      Rules.validateFormation(units, Infinity, Rules.armyUnitLimit(snapshot.settings, own));
      const plan = Rules.planFormation(
        units,
        limit,
        {
          ...Rules.armyRestrictions(snapshot.settings, own),
          licenses: undefined,
          inventory: undefined,
          kits: undefined,
        },
        Rules.armyUnitLimit(snapshot.settings, own),
      );
      valid = !!plan.deployable.length;
      disabledCount = plan.disabled.length;
    } catch {
      valid = false;
    }
    if (snapshot.loadedSave || snapshot.settings.mode === "campaign") {
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
      ? "离线" +
        { battlefield: "战地模式", quick: "快速战模式", campaign: "历史战役模式", regular: "常规战模式" }[snapshot.settings.mode] +
        "房间"
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
    teams.classList.toggle("pmc-room", snapshot.settings.mode !== "campaign");
    for (const button of joinButtons) button.remove();
    teams.replaceChildren();
    for (let team = 0; team < 2; team++) {
      const column = element("section", "team-slot");
      column.dataset.team = String(team);
      const teamHeading = element("div", "team-heading");
      const forced =
        snapshot.settings.mode === "campaign"
          ? snapshot.campaign?.teams[team]?.faction || ["EFSF", "ZEON"][team]
          : "PMC";
      const summary = element(
        "button",
        "team-ban-summary",
        snapshot.settings.mode === "quick"
          ? "队伍禁用：" + restrictionSummary(snapshot.settings.teamRestrictions?.[team])
          : snapshot.settings.mode === "campaign"
            ? "阵营：" + forced
            : "房间禁用标签",
      );
      summary.id = "teamBanSummary" + team;
      summary.disabled = snapshot.settings.mode === "campaign";
      summary.title = summary.textContent;
      summary.setAttribute("aria-haspopup", "dialog");
      summary.onclick = () => {
        detail = { team };
        renderDetail(Net.snapshot);
        byId("closeRoomDetail").focus();
      };
      teamHeading.append(element("h3", "", "队伍" + (team + 1)), summary, joinButtons[team]);
      if (snapshot.settings.mode === "campaign") {
        const badge = element(
          "span",
          "faction-badge faction-" + forced.toLowerCase() + " campaign-team-faction",
          forced,
        );
        badge.title = PlayerProfile.displayFaction(forced);
        teamHeading.append(badge);
      }
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
        ...(snapshot.settings.mode === "campaign" ? [element("span", "", "阵营")] : []),
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
        if (
          (!snapshot.started || !!snapshot.campaign) &&
          self.id === snapshot.hostId &&
          (!member || member.bot) &&
          !reserved && !(snapshot.settings.mode === "battlefield" && seat < 2)
        ) {
          const addAI = element(
            "button",
            "choose-spawn" + (member ? " danger" : ""),
            member ? "移除 AI" : "添加 AI",
          );
          addAI.id = (member ? "removeSeatAI" : "addAI") + seat;
          addAI.disabled = busy || !!snapshot.returnCountdown;
          addAI.onclick = () => Net.request(member ? "remove_ai" : "add_ai", { seat });
          nameCell.append(addAI);
        }
        const positionCell = element("div", "spawn-cell");
        const takingAI = !!snapshot.campaign && member?.bot;
        if ((member && !takingAI) || reserved) {
          positionCell.append(element("span", "spawn-position", "位置" + spawn.position));
        } else {
          const choose = element(
            "button",
            "choose-spawn",
            (inBattle || takingAI ? "接管" : "位置") + spawn.position,
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
        slot.append(nameCell, positionCell);
        if (snapshot.settings.mode === "campaign") slot.append(factionCell);
        slot.append(ready);
        for (const cell of slot.children) cell.setAttribute("role", "cell");
        column.append(slot);
      }
      updateReconnectCountdowns();
      const button = joinButtons[team];
      const current =
        self.seat !== null && self.seat !== undefined && Rules.seatTeam(self.seat) === team;
      const full = !seats.some(
        (item) =>
          !roster.some(
            (player) => player.seat === item.seat && (!snapshot.campaign || !player.bot),
          ) && !snapshot.reservedSeats?.some((reserved) => reserved.seat === item.seat),
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
      !!snapshot.campaign || snapshot.started || self.seat === null || self.id === snapshot.hostId;
    byId("toggleReady").disabled = busy || (!own?.ready && !valid);
    byId("toggleReady").textContent = own?.ready ? "取消准备" : "准备";
    const participants = roster.filter((player) => player.seat !== null);
    byId("startRoomGame").hidden = snapshot.started || self.id !== snapshot.hostId;
    for (const id of ["importCampaignRoom", "restoreCampaignBackup"]) {
      const control = byId(id);
      if (control) {
        control.hidden =
          snapshot.settings.mode !== "campaign" ||
          !!snapshot.campaign ||
          self.id !== snapshot.hostId;
        control.disabled = busy;
      }
    }
    byId("startRoomGame").disabled =
      busy ||
      (self.seat !== null && !valid) ||
      participants.some(
        (player) => !player.connected || (player.id !== self.id && !player.ready),
      ) ||
      ![0, 1].every((team) => participants.some((player) => Rules.seatTeam(player.seat) === team));
    if (snapshot.campaign && !snapshot.started) byId("startRoomGame").disabled = busy;
    byId("startRoomGame").textContent = snapshot.campaign ? "继续战役" : "开始游戏";
    byId("roomMainMenu").textContent =
      snapshot.started && snapshot.phase !== "assembly" ? "返回战斗" : "主菜单";
    renderFinalAssembly(snapshot, busy);
    renderDetail(snapshot);
    if (snapshot.settings.mode === "battlefield") {
      for (const seat of [0,1]) { byId("removeSeatAI" + seat)?.remove(); }
    }
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
  byId("roomLeaveGame").onclick = requestMenu;
  byId("returnAllToRoom").onclick = () => BattlePrompts.requestReturn();
  byId("returnAssemblyToRoom").onclick = () => BattlePrompts.requestReturn();
  byId("toggleReady").onclick = () => {
    const self = Net.snapshot?.members.find((member) => member.id === Net.memberId);
    if (Net.snapshot?.settings.mode === "campaign")
      return Net.request("set_ready", { ready: !self?.ready });
    const entries = self?.formationPreset?.units || Formation.current();
    const proceed = () => Net.request("set_ready", { ready: !self?.ready, formation: entries });
    if (!self?.ready && !Net.snapshot?.loadedSave) Formation.checkLicenses(entries, proceed);
    else proceed();
  };
  byId("roomFormationSelect").onchange = () => {
    const snapshot = Net.snapshot;
    if (!snapshot || !Formation.canEditRoom() || Net.awaiting) return;
    if (!Formation.selectPreset(Number(byId("roomFormationSelect").value))) return;
    const units = Formation.current();
    if (snapshot.you?.seat !== null) {
      try {
        if (units.length)
          Rules.validateFormation(
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
    if (snapshot.settings.mode === "campaign")
      return snapshot.campaign ? Net.request("campaign_resume") : window.CampaignUI?.create();
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
    const saved = savedPresets.find(p => p.id === preset);
    if (!saved && !formationPresets.has(preset)) return;
    const rules = saved?.rules || Object.fromEntries(
      ["costLimit", "unitCostLimit", "unitLimit"].map((key, i) => [key, Number(preset.split(",")[i])])
    );
    const {costLimit, unitCostLimit, unitLimit} = rules;
    byId("roomPresetName").value = saved?.name || "";
    clearTimeout(numericSettingsTimer);
    numericSettingsTimer = null;
    queuedNumericSettings = {};
    submittedNumericSettings = null;
    numericDrafts.costLimit = numericDrafts.unitCostLimit = numericDrafts.unitLimit = null;
    byId("roomCostLimit").value = costLimit;
    byId("roomUnitCostLimit").value = unitCostLimit;
    byId("roomUnitLimit").value = unitLimit;
    sendSettings(rules);
  };
  function storePresets(next) {
    localStorage.setItem(presetStorageKey, JSON.stringify(next));
    savedPresets = next;
    savedPresetOptions();
    showFormationPreset(Net.snapshot.settings);
  }
  byId("saveRoomPreset").onclick = () => {
    const snapshot = Net.snapshot;
    if (!snapshot || snapshot.started || snapshot.you?.id !== snapshot.hostId || Net.awaiting) return;
    try {
      const name = byId("roomPresetName").value.trim();
      if (!name) throw Error("请输入预设名称");
      if (name.length > 40) throw Error("预设名称最多40个字符");
      const previous = savedPresets.find(p => p.name === name);
      if (!previous && savedPresets.length >= 30) throw Error("最多保存30个预设");
      const rules = presetRules({...snapshot.settings, ...Object.fromEntries(
        Object.entries(numericDrafts).filter(([, value]) => value !== null).map(([key, value]) => [key, Number(value)])
      )});
      const entry = {id:previous?.id || "saved-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8), name, rules};
      storePresets(previous ? savedPresets.map(p => p.id === previous.id ? entry : p) : [...savedPresets, entry]);
      byId("roomPresetStatus").textContent = I18n.text("预设已保存到当前浏览器");
    } catch (error) { byId("roomPresetStatus").textContent = I18n.text(error.message); }
  };
  byId("deleteRoomPreset").onclick = () => {
    const selected = byId("roomFormationPreset").value;
    if (byId("roomFormationPreset").disabled || !savedPresets.some(p => p.id === selected)) return;
    try {
      storePresets(savedPresets.filter(p => p.id !== selected));
      byId("roomPresetName").value = "";
      byId("roomPresetStatus").textContent = I18n.text("预设已删除");
    } catch (error) { byId("roomPresetStatus").textContent = I18n.text(error.message); }
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
  byId("roomPilotDialogue").onchange = () => sendSettings({ pilotDialogue: byId("roomPilotDialogue").value === "enabled" });
  byId("roomSurfaceCover").onchange = () => sendSettings({ surfaceCover: byId("roomSurfaceCover").value === "enabled" });
  byId("roomWeather").onchange = () => sendSettings({ weather: byId("roomWeather").value });
  byId("roomDayNight").onchange = () => sendSettings({ dayNight: byId("roomDayNight").value });
  byId("roomWeatherCycle").onchange = () => sendSettings({ weatherCycle: byId("roomWeatherCycle").value === "enabled" });
  byId("roomTimeCycle").onchange = () => sendSettings({ timeCycle: byId("roomTimeCycle").value === "enabled" });
  byId("roomClimateBuffs").onchange = () => sendSettings({ climateBuffs: byId("roomClimateBuffs").value === "enabled" });
  byId("roomPilotPolicy").onchange = () =>
    sendSettings({ pilotPolicy: byId("roomPilotPolicy").value });
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
  mobile.addEventListener("change", () => {
    if (sheet.open) sheet.close();
  });
  window.addEventListener("page-changing", () => {
    if (sheet.open) sheet.close();
  });
})();
