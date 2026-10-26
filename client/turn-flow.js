/* 离线 AI 自动回合与回合交接演出。人类玩家始终手动结束行动。 */
const TurnFlow = (() => {
  let timer = null,
    automaticTurn = null,
    animation = null,
    generation = 0,
    active = false;
  function cancelAutoEnd() {
    clearTimeout(timer);
    timer = automaticTurn = null;
  }
  function reset() {
    generation++;
    animation?.cancel();
    animation = null;
    active = false;
    byId("turnCutin").hidden = true;
    cancelAutoEnd();
  }
  function refreshAutoEnd() {
    if (
      Net.active ||
      !isAI() ||
      window.GamePreview?.active ||
      window.isLayoutPreview ||
      pageView !== "game" ||
      isBusy() ||
      game.winner !== null ||
      Rules.hasActions(game)
    ) {
      cancelAutoEnd();
      return;
    }
    if (automaticTurn?.game === game && automaticTurn.round === game.round) return;
    cancelAutoEnd();
    automaticTurn = { game, round: game.round };
    timer = setTimeout(() => {
      const valid = automaticTurn?.game === game && automaticTurn.round === game.round;
      cancelAutoEnd();
      if (
        valid &&
        pageView === "game" &&
        !Net.active &&
        isAI() &&
        !isBusy() &&
        !Rules.hasActions(game)
      )
        endTurn();
    }, 1000);
  }
  async function play(fromTeam, round, toTeam) {
    reset();
    if (
      window.ReplayPresentation?.immersive ||
      pageView !== "game" ||
      window.GamePreview?.active ||
      window.isLayoutPreview
    )
      return;
    const stamp = generation,
      overlay = byId("turnCutin"),
      card = byId("turnCutinCard");
    active = true;
    overlay.hidden = false;
    update();
    const messages = [
      { text: `队伍${fromTeam + 1}结束回合`, team: fromTeam },
      { text: `回合${round}`, team: toTeam },
      { text: `队伍${toTeam + 1}开始行动`, team: toTeam },
    ];
    try {
      for (const message of messages) {
        if (stamp !== generation) return;
        card.textContent = message.text;
        card.dataset.team = message.team;
        animation = card.animate(
          [
            { transform: "translateX(110vw)", offset: 0 },
            { transform: "translateX(0)", offset: 0.28 },
            { transform: "translateX(0)", offset: 0.72 },
            { transform: "translateX(-110vw)", offset: 1 },
          ],
          { duration: Rules.turnTransitionMs / 3, easing: "linear", fill: "both" },
        );
        await animation.finished;
        animation.cancel();
      }
    } catch {
      // 离开游戏、断线或新快照取消旧演出。
    } finally {
      if (stamp === generation) {
        animation = null;
        active = false;
        overlay.hidden = true;
        update();
      }
    }
  }
  return {
    reset,
    play,
    refreshAutoEnd,
    get active() {
      return active;
    },
  };
})();
