const test = require("node:test"), assert = require("node:assert/strict");
const G = require("../shared/rules"), Sequence = require("../shared/weapon-sequence");
const affected = ["RX_78NT_1","RX_78NT_1_FA","MS_14JG","MS_14F","MS_14FS","MS_15F","MS_15FS","MS_15B","MS_14JG_MsgCustom","MS_14A_Stutzer","AGX_04A1","AMX_101","RX_78GP01"];

test("every shot in affected left-arm bursts keeps its native left firing pose", () => {
  let checked = 0;
  for (const art of G.catalog.units) {
    const m = G.models[art.id];
    if (!affected.includes(m.prefabId)) continue;
    for (const w of m.weapons) {
      if (w.type === "melee" || !w.requiredParts.includes("leftArm") || w.requiredParts.includes("rightArm")) continue;
      if (!/ArmMG|90mmMG_L/.test(w.id)) continue;
      for (const time of w.attack.shots) {
        const pose = Sequence.pose(w,time), clip = art.animations[pose.clip];
        assert(clip?.curves.LeftArm,m.prefabId + "/" + w.id);
        assert.deepEqual(clip.curves.Body.dir,art.animations.Common_Shoot_A_L.curves.Body.dir);
        assert.equal(clip.curves.LeftArm.dir[0][1],0);
      }
      const unit = {model:art.id,hp:m.hp,en:m.en,brokenParts:{rightArm:true}};
      assert.equal(G.availableStrikes(unit,w).length,w.shotCount);
      unit.brokenParts.leftArm = true;
      assert.equal(G.availableStrikes(unit,w).length,0);
      checked++;
    }
  }
  assert(checked >= 12);
});

test("left burst fixes retain shot timing, energy and right-hand poses", () => {
  for (const prefabId of ["RX_78NT_1","RX_78NT_1_FA","MS_14JG"]) {
    const art = G.catalog.units.find(a => G.models[a.id].prefabId === prefabId);
    const m = G.models[art.id], left = m.weapons.find(w=>w.id === "Common_ArmMG_L"), right=m.weapons.find(w=>w.id === "Common_ArmMG");
    assert.equal(left.shotCount,9); assert.equal(right.shotCount,9);
    assert.equal(left.en,20); assert.equal(right.en,20);
    assert.deepEqual(left.attack.shots,right.attack.shots);
    for (const time of right.attack.shots) {
      const pose=Sequence.pose(right,time),clip=art.animations[pose.clip];
      assert.equal(clip.curves.Body.dir[0][1],-30);
      assert(clip.curves.RightArm); assert(!clip.curves.LeftArm);
    }
  }
});
