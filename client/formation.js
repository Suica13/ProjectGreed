/* 编组保存单位/套件 ID 与可选自定义名称；数值和部署合法性由共用规则决定。 */
const Formation = (() => {
  const storageKey = "slg-formations-v1";
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(storageKey));
  } catch {}
  const first = Rules.catalog.prefabs[0];
  const fallback = Rules.randomFormation(7319);
  // 首次示例尽量展示不同套件；仍服从目录里的数量和预算限制。
  if (first.weaponKits.length >= 3 && Rules.catalog.formation.maxUnits >= 3) {
    const example = [];
    for (const kit of first.weaponKits.slice(0, 3))
      example.push({
        unitId: first.id,
        kitId: kit.id,
        customName: Rules.generateUnitName(first.name, example),
      });
    try {
      Rules.validateFormation(example);
      fallback.splice(0, fallback.length, ...example);
    } catch {}
  }
  let squads = Array.isArray(saved)
    ? saved
        .filter((s) => {
          try {
            Rules.validateFormation(s.units, Rules.maxCostLimit);
            return typeof s.name === "string";
          } catch {
            return false;
          }
        })
        .map((s) => ({ ...s, units: Rules.validateFormation(s.units, Rules.maxCostLimit) }))
    : [];
  if (!squads.length) squads = [{ name: I18n.text("第一编组"), units: fallback }];
  let index = 0,
    returnView = "menu",
    draft = [],
    previousIndex = 0,
    detailIndex = null;
  try {
    const active = Number(localStorage.getItem(storageKey + "-active"));
    if (Number.isInteger(active) && active >= 0 && active < squads.length) index = active;
  } catch {}
  const current = () => Rules.validateFormation(squads[index].units, Rules.maxCostLimit);
  const budget = () =>
    Net.active && Net.snapshot?.settings ? Net.snapshot.settings.costLimit : Infinity;
  const restrictions = () =>
    Rules.formationRestrictions(Net.active ? Net.snapshot?.settings : {}, Net.seat ?? null);
  const displayLimit = (value) => (Number.isFinite(value) ? value : I18n.text("无限"));
  const unitLimit = () =>
    Net.active
      ? (Net.snapshot?.settings?.unitLimit ?? Rules.catalog.formation.maxUnits)
      : Rules.catalog.formation.maxUnits;
  const cost = (entries) =>
    entries.reduce((n, e) => n + UnitModels[e.unitId + "__" + e.kitId].cost, 0);
  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(squads));
      localStorage.setItem(storageKey + "-active", String(index));
    } catch {
      note("浏览器无法保存编组，本次会话仍可使用。");
    }
  }
  function refreshSelect() {
    const select = byId("formationSelect");
    select.replaceChildren();
    squads.forEach((s, i) => {
      const option = new Option(s.name, i);
      option.setAttribute("data-i18n-ignore", "");
      select.add(option);
    });
    select.value = index;
    byId("deleteFormation").disabled = squads.length <= 1;
    byId("deleteFormation").title = squads.length <= 1 ? "至少保留一个编组。" : "";
  }
  function closeDetail() {
    byId("formationUnitDetail").hidden = true;
    byId("formationMain").inert = false;
    const selectedIndex = detailIndex;
    detailIndex = null;
    if (selectedIndex !== null) byId("formationUnits").children[selectedIndex]?.focus();
  }
  function renderDetail() {
    const entry = draft[detailIndex];
    if (!entry) return closeDetail();
    const prefab = Rules.catalog.prefabs.find((p) => p.id === entry.unitId);
    const model = UnitModels[entry.unitId + "__" + entry.kitId];
    byId("formationDetailTitle").textContent = model.code + " " + (entry.customName || model.name);
    byId("formationDetailTitle").toggleAttribute("data-i18n-ignore", !!entry.customName);
    byId("formationDetailName").value = entry.customName || "";
    byId("formationDetailName").placeholder = model.name;
    byId("resetFormationUnitName").disabled = !entry.customName;
    byId("formationDetailIntro").textContent = model.description;
    const kits = byId("formationDetailKit");
    kits.replaceChildren();
    for (const kit of prefab.weaponKits)
      kits.add(new Option(`${kit.name} · COST ${prefab.stats.cost + kit.cost}`, kit.id));
    kits.value = entry.kitId;
    byId("formationDetailStats").textContent =
      `HP ${model.hp.toLocaleString()} · EN ${model.en} · 移动 ${model.move} · 反应系数 ${model.mobility} · 命中系数 ${model.accuracy}% · 零件强度 ${model.partStructuralStrength} · 地面适应性 ${model.adaptability.ground}% · 宇宙适应性 ${model.adaptability.space}%${model.ship ? ` · 战舰占地 ${model.footprint.width}×${model.footprint.height} · 炮塔模块 ${model.modules.length}` : ""}`;
    const labels = {
      melee: "格斗",
      shooting: "射击",
      beam: "光束",
      shell: "实弹",
      dp: "DP",
      sp: "SP",
    };
    const defenses = Object.entries(model.defenses)
      .map(
        ([type, value]) => `${I18n.text(labels[type] || type)} ${value.percent}% / ${value.flat}`,
      )
      .join(" · ");
    const bonuses = Object.entries(model.attackBonuses)
      .map(([type, value]) => `${I18n.text(labels[type] || type)} +${value}%`)
      .join(" · ");
    byId("formationDetailDefense").textContent = I18n.text("防护") + ": " + defenses;
    byId("formationDetailBonuses").textContent = I18n.text("伤害加成") + ": " + bonuses;
    byId("formationDetailShield").textContent =
      `${I18n.text("盾牌")} HP ${model.shield.hp} · ${I18n.text("格挡率")} ${Math.round(model.shield.blockChance * 100)}%`;
    const weapons = byId("formationDetailWeapons");
    weapons.replaceChildren();
    for (const weapon of model.weapons) {
      const card = element("div", "formation-weapon-detail");
      card.append(element("strong", "", weapon.name));
      const all = (weapon.requiredParts || [])
        .map((part) => I18n.text(Rules.partNames[part]))
        .join(" / ");
      const any = (weapon.anyParts || [])
        .map((part) => I18n.text(Rules.partNames[part]))
        .join(" / ");
      card.append(
        element(
          "p",
          "muted",
          I18n.text("安装部位") +
            ": " +
            (all || any || I18n.text("躯干")) +
            (any ? " · " + I18n.text("任一部位完好即可") : "") +
            " · " +
            I18n.text("部位破坏系数") +
            " " +
            weapon.partBreakModifier,
        ),
      );
      card.append(
        element(
          "p",
          "muted",
          `威力 ${Math.round(weapon.damage)} · 发射次数 ${weapon.shotCount} · 命中 ${weapon.hit}% · 射程 ${weapon.min}–${weapon.max} · EN ${weapon.en}`,
        ),
      );
      weapons.append(card);
    }
    if (model.supplyAura) {
      const card = element("div", "formation-weapon-detail");
      card.append(
        element("strong", "", "自动补给"),
        element(
          "p",
          "muted",
          `范围 ${model.supplyAura.range} · 每个己方回合范围内友军HP +5%、EN +10% · 不消耗EN，不消耗行动`,
        ),
      );
      weapons.append(card);
    }
    for (const skill of model.skills || []) {
      const card = element("div", "formation-weapon-detail");
      card.append(
        element("strong", "", skill.name),
        element("p", "muted", SkillControls.description(skill)),
      );
      weapons.append(card);
    }
    for (const weapon of model.hiddenWeapons || []) {
      const card = element("div", "formation-weapon-detail");
      card.append(
        element("strong", "", weapon.name + "（暂时隐藏）"),
        element(
          "p",
          "muted",
          weapon.reasons
            .map(
              (reason) =>
                ({
                  pilot_skill: "驾驶员技能解锁：保留原条件，暂不开放",
                  secondary_loadout: "可换装副武器：保留配置，暂不开放",
                })[reason] || reason,
            )
            .join(" · "),
        ),
      );
      weapons.append(card);
    }
    for (const mechanic of model.mechanics || []) {
      const card = element("div", "formation-weapon-detail");
      card.append(
        element("strong", "", mechanic.name),
        element(
          "p",
          "muted",
          {
            implemented: "已接入",
            adapted: "回合制改编",
            review: "原MOD机制：待接入",
            not_applicable: "本项目未接入对应科技／驾驶员系统",
          }[mechanic.status] || mechanic.status,
        ),
      );
      weapons.append(card);
    }
    if (model.movementType === "air")
      byId("formationDetailStats").textContent += " · " + I18n.text("空军：可跨越山岩和水域");
    byId("formationUnitDetail").hidden = false;
    byId("formationMain").inert = true;
  }
  function environmentLabel(adaptability) {
    return ["ground", "space"]
      .filter((environment) => (adaptability?.[environment] ?? 100) >= 100)
      .map((environment) => I18n.text(environment === "ground" ? "地面" : "宇宙"))
      .join("/");
  }

  function unitTags(model) {
    const tags = element("span", "unit-tags");
    for (const value of model.tags) {
      const tag = element("span", value === model.faction ? "faction-tag" : "era-tag", value);
      tag.dataset.tag = value;
      if (value === model.faction) tag.dataset.faction = value;
      tags.append(tag);
    }
    return tags;
  }
  function render() {
    const unitCostLimit = restrictions().unitCostLimit;
    const unitCostRule = element(
      "span",
      "formation-unit-cost-limit" + (Number.isFinite(unitCostLimit) ? " has-limit" : ""),
      `单位COST上限: ${displayLimit(unitCostLimit)}`,
    );
    unitCostRule.id = "formationUnitCostLimit";
    byId("formationBudget").replaceChildren(
      element(
        "span",
        "",
        `${draft.length} / ${unitLimit()} 台 · 编组COST: ${cost(draft)} / ${displayLimit(budget())}`,
      ),
      document.createTextNode(" · "),
      unitCostRule,
    );
    byId("formationBudget").classList.toggle("danger-text", draft.length > unitLimit());
    byId("addFormationUnit").disabled =
      draft.length >= unitLimit() || !byId("formationPrefab").value;
    const plan = draft.length
      ? Rules.planFormation(draft, budget(), restrictions())
      : { disabled: [] };
    const list = byId("formationUnits"),
      scrollTop = list.scrollTop;
    list.replaceChildren();
    draft.forEach((entry, i) => {
      const row = element("div", "formation-row"),
        model = UnitModels[entry.unitId + "__" + entry.kitId];
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-haspopup", "dialog");
      const show = () => {
        GameAudio.play("selectUnitSound");
        detailIndex = i;
        renderDetail();
        byId("formationDetailKit").focus();
      };
      row.onclick = show;
      row.onkeydown = (event) => {
        if (event.target === row && ["Enter", " "].includes(event.key)) {
          event.preventDefault();
          show();
        }
      };
      const icon = element("span", "formation-icon"),
        image = element("img");
      image.src = unitIcon(entry.unitId + "__" + entry.kitId);
      image.width = 56;
      image.alt = entry.customName || model.name;
      icon.append(image);
      if (plan.disabled.includes(i)) {
        row.classList.add(
          "unit-disabled",
          plan.reasons[i] === "not_allowed" ? "not-allowed" : "overcost",
        );
        row.append(
          element("span", "disabled-panel"),
          element(
            "span",
            "overcost-label",
            plan.reasons[i] === "not_allowed" ? "不被允许的单位" : "OVER COST",
          ),
        );
      }
      const label = element("span", "formation-unit-name");
      const prefab = Rules.catalog.prefabs.find((p) => p.id === entry.unitId),
        kit = prefab.weaponKits.find((k) => k.id === entry.kitId);
      const description = element("small", "muted formation-row-description", model.description);
      description.title = model.description;
      label.append(
        unitTags(model),
        element("strong", "", `${i + 1}. ${model.code} ${entry.customName || model.name}`),
        element(
          "small",
          "formation-row-kit",
          `${kit.name} · COST ${model.cost} · ${environmentLabel(model.adaptability)}`,
        ),
        description,
      );
      if (entry.customName) label.querySelector("strong").setAttribute("data-i18n-ignore", "");
      const remove = element("button", "", "移除");
      remove.onclick = (event) => {
        event.stopPropagation();
        closeDetail();
        draft.splice(i, 1);
        render();
      };
      row.append(icon, label, remove);
      list.append(row);
    });
    list.scrollTop = scrollTop;
  }
  byId("closeFormationDetail").onclick = closeDetail;
  byId("formationUnitDetail").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeDetail();
    }
    if (event.key === "Tab") {
      const controls = [
        byId("closeFormationDetail"),
        byId("formationDetailName"),
        ...(!byId("resetFormationUnitName").disabled ? [byId("resetFormationUnitName")] : []),
        byId("formationDetailKit"),
      ];
      if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault();
        controls.at(-1).focus();
      } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
        event.preventDefault();
        controls[0].focus();
      }
    }
  });
  byId("formationDetailName").oninput = (event) => {
    if (detailIndex === null) return;
    const entry = draft[detailIndex],
      name = Rules.normalizeUnitName(event.target.value);
    if (name) entry.customName = name;
    else delete entry.customName;
    byId("resetFormationUnitName").disabled = !name;
    const model = UnitModels[entry.unitId + "__" + entry.kitId];
    byId("formationDetailTitle").textContent = model.code + " " + (name || model.name);
    byId("formationDetailTitle").toggleAttribute("data-i18n-ignore", !!name);
    render();
  };
  byId("resetFormationUnitName").onclick = () => {
    if (detailIndex === null) return;
    delete draft[detailIndex].customName;
    render();
    renderDetail();
    byId("formationDetailName").focus();
  };
  byId("formationDetailKit").onchange = (event) => {
    if (detailIndex === null) return;
    GameAudio.play("changeEquipmentSound");
    draft[detailIndex].kitId = event.target.value;
    render();
    renderDetail();
  };
  function open() {
    closeDetail();
    previousIndex = index;
    returnView = pageView === "room" ? "room" : "menu";
    const activePlan =
      Net.snapshot?.phase === "assembly"
        ? Net.snapshot.assembly?.players.find((player) => player.memberId === Net.memberId)
        : null;
    draft = structuredClone(activePlan?.entries || current());
    byId("formationName").value = squads[index].name;
    refreshSelect();
    render();
    renderCatalog();
    setPageView("formation");
  }
  byId("formationSelect").onchange = (e) => {
    closeDetail();
    index = Number(e.target.value);
    byId("formationName").value = squads[index].name;
    draft = structuredClone(current());
    render();
  };
  byId("newFormation").onclick = () => {
    closeDetail();
    squads.push({ name: `编组${squads.length + 1}`, units: structuredClone(fallback) });
    index = squads.length - 1;
    byId("formationName").value = squads[index].name;
    draft = structuredClone(current());
    refreshSelect();
    render();
  };
  byId("deleteFormation").onclick = () => {
    if (squads.length <= 1) return;
    closeDetail();
    const removed = index;
    squads.splice(removed, 1);
    if (previousIndex > removed) previousIndex--;
    else if (previousIndex === removed) previousIndex = Math.min(removed, squads.length - 1);
    // 删除立即保存；回到仍有效的出战编组，取消编辑时也不会引用已删除项。
    index = previousIndex;
    draft = structuredClone(current());
    byId("formationName").value = squads[index].name;
    persist();
    refreshSelect();
    render();
    note("编组已删除。");
  };
  byId("addFormationUnit").onclick = () => {
    const prefab = Rules.catalog.prefabs.find((p) => p.id === byId("formationPrefab").value);
    if (draft.length >= unitLimit()) return note("已达到编组数量上限。");
    draft.push({
      unitId: prefab.id,
      kitId: prefab.weaponKits[0].id,
      customName: Rules.generateUnitName(prefab.name, draft),
    });
    render();
    byId("formationUnits").scrollTop = byId("formationUnits").scrollHeight;
  };
  function renderCatalog() {
    const filter = byId("formationFaction").value,
      era = byId("formationEra").value;
    const prefabs = Rules.catalog.prefabs
      .filter(
        (p) =>
          !p.formOnly &&
          (filter === "ALL" || p.faction === filter) &&
          (era === "ALL" || p.tags.includes(era)),
      )
      .sort(
        (a, b) =>
          a.faction.localeCompare(b.faction, "en") ||
          a.name.localeCompare(b.name, I18n.language, { numeric: true, sensitivity: "base" }) ||
          a.id.localeCompare(b.id, "en"),
      );
    if (!prefabs.some((p) => p.id === byId("formationPrefab").value))
      byId("formationPrefab").value = prefabs[0]?.id || "";
    const list = byId("formationCatalog");
    const scroll = list.scrollTop;
    list.replaceChildren();
    for (const prefab of prefabs) {
      const card = element("button", "catalog-unit");
      card.dataset.unitId = prefab.id;
      card.setAttribute("role", "option");
      card.setAttribute("aria-selected", String(byId("formationPrefab").value === prefab.id));
      const image = element("img");
      image.src = unitIcon(prefab.id + "__" + prefab.weaponKits[0].id);
      image.alt = prefab.name;
      const title = element("strong", "", prefab.code + " " + prefab.name);
      const info = element("span", "catalog-unit-info");
      const costs = prefab.weaponKits.map((k) => prefab.stats.cost + k.cost);
      info.append(
        unitTags(prefab),
        title,
        element(
          "small",
          "muted",
          "Cost:" +
            Math.min(...costs) +
            "-" +
            Math.max(...costs) +
            " · " +
            environmentLabel(prefab.stats.adaptability),
        ),
      );
      card.append(image, info);
      card.onclick = () => {
        GameAudio.play("selectUnitSound");
        byId("formationPrefab").value = prefab.id;
        renderCatalog();
      };
      list.append(card);
    }
    list.scrollTop = scroll;
    byId("addFormationUnit").disabled = !prefabs.length || draft.length >= unitLimit();
  }
  for (const era of Rules.eras) byId("formationEra").add(new Option(era, era));
  byId("formationEra").onchange = renderCatalog;
  byId("formationFaction").onchange = renderCatalog;
  renderCatalog();
  byId("saveFormation").onclick = () => {
    try {
      const units = Rules.validateFormation(draft, Infinity, unitLimit());
      squads[index] = {
        name: byId("formationName").value.trim().slice(0, 32) || "未命名编组",
        units,
      };
      persist();
      if (
        Net.active &&
        Net.seat !== null &&
        (!Net.snapshot.started || Net.snapshot.phase === "assembly")
      )
        Net.request("update_formation", { formation: units });
      closeDetail();
      setPageView(returnView);
      update();
      note("编组已保存并选用。");
    } catch {
      note("请保留至少一台单位，并检查数量与 COST 上限。");
    }
  };
  byId("cancelFormation").onclick = () => {
    index = previousIndex;
    setPageView(returnView);
    update();
  };
  byId("openFormation").onclick = open;
  byId("roomFormation").onclick = open;
  window.addEventListener("language-change", () => {
    renderCatalog();
    if (pageView === "formation") {
      refreshSelect();
      render();
      if (detailIndex !== null) renderDetail();
    }
  });
  return {
    current,
    open,
    refresh: () => {
      if (pageView === "formation") {
        render();
        if (detailIndex !== null) renderDetail();
      }
    },
    name: () => squads[index].name,
    presetIndex: () => index,
    selectPreset: (value) => {
      if (!Number.isInteger(value) || value < 0 || value >= squads.length) return false;
      index = value;
      persist();
      return true;
    },
    presets: () =>
      squads.map((squad) => ({
        name: squad.name,
        units: Rules.validateFormation(squad.units, Infinity),
      })),
  };
})();

/* 开局部署：预放在出生区，玩家可以选中单位后点击空格调整。 */
const Deployment = (() => {
  // 无房间时仅供开发预览与画面测试切换部署焦点。实际对局使用房间席位。
  let previewSeat = 0;
  const team = () => (Net.active ? Net.seat : previewSeat);
  const canEdit = () =>
    phase === "deployment" &&
    team() !== null &&
    !game.deployment?.[team()] &&
    !Net.awaiting &&
    (!Net.active || Net.snapshot.connected.every(Boolean));
  function render() {
    byId("deploymentPanel").hidden = phase !== "deployment";
    byId("confirmDeployment").hidden = phase !== "deployment";
    byId("endTurn").hidden = [
      "start",
      "connecting",
      "deployment",
      "waiting",
      "assembly",
      "finished",
    ].includes(phase);
    if (phase !== "deployment") return;
    const seat = team();
    byId("deploymentStatus").textContent =
      seat === null
        ? "观战：等待两队部署。"
        : `${teamName(Rules.seatTeam(seat))}出生区部署 · 选中己方单位，再点击高亮空格调整位置。`;
    byId("confirmDeployment").disabled = !canEdit();
    byId("confirmDeployment").textContent =
      seat !== null && game.deployment[seat] ? "已确认，等待对方" : "确认部署";
  }
  function click(cell) {
    if (!canEdit()) return;
    const target = Rules.at(game, cell.x, cell.y),
      u = getUnit(selected);
    if (target && Rules.ownerOf(target) === team()) {
      GameAudio.play("selectUnitSound");
      selected = target.id;
      update();
      return;
    }
    if (!u || Rules.ownerOf(u) !== team()) return note("请先选中己方单位。");
    const anchor = Rules.anchorAt(u, cell.mapX ?? cell.x, cell.mapY ?? cell.y);
    if (Net.active) Net.request("deploy", { unitId: u.id, ...anchor });
    else {
      try {
        Rules.deploy(game, team(), u.id, anchor.x, anchor.y);
        update();
      } catch {
        note("请在己方出生区的空格部署。");
      }
    }
  }
  byId("confirmDeployment").onclick = () => {
    if (!canEdit()) return;
    if (Net.active) return Net.request("confirm_deployment");
    if (game.ai) game.deployment[1] = true;
    const finished = Rules.confirmDeployment(game, team());
    if (finished) {
      phase = "idle";
      selected = null;
      note("部署完成，蓝方先手。");
    } else {
      previewSeat = 1;
      selected = null;
      note("请红方调整并确认部署。");
    }
    update();
  };
  return {
    render,
    click,
    team,
    canEdit,
    reset: () => {
      previewSeat = 0;
    },
  };
})();
