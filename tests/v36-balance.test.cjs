const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
test("all bazookas cost 3 AP and all ship AA uses half the saved native firing count", () => {
  let bazookas = 0,
    aa = 0;
  for (const id of fs.readdirSync("assets/units")) {
    const file = path.join("assets/units", id, "unit.json");
    if (!fs.existsSync(file)) continue;
    const unit = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const [key, w] of Object.entries(unit.weapons)) {
      if (w.category === "bazooka") {
        assert.equal(w.actionCost, 3, id + ":" + key);
        bazookas++;
      }
      if (unit.stats.ship && w.rangeRole === "ship_anti_air") {
        assert.equal(w.actionCost, 2, id + ":" + key);
        const count = (steps) => {
          const mounts = new Map();
          for (const s of steps) {
            const id = s.muzzleIndex ?? 0;
            mounts.set(id, (mounts.get(id) || 0) + (s.shots || 0) * (s.repeat ?? 1));
          }
          return mounts;
        };
        const baseline = count(w.shipAntiAirBeforeReduction),
          actual = count(w.attack.steps);
        for (const [mount, n] of baseline)
          assert.equal(actual.get(mount), Math.ceil(n / 2), id + ":" + key + ":" + mount);
        aa++;
      }
    }
  }
  assert(bazookas > 0);
  assert(aa > 0);
});

test("all ship weapons apply the 10 percent base accuracy reduction", () => {
  let checked = 0;
  for (const id of fs.readdirSync("assets/units")) {
    const file = path.join("assets/units", id, "unit.json");
    if (!fs.existsSync(file)) continue;
    const unit = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!unit.stats.ship) continue;
    for (const [key, weapon] of Object.entries(unit.weapons)) {
      assert.equal(weapon.shipAccuracyMultiplier, 0.9, id + ":" + key);
      assert(Math.abs(weapon.hit - weapon.shipHitBeforeReduction * 0.9) < 0.000001, id + ":" + key);
      checked++;
    }
  }
  assert(checked > 0, "The catalog must contain ship weapons to audit");
});

test("ship accuracy policy is idempotent and recalculates restored native data", () => {
  const { spawnSync } = require("node:child_process");
  const result = spawnSync(
    "python",
    [
      "-c",
      [
        "import sys;sys.path.insert(0,'tools')",
        "from unit_ship_balance import apply_accuracy",
        "p={'stats':{'ship':True},'weapons':{'gun':{'hit':80,'sourceHit':80}}}",
        "apply_accuracy(p);apply_accuracy(p)",
        "assert p['weapons']['gun']['hit']==72",
        "assert p['weapons']['gun']['sourceHit']==80",
        "p['weapons']['gun']['hit']=100;apply_accuracy(p,native_restored=True)",
        "assert p['weapons']['gun']['hit']==90",
      ].join(";"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("AI ship preference retains half the former quota without imposing a minimum", () => {
  const G = require("../shared/rules.js");
  let before = 0,
    after = 0,
    zero = 0;
  for (let seed = 0; seed < 4096; seed++) {
    const count = 36,
      previous = Math.floor(count / (6 + (seed % 3)));
    const quota = G.aiShipQuota(count, seed);
    assert.equal(quota, G.aiShipQuota(count, seed));
    assert(quota >= 0 && quota <= previous);
    before += previous;
    after += quota;
    if (G.aiShipQuota(6, seed) === 0) zero++;
  }
  assert(Math.abs(after / before - 0.5) < 0.02);
  assert(zero > 0);
  assert.equal(G.aiShipQuota(5, 1), 0);
});
