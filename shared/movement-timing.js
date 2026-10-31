/* Shared presentation timing; it never changes movement range or path legality. */
const MovementTiming = (() => {
  function duration(path, quick = false) {
    const count = Array.isArray(path) ? path.length : path;
    if (!Number.isFinite(count) || count <= 0) return 0;
    const normal = Math.min(1200, count <= 4 ? count * 120 : 480 + Math.sqrt(count - 4) * 90);
    return normal * (quick ? 50 / 120 : 1);
  }
  function step(path, quick = false) {
    const count = Array.isArray(path) ? path.length : path;
    return count > 0 ? duration(count, quick) / count : 120;
  }
  return { duration, step };
})();
if (typeof module !== "undefined") module.exports = MovementTiming;
