/* Build one simultaneous firing flow from explicitly identified physical channels.
 * Raw MOD weapons remain in the prefab for independent source audits. */
const Sequence = require("../shared/weapon-sequence.js");
const copy = (value) => structuredClone(value);
function valueAt(points, time) {
  if (time <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++)
    if (time <= points[i][0]) {
      const [a, x] = points[i - 1],
        [b, y] = points[i];
      return x + ((y - x) * (time - a)) / (b - a);
    }
  return points.at(-1)[1];
}
function animationFor(poses, animations, id) {
  if (!poses.some((p) => p.pose.clip)) return null;
  const curves = {};
  let duration = 0;
  for (const [i, p] of poses.entries()) {
    const clip = animations[p.pose.clip];
    if (!clip) continue;
    duration = Math.max(duration, clip.duration - p.pose.time);
    for (const [bone, fields] of Object.entries(clip.curves || {})) {
      const arm =
        p.channel.limb?.endsWith("Arm") && /^(Left|Right)(Arm|Shoulder|Weapon)/.test(bone);
      if (
        arm &&
        !bone.toLowerCase().startsWith(p.channel.limb.startsWith("left") ? "left" : "right")
      )
        continue;
      if (!arm && i > 0 && curves[bone]) continue;
      curves[bone] = Object.fromEntries(
        Object.entries(fields).map(([key, points]) => [
          key,
          [
            [0, valueAt(points, p.pose.time)],
            ...points.filter((pt) => pt[0] > p.pose.time).map(([t, v]) => [t - p.pose.time, v]),
          ],
        ]),
      );
    }
  }
  animations[id] = { duration: Math.max(0.001, duration), curves };
  return id;
}
function compose(prefab, group, animations) {
  if (
    !group ||
    !Array.isArray(group.channels) ||
    group.channels.length < (group.fireMode === "independent" ? 1 : 2) ||
    group.channels.length > 32 ||
    new Set(group.channels.map((c) => c.id)).size !== group.channels.length
  )
    throw Error("Invalid paired weapon group: " + prefab.id);
  const base = prefab.weapons[group.id];
  if (!base) throw Error("Missing paired root: " + group.id);
  const channels = group.channels.map((channel) => {
    const raw = prefab.weapons[channel.weaponId];
    if (
      !raw ||
      raw.type !== base.type ||
      !Number.isInteger(channel.muzzleIndex) ||
      channel.muzzleIndex < 0 ||
      !Array.isArray(channel.requiredParts)
    )
      throw Error("Invalid paired channel: " + channel.id);
    const compiled = Sequence.compile(raw),
      mount = (raw.muzzle.mounts || [raw.muzzle])[channel.muzzleIndex];
    if (!mount) throw Error("Missing paired muzzle: " + channel.id);
    const shots = compiled.attack.strikes.filter(
      (s) => compiled.attack.muzzleIndices[s.shotIndex] === channel.muzzleIndex,
    );
    if (!shots.length) throw Error("Empty paired channel: " + channel.id);
    return {
      channel,
      raw,
      compiled,
      mount,
      shots,
      energy: (raw.en * shots.length) / compiled.attack.strikes.length,
    };
  });
  const startAnimation = animationFor(
    channels.map((c) => ({ channel: c.channel, pose: Sequence.pose(c.compiled, 0) })),
    animations,
    "PairedStart_" + group.id,
  );
  const steps = [];
  let at = 0;
  const count = Math.max(...channels.map((c) => c.shots.length));
  for (let round = 0; round < count; round++) {
    const current = channels
      .map((c, index) => ({ ...c, index, shot: c.shots[round] }))
      .filter((c) => c.shot);
    // Preserve the per-barrel cadence; pair corresponding L/R shots at the earlier native time.
    const time = Math.min(...current.map((c) => c.shot.at));
    const clip = animationFor(
      current.map((c) => ({ channel: c.channel, pose: Sequence.pose(c.compiled, c.shot.at) })),
      animations,
      "PairedFire_" + group.id + "_" + round,
    );
    if (clip) {
      steps.push({ delay: Math.max(0, time - at), animation: clip });
      at = Math.max(at, time);
    }
    for (const c of current) {
      const required = [
        ...new Set([
          ...(c.shot.requiredParts || []).filter(
            (p) => !c.channel.limb || !["leftArm", "rightArm", "leftLeg", "rightLeg"].includes(p),
          ),
          ...c.channel.requiredParts,
        ]),
      ];
      steps.push({
        delay: Math.max(0, time - at),
        shots: 1,
        muzzleIndex: c.index,
        channelId: c.channel.id,
        requiredParts: required,
        damageComponents: copy(c.shot.damageComponents || c.raw.damageComponents),
        accuracy: c.shot.accuracy ?? c.raw.hit,
        damageMultiplier: c.shot.damageMultiplier,
        partBreakModifier: c.shot.partBreakModifier,
      });
      at = Math.max(at, time);
    }
  }
  const duration = Math.max(at, ...channels.map((c) => c.compiled.attack.duration));
  if (duration > at) steps.push({ delay: duration - at });
  // Pairing changes shot channels, not the root weapon's native display-state writes.
  let stepTime = 0;
  const timeline = steps.map((step) => {
    stepTime = Math.round((stepTime + step.delay) * 1000000) / 1000000;
    return { at: stepTime, step };
  });
  for (const state of Sequence.compile(base).attack.displayStates)
    timeline.push({ at: state.at, step: { weaponDisplayIndex: state.index } });
  timeline.sort((a, b) => a.at - b.at);
  stepTime = 0;
  steps.splice(
    0,
    steps.length,
    ...timeline.map(({ at, step }) => {
      const result = { ...step, delay: Math.round((at - stepTime) * 1000000) / 1000000 };
      stepTime = at;
      return result;
    }),
  );
  const common = channels[0].channel.requiredParts.filter((p) =>
    channels.every((c) => c.channel.requiredParts.includes(p)),
  );
  const union = [...new Set(channels.flatMap((c) => c.channel.requiredParts))];
  const result = {
    ...base,
    name: group.name || base.name,
    requiredParts: common,
    anyParts:
      channels.every((c) => c.channel.requiredParts.length) && union.length > 1 ? union : undefined,
    en: channels.reduce((n, c) => n + c.energy, 0),
    pairedChannels: channels.map((c) => ({
      id: c.channel.id,
      weaponMainClass: require("../shared/weapon-classes.js").mainClass(c.raw),
      weaponSubClass: require("../shared/weapon-classes.js").classify(c.raw),
      requiredParts: c.channel.requiredParts,
      en: c.energy,
    })),
    muzzle: { mounts: channels.map((c) => copy(c.mount)) },
    muzzleEffects: channels.map(
      (c) => c.raw.muzzleEffects?.[c.channel.muzzleIndex] ?? c.raw.muzzleEffects?.[0],
    ),
    hitsPerShot: 1,
    attack: { steps, startAnimation },
    clip: steps.find((s) => s.animation)?.animation ?? null,
    nativeTiming: {
      ...base.nativeTiming,
      energyMode: "paired",
      energy: channels.reduce((n, c) => n + c.energy, 0),
      duration,
      firstShot: Math.min(...channels.map((c) => c.shots[0].at)),
      projectiles: channels.reduce((n, c) => n + c.shots.length, 0),
    },
  };
  if (result.muzzleEffects.every((e) => e === undefined)) delete result.muzzleEffects;
  if (group.name)
    result.localization = {
      zh: { name: group.name },
      en: { name: group.id.includes("ArmMG") ? "Wrist Machine Guns" : "Wrist Beam Guns" },
      ja: { name: group.id.includes("ArmMG") ? "腕部マシンガン" : "腕部ビーム・ガン" },
    };
  return result;
}
// Split physical arms, including native flows that already contain both barrels.
// Exposing the raw aliases instead would duplicate their payload.
function variants(prefab, group, animations) {
  if (group.fireMode !== "independent") return [compose(prefab, group, animations)];
  return ["rightArm", "leftArm"].map((limb) => {
    const channels = group.channels.filter((c) => c.limb === limb);
    if (!channels.length) throw Error("Missing independent arm: " + prefab.id + "/" + limb);
    const id = channels[0].id;
    const weapon = compose(prefab, { ...group, id, channels }, animations);
    delete weapon.availability;
    const suffix =
      limb === "rightArm" ? ["右臂", "Right Arm", "右腕"] : ["左臂", "Left Arm", "左腕"];
    weapon.id = id;
    const names = weapon.localization;
    weapon.name += "（" + suffix[0] + "）";
    weapon.localization = Object.fromEntries(
      ["zh", "en", "ja"].map((lang, i) => [
        lang,
        {
          ...names?.[lang],
          name:
            (names?.[lang]?.name ||
              prefab.weapons[group.id].localization?.[lang]?.name ||
              prefab.weapons[group.id].name) +
            " (" +
            suffix[i] +
            ")",
        },
      ]),
    );
    return weapon;
  });
}
module.exports = { compose, variants };
