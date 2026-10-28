const test = require("node:test"),
  assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const G = require("../shared/rules.js");
test("confirmed weapon family names survive shared model loading and keep localization", () => {
  const expected = {
    Common_DoubleMS_FF_B2: "双重导弹发射器",
    Common_DoubleMS_ZN_APC: "导弹发射器",
    Common_ArmGL: "腕部榴弹发射器",
    Common_ArmBR_Pink: "腕部光束枪",
    Common_ArmMG: "腕部机枪",
    ZN_4XMSL: "4X导弹货柜",
    EF_RX_80PR_LegMS: "腿部导弹发射器",
    ZN_Wappa_C4: "投掷C4",
    EF_Railgun_79_D_RG: "电磁炮",
    EF_FA_78_2_FrameLauncher_GL: "下挂榴弹发射器",
    SalamisClass_Turret_AA: "对空机枪",
    SalamisClass_Turret_AMS: "反MS导弹",
    BurkeClass_Turret_CN: "加农炮",
    Common_Grenade_A: "手雷",
    Common_Grenade_B_Burned: "燃烧手雷",
  };
  for (const [id, name] of Object.entries(expected)) {
    const found = G.catalog.prefabs.flatMap((p) =>
      Object.entries(p.weapons)
        .filter(([k]) => k === id)
        .map(([, w]) => w),
    );
    assert(found.length, id);
    for (const w of found) {
      assert.equal(w.name, name, id);
      assert.equal(w.localization.zh.name, name);
      assert(w.localization.en.name);
      assert(w.localization.ja.name);
    }
  }
});
test("import naming policy covers new families without treating MS identifiers as missiles", () => {
  const code = `import sys;sys.path.insert(0,'tools')
from native_weapon_names import label
assert label('Common_DoubleBR_Test',{})[0]=='双重光束枪'
assert label('Common_DoubleGL_Test',{})[0]=='双重榴弹'
assert label('Common_Arm_MS',{})[0]=='腕部导弹发射器'
assert label('MS_06F',{}) is None
assert label('ZN_MSM_03C_AMS',{},False) is None
compile(open('tools/weapon_policy.py',encoding='utf-8').read(),'weapon_policy.py','exec')
compile(open('tools/native_conversions.py',encoding='utf-8').read(),'native_conversions.py','exec')`;
  const result = spawnSync("python", ["-c", code], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
