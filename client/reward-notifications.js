/* One immediate notification per reward type, extended by three seconds on every new credit. */
const RewardNotifications = (() => {
  const active = new Map();
  function add(kind, award) {
    if (byId("gameScene").hidden) return;
    if (kind === "technology" ? !award.points : !(award.money || award.supplies)) return;
    let entry = active.get(kind);
    if (!entry) {
      const node = element("div", "tech-reward-toast reward-" + kind);
      node.dataset.rewardKind = kind;
      byId("techRewardStack").append(node);
      entry = { node, money: 0, supplies: 0, points: {}, timer: null };
      active.set(kind, entry);
      GameAudio.play("killInfoSound");
    }
    if (kind === "technology") {
      entry.points[award.faction] = (entry.points[award.faction] || 0) + award.points;
      entry.node.textContent = Object.entries(entry.points)
        .map(
          ([faction, points]) =>
            I18n.text("获得") +
            points +
            " " +
            I18n.text(faction === "EFSF" ? "地球联邦军" : "吉翁公国军") +
            " " +
            I18n.text("科技点"),
        )
        .join(" · ");
    } else {
      entry.money += award.money;
      entry.supplies += award.supplies;
      entry.node.textContent =
        I18n.text("获得") +
        " " +
        I18n.text("资金") +
        " +" +
        entry.money +
        (entry.supplies ? " · " + I18n.text("物资") + " +" + entry.supplies : "");
    }
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.node.remove();
      active.delete(kind);
    }, 3000);
  }
  window.addEventListener("page-changing", () => {
    for (const entry of active.values()) {
      clearTimeout(entry.timer);
      entry.node.remove();
    }
    active.clear();
  });
  return { add };
})();
