const test = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs");
const R = require("../shared/profile-reset"),
  P = require("../shared/pilots"),
  E = require("../shared/economy"),
  G = require("../shared/rules");
const key = "projectgreed.custom-pilots.v3.shared";
function storage(entries) {
  const data = new Map(entries);
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i],
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
  };
}
const context = vm.createContext({ module: { exports: {} } });
vm.runInContext(fs.readFileSync("client/profile-storage.js", "utf8"), context);
const S = context.module.exports;
function oldPilot(i) {
  return P.custom({
    ...P.createCustom("custom-reset-" + i, "保留" + i),
    level: 8,
    experience: 30000,
    reincarnations: 2,
    personality: "custom",
    dialogue: {},
    record: { kills: i, battles: 3, losses: 1, shipKills: 0 },
  });
}
test("one-time reset retains custom identities and records, resets training and sends overflow to dorm storage", () => {
  const custom = Array.from({ length: 12 }, (_, i) => oldPilot(i));
  const s = storage([
    [
      key,
      JSON.stringify({
        pilots: [...custom, { id: "ace", name: "ACE", ace: true }],
        awards: ["old"],
      }),
    ],
    ["projectgreed.economy.v1", "old"],
    ["projectgreed.developmentProgress.v1", "old"],
    ["slg-formations-v1.PMC", "old"],
    ["projectgreed.profile-identity.v1", "company"],
    ["language", "en"],
  ]);
  assert(R.apply(s, S.replace));
  const kept = JSON.parse(s.getItem(key));
  assert.equal(kept.pilots.length, 12);
  assert.deepEqual(kept.awards, []);
  kept.pilots.forEach((p, i) => {
    assert.equal(p.id, custom[i].id);
    assert.equal(p.name, custom[i].name);
    assert.deepEqual(p.record, custom[i].record);
    assert.equal(p.level, 0);
    assert.equal(p.experience, 0);
    assert.equal(p.points, 80);
    assert.equal(p.reincarnations, undefined);
    assert.deepEqual(p.stats, P.baseStats());
    assert.equal(!!p.inDormStorage, i >= 10);
  });
  assert.equal(s.getItem("projectgreed.economy.v1"), null);
  assert.equal(s.getItem("projectgreed.developmentProgress.v1"), null);
  assert.equal(s.getItem("slg-formations-v1.PMC"), null);
  assert.equal(s.getItem("projectgreed.profile-identity.v1"), "company");
  assert.equal(s.getItem("language"), "en");
  s.setItem("projectgreed.economy.v1", "new-progress");
  assert.equal(R.apply(s, S.replace), false);
  assert.equal(s.getItem("projectgreed.economy.v1"), "new-progress");
});
test("reset transaction restores the full old save if persistence fails", () => {
  const s = storage([
    [key, JSON.stringify({ pilots: [oldPilot(0)] })],
    ["projectgreed.economy.v1", "old"],
  ]);
  const before = [...s.data];
  const set = s.setItem;
  let fail = true;
  s.setItem = (k, v) => {
    if (k === R.marker && fail) {
      fail = false;
      throw Error("denied");
    }
    set(k, v);
  };
  assert.throws(() => R.apply(s, S.replace), /denied/);
  assert.deepEqual([...s.data].sort(), before.sort());
});
test("pre-reset imports clear progress while preserving customized PMC pilots", () => {
  const old = {
    pilots: { PMC: { pilots: [oldPilot(2)] } },
    economy: { money: 99999 },
    identity: { name: "company" },
  };
  const clean = R.portable(old, E.initial());
  assert.equal(clean.economy.money, 8000);
  assert.equal(clean.pilots.PMC.pilots[0].level, 0);
  assert.equal(clean.pilots.PMC.pilots[0].record.kills, 2);
  assert.equal(clean.identity.name, "company");
  assert(R.needsReset(old.economy));
  assert(!R.needsReset(clean.economy));
});
test("starter profile has exact stock, only both 0079 base permits, and transports use ship storage", () => {
  const initial = E.initial();
  assert.equal(initial.money, 8000);
  assert.equal(initial.supplies, 8000);
  assert.equal(initial.licenses.MS_06F, true);
  assert.equal(initial.licenses.Medea, true);
  assert.equal(initial.licenses.RX_78_2, undefined);
  const D = require('../shared/development.js');
  assert.deepEqual(D.normalizeResearch({}).EFSF, ['Tech_EFSF_0079_BaseTech']);
  assert.deepEqual(D.normalizeResearch({}).ZEON, ['Tech_ZEON_0079_BaseTech']);
  assert.deepEqual(D.normalizeResearch({}).AEUG, []);
  assert.equal(E.validate({...initial, licenses:{}}).licenses.MS_06F, true);
  assert.deepEqual(initial.inventory, {
    RGM_79_E: 3,
    MS_06F: 3,
    Medea: 1,
    FatUncle: 1,
    ColumbusClass: 1,
    PapuaClass: 1,
  });
  assert.equal(initial.storage.units.length, 6);
  assert.equal(initial.storage.ships.length, 4);
  const W = require("../shared/warehouse");
  for (const prefabId of ["Medea", "MedeaKai", "FatUncle", "FatUncleKai"])
    assert.equal(W.category({ prefabId }), "ships");
});
test("academy caps pilot promotions and only level five enables rebirth", () => {
  const p = P.gainExperience(P.createCustom("custom-academy", "Academy"), 5000000);
  for (const [level, cap] of [
    [1, 3],
    [2, 4],
    [3, 6],
    [4, 8],
    [5, 8],
  ]) {
    let u = p;
    assert.equal(P.maxLevel(u, level), cap);
    while (P.canUpgrade(u, level)) u = P.upgrade(u, level);
    assert.equal(u.level, cap);
    assert.throws(() => P.upgrade(u, level));
    assert.equal(P.canReincarnate(u, level), level === 5);
  }
  let reborn = P.reincarnate(P.custom({ ...p, level: 8 }), 5);
  assert.equal(P.maxLevel({ ...reborn, reincarnations: 4 }, 5), 12);
  assert.throws(() => P.reincarnate(P.custom({ ...p, level: 8 }), 4));
});
test("selectable content is limited but fixed-era missions remain playable", () => {
  assert.throws(()=>G.validateOpenContent({mode:"battlefield",battlefieldEra:"UC_0079_T1",costLimit:10000}),/7500/);
  assert.doesNotThrow(()=>G.validateOpenContent({mode:"battlefield",battlefieldEra:"UC_0079_T1",costLimit:7500}));
  assert.doesNotThrow(() =>
    G.validateOpenContent({
      ...G.defaultRoomSettings(),
      mode: "sweep",
      sweepDifficulty: 3,
      sweepEra: "UC_0079_T1",
    }),
  );
  assert.throws(() =>
    G.validateOpenContent({ mode: "sweep", sweepDifficulty: 4, sweepEra: "UC_0079_T1" }),
  );
  for (const settings of [
    { mode: "regular", regularEra: "UC_0087_T1" },
    { mode: "battlefield", battlefieldEra: "UC_0079_T2" },
    { mode: "sweep", sweepDifficulty: 1, sweepEra: "UC_0087_T1" },
  ])
    assert.throws(() => G.validateOpenContent(settings));
  assert.doesNotThrow(() => G.validateOpenContent({ mode: "mission", missionEra: "UC_0087_T1" }));
});
test("server rejects forbidden room configuration without changing its previous rules", (t) => {
  const { createRoomEngine } = require("../shared/room-engine");
  let serial = 0;
  const engine = createRoomEngine({
    rules: G,
    randomId: () => String(++serial),
    randomToken: () => String(++serial),
    randomSeed: () => 34567,
    send() {},
  });
  t.after(() => engine.close());
  const ws = { readyState: 1 };
  const stock = E.initial();
  engine.join(ws, {
    mode: "create",
    room: "RESET_GATE",
    roomMode: "sweep",
    name: "Test",
    characterFaction: "PMC",
    licenses: stock.licenses,
    inventory: stock.inventory,
    storedUnits: [...stock.storage.units, ...stock.storage.ships],
  });
  const room = engine.rooms.get("RESET_GATE");
  const configure = (fields) =>
    engine.action(ws, {
      id: "gate-" + ++serial,
      revision: room.revision,
      round: room.game.round,
      phase: room.phase,
      matchId: room.matchId,
      action: "configure_room",
      ...room.settings,
      ...fields,
    });
  const previous = JSON.stringify(room.settings);
  assert.throws(() => configure({ sweepDifficulty: 4 }), /N1至N3/);
  assert.equal(JSON.stringify(room.settings), previous);
  assert.throws(() => configure({ sweepEra: "UC_0087_T1", sweepFaction: "TITANS" }), /仅开放/);
  assert.equal(JSON.stringify(room.settings), previous);
  assert.doesNotThrow(() => configure({ sweepDifficulty: 3 }));
  assert.equal(room.settings.sweepDifficulty, 3);
  const carrier = stock.storage.ships.find((u) => u.unitId === "Medea");
  const formation = [{ unitId: "Medea", kitId: "standard", stockId: carrier.id }];
  assert.doesNotThrow(() =>
    engine.action(ws, {
      id: "start-stock",
      revision: room.revision,
      round: room.game.round,
      phase: room.phase,
      matchId: room.matchId,
      action: "start_game",
      formation,
    }),
  );
  assert.equal(room.phase, "assembly");
  engine.action(ws, {
    id: "confirm-stock",
    revision: room.revision,
    round: room.game.round,
    phase: room.phase,
    matchId: room.matchId,
    action: "confirm_formation",
  });
  assert.equal(room.phase, "deployment");
});
