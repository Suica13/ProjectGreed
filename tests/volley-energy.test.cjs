const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");

test("every bazooka and beam rifle fires twice and every cannon fires three separate shots with recoil animation", () => {
  let checked = 0;
  for (const prefab of G.catalog.prefabs) {
    for (const [id, raw] of Object.entries(prefab.weapons)) {
      const weapon = require("../shared/weapon-sequence.js").compile({ ...raw, id });
      const count = /Bazooka|BeamRifle|_BR$/.test(weapon.id)
        ? 2
        : /Cannon/.test(weapon.id)
          ? 3
          : null;
      if (!count) continue;
      checked++;
      assert.equal(weapon.shotCount, count, prefab.id + ":" + weapon.id);
      assert.equal(weapon.attack.strikes.length, count);
      assert.ok(weapon.attack.shots.every((at, i, times) => i === 0 || at > times[i - 1]));
      assert.ok(weapon.attack.animations.filter((a) => a.clip).length >= count);
      assert.equal(weapon.damage, weapon.damagePerShot * count);
    }
  }
  assert.equal(checked, 16);
});

test("all weapon EN costs increase exactly 25%, including fractional costs and shared secondary weapons", () => {
  const groups = {
    0: ["Common_Push_A"],
    5: ["Common_SingleVulcan_RX_79_G"],
    6: ["Common_DoubleVulcan_MS", "Common_Cqb_A", "ZN_MS_06J_LegMS"],
    8: [
      "EF_BeamSaber_A",
      "EF_BeamSaber_BF",
      "ZN_HeatHawk_A",
      "ZN_MS_09_ChestBeam",
      "ZN_HeatSaber_A",
      "ZN_TwinBeamSword_A",
    ],
    10: [
      "EF_90mmMG",
      "EF_BOWA_BeamGun",
      "ZN_120mmMG",
      "EF_100mmMG",
      "ZN_MMP80MG",
      "ZN_Panzerfaust",
      "ZN_120mmMG_AntiAir",
    ],
    12: ["EF_BeamSprayGun", "ZN_MS_06K_BigGun"],
    14: ["EF_GroundTypeBeamRifle", "ZN_MS_14_BR"],
    16: ["EF_GroundTypeBazooka", "EF_GroundTypeMissileLauncher", "Common_Cannon_AntiAir"],
    18: ["EF_HypeBazooka", "ZN_270mmBazooka", "ZN_380mmBazooka", "ZN_MagellaCannon"],
    20: ["Common_Cannon", "EF_180mmCannon", "ZN_360mmBazooka"],
  };
  const original = Object.fromEntries(
    Object.entries(groups).flatMap(([en, ids]) => ids.map((id) => [id, Number(en)])),
  );
  for (const model of Object.values(G.models)) {
    for (const weapon of model.weapons) {
      assert.ok(Object.hasOwn(original, weapon.id), weapon.id);
      assert.equal(weapon.en, original[weapon.id] * 1.25, model.id + ":" + weapon.id);
    }
  }
});

test("weapons whose volley was increased keep the 30 percent reduction except subsequent balance overrides", () => {
  const old = {
    ZN_270mmBazooka: 6800,
    ZN_380mmBazooka: 8500,
    ZN_MagellaCannon: 6000,
    EF_GroundTypeBazooka: 7200,
    EF_GroundTypeBeamRifle: 8000,
    EF_180mmCannon: 9000,
    ZN_MS_14_BR: 8000,
  };
  let adjusted = 0;
  for (const prefab of G.catalog.prefabs)
    for (const [id, weapon] of Object.entries(prefab.weapons)) {
      const before = id === "ZN_360mmBazooka" ? (prefab.id === "MS_06F2" ? 7200 : 9000) : old[id];
      if (before) {
        adjusted++;
        const beamBuff =
          (prefab.id === "MS_14A" && id === "ZN_MS_14_BR") ||
          (prefab.id === "RX_79_G" && id === "EF_GroundTypeBeamRifle")
            ? 1.1
            : 1;
        assert.equal(
          weapon.damagePerShot,
          Math.round(before * 0.7 * beamBuff * 1e8) / 1e8,
          prefab.id + ":" + id,
        );
        assert.equal(
          Object.values(weapon.damageComponents).reduce((sum, n) => sum + n, 0),
          weapon.damagePerShot,
        );
      }
    }
  assert.equal(adjusted, 13);
  const gmBazooka = G.models.RGM_79__bazooka.weapons[0];
  assert.equal(gmBazooka.damagePerShot, 5000);
  assert.deepEqual(gmBazooka.damageComponents, { shell: 5000 });
  assert.equal(gmBazooka.shotCount, 2);
  assert.equal(gmBazooka.damage, 10000);
  assert.equal(
    G.models.RGC_80__beam_spray.weapons.find((w) => w.id === "Common_Cannon").damagePerShot,
    4000,
  );
  assert.equal(G.models.RGM_79__machine_gun.weapons[0].damagePerShot, 725);
  assert.equal(G.models.RGM_79__beam_spray.weapons[0].damage, 10000);
});

test("Panzerfaust gains another 25 percent damage as one shot; Zaku shoulder cannon stays just below GM cannon", () => {
  const panzer = G.models.MS_06F2__machine_gun.weapons.find((w) => w.id === "ZN_Panzerfaust");
  assert.equal(panzer.damagePerShot, 4200 * 1.25 * 1.25);
  assert.deepEqual(panzer.damageComponents, { shell: 6562.5 });
  assert.equal(panzer.shotCount, 1);
  assert.equal(panzer.attack.strikes.length, 1);
  const zaku = G.models.MS_06K__machine_gun.weapons.find((w) => w.id === "Common_Cannon_AntiAir");
  const gm = G.models.RGC_80__beam_spray.weapons.find((w) => w.id === "Common_Cannon");
  assert.equal(zaku.damagePerShot, gm.damagePerShot * 0.9);
  assert.equal(zaku.damagePerShot, 3600);
  assert.deepEqual(zaku.damageComponents, { shell: 3600 });
  assert.equal(zaku.shotCount, 3);
  assert.equal(gm.shotCount, 3);
  assert.ok(zaku.damage < gm.damage);
});
