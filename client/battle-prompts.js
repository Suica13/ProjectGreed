/* 结束行动确认与服务端统一返回倒计时；弹窗不裁定游戏状态。 */
const BattlePrompts = (() => {
  const endDialog = byId("endActionConfirm"),
    returnDialog = byId("roomReturnCountdown");
  let endContext = null,
    returnId = null,
    deadline = 0,
    timer = null,
    returnToCampaign = false;
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
    const objectiveCompleted = [0, 1].includes(Net.snapshot?.game?.winner) ||
      [0, 1].includes(Net.snapshot?.game?.campaignBattlefield?.capturedBaseTeam);
    byId("roomReturnTitle").textContent = I18n.text(
      returnToCampaign
        ? objectiveCompleted
          ? "已经完成战略目的"
          : "战局中断，返回战略地图"
        : "即将返回房间",
    );
    byId("roomReturnMessage").textContent = I18n.text(
      returnToCampaign
        ? objectiveCompleted
          ? `返回战略大地图剩余${seconds}秒`
          : `${seconds}秒后所有玩家一起返回战略地图`
        : `${seconds}秒后所有玩家一起返回房间`,
    );
  }
  function resetReturn() {
    clearInterval(timer);
    timer = null;
    returnId = null;
    if (returnDialog.open) returnDialog.close();
  }
  function receive(snapshot) {
    if (snapshot !== Net.snapshot) return;
    refreshEnd();
    const countdown = snapshot.returnCountdown;
    if (!countdown || !snapshot.started || snapshot.phase === "waiting") {
      resetReturn();
      return;
    }
    closeEnd();
    returnToCampaign = countdown.destination === "campaign";
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
