/* 脱出按钮与落点选择。只发意图，实际恢复、换机和生成由共用规则裁定。 */
const SkillControls = (() => {
  const activeId = () => (mode.startsWith("skill:") ? mode.slice(6) : null);
  const resultName = (result) =>
    UnitModels[result.unitId + "__" + result.kitId]?.name || result.unitId;
  function recovery(result) {
    return (
      `${I18n.text(result.inheritResources ? "继承原资源比例" : "不继承原资源")} · ` +
      `HP +${result.hpRecoveryPercent}% · EN +${result.enRecoveryPercent}% · ` +
      `${I18n.text("盾牌")} +${result.shieldRecoveryPercent}% · ` +
      I18n.text(result.repairAllParts ? "修复所有破损部位" : "保留破损部位")
    );
  }
  function commandAbilities(model, unit = null) {
    const aura = unit ? Rules.commandAura(unit) : { radius: 3, effect: 0.1 };
    const percent = Number((aura.effect * 100).toFixed(2));
    const labels = { cmdAtk: "攻击指挥", cmdDef: "防御指挥", cmdCom: "通信指挥" };
    const effects = {
      cmdAtk: `友军射击与格斗最终伤害 +${percent}%`,
      cmdDef: `友军最终伤害减免 ${percent}%`,
      cmdCom: `友军最终命中率与回避率 +${percent}%`,
    };
    return (model.commandAuras || []).map((kind) => ({
      name: labels[kind.type],
      description: `范围 ${aura.radius} 格 · ${effects[kind.type]}。同类取最强；领导力每满25点提高1格与1%效果，100点时为3格与10%。`,
    }));
  }
  function defensiveAbilities(model) {
    const field = model.iField;
    if (!field) return [];
    return [
      {
        name: I18n.text("I立场"),
        description: I18n.text(
          `独立耐久 ${field.capacity.toLocaleString()}；吸收普通远程光束${Math.round(field.reduction * 100)}%、贯穿光束${Math.round(field.piercingReduction * 100)}%，不影响实弹和格斗。耐久耗尽后失效，可过载至最大耐久的25%；每个己方回合恢复${field.recoveryPercent}%。`,
        ),
      },
    ];
  }
  const actionLabel = (skill) =>
    skill.actionCost
      ? `${I18n.text("消耗")} ${skill.actionCost} AP`
      : I18n.text(skill.consumeAction ? "消耗本次行动" : "不消耗行动");
  function description(skill) {
    if (skill.owner === "pilot") {
      if (skill.passive)
        return I18n.text("被动：免除EXAM系统的耐久自损；EN消耗、持续时间和头部损毁解除规则不变。");
      const effects = Object.entries(skill.statMultipliers || {}).map(
        ([key, value]) => I18n.text(PilotSystem.labels[key]) + " ×" + value,
      );
      if ((skill.experienceMultiplier ?? 1) !== 1)
        effects.push(I18n.text("驾驶员经验") + " ×" + skill.experienceMultiplier);
      return (
        (Object.keys(skill.statMultipliers || {}).length ? I18n.text("驾驶员属性") + " · " : "") +
        effects.join(" · ") +
        " · " +
        I18n.text("消耗") +
        " " +
        skill.enCost +
        " EN · 0 AP · " +
        I18n.text(
          `持续${skill.durationTurns}回合 · 冷却${skill.cooldownTurns}回合（效果结束后开始）`,
        )
      );
    }
    if (skill.type === "irradiation") {
      const damage = Object.values(skill.damageComponents)
        .reduce((sum, value) => sum + value, 0)
        .toLocaleString(undefined, { maximumFractionDigits: 2 });
      if (Number.isFinite(skill.enCost)) {
        if (I18n.language === "en")
          return `Damage ${damage} × 1 = ${damage}; range ${skill.range}, accuracy ${skill.baseHit}%; ${skill.actionCost} AP and ${skill.enCost} EN; cooldown ${skill.cooldownTurns} turns. Hits each unit along the beam once, including allies.`;
        if (I18n.language === "ja")
          return `ダメージ ${damage} × 1 = ${damage}；射程${skill.range}、命中${skill.baseHit}%。消費${skill.actionCost} AP・${skill.enCost} EN、冷却${skill.cooldownTurns}ターン。射線上の味方を含む各機に1回判定。`;
        return `基础伤害 ${damage} × 1 = ${damage}；射程 ${skill.range} 格，命中 ${skill.baseHit}%；消耗 ${skill.actionCost} AP、${skill.enCost} EN，冷却 ${skill.cooldownTurns} 个己方回合。对沿途每台单位（含友军）判定一次。`;
      }
      return I18n.text(
        `基础伤害 ${damage} × 1 = ${damage}；射程 ${skill.range} 格，命中 ${skill.baseHit}%；消耗 ${skill.actionCost} AP、${skill.enCost !== undefined ? skill.enCost + " EN" : skill.enCostPercent + "%最大EN"}，冷却 ${skill.cooldownTurns} 个己方回合。对沿途每台单位（含友军）判定一次。`,
      );
    }
    if (skill.type === "recon" && skill.reconMode === "camera") {
      if (I18n.language === "en")
        return `Range ${skill.minRange}–${skill.range}; ${skill.actionCost} AP, ${skill.enCost} EN. Reveals ${skill.areaSight} tiles and detects within ${skill.areaRadar} tiles until your next turn.`;
      if (I18n.language === "ja")
        return `射程${skill.minRange}～${skill.range}マス。${skill.actionCost} AP・${skill.enCost} EN。次の自軍ターンまで半径${skill.areaSight}マスの視界と${skill.areaRadar}マスの探知を提供。`;
      return `射程${skill.minRange}～${skill.range}格，消耗${skill.actionCost} AP与${skill.enCost} EN；揭露目标半径${skill.areaSight}格视野并以${skill.areaRadar}格范围探测敌人，持续至下次己方回合。`;
    }
    if (skill.type === "beam_diffusion") {
      if (I18n.language === "en")
        return `Range ${skill.range}; ${skill.actionCost} AP and ${skill.enCost !== undefined ? skill.enCost + " EN" : skill.enCostPercent + "% max EN"}. Beams crossing the radius-${skill.radius} area deal 50% less damage for 2 full turn cycles. Does not stack.`;
      if (I18n.language === "ja")
        return `射程${skill.range}マス。${skill.actionCost} APと${skill.enCost !== undefined ? skill.enCost + " EN" : "最大ENの" + skill.enCostPercent + "%"}を消費。半径${skill.radius}マスを通るビームの威力を50%軽減。2往復ターン持続、重複不可。`;
      return `射程${skill.range}格，消耗${skill.actionCost} AP与${skill.enCost !== undefined ? skill.enCost + " EN" : skill.enCostPercent + "%最大EN"}；半径${skill.radius}格内持续2个完整回合周期，穿过区域的光束弹伤害降低50%，同类区域不叠加。`;
    }
    if (skill.description) return skill.description;
    if (skill.type === "flight")
      return I18n.text(
        "部位完好时消耗1 AP切换飞行姿态；起飞后作为航空单位，可跨越山岩与水域，不消耗移动机会。降落需要合法地形。",
      );
    if (skill.type === "overdrive")
      return `启动消耗${skill.enPercent}%最大EN · 强化形态持续${skill.duration}个己方回合 · 每个己方回合结束扣除${skill.hpDrainPercent}%最大耐久、${skill.enDrainPercent}%最大EN · 到期或头部损毁时强制解除，保留资源和破损部位。`;

    if (skill.type === "recon")
      return skill.reconMode === "camera"
        ? `选择${skill.minRange ?? 0}～${Number(skill.range.toFixed(2))}格的位置，提供${skill.areaSight}格视野与${Number(skill.areaRadar.toFixed(2))}格侦测，持续至下次己方回合。消耗${skill.enCost} EN、${skill.actionCost} AP；下次己方回合可再次使用。`
        : `扫描${Number(skill.range.toFixed(2))}格内${skill.waterOnly ? "水域中的" : ""}敌军，标记持续至下次己方回合；消除己方未侦测命中惩罚，不直接揭露普通单位。消耗${skill.enCost} EN${skill.actionCost ? "、" + skill.actionCost + " AP" : "和本次行动"}。${skill.reconMode ? "下次己方回合可再次使用。" : ""}`;
    if (skill.type === "minovsky")
      return `以自身为中心散布半径 ${skill.radius} 格的米诺夫斯基粒子，持续两个完整回合周期。区域内所有防守单位的回避率乘以 1.25，反侦测距离 +5 格；来袭导弹与迫击炮命中率再乘以 0.75。消耗 ${skill.enCost} EN、${skill.actionCost} AP，冷却 ${skill.cooldownTurns} 个自身回合。`;
    if (skill.type === "resupply")
      return I18n.text(
        "消耗自身25%最大EN与2 AP，为一台相邻友军恢复50%最大EN，每个己方回合限用一次。",
      );
    if (skill.type === "repair")
      return `范围 ${skill.range} · 友军HP +${skill.hpRecoveryPercent}% · EN +${skill.enRecoveryPercent}% · 盾牌 +${skill.shieldRecoveryPercent}% · 消耗EN ${skill.enCost}和本次行动；不修复破损部位。`;
    if (["transform", "armor_purge"].includes(skill.type))
      return `${I18n.text("本体变为")} ${resultName(skill.source)} · ${recovery(skill.source)} · ${actionLabel(skill)}`;
    const source =
      skill.source.mode === "remove"
        ? I18n.text("原机体移除")
        : `${I18n.text(skill.source.mode === "keep" ? "原机体保留" : "本体变为")} ${resultName(skill.source)} · ${recovery(skill.source)}`;
    const spawn = skill.spawn
      ? `${I18n.text("独立生成")} ${resultName(skill.spawn)} · ${recovery(skill.spawn)}`
      : I18n.text("不生成独立单位");
    return (
      `${source}；${spawn}；${I18n.text("脱出范围")} ${skill.minRange ?? 0}–${skill.range}；` +
      actionLabel(skill)
    );
  }
  function render(list, unit, canCommand) {
    let pilotHeading = false;
    for (const skill of Rules.unitSkills(unit)) {
      if (skill.owner === "pilot" && !pilotHeading) {
        list.append(element("div", "section-title pilot-skills-heading", "驾驶员技能"));
        pilotHeading = true;
      }
      const button = element("button", "weapon" + (activeId() === skill.id ? " active" : ""));
      button.dataset.unitSkill = skill.id;
      if (skill.owner === "pilot") {
        button.dataset.pilotSkill = skill.id;
        if (skill.icon) {
          const icon = element("img", "pilot-skill-icon");
          icon.src = skill.icon;
          icon.alt = "";
          button.append(icon);
        }
        const active = unit.pilotBuffs?.[skill.id],
          ready = unit.skillReadyRound?.[skill.id] || 0;
        if (skill.passive) button.append(element("small", "muted", "被动生效"));
        else if (active)
          button.append(
            element(
              "small",
              "muted",
              I18n.text("生效中") +
                " · " +
                Math.ceil((active.expiresRound - game.round) / 2) +
                " " +
                I18n.text("回合"),
            ),
          );
        else if (ready > game.round)
          button.append(
            element(
              "small",
              "muted",
              I18n.text("冷却") +
                " · " +
                Math.ceil((ready - game.round) / 2) +
                " " +
                I18n.text("回合"),
            ),
          );
      }
      button.append(
        element(
          "strong",
          "",
          skill.type === "flight" && unit.flying
            ? "降落"
            : skill.owner === "pilot"
              ? I18n.localized(skill)
              : skill.name,
        ),
        element("small", "helper", description(skill)),
      );
      if (WeaponClasses.isWeaponSkill(skill)) button.append(WeaponInfo.classBadge(skill));
      const left = Math.max(
        0,
        skill.maxUses - (unit.skillUses?.[UnitModels[unit.model].prefabId + "/" + skill.id] || 0),
      );
      if (skill.type !== "flight" && Number.isInteger(skill.maxUses) && skill.maxUses < 99)
        button.append(
          element("small", "muted", `${I18n.text("剩余次数")} ${left}/${skill.maxUses}`),
        );
      button.disabled =
        !canCommand ||
        !Rules.canUseSkill(game, unit, skill.id) ||
        !Rules.skillTargets(game, unit, skill.id).length;
      button.onclick = () => {
        GameAudio.play("selectWeaponSound");
        AttackControls.reset();
        mode = "skill:" + skill.id;
        weaponId = null;
        if (
          [
            "pilot_buff",
            "overdrive",
            "overboost",
            "fullboost",
            "transform",
            "armor_purge",
            "flight",
            "minovsky",
            "emp",
            "smoke",
          ].includes(skill.type) ||
          (skill.type === "recon" && skill.reconMode !== "camera")
        )
          click({ x: unit.x, y: unit.y }, unit);
        else update();
      };
      list.append(button);
    }
    if (activeId())
      list.append(element("p", "helper", "点击高亮格子选择技能目标，再次选择单位可取消。"));
  }
  function cells(unit) {
    if (
      !unit ||
      !activeId() ||
      phase !== "idle" ||
      (Net.active && (!Net.canAct() || !Net.canControl(unit)))
    )
      return new Set();
    return new Set(Rules.skillTargets(game, unit, activeId()).map((c) => Rules.key(c.x, c.y)));
  }
  function applied(event) {
    if (selected === event.unitId) {
      selected = event.resultId;
      weaponId = null;
      mode = "select";
    }
    if (event.irradiation) IrradiationFX.start(event);
    else SkillEffects.start(event);
  }
  function click(cell, unit) {
    const skillId = activeId();
    if (!skillId || !unit) return false;
    if (!Rules.skillTargets(game, unit, skillId).some((c) => c.x === cell.x && c.y === cell.y)) {
      const target = Rules.at(game, cell.x, cell.y);
      if (target?.team === game.team) select(target.id);
      else note("请选择高亮的合法技能目标。");
      return true;
    }
    if (Net.active) Net.request("skill", { unitId: unit.id, skillId, x: cell.x, y: cell.y });
    else {
      try {
        const skillName =
          Rules.unitSkills(unit).find((s) => s.id === skillId)?.name || I18n.text("技能");
        const label = logUnit(unit),
          event = Rules.useSkill(game, unit, skillId, cell.x, cell.y);
        applied(event);
        addLog(`${label} ${skillName} → ${Rules.modelOf(getUnit(event.resultId)).name}。`);
        update();
      } catch (error) {
        note(error.message);
      }
    }
    return true;
  }
  return { render, cells, click, applied, description, commandAbilities, defensiveAbilities };
})();
