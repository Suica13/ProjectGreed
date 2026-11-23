const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  path = require("node:path");
const G = require("../shared/rules.js"),
  P = require("../shared/unit-plugins.js"),
  W = require("../shared/warehouse.js");
const base = G.models.RGM_79__beam_spray;
function economy(saved) {
  const data = new Map(saved ? [["projectgreed.economy.v1", JSON.stringify(saved)]] : []),
    context = vm.createContext({
      require: require("node:module").createRequire(path.resolve("shared/economy.js")),
      module: { exports: {} },
      structuredClone,
      ART: G.catalog,
      localStorage: {
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => data.set(key, value),
        removeItem: (key) => data.delete(key),
      },
    });
  vm.runInContext(fs.readFileSync("shared/economy.js", "utf8"), context);
  return context.module.exports;
}
function unlockAnaheim(E, count) {
  E.meetLiaison('anaheim');
  for(const task of require('../shared/contact-tasks').tasks.filter(t=>t.contactId==='anaheim'&&t.number<=count)) {
    E.acceptContactTask(task.id);
    E.creditAward({id:'unlock-'+task.id,matchId:'unlock-'+task.id,money:0,supplies:0,contactProgress:[{id:task.id,amount:task.required}]});
    E.completeContactTask(task.id);
  }
}
test("four empty slots, whitelist, non-warship restrictions and duplicate rejection", () => {
  assert.equal(P.catalog.length, 33);
  assert.deepEqual(P.normalize(undefined, base), [null, null, null, null]);
  for (const slots of [
    ["frame", "frame"],
    ["unknown"],
    ["frame", "armor", "generator", "antenna", "magnetic"],
    [{}],
  ])
    assert.throws(() => P.apply(base, slots));
  assert.throws(() => P.apply(G.models.ColumbusClass__standard, ["water"]));
  for (const part of P.catalog) assert(P.apply(base, [part.id]));
});
test("HP, EN, coefficients, command range, armor and COST derive without changing base", () => {
  const original = JSON.stringify(base),
    m = P.apply(base, ["frame", "armor", "generator", "chobham"]);
  assert.equal(m.hp, base.hp + 25000);
  assert.equal(m.en, base.en + 150);
  assert.equal(m.partStructuralStrength, base.partStructuralStrength + 25);
  assert.equal(m.speed, base.speed - 15);
  assert.equal(m.mobility, base.mobility - 15);
  assert.equal(m.cost, base.cost + 175);
  assert.equal(m.defenses.shell.percent, base.defenses.shell.percent + 5);
  assert.equal(m.defenses.shell.flat, base.defenses.shell.flat + 100);
  assert(!m.mechanics.some((x) => x.id === "ExplosiveReactiveArmor_Shell"));
  assert.equal(P.apply(base, ["panoramic", "tem_ray"]).accuracy, base.accuracy + 15);
  const actor = G.makeUnit(
    { unitId: "RGM_79", kitId: "beam_spray", plugins: ["antenna"] },
    0,
    100,
    { x: 1, y: 1 },
  );
  const plain = G.makeUnit({ unitId: "RGM_79", kitId: "beam_spray" }, 0, 100, { x: 1, y: 1 });
  assert.equal(G.commandAura(actor).radius, G.commandAura(plain).radius + 1);
  assert.equal(JSON.stringify(base), original);
  assert.strictEqual(P.apply(base, ["frame"]), P.apply(base, ["frame"]));
});
test("adaptability and shields respect hard caps; hover bonus is ground only", () => {
  const m = P.apply(
    {
      ...base,
      adaptability: { ground: 95, space: 80, water: 0 },
      shield: { ...base.shield, blockChance: 0.7 },
    },
    ["water", "ambac", "shield", "hover"],
  );
  assert.deepEqual(m.adaptability, { ground: 100, space: 55, water: 50 });
  assert.equal(m.shield.blockChance, 0.75);
  assert.equal(m.shield.hp, base.shield.hp + 3000);
  const actor = {
    model: "RGM_79__beam_spray",
    plugins: ["hover", "limiter"],
    environment: "ground",
    hp: 100,
    en: 100,
  };
  assert.equal(G.modelOf(actor).move, base.move + 3);
  const space = G.modelOf({ ...actor, environment: "space" });
  assert(space.move <= base.move + 1);
  const plain = G.modelOf({ ...actor, plugins: ["limiter"], environment: "space" });
  assert(plain.move <= base.move + 1);
});
test("beam modifications update actual firing steps and maximum range, leaving shell and melee untouched", () => {
  const m = P.apply(base, ["short_beam"]),
    weapon = base.weapons.find((w) => w.type === "beam"),
    changed = m.weapons.find((w) => w.id === weapon.id);
  assert.equal(changed.max, Math.max(weapon.min, weapon.max - 1));
  assert.equal(changed.hit, Math.min(100, weapon.hit + 10));
  for (let i = 0; i < weapon.attack.steps.length; i++)
    if (Number.isFinite(weapon.attack.steps[i].accuracy))
      assert.equal(
        changed.attack.steps[i].accuracy,
        Math.min(100, weapon.attack.steps[i].accuracy + 10),
      );
  for (let i = 0; i < weapon.attack.strikes.length; i++)
    if (Number.isFinite(weapon.attack.strikes[i].accuracy))
      assert.equal(
        changed.attack.strikes[i].accuracy,
        Math.min(100, weapon.attack.strikes[i].accuracy + 10),
      );
  for (const w of base.weapons.filter((w) => w.type === "melee" || w.type === "shell"))
    assert.strictEqual(
      m.weapons.find((next) => next.id === w.id),
      w,
    );
});
test("purchased equipment fits without additional fees, persists and preserves damage", () => {
  const E = economy();
  E.creditActivity({
    id: "plugin-stock",
    matchId: "plugin-stock",
    money: 100000,
    supplies: 0,
    inventory: { RGM_79: 1 },
  });
  unlockAnaheim(E,3);
  E.purchasePlugin("anaheim", "frame");
  E.purchasePlugin("anaheim", "generator");
  const before = E.snapshot(),
    item = before.storage.units[0],
    id = item.id;
  E.creditAward({
    id: "plugin-damage",
    matchId: "plugin-damage",
    money: 0,
    supplies: 0,
    stockStates: [
      {
        stockId: id,
        unitId: item.unitId,
        kitId: item.kitId,
        hp: Math.round(item.hp / 2),
        en: 0,
        brokenParts: {},
      },
    ],
  });
  assert(E.setStoredPlugin(id, 0, "frame"));
  assert(E.setStoredPlugin(id, 1, "generator"));
  const fitted = E.snapshot(),
    stored = fitted.storage.units[0],
    model = P.apply(G.models[stored.unitId + "__" + stored.kitId], stored.plugins);
  assert.equal(fitted.money, before.money);
  assert.equal(fitted.supplies, before.supplies);
  assert(Math.abs(stored.hp / model.hp - 0.5) < 0.0001);
  assert.equal(stored.en, 0);
  assert.equal(JSON.stringify(economy(fitted).snapshot()), JSON.stringify(fitted));
  assert.throws(() => E.setStoredPlugin(id, 2, "frame"));
  assert.equal(JSON.stringify(E.snapshot()), JSON.stringify(fitted));
  assert(E.repairAllStoredUnits());
  const repaired = E.snapshot().storage.units[0];
  assert.equal(repaired.hp, model.hp);
  assert.equal(repaired.en, model.en);
  const profile = E.storedUnits()[0];
  assert.deepEqual(JSON.parse(JSON.stringify(profile.plugins)), ["frame", "generator", null, null]);
  assert(E.setStoredPlugin(id, 0, null));
  assert.equal(E.snapshot().storage.units[0].hp, item.hp);
});
test("formation and actors retain plugin IDs, use added COST and reject untrusted modifier objects", () => {
  const entry = { unitId: "RGM_79", kitId: "beam_spray", plugins: ["frame", "ground"] };
  const clean = G.validateFormation([entry], Infinity, 72);
  assert.deepEqual(clean[0].plugins, ["frame", "ground", null, null]);
  const model = G.formationModel(clean[0]),
    actor = G.makeUnit(clean[0], 0, 55, { x: 2, y: 2 });
  assert.equal(actor.hp, G.modelOf(actor).hp);
  assert.equal(G.modelOf(actor).cost, model.cost);
  assert.equal(model.cost, base.cost + 100);
  assert.throws(() =>
    G.validateFormation([{ ...entry, plugins: [{ id: "frame", hp: 999999 }] }], Infinity, 72),
  );
  const profile = W.profile(
    [
      {
        id: "plugin-unit",
        unitId: "RGM_79",
        kitId: "beam_spray",
        plugins: ["frame"],
        hp: base.hp + 5000,
        en: base.en,
      },
    ],
    G.models,
  )[0];
  assert.equal(profile.hp, base.hp + 5000);
});

test("fixed plugin COST is independent of weapon kits, pilots and other plugins", () => {
  const first = { ...base, cost: 750, chassisCost: 500 },
    second = { ...first, cost: 850 };
  assert.equal(P.apply(first, ["water"]).cost - first.cost, 50);
  assert.equal(P.apply(second, ["water"]).cost - second.cost, 50);
  assert.equal(P.apply(second, ["water", "frame"]).cost - second.cost, 100);
});

test("catalog, task-gated Anaheim, faction merchant levels and era labels follow the revised equipment table", () => {
  assert.deepEqual(
    P.catalog.map((p) => p.number),
    Array.from({ length: 35 }, (_, i) => i + 1).filter((n) => ![22, 29].includes(n)),
  );
  const E = economy();
  E.creditActivity({ id: "market", matchId: "market", money: 100000, supplies: 0 });
  assert.throws(()=>E.purchasePlugin("anaheim","ambac"),/前提任务/);
  unlockAnaheim(E,7);
  assert(E.purchasePlugin("anaheim", "ambac")); // T2 is a label; claimed task is the gate.
  assert.equal(E.pluginOffer("efsf", "v_data").available, false);
  const before = JSON.stringify(E.snapshot());
  assert.throws(() => E.purchasePlugin("efsf", "v_data"));
  assert.equal(JSON.stringify(E.snapshot()), before);
  assert.equal(E.pluginOffer("anaheim", "v_data"), null);
  assert.equal(E.pluginOffer("zeon", "hover").available, false);
  const state = E.snapshot();
  state.contactAffinity = 800;
  state.merchantAffinities.anaheim = 800;
  const upgraded = economy(state);
  assert(upgraded.purchasePlugin("efsf", "v_data"));
  assert(upgraded.purchasePlugin("anaheim", "long_sight"));
  assert.equal(upgraded.snapshot().money, state.money - 9000);
  assert.equal(economy(upgraded.snapshot()).merchantLevel("anaheim"), 2);
});

test("weapon category bonuses reach every actual strike once and preserve native payloads", () => {
  const classes = require("../shared/weapon-classes"),
    all = Object.values(G.models).flatMap((m) => m.weapons),
    sum = (c) => Object.values(c).reduce((a, b) => a + b, 0);
  for (const [plugin, predicate, bonus] of [
    ["rocket_head", (w) => classes.classify(w) === "bazooka", 1000],
    ["beam_generator", (w) => classes.classify(w) === "beam_rifle", 1000],
    ["luna_ammo", (w) => w.type === "shell" && w.damageComponents.shell > 0, 150],
    ["beam_melee", (w) => w.type === "melee" && w.damageComponents.meleeBeam > 0, 1500],
    ["heat_melee", (w) => w.type === "melee" && w.damageComponents.meleeShell > 0, 1500],
    [
      "focus_ring",
      (w) => classes.classify(w) === "beam_cannon" && w.damageComponents.beamAP > 0,
      2000,
    ],
    ["aiming_system", (w) => w.damagePerShot > 0, 200],
  ]) {
    const weapon = all.find(predicate);
    assert(weapon, plugin);
    const original = JSON.stringify(weapon),
      changed = P.apply({ ...base, weapons: [weapon] }, [plugin]).weapons[0];
    assert.equal(changed.damagePerShot, weapon.damagePerShot + bonus, plugin);
    for (let i = 0; i < weapon.attack.strikes.length; i++)
      assert.equal(
        sum(changed.attack.strikes[i].damageComponents || changed.damageComponents),
        sum(weapon.attack.strikes[i].damageComponents || weapon.damageComponents) + bonus,
        plugin,
      );
    assert.equal(
      changed.damage,
      weapon.damage + bonus * weapon.attack.strikes.length * (weapon.hitsPerShot || 1),
      plugin,
    );
    assert.equal(JSON.stringify(weapon), original);
    assert.deepEqual(changed.nativePayload, weapon.nativePayload);
  }
  const mg = all.find((w) => classes.classify(w) === "machine_gun"),
    vulcan = base.weapons.find((w) => classes.classify(w) === "small_vulcan");
  const modified = P.apply({ ...base, weapons: [mg, vulcan] }, ["long_barrel"]);
  assert.equal(modified.weapons[0].max, mg.max + 1);
  assert.equal(modified.weapons[0].hit, Math.min(100, mg.hit + 5));
  assert.strictEqual(modified.weapons[1], vulcan);
  const spray = base.weapons.find((w) => classes.classify(w) === "beam_spray");
  assert.strictEqual(
    P.apply(base, ["beam_generator"]).weapons.find((w) => w.id === spray.id),
    spray,
  );
});

test("plugin Minovsky S is an actionable authoritative skill with normal EN, cooldown and no duplicate built-in skills", () => {
  const game = G.create(
      false,
      177,
      [
        [{ unitId: "RGM_79", kitId: "beam_spray", plugins: ["minovsky"] }],
        [{ unitId: "MS_06F", kitId: "machine_gun" }],
      ],
      false,
      { costLimit: 50000, formationStyle: "free" },
    ),
    unit = game.units[0];
  const skill = G.unitSkills(unit).find((s) => s.type === "minovsky");
  assert(skill);
  require("../shared/unit-skills").validate([skill]);
  const before = unit.en;
  G.useSkill(game, unit, skill.id, unit.x, unit.y);
  assert.equal(unit.en, before - 300);
  assert.equal(game.minovskyFields.length, 1);
  assert.equal(game.minovskyFields[0].radius, 7);
  assert.equal(G.canUseSkill(game, unit, skill.id), false);
  assert.equal(
    P.apply(G.models.Dash__standard, ["minovsky"]).skills.filter((s) => s.type === "minovsky")
      .length,
    1,
  );
});

test("concealment and MS database change radar acquisition without bypassing anti-detection", () => {
  const sensors = require("../shared/unit-sensors").create({
    modelOf: (u) => P.apply(base, u.plugins),
    cells: (u) => [{ x: u.x, y: u.y }],
    onMap: (u) => u.hp > 0,
  });
  const source = { id: "source", team: 0, hp: 100, x: 0, y: 0, plugins: [] },
    target = { id: "target", team: 1, hp: 100, x: 6, y: 0, plugins: ["concealment"] };
  const game = {
    units: [source, target],
    round: 1,
    fogMode: "full",
    environment: "ground",
    tiles: [Array(20).fill("plain")],
  };
  target.plugins = [];
  target.x = 8;
  assert(sensors.detected(game, 0, target));
  target.plugins = ["concealment"];
  target.x = 4;
  assert(!sensors.detected(game, 0, target));
  source.plugins = ["ms_database"];
  assert(sensors.detected(game, 0, target));
  target.x = 6;
  assert(!sensors.detected(game, 0, target));
  const boosted = P.apply(base, ["long_sight", "radar"]);
  assert.equal(boosted.sensors.sight, base.sensors.sight + 3);
  assert.equal(boosted.sensors.radar, base.sensors.radar + 3);
});

test("room authority uses stored plugin IDs when creating quick-match actors", (t) => {
  const { createRoomEngine } = require("../shared/room-engine");
  let serial = 0;
  const errors = [],
    engine = createRoomEngine({
      rules: G,
      randomId: () => String(++serial),
      randomToken: () => String(++serial),
      randomSeed: () => 7319,
      send: (_, message) => {
        if (message.type === "error") errors.push(message);
      },
      aiDelayMs: 999999,
    });
  t.after(() => engine.close());
  const clients = [{ readyState: 1 }, { readyState: 1 }];
  const storedUnits = [
    ["Medea", "standard", "armor"],
    ["Type61", "standard", "generator"],
  ].map(([unitId, kitId, part], index) => {
    const model = P.apply(G.models[unitId + "__" + kitId], [part]);
    return { id: "stock-" + index, unitId, kitId, plugins: [part], hp: model.hp, en: model.en };
  });
  clients.forEach((ws, index) =>
    engine.join(ws, {
      mode: index ? "join" : "create",
      room: "PLUGINS",
      roomMode: "quick",
      characterFaction: "PMC",
      licenses: { Medea: true, Type61: true },
      inventory: { Medea: 5, Type61: 5 },
      storedUnits,
    }),
  );
  const room = engine.rooms.get("PLUGINS");
  const act = (index, action, fields = {}) =>
    engine.action(clients[index], {
      id: "action-" + ++serial,
      revision: room.revision,
      round: room.game.round,
      phase: room.phase,
      matchId: room.matchId,
      action,
      ...fields,
    });
  const formation = storedUnits.map((item, index) => ({
    unitId: item.unitId,
    kitId: item.kitId,
    stockId: item.id,
    plugins: ["limiter"],
    ...(index ? { preload: { carrierIndex: 0, hangarId: "Hangar_1" } } : {}),
  }));
  act(1, "set_ready", { ready: true, formation });
  act(0, "start_game", { formation });
  act(0, "confirm_formation");
  act(1, "confirm_formation");
  const actors = room.game.units.filter((unit) => G.ownerOf(unit) === 0);
  assert.equal(actors.length, 2, JSON.stringify(errors));
  assert.deepEqual(actors.map((actor) => actor.plugins[0]).sort(), ["armor", "generator"]);
  for (const actor of actors) {
    assert.equal(actor.hp, G.modelOf(actor).hp);
    assert.equal(actor.en, G.modelOf(actor).en);
  }
  assert.equal(errors.length, 0);
});
