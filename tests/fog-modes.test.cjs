const test = require("node:test"),
  assert = require("node:assert/strict"),
  G = require("../shared/rules.js"),
  Sensors = require("../shared/unit-sensors.js"),
  { createRoomEngine } = require("../shared/room-engine.js");

function sensorFixture() {
  const cells = (unit) => [{ x: unit.x, y: unit.y }];
  const api = Sensors.create({
    modelOf: (unit) => ({ sensors: unit.sensors }),
    cells,
    onMap: (unit) => unit.hp > 0 && !unit.embarked,
  });
  const own = {
      id: "own",
      team: 0,
      hp: 1,
      x: 1,
      y: 1,
      sensors: { sight: 1, radar: 5, antiDetection: 0 },
    },
    enemy = {
      id: "enemy",
      team: 1,
      hp: 1,
      x: 9,
      y: 1,
      sensors: { sight: 1, radar: 1, antiDetection: 0 },
    },
    game = {
      units: [own, enemy],
      round: 1,
      fogMode: "full",
      environment: "ground",
      tiles: Array.from({ length: 12 }, () => Array(12).fill("plain")),
    };
  return { api, own, enemy, game };
}

test("fog modes separate visibility from detection and disabled marks every enemy", () => {
  const { api, enemy, game } = sensorFixture();
  let intel = api.view(game, 0);
  assert(!intel.visibleIds.includes(enemy.id));
  assert(!intel.detectedIds.includes(enemy.id));

  game.fogMode = "visible";
  intel = api.view(game, 0);
  assert(intel.visibleIds.includes(enemy.id));
  assert(!intel.detectedIds.includes(enemy.id));
  assert.deepEqual(intel.radarContacts, []);
  assert.equal(intel.visibleCells.length, 144);

  enemy.x = 4;
  intel = api.view(game, 0);
  assert(intel.visibleIds.includes(enemy.id));
  assert(intel.detectedIds.includes(enemy.id));
  assert.deepEqual(intel.radarContacts, [{ x: 4, y: 1 }]);

  enemy.x = 9;
  game.fogMode = "disabled";
  intel = api.view(game, 0);
  assert(intel.visibleIds.includes(enemy.id));
  assert(intel.detectedIds.includes(enemy.id));
  assert.deepEqual(intel.radarContacts, [{ x: 9, y: 1 }]);
});

test("room fog defaults to full, validates values and synchronizes into match settings", (t) => {
  assert.equal(G.defaultRoomSettings().fogMode, "full");
  assert.equal(G.validateFogMode("visible"), "visible");
  assert.throws(() => G.validateFogMode("invalid"));

  let frame;
  const ws = { readyState: 1 };
  const engine = createRoomEngine({
    rules: G,
    randomId: () => "id",
    randomSeed: () => 1,
    randomToken: () => "token",
    send: (_ws, message) => {
      frame = message;
    },
  });
  t.after(() => engine.close());
  engine.join(ws, { mode: "create", room: "FOGMODE", name: "Host", characterFaction: "PMC" });
  const room = engine.rooms.get("FOGMODE");
  engine.action(ws, {
    type: "action",
    action: "configure_room",
    id: "set-visible",
    revision: room.revision,
    ...G.defaultRoomSettings(),
    fogMode: "visible",
  });
  assert.equal(frame.type, "state");
  assert.equal(room.settings.fogMode, "visible");
  assert.equal(frame.settings.fogMode, "visible");

  assert.throws(() =>
    engine.action(ws, {
      type: "action",
      action: "configure_room",
      id: "set-invalid",
      revision: room.revision,
      ...room.settings,
      fogMode: "invalid",
    }),
  );
  assert.equal(room.settings.fogMode, "visible");
});
