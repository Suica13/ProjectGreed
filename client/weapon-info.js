/* Weapon inspection uses the same compiled attack steps and target modifiers as combat. */
"use strict";
const WeaponInfo = (() => {
  const environmentLabels = {
    ground: "对地",
    air: "对空",
    water: "对水",
    space: "对宇宙",
  };
  const sizeLabels = { small: "对小型", medium: "对中型", large: "对大型" };
  const componentLabels = {
    beam: "光束",
    shell: "实弹",
    melee: "格斗",
    meleeBeam: "格斗光束",
    meleeShell: "格斗实弹",
    beamAP: "光束穿甲",
    shellAP: "实弹穿甲",
    meleeBeamAP: "格斗光束穿甲",
    meleeShellAP: "格斗实弹穿甲",
  };
  const partLabels = {
    head: "头部",
    backpack: "背包",
    leftArm: "左臂",
    rightArm: "右臂",
    leftLeg: "左腿",
    rightLeg: "右腿",
  };
  const node = (tag, className = "", label = "") => {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (label) item.textContent = label;
    return item;
  };
  const amount = (value) => (Number.isFinite(value) ? Number(value.toFixed(2)) : 0);
  const percent = (factor) => Math.round((factor ?? 1) * 100) + "%";
  function badge(label, factors) {
    const damage = factors.damage ?? 1;
    const accuracy = factors.accuracy ?? 1;
    const compact = damage === accuracy;
    const text = compact
      ? label + " 伤/命 " + percent(damage)
      : label + " 伤" + percent(damage) + " 命" + percent(accuracy);
    const tone =
      damage > 1 || accuracy > 1 ? " bonus" : damage < 1 || accuracy < 1 ? " penalty" : "";
    const item = node("span", "weapon-effect-tag" + tone, text);
    item.title = compact
      ? "伤害与命中均为基础值的 " + percent(damage)
      : "伤害为基础值的 " + percent(damage) + "，命中为基础值的 " + percent(accuracy);
    return item;
  }
  function effects(weapon, extended = false) {
    const tags = node("div", "weapon-effect-tags");
    const environments = extended ? ["ground", "air", "water", "space"] : ["ground", "air"];
    for (const key of environments) {
      const factor =
        key === "air" && ["bomb", "mortar", "nuke"].includes(weapon.special?.type)
          ? 0
          : (weapon.targetModifiers?.[key] ?? 1);
      tags.append(badge(environmentLabels[key], { damage: factor, accuracy: factor }));
    }
    const sizes = extended ? ["small", "medium", "large"] : ["small", "large"];
    for (const key of sizes) {
      tags.append(badge(sizeLabels[key], weapon.antiSize?.[key] || { damage: 1, accuracy: 1 }));
    }
    return tags;
  }
  function flow(weapon) {
    const list = node("ol", "weapon-flow");
    let time = 0;
    const start = weapon.attack?.startAnimation ?? weapon.clip;
    if (start) {
      const item = node("li");
      item.append(node("time", "", "0.00s"), node("span", "", "起手动作 · " + start));
      list.append(item);
    }
    for (const step of weapon.attack?.steps || []) {
      const repeat = step.repeat ?? 1;
      for (let i = 0; i < repeat; i++) {
        time = Math.round((time + step.delay) * 1000000) / 1000000;
        const item = node("li");
        item.append(node("time", "", time.toFixed(2) + "s"));
        const parts = [];
        if (step.animation) parts.push("动作 " + step.animation);
        if (step.weaponDisplayIndex !== undefined)
          parts.push("武器显示状态 " + step.weaponDisplayIndex);
        if (step.shots) {
          parts.push("发射 " + step.shots + " 发");
          if (step.muzzleIndex !== undefined) parts.push("炮口 " + (step.muzzleIndex + 1));
          const damage = step.damageComponents || weapon.damageComponents || {};
          const multiplier = step.damageMultiplier ?? 1;
          const channels = Object.entries(damage)
            .map(([key, value]) => (componentLabels[key] || key) + " " + amount(value * multiplier))
            .join(" + ");
          if (channels) parts.push("单发 " + channels);
          if (weapon.hitsPerShot > 1) parts.push("每发 " + weapon.hitsPerShot + " 段");
          if (step.accuracy !== undefined) parts.push("原始命中 " + amount(step.accuracy) + "%");
          if (step.moduleId) parts.push("模块 " + step.moduleId);
          if (step.requiredParts?.length)
            parts.push(
              "需要 " + step.requiredParts.map((part) => partLabels[part] || part).join(" / "),
            );
        }
        if (parts.length) item.append(node("span", "", parts.join(" · ")));
        else item.append(node("span", "", "间隔"));
        list.append(item);
      }
    }
    if (!list.children.length) list.append(node("li", "", "无攻击步骤数据"));
    return list;
  }
  function inspector(weapon) {
    const details = node("details", "weapon-inspector");
    details.append(node("summary", "", "查看攻击流程与目标适性"));
    const body = node("div", "weapon-inspector-body");
    body.append(node("strong", "", "目标倍率（100% 为无修正）"), effects(weapon, true));
    const duration = amount(weapon.attack?.duration ?? 0);
    body.append(node("strong", "", "攻击流程 · " + duration + " 秒"), flow(weapon));
    if (weapon.nativeTiming) {
      body.append(
        node(
          "small",
          "",
          "原 MOD 演出：" +
            amount(weapon.nativeTiming.duration) +
            " 秒；原冷却 " +
            amount(weapon.nativeTiming.cooldown) +
            " 秒",
        ),
      );
    }
    details.append(body);
    return details;
  }
  function card(weapon, content) {
    const wrapper = node("article", "weapon-card");
    wrapper.append(content, effects(weapon), inspector(weapon));
    return wrapper;
  }
  return { effects, inspector, card };
})();
