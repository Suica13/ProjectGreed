const test = require("node:test"),
  assert = require("node:assert/strict"),
  G = require("../shared/rules");
function fixture() {
  const entry = (id) => {
    const m = Object.values(G.models).find((m) => m.prefabId === id && !m.formOnly);
    return { unitId: id, kitId: m.kitId };
  };
  const game = G.create(
    false,
    1,
    [[entry("PegasusClass"), entry("RGM_79")], [entry("MS_06F")]],
    false,
    { costLimit: 99999, unitCostLimit: 99999 },
  );
  game.tiles.forEach((r) => r.fill("plain"));
  const carrier = game.units.find((u) => u.ownerSeat === 0 && G.modelOf(u).hangars.length),
    passenger = game.units.find((u) => u.ownerSeat === 0 && u !== carrier),
    enemy = game.units.find((u) => u.ownerSeat === 1);
  Object.assign(carrier, { x: 12, y: 10 });
  Object.assign(passenger, { x: 11, y: 10 });
  Object.assign(enemy, { x: 35, y: 22 });
  return { game, carrier, passenger, hangar: G.hangars.of(carrier)[0] };
}
test("AI can use human hangars for recovery but never as a healthy ride", () => {
  const { game, carrier, passenger } = fixture();
  assert(G.hangars.recoveryOrder(game, passenger, () => true));
  assert.equal(
    G.hangars.recoveryOrder(game, passenger, () => false),
    null,
  );
  passenger.hp = Math.floor(G.modelOf(passenger).hp * 0.2);
  assert(G.hangars.recoveryOrder(game, passenger, () => false));
  assert(!G.aiChoice(game, passenger)?.boarding);
});
for (const emergency of [false, true])
  test("waterborne hangar exits cannot land or cross land: " + emergency, () => {
    const { game, carrier, passenger, hangar } = fixture();
    G.hangars.embark(game, passenger, carrier, hangar.id);
    game.round++;
    passenger.acted = false;
    passenger.moved = false;
    game.tiles.forEach((row) => row.fill("water"));
    for (let y = 0; y < game.tiles.length; y++)
      for (let x = 0; x < 11; x++) game.tiles[y][x] = "plain";
    const destinations = G.hangars.launchCells(game, passenger, emergency);
    assert(destinations.length > 0);
    assert(
      destinations.every((p) =>
        G.cells(passenger, p.x, p.y).every((c) => game.tiles[c.y][c.x] === "water"),
      ),
    );
    assert(
      destinations.every((p) => (p.path || []).every((c) => game.tiles[c.y][c.x] === "water")),
    );
    if (!emergency) assert.throws(() => G.hangars.launch(game, passenger, 10, 10), /出击/);
  });
