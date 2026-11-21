/* Installed chassis plugins are IDs, never client-provided combat statistics. */
"use strict";
const UnitPlugins = (() => {
  const catalog = typeof UNIT_PLUGIN_DATA !== "undefined" ? UNIT_PLUGIN_DATA : require("./unit-plugins.json");
  const byId = new Map(catalog.map(part => [part.id, part])), cache = new WeakMap(), originals = new WeakMap();
  const ms = model => !model.ship && model.unitTags?.includes("MS");
  const allowed = (part, model) => !!part && (!part.msOnly || ms(model));
  function normalize(value, model) {
    if (value === undefined) return [null,null,null,null];
    if (!Array.isArray(value) || value.length > 4) throw Error("零件槽位无效");
    const seen = new Set();
    const slots = Array.from({length:4}, (_, index) => value[index] ?? null);
    for (const id of slots) {
      if (id === null) continue;
      if (typeof id !== "string" || !allowed(byId.get(id), model) || seen.has(id)) throw Error("零件重复或不适用于该单位");
      seen.add(id);
    }
    return slots;
  }
  function apply(base, value) {
    if (!base) return base;
    if (value === undefined) return base;
    if (base.installedPlugins && JSON.stringify(base.installedPlugins) === JSON.stringify(value)) return base;
    const slots = normalize(value, base), key = slots.join("|");
    if (!slots.some(Boolean)) return base;
    let variants = cache.get(base);
    if (!variants) cache.set(base, variants = new Map());
    if (variants.has(key)) return variants.get(key);
    const parts = slots.filter(Boolean).map(id => byId.get(id)), effects = {};
    for (const part of parts) for (const [name, amount] of Object.entries(part.effects)) effects[name] = (effects[name] || 0) + amount;
    const add = name => effects[name] || 0;
    const chassisCost = base.chassisCost ?? base.cost;
    const cost = parts.reduce((sum, part) => sum + (part.cost || 0) + chassisCost * (part.costPercent || 0), 0);
    const model = {...base,
      get name(){return base.name;},get description(){return base.description;},get kitName(){return base.kitName;},
      hp:Math.max(1,Math.round(base.hp*(1+add("hpPercent"))+add("hp"))),
      en:Math.max(0,Math.round(base.en*(1+add("enPercent")))),
      speed:Math.max(0,Math.round((base.speed??100)+add("speed"))),
      mobility:Math.max(0,Math.round(base.mobility+add("reaction"))),
      accuracy:Math.max(0,Math.round(base.accuracy*(1+add("accuracyPercent"))+add("accuracy"))),
      partStructuralStrength:Math.round((base.partStructuralStrength??100)*(1+add("partPercent"))),
      move:base.deployed?0:base.move+add("move"),
      cost:base.cost+Math.round(cost/25)*25,
      commandRangeBonus:(base.commandRangeBonus||0)+add("commandRange"),
      groundMoveBonus:(base.groundMoveBonus||0)+add("groundMove"),
      shield:{...base.shield,hp:Math.round(base.shield.hp*(1+add("shieldPercent"))),blockChance:Math.min(.75,base.shield.blockChance+add("blockChance"))},
      adaptability:Object.fromEntries(Object.entries(base.adaptability||{}).map(([terrain, amount])=>[terrain,Math.max(0,Math.min(100,amount+add("adaptability")+add(terrain)))])),
      ...(add("reactiveArmor")?{shellFinalResistance:Math.max(base.shellFinalResistance||0,25)}:{}),
      installedPlugins:slots,
    };
    function weapon(source) {
      const beam = source.type !== "melee" && (source.type === "beam" || source.type === "irradiation" || source.damageComponents?.beam > 0 || source.damageComponents?.beamAP > 0);
      if (!beam || (!add("beamRange")&&!add("beamHit"))) return source;
      const result = {...source};
      for (const field of ["max","range"]) if (Number.isFinite(source[field])) result[field] = Math.max(source.min??source.minRange??1,source[field]+add("beamRange"));
      for (const field of ["hit","baseHit"]) if (Number.isFinite(source[field])) result[field] = Math.max(0,Math.min(100,source[field]+add("beamHit")));
      if (source.attack) {
        result.attack = {...source.attack};
        for (const field of ["steps","strikes"]) if(source.attack[field])
          result.attack[field] = source.attack[field].map(step=>({...step,...(Number.isFinite(step.accuracy)?{accuracy:Math.max(0,Math.min(100,step.accuracy+add("beamHit")))}:{})}));
      }
      originals.set(result, source);
      return result;
    }
    model.weapons = (base.weapons||[]).map(weapon);
    model.skills = (base.skills||[]).map(weapon);
    if (add("reactiveArmor")&&!base.mechanics?.some(mechanic=>mechanic.id==="ExplosiveReactiveArmor_Shell"))
      model.mechanics = [...(base.mechanics||[]),{id:"ExplosiveReactiveArmor_Shell",name:"爆炸反应装甲：最终实弹伤害降低25%",status:"implemented"}];
    originals.set(model, base);
    variants.set(key,model);
    return model;
  }
  const baseOf = value => value && originals.get(value) || value;
  return {catalog,byId,allowed,normalize,apply,baseOf};
})();
if (typeof module !== "undefined") module.exports = UnitPlugins;
