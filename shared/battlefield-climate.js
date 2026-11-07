/* Shared deterministic battlefield climate; never uses Math.random or wall-clock time. */
"use strict";
const BattlefieldClimate = (() => {
  const weatherIds = ["clear","rain","heavy_rain","fog","overcast","snow","blizzard","sand","sandstorm"];
  const timeIds = ["dawn","morning","noon","afternoon","dusk","evening","late_night","pre_dawn"];
  const poorSight = new Set(["rain","heavy_rain","fog","overcast","snow","blizzard","sand","sandstorm"]);
  const poorRadar = new Set(["heavy_rain","blizzard","sandstorm"]);
  const night = new Set(["evening","late_night","pre_dawn"]);
  const cleanNumber = (n, fallback) => Number.isInteger(n) && n > 0 ? Math.min(999, n) : fallback;
  function config(map = {}) {
    const raw = map.climate || map.weather || {};
    const weather = raw.weather && typeof raw.weather === "object" ? raw.weather : raw;
    const time = raw.time && typeof raw.time === "object" ? raw.time : raw;
    const weights = Object.fromEntries(weatherIds.map(id => [id,
      Number.isFinite(weather.weights?.[id]) ? Math.max(0, Math.min(1000, weather.weights[id])) : (id === "clear" ? 1 : 0)]));
    const weatherPool = Array.isArray(weather.allowed) ? weather.allowed.filter(id => weatherIds.includes(id)) : weatherIds.filter(id => weights[id] > 0);
    const timePool = Array.isArray(time.allowed) ? time.allowed.filter(id => timeIds.includes(id)) : timeIds;
    return { weather: { allowed: weatherPool.length ? weatherPool : ["clear"], weights,
        duration: cleanNumber(weather.durationRounds || weather.duration, 4),
        fixed: weather.fixed === true },
      time: { allowed: timePool.length ? timePool : ["noon"], duration: cleanNumber(time.durationRounds || time.cycleRounds, 4),
        fixed: time.fixed === true } };
  }
  function hash(seed, index) {
    let h = (Number(seed) || 1) ^ Math.imul(index + 1, 0x9e3779b1);
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15;
    h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
    return h >>> 0;
  }
  function pick(pool, weights, seed) {
    const total = pool.reduce((sum,id) => sum + (weights?.[id] ?? 1),0);
    if (total <= 0) return pool[0];
    let roll = hash(seed, pool.length) % total;
    for(const id of pool) { roll -= weights?.[id] ?? 1; if(roll < 0) return id; }
    return pool.at(-1);
  }
  function resolve(map = {}, settings = {}, round = 1, seed = 1) {
    const space = map.environment === "space";
    if(space) return {weather:"none",time:"none",sight:1,radar:1,space:true};
    const cfg=config(map);
    const r=Math.max(0,round-1);
    const weatherCycle = settings.weatherCycle !== false && !cfg.weather.fixed;
    const timeCycle = settings.timeCycle !== false && !cfg.time.fixed;
    const wi=weatherCycle ? Math.floor(r/cfg.weather.duration) : 0;
    const ti=timeCycle ? Math.floor(r/cfg.time.duration) : 0;
    const weather=settings.weather && !["map","cycle"].includes(settings.weather) && weatherIds.includes(settings.weather)
      ? settings.weather : pick(cfg.weather.allowed,cfg.weather.weights,hash(seed,wi));
    const time=settings.dayNight && !["map","cycle"].includes(settings.dayNight) && timeIds.includes(settings.dayNight)
      ? settings.dayNight : cfg.time.allowed[ti % cfg.time.allowed.length];
    const buff=settings.climateBuffs !== false;
    const sight=buff ? (poorSight.has(weather)?0.75:1)*(night.has(time)?0.75:1) : 1;
    const radar=buff ? (poorRadar.has(weather)?0.75:1)*(night.has(time)?0.75:1) : 1;
    return {weather,time,sight,radar,space:false,weatherCycle,timeCycle};
  }
  return {weatherIds,timeIds,config,resolve};
})();
if(typeof module!=="undefined") module.exports=BattlefieldClimate;
