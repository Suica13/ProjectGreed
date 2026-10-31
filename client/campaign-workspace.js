/* Campaign inspectors share presentation helpers, never personal economy or research mutations. */
window.CampaignWorkspace = (() => {
  const dialog = element("dialog", "campaign-workspace");
  dialog.id = "campaignWorkspace";
  dialog.setAttribute("aria-labelledby", "campaignWorkspaceTitle");
  document.body.append(dialog);
  let kind = "production",
    regionId = "jaburo",
    selectedUnit = null,
    selectedTech = null;
  let infoTab = "stats",
    query = "",
    type = "";
  let list, inspector, balance, search, filter;
  const selectedKits = new Map();
  const node = (tag, text = "", css = "") => element(tag, css, text);
  const context = () => ({
    G: Rules,
    world: CAMPAIGN_WORLD,
    production: PRODUCTION_CATALOG,
    development: Development,
  });
  const state = () => Net.snapshot?.campaign;
  const team = () => (Number.isInteger(Net.seat) ? Rules.seatTeam(Net.seat) : 0);
  const pool = () => state().teams[team()];
  const editable = () =>
    Number.isInteger(Net.seat) && state()?.phase === "strategy" && state().winner === null;
  function action(label, callback, disabled = false) {
    const button = node("button", label);
    button.type = "button";
    button.disabled = disabled || !!Net.awaiting;
    button.onclick = callback;
    return button;
  }
  function money(value) {
    const row = node("div", "", "resource-balance campaign-price");
    ProductionUI.resources(row, value);
    return row;
  }
  function icon(src, css = "") {
    const image = node("img", "", css);
    image.src = src;
    image.alt = "";
    image.loading = "lazy";
    return image;
  }
  function name(prefab) {
    return I18n.localized(prefab);
  }
  function model(prefab) {
    return UnitModels[prefab.id + "__" + PRODUCTION_CATALOG.defaultKits[prefab.id]];
  }
  function unitPrice(prefab) {
    return CampaignRules.quote(context(), prefab.id, selectedKits.get(prefab.id));
  }
  function prefabList() {
    return ART.prefabs
      .filter(
        (prefab) =>
          prefab.faction === pool().faction &&
          !prefab.disabled &&
          !prefab.formOnly &&
          prefab.production?.enabled !== false &&
          model(prefab) &&
          !model(prefab).requiredPilotId &&
          model(prefab).adaptability.ground > 0 &&
          unitPrice(prefab),
      )
      .sort(
        (a, b) =>
          Number(CampaignRules.available(context(), state(), team(), b.id)) -
            Number(CampaignRules.available(context(), state(), team(), a.id)) ||
          model(a).cost - model(b).cost ||
          name(a).localeCompare(name(b)),
      );
  }
  function chooseUnit(id) {
    selectedUnit = id;
    drawList();
    drawUnit();
  }
  function unitCard(prefab) {
    const price = unitPrice(prefab),
      m = UnitModels[prefab.id + "__" + price.kitId];
    const row = action("", () => chooseUnit(prefab.id));
    row.className = "campaign-catalog-card";
    row.dataset.unitId = prefab.id;
    row.setAttribute("aria-pressed", String(selectedUnit === prefab.id));
    row.append(icon(unitIcon(m.id || prefab.id + "__" + price.kitId), "campaign-catalog-icon"));
    const content = node("span", "", "campaign-card-copy");
    content.append(
      node("strong", name(prefab)),
      node("small", prefab.code || prefab.id),
      UnitPreview.unitTags(m),
    );
    content.append(
      node("small", I18n.localized(prefab.weaponKits.find((kit) => kit.id === price.kitId))),
    );
    const costs = money(price);
    costs.append(
      node(
        "span",
        "×" + price.quantity + I18n.text("台") + " · " + price.turns + I18n.text("大回合"),
      ),
    );
    content.append(costs);
    if (!CampaignRules.available(context(), state(), team(), prefab.id))
      content.append(node("small", "尚未开发", "campaign-warning"));
    row.append(content);
    return row;
  }
  function drawList() {
    const scroll = list.scrollTop;
    list.replaceChildren();
    const needle = query.trim().toLowerCase();
    if (kind === "production") {
      const entries = prefabList().filter(
        (prefab) =>
          (!type || model(prefab).unitTags.includes(type)) &&
          (prefab.id + prefab.code + name(prefab)).toLowerCase().includes(needle),
      );
      if (!entries.some((prefab) => prefab.id === selectedUnit))
        selectedUnit = entries[0]?.id || null;
      list.append(...entries.map(unitCard));
      if (!entries.length) list.append(node("p", "没有符合筛选的单位", "campaign-empty"));
    } else drawTree(needle);
    list.scrollTop = scroll;
  }
  function metrics(container, entries) {
    const dl = node("dl", "", "campaign-metrics");
    for (const [key, value] of entries) {
      const cell = node("div");
      cell.append(node("dt", key), node("dd", String(value)));
      dl.append(cell);
    }
    container.append(dl);
  }
  function drawUnit() {
    inspector.replaceChildren();
    const prefab = ART.prefabs.find((item) => item.id === selectedUnit);
    if (!prefab) return;
    const price = unitPrice(prefab),
      m = UnitModels[prefab.id + "__" + price.kitId];
    const content = node("div", "", "campaign-inspector-content");
    content.append(node("h3", name(prefab)), UnitPreview.unitTags(m));
    const equipment = node("label", "生产套件", "campaign-kit-choice");
    const kits = node("select");
    kits.id = "campaignProductionKit";
    for (const kit of prefab.weaponKits) {
      const offer = CampaignRules.quote(context(), prefab.id, kit.id);
      const option = new Option(
        I18n.localized(kit) + (offer ? "" : " · " + I18n.text("暂无生产报价")),
        kit.id,
      );
      option.disabled = !offer;
      kits.append(option);
    }
    kits.value = price.kitId;
    kits.disabled = prefab.weaponKits.length === 1;
    kits.onchange = () => {
      selectedKits.set(prefab.id, kits.value);
      drawList();
      drawUnit();
    };
    equipment.append(kits);
    content.append(equipment);
    const canvas = node("canvas", "", "campaign-unit-preview");
    canvas.width = 440;
    canvas.height = 240;
    UnitPreview.renderPreview(prefab.id + "__" + price.kitId, canvas);
    content.append(canvas);
    const tabs = node("nav", "", "campaign-tabs");
    tabs.setAttribute("aria-label", "单位信息");
    for (const [id, label] of [
      ["stats", "属性"],
      ["weapons", "武装"],
      ["abilities", "能力"],
    ]) {
      const button = action(label, () => {
        infoTab = id;
        drawUnit();
      });
      button.setAttribute("aria-pressed", String(infoTab === id));
      tabs.append(button);
    }
    content.append(tabs);
    const info = node("div", "", "campaign-unit-info");
    if (infoTab === "stats") {
      info.append(node("h4", "基础性能"));
      metrics(info, [
        ["HP", formatNumber(m.hp)],
        ["EN", formatNumber(m.en)],
        ["行动点", m.actionPoints],
        ["移动", m.move],
        ["盾牌HP", formatNumber(m.shield.hp)],
        ["视野距离", m.sensors.sight],
        ["侦察距离", m.sensors.radar],
      ]);
      info.append(node("h4", "移动与适应性"));
      metrics(info, [
        ["地面", m.adaptability.ground + "%"],
        ["宇宙", m.adaptability.space + "%"],
        ["水中", m.adaptability.water + "%"],
        ["空中", m.adaptability.air + "%"],
      ]);
    } else if (infoTab === "weapons") {
      for (const weapon of m.weapons) info.append(WeaponInfo.card(weapon));
    } else {
      const skills = [
        ...SkillControls.commandAbilities(m),
        ...SkillControls.defensiveAbilities(m),
        ...(m.skills || []),
      ];
      for (const skill of skills) {
        const card = node("article", "", "formation-weapon-detail");
        card.append(node("strong", skill.name), node("p", SkillControls.description(skill)));
        info.append(card);
      }
      if (!skills.length) info.append(node("p", "无特殊能力"));
    }
    content.append(info);
    const footer = node("footer", "", "campaign-purchase");
    footer.append(
      node("strong", "每批生产价格"),
      money(price),
      node("p", `每批${price.quantity}台 · ${price.turns}大回合`),
    );
    const basePrice = CampaignRules.quote(context(), prefab.id);
    const body = {
      money: Math.ceil((basePrice.money / basePrice.quantity) * price.quantity),
      supplies: Math.ceil((basePrice.supplies / basePrice.quantity) * price.quantity),
    };
    const breakdown = node("details", "", "campaign-kit-breakdown");
    breakdown.append(
      node("summary", "价格明细"),
      node("small", "基础套件价格"),
      money(body),
      node("small", "所选套件差价"),
      money({ money: price.money - body.money, supplies: price.supplies - body.supplies }),
    );
    footer.append(breakdown);
    const region = state().regions.find((item) => item.id === regionId),
      base = CAMPAIGN_WORLD.regions.find((item) => item.id === regionId);
    const reason = !CampaignRules.available(context(), state(), team(), prefab.id, price.kitId)
      ? "尚未开发"
      : !base?.factory || region.owner !== team()
        ? "请选择己方生产据点"
        : CampaignRules.disputed(state(), regionId)
          ? "交战中的据点不能生产"
          : !editable()
            ? "当前不能下达战略命令"
            : "";
    if (reason) footer.append(node("p", reason, "campaign-warning"));
    const waiting = pool().money < price.money || pool().supplies < price.supplies;
    footer.append(
      action(
        waiting ? "提交请求（等待资源）" : "提交生产请求",
        () =>
          Net.request("campaign_produce", {
            turn: state().turn,
            region: regionId,
            unitId: prefab.id,
            kitId: price.kitId,
          }),
        !!reason,
      ),
    );
    inspector.append(content, footer);
  }
  function drawTree(needle) {
    const nodes = Development.nodes(pool().faction);
    if (!nodes.some((tech) => tech.id === selectedTech))
      selectedTech =
        nodes.find(
          (tech) =>
            !pool().researched.includes(tech.id) &&
            tech.requires.every((id) => pool().researched.includes(id)),
        )?.id || nodes[0]?.id;
    const grid = node("div", "", "campaign-tech-grid");
    let offset = 1;
    for (const page of [...new Set(nodes.map((tech) => tech.page || 0))].sort((a, b) => a - b)) {
      const section = nodes.filter((tech) => (tech.page || 0) === page);
      const heading = node("h3", section[0]?.era || "0079", "campaign-tree-era");
      heading.style.gridRow = offset;
      grid.append(heading);
      for (const tech of section) {
        const unlocks = tech.unlocks
          .map((id) => ART.prefabs.find((prefab) => prefab.id === id))
          .filter(Boolean);
        if (
          needle &&
          !(tech.name + tech.description + unlocks.map(name).join(" "))
            .toLowerCase()
            .includes(needle)
        )
          continue;
        const researched = pool().researched.includes(tech.id),
          available = tech.requires.every((id) => pool().researched.includes(id));
        const card = action("", () => {
          selectedTech = tech.id;
          drawList();
          drawTech();
        });
        card.className = "campaign-tech-node";
        card.dataset.techId = tech.id;
        card.dataset.status = researched ? "researched" : available ? "available" : "locked";
        card.setAttribute("aria-pressed", String(selectedTech === tech.id));
        card.style.gridColumn = { top: 1, mid: 2, bot: 3 }[tech.row] || 2;
        card.style.gridRow = offset + tech.column;
        card.append(
          icon(tech.icon, "campaign-tech-icon"),
          node("strong", tech.name),
          node("small", researched ? "已开发" : available ? "可以开发" : "前置科技未完成"),
          node("small", `科技 ${formatNumber(tech.points)}`),
          money(tech),
        );
        grid.append(card);
      }
      offset += Math.max(...section.map((tech) => tech.column)) + 2;
    }
    list.append(grid);
    requestAnimationFrame(() => {
      if (!grid.isConnected) return;
      const rect = grid.getBoundingClientRect(),
        svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "campaign-tree-links");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
      for (const tech of nodes) {
        const target = grid.querySelector(`[data-tech-id="${tech.id}"]`);
        if (!target) continue;
        const b = target.getBoundingClientRect();
        for (const id of tech.requires) {
          const source = grid.querySelector(`[data-tech-id="${id}"]`);
          if (!source) continue;
          const a = source.getBoundingClientRect();
          const line = document.createElementNS(svg.namespaceURI, "path");
          line.setAttribute(
            "d",
            `M${a.x + a.width / 2 - rect.x} ${a.bottom - rect.y}L${b.x + b.width / 2 - rect.x} ${b.top - rect.y}`,
          );
          svg.append(line);
        }
      }
      grid.prepend(svg);
    });
  }
  function drawTech() {
    inspector.replaceChildren();
    const nodes = Development.nodes(pool().faction),
      tech = nodes.find((item) => item.id === selectedTech);
    if (!tech) return;
    const content = node("div", "", "campaign-inspector-content");
    content.append(
      icon(tech.icon, "campaign-tech-detail-icon"),
      node("h3", tech.name),
      node("p", tech.description),
    );
    const prerequisites = node("section", "", "campaign-prerequisites");
    prerequisites.append(node("h4", "前置科技"));
    if (!tech.requires.length) prerequisites.append(node("p", "无"));
    for (const id of tech.requires) {
      const required = nodes.find((item) => item.id === id);
      prerequisites.append(
        action((pool().researched.includes(id) ? "✓ " : "") + required.name, () => {
          selectedTech = id;
          drawList();
          drawTech();
        }),
      );
    }
    content.append(prerequisites, node("h4", "解锁单位"));
    const units = node("div", "", "campaign-unlock-list");
    let missing = 0;
    for (const id of tech.unlocks) {
      const prefab = ART.prefabs.find((item) => item.id === id);
      if (!prefab) {
        missing++;
        continue;
      }
      const kit = PRODUCTION_CATALOG.defaultKits[id] || prefab.weaponKits[0]?.id;
      const row = node("div", "", "campaign-unlock-unit");
      row.append(
        icon(unitIcon(id + "__" + kit)),
        node("span", (prefab.code ? prefab.code + " " : "") + name(prefab)),
      );
      units.append(row);
    }
    if (!units.children.length) units.append(node("p", "无可用单位"));
    content.append(units);
    if (missing) content.append(node("p", `另有${missing}项单位或驾驶员暂未接入战略模式`, "muted"));
    const footer = node("footer", "", "campaign-purchase");
    footer.append(
      node("strong", "开发费用"),
      node("p", `科技 ${formatNumber(tech.points)}`),
      money(tech),
    );
    const researched = pool().researched.includes(tech.id),
      available = tech.requires.every((id) => pool().researched.includes(id));
    const affordable =
      pool().technology >= tech.points &&
      pool().money >= (tech.money || 0) &&
      pool().supplies >= (tech.supplies || 0);
    const status = researched
      ? "已开发"
      : !available
        ? "前置科技未完成"
        : !affordable
          ? "研发资源不足"
          : "可以开发";
    footer.append(
      node("p", status),
      action(
        "开发",
        () => Net.request("campaign_research", { turn: state().turn, techId: tech.id }),
        !editable() || researched || !available || !affordable,
      ),
    );
    inspector.append(content, footer);
  }
  function refresh() {
    if (!dialog.open) return;
    if (!state() || Net.started) return close();
    balance.replaceChildren(
      money(pool()),
      node("strong", I18n.text("科技 ") + formatNumber(pool().technology)),
    );
    drawList();
    kind === "production" ? drawUnit() : drawTech();
  }
  function open(nextKind, nextRegion) {
    if (!state()) return;
    kind = nextKind;
    regionId = nextRegion;
    query = "";
    type = "";
    dialog.dataset.kind = kind;
    dialog.dataset.faction = pool().faction;
    const header = node("header", "", "campaign-workspace-header");
    const title = node("h2", kind === "production" ? "生产单位" : "科技开发");
    title.id = "campaignWorkspaceTitle";
    header.append(
      title,
      node(
        "span",
        kind === "production"
          ? CAMPAIGN_WORLD.regions.find((item) => item.id === regionId).name
          : pool().faction,
      ),
      action("关闭", close),
    );
    balance = node("div", "", "campaign-workspace-balance");
    const toolbar = node("div", "", "campaign-workspace-toolbar");
    search = node("input");
    search.type = "search";
    search.placeholder = kind === "production" ? "搜索单位" : "搜索科技或解锁单位";
    search.setAttribute("aria-label", search.placeholder);
    search.oninput = () => {
      query = search.value;
      drawList();
      kind === "production" ? drawUnit() : drawTech();
    };
    toolbar.append(search);
    if (kind === "production") {
      filter = node("select");
      filter.setAttribute("aria-label", "单位类型");
      filter.append(new Option("全部类型", ""));
      for (const tag of Rules.unitTags)
        filter.append(new Option(I18n.text(Rules.unitTagName(tag)), tag));
      filter.onchange = () => {
        type = filter.value;
        drawList();
        drawUnit();
      };
      toolbar.append(filter);
    }
    const body = node("div", "", "campaign-workspace-body");
    list = node("section", "", "campaign-catalog-list");
    list.setAttribute("aria-label", kind === "production" ? "单位列表" : "科技树");
    inspector = node("aside", "", "campaign-inspector");
    body.append(list, inspector);
    dialog.replaceChildren(header, balance, toolbar, body);
    if (!dialog.open) dialog.showModal();
    refresh();
    if (innerWidth > 760) search.focus();
  }
  function close() {
    if (dialog.open) dialog.close();
  }
  window.addEventListener("resize", () => {
    if (dialog.open && kind === "research") drawList();
  });
  return { open, refresh, close };
})();
