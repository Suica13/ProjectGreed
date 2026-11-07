/* Canvas pseudo-lighting parameters compatible with Project Duel's map model. */
const MapShadowLighting = (() => {
  const defaults = { direction: "upper", horizontalAngle: -45, distance: 0.1, intensity: 0.5, heightScale: 1, enabled: true };
  const clamp = (v, lo, hi, fallback) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Number(v) : fallback));
  function normalize(input = {}) {
    return {
      direction: ["upper", "center", "lower"].includes(input.direction) ? input.direction : defaults.direction,
      horizontalAngle: clamp(input.horizontalAngle, -75, 75, defaults.horizontalAngle),
      distance: clamp(input.distance, 0, Infinity, defaults.distance),
      intensity: clamp(input.intensity, 0, 1, defaults.intensity),
      heightScale: clamp(input.heightScale, 0, Infinity, 1),
      enabled: input.enabled !== false,
    };
  }
  function projection(settings, height = 1) {
    const s = normalize(settings);
    if (s.direction === "center") return { x: 0, y: 0, alpha: s.enabled ? s.intensity : 0 };
    const angle = s.horizontalAngle * Math.PI / 180;
    const length = s.distance * s.heightScale * Math.max(0, Number.isFinite(height) ? height : 0);
    return { x: Math.sin(angle) * length,
      y: (s.direction === "lower" ? 1 : -1) * Math.cos(angle) * length,
      alpha: s.enabled ? s.intensity : 0 };
  }
  return { defaults, normalize, projection };
})();
if (typeof module !== "undefined") module.exports = MapShadowLighting;
