"use strict";

// Compose after global conversion. Native weapons remain as audit evidence;
// multiple AA batteries on one hull must not multiply the area damage.
function apply(catalog) {
  for (const model of Object.values(catalog.models)) {
    if (!model.ship) continue;
    const batteries = model.weapons.filter(w => w.rangeRole === "ship_anti_air");
    if (!batteries.length) continue;
    const ports = batteries.flatMap(weapon => (weapon.muzzle?.mounts || []).map((mount, index) => ({
      mount, projectile: weapon.projectile,
      moduleId: weapon.attack?.steps?.find(s => s.shots && (s.muzzleIndex || 0) === index)?.moduleId,
    })));
    if (!ports.length) throw Error("Missing AA ports: " + model.prefabId);
    const skill = {
      id: "ShipAntiAirVolley", type: "irradiation", name: "对空炮齐射",
      localization: {zh:{name:"对空炮齐射"}, en:{name:"AA Barrage"}, ja:{name:"対空砲一斉射撃"}},
      description: "全炮位同时射击，攻击周身两格内所有单位，每回合一次。",
      sourceWeapon: batteries[0].id, damageType: "shell", radial: true,
      range: 2, minRange: 0, enCostPercent: 0,
      enCost: batteries.reduce((sum, w) => sum + (w.en || 0), 0),
      cooldownTurns: 0, consumeAction: false, baseHit: 75,
      damageComponents: {shell: 3500}, attackRounds: 1,
      chargeSeconds: 0, fireSeconds: .7, visualColor: "Yellow",
      requiredParts: [], muzzle: {mounts: ports.map(p => p.mount)},
      radialDirections: ports.map(p => model.modules?.find(m => m.id === p.moduleId)?.idleDir ??
        Math.atan2(p.mount.offset?.x || 0, -(p.mount.offset?.y || 0)) * 180 / Math.PI),
      barrageProjectiles: ports.map(p => p.projectile),
      barrageModules: ports.map(p => p.moduleId),
      moduleIds: [...new Set(ports.map(p => p.moduleId).filter(Boolean))],
      fireSound: batteries[0].sound,
    };
    model.skills = [...model.skills.filter(s => s.id !== skill.id), skill];
    model.weapons = model.weapons.filter(w => !batteries.includes(w));
    const prefab = catalog.prefabs.find(p => p.id === model.prefabId);
    if (!prefab.skills.some(s => s.id === skill.id)) prefab.skills.push(skill);
    for (const weapon of batteries) {
      prefab.weapons[weapon.id].availability = {hidden:true, convertedSkill:skill.id};
      for (const kit of prefab.weaponKits) kit.weapons = kit.weapons.filter(id => id !== weapon.id);
    }
  }
}
module.exports = {apply};
