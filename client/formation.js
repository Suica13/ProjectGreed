/* 编组只保存单位和套件 ID，数值与部署合法性始终由共用规则决定。 */
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
    const example = first.weaponKits.slice(0, 3).map((k) => ({ unitId: first.id, kitId: k.id }));
    try {
      Rules.validateFormation(example);
      fallback.splice(0, fallback.length, ...example);
    } catch {}
  }
  let squads = Array.isArray(saved)
    ? saved.filter((s) => {
        try {
          Rules.validateFormation(s.units);
          return typeof s.name === "string";
        } catch {
          return false;
        }
      })
    : [];
  if (!squads.length) squads = [{ name: "第一编组", units: fallback }];
  let index = 0,
    returnView = "menu",
    draft = [],
    previousIndex = 0;
  try {
    const active = Number(localStorage.getItem(storageKey + "-active"));
    if (Number.isInteger(active) && active >= 0 && active < squads.length) index = active;
  } catch {}
  const current = () => Rules.validateFormation(squads[index].units);
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
    squads.forEach((s, i) => select.add(new Option(s.name, i)));
    select.value = index;
  }
  function render() {
    byId("formationBudget").textContent =
      `${draft.length} / ${Rules.catalog.formation.maxUnits} 台 · COST ${cost(draft)} / ${Rules.catalog.formation.maxCost}`;
    const list = byId("formationUnits");
    const scrollTop = list.scrollTop;
    list.replaceChildren();
    draft.forEach((entry, i) => {
      const row = element("div", "formation-row"),
        model = UnitModels[entry.unitId + "__" + entry.kitId];
      const image = element("img");
      image.src = unitIcon(entry.unitId + "__" + entry.kitId);
      image.width = 56;
      image.alt = model.name;
      const label = element("span", "", `${i + 1}. ${model.code} ${model.name}`),
        kits = element("select");
      const prefab = Rules.catalog.prefabs.find((p) => p.id === entry.unitId);
      prefab.weaponKits.forEach((k) =>
        kits.add(new Option(`${k.name} · COST ${prefab.stats.cost + k.cost}`, k.id)),
      );
      kits.value = entry.kitId;
      kits.onchange = () => {
        entry.kitId = kits.value;
        render();
      };
      const remove = element("button", "", "移除");
      remove.onclick = () => {
        draft.splice(i, 1);
        render();
      };
      const kit = prefab.weaponKits.find((kit) => kit.id === entry.kitId);
      const loadout = element(
        "small",
        "muted",
        "携带：" + kit.weapons.map((id) => prefab.weapons[id].name).join("、"),
      );
      loadout.style.flexBasis = "100%";
      const traits = element(
        "small",
        "muted",
        `HP ${model.hp.toLocaleString()} · 移动 ${model.move} 格 · 机动 ${model.mobility} · ${model.description}`,
      );
      traits.style.flexBasis = "100%";
      row.append(image, label, kits, remove, loadout, traits);
      list.append(row);
    });
    list.scrollTop = scrollTop;
    byId("formationWeapons").textContent =
      "副武器：" +
      [
        ...new Set(
          draft.flatMap((e) => {
            const p = Rules.catalog.prefabs.find((p) => p.id === e.unitId);
            const kit = p.weaponKits.find((k) => k.id === e.kitId);
            return kit.weapons
              .filter((id) => p.weapons[id].slot !== "primary")
              .map((id) => p.weapons[id].name);
          }),
        ),
      ].join("、");
  }
  function open() {
    previousIndex = index;
    returnView = pageView === "room" ? "room" : "menu";
    draft = structuredClone(current());
    byId("formationName").value = squads[index].name;
    refreshSelect();
    render();
    setPageView("formation");
  }
  byId("formationSelect").onchange = (e) => {
    index = Number(e.target.value);
    byId("formationName").value = squads[index].name;
    draft = structuredClone(current());
    render();
  };
  byId("newFormation").onclick = () => {
    squads.push({ name: `编组${squads.length + 1}`, units: structuredClone(fallback) });
    index = squads.length - 1;
    byId("formationName").value = squads[index].name;
    draft = structuredClone(current());
    refreshSelect();
    render();
  };
  byId("addFormationUnit").onclick = () => {
    const prefab = Rules.catalog.prefabs.find((p) => p.id === byId("formationPrefab").value);
    if (draft.length >= Rules.catalog.formation.maxUnits) return note("已达到编组数量上限。");
    draft.push({ unitId: prefab.id, kitId: prefab.weaponKits[0].id });
    render();
    byId("formationUnits").scrollTop = byId("formationUnits").scrollHeight;
  };
  Rules.catalog.prefabs.forEach((p) =>
    byId("formationPrefab").add(new Option(`${p.code} ${p.name}`, p.id)),
  );
  byId("saveFormation").onclick = () => {
    try {
      const units = Rules.validateFormation(draft);
      squads[index] = {
        name: byId("formationName").value.trim().slice(0, 32) || "未命名编组",
        units,
      };
      persist();
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
  return { current, open, name: () => squads[index].name };
})();

/* 开局部署：预放在出生区，玩家可以选中单位后点击空格调整。 */
const Deployment = (() => {
  let hotseat = 0;
  const team = () => (Net.active ? Net.seat : hotseat);
  const canEdit = () =>
    phase === "deployment" &&
    team() !== null &&
    !game.deployment?.[team()] &&
    !Net.awaiting &&
    (!Net.active || Net.snapshot.connected.every(Boolean));
  function render() {
    byId("deploymentPanel").hidden = phase !== "deployment";
    if (phase !== "deployment") return;
    const seat = team();
    byId("deploymentStatus").textContent =
      seat === null
        ? "观战：等待两队部署。"
        : `${teamName(seat)}出生区部署 · 选中己方单位，再点击高亮空格调整位置。`;
    byId("confirmDeployment").disabled = !canEdit();
    byId("confirmDeployment").textContent =
      seat !== null && game.deployment[seat] ? "已确认，等待对方" : "确认部署";
  }
  function click(cell) {
    if (!canEdit()) return;
    const target = Rules.at(game, cell.x, cell.y),
      u = getUnit(selected);
    if (target?.team === team()) {
      selected = target.id;
      update();
      return;
    }
    if (!u || u.team !== team()) return note("请先选中己方单位。");
    if (Net.active) Net.request("deploy", { unitId: u.id, ...cell });
    else {
      try {
        Rules.deploy(game, team(), u.id, cell.x, cell.y);
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
      hotseat = 1;
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
      hotseat = 0;
    },
  };
})();
