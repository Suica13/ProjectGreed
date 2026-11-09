/* Local battlefield radio range and carrier-linked pilot interactions. */
const DialogueRange = (() => {
  const radius = 10;
  function position(unit, lookup = () => null, visited = new Set()) {
    if (!unit || visited.has(unit.id)) return null;
    visited.add(unit.id);
    if (unit.embarked?.carrierId) {
      const carrier = lookup(unit.embarked.carrierId);
      if (carrier) return position(carrier, lookup, visited);
    }
    return Number.isFinite(unit.x) && Number.isFinite(unit.y)
      ? { x: unit.x, y: unit.y } : null;
  }
  function nearby(a, b, lookup = () => null) {
    if (!a || !b) return false;
    if (a.id === b.id) return true;
    const pa = position(a, lookup), pb = position(b, lookup);
    return !!pa && !!pb && Math.hypot(pa.x - pb.x, pa.y - pb.y) <= radius;
  }
  function eligible(speaker, target, lookup = () => null) {
    return nearby(speaker, target, lookup);
  }
  const speakingCells = new WeakMap();
  function claimCell(game, pos) {
    if (!pos) return true;
    const turn = game.round + ":" + game.team;
    let state = speakingCells.get(game);
    if (state?.turn !== turn) {
      state = { turn, cells: new Set() };
      speakingCells.set(game, state);
    }
    const cell = pos.x + "," + pos.y;
    if (state.cells.has(cell)) return false;
    state.cells.add(cell);
    return true;
  }
  return { radius, position, nearby, eligible, claimCell };
})();
if (typeof module !== "undefined") module.exports = DialogueRange;
