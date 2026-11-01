/* Shared presentation timing; it never changes movement range or path legality. */
const MovementTiming = (() => {
  const speeds = Object.freeze([1.5, 2, 2.5, 3, 0.5, 1]);
  let presentationSpeed = 1.5;
  function setPresentationSpeed(value) {
    if (!speeds.includes(value)) throw Error("Invalid presentation speed");
    presentationSpeed = value;
    return value;
  }
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
  return { duration, step, speeds, setPresentationSpeed, get presentationSpeed() { return presentationSpeed; }, combatRate };
})();
if (typeof module !== "undefined") module.exports = MovementTiming;
