/* 结束行动确认与服务端统一返回倒计时；弹窗不裁定游戏状态。 */
const BattlePrompts = (() => {
  const endDialog = byId("endActionConfirm"),
    returnDialog = byId("roomReturnCountdown");
  let endContext = null,
    returnId = null,
    deadline = 0,
    timer = null;
  function closeEnd() {
    endContext = null;
    if (endDialog.open) endDialog.close();
  }
  function endAllowed() {
    return (
      endContext &&
      pageView === "game" &&
      !isBusy() &&
      !isAI() &&
      endContext.session === session &&
      endContext.round === game.round &&
      endContext.team === game.team &&
      (!Net.active ||
        (Net.canAct() &&
          endContext.matchId === Net.snapshot?.matchId &&
          endContext.seat === Net.seat))
    );
  }
  function refreshEnd() {
    if (endContext && !endAllowed()) closeEnd();
  }
  function confirmEnd(remaining) {
    endContext = {
      session,
      round: game.round,
      team: game.team,
      matchId: Net.snapshot?.matchId,
      seat: Net.seat,
    };
    byId("endActionMessage").textContent = I18n.text(
      `尚有${remaining}台单位可以行动，确定结束行动吗？`,
    );
    if (!endDialog.open) endDialog.showModal();
  }
  byId("cancelEndAction").onclick = closeEnd;
  endDialog.addEventListener("cancel", () => {
    endContext = null;
  });
  byId("confirmEndAction").onclick = () => {
    const allowed = endAllowed();
    closeEnd();
    if (allowed) endTurn();
  };
  function renderReturn() {
    const seconds = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
    byId("roomReturnMessage").textContent = I18n.text(`${seconds}秒后所有玩家一起返回房间`);
  }
  function resetReturn() {
    clearInterval(timer);
    timer = null;
    returnId = null;
    if (returnDialog.open) returnDialog.close();
  }
  function receive(snapshot) {
    refreshEnd();
    const countdown = snapshot.returnCountdown;
    if (!countdown) {
      resetReturn();
      return;
    }
    closeEnd();
    if (returnId !== countdown.id) {
      resetReturn();
      returnId = countdown.id;
      deadline = performance.now() + Math.max(0, countdown.at - snapshot.serverTime);
      timer = setInterval(renderReturn, 250);
    }
    renderReturn();
    if (!returnDialog.open) returnDialog.showModal();
  }
  returnDialog.addEventListener("cancel", (event) => event.preventDefault());
  function requestReturn() {
    const snapshot = Net.snapshot;
    if (
      !Net.active ||
      !snapshot?.started ||
      snapshot.hostId !== Net.memberId ||
      snapshot.returnCountdown ||
      Net.awaiting
    )
      return;
    Net.request("return_room", { matchId: snapshot.matchId });
  }
  function reset() {
    closeEnd();
    resetReturn();
  }
  const api = { confirmEnd, refreshEnd, receive, requestReturn, reset };
  window.BattlePrompts = api;
  return api;
})();
