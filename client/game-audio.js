/* 房间/回合提示与战斗演出音轨分开。只消费裁定后的新状态，重连不补播旧提示。 */
const GameAudio = (() => {
  let previous = null,
    generation = 0;
  const seen = new Set();
  function reset() {
    previous = null;
    seen.clear();
    generation++;
  }
  function play(key) {
    playSound(ART.presentation[key]);
  }
  function playSound(sound) {
    const stamp = generation;
    WeaponAudio.unlock().then(() => {
      if (stamp === generation) WeaponAudio.play(sound);
    });
  }
  function emit(key, sound) {
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > 256) seen.delete(seen.values().next().value);
    playSound(sound);
  }
  function receive(snapshot, seat, live) {
    const last = previous;
    previous = {
      started: snapshot.started,
      matchId: snapshot.matchId,
      phase: snapshot.phase,
      round: snapshot.game.round,
      team: snapshot.game.team,
    };
    if (!live || !last || !snapshot.started) return;
    const match = snapshot.matchId;
    if (last.phase === "assembly" && snapshot.phase === "deployment")
      emit(match + ":start", ART.presentation.gameStartSound);
    if (!snapshot.connected.every(Boolean)) return;
    const ownTeam = seat === null ? null : Rules.seatTeam(seat);
    const turnStarted =
      (last.phase === "deployment" && snapshot.phase === "idle") ||
      (last.matchId === match &&
        (last.round !== snapshot.game.round || last.team !== snapshot.game.team));
    if (turnStarted && ownTeam === snapshot.game.team)
      emit(match + ":turn:" + snapshot.game.round, ART.presentation.turnSound);
    const event = snapshot.lastEvent;
    const owner = (id) => {
      const unit = snapshot.game.units.find((unit) => unit.id === id);
      return unit ? Rules.ownerOf(unit) : null;
    };
    // 目标计划被接受时立即提示，不等到全队结束行动；同一快照只播一次。
    if (event?.type === "plan_attack" && seat !== null && owner(event.attacker) === seat)
      emit(match + ":lock:" + event.id, ART.presentation.lockonSound);
    if (snapshot.phase === "reaction" && event?.type === "attack") {
      const request = snapshot.pending || event;
      if (seat !== null && owner(request.target) === seat)
        emit(match + ":warning:" + request.id, ART.presentation.underAttackSound);
    }
  }
  return { receive, reset, play };
})();
