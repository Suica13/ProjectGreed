const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules"),
  B = require("../shared/battlefield-mode"),
  M = require("../shared/mission-mode"),
  D = require("../shared/map-document");
const { createRoomEngine } = require("../shared/room-engine");
const battlefield = [
  "battlefield_asteroid_corridor",
  "battlefield_ship_graveyard",
  "battlefield_lunar_orbit",
  "battlefield_mangrove_delta",
  "battlefield_frozen_basin",
];
const quick = [
  "jungle_delta_3v3",
  "glacier_gates_3v3",
  "desert_relay_3v3",
  "urban_floodplain_3v3",
  "orbital_arc_3v3",
];
test("ten new maps use editable connected shared deployment and correct biome/mode art", () => {
  for (const id of [...battlefield, ...quick]) {
    const map = G.getMap(id);
    if (quick.includes(id)) assert(map.name.endsWith(" · 3v3"));
    D.validate(map.tileMap);
    assert.deepEqual(map.supportedModes, [battlefield.includes(id) ? "battlefield" : "quick"]);
    assert(map.tileMap.layers.length >= 4);
    assert.equal(new Set(map.deploymentAreas.map((a) => JSON.stringify(a))).size, 2);
    if (battlefield.includes(id)) {
      B.validateMap(map);
      assert.equal(map.playersPerTeam, 6);
      assert.equal(map.battlefield.points.length, 4);
    }
    if (map.environment === "space")
      assert(map.tiles.flat().filter((t) => t === "plain").length > map.width * map.height * 0.6);
    // Every objective has an open route to the central battlefield; water and
    // impassable rock cannot isolate an objective from ordinary ground troops.
    const seen = new Set(),
      queue = [map.spawns[0]];
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i],
        key = p.x + "," + p.y;
      if (
        seen.has(key) ||
        !map.tiles[p.y]?.[p.x] ||
        ["rock", "water"].includes(map.tiles[p.y][p.x])
      )
        continue;
      seen.add(key);
      for (const [x, y] of [
        [p.x - 1, p.y],
        [p.x + 1, p.y],
        [p.x, p.y - 1],
        [p.x, p.y + 1],
      ])
        queue.push({ x, y });
    }
    for (const p of [...map.spawns, ...(map.battlefield?.points || [])])
      assert(seen.has(p.x + "," + p.y), id + " disconnected " + p.x + "," + p.y);
  }
});
test("all UC faction waves replace unsuitable units and include fixed transports with no random warships", () => {
  for (const era of ["UC_0079_T1", "UC_0079_T2", "UC_0087_T1", "UC_0087_T2"])
    for (const faction of era.includes("0079") ? ["EFSF", "ZEON"] : ["AEUG", "TITANS", "NEO_ZEON"])
      for (const env of ["ground", "space"])
        for (const round of [1, 31, 71]) {
          const entries = B.wavePlan(G, { era, faction }, round, 2, () => 0, env),
            ships = entries.filter((e) => e.group.endsWith(":transport"));
          assert.equal(ships.length, 2);
          const z = ["ZEON", "NEO_ZEON"].includes(faction),
            early = era === "UC_0079_T1";
          const expected =
            env === "space"
              ? z
                ? early
                  ? "PapuaClass"
                  : "PazockClass"
                : early
                  ? "ColumbusClass"
                  : "ColumbusClassKai"
              : z
                ? early
                  ? "FatUncle"
                  : "FatUncleKai"
                : early
                  ? "Medea"
                  : "MedeaKai";
          assert(ships.every((e) => e.unitId === expected));
          assert(!entries.some((e) => e.group.endsWith(":ship")));
          for (const e of entries) {
            const m = G.models[e.unitId + "__" + e.kitId];
            assert(m.adaptability[env] > 0, era + "/" + faction + "/" + env + "/" + e.unitId);
            if (e.group.endsWith(":random-ms")) assert(!m.ship);
          }
        }
});
test("space reinforcements spawn in space rather than with a ground environment", () => {
  const map = G.getMap(battlefield[0]),
    armies = Array(map.spawns.length).fill(null);
  armies[2] = [{ unitId: "ColumbusClass", kitId: "standard" }];
  const g = G.create(false, 19, armies, false, {
    mode: "battlefield",
    mapId: map.id,
    battlefieldTeams: [
      { faction: "EFSF", era: "UC_0079_T1" },
      { faction: "ZEON", era: "UC_0079_T1" },
    ],
  });
  g.deployment = null;
  B.reinforce(G, g);
  assert(g.units.some((u) => u.id.startsWith("airdrop-")));
  assert(
    g.units.filter((u) => u.id.startsWith("airdrop-")).every((u) => u.environment === "space"),
  );
});
test("core booster beam guns halve final damage with 25-point rounding and retain audited source values", () => {
  const beam = G.models.FF_X7Bst__main_0.weapons.find((w) => w.id === "EF_FF_X7Bst_BR");
  assert.equal(beam.damagePerShot, 1425);
  const changes = require("../shared/editor-adjustments.json").units.FF_X7Bst;
  assert(changes["/weapons/EF_FF_X7Bst_BR/damagePerShot"] < 0);
});
function fixture(t, map) {
  let n = 0;
  const engine = createRoomEngine({
    rules: G,
    randomId: () => String(++n),
    randomToken: () => String(++n),
    randomSeed: () => 73,
    aiDelayMs: 999999,
    send: () => {},
  });
  t.after(() => engine.close());
  const ws = { readyState: 1 };
  const id = map.environment === "space" ? "ColumbusClass" : "Medea";
  engine.join(ws, {
    mode: "create",
    room: "CONTENT",
    roomMode: "mission",
    characterFaction: "PMC",
    inventory: { [id]: 5 },
    licenses: { [id]: true },
  });
  const room = engine.rooms.get("CONTENT");
  const act = (action, fields = {}) =>
    engine.action(ws, {
      id: "req" + ++n,
      revision: room.revision,
      round: room.game.round,
      phase: room.phase,
      matchId: room.matchId,
      action,
      ...fields,
    });
  act("configure_room", { ...room.settings, mapId: map.id });
  act("start_game", { formation: [{ unitId: id, kitId: "standard" }] });
  act("confirm_formation");
  G.aiDeployment(room.game, 0);
  act("confirm_deployment");
  const dialogue = () => {
    let count = 0;
    while (room.game.mission.dialogue) {
      assert(++count < 100);
      const d = room.game.mission.dialogue;
      act("mission_dialogue_next", { dialogueId: d.id, lineIndex: d.index });
    }
  };
  dialogue();
  return { room, engine, act, dialogue };
}
const missions = Object.values(G.catalog.maps).filter((m) => m.mission);
test("the revised cooperative missions remain selectable", () => {
  assert.deepEqual(missions.map(m=>m.id).sort(), ["mission_bunker_coastal", "mission_burning_city", "mission_no_fool", "mission_shuttle_defense", "mission_sleepless_raid", "mission_white_base"]);
  assert.equal(missions[0].name, "[0079][剧情]相逢在宇宙-EFSF");
  for (const map of missions) M.validate(map.mission, map, G);
  assert(G.getMap("battlefield_frontline").name.startsWith("雇佣兵战争 · "));
});
