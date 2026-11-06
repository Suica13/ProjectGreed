const test = require("node:test"),
  assert = require("node:assert/strict");
const C = require("../shared/campaign"),
  G = require("../shared/rules"),
  D = require("../shared/development");
const ctx = {
  G,
  world: G.catalog.scenarios.earth_0079_mid.world,
  production: require("../shared/production-data.cjs"),
  development: D,
};
const members = [{ seat: 0 }, { seat: 1 }];
test("strategic research keeps cumulative full points and completes in one turn", () => {
  const s = C.create(ctx, members);
  s.units = [];
  const tech = D.nodes("EFSF").find(
    (n) =>
      !s.teams[0].researched.includes(n.id) &&
      n.requires.every((id) => s.teams[0].researched.includes(id)),
  );
  const original = structuredClone(tech),
    points = C.researchPoints(ctx, tech);
  assert.equal(points, tech.points);
  s.teams[0].technology = points;
  C.action(ctx, s, members, 0, { action: "campaign_research", turn: s.turn, techId: tech.id });
  assert.equal(s.teams[0].technology, points);
  assert.equal(s.teams[0].researchQueue[0].remaining, 1);
  assert.deepEqual(tech, original, "ordinary research data remains unchanged");
  C.advance(ctx, s, members);
  assert(s.teams[0].researched.includes(tech.id));
  const low = C.create(ctx, members);
  low.teams[0].technology = points - 1;
  const before = structuredClone(low);
  assert.throws(
    () => C.action(ctx, low, members, 0, { action: "campaign_research", turn: 1, techId: tech.id }),
    /资源不足/,
  );
  assert.deepEqual(low, before, "failed research cannot spend other resources");
});
test("strategic AI prioritizes mainline and reserves points instead of draining them into branches", () => {
  // Deliberately place the cheap branch before the mainline in catalog order.
  const nodes = [
    { id: "base", points: 0, row: "mid", page: 0, column: 0, requires: [] },
    { id: "branch", points: 100, row: "top", page: 0, column: 1, requires: ["base"] },
    { id: "main", points: 1200, row: "mid", page: 0, column: 1, requires: ["base"] },
  ];
  for (const [points, expected] of [
    [500, []],
    [1200, ["main", "branch"]],
    [1300, ["main", "branch"]],
  ]) {
    const s = C.create(ctx, members);
    s.units = [];
    s.options.difficulty = "hard";
    Object.assign(s.teams[0], { researched: ["base"], researchQueue: [], technology: points });
    const local = { ...ctx, development: { nodes: () => nodes } },
      chosen = [];
    G.aiTactics.strategic(local, s, [{ seat: 0, bot: true }, { seat: 1 }], {
      researchPoints: C.researchPoints,
      startResearch: (c, state, team, node) => {
        chosen.push(node.id);
        C.startResearch(c, state, team, node);
      },
      available: () => false,
      busy: () => false,
      disputed: () => false,
      controller: (_, u) => u.ownerSeat,
      quote: () => null,
    });
    assert.deepEqual(chosen, expected);
  }
});
const {createLocalizer}=require('../tools/display-localization.cjs');
test('curated weapon names retain grades and preserve administrator labels',()=>{
 const localizer=createLocalizer();
 const prefab={id:'test',weapons:{TITANS_RX_121_BodyMS:{name:'TITANS RX 121 BodyMS Lv.2',level:2,damagePerShot:1000},
 EF_170mmCannon:{name:'管理员名称',level:1,damagePerShot:250,localization:{en:{name:'Custom cannon'},ja:{name:'専用砲'}}}}};
 localizer.prefab(prefab);
 assert.equal(prefab.weapons.TITANS_RX_121_BodyMS.name,'内藏导弹发射器（右） Lv.2');
 assert.equal(prefab.weapons.TITANS_RX_121_BodyMS.localization.en.name,'Internal Missile Launcher (Right) Lv.2');
 assert.equal(prefab.weapons.TITANS_RX_121_BodyMS.damagePerShot,1000);
 assert.equal(prefab.weapons.EF_170mmCannon.name,'管理员名称');
 assert.equal(prefab.weapons.EF_170mmCannon.localization.en.name,'Custom cannon');
});
