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
