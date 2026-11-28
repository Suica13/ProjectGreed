"use strict";
const ContractForces = (() => {
  const data =
    typeof CONTRACT_FORCE_POOLS !== "undefined"
      ? CONTRACT_FORCE_POOLS
      : require("./contract-force-pools.json");
  const caches = new WeakMap();
  const unified0079 = era => ["UC_0079_T1", "UC_0079_T2"].includes(era);
  const family = era => /^UC_00(?:79|87)_T[12]$/.test(era) ? [era.replace(/T[12]$/, 'T1'),era.replace(/T[12]$/, 'T2')] : [era];
  const tenLevels = era => unified0079(era) || /^UC_0087_T[12]$/.test(era) || era === 'CE_0071_T1';
  const t2Share = difficulty => Math.max(0, Math.min(1, (Number(difficulty) - 5) / 5));
  const enemyEras = settings => Number(settings.sweepDifficulty) >= 6 ? family(settings.sweepEra) : family(settings.sweepEra).slice(0,1);
  const modelAllowed = (settings, model) => enemyEras(settings).some(era => model.tags?.includes(era));
  // Rare T2 heavy units keep their roster slots but receive less draw weight.
  const hullWeight = model => model.tags?.some(tag=>/_T2$/.test(tag)) &&
    (model.unitTags?.includes("MA") || /^MSN_02(?:_|$)/.test(model.prefabId))
      ? 0.025 : model.prefabId === "YMS_16M" ? 0.1 : model.unitTags?.includes("MA") ? 0.1 : 1;
  const marineHull = id => ["MS_14F", "MS_15F"].includes(id);
  const hullFormation = ([id,kits]) => ({label:id,units:[id,id,id],kits:[kits,kits,kits],budget:75,weight:hullWeight(kits[0])});
  function lateComposition(selected, available, difficulty) {
    if (Number(difficulty)<8) return selected;
    const marines = available.filter(([id])=>marineHull(id));
    if (!marines.length) return selected;
    const support = selected.filter(f=>!marineHull(f.units[0]));
    const total = support.reduce((sum,f)=>sum+f.weight,0);
    // Preserve marine MS even when a COST percentile would cut them from the pool.
    return [...support,...marines.map(row=>({...hullFormation(row),weight:total ? total*0.7/0.3/marines.length : 1}))];
  }
  function aiKitAllowed(model) {
    return !/nuclear|nuke|核弹|核爆/i.test(model.kitId || "") &&
      !(model.weapons || []).some(w => /nuclear|nuke|核弹|核爆/i.test([w.id,w.name,w.category,w.special?.type].join(" "))) &&
      !(model.skills || []).some(s => /nuclear|nuke|核弹|核爆/i.test([s.id,s.type,s.name].join(" ")));
  }
  function profile(settings) {
    const unified = unified0079(settings.sweepEra);
    const space = settings.sweepEnvironment === "space";
    const source = unified || settings.sweepEra === data.era ? data : data.eras?.[settings.sweepEra] || (space ? data : null);
    if (!source || (!space && settings.sweepEnvironment !== source.environment))
      return null;
    const level = unified ? Math.min(5, settings.sweepDifficulty) : settings.sweepEra === 'CE_0071_T1' ? Math.min(6, Number(settings.sweepDifficulty)+1) : settings.sweepDifficulty;
    return (source.factions[settings.sweepFaction] || (space ? data.factions.EFSF : null))?.[Math.min(space ? 5 : Infinity, level)] || null;
  }
  // Space forces are resolved from the current catalog so new kits retain the
  // same bans, technology gates and era tags as their ground counterparts.
  function spaceFormations(settings, G) {
    let cache = caches.get(G.catalog);
    if (!cache) caches.set(G.catalog, (cache = new Map()));
    const key = ["space",settings.sweepEra,settings.sweepFaction,settings.sweepDifficulty].join(":");
    if (cache.has(key)) return cache.get(key);
    const eras = family(settings.sweepEra), n = Number(settings.sweepDifficulty);
    const hulls = new Map();
    for (const m of Object.values(G.models)) {
      if (m.formOnly || m.wip || m.facility || m.ship || m.requiredPilotId ||
          !m.weapons?.length || (G.isFleetCarrier(m) && !m.unitTags?.includes("MA")) ||
          !aiKitAllowed(m) || !G.aiTechnologyAllows(m,settings.sweepFaction) ||
          (G.aiUnitBans?.sweep || []).includes(m.prefabId) ||
          !(m.availableFactions || [m.faction]).includes(settings.sweepFaction) ||
          !modelAllowed(settings,m) || (m.adaptability?.space || 0)<100) continue;
      if (!hulls.has(m.prefabId)) hulls.set(m.prefabId,[]);
      hulls.get(m.prefabId).push(m);
    }
    const tier = (era, late) => {
      const values = [...hulls].filter(([,kits])=>kits[0].tags.includes(era) &&
        (!late || !kits[0].tags.includes(eras[0])))
        .sort((a,b)=>Math.min(...a[1].map(m=>m.cost))-Math.min(...b[1].map(m=>m.cost)) || a[0].localeCompare(b[0]));
      const step = eras.length===1 ? (n-1)/9 : (Math.min(5,late ? n-5 : n)-1)/4;
      const selected = values.slice(Math.floor(values.length*step*.4), Math.max(1,Math.ceil(values.length*(.4+step*.6))))
        .map(([id,kits])=>({label:id,units:[id,id,id],kits:[kits,kits,kits],budget:75,
          weight:hullWeight(kits[0])}));
      return late ? lateComposition(selected,values,n) : selected;
    };
    const early=tier(eras[0],false), late=eras.length>1 && n>=6 ? tier(eras[1],true) : [];
    const share=late.length ? (early.length ? t2Share(n) : 1) : 0;
    const normalize=(values,weight)=>{const sum=values.reduce((n,f)=>n+f.weight,0);return values.map(f=>({...f,weight:f.weight/sum*weight}));};
    const result=[...normalize(early,1-share),...normalize(late,share)].filter(f=>f.weight>0);
    if (!result.length) throw Error("所选年代和阵营没有可用宇宙兵力");
    cache.set(key,result);
    return result;
  }
  function formations(settings, G) {
    if (settings.sweepEnvironment === "space") return spaceFormations(settings,G);
    const level = profile(settings);
    if (!level) return null;
    let cache = caches.get(G.catalog);
    if (!cache) caches.set(G.catalog, (cache = new Map()));
    const key = settings.sweepEra + ":" + settings.sweepFaction + ":" + settings.sweepDifficulty;
    if (!cache.has(key)) {
      const models = Object.values(G.models);
      cache.set(
        key,
        level.formations
          .map((formation) => ({
            ...formation,
            kits: formation.units.map((id) => {
              const kits = models.filter(
                (m) =>
                  m.prefabId === id &&
                  !m.formOnly &&
                  !m.wip &&
                  !m.requiredPilotId &&
                  !m.facility &&
                  !m.ship &&
                  aiKitAllowed(m) &&
                  G.aiTechnologyAllows(m, settings.sweepFaction) &&
                  !(G.aiUnitBans?.sweep || []).includes(id) &&
                  modelAllowed(settings, m) &&
                  (m.availableFactions || [m.faction]).includes(settings.sweepFaction) &&
                  ((m.adaptability.ground || 0) >= 100 || (m.adaptability.air || 0) >= 100),
              );
              if (!models.some((m) => m.prefabId === id))
                throw Error("合约部队池单位不存在：" + id);
              return kits;
            }),
          }))
          .filter((formation) => formation.kits.every((kits) => kits.length)),
      );
    }
    const base = cache.get(key);
    if (!tenLevels(settings.sweepEra) || Number(settings.sweepDifficulty) < 5) return base;
    const mixedKey = key + ":mixed";
    if (!cache.has(mixedKey)) {
      const share = t2Share(settings.sweepDifficulty);
      const early = base.map(f => ({...f,budget:f.units.length * 25}));
      const byHull = new Map();
      const ce = settings.sweepEra === 'CE_0071_T1', baseIds = new Set(base.flatMap(f=>f.units));
      for (const m of Object.values(G.models)) {
        if ((ce ? !baseIds.has(m.prefabId) : !m.tags?.includes("UC_0079_T2") || m.tags.includes("UC_0079_T1")) || m.formOnly || m.wip || m.facility || m.ship ||
          m.requiredPilotId || !aiKitAllowed(m) || !G.aiTechnologyAllows(m,settings.sweepFaction) ||
          (G.aiUnitBans?.sweep || []).includes(m.prefabId) ||
          !(m.availableFactions || [m.faction]).includes(settings.sweepFaction) ||
          Math.max(m.adaptability?.ground || 0,m.adaptability?.air || 0)<100) continue;
        if (!byHull.has(m.prefabId)) byHull.set(m.prefabId,[]);
        byHull.get(m.prefabId).push(m);
      }
      const hulls = [...byHull].sort((a,b)=>Math.min(...a[1].map(m=>m.cost))-Math.min(...b[1].map(m=>m.cost)));
      const step = Math.max(0,Number(settings.sweepDifficulty)-6);
      const selected = hulls.slice(Math.floor(hulls.length*(ce ? .5+step*.1 : step*.1)), ce ? hulls.length : Math.max(1,Math.ceil(hulls.length*(.6+step*.1))))
        .map(([id,kits])=>({label:id,units:[id,id,id],kits:[kits,kits,kits],budget:75,
          weight:hullWeight(kits[0])}));
      const late = lateComposition(selected,hulls,settings.sweepDifficulty);
      const normalize = (values,weight) => { const sum=values.reduce((n,f)=>n+f.weight,0);return values.map(f=>({...f,weight:f.weight/sum*weight})); };
      cache.set(mixedKey,[...normalize(early,late.length ? 1-share : 1),...normalize(late,share)].filter(f=>f.weight>0));
    }
    return cache.get(mixedKey);
  }
  function weighted(values, rng) {
    let roll = rng() * values.reduce((sum, item) => sum + item.weight, 0);
    return values.find((item) => (roll -= item.weight) < 0) || values[values.length - 1];
  }
  // A draw is always a whole configured formation. Unspent budget is discarded;
  // neither a cap nor an incompatible transport may turn it into isolated units.
  function draw(
    settings,
    G,
    rng,
    budget,
    slots = Infinity,
    allows = () => true,
    capacity = Infinity,
  ) {
    const source = formations(settings, G);
    if (!source) return null;
    const result = [];
    let remaining = budget,
      space = slots,
      cargoSpace = capacity;
    while (remaining > 0 && space > 0) {
      const eligible = source
        .map((f) => ({ ...f, kits: f.kits.map((kits) => kits.filter(allows)) }))
        .filter(
          (f) =>
            f.budget <= remaining &&
            f.units.length <= space &&
            f.kits.every((kits) => kits.length) &&
            f.kits.reduce(
              (sum, kits) => sum + Math.max(...kits.map((m) => m.transport?.slotCost || 1)),
              0,
            ) <= cargoSpace,
        );
      if (!eligible.length) break;
      const formation = weighted(eligible, rng);
      const models = formation.kits.map((kits) => kits[Math.floor(rng() * kits.length)]);
      result.push({ budget: formation.budget, models });
      remaining -= formation.budget;
      space -= models.length;
      cargoSpace -= models.reduce((sum, m) => sum + (m.transport?.slotCost || 1), 0);
    }
    return result;
  }
  function pick(settings, G, rng, allows = () => true) {
    const source = formations(settings, G);
    if (!source) return null;
    const available = source.filter((f) => f.kits.some((kits) => kits.some(allows)));
    if (!available.length) throw Error("合约部队池没有符合条件的单位");
    const formation = weighted(available, rng),
      kits = formation.kits.filter((kits) => kits.some(allows));
    const variants = kits[Math.floor(rng() * kits.length)].filter(allows);
    return variants[Math.floor(rng() * variants.length)];
  }
  const countQuotas = new WeakMap();
  const countScale = difficulty => Number(difficulty) >= 4 ? .75 : 1;
  function selectCount(room, formations, reinforcement = false) {
    const scale = reinforcement ? countScale(room.settings.sweepDifficulty) : 1;
    if (scale === 1) return formations;
    let quotas = countQuotas.get(room.game);
    if (!quotas) countQuotas.set(room.game, quotas = {});
    const key = reinforcement ? "reinforcement" : "initial";
    const quota = quotas[key] ||= { proposed: 0, retained: 0 };
    return formations.filter(formation => {
      const count = formation.models.length;
      quota.proposed += count;
      const target = quota.proposed * scale;
      // Keep whole configured formations, carrying rounding error into later waves.
      if (Math.abs(quota.retained + count - target) <= Math.abs(quota.retained - target)) {
        quota.retained += count;
        return true;
      }
      return false;
    });
  }
  const difficultyScale = difficulty => [1, 1, 1.1, 1.15, 1.15][Math.min(5,Number(difficulty)) - 1] || 1;
  // Relative pressure within an era, separate from the cost of newer player units.
  const eraPressure = (era, difficulty = 1) => tenLevels(era) && Number(difficulty) === 10 ? 1.1 : 1;
  function budget(room, amount, reinforcement = false) {
    const players = room.game.contract.players;
    // Explicit per-event budgets supersede the old generic head-count tuning.
    // Only the shared multiplayer multiplier remains; never scale heads again.
    const multiplier = 1 + 0.25 * Math.max(0, players - 1);
    // Use integer percentages so a half-step cannot drift below the rounding boundary.
    const percent = Math.round(difficultyScale(room.settings.sweepDifficulty) * 100);
    return Math.round(amount * multiplier * percent * eraPressure(room.settings.sweepEra, room.settings.sweepDifficulty) / 2500) * 25;
  }
  return { profile, formations, draw, pick, budget, aiKitAllowed, difficultyScale, eraPressure, countScale, selectCount, unified0079, tenLevels, family, t2Share, enemyEras, modelAllowed };
})();
if (typeof module !== "undefined") module.exports = ContractForces;
