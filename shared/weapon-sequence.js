/* 普通数据驱动的攻击时间轴。delay 是等待秒数，shots 是本 Step 发射数。 */
const WeaponSequence = (() => {
  function compile(weapon) {
    let time = 0;
    const shots = [],
      damageMultipliers = [],
      partBreakModifiers = [],
      requiredParts = [],
      muzzleIndices = [],
      moduleIds = [],
      muzzleShotIndices = [],
      shotProperties = [],
      muzzleShotCounts = new Map(),
      displayStates = [],
      animations = [
        {
          at: 0,
          clip: Object.hasOwn(weapon.attack, "startAnimation")
            ? weapon.attack.startAnimation
            : weapon.clip,
        },
      ];
    for (const step of weapon.attack.steps) {
      const repeat = step.repeat ?? 1,
        count = step.shots ?? 0,
        damageMultiplier = step.damageMultiplier ?? 1,
        partBreakModifier = step.partBreakModifier ?? weapon.partBreakModifier ?? 1;
      if (
        !Number.isInteger(step.muzzleIndex ?? 0) ||
        (step.muzzleIndex ?? 0) < 0 ||
        (step.muzzleIndex ?? 0) > 31 ||
        !Array.isArray(step.requiredParts ?? []) ||
        !Number.isFinite(partBreakModifier) ||
        partBreakModifier < 0 ||
        !Number.isFinite(damageMultiplier) ||
        damageMultiplier < 0 ||
        damageMultiplier > 10 ||
        !Number.isFinite(step.delay) ||
        step.delay < 0 ||
        !Number.isInteger(repeat) ||
        repeat < 1 ||
        repeat > 64 ||
        !Number.isInteger(count) ||
        count < 0 ||
        count > 32
      )
        throw Error("无效的攻击 Step");
      for (let i = 0; i < repeat; i++) {
        time = Math.round((time + step.delay) * 1000000) / 1000000;
        if (step.animation) animations.push({ at: time, clip: step.animation });
        if (step.weaponDisplayIndex !== undefined) {
          if (!Number.isInteger(step.weaponDisplayIndex)) throw Error("无效的武器显示状态");
          displayStates.push({ at: time, index: step.weaponDisplayIndex });
        }
        for (let n = 0; n < count; n++) {
          shots.push(time);
          shotProperties.push({
            ...(step.channelId ? { channelId: step.channelId } : {}),
            ...(step.damageComponents ? { damageComponents: step.damageComponents } : {}),
            ...(step.accuracy !== undefined ? { accuracy: step.accuracy } : {}),
          });
          damageMultipliers.push(damageMultiplier);
          partBreakModifiers.push(partBreakModifier);
          requiredParts.push(step.requiredParts || []);
          const mountIndex = step.muzzleIndex ?? 0;
          muzzleShotIndices.push(muzzleShotCounts.get(mountIndex) || 0);
          muzzleShotCounts.set(mountIndex, (muzzleShotCounts.get(mountIndex) || 0) + 1);
          muzzleIndices.push(mountIndex);
          moduleIds.push(step.moduleId);
        }
      }
    }
    const hitsPerShot = weapon.hitsPerShot ?? 1;
    if (
      !shots.length ||
      shots.length > 512 ||
      time > 30 ||
      !Number.isFinite(weapon.damagePerShot) ||
      weapon.damagePerShot <= 0 ||
      !Number.isInteger(hitsPerShot) ||
      hitsPerShot < 1 ||
      hitsPerShot > 16
    )
      throw Error("无效的发射数量或单发伤害");
    return {
      ...weapon,
      shotCount: shots.length,
      damage:
        damageMultipliers.reduce(
          (sum, value, i) =>
            sum +
            Object.values(shotProperties[i].damageComponents || weapon.damageComponents).reduce(
              (n, v) => n + v,
              0,
            ) *
              value,
          0,
        ) * hitsPerShot,
      attack: {
        ...weapon.attack,
        shots,
        muzzleIndices,
        muzzleShotIndices,
        animations,
        displayStates,
        duration: time,
        strikes: shots
          .flatMap((at, shotIndex) =>
            Array.from({ length: hitsPerShot }, (_, hitIndex) => ({
              shotIndex,
              hitIndex,
              ...shotProperties[shotIndex],
              damageMultiplier: damageMultipliers[shotIndex],
              partBreakModifier: partBreakModifiers[shotIndex],
              requiredParts: requiredParts[shotIndex],
              ...(moduleIds[shotIndex] ? { moduleId: moduleIds[shotIndex] } : {}),
              at:
                Math.round((at + hitIndex * (weapon.attack.hitInterval || 0)) * 1000000) / 1000000,
            })),
          )
          .sort((a, b) => a.at - b.at),
      },
    };
  }
  function pose(weapon, time) {
    let current = weapon.attack.animations[0];
    for (const event of weapon.attack.animations) {
      if (event.at > time) break;
      current = event;
    }
    let weaponDisplayIndex = null;
    for (const state of weapon.attack.displayStates || []) {
      if (state.at > time) break;
      weaponDisplayIndex = state.index;
    }
    return {
      clip: current.clip,
      time: current.clip ? Math.max(0, time - current.at) : 0,
      weaponDisplayIndex,
    };
  }
  return { compile, pose };
})();
if (typeof module !== "undefined") module.exports = WeaponSequence;
