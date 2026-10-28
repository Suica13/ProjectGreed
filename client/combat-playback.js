/* 收到整批裁定后并行播放；本机完成只确认本机，全员完成后由服务端交接回合。 */
const CombatPlayback = (() => {
  let matchId = null;
  const seen = new Set(),
    finished = new Set(),
    queue = [];
  function reset() {
    matchId = null;
    seen.clear();
    finished.clear();
    queue.length = 0;
    MapCombat.reset();
  }
  function receive(snapshot, live) {
    if (matchId !== snapshot.matchId) {
      reset();
      matchId = snapshot.matchId;
    }
    const batch = snapshot.playback;
    if (!batch || snapshot.phase !== "playback" || seen.has(batch.id) || finished.has(batch.id))
      return;
    if (batch.ready.includes(snapshot.you?.id)) {
      seen.add(batch.id);
      return;
    }
    seen.add(batch.id);
    const battles = [...(snapshot.combats || []), ...(snapshot.effectCombats || [])];
    if (battles.length) {
      queue.push({ id: batch.id, battles });
      MapCombat.seed(battles);
    } else finished.add(batch.id);
  }
  function active() {
    return !!battleView?.networkId;
  }
  function show() {
    if (pageView !== "game") return false;
    if (active()) {
      phase = "battle";
      MapCombat.resume(battleView);
      byId("reaction").hidden = true;
      return true;
    }
    const batch = Net.snapshot?.playback;
    if (
      batch &&
      finished.has(batch.id) &&
      !batch.ready.includes(Net.memberId) &&
      batch.members.includes(Net.memberId) &&
      !Net.awaiting
    )
      Net.request("playback_ready", { batchId: batch.id });
    if (!queue.length) return false;
    const next = queue.shift(),
      first = next.battles[0];
    const actors = [];
    for (const battle of next.battles)
      for (const actor of battle.actors)
        if (!actors.some((unit) => unit.id === actor.id)) actors.push(actor);
    battleView = {
      a: first.a,
      b: first.b,
      actors,
      battles: next.battles,
      events: next.battles.flatMap((b) => b.events),
      index: 0,
      start: performance.now(),
      displayHp: Object.fromEntries(actors.map((unit) => [unit.id, unit.hp])),
      completed: false,
      networkId: next.id,
    };
    phase = "battle";
    byId("reaction").hidden = true;
    MapCombat.begin(battleView);
    return true;
  }
  function finish() {
    if (globalThis.ReplayPlayer?.active) {
      globalThis.ReplayPlayer.combatFinished();
      return;
    }
    if (!battleView) return;
    finished.add(battleView.networkId);
    battleView = null;
    MapCombat.reset();
    byId("battle").hidden = true;
    Net.applySnapshot(Net.snapshot);
  }
  return {
    reset,
    waitingFor(snapshot) {
      const batch = snapshot.playback;
      return active() || queue.length > 0 || !!(snapshot.phase === "playback" && batch &&
        !finished.has(batch.id) && !batch.ready.includes(snapshot.you?.id) &&
        ((snapshot.combats?.length || 0) + (snapshot.effectCombats?.length || 0)));
    },
    receive,
    active,
    show,
    finish,
    turn: (event) => TurnFlow.play(event.fromTeam, event.round, event.toTeam),
    get queued() {
      return queue.length;
    },
  };
})();
