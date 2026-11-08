/* Runs inside the builder's private storage scope; never touches a player's browser save. */
const SaveEditor = (() => {
  const $ = (id) => document.getElementById(id);
  const factions = ["PMC", ...Development.factions];
  const order = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
  let originalPilots = new Map();
  let data,
    nativeSource,
    fileName = "ProjectGreed-profile",
    originalBytes = 0,
    dirtyFormation = false;
  const status = (text, error = false) => {
    $("status").textContent = text;
    $("status").classList.toggle("error", error);
  };
  const element = (tag, text) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function field(parent, label, value, change, options = {}) {
    const row = element("label", label),
      input = document.createElement("input");
    input.type = options.type || "number";
    if (input.type === "number") {
      input.min = 0;
      input.max = options.max ?? Number.MAX_SAFE_INTEGER;
      input.step = 1;
    }
    input.value = value;
    input.disabled = options.disabled === true;
    input.setAttribute("aria-label", label);
    input.addEventListener("input", () => {
      if (!input.checkValidity()) {
        input.reportValidity();
        return;
      }
      change(input.type === "number" ? Number(input.value) : input.value);
      status("存在未保存的修改。保存时会再次校验。");
    });
    row.append(input);
    parent.append(row);
    return input;
  }
  function renderResources() {
    $("resourceFields").replaceChildren();
    $("pointFields").replaceChildren();
    for (const [key, label] of [
      ["money", "资金"],
      ["supplies", "物资"],
    ])
      field($("resourceFields"), label, data.economy[key], (value) => (data.economy[key] = value));
    for (const faction of Development.factions)
      field(
        $("pointFields"),
        faction + " 科技点",
        data.development.points[faction],
        (value) => (data.development.points[faction] = value),
      );
  }
  const unitCatalog = Object.entries(PRODUCTION_CATALOG.baseModels)
    .map(([id, modelId]) => ({ id, ...ART.models[modelId] }))
    .sort((a, b) => order.compare(a.name, b.name) || order.compare(a.id, b.id));
  const basePermits = Economy.validate(undefined).licenses;
  function renderUnits() {
    if (!data) return;
    const query = $("unitSearch").value.trim().toLocaleLowerCase(),
      faction = $("unitFaction").value;
    const units = unitCatalog.filter(
      (unit) =>
        (!faction || (unit.availableFactions || [unit.faction]).includes(faction)) &&
        (!query || [unit.name, unit.id, unit.code].join(" ").toLocaleLowerCase().includes(query)),
    );
    $("unitCount").textContent = "找到 " + units.length + " 个单位";
    $("unitRows").replaceChildren(
      ...units.map((unit) => {
        const row = document.createElement("tr");
        row.dataset.unitId = unit.id;
        const name = element("td", unit.name);
        name.append(element("small", unit.id));
        const meta = element(
          "td",
          [unit.faction, ...(unit.tags || []).filter((tag) => /^00\d/.test(tag))].join(" · "),
        );
        const license = document.createElement("input");
        license.type = "checkbox";
        license.checked = !!data.economy.licenses[unit.id];
        license.disabled = !!basePermits[unit.id];
        license.title = license.disabled ? "基础科技单位默认拥有部署许可" : "部署许可";
        license.setAttribute("aria-label", unit.name + " 部署许可");
        license.onchange = () => {
          if (license.checked) data.economy.licenses[unit.id] = true;
          else delete data.economy.licenses[unit.id];
          status("部署许可已修改，尚未保存。");
        };
        const count = document.createElement("input");
        count.type = "number";
        count.min = 0;
        count.max = 1000000;
        count.step = 1;
        count.value = data.economy.inventory[unit.id] || 0;
        count.setAttribute("aria-label", unit.name + " 库存");
        count.oninput = () => {
          if (!count.checkValidity() || !count.value) return;
          const value = Number(count.value);
          if (value) data.economy.inventory[unit.id] = value;
          else delete data.economy.inventory[unit.id];
          status("库存已修改，尚未保存。");
        };
        const permit = document.createElement("td"),
          stock = document.createElement("td");
        permit.append(license);
        stock.append(count);
        row.append(name, meta, permit, stock);
        return row;
      }),
    );
  }
  function roster() {
    return Object.values(data.pilots).flatMap((store) => store.pilots);
  }
  function renderPilotList() {
    const previous = $("pilotSelect").value,
      query = $("pilotSearch").value.trim().toLocaleLowerCase();
    const pilots = roster()
      .filter(
        (pilot) =>
          !query ||
          [pilot.id, pilot.name, pilot.faction].join(" ").toLocaleLowerCase().includes(query),
      )
      .sort((a, b) => order.compare(a.name, b.name));
    $("pilotSelect").replaceChildren(
      ...pilots.map(
        (pilot) =>
          new Option(pilot.name + " Lv." + pilot.level + " [" + pilot.faction + "]", pilot.id),
      ),
    );
    if (pilots.some((pilot) => pilot.id === previous)) $("pilotSelect").value = previous;
    renderPilot();
  }
  function renderPilot() {
    const target = $("pilotFields");
    target.replaceChildren();
    const pilot = roster().find((pilot) => pilot.id === $("pilotSelect").value);
    if (!pilot) {
      target.append(element("p", "没有匹配的驾驶员"));
      return;
    }
    field(target, "名字", pilot.name, (value) => (pilot.name = value), {
      type: "text",
      disabled: !!pilot.aceId,
    });
    field(
      target,
      "等级",
      pilot.level,
      (value) => {
        pilot.level = value;
        if (pilot.aceId) {
          Object.assign(pilot, PilotSystem.custom({ ...pilot, stats: undefined }));
          renderPilot();
        }
      },
      { max: PilotSystem.maxLevel(pilot) },
    );
    field(target, "累计经验", pilot.experience, (value) => (pilot.experience = value));
    for (const [key, label] of Object.entries(PilotSystem.labels))
      field(target, label, pilot.stats[key], (value) => (pilot.stats[key] = value), {
        disabled: !!pilot.aceId,
      });
    for (const [key, label] of [
      ["kills", "击坠单位"],
      ["shipKills", "击坠战舰"],
      ["battles", "参战次数"],
      ["losses", "被击坠数"],
    ])
      field(target, label, pilot.record[key] || 0, (value) => (pilot.record[key] = value));
    if (!pilot.aceId) {
      const row = element("label", "技能"),
        select = document.createElement("select");
      select.setAttribute("aria-label", "驾驶员技能");
      select.add(new Option("无", ""));
      for (const skill of PilotSystem.skillChoices) select.add(new Option(skill.name, skill.id));
      select.value = pilot.selectedSkillId || "";
      select.onchange = () => {
        if (select.value) pilot.selectedSkillId = select.value;
        else delete pilot.selectedSkillId;
      };
      row.append(select);
      target.append(row);
    }
  }
  function renderResearch() {
    const faction = $("researchFaction").value,
      nodes = Development.nodes(faction);
    const active = new Set(data.development.researched[faction] || []);
    $("researchNodes").replaceChildren(
      ...nodes.map((node) => {
        const row = element("label"),
          check = document.createElement("input");
        check.type = "checkbox";
        check.checked = active.has(node.id);
        check.dataset.techId = node.id;
        check.onchange = () => {
          if (check.checked) {
            const add = (id) => {
              if (active.has(id)) return;
              active.add(id);
              for (const id2 of nodes.find((n) => n.id === id)?.requires || []) add(id2);
            };
            add(node.id);
          } else {
            active.delete(node.id);
            for (let pass = 0; pass < nodes.length; pass++)
              for (const child of nodes)
                if (child.requires.some((id) => !active.has(id))) active.delete(child.id);
          }
          data.development.researched[faction] = [...active];
          renderResearch();
          status("科技开发记录已修改，尚未保存。");
        };
        row.append(check, element("span", node.name + " · 科技点需求 " + node.points));
        return row;
      }),
    );
  }
  function renderFormation() {
    $("formationFaction").dataset.current = $("formationFaction").value;
    $("formationJson").value = JSON.stringify(
      data.formations[$("formationFaction").value],
      null,
      2,
    );
    dirtyFormation = false;
  }
  function applyFormation() {
    if (!dirtyFormation) return;
    const value = JSON.parse($("formationJson").value),
      faction = $("formationFaction").value;
    const next = ProfileSave.validate({
      ...data,
      formations: { ...data.formations, [faction]: value },
    });
    data.formations[faction] = next.formations[faction];
    dirtyFormation = false;
  }
  function checked() {
    applyFormation();
    // Pilots are authoritative in the roster; propagate edits into the expanded UI model.
    const pilots = new Map(
      roster()
        .filter((pilot) => JSON.stringify(pilot) !== originalPilots.get(pilot.id))
        .map((pilot) => [pilot.id, pilot]),
    );
    const next = structuredClone(data);
    for (const formation of Object.values(next.formations))
      for (const squad of formation?.squads || [])
        for (const unit of squad.units)
          if (pilots.has(unit.customPilot?.id)) unit.customPilot = pilots.get(unit.customPilot.id);
    for (const input of document.querySelectorAll("#workspace input:not(:disabled)"))
      if (!input.checkValidity() || (input.type === "number" && !input.value))
        throw Error("存在无效或未填写的数字，请检查输入");
    return ProfileSave.validate(next);
  }
  function output(personal = false) {
    const clean = checked(),
      profile = ProfileSave.encodeData(clean);
    if (!nativeSource || personal) return profile;
    const next = structuredClone(nativeSource);
    for (const [key, value] of ProfileSave.storageEntries(clean)) {
      if (value === null) delete next.values[key];
      else
        Object.defineProperty(next.values, key, {
          value,
          enumerable: true,
          writable: true,
          configurable: true,
        });
    }
    return next;
  }
  function download(personal) {
    try {
      const value = output(personal),
        text = JSON.stringify(value),
        url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download =
        fileName.replace(/\.json$/i, "") + (personal ? "-profile-edited.json" : "-edited.json");
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status(
        "校验通过，副本已生成：" +
          (new Blob([text]).size / 1024).toFixed(1) +
          " KiB；原文件 " +
          (originalBytes / 1024).toFixed(1) +
          " KiB。原文件未修改。",
      );
    } catch (error) {
      status("保存失败：" + error.message, true);
    }
  }
  function open(value, name = "ProjectGreed-profile.json", bytes = 0) {
    const native = value?.format === "ProjectGreed-app-store";
    const clean = native ? ProfileSave.fromNativeSnapshot(value) : ProfileSave.validate(value);
    data = clean;
    originalPilots = new Map(roster().map((pilot) => [pilot.id, JSON.stringify(pilot)]));
    nativeSource = native ? structuredClone(value) : null;
    fileName = name;
    originalBytes = bytes;
    $("workspace").hidden = false;
    $("downloadSave").disabled = $("downloadProfile").disabled = false;
    renderResources();
    renderUnits();
    renderPilotList();
    renderResearch();
    renderFormation();
    status(
      "已读取 " +
        name +
        "；驾驶员 " +
        roster().length +
        " 名。" +
        (native ? "客户端设置与战役备份将原样保留。" : "保存时使用精简存档格式。"),
    );
  }
  $("openSave").onchange = async () => {
    try {
      const file = $("openSave").files[0];
      if (!file) return;
      if (file.size > 64 * 1024 * 1024) throw Error("存档超过 64MB");
      open(JSON.parse((await file.text()).replace(/^\uFEFF/, "")), file.name, file.size);
    } catch (error) {
      status("读取失败：" + error.message, true);
    }
    $("openSave").value = "";
  };
  $("downloadSave").onclick = () => download(false);
  $("downloadProfile").onclick = () => download(true);
  $("unitSearch").oninput = renderUnits;
  $("unitFaction").onchange = renderUnits;
  $("pilotSearch").oninput = () => {
    if (data) renderPilotList();
  };
  $("pilotSelect").onchange = renderPilot;
  const addPilot = (pilot) => {
    if (roster().some((existing) => existing.id === pilot.id)) {
      status("该驾驶员已经存在", true);
      return;
    }
    data.pilots[pilot.faction].pilots.push(pilot);
    $("pilotSearch").value = "";
    renderPilotList();
    $("pilotSelect").value = pilot.id;
    renderPilot();
    status("驾驶员已添加，尚未保存。");
  };
  $("addPilot").onclick = () =>
    addPilot(PilotSystem.createCustom("custom-" + ProfileIdentity.create().id, "PMC驾驶员"));
  for (const ace of PILOT_DATA.aces
    .filter((ace) => ace.price)
    .sort((a, b) => order.compare(a.name, b.name)))
    $("aceSelect").add(new Option(ace.name + " [" + ace.faction + "]", ace.id));
  $("addAce").onclick = () => {
    try {
      addPilot(PilotSystem.createAce($("aceSelect").value));
    } catch (error) {
      status(error.message, true);
    }
  };
  $("researchFaction").onchange = renderResearch;
  $("formationFaction").onchange = () => {
    try {
      if (dirtyFormation) throw Error("请先应用当前编组 JSON 再切换阵营");
      renderFormation();
    } catch (error) {
      $("formationFaction").value = $("formationFaction").dataset.current || "PMC";
      status(error.message, true);
    }
  };
  $("formationFaction").onfocus = () =>
    ($("formationFaction").dataset.current = $("formationFaction").value);
  $("formationJson").oninput = () => (dirtyFormation = true);
  $("applyFormation").onclick = () => {
    try {
      applyFormation();
      status("编组校验通过，尚未保存。");
    } catch (error) {
      status(error.message, true);
    }
  };
  for (const faction of factions) $("formationFaction").add(new Option(faction, faction));
  for (const faction of Development.factions) {
    $("researchFaction").add(new Option(faction, faction));
    $("unitFaction").add(new Option(faction, faction));
  }
  for (const button of $("tabs").querySelectorAll("button"))
    button.onclick = () => {
      for (const page of document.querySelectorAll(".page"))
        page.hidden = page.id !== button.dataset.tab;
      for (const tab of $("tabs").querySelectorAll("button"))
        tab.setAttribute("aria-selected", String(tab === button));
    };
  $("tabs").firstElementChild.click();
  return { open, output };
})();
