const test=require("node:test"),assert=require("node:assert/strict"),G=require("../shared/rules");
function fixture(count = 7) {
  const entry = { unitId: "RGM_79", kitId: "machine_gun" };
  const game = G.create(false, 1, [[entry], [entry]], false, { fogMode: "disabled" });
  game.tiles.forEach((row) => row.fill("plain"));
  const source = game.units[0],
    enemy = game.units[1];
  const allies = Array.from({ length: count }, (_, i) => ({
    ...structuredClone(source),
    id: "squad-test-" + i,
    x: 5 + (i % 4),
    y: 5 + Math.floor(i / 4),
    hp: 100000,
    en: 10000,
    shield: 0,
    moved: false,
    acted: false,
    actionPoints: 0,
  }));
  Object.assign(enemy, { x: 6, y: 8, hp: 100000, en: 10000, shield: 0 });
  game.units = [...allies, enemy];
  return { game, allies, enemy };
}
function stack(game, units, x = 5, y = 5, id = "test-squad") {
  units.forEach((unit, index) => Object.assign(unit, { x, y, squadId: id, squadSlot: index }));
}

for (const sharedId of [false, true])
  test(`two-unit squad merges into a single unit through preview and confirmation (shared ID: ${sharedId})`, () => {
    const {game,allies} = fixture(3);
    stack(game,allies.slice(0,2));
    Object.assign(allies[2],{x:6,y:5,...(sharedId?{squadId:"test-squad",squadSlot:2}:{})});
    const before=structuredClone(game), route=G.reachable(game,allies[0]).get(G.key(6,5));
    assert.equal(route?.squadTarget,allies[2].id);
    assert.deepEqual(game,before,"range queries must not mutate squad state");
    G.previewMove(game,allies[0],6,5);
    G.cancelMove(game,allies[0]);
    assert.deepEqual(game,before,"cancel preserves both separated groups");
    G.previewMove(game,allies[1],6,5);
    G.confirmMove(game,allies[1]);
    assert.equal(G.squadMembers(game,allies[2]).length,3);
    assert.equal(new Set(allies.map(u=>u.squadSlot)).size,3);
    assert(allies.every(u=>u.x===6&&u.y===5&&!u.pendingMove));
  });

test("a historical shared ID cannot bypass destination capacity or controller checks",()=>{
  const {game,allies}=fixture(7);
  stack(game,allies.slice(0,2));
  stack(game,allies.slice(2),6,5);
  const before=structuredClone(game);
  assert.equal(G.reachable(game,allies[0]).has(G.key(6,5)),false);
  assert.equal(G.reachable(game,allies[0],null,true).get(G.key(6,5))?.squadTarget,allies[2].id);
  assert.throws(()=>G.move(game,allies[0],6,5));
  assert.deepEqual(game,before);
  allies[2].ownerSeat=allies[3].ownerSeat=2;
  assert.equal(G.reachable(game,allies[0],null,true).has(G.key(6,5)),false);
});

