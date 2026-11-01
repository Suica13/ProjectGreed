const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../shared/campaign.js");
const ctx = {
  G: require("../shared/rules.js"),
  world: require("../assets/maps/strategy/earth_0079_mid/world.json"),
  production: require("../shared/production-data.cjs"),
  development: require("../shared/development.js"),
};
const members = [0, 1, 2, 3].map((seat) => ({ seat }));
const invest = (state, seat = 0) =>
  C.action(ctx, state, members, seat, { action: "campaign_intelligence", turn: state.turn });

test("intelligence uses a shared once-per-team-turn budget and decays once per strategic settlement", () => {
  const s = C.create(ctx, members);
  assert.equal(s.teams[0].intelligence.progress, 50);
  const money = s.teams[0].money;
  invest(s);
  assert.equal(s.teams[0].money, money - 2000);
  assert.equal(s.teams[0].intelligence.progress, 80);
  const before = structuredClone(s);
  assert.throws(() => invest(s, 2), /本回合已投入/);
  assert.deepEqual(s, before);
  invest(s, 1);
  C.advance(ctx, s, members);
  assert.equal(s.teams[0].intelligence.progress, 65);
  assert.equal(s.teams[1].intelligence.progress, 65);
  invest(s, 2);
  assert.equal(s.teams[0].intelligence.progress, 95);
  s.turn++;
  invest(s);
  assert.equal(s.teams[0].intelligence.progress, 100);
  s.turn++;
  assert.throws(() => invest(s), /进度已满/);
  s.teams[1].intelligence = { progress: 0, fundedTurn: 0 };
  C.advance(ctx, s, members);
  assert.equal(s.teams[1].intelligence.progress, 0);
});

test("insufficient funds, spectators, stale turns and non-strategy phases cannot fund intelligence", () => {
  const s = C.create(ctx, members);
  s.teams[0].money = 1999;
  const before = structuredClone(s);
  assert.throws(() => invest(s), /资金不足/);
  assert.deepEqual(s, before);
  assert.throws(() => invest(s, null), /观战者/);
  assert.throws(
    () => C.action(ctx, s, members, 0, { action: "campaign_intelligence", turn: 0 }),
    /回合已变化/,
  );
  s.phase = "encounters";
  assert.throws(() => invest(s), /指令阶段/);
});

function reports(progress) {
  const s = C.create(ctx, members);
  s.units = [];
  s.teams[0].intelligence.progress = progress;
  const own = C.addUnit(ctx, s, 0, "jaburo", "Type61");
  own.moveTo = "andes";
  for (let i = 0; i < 20; i++) {
    const enemy = C.addUnit(ctx, s, 1, "odessa", "MS_06F");
    enemy.moveTo = "europe";
    enemy.state = { hp: 1234, en: 56, pilot: { name: "Secret pilot" } };
  }
  s.history = [
    "战略第1回合 · 队伍1 · A：己方调动",
    "战略第1回合 · 队伍2 · B：敌军秘密",
    "战略第1回合：生产、收入与调动已结算",
  ];
  return s;
}

test("server reports enforce all four intelligence tiers without transmitting hidden identities or status", () => {
  for (const progress of [0, 24, 25, 49, 50, 74, 75, 99, 100]) {
    const s = reports(progress),
      before = structuredClone(s),
      view = C.view(s, 0);
    const count = view.intelRegions.find((region) => region.id === "odessa").counts[1];
    const enemies = view.units.filter((unit) => unit.team === 1);
    assert.deepEqual(C.view(s, 0), view, "reports must not reroll on refresh");
    assert.deepEqual(s, before, "view filtering must not mutate saved state");
    assert(!view.history.some((line) => line.includes("敌军秘密")));
    assert.equal(view.units.find((unit) => unit.team === 0).unitId, "Type61");
    if (progress < 25) assert.equal(count, null);
    else if (progress < 75) {
      const error = progress < 50 ? 0.5 : 0.25;
      assert(count >= 20 * (1 - error) && count <= 20 * (1 + error));
    } else assert.equal(count, 20);
    if (progress < 75) assert.equal(enemies.length, 0);
    else {
      assert.equal(enemies.length, 20);
      assert.equal(enemies[0].unitId, "MS_06F");
      if (progress < 100) {
        for (const key of ["hp", "en", "pilotId", "pilotName", "state"])
          assert(!Object.hasOwn(enemies[0], key));
      } else {
        assert.equal(enemies[0].hp, 1234);
        assert.equal(enemies[0].en, 56);
        assert.equal(enemies[0].pilotName, "Secret pilot");
      }
    }
  }
});

test("movement details follow intelligence tiers; friendly reports and omniscient observers remain exact", () => {
  for (const progress of [0, 25, 50, 75, 100]) {
    const s = reports(progress),
      view = C.view(s, 0);
    assert.equal(view.movements.find((move) => move.team === 0).unitIds.length, 1);
    const enemy = view.movements.find((move) => move.team === 1);
    if (progress < 25) assert.equal(enemy, undefined);
    else assert.equal(enemy.unitIds.length, progress < 75 ? 0 : 20);
    const global = C.view(s);
    assert.equal(global.units.length, 21);
    assert.equal(global.movements[1].count, 20);
    assert.equal(global.movements[1].unitIds.length, 20);
    s.units[1].region = "jaburo";
    assert.equal(C.disputed(C.view(s, 0), "jaburo"), true);
  }
});

test("campaign archives retain intelligence and safely initialize legacy archives", () => {
  const s = C.create(ctx, members);
  invest(s);
  assert.deepEqual(C.validate(ctx, s, members).teams[0].intelligence, {
    progress: 80,
    fundedTurn: 1,
  });
  s.teams[0].intelligence.progress = 101;
  assert.throws(() => C.validate(ctx, s, members), /情报数据无效/);
  s.teams[0].intelligence = { progress: 50, fundedTurn: 2 };
  assert.throws(() => C.validate(ctx, s, members), /情报数据无效/);
  for (const pool of s.teams) delete pool.intelligence;
  s.intelRegions = [{ id: "jaburo", contested: true }];
  s.movements = [{ count: 999 }];
  s.intel = { progress: 100 };
  const imported = C.validate(ctx, s, members);
  for (const field of ["intelRegions", "movements", "intel"])
    assert(!Object.hasOwn(imported, field));
  assert.deepEqual(C.validate(ctx, s, members).teams[0].intelligence, {
    progress: 50,
    fundedTurn: 0,
  });
});
