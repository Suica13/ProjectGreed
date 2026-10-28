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
  // All weapon surfaces use the compiled strikes, including multi-hit and mixed payloads.
  function summary(source, options = {}) {
    const { unit, target, response = "counter", isCounter = false } = options;
    const weapon = unit ? Rules.weaponStats(source, unit) : source;
    const strikes = unit
      ? Rules.availableStrikes(unit, weapon, target)
      : weapon.attack?.strikes || [];
    const groups = new Map(),
      attributes = new Set();
    let total = 0;
    for (const strike of strikes) {
      const components = strike.damageComponents || weapon.damageComponents;
      const damage =
        (components
          ? Object.values(components).reduce((sum, value) => sum + value, 0)
          : weapon.damagePerShot || 0) * (strike.damageMultiplier ?? 1);
      const key = Number(damage.toFixed(6));
      groups.set(key, (groups.get(key) || 0) + 1);
      total += damage;
      for (const [channel, value] of Object.entries(components || {}))
        if (value > 0) attributes.add(componentLabels[channel] || channel);
    }
    if (!attributes.size) attributes.add(Rules.typeNames[weapon.type] || weapon.type);
    const number = (value) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    const root = node("div", "weapon-summary");
    const heading = node("div", "weapon-summary-heading");
    heading.append(node("strong", "weapon-name", weapon.name));
    const tags = node("div", "weapon-attributes");
    for (const attribute of attributes) tags.append(node("span", "weapon-attribute", attribute));
    heading.append(tags);
    const damageLine = node("div", "weapon-damage-line");
    damageLine.append(node("span", "weapon-stat-label", "基础伤害"));
    const formula = node("div", "weapon-damage-formula");
    for (const [damage, count] of groups) {
      if (formula.childElementCount) formula.append(node("span", "weapon-math-symbol", "+"));
      const term = node("span", "weapon-damage-term");
      term.append(
        node("b", "", number(damage)),
        node("span", "weapon-math-symbol", "×"),
        node("span", "weapon-hit-count", String(count)),
      );
      formula.append(term);
    }
    if (!groups.size) formula.append(node("span", "", "0 × 0"));
    formula.append(
      node("span", "weapon-math-symbol", "="),
      node("strong", "weapon-total-damage", number(total)),
    );
    damageLine.append(formula);
    const forecast =
      unit && target ? attackForecast(unit, target, weapon, response, isCounter) : null;
    const accuracy = node("div", "weapon-accuracy");
    accuracy.append(
      node("span", "weapon-stat-label", "命中"),
      node("strong", "", number(forecast?.hit ?? weapon.hit) + "%"),
    );
    if (forecast) {
      accuracy.classList.add("attack-forecast");
      accuracy.dataset.damage = forecast.damage;
      accuracy.dataset.hit = forecast.hit;
    }
    root.append(heading, damageLine, accuracy);
    for (const requirement of weapon.pilotRequirements || []) {
      const label = I18n.text(PilotSystem.labels[requirement.stat] || requirement.stat);
      const current = unit ? PilotSystem.of(unit).stats[requirement.stat] : null;
      const hint =
        I18n.text("驾驶员要求") +
        " · " +
        label +
        " " +
        requirement.operator +
        " " +
        requirement.value +
        (current === null ? "" : " · " + I18n.text("当前") + " " + current);
      root.append(
        node(
          "div",
          unit && !Rules.pilotWeaponAllowed(unit, weapon)
            ? "weapon-unavailable"
            : "weapon-pilot-requirement",
          hint,
        ),
      );
    }
    if (weapon.onHitAPLoss)
      root.append(
        node("div", "weapon-pilot-requirement", I18n.text("命中后使目标下回合AP减少1点，不叠加")),
      );
    if (weapon.burn)
      root.append(
        node(
          "div",
          "weapon-pilot-requirement",
          I18n.text("命中附加燃烧，持续3回合；重复命中刷新时长"),
        ),
      );
    if (weapon.requiresSfsMS)
      root.append(node("div", "weapon-pilot-requirement", I18n.text("需要搭载至少1台MS才能开火")));
    if (weapon.requiresShield)
      root.append(
        node(
          "div",
          unit && !(unit.shield > 0) ? "weapon-unavailable" : "weapon-pilot-requirement",
          I18n.text("需要有效护盾"),
        ),
      );

    if (unit) {
      const broken = Rules.brokenWeaponParts(unit, weapon);
      if (broken.length) root.append(node("div", "weapon-unavailable", "部位损坏，无法使用"));
      else if (Rules.weaponCooldown(unit, weapon))
        root.append(node("div", "weapon-unavailable", "冷却中"));
    }
    return root;
  }
  function inspector(source, options = {}) {
    const { unit, target, response = "counter", isCounter = false } = options;
    const weapon = unit ? Rules.weaponStats(source, unit) : source;
    const details = node("details", "weapon-inspector");
    details.append(node("summary", "", "详细"));
    const body = node("div", "weapon-inspector-body");
    const stats = node("dl", "weapon-detail-stats");
    const rows = [
      ["射程", weapon.min + "–" + weapon.max],
      ["AP", Rules.actionCost(weapon)],
      ["EN", amount(weapon.en)],
    ];
    if (unit) rows.push(["剩余 EN", amount(unit.en)]);
    if (Number.isInteger(weapon.maxUses))
      rows.push([
        unit ? "剩余次数" : "使用次数",
        unit
          ? Math.max(0, weapon.maxUses - (unit.weaponUses?.[weapon.id] || 0)) + "/" + weapon.maxUses
          : weapon.maxUses,
      ]);
    if (["mortar", "snipe"].includes(weapon.special?.type))
      rows.push(["冷却", "1 " + I18n.text("回合")]);
    if (weapon.nativePayload?.DpDamage) rows.push(["DP", amount(weapon.nativePayload.DpDamage)]);
    for (const [label, value] of rows)
      stats.append(node("dt", "", label), node("dd", "", String(value)));
    body.append(stats);
    if (unit && target)
      body.append(
        node(
          "p",
          "weapon-target-forecast",
          attackForecastText(attackForecast(unit, target, weapon, response, isCounter)),
        ),
      );
    body.append(
      node("p", "weapon-detail-note", "基础伤害未计入目标防护与战斗加成；次数包含多段命中。"),
    );
    if (weapon.description) body.append(node("p", "", weapon.description));
    const all = (weapon.requiredParts || [])
      .map((part) => I18n.text(partLabels[part] || part))
      .join(" / ");
    const any = (weapon.anyParts || [])
      .map((part) => I18n.text(partLabels[part] || part))
      .join(" / ");
    if (all || any)
      body.append(
        node(
          "p",
          "",
          I18n.text("安装部位：") +
            (all || any) +
            (any ? " · " + I18n.text("任一部位完好即可") : ""),
        ),
      );
    if (weapon.partBreakModifier !== undefined)
      body.append(node("p", "", I18n.text("部位破坏系数") + " " + weapon.partBreakModifier));
    body.append(node("strong", "", "目标倍率（100% 为无修正）"), effects(weapon, true));
    const duration = amount(weapon.attack?.duration ?? 0);
    const timeline = node("details", "weapon-timeline");
    timeline.append(
      node("summary", "", I18n.text("攻击流程") + " · " + duration + "s"),
      flow(weapon),
    );
    body.append(timeline);
    if (weapon.nativeTiming)
      body.append(
        node(
          "small",
          "",
          I18n.text("原 MOD 演出：") +
            amount(weapon.nativeTiming.duration) +
            "s · " +
            I18n.text("原CD") +
            " " +
            amount(weapon.nativeTiming.cooldown) +
            "s",
        ),
      );
    details.append(body);
    return details;
  }
  function card(weapon, content = null, options = {}) {
    const wrapper = node("article", "weapon-card");
    wrapper.append(content || summary(weapon, options), inspector(weapon, options));
    return wrapper;
  }
  return { effects, summary, inspector, card };
})();
