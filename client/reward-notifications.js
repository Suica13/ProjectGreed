/* Credit immediately; present all resource rewards together after local combat playback. */
const RewardNotifications = (() => {
  const active = new Map();
  let matchId = null;
  const pending = [];
  function sync(snapshot) {
    if (snapshot.matchId && matchId !== snapshot.matchId) {
      clear();
      matchId = snapshot.matchId;
    }
    if (snapshot.replay || snapshot.phase === "replay" || snapshot.startedFromSave) {
      pending.length = 0;
      return;
    }
    if (!CombatPlayback.waitingFor(snapshot))
      for (const show of pending.splice(0)) show();
  }
  function defer(show, snapshot) {
    sync(snapshot);
    if (snapshot.replay || snapshot.phase === "replay" || snapshot.startedFromSave) return;
    if (CombatPlayback.waitingFor(snapshot)) pending.push(show);
    else show();
  }
  function add(kind, award, snapshot = {}) {
    defer(() => present(kind, award), snapshot);
  }
  function present(kind, award) {
    if (byId("gameScene").hidden) return;
    if (kind === "technology" ? !award.points : !(award.money || award.supplies)) return;
    let entry = active.get("resources");
    if (!entry) {
      const node = element("div", "tech-reward-toast reward-resources");
      node.dataset.rewardKind = "resources";
      byId("techRewardStack").append(node);
      entry = { node, money: 0, supplies: 0, points: {}, timer: null };
      active.set("resources", entry);
      GameAudio.play("killInfoSound");
    }
    entry.node.classList.add("reward-" + kind);
    if (kind === "technology") entry.points[award.faction] = (entry.points[award.faction] || 0) + award.points;
    else { entry.money += award.money || 0; entry.supplies += award.supplies || 0; }
    const labels = [];
    if (entry.money) labels.push(I18n.text("资金") + " +" + entry.money);
    if (entry.supplies) labels.push(I18n.text("物资") + " +" + entry.supplies);
    for (const [faction, points] of Object.entries(entry.points))
      labels.push(I18n.text(faction === "EFSF" ? "地球联邦军" : "吉翁公国军") + " " + I18n.text("科技点") + " +" + points);
    entry.node.textContent = I18n.text("获得") + " " + labels.join(" · ");
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.node.remove();
      active.delete("resources");
    }, 3000);
  }
  function clear() {
    pending.length = 0;
    for (const entry of active.values()) {
      clearTimeout(entry.timer);
      entry.node.remove();
    }
    active.clear();
  }
  window.addEventListener("page-changing", clear);
  return { add, defer, sync };
})();
