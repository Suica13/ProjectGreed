/* 普通数据驱动的攻击时间轴。delay 是等待秒数，shots 是本 Step 发射数。 */
const WeaponSequence = (() => {
  const damageStep = 25;
  const roundDamage = (value) => {
    if (!Number.isFinite(value)) throw Error("无效的伤害数值");
    return Math.round(Math.max(0, value) / damageStep) * damageStep;
  };
  function roundComponents(components, multiplier = 1) {
    const entries = Object.entries(components);
    if (
      !Number.isFinite(multiplier) ||
      multiplier < 0 ||
      entries.some(([, value]) => !Number.isFinite(value) || value < 0)
    )
      throw Error("无效的伤害分量");
    const total = entries.reduce((sum, [, value]) => sum + value * multiplier, 0),
      units = roundDamage(total) / damageStep;
    if (!total) return Object.fromEntries(entries.map(([key]) => [key, 0]));
    const shares = entries.map(([key, value], index) => {
      const exact = ((value * multiplier) / total) * units;
      return { key, index, count: Math.floor(exact), remainder: exact - Math.floor(exact) };
    });
    const remaining = units - shares.reduce((sum, share) => sum + share.count, 0);
    const ranked = [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    for (let i = 0; i < remaining; i++) ranked[i].count++;
    return Object.fromEntries(shares.map((share) => [share.key, share.count * damageStep]));
  }
  function compile(weapon) {
    const baseComponents = roundComponents(weapon.damageComponents);
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
        (step.firingArc && (!Number.isFinite(step.firingArc.idleDir) ||
          !Number.isFinite(step.firingArc.arc) || step.firingArc.arc < 0 || step.firingArc.arc > 180)) ||
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
      const stepComponents =
        step.damageComponents || damageMultiplier !== 1
          ? roundComponents(step.damageComponents || weapon.damageComponents, damageMultiplier)
          : null;
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
            ...(step.firingArc ? { firingArc: { ...step.firingArc } } : {}),
            ...(step.channelId ? { channelId: step.channelId } : {}),
            ...(stepComponents ? { damageComponents: stepComponents } : {}),
            ...(step.accuracy !== undefined ? { accuracy: step.accuracy } : {}),
          });
          damageMultipliers.push(1);
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
      weapon.damagePerShot < 0 ||
      !Number.isInteger(hitsPerShot) ||
      hitsPerShot < 1 ||
      hitsPerShot > 16
    )
      throw Error("无效的发射数量或单发伤害");
    return {
      ...weapon,
      damageComponents: baseComponents,
      damagePerShot: roundDamage(
        Object.values(baseComponents).reduce((sum, value) => sum + value, 0),
      ),
      shotCount: shots.length,
      damage:
        damageMultipliers.reduce(
          (sum, value, i) =>
            sum +
            Object.values(shotProperties[i].damageComponents || baseComponents).reduce(
              (n, v) => n + v,
              0,
            ) *
              value,
          0,
        ) * hitsPerShot,
      attack: {
        ...weapon.attack,
        steps: weapon.attack.steps.map((step) =>
          step.shots && (step.damageComponents || (step.damageMultiplier ?? 1) !== 1)
            ? {
                ...step,
                damageComponents: roundComponents(
                  step.damageComponents || weapon.damageComponents,
                  step.damageMultiplier ?? 1,
                ),
                damageMultiplier: 1,
              }
            : { ...step },
        ),
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
  return { compile, pose, damageStep, roundDamage, roundComponents };
})();
if (typeof module !== "undefined") module.exports = WeaponSequence;
