/* Finite native armor coatings. Forecasts use copies; only confirmed hits spend resources. */
"use strict";
const ArmorCoatings = (() => {
  function active(model, unit, kind) {
    const config = model[kind];
    return !!config && (unit[kind + "Hp"] ?? config.capacity) > 0 &&
      (kind !== "phaseShift" || (unit.phaseShiftEnabled !== false && unit.en > 0));
  }
  function snapshot(model, unit) {
    return Object.fromEntries(["abc", "phaseShift"].filter(kind => model[kind]).map(kind => [kind, {
      hp: active(model, unit, kind) ? unit[kind + "Hp"] ?? model[kind].capacity : 0,
      initial: unit[kind + "Hp"] ?? model[kind].capacity,
      loss: 0,
    }]));
  }
  function protect(amount, channel, piercing, model, state, tracker) {
    let remaining = amount;
    for (const [kind, value] of Object.entries(state)) {
      if (value.hp <= 0) continue;
      const reductions = model[kind].reductions;
      const reduction = reductions[channel + (piercing ? "AP" : "")] ?? 0;
      const absorbed = remaining * reduction;
      if (tracker) tracker[kind] = (tracker[kind] || 0) + absorbed;
      remaining -= absorbed;
    }
    return remaining;
  }
  function advance(state, tracker) {
    for (const [kind, value] of Object.entries(state)) {
      const spent = Math.min(value.hp, Math.max(0, Math.round(tracker[kind] || 0)));
      value.hp -= spent; value.loss += spent;
    }
  }
  function consume(model, unit, state) {
    for (const [kind, value] of Object.entries(state || {})) {
      if (!value.loss) continue;
      unit[kind + "Hp"] = Math.max(0, (unit[kind + "Hp"] ?? model[kind].capacity) - value.loss);
      if (kind === "phaseShift") {
        const cost = Math.ceil((value.loss + 1) / model.phaseShift.capacity * model.en * model.phaseShift.energyPercent / 100);
        unit.en = Math.max(0, unit.en - cost);
      }
    }
  }
  return { active, snapshot, protect, advance, consume };
})();
if (typeof module !== "undefined") module.exports = ArmorCoatings;
