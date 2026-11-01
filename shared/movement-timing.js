/* Shared presentation timing; it never changes movement range or path legality. */
const MovementTiming = (() => {
  const presentationSpeed = 1.5;
  const combatRate = (quick = false, replay = false) =>
    presentationSpeed * (!replay && quick ? 1 / 0.35 : 1);
  function duration(path, quick = false) {
    const count = Array.isArray(path) ? path.length : path;
    if (!Number.isFinite(count) || count <= 0) return 0;
    const normal = Math.min(1200, count <= 4 ? count * 120 : 480 + Math.sqrt(count - 4) * 90);
    return normal * (quick ? 50 / 120 : 1) / presentationSpeed;
  }
  function step(path, quick = false) {
    const count = Array.isArray(path) ? path.length : path;
    return count > 0 ? duration(count, quick) / count : 120 / presentationSpeed;
  }
  return { duration, step, presentationSpeed, combatRate };
})();
if (typeof module !== "undefined") module.exports = MovementTiming;
