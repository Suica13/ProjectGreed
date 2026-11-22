const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules");
const C = require("../shared/contract-mode");
const H = require("../shared/hangars");
const entry = model => ({unitId: model.prefabId, kitId: model.kitId});
const mas = Object.values(G.models).filter(m => m.unitTags?.includes("MA") && !m.formOnly);

test("MA deploys independently and shares the authoritative fleet limit with ships", () => {
  assert(mas.length > 0);
  for (const model of mas) {
    assert(G.isFleetCarrier(model), model.id);
    if (model.requiredPilotId) continue;
    const plan = G.planFormation([entry(model)], Infinity, {requiresCarriers: true, fleetLimit: 1});
    assert.deepEqual(plan.disabled, [], model.prefabId);
  }
  const ma = mas.find(m => !m.requiredPilotId);
  const ship = G.models.PegasusClass__standard;
  const plan = G.planFormation([entry(ship), entry(ma)], Infinity, {requiresCarriers: true, fleetLimit: 1});
  assert.equal(plan.reasons[1], "count");
  assert.equal(plan.deployable.length, 1);
  const free = G.planFormation([entry(ma)], Infinity, {});
  assert.deepEqual(free.disabled, []);
});

test("MA cannot preload, board or transfer into any hangar, including SFS", () => {
  const carriers = Object.values(G.models).filter(m => m.hangars?.length);
  for (const ma of mas) {
    for (const carrier of carriers) {
      for (const hangar of carrier.hangars) assert.equal(H.allowsModel(hangar, ma), false);
    }
  }
  const ma = mas.find(m => !m.requiredPilotId);
  const carrierModel = G.models.PegasusClass__standard;
  const hangar = carrierModel.hangars[0];
  assert.throws(() => G.validateFormation([
    entry(carrierModel), {...entry(ma), preload: {carrierIndex: 0, hangarId: hangar.id}},
  ], Infinity, 36, false, true), /不能预先搭载/);
  // Even a large, MA-tag-compatible custom hangar cannot bypass the shared rule.
  const roomy = {id: "roomy", capacity: 1000, allowedTags: ma.transport.loadTags};
  const models = {ma, carrier: {...carrierModel, hangars: [roomy]}};
  const h = H.create({modelOf: u => models[u.model], ownerOf: u => u.team,
    cells: u => [{x:u.x,y:u.y}], fits: () => true});
  const carrier = {id: "c", model: "carrier", hp: 100, team: 0, x: 1, y: 1};
  const unit = {id: "m", model: "ma", hp: 100, team: 0, x: 0, y: 1};
  const game = {units: [carrier, unit], winner: null, team: 0};
  const before = structuredClone(game);
  assert.equal(h.canLoad(game, unit, carrier, roomy.id), false);
  assert.deepEqual(game, before);
  unit.embarked = {carrierId: "old", hangarId: "old"};
  assert.equal(h.canTransfer(game, unit, carrier, roomy.id), false);
  assert.equal(H.allowsModel(hangar, G.models.RGM_79__machine_gun), true);
});

test("contract entry pads occupy opposite edges and extraction uses the other edges", () => {
  const sideOf = (area, map) => area.x === 0 ? 0 : area.x + area.width === map.width ? 1 : area.y === 0 ? 2 : 3;
  for (const environment of ["ground", "space"]) for (let difficulty = 1; difficulty <= 6; difficulty++) {
    for (let seed = 1; seed <= 20; seed++) {
      const map = C.generateMap(G.catalog, {sweepDifficulty: difficulty, sweepEnvironment: environment}, seed);
      const {entries, extractions} = map.contractLayout;
      assert.equal(sideOf(entries[1], map), sideOf(entries[0], map) ^ 1);
      const sides = [...entries, ...extractions].map(area => sideOf(area, map));
      assert.equal(new Set(sides).size, 4);
      for (const a of entries) for (const b of extractions) {
        assert(a.x + a.width + 2 <= b.x || b.x + b.width + 2 <= a.x ||
          a.y + a.height + 2 <= b.y || b.y + b.height + 2 <= a.y);
      }
    }
  }
});
