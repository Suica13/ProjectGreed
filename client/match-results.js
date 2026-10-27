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
    const totals = awards.reduce(
      (sum, a) => ({
        money: sum.money + a.money,
        supplies: sum.supplies + a.supplies,
        losses: sum.losses + Object.values(a.losses || {}).reduce((n, v) => n + v, 0),
      }),
      { money: 0, supplies: 0, losses: 0 },
    );
    rewards.textContent =
      "本局收益：资金 " +
      totals.money +
      " · 物资 " +
      totals.supplies +
      " · 损毁扣除 " +
      totals.losses +
      " 台";
    rewards.hidden = !Net.active || Net.snapshot?.replay;
    let icons = byId("victoryUnitIcons");
    if (!icons) { icons = element("div"); icons.id = "victoryUnitIcons"; rewards.after(icons); }
    icons.replaceChildren();
    for (const [label, records] of [["损失单位", awards.flatMap(a => a.lostUnits || [])], ["击毁单位", awards.filter(a => a.kind === "kill")]]) {
      icons.append(element("h4", "", label));
      const list = element("div", "result-unit-icons");
      for (const record of records) {
        if (!UnitModels[record.model]) continue;
        const img = element("img"); img.src = unitIcon(record.model); img.alt = UnitModels[record.model].name; img.title = img.alt;
        list.append(img);
      }
      if (!list.children.length) list.append(element("span", "muted", "无"));
      icons.append(list);
    }
    icons.hidden = rewards.hidden;
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
  byId("playAgain").onclick = () => {
    if (!Net.active) {
      openMenu();
      return;
    }
    BattlePrompts.requestReturn();
  };
  return { reset, show, render };
})();
