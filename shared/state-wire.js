"use strict";
// Optional, per-connection snapshot compression. Operates only AFTER privacy filtering.
const StateWire = (() => {
  const blocked = new Set(["__proto__", "prototype", "constructor"]);
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const equal = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
  function delta(before = {}, after = {}, omit = []) {
    const set = Object.create(null),
      remove = [];
    for (const key of Object.keys(before))
      if (!omit.includes(key) && !Object.hasOwn(after, key)) remove.push(key);
    for (const [key, value] of Object.entries(after))
      if (!omit.includes(key) && !equal(before[key], value)) set[key] = value;
    return { set, remove };
  }
  function apply(before, change) {
    if (!change || !change.set || !Array.isArray(change.remove)) throw Error("Invalid state patch");
    const result = { ...before };
    for (const [key, value] of Object.entries(change.set)) {
      if (blocked.has(key)) throw Error("Unsafe state key");
      result[key] = value;
    }
    for (const key of change.remove) {
      if (blocked.has(key)) throw Error("Unsafe state key");
      delete result[key];
    }
    return result;
  }
  function pack(before, after) {
    const previous = new Map(before.game.units.map((unit) => [unit.id, unit])),
      updates = [];
    for (const unit of after.game.units) {
      const change = delta(previous.get(unit.id), unit);
      if (change.remove.length || Object.keys(change.set).length) updates.push([unit.id, change]);
    }
    const ids = after.game.units.map((unit) => unit.id),
      oldIds = before.game.units.map((unit) => unit.id),
      present = new Set(ids);
    return {
      fields: delta(before, after, ["game"]),
      game: delta(before.game, after.game, ["units"]),
      units: updates,
      removed: oldIds.filter((id) => !present.has(id)),
      ...(!equal(ids, oldIds) ? { order: ids } : {}),
    };
  }
  function unpack(before, patch) {
    const units = new Map(before.game.units.map((unit) => [unit.id, unit]));
    for (const id of patch.removed) units.delete(id);
    for (const [id, change] of patch.units) units.set(id, apply(units.get(id), change));
    const game = apply(before.game, patch.game);
    game.units = patch.order
      ? patch.order.map((id) => {
          if (!units.has(id)) throw Error("Missing patch unit");
          return units.get(id);
        })
      : [...units.values()];
    return { ...apply(before, patch.fields), game };
  }
  function identity(state) {
    return JSON.stringify([
      state.room,
      state.matchId,
      state.viewTeam,
      state.you?.id,
      state.you?.seat,
    ]);
  }
  function createEncoder() {
    let before = null,
      sequence = 0;
    return {
      reset() {
        before = null;
      },
      encode(state) {
        // Freeze the baseline by serialization: engine actors keep mutating after send().
        const serialized = JSON.stringify(state),
          current = JSON.parse(serialized),
          next = ++sequence;
        const full = serialized.slice(0, -1) + ',"wireSequence":' + next + "}";
        let encoded = full;
        if (before && sequence % 128 !== 0 && identity(before) === identity(current)) {
          const patch = JSON.stringify({
            type: "state_delta",
            sequence: next,
            baseSequence: next - 1,
            patch: pack(before, current),
          });
          if (patch.length < full.length * 0.9) encoded = patch;
        }
        before = current;
        return encoded;
      },
    };
  }
  function createDecoder() {
    let before = null,
      sequence = 0;
    return {
      decode(message) {
        if (message.type === "state_delta") {
          if (!before || message.baseSequence !== sequence || message.sequence !== sequence + 1)
            throw Error("State patch baseline mismatch");
          before = unpack(before, message.patch);
          sequence = message.sequence;
          return copy(before); // Client animation must not mutate the transport baseline.
        }
        if (message.type === "state") {
          const { wireSequence, ...state } = message;
          before = Number.isSafeInteger(wireSequence) ? copy(state) : null;
          sequence = wireSequence || 0;
          return state;
        }
        return message;
      },
    };
  }
  return { createEncoder, createDecoder };
})();
if (typeof module !== "undefined") module.exports = StateWire;
