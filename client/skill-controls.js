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
  function description(skill) {
    if (skill.type === "flight")
      return I18n.text(
        "部位完好时消耗1 AP切换飞行姿态；起飞后作为航空单位，可跨越山岩与水域，不消耗移动机会。降落需要合法地形。",
      );
    if (skill.type === "overdrive")
      return `启动消耗${skill.enPercent}%最大EN · 强化形态持续${skill.duration}个己方回合 · 每个己方回合结束扣除${skill.hpDrainPercent}%最大耐久、${skill.enDrainPercent}%最大EN · 到期或头部损毁时强制解除，保留资源和破损部位。`;

    if (skill.type === "recon")
      return `范围 ${skill.range}${skill.waterOnly ? "，仅水域目标" : ""} · 标记敌军直到下次己方行动，友军对其命中率+10%，解除隐蔽命中惩罚 · 消耗EN ${skill.enCost}和本次行动。`;
    if (skill.type === "repair")
      return `范围 ${skill.range} · 友军HP +${skill.hpRecoveryPercent}% · EN +${skill.enRecoveryPercent}% · 盾牌 +${skill.shieldRecoveryPercent}% · 消耗EN ${skill.enCost}和本次行动；不修复破损部位。`;
    if (["transform", "armor_purge"].includes(skill.type))
      return `${I18n.text("本体变为")} ${resultName(skill.source)} · ${recovery(skill.source)} · ${I18n.text("消耗本次行动")}`;
    const source =
      skill.source.mode === "remove"
        ? I18n.text("原机体移除")
        : `${I18n.text(skill.source.mode === "keep" ? "原机体保留" : "本体变为")} ${resultName(skill.source)} · ${recovery(skill.source)}`;
    const spawn = skill.spawn
      ? `${I18n.text("独立生成")} ${resultName(skill.spawn)} · ${recovery(skill.spawn)}`
      : I18n.text("不生成独立单位");
    return (
      `${source}；${spawn}；${I18n.text("脱出范围")} ${skill.minRange ?? 0}–${skill.range}；` +
      I18n.text(skill.consumeAction ? "消耗本次行动" : "不消耗行动")
    );
  }
  function render(list, unit, canCommand) {
    for (const skill of Rules.unitSkills(unit)) {
      const button = element("button", "weapon" + (activeId() === skill.id ? " active" : ""));
      button.dataset.unitSkill = skill.id;
      button.append(
        element("strong", "", skill.type === "flight" && unit.flying ? "降落" : skill.name),
        element("small", "helper", description(skill)),
      );
      const left = Math.max(
        0,
        skill.maxUses - (unit.skillUses?.[UnitModels[unit.model].prefabId + "/" + skill.id] || 0),
      );
      if (skill.type !== "flight")
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
        if (["overdrive", "transform", "armor_purge", "flight"].includes(skill.type))
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
    SkillEffects.start(event);
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
  return { render, cells, click, applied, description };
})();
