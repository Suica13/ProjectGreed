const test = require("node:test"),
  assert = require("node:assert/strict"),
  G = require("../shared/rules"),
  B = G.battlefieldMode,
  { createRoomEngine } = require("../shared/room-engine");
const entry = { unitId: "Type61", kitId: "standard" };
function battle() {
  const armies = Array(12).fill(null);
  armies[2] = [entry];
  return G.create(false, 7319, armies, false, {
    mode: "battlefield",
    mapId: B.defaultMapId,
    battlefieldTeams: [
      { faction: "EFSF", era: "0079T1" },
      { faction: "ZEON", era: "0079T1" },
    ],
  });
}
function roomFixture(t, { mode = "battlefield", rules = G } = {}) {
  let serial = 0;
  const messages = [],
    engine = createRoomEngine({
      rules,
      randomId: () => `life-${++serial}`,
      randomToken: () => `token-${++serial}`,
      randomSeed: () => 7319,
      aiDelayMs: 999999,
      send: (ws, m) => messages.push(m),
    });
  t.after(() => engine.close());
  const ws = { readyState: 1 };
  engine.join(ws, {
    mode: "create",
    room: "LIFECYCLE",
    roomMode: mode,
    characterFaction: "PMC",
    licenses: { Type61: true },
    inventory: { Type61: 5 },
    kits: {},
  });
  const room = engine.rooms.get("LIFECYCLE");
  const act = (action, fields = {}) =>
    engine.action(ws, {
      id: `action-${++serial}`,
      revision: room.revision,
      round: room.game.round,
      matchId: room.matchId,
      phase: room.phase,
      action,
      ...fields,
    });
  if (mode !== "battlefield") act("add_ai", { seat: 1 });
  else
    act("configure_room", {
      ...room.settings,
      battleMode: "battlefield",
      battlefieldTeams: [
        { faction: "EFSF", era: "0079T1" },
        { faction: "ZEON", era: "0079T1" },
      ],
    });
  act("start_game", { formation: [entry] });
  act("confirm_formation");
  act("confirm_deployment");
  return { engine, room, act, messages };
}
test("all non-base facilities restore full status exactly ten rounds later and their cells stay blocked", () => {
  const game = battle(),
    actor = game.units.find((u) => u.ownerSeat === 2);
  game.tiles.forEach((row) => row.fill("plain"));
  const towers = game.units.filter((u) => u.facility && u.facility.type !== "base");
  for (const u of towers) {
    u.hp = 0;
    u.en = 0;
    u.burning = { rounds: 3 };
    u.brokenParts = { head: true };
  }
  B.sync(G, game);
  const due = game.round + 10;
  for (const u of towers) {
    assert.equal(u.facility.rebuildRound, due);
    assert.equal(G.fits(game, actor, u.x, u.y, 0, true), false);
  }
  game.round = due - 1;
  B.rebuildFacilities(G, game);
  assert(towers.every((u) => game.units.find((v) => v.id === u.id).hp === 0));
  game.round = due;
  B.rebuildFacilities(G, game);
  for (const original of towers) {
    const u = game.units.find((v) => v.id === original.id),
      m = G.modelOf(u);
    assert.equal(u.hp, m.hp);
    assert.equal(u.en, m.en);
    assert(!u.burning);
    assert(!Object.values(u.brokenParts || {}).some(Boolean));
    assert.equal(u.facility.cycle, 1);
    assert.equal(G.fits(game, actor, u.x, u.y, 0, true), false);
  }
  assert.equal(G.models.Facility_Radar__standard.hp, 7500);
});
test("site control is square at radius two, enlarged at bases, and structures cannot be entered", () => {
  const game = battle(),
    actor = game.units.find((u) => u.ownerSeat === 2);
  game.tiles.forEach((row) => row.fill("plain"));
  for (const p of game.battlefield.points) {
    assert(B.containsSite({ id: "point:" + p.id, ...p }, p.x + 2, p.y + 2));
    assert(!B.containsSite({ id: "point:" + p.id, ...p }, p.x + 3, p.y));
    assert(!G.fits(game, actor, p.x, p.y, 0, true));
  }
  const base = game.units.find((u) => u.facility?.type === "base");
  assert.equal(G.cells(base).length, 9);
  for (const p of G.cells(base)) assert(!G.fits(game, actor, p.x, p.y, 0, true));
  const site = B.deploymentSites(G, game, 0).find((s) => s.id.startsWith("base:"));
  assert(B.containsSite(site, site.x + 4, site.y));
  assert(!B.containsSite(site, site.x + 5, site.y));
});
test("regular losses debit stock during combat once; disconnect does not charge survivors and final result does not double debit", (t) => {
  const { engine, room, messages } = roomFixture(t, { mode: "regular" }),
    player = room.seats[0],
    u = room.game.units.find((u) => G.ownerOf(u) === 0);
  assert.equal(player.inventory.Type61, 5);
  u.hp = 0;
  engine.broadcast(room);
  assert.equal(player.inventory.Type61, 4);
  engine.broadcast(room);
  assert.equal(player.inventory.Type61, 4);
  assert.equal(
    room.economyAwards.filter((a) => a.kind === "loss" && a.memberId === player.id).length,
    1,
  );
  room.game.winner = 1;
  room.phase = "finished";
  engine.broadcast(room);
  assert.equal(player.inventory.Type61, 4);
  assert.equal(
    room.economyAwards.find((a) => a.kind === "result" && a.memberId === player.id).losses.Type61,
    1,
  );
});
test("quick battle casualties remain free", (t) => {
  const { engine, room } = roomFixture(t, { mode: "quick" });
  room.game.units.find((u) => G.ownerOf(u) === 0).hp = 0;
  engine.broadcast(room);
  assert.equal(room.seats[0].inventory.Type61, 5);
  assert(!room.economyAwards.some((a) => a.kind === "loss"));
});
test("battlefield loss results include every repeated sortie and an ACE can return with remaining chassis", (t) => {
  const { engine, room } = roomFixture(t),
    player = room.seats[2],
    reserve = room.game.battlefield.reserves[0],
    original = room.game.units.find((u) => G.ownerOf(u) === 2);
  const ace = G.pilots.createAce(G.pilots.catalog.aces[0].id);
  reserve.template.pilot = ace;
  original.pilot = structuredClone(ace);
  original.hp = 0;
  engine.broadcast(room);
  assert.equal(reserve.stockRemaining, 4);
  room.game.round = reserve.readyRound;
  const site = B.deploymentSites(G, room.game, 0)[0];
  B.requestDeployment(G, room.game, 2, reserve.id, site.id);
  room.game.round++;
  B.advance(G, room.game);
  let revived = room.game.units.find((u) => G.ownerOf(u) === 2 && u.hp > 0);
  assert(revived);
  assert.equal(revived.pilot.needsRecruitment, false);
  revived.hp = 0;
  engine.broadcast(room);
  assert.equal(reserve.losses, 2);
  assert.equal(reserve.stockRemaining, 3);
  assert.equal(room.pilotAwards.length, 0);
  room.game.units.find((u) => u.team === 1 && u.facility?.type === "base").hp = 0;
  room.phase = "idle";
  engine.broadcast(room);
  const result = room.economyAwards.find((a) => a.kind === "result" && a.memberId === player.id);
  assert.equal(result.losses.Type61, 2);
  assert.equal(result.lostUnits.length, 2);
  assert(result.lostUnits.every((r) => r.model === "Type61__standard"));
});
test("facility kills pay level rewards again after rebuilding; base HP rewards accumulate real player damage without overkill", (t) => {
  let target,
    amount = 0;
  const rules = {
    ...G,
    unitSkills: (u) => [...G.unitSkills(u), { id: "LifecycleDamage", type: "irradiation" }],
    useSkill(game, u) {
      const before = target.hp,
        after = Math.max(0, before - amount);
      target.hp = after;
      return {
        type: "skill",
        skillId: "LifecycleDamage",
        unitId: u.id,
        resultId: u.id,
        irradiation: true,
        evacuations: [],
        hits: [{ unitId: target.id, before, after, damage: amount }],
      };
    },
  };
  const { engine, room, act } = roomFixture(t, { rules }),
    source = room.game.units.find((u) => G.ownerOf(u) === 2);
  const fire = () => {
    room.phase = "idle";
    room.playback = null;
    act("skill", { unitId: source.id, skillId: "LifecycleDamage" });
  };
  target = room.game.units.find((u) => u.team === 1 && u.facility?.type === "machineGun");
  amount = target.hp;
  fire();
  let awards = room.economyAwards.filter((a) => a.kind === "kill");
  assert.deepEqual([awards[0].money, awards[0].supplies], [400, 800]);
  room.game.round = target.facility.rebuildRound;
  B.rebuildFacilities(G, room.game);
  target = room.game.units.find((u) => u.id === target.id);
  amount = target.hp;
  fire();
  assert.equal(room.economyAwards.filter((a) => a.kind === "kill").length, 2);
  target = room.game.units.find((u) => u.team === 1 && u.facility?.type === "base");
  const maximum = G.modelOf(target).hp;
  amount = maximum * 0.06;
  fire();
  assert.equal(room.economyAwards.filter((a) => a.kind === "base_damage").length, 0);
  amount = maximum * 0.04;
  fire();
  let base = room.economyAwards.filter((a) => a.kind === "base_damage");
  assert.deepEqual([base[0].money, base[0].supplies], [500, 1000]);
  engine.broadcast(room);
  assert.equal(room.economyAwards.filter((a) => a.kind === "base_damage").length, 1);
  amount = maximum * 100;
  fire();
  base = room.economyAwards.filter((a) => a.kind === "base_damage");
  assert.equal(
    base.reduce((sum, a) => sum + a.steps, 0),
    10,
  );
  assert.equal(
    base.reduce((sum, a) => sum + a.money, 0),
    5000,
  );
  for (let i = 0; i < 4; i++)
    assert.deepEqual(B.baseDamageReward({ battlefieldTeams: [{ era: B.eras[i] }] }, 0), {
      money: 500 + 250 * i,
      supplies: 1000 + 500 * i,
    });
});
