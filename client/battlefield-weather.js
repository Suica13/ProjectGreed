/* Presentation-only climate renderer. Blends old and new states over 1.8 seconds. */
const BattlefieldWeather = (() => {
  let lastKey = null,
    current = null,
    previous = null,
    changedAt = 0;
  const presets = typeof CLIMATE_EFFECT_PRESETS !== "undefined" ? CLIMATE_EFFECT_PRESETS : null;
  const textureCache = new Map();
  let surfaceCacheKey = null,
    surfaceCacheValue = null;
  const surfaceKinds = [
    ["snow", "231,241,247", 0.35],
    ["wet", "27,43,58", 0.24],
    ["dust", "191,147,87", 0.21],
  ];
  const coverRaster = { canvas: null, key: null, tiles: null };
  function reset() {
    lastKey = current = previous = surfaceCacheKey = surfaceCacheValue = null;
    changedAt = 0;
    if (coverRaster.canvas) coverRaster.canvas.width = coverRaster.canvas.height = 0;
    coverRaster.canvas = coverRaster.key = coverRaster.tiles = null;
    particleFields.clear();
  }
  function texture(path) {
    if (!path || typeof Image === "undefined") return null;
    if (!textureCache.has(path)) {
      const img = new Image();
      img.src = path;
      textureCache.set(path, img);
    }
    const img = textureCache.get(path);
    return img.complete && img.naturalWidth > 0 ? img : null;
  }
  function textureLayer(ctx, path, w, h, alpha) {
    const img = texture(path);
    if (!img) return false;
    ctx.save();
    ctx.globalAlpha *= alpha;
    const pattern = ctx.createPattern(img, "repeat");
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
    return !!pattern;
  }
  const names = {
    clear: "晴天",
    rain: "雨天",
    heavy_rain: "暴雨",
    fog: "雾天",
    overcast: "阴天",
    snow: "雪天",
    blizzard: "暴雪",
    sand: "沙尘",
    sandstorm: "沙尘暴",
    none: "无天气",
  };
  const times = {
    dawn: "清晨",
    morning: "上午",
    noon: "正午",
    afternoon: "下午",
    dusk: "黄昏",
    evening: "晚上",
    late_night: "深夜",
    pre_dawn: "凌晨",
    none: "无时间",
  };
  const climateRules =
    typeof BattlefieldClimate !== "undefined"
      ? BattlefieldClimate
      : require("../shared/battlefield-climate.js");
  function resolve(map, settings, round, seed) {
    return climateRules.resolve(map, settings, round, seed);
  }
  const particleFields = new Map();
  function particles(weather, count) {
    const key = weather + ":" + count;
    if (!particleFields.has(key)) {
      let seed = 2166136261;
      for (const char of weather) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
      const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
      const field = Array.from({length: count}, () => ({
        x: random(), y: random(), speedX: .65 + random() * .75,
        speedY: .65 + random() * .75, size: .65 + random() * .85,
        opacity: .45 + random() * .55, phase: random() * Math.PI * 2,
        frequency: .5 + random(), drift: 3 + random() * 12,
      }));
      particleFields.set(key, field);
      // Resizing may change the count; keep the presentation cache bounded.
      if (particleFields.size > 12) particleFields.delete(particleFields.keys().next().value);
    }
    return particleFields.get(key);
  }
  const defaultTimeTints = {
    dawn: { rgb: "220,178,145", opacity: .13 },
    morning: { rgb: "255,243,215", opacity: .025 },
    noon: { rgb: "255,237,195", opacity: .055 },
    afternoon: { rgb: "245,218,173", opacity: .07 },
    dusk: { rgb: "81,43,65", opacity: .25 },
    evening: { rgb: "9,19,48", opacity: .40 },
    late_night: { rgb: "3,10,32", opacity: .62 },
    pre_dawn: { rgb: "8,17,43", opacity: .49 },
  };
  function layer(ctx, w, h, now, state, alpha) {
    if (!state || alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    const t = state.time;
    const tint = (presets?.timeTints || defaultTimeTints)[t];
    if (tint) {
      ctx.fillStyle = "rgba(" + tint.rgb + "," + tint.opacity + ")";
      ctx.fillRect(0, 0, w, h);
    } else {
      const darkness = presets?.timeDarkness?.[t] || 0;
      if (darkness) {
        ctx.fillStyle = "rgba(6,16,45," + darkness + ")";
        ctx.fillRect(0, 0, w, h);
      }
    }
    const weather = state.weather;
    const overlays = presets?.overlays || {
      fog: { rgb: "190,205,211", opacity: 0.24 },
      overcast: { rgb: "75,86,99", opacity: 0.19 },
      sand: { rgb: "186,137,69", opacity: 0.18 },
      sandstorm: { rgb: "169,117,46", opacity: 0.36 },
      heavy_rain: { rgb: "49,71,99", opacity: 0.21 },
      blizzard: { rgb: "199,219,233", opacity: 0.18 },
    };
    if (overlays[weather]) {
      const overlay = overlays[weather];
      const rgb = overlay.rgb ?? overlay[0],
        opacity = overlay.opacity ?? overlay[1];
      ctx.fillStyle = "rgba(" + rgb + "," + opacity + ")";
      ctx.fillRect(0, 0, w, h);
    }
    const customTexture = presets?.assets?.[weather];
    if (customTexture && textureLayer(ctx, customTexture, w, h, 1)) {
      ctx.restore();
      return;
    }
    if (["rain", "heavy_rain", "snow", "blizzard", "sand", "sandstorm"].includes(weather)) {
      const rain = weather === "rain" || weather === "heavy_rain";
      const snow = weather === "snow" || weather === "blizzard";
      const heavy = ["heavy_rain", "blizzard", "sandstorm"].includes(weather);
      const visual = presets?.precipitation?.[weather] || {};
      const count = Math.min(
        visual.count ?? (heavy ? 300 : 145),
        Math.ceil((w * h) / (heavy ? 2000 : 4200)),
      );
      ctx.lineWidth = 1;
      ctx.strokeStyle = visual.stroke
        ? visual.stroke
        : rain
          ? "rgba(158,200,235,.48)"
          : snow
            ? "rgba(238,247,255,.78)"
            : "rgba(210,177,117,.5)";
      ctx.globalAlpha *= visual.opacity ?? 1;
      ctx.fillStyle = ctx.strokeStyle;
      const opacity = ctx.globalAlpha;
      const speedX = visual.speedX ?? (rain ? .22 : snow ? .026 : .085);
      const speedY = visual.speedY ?? (rain ? .56 : snow ? .043 : .12);
      const wrap = (value, length) => ((value % length) + length) % length;
      for (const particle of particles(weather, count)) {
        const vx = speedX * particle.speedX, vy = speedY * particle.speedY;
        const sway = rain ? 0 : Math.sin(now * .001 * particle.frequency + particle.phase) * particle.drift;
        const x = wrap(particle.x * (w + 80) + now * vx + sway, w + 80) - 40;
        const y = wrap(particle.y * (h + 80) + now * vy, h + 80) - 40;
        ctx.globalAlpha = opacity * particle.opacity;
        if (rain) {
          const length = (visual.length ?? (heavy ? 15 : 9)) * particle.size;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + length * vx / Math.max(.001, vy), y + length);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(x, y, (visual.radius ?? (snow ? 1.6 : 1.1)) * particle.size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }
  function surfaceState(map, settings, round, seed) {
    const rules = presets?.surfaces || {};
    let snow = 0,
      wet = 0,
      dust = 0;
    // Derive surface accumulation from the same seeded history on every client.
    // No extra state is written to save files; replays remain deterministic.
    const start = Math.max(1, round - 160);
    for (let turn = start; turn <= round; turn++) {
      const state = resolve(map, settings, turn, seed),
        weather = state.weather;
      snow = Math.max(
        0,
        Math.min(
          100,
          snow +
            (weather === "snow"
              ? (rules.snow?.snow ?? 5)
              : weather === "blizzard"
                ? (rules.snow?.blizzard ?? 12)
                : weather === "rain" || weather === "heavy_rain"
                  ? -(rules.snow?.meltRain ?? 8)
                  : weather === "clear"
                    ? -(rules.snow?.meltClear ?? 3)
                    : 0),
        ),
      );
      wet = Math.max(
        0,
        Math.min(
          100,
          wet +
            (weather === "rain"
              ? (rules.wet?.rain ?? 10)
              : weather === "heavy_rain"
                ? (rules.wet?.heavy_rain ?? 22)
                : -(rules.wet?.dry ?? 4)),
        ),
      );
      dust = Math.max(
        0,
        Math.min(
          100,
          dust +
            (weather === "sand"
              ? (rules.dust?.sand ?? 6)
              : weather === "sandstorm"
                ? (rules.dust?.sandstorm ?? 14)
                : weather === "clear"
                  ? -(rules.dust?.clear ?? 3)
                  : 0),
        ),
      );
    }
    return { snow, wet, dust };
  }
  function ground(ctx, w, h, map, settings, round, seed, geometry) {
    const state = resolve(map, settings, round, seed);
    // Explicit map opt-in plus room veto; no accidental cover on legacy maps.
    if (state.space || map.surfaceCover !== true || settings.surfaceCover === false) return;
    const cacheKey = [
      map?.id || map?.name || "",
      round,
      seed,
      JSON.stringify(settings),
      JSON.stringify(map.climate),
    ].join(":");
    if (cacheKey !== surfaceCacheKey) {
      surfaceCacheKey = cacheKey;
      surfaceCacheValue = surfaceState(map, settings, round, seed);
    }
    const surface = surfaceCacheValue;
    if (!surface.snow && !surface.wet && !surface.dust) return;
    if (!geometry || !Array.isArray(map.tiles)) return;
    const { tile, ox, oy } = geometry;
    if (!(tile > 0)) return;
    const firstX = Math.max(0, Math.floor(-ox / tile)),
      lastX = Math.min(map.width, Math.ceil((w - ox) / tile));
    const firstY = Math.max(0, Math.floor(-oy / tile)),
      lastY = Math.min(map.height, Math.ceil((h - oy) / tile));
    const terrains = typeof MapDocument !== "undefined" ? MapDocument.terrains : {};
    const activeKinds = surfaceKinds.filter(([kind]) => surface[kind] > 0);
    const paint = (target, startX, startY, endX, endY, size, offsetX, offsetY, overlap) => {
      for (let y = startY; y < endY; y++)
        for (let x = startX; x < endX; x++) {
          const cover = terrains[map.tiles[y]?.[x]]?.cover;
          for (const [kind, rgb, opacity] of activeKinds) {
            const strength = (surface[kind] / 100) * (cover?.[kind] ?? 1);
            if (strength <= 0) continue;
            target.fillStyle = "rgba(" + rgb + "," + opacity * strength + ")";
            target.fillRect(offsetX + x * size, offsetY + y * size, size + overlap, size + overlap);
          }
        }
    };
    if (typeof document !== "undefined") {
      if (coverRaster.key !== cacheKey || coverRaster.tiles !== map.tiles) {
        const canvas =
          coverRaster.canvas || (coverRaster.canvas = document.createElement("canvas"));
        if (canvas.width !== map.width) canvas.width = map.width;
        if (canvas.height !== map.height) canvas.height = map.height;
        const surfaceContext = canvas.getContext("2d");
        surfaceContext.clearRect(0, 0, canvas.width, canvas.height);
        paint(surfaceContext, 0, 0, map.width, map.height, 1, 0, 0, 0);
        coverRaster.key = cacheKey;
        coverRaster.tiles = map.tiles;
      }
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(coverRaster.canvas, ox, oy, map.width * tile, map.height * tile);
      ctx.restore();
    } else {
      ctx.save();
      paint(ctx, firstX, firstY, lastX, lastY, tile, ox, oy, 0.3);
      ctx.restore();
    }
  }
  function lightning(ctx, w, h, now, state, round, seed) {
    const spec = presets?.lightning;
    if (!spec?.enabled || !spec.weather?.includes(state.weather) || state.space) return;
    const interval = Math.max(1, spec.frequencyRounds || 3);
    if (round % interval !== 0) return;
    const duration = spec.flashDurationMs || 500;
    const cycle = 12000;
    const phase = (((now + ((seed >>> 0) % 3000)) % cycle) + cycle) % cycle;
    if (phase >= duration) return;
    const fraction = phase / duration;
    const intensity =
      fraction < 0.18
        ? fraction / 0.18
        : fraction < 0.32
          ? 0.25
          : fraction < 0.45
            ? 0.8 * (1 - (fraction - 0.32) / 0.13)
            : Math.max(0, (0.3 * (1 - fraction)) / 0.55);
    ctx.save();
    ctx.fillStyle =
      "rgba(235,243,255," + Math.max(0, Math.min(1, intensity * (spec.maxOpacity ?? 0.62))) + ")";
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  function draw(ctx, w, h, now, map, settings, round, seed = 1, geometry = null) {
    const state = resolve(map, settings, round, seed);
    const key = state.weather + ":" + state.time;
    if (lastKey === null) {
      lastKey = key;
      current = state;
    } else if (key !== lastKey) {
      previous = current;
      current = state;
      lastKey = key;
      changedAt = now;
    }
    const progress = Math.min(1, Math.max(0, (now - changedAt) / (presets?.transitionMs || 1800)));
    ground(ctx, w, h, map, settings, round, seed, geometry);
    if (previous && progress < 1) layer(ctx, w, h, now, previous, 1 - progress);
    else previous = null;
    layer(ctx, w, h, now, current, previous ? progress : 1);
    lightning(ctx, w, h, now, state, round, seed);
    return state;
  }
  return { draw, reset, resolve, names, times, surfaceState };
})();
if (typeof module !== "undefined") module.exports = BattlefieldWeather;
