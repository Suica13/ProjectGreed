const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const G = require("../shared/rules.js");
const Classes = require("../shared/weapon-classes.js");

test("RGC-83 variants distinguish 90mm machine-gun and beam-rifle kits in all three languages", () => {
  for (const id of ["RGC_83", "RGC_83_AEUG", "RGC_83_TITANS"]) {
    const prefab = G.catalog.prefabs.find(p => p.id === id);
    const mg = G.models[id + "__kit_3"], br = G.models[id + "__kit_2"];
    assert.equal(mg.kitName, "90mm机枪套件");
    assert.equal(br.kitName, "光束步枪套件");
    assert.equal(mg.cost, prefab.stats.cost);
    assert.equal(br.cost, prefab.stats.cost + 75);
    const machineGun = mg.weapons.find(w => w.id === "EF_GMRifle");
    const rifle = br.weapons.find(w => w.id === "EF_RMS_179_BR");
    assert.equal(Classes.classify(machineGun), "machine_gun");
    assert.equal(Classes.classify(rifle), "beam_rifle");
    assert.equal(machineGun.name, "90mm机枪");
    assert.equal(rifle.name, "光束步枪");
    for (const [language, machine, beam] of [
      ["zh", "90mm机枪套件", "光束步枪套件"],
      ["en", "90mm Machine Gun Kit", "Beam Rifle Kit"],
      ["ja", "90mmマシンガン装備", "ビーム・ライフル装備"],
    ]) {
      assert.equal(mg.kitLocalization[language].name, machine);
      assert.equal(br.kitLocalization[language].name, beam);
    }
    assert.deepEqual(prefab.weapons.EF_GMRifle.nativePayload,
      require("../assets/weapons.json").definitions.EF_GMRifle__lv1.nativePayload);
    assert.deepEqual(prefab.weapons.EF_GMRifle.nativePayload.ShellDamage, 650);
  }
});

test("confirmed rifle families never display cannon names and old 100-COST class surcharges are gone", () => {
  let rifles = 0, machineGuns = 0;
  for (const prefab of G.catalog.prefabs) {
    for (const weapon of Object.values(prefab.weapons)) {
      const source = weapon.sourceName || "";
      if (source === "EF_GMRifle") {
        assert.match(weapon.name, /^90mm机枪(?: Lv\.\d+)?$/); machineGuns++;
      }
      if (weapon.type !== "beam" || !/BeamRifle|(?:^|_)[SHL]?BR(?:_|$)/i.test(source) || /Arm|Double|Hand/.test(source)) continue;
      assert(!/光束炮|Beam Cannon|ビーム砲/.test(weapon.name + JSON.stringify(weapon.localization)));
      rifles++;
    }
    for (const kit of prefab.weaponKits) {
      const primary = prefab.weapons[kit.weapons[0]];
      if (!primary) continue;
      if (["beam_rifle", "cannon"].includes(Classes.classify(primary))) assert.notEqual(kit.cost, 100);
      if (primary.type === "shell") assert(!/光束步枪/.test(kit.name));
    }
  }
  assert(rifles > 100); assert(machineGuns >= 19);
  const prices = require("../assets/weapon-kit-costs.json");
  assert.equal(prices.beam_rifle, 75); assert.equal(prices.cannon, 75);
  // Physical long-range and sniper rifles keep their separate pricing.
  assert.equal(G.catalog.prefabs.find(p => p.id === "RGM_79C").weaponKits.find(k => k.id === "kit_3").cost, 100);
});

test("native import policies prioritize source family and projectile type over polluted names", () => {
  const result = JSON.parse(execFileSync("python", ["-c", `
import sys,json
sys.path.insert(0,'tools')
from native_weapon_names import label
from weapon_policy import category
from weapon_kit_policy import surcharge
from page_one_adaptations import weapon_label
rows=[]
for key,kind in [('EF_GMRifle','shell'),('EF_90mmMG','shell'),('EF_RMS_179_BR','beam'),('EF_BeamRifle','beam'),('EF_GLine_SBR','beam'),('EF_GLine_HBR','beam'),('EF_RX_78GP01_LBR','beam')]:
 w={'sourceName':key,'name':'光束炮','type':kind}
 rows.append([label(key,w)[0],category(key,w),surcharge(key,w),weapon_label(key,w)])
print(json.dumps(rows))
`], { cwd: process.cwd(), encoding: "utf8" }));
  for (const [index, row] of result.entries()) {
    const machine = index < 2;
    assert.deepEqual(row, [machine ? "90mm机枪" : "光束步枪", machine ? "machine_gun" : "beam_rifle", machine ? 0 : 75, machine ? "90mm机枪" : "光束步枪"]);
  }
});
