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
  // A cosmetic adjustment: deterministic climate state controls shadow contrast,
  // length and direction. Gameplay visibility continues to use sensor rules.
  const timeFactors = {
    dawn: [0.7,1.4,-25], morning:[0.9,1.1,-35], noon:[1,0.55,-45],
    afternoon:[.95,1,-55], dusk:[.72,1.5,-65], evening:[.3,.9,-45],
    late_night:[.18,.6,-45], pre_dawn:[.35,1,-30], none:[0,0,-45],
  };
  const weatherFactors = {
    clear:1, rain:.7, heavy_rain:.35, fog:.25, overcast:.5,
    snow:.8, blizzard:.28, sand:.65, sandstorm:.25, none:0,
  };
  function fromClimate(base = {}, climate = {}) {
    const settings = normalize(base);
    if(climate.space || climate.time === "none") return {...settings,enabled:false,intensity:0};
    const [brightness,length,angle] = timeFactors[climate.time] || timeFactors.noon;
    return {...settings,
      horizontalAngle: settings.horizontalAngle + (angle + 45)*.35,
      distance: settings.distance * length,
      intensity: settings.intensity * brightness * (weatherFactors[climate.weather] ?? 1)};
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
  return { defaults, normalize, projection, fromClimate };
})();
if (typeof module !== "undefined") module.exports = MapShadowLighting;
