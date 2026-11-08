/* The header and final results share the same complete, personal receipt totals. */
const MatchIncome = (() => {
  let previous, economy, technology, economyLength, technologyLength, cached;
  const rendered = new WeakMap();
  function totals(snapshot = Net.snapshot) {
    // Snapshots are immutable in live play; length checks also support appended local fixtures.
    if (
      cached &&
      previous === snapshot &&
      economy === snapshot?.economyAwards &&
      technology === snapshot?.techAwards &&
      economyLength === economy?.length &&
      technologyLength === technology?.length
    )
      return cached;
    previous = snapshot;
    economy = snapshot?.economyAwards;
    technology = snapshot?.techAwards;
    economyLength = economy?.length;
    technologyLength = technology?.length;
    cached = BattleEconomy.rewardTotals(economy, technology, snapshot?.matchId);
    return cached;
  }
  function render(container, snapshot = Net.snapshot) {
    const value = totals(snapshot);
    const hidden = !!snapshot?.replay || snapshot?.phase === "replay";
    const key = JSON.stringify([
      value.money,
      value.supplies,
      value.technology,
      hidden,
      I18n.language,
    ]);
    if (rendered.get(container) === key) return;
    rendered.set(container, key);
    container.hidden = hidden;
    ProductionUI.resources(container, value, { compact: true, technology: true });
  }
  return { totals, render };
})();

/* 赛后倒计时只显示服务端期限；联机返回房间由服务端统一裁定。 */
const MatchResults = (() => {
  let timer = null,
    deadline = 0,
    key = null;
  function reset() {
    clearInterval(timer);
    timer = null;
    deadline = 0;
    key = null;
    byId("victoryCountdown").textContent = "";
  }
  function render() {
    if (!deadline) return;
    const remaining = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
    byId("victoryCountdown").textContent = Net.active
      ? remaining + "秒后所有人返回房间"
      : remaining + "秒后返回主菜单";
    const host = Net.active && Net.snapshot?.hostId === Net.memberId;
    byId("playAgain").textContent = Net.active
      ? host
        ? "返回房间（全员）"
        : "等待房主或倒计时返回"
      : "立即返回主菜单";
    byId("playAgain").disabled =
      Net.active && (!host || Net.socket?.readyState !== WebSocket.OPEN || !!Net.awaiting);
    if (!remaining && !Net.active) {
      reset();
      openMenu();
    }
  }
  function show() {
    if (window.GamePreview?.active) return;
    let rewards = byId("victoryEconomy");
    if (!rewards) {
      rewards = element("p", "resource-balance");
      rewards.id = "victoryEconomy";
      byId("victoryCountdown").before(rewards);
    }
    const awards = Net.snapshot?.economyAwards || [];
    const losses = awards.reduce(
      (sum, award) => sum + Object.values(award.losses || {}).reduce((n, value) => n + value, 0),
      0,
    );
    const balance = element("span", "resource-balance");
    MatchIncome.render(balance);
    rewards.replaceChildren(
      element("span", "", I18n.text("本局收益") + "："),
      balance,
      element("span", "", " · " + I18n.text("损毁扣除") + " " + losses + " " + I18n.text("台")),
    );
    rewards.hidden = !Net.active || Net.snapshot?.replay;
    let icons = byId("victoryUnitIcons");
    if (!icons) {
      icons = element("div");
      icons.id = "victoryUnitIcons";
      rewards.after(icons);
    }
    icons.replaceChildren();
    const spectating = Net.active && Net.seat === null;
    const sections = spectating
      ? (Net.snapshot?.teamLosses || [0, 1].map((team) => ({ team, units: [] }))).map(
          ({ team, units }) => ({
            team,
            records: units,
            label:
              I18n.text("队伍") + (team + 1) + " · " + I18n.text("损毁单位") + " " + units.length,
          }),
        )
      : [
          { label: I18n.text("损失单位"), records: awards.flatMap((a) => a.lostUnits || []) },
          { label: I18n.text("击毁单位"), records: awards.filter((a) => a.kind === "kill") },
        ];
    for (const { label, records, team } of sections) {
      const section = element("section", team === undefined ? "" : "result-team-losses");
      if (team !== undefined) section.dataset.team = String(team);
      section.append(element("h4", "", label));
      const list = element("div", "result-unit-icons");
      for (const record of records) {
        if (!UnitModels[record.model]) continue;
        const img = element("img");
        img.src = unitIcon(record.model);
        img.alt = UnitModels[record.model].name;
        img.title = img.alt;
        img.dataset.unitId = record.id || "";
        list.append(img);
      }
      if (!list.children.length) list.append(element("span", "muted", I18n.text("无")));
      section.append(list);
      icons.append(section);
    }
    rewards.hidden ||= spectating;
    icons.hidden = !Net.active || !!Net.snapshot?.replay;
    const snapshot = Net.snapshot,
      next = Net.active ? snapshot?.matchId : "offline-" + session;
    if (next !== key || !timer) {
      reset();
      key = next;
      deadline =
        performance.now() +
        (Net.active
          ? Math.max(
              0,
              (snapshot?.returnAt || Date.now() + 30000) - (snapshot?.serverTime || Date.now()),
            )
          : 30000);
      timer = setInterval(render, 250);
    }
    render();
  }
  byId("victoryRecords").onclick = () => window.ReplayPlayer?.openRecords();
  byId("playAgain").onclick = () => {
    if (!Net.active) {
      openMenu();
      return;
    }
    BattlePrompts.requestReturn();
  };
  return { reset, show, render };
})();
