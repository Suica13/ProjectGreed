/* 普通数据驱动的攻击时间轴。delay 是等待秒数，shots 是本 Step 发射数。 */
const WeaponSequence = (() => {
  function compile(weapon) {
    let time = 0;
    const shots = [],
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
        count = step.shots ?? 0;
      if (
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
        for (let n = 0; n < count; n++) shots.push(time);
      }
    }
    const hitsPerShot = weapon.hitsPerShot ?? 1;
    if (
      !shots.length ||
      shots.length > 128 ||
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
      damage: weapon.damagePerShot * shots.length * hitsPerShot,
      attack: {
        ...weapon.attack,
        shots,
        animations,
        duration: time,
        strikes: shots
          .flatMap((at, shotIndex) =>
            Array.from({ length: hitsPerShot }, (_, hitIndex) => ({
              shotIndex,
              hitIndex,
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
    return { clip: current.clip, time: current.clip ? Math.max(0, time - current.at) : 0 };
  }
  return { compile, pose };
})();
if (typeof module !== "undefined") module.exports = WeaponSequence;
