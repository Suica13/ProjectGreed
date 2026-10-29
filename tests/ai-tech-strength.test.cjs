const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const D = require("../shared/development.js");
const modelOf = (e) => G.models[e.unitId + "__" + e.kitId];
const cost = (army) => army.reduce((sum, e) => sum + modelOf(e).cost, 0);

test("bots use the supplied room progression while all room restrictions survive", () => {
  for (const faction of ["EFSF", "ZEON", "PMC"]) {
    const settings = { ...G.defaultRoomSettings(), unitCostLimit: 1000 };
    const player = { seat: 0, characterFaction: faction, researched: {} };
    const human = G.armyRestrictions(settings, player);
    const bot = G.armyRestrictions(settings, { ...player, bot: true, researched: D.aiResearch([{ EFSF: D.nodes("EFSF").map(n=>n.id) }]) });
    const advanced = Object.values(G.models).filter(
      (m) =>
        !m.formOnly &&
        !m.wip &&
        G.restrictionReason(m, human) === "not_developed" &&
        !G.restrictionReason(m, bot),
    );
    assert(advanced.length > 20, faction);
    assert.equal(human.researched, player.researched);
    const blocked = G.armyRestrictions(
      { ...settings, bannedTypes: ["MS"], bannedEras: ["0083"] },
      { ...player, bot: true, researched: D.aiResearch([{ EFSF: D.nodes("EFSF").map(n=>n.id) }]) },
    );
    for (const m of advanced) {
      if (m.unitTags.includes("MS") || m.tags.includes("0083"))
        assert(G.restrictionReason(m, blocked));
    }
    assert.equal(G.restrictionReason(advanced[0], { ...bot, unitCostLimit: 1 }), "cost");
  }
});

test("a mixed one-point/two-point pool spends its budget without mistaking MS for one point", () => {
  const saved = { ...G.models },
    base = G.models.Type61__standard;
  for (const key of Object.keys(G.models)) delete G.models[key];
  for (const [id, ms] of [
    ["tank", false],
    ["combat-a", true],
    ["combat-b", true],
    ["combat-c", true],
  ]) {
    G.models[id + "__standard"] = {
      ...base,
      prefabId: id,
      kitId: "standard",
      ship: false,
      cost: ms ? 150 : 75,
      unitTags: ms ? ["MS"] : ["Tank"],
      skills: [],
      supplyAura: null,
      commandAuras: [],
    };
  }
  try {
    for (let seed = 1; seed <= 30; seed++) {
      const army = G.randomFormation(seed, 900, {}, 12);
      assert.equal(G.formationPoints(army), 12);
      assert.equal(cost(army), 900);
      assert(army.filter((e) => modelOf(e).unitTags.includes("MS")).length >= 3);
      assert.deepEqual(army, G.randomFormation(seed, 900, {}, 12));
    }
  } finally {
    for (const key of Object.keys(G.models)) delete G.models[key];
    Object.assign(G.models, saved);
  }
});

test("default 900/250/12 bot rosters use advanced units and most available COST on ground and in space", () => {
  for (const faction of ["EFSF", "ZEON", "PMC"])
    for (const mapId of ["frontier_1v1", "asteroid_crossing_1v1"])
      for (const seed of [1, 42, 7319, 0x9e3779b9]) {
        const settings = {
          ...G.defaultRoomSettings(),
          mapId,
          costLimit: 900,
          unitCostLimit: 250,
          unitLimit: 12,
        };
        const restrictions = G.armyRestrictions(settings, {
          bot: true,
          researched: D.aiResearch([{ EFSF: D.nodes("EFSF").map(n=>n.id) }]),
          seat: 1,
          characterFaction: faction,
        });
        const army = G.randomFormation(seed, 900, restrictions, 12);
        assert(cost(army) >= 775, `${faction}/${mapId}/${seed}: ${cost(army)}`);
        assert(cost(army) <= 900);
        assert(G.formationPoints(army) <= 12);
        assert(
          army.some((e) => !D.allows(faction, e.unitId, {})),
          JSON.stringify(army),
        );
        assert(army.every((e) => !G.restrictionReason(modelOf(e), restrictions)));
        assert.equal(G.planFormation(army, 900, restrictions, 12).disabled.length, 0);
        const support = army
          .map(modelOf)
          .filter(
            (m) =>
              m.supplyAura ||
              m.unitTags.includes("Support") ||
              m.skills.some((s) => ["repair", "resupply"].includes(s.type)),
          ).length;
        assert(support * 4 <= army.length);
      }
});


test("room research unions players and mirrors main-line columns including side branches", () => {
  const ef = D.nodes("EFSF"), ze = D.nodes("ZEON");
  const research = { EFSF: ef.filter(n=>n.row==="mid" && n.page===0 && n.column<=3).map(n=>n.id) };
  const original=JSON.stringify(research);
  const result = D.aiResearch([research,research,{units:{ZEON:["MS_06F"]}}]);
  for (const [f,nodes] of [["EFSF",ef],["ZEON",ze]]) {
    for (const n of nodes) assert.equal(result[f].includes(n.id), n.page===0 && n.column<=3, n.id);
    assert.equal(new Set(result[f]).size,result[f].length);
  }
  assert.equal(JSON.stringify(research),original);
  const late=D.aiResearch([{EFSF:ef.filter(n=>n.row==="mid" && (n.page===0 || n.column<=2)).map(n=>n.id)}]);
  for(const [f,nodes] of [["EFSF",ef],["ZEON",ze]])
    for(const n of nodes) assert.equal(late[f].includes(n.id),n.page===0 || n.column<=2,n.id);
  const side=D.aiResearch([{EFSF:[...research.EFSF,"Tech_EFSF_0079_BlueDestinyProject","Tech_EFSF_0079_PaleRiderProject"]}]);
  assert(side.EFSF.includes("Tech_EFSF_0079_PaleRiderProject"));
  assert(!side.ZEON.includes("Tech_ZEON_0079_PezunProject"));
  for(const f of ["EFSF","ZEON"]) assert.equal(D.aiResearch([])[f].length,1);
});
