/* 0079 早期／后期与0083科技树：展示原 MOD 图标、前置连线与已接入单位。 */
"use strict";
const DevelopmentUI = (() => {
  const screen = byId("developmentScreen");
  const graph = byId("developmentTree");
  const treeStage = graph.parentElement;
  const treeScroll = graph.closest(".development-tree-scroll");
  const details = byId("developmentDetails");
  const identity = element("div", "development-faction-identity");
  treeScroll.insertBefore(identity, treeStage);
  const branchColumns = { top: 1, mid: 2, bot: 3 };
  const svgNamespace = "http://www.w3.org/2000/svg";
  let selectedId = null;
  let drawConnections = () => {};

  function fitTree() {
    const style = getComputedStyle(treeScroll);
    const available =
      treeScroll.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (available <= 0) return;
    // Keep three readable design columns, then scale the entire graph, including text.
    const width = Math.max(560, available);
    const scale = Math.min(1, available / width);
    const graphWidth = width + "px";
    const transform = "scale(" + scale + ")";
    if (graph.style.width !== graphWidth) graph.style.width = graphWidth;
    if (graph.style.transform !== transform) graph.style.transform = transform;
    const height = Math.ceil(graph.offsetHeight * scale) + "px";
    if (treeStage.style.height !== height) treeStage.style.height = height;
    drawConnections();
  }

  function receiveAwards(snapshot) {
    RewardNotifications.sync(snapshot);
    if (snapshot.replay || snapshot.phase === "replay" || snapshot.startedFromSave) return;
    for (const award of snapshot.techAwards || [])
      if (Development.creditAward(award)) RewardNotifications.add("technology", award, snapshot);
  }
  function unitRow(unitId) {
    const ace = PilotSystem.aceProfile(unitId);
    if (ace || unitId === "Beacon_ACE_0079") {
      const row = element("button", "development-unit development-ace");
      row.type = "button";
      row.dataset.aceId = ace?.id || "";
      if (ace) {
        const icon = element("img");
        icon.src = ace.icon;
        icon.alt = "";
        row.append(icon);
      } else row.append(element("span", "development-unit-placeholder", "ACE"));
      row.append(element("span", "", ace ? "ACE · " + ace.name : "ACE招募"));
      row.onclick = () => Formation.openAceRecruitment(ace?.id || null);
      return row;
    }
    const prefab = Rules.catalog.prefabs.find((unit) => unit.id === unitId);
    const row = element(prefab ? "button" : "div", "development-unit");
    if (prefab) {
      row.type = "button";
      const icon = element("img");
      icon.src = unitIcon(prefab.id + "__" + prefab.weaponKits[0].id);
      icon.alt = "";
      icon.loading = "lazy";
      row.append(icon, element("span", "", prefab.code + " " + prefab.name));
      row.setAttribute("aria-label", `预览 ${prefab.code} ${prefab.name}`);
      row.onclick = () => Formation.previewUnit(prefab.id, row);
    } else {
      row.append(
        element("span", "development-unit-placeholder", "?"),
        element("span", "", unitId + " · 尚未接入"),
      );
    }
    return row;
  }

  function showDetails(node, faction) {
    const names = new Map(Development.nodes(faction).map((item) => [item.id, item.name]));
    const unlocked = new Set(Development.unlockedTech(faction));
    const available = node.requires.every((id) => unlocked.has(id));
    const researched = unlocked.has(node.id);
    const points = Development.pointBalance(faction);
    const canPay = Economy.affordable(node);
    details.replaceChildren(
      element("h3", "", node.name),
      element("p", "muted", node.description),
      element("p", "", "所需阵营科技点：" + node.points),
      element(
        "p",
        "",
        "前置科技：" + (node.requires.map((id) => names.get(id) || id).join("、") || "无"),
      ),
      element(
        "p",
        "development-research-status muted",
        researched
          ? "已开发"
          : !available
            ? "前置科技未完成"
            : points < node.points
              ? "阵营科技点不足"
              : !canPay
                ? "资金或物资不足"
                : "可以开发",
      ),
      element("h4", "", "解锁单位与驾驶员"),
    );
    if (researched) details.querySelector(".development-research-status")?.remove();
    const units = element("div", "development-units");
    for (const id of node.unlocks) units.append(unitRow(id));
    details.append(units);
    const action = element("button", researched ? "" : "primary", researched ? "已开发" : "开发");
    action.type = "button";
    action.disabled = researched || !available || points < node.points || !canPay;
    action.title = researched ? "已开发" : "消耗 " + node.points + " 科技点";
    action.onclick = () => {
      try {
        if (Development.research(faction, node.id)) {
          window.dispatchEvent(new Event("development-changed"));
          render();
        }
      } catch {
        note("科技进度保存失败，请检查浏览器存储空间");
      }
    };
    const price = element("div", "resource-balance");
    ProductionUI.resources(price, node);
    price.classList.add("development-research-price");
    details.insertBefore(price, details.querySelector("h4"));
    details.insertBefore(action, price);
  }

  function render() {
    const faction = byId("developmentFactionSelect").value;
    screen.dataset.faction = faction;
    byId("developmentMain").dataset.faction = faction;
    const allNodes = Development.nodes(faction);
    const nodes = allNodes;
    const lateStart = Math.max(0, ...nodes.filter((n) => !n.page).map((n) => n.column)) + 2;
    const unlocked = new Set(Development.unlockedTech(faction));
    const badge = element("strong", "development-faction-code", faction);
    badge.setAttribute("data-i18n-ignore", "");
    identity.replaceChildren(
      badge,
      element(
        "span",
        "development-faction-name",
        byId("developmentFactionSelect").selectedOptions[0]?.textContent || faction,
      ),
      element(
        "span",
        "development-faction-progress",
        "已开发" +
          " · " +
          allNodes.filter((node) => unlocked.has(node.id)).length +
          " / " +
          allNodes.length,
      ),
    );
    byId("developmentPoints").textContent = String(Development.pointBalance(faction));
    if (!nodes.some((node) => node.id === selectedId)) selectedId = nodes[0]?.id || null;
    graph.replaceChildren();
    const lines = document.createElementNS(svgNamespace, "svg");
    lines.setAttribute("class", "development-lines");
    lines.setAttribute("aria-hidden", "true");
    graph.append(lines);
    const divider = element("div", "development-era-divider", "0079后期");
    divider.style.gridColumn = "1 / -1";
    divider.style.gridRow = String(lateStart - 1);
    graph.append(divider);
    const cards = new Map();
    for (const node of nodes) {
      const card = element("button", "development-node");
      card.type = "button";
      card.style.gridColumn = String(branchColumns[node.row]);
      card.style.gridRow = String(node.column + (node.page ? lateStart - 1 : 0));
      card.dataset.techId = node.id;
      card.dataset.state = unlocked.has(node.id) ? "unlocked" : "locked";
      card.dataset.prerequisiteLocked = String(
        !unlocked.has(node.id) && node.requires.some((id) => !unlocked.has(id)),
      );
      card.setAttribute("aria-pressed", String(node.id === selectedId));
      const main = element("span", "development-node-main");
      const icon = element("img", "development-node-icon");
      icon.src = node.icon;
      icon.alt = "";
      main.append(icon, element("strong", "", node.name));
      const footer = element("span", "development-node-footer");
      footer.append(
        element("span", "development-cost", node.points + " 科技点"),
        element("small", "development-node-state", unlocked.has(node.id) ? "已开发" : "未开发"),
      );
      card.append(main, footer);
      card.onclick = () => {
        selectedId = node.id;
        for (const button of cards.values())
          button.setAttribute("aria-pressed", String(button === card));
        showDetails(node, faction);
      };
      cards.set(node.id, card);
      graph.append(card);
    }
    drawConnections = () => {
      if (!graph.clientWidth || !graph.clientHeight) return;
      const origin = graph.getBoundingClientRect();
      const scale = origin.width / graph.offsetWidth || 1;
      lines.setAttribute("viewBox", `0 0 ${graph.clientWidth} ${graph.clientHeight}`);
      lines.replaceChildren();
      for (const node of nodes)
        for (const requiredId of node.requires) {
          const from = cards.get(requiredId)?.getBoundingClientRect();
          const to = cards.get(node.id)?.getBoundingClientRect();
          if (!from || !to) continue;
          const x1 = (from.left + from.width / 2 - origin.left) / scale;
          const y1 = (from.bottom - origin.top) / scale;
          const x2 = (to.left + to.width / 2 - origin.left) / scale;
          const y2 = (to.top - origin.top) / scale;
          const middle = (y1 + y2) / 2;
          const path = document.createElementNS(svgNamespace, "path");
          path.setAttribute("d", `M ${x1} ${y1} V ${middle} H ${x2} V ${y2}`);
          path.dataset.state =
            unlocked.has(requiredId) && unlocked.has(node.id) ? "unlocked" : "locked";
          lines.append(path);
        }
    };
    requestAnimationFrame(fitTree);
    const selected = nodes.find((node) => node.id === selectedId);
    if (selected) showDetails(selected, faction);
    else details.replaceChildren();
  }

  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(fitTree);
    observer.observe(graph);
    observer.observe(treeScroll);
  }
  window.addEventListener("resize", fitTree);
  byId("developmentFactionSelect").onchange = render;
  byId("developmentPageSelect").onchange = () => {
    selectedId = null;
    treeScroll.scrollTop = 0;
    render();
  };
  byId("openDevelopment").onclick = () => {
    byId("developmentFactionSelect").value = PlayerProfile.faction() === "ZEON" ? "ZEON" : "EFSF";
    setPageView("development");
    render();
    byId("closeDevelopment").focus();
  };
  byId("closeDevelopment").onclick = () => {
    setPageView(window.MenuShell?.returnView() || "menu");
    byId(Net.active ? "shellLobby" : "shellHangar").focus();
  };
  screen.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      byId("closeDevelopment").click();
    }
  });
  window.addEventListener("character-selected", render);
  window.addEventListener("language-change", render);
  return { render, receiveAwards };
})();
