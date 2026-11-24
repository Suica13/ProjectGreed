/* 脱出按钮与落点选择。只发意图，实际恢复、换机和生成由共用规则裁定。 */
const SkillControls = (() => {
  let targetDraft = null;
  const reset = () => { targetDraft = null; };
  const activeId = () => (mode.startsWith("skill:") ? mode.slice(6) : null);
  function confirmation(unit) {
    const weapon = mode === "target" && unit && getWeapon(unit, weaponId);
    const active = !!unit && (!!activeId() || weapon?.slot === "skill");
    const draft = active && targetDraft?.game === game && targetDraft.unitId === unit.id &&
      targetDraft.mode === mode && targetDraft.weaponId === weaponId ? targetDraft : null;
    let target = null;
    if (draft?.kind === "weapon") {
      target = draft.ground ? Rules.groundTarget(game, unit, draft.x, draft.y) : getUnit(draft.targetId);
      if (target && draft.aimCell) target = {...target, aimCell:draft.aimCell};
    }
    const legal = !!draft && (draft.kind === "weapon"
      ? !!target && Rules.canAttack(game, unit, target, weapon)
      : Rules.canUseSkill(game, unit, activeId()) &&
        Rules.skillTargets(game, unit, activeId()).some(cell=>cell.x===draft.x&&cell.y===draft.y));
    return {active, draft, target, weapon, ready:legal && phase === "idle" && !isBusy() &&
      (!Net.active || (Net.canAct() && Net.canControl(unit) && !Net.awaiting))};
  }
  function chooseWeaponTarget(unit, target, weapon) {
    if (weapon?.slot !== "skill") return false;
    if (!Rules.canAttack(game, unit, target, weapon)) return true;
    targetDraft = {kind:"weapon",game,unitId:unit.id,mode,weaponId:weapon.id,targetId:target.id,
      ground:!!target.groundTarget,x:target.x,y:target.y,aimCell:target.aimCell};
    GameAudio.play("lockonSound");
    update();
    return true;
  }
  function confirm() {
    const unit = getUnit(selected), selection = confirmation(unit);
    if (!selection.ready) return;
    if (selection.draft.kind === "weapon") {
      const {target,weapon}=selection;
      reset();
      beginAttack(unit,target,weapon);
      weaponId = null;
      mode = "select";
      update();
    } else execute(selection.draft,unit);
  }
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
    const aura = unit ? Rules.commandAura(unit) : { radius: (model.ship ? 4 : 2) + (model.commandAuras?.length ? 2 : 0) + (model.commandRangeBonus || 0), effect: 0.1 };
    const percent = Number((aura.effect * 100).toFixed(2));
    const labels = { cmdAtk: "攻击指挥", cmdDef: "防御指挥", cmdCom: "通信指挥" };
    const effects = {
      cmdAtk: `友军射击与格斗最终伤害 +${percent}%`,
      cmdDef: `友军最终伤害减免 ${percent}%`,
      cmdCom: `友军最终命中率与回避率 +${percent}%`,
    };
    return (Rules.commandKinds ? Rules.commandKinds(model) : model.commandAuras || []).map((kind) => ({
      name: labels[kind.type],
      description: `范围 ${aura.radius} 格 · ${effects[kind.type]}。指挥高于100时生效，同类取最强；非舰船2格、舰船4格，原有指挥额外+2格；每高25点效果增加2.5个百分点。`,
    }));
  }
  function defensiveAbilities(model) {
    const field = model.iField;
    const result = [];
    if (model.abc) result.push({name:"ABC",description:I18n.language === "en"
      ? `Finite beam coating: ${model.abc.capacity} durability, ${Math.round(model.abc.reductions.beam*100)}% ranged beam reduction; depleted coating stops protecting.`
      : `有限耐久 ${model.abc.capacity}，普通光束减伤${Math.round(model.abc.reductions.beam*100)}%，光束格斗及贯穿分量按原MOD弱化减伤。耐久耗尽后失效。`});
    if (model.phaseShift) result.push({name:"PS Armor",description:I18n.language === "en"
      ? `Finite ${model.phaseShift.capacity}-point armor. Toggle changes armor and textures. Incoming physical hits drain durability and EN; beams bypass it.`
      : `有限耐久 ${model.phaseShift.capacity}，可开关并切换贴图。开启时减轻实弹与物理格斗伤害，受击消耗装甲耐久及EN，对光束无效。`});
    if (model.gnField) result.push({name:"GN立场",description:`仅防御时展开，吸收所有伤害类型，独立耐久 ${model.gnField.capacity}；每个己方回合恢复${model.gnField.recoveryPercent}%。`});
    if (model.solarFurnace) result.push({name:"太阳炉",description:`每个己方回合恢复${model.solarFurnace.enRecoveryPercent}%最大EN。${model.solarFurnace.antiDetect ? "附带反侦测，敌方侦察距离减半。" : ""}${model.solarFurnace.stealth ? "附带隐蔽，敌方侦察距离再乘75%。" : ""}`});
    if (!field) return result;
    return [
      ...result,
      {
        name: I18n.text("I立场"),
        description: I18n.text(
          `独立耐久 ${field.capacity.toLocaleString()}；吸收普通远程光束${Math.round(field.reduction * 100)}%、贯穿光束${Math.round(field.piercingReduction * 100)}%，不影响实弹和格斗。耐久耗尽后失效，可过载至最大耐久的25%；每个己方回合恢复${field.recoveryPercent}%。`,
        ),
      },
    ];
  }
  const actionLabel = skill => I18n.text(skill.consumeAction ? "消耗本次行动" : "不消耗行动");
  function sourceDescription(skill) {
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
      if (skill.radial) {
        const damage = Object.values(skill.damageComponents).reduce((sum, value) => sum + value, 0);
        return I18n.language === "en" ? `All ports fire together. Radius ${skill.range}; damage ${damage}; accuracy ${skill.baseHit}%. Includes allies. Once per turn.` :
          I18n.language === "ja" ? `全砲門一斉射撃。周囲${skill.range}マス、ダメージ${damage}、命中${skill.baseHit}%。味方を含む。毎ターン1回。` :
          `所有炮门同时射击：周身${skill.range}格，伤害${damage}，命中${skill.baseHit}%，包含友军，每回合一次。`;
      }
      const damage = Object.values(skill.damageComponents)
        .reduce((sum, value) => sum + value, 0)
        .toLocaleString(undefined, { maximumFractionDigits: 2 });
      {
        const en = Number.isFinite(skill.enCost) ? skill.enCost + " EN" : skill.enCostPercent + "%";
        if (I18n.language === "en")
          return `Damage ${damage} × 1 = ${damage}; range ${skill.range}${skill.areaWidth ? `, width ${skill.areaWidth}` : ""}, accuracy ${skill.baseHit}%; costs ${en}${Number.isFinite(skill.enCost) ? "" : " max EN"}; cooldown ${skill.cooldownTurns} turns. Hits each unit along the beam once, including allies.`;
        if (I18n.language === "ja")
          return `ダメージ ${damage} × 1 = ${damage}；射程${skill.range}${skill.areaWidth ? `・幅${skill.areaWidth}マス` : ""}、命中${skill.baseHit}%。${Number.isFinite(skill.enCost) ? en : "最大ENの" + en}を消費、冷却${skill.cooldownTurns}ターン。射線上の味方を含む各機に1回判定。`;
        return `基础伤害 ${damage} × 1 = ${damage}；射程 ${skill.range} 格${skill.areaWidth ? `，宽度 ${skill.areaWidth} 格` : ""}，命中 ${skill.baseHit}%；消耗 ${Number.isFinite(skill.enCost) ? en : en + "最大EN"}，冷却 ${skill.cooldownTurns} 个己方回合。对沿途每台单位（含友军）判定一次。`;
      }
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
    if (skill.type === "optical_camouflage") return I18n.language === "en"
      ? "Toggle optical camouflage: 200 EN per own turn, evasion ×1.25 and sensor stealth. Attacking or insufficient EN cancels it."
      : I18n.language === "ja" ? "光学迷彩：自軍ターンごとに200 EN、回避×1.25・ステルス。攻撃またはEN不足で解除。" : "光学迷彩：每个己方回合消耗200 EN，回避系数×1.25并获得索敌隐身；攻击或EN不足时解除。";
    if (skill.type === "phase_shift") return I18n.language === "en"
      ? "Toggle phase-shift armor once per turn. Physical hits spend armor durability and EN; it stops protecting when either is exhausted."
      : "每回合可切换一次PS装甲，不消耗行动。受击时按原MOD消耗装甲耐久与EN，EN或装甲耗尽时失效。";
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
      return `以自身为中心散布半径 ${skill.radius} 格的米诺夫斯基粒子，持续两个完整回合周期。仅区域内友军的回避率乘以 1.15。区域内反侦测距离 +5 格，来袭导弹与迫击炮命中率乘以 0.75。消耗 ${skill.enCost} EN、${skill.actionCost} AP，冷却 ${skill.cooldownTurns} 个自身回合。`;
    if (skill.type === "resupply")
      return I18n.text(
        "消耗自身10%最大EN与2 AP，为相邻目标格内所有友军恢复50%最大EN，每个己方回合限用一次。",
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
  function description(skill) {
    const note = skill.type === "emp" ? " " + I18n.text("AP机制未启用，AP减益暂不影响行动。") : "";
    return I18n.text(sourceDescription(skill) + note)
      .replace(/(?:AP\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*AP)(?:\s*[、,，·与和])?/g, "")
      .replace(/(消耗|消費)\s*[、,，·]/g, "$1 ");
  }
  function render(list, unit, canCommand) {
    for (const weapon of Rules.modelOf(unit).weapons.filter(w => w.slot === "skill")) {
      const card = WeaponInfo.card(weapon,null,{unit});
      const use = element("button", "", weapon.special?.type === "snipe" ? "锁定狙击目标" : "使用技能");
      use.dataset.weaponSkill = weapon.id;
      use.disabled = !canCommand || unit.acted || !!unit.plan ||
        unit.attackSkillRound === game.round || !Rules.canUse(unit,weapon);
      use.onclick = () => {
        reset();
        GameAudio.play("selectWeaponSound");
        AttackControls.reset();
        mode = "target"; weaponId = weapon.id;
        squadSingleMove = true;
        update();
      };
      card.append(use); list.append(card);
    }
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
          skill.type === "optical_camouflage"
            ? (I18n.language === "en" ? (unit.opticalCamouflage ? "Disable camouflage" : "Enable camouflage") : I18n.language === "ja" ? (unit.opticalCamouflage ? "迷彩解除" : "迷彩起動") : (unit.opticalCamouflage ? "关闭光学迷彩" : "开启光学迷彩"))
            : skill.type === "phase_shift"
            ? I18n.text(unit.phaseShiftEnabled === false ? "开启PS装甲" : "关闭PS装甲")
            : skill.type === "flight" && unit.flying
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
        reset();
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
          click({ x: unit.x, y: unit.y }, unit, true);
        else update();
      };
      list.append(button);
    }
    if (activeId())
      list.append(element("p", "helper", "点击高亮格子选择技能目标，再点击确认技能。"));
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
    reset();
    if (selected === event.unitId) {
      selected = event.resultId;
      weaponId = null;
      mode = "select";
    }
    if (event.irradiation) IrradiationFX.start(event);
    else SkillEffects.start(event);
  }
  function click(cell, unit, immediate = false) {
    const skillId = activeId();
    if (!skillId || !unit) return false;
    if (!Rules.skillTargets(game, unit, skillId).some((c) => c.x === cell.x && c.y === cell.y)) {
      const target = Rules.at(game, cell.x, cell.y);
      if (target?.team === game.team) select(target.id);
      else note("请选择高亮的合法技能目标。");
      return true;
    }
    if (!immediate) {
      targetDraft={kind:"unit",game,unitId:unit.id,mode,weaponId,x:cell.x,y:cell.y};
      GameAudio.play("lockonSound");
      update();
      return true;
    }
    execute(cell,unit);
    return true;
  }
  function execute(cell, unit) {
    const skillId = activeId();
    reset();
    if (Net.active) {
      Net.request("skill", { unitId: unit.id, skillId, x: cell.x, y: cell.y });
      mode="select";weaponId=null;update();
    }
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
  }
  function targetCell(unit) {
    const {draft, target} = confirmation(unit);
    if (!draft) return null;
    return draft.aimCell || (target ? Rules.center(target) : {x:draft.x,y:draft.y});
  }
  function drawTarget(ctx, unit, position, tile) {
    const cell = targetCell(unit);
    if (!cell) return;
    const point = position(cell.x, cell.y);
    ctx.save();
    ctx.strokeStyle = "#ffd45b";
    ctx.lineWidth = 3;
    const half = tile * .45;
    ctx.strokeRect(point.x-half, point.y-half, half*2, half*2);
    ctx.beginPath();
    ctx.arc(point.x, point.y, tile*.28, 0, Math.PI*2);
    ctx.stroke();
    ctx.restore();
  }
  // Roster, assignment and campaign lists use the same equipped-skill presentation.
  function pilotSummary(profile) {
    const row = element("span", "pilot-list-skills");
    const skills = PilotSystem.skillsOf({ pilot: profile });
    for (const skill of skills) {
      const badge = element("span", "pilot-list-skill");
      badge.dataset.skillId = skill.id;
      badge.title = description(skill);
      const icon = element("img");
      icon.src = skill.icon;
      icon.alt = "";
      const name = element("span", "", I18n.localized(skill, "name"));
      badge.append(icon, name);
      row.append(badge);
    }
    const talents = PilotSystem.talents.of(profile);
    for (const talent of talents) {
      const badge = element("span", "pilot-list-skill pilot-talent", I18n.text(talent.name));
      badge.dataset.pilotTalent = talent.id;
      badge.title = I18n.text(talent.description);
      row.append(badge);
    }
    if (!skills.length && !talents.length)
      row.append(element("small", "muted", I18n.text(profile?.level >= PilotSystem.skillUnlockLevel ? "未选择技能" : "6级解锁技能")));
    return row;
  }
  return { render, cells, click, applied, description, commandAbilities, defensiveAbilities, pilotSummary,
    confirmation, chooseWeaponTarget, confirm, reset, targetCell, drawTarget };
})();
