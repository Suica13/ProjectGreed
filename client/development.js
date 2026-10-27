/* 0079 第一页科技树：展示原 MOD 图标、前置连线与已接入单位。 */
"use strict";
const DevelopmentUI = (() => {
  const screen = byId("developmentScreen");
  const graph = byId("developmentTree");
  const details = byId("developmentDetails");
  const branchColumns = { top: 1, mid: 2, bot: 3 };
  const svgNamespace = "http://www.w3.org/2000/svg";
  let selectedId = null;
  let drawConnections = () => {};

  const pendingAwards = new Map();
  let awardMatch = null;
  function receiveAwards(snapshot) {
    if (snapshot.replay || snapshot.phase === "replay" || snapshot.startedFromSave) return;
    if (awardMatch !== snapshot.matchId) {
      pendingAwards.clear();
      awardMatch = snapshot.matchId;
    }
    for (const award of snapshot.techAwards || []) {
      // Balance is credited immediately; only the notification waits for turn end.
      if (Development.creditAward(award)) pendingAwards.set(award.id, award);
    }
    if (snapshot.phase === "playback") return;
    const ready = [...pendingAwards.values()].filter(
      (award) =>
        snapshot.phase === "finished" ||
        award.round !== snapshot.game?.round ||
        award.team !== snapshot.game?.team,
    );
    const totals = new Map();
    for (const award of ready) {
      pendingAwards.delete(award.id);
      totals.set(award.faction, (totals.get(award.faction) || 0) + award.points);
    }
    for (const [faction, points] of totals) {
      if (byId("gameScene").hidden) continue;
      GameAudio.play("killInfoSound");
      const toast = element(
        "div",
        "tech-reward-toast",
        "获得" + points + "点" + (faction === "EFSF" ? "地球联邦军" : "吉翁公国军") + "科技点",
      );
      byId("techRewardStack").append(toast);
      setTimeout(() => toast.remove(), 3200);
    }
  }
  function defeated() {}
  function finishPlayback() {}
  function unitRow(unitId) {
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
        researched ? "success-text" : "muted",
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
      element("h4", "", "解锁单位"),
    );
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
    details.insertBefore(price, units);
    details.append(action);
  }

  function render() {
    const faction = byId("developmentFactionSelect").value;
    screen.dataset.faction = faction;
    byId("developmentMain").dataset.faction = faction;
    const nodes = Development.nodes(faction);
    const unlocked = new Set(Development.unlockedTech(faction));
    byId("developmentPoints").textContent = String(Development.pointBalance(faction));
    if (!nodes.some((node) => node.id === selectedId)) selectedId = nodes[0]?.id || null;
    graph.replaceChildren();
    const lines = document.createElementNS(svgNamespace, "svg");
    lines.setAttribute("class", "development-lines");
    lines.setAttribute("aria-hidden", "true");
    graph.append(lines);
    const cards = new Map();
    for (const node of nodes) {
      const card = element("button", "development-node");
      card.type = "button";
      card.style.gridColumn = String(branchColumns[node.row]);
      card.style.gridRow = String(node.column);
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
      card.append(
        main,
        element("span", "development-cost", node.points + " 科技点"),
        element("small", "", unlocked.has(node.id) ? "已开发" : "未开发"),
      );
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
      lines.setAttribute("viewBox", `0 0 ${graph.clientWidth} ${graph.clientHeight}`);
      lines.replaceChildren();
      for (const node of nodes)
        for (const requiredId of node.requires) {
          const from = cards.get(requiredId)?.getBoundingClientRect();
          const to = cards.get(node.id)?.getBoundingClientRect();
          if (!from || !to) continue;
          const x1 = from.left + from.width / 2 - origin.left;
          const y1 = from.bottom - origin.top;
          const x2 = to.left + to.width / 2 - origin.left;
          const y2 = to.top - origin.top;
          const middle = (y1 + y2) / 2;
          const path = document.createElementNS(svgNamespace, "path");
          path.setAttribute("d", `M ${x1} ${y1} V ${middle} H ${x2} V ${y2}`);
          path.dataset.state =
            unlocked.has(requiredId) && unlocked.has(node.id) ? "unlocked" : "locked";
          lines.append(path);
        }
    };
    requestAnimationFrame(drawConnections);
    const selected = nodes.find((node) => node.id === selectedId);
    if (selected) showDetails(selected, faction);
    else details.replaceChildren();
  }

  if (typeof ResizeObserver !== "undefined")
    new ResizeObserver(() => drawConnections()).observe(graph);
  window.addEventListener("resize", () => drawConnections());
  byId("developmentFactionSelect").onchange = render;
  byId("openDevelopment").onclick = () => {
    byId("developmentFactionSelect").value = PlayerProfile.faction() === "ZEON" ? "ZEON" : "EFSF";
    setPageView("development");
    render();
    byId("closeDevelopment").focus();
  };
  byId("closeDevelopment").onclick = () => {
    setPageView("menu");
    byId("openDevelopment").focus();
  };
  screen.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      byId("closeDevelopment").click();
    }
  });
  window.addEventListener("character-selected", render);
  window.addEventListener("language-change", render);
  return { render, receiveAwards, defeated, finishPlayback };
})();
