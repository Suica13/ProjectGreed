/* 非攻击技能：本体变更、资源恢复和独立单位生成都由同一裁定路径处理。 */
const UnitSkills = (() => {
  function validateResult(result, label) {
    if (
      !result ||
      typeof result.unitId !== "string" ||
      !/^[A-Za-z0-9_]+$/.test(result.unitId) ||
      typeof result.kitId !== "string" ||
      !/^[A-Za-z0-9_]+$/.test(result.kitId) ||
      typeof result.inheritResources !== "boolean" ||
      typeof result.repairAllParts !== "boolean" ||
      (result.kitMap !== undefined &&
        (!result.kitMap ||
          typeof result.kitMap !== "object" ||
          Array.isArray(result.kitMap) ||
          Object.values(result.kitMap).some(
            (kit) => typeof kit !== "string" || !/^[A-Za-z0-9_]+$/.test(kit),
          ))) ||
      ["hpRecoveryPercent", "enRecoveryPercent", "shieldRecoveryPercent"].some(
        (key) => !Number.isFinite(result[key]) || result[key] < 0 || result[key] > 100,
      )
    )
      throw Error("Invalid escape result: " + label);
  }
  function validate(skills = [], label = "unit") {
    if (!Array.isArray(skills) || new Set(skills.map((s) => s?.id)).size !== skills.length)
      throw Error("Invalid unit skills: " + label);
    for (const skill of skills) {
      if (skill?.type === "flight") {
        if (
          skill.actionCost !== 1 ||
          !Array.isArray(skill.requiredParts) ||
          !skill.id ||
          !skill.name
        )
          throw Error("Invalid flight skill: " + label);
        continue;
      }
      if (skill?.type === "overboost") {
        if (
          !/^[A-Za-z0-9_]+$/.test(skill.id) ||
          !skill.name ||
          !Number.isInteger(skill.actionCost) ||
          skill.actionCost < 0 ||
          !Number.isFinite(skill.enCost) ||
          skill.enCost < 0 ||
          !Number.isFinite(skill.moveBonus) ||
          !Number.isFinite(skill.mobilityMultiplier) ||
          skill.mobilityMultiplier < 1 ||
          !Number.isFinite(skill.hpDrainPercent) ||
          skill.hpDrainPercent <= 0 ||
          skill.hpDrainPercent > 100
        )
          throw Error("Invalid OverBoost skill: " + label);
        continue;
      }
      if (skill?.type === "fullboost") {
        if (
          !/^[A-Za-z0-9_]+$/.test(skill.id) ||
          !skill.name ||
          skill.actionCost !== 0 ||
          !Number.isFinite(skill.enCost) ||
          skill.enCost <= 0 ||
          !Number.isInteger(skill.duration) ||
          skill.duration < 1 ||
          !Number.isInteger(skill.cooldownTurns) ||
          skill.cooldownTurns < 1 ||
          !Number.isFinite(skill.moveBonus) ||
          !Number.isFinite(skill.mobilityMultiplier) ||
          skill.mobilityMultiplier < 1
        )
          throw Error("Invalid FullBoost skill: " + label);
        continue;
      }
      if (skill?.type === "overdrive") {
        if (
          !/^[A-Za-z0-9_]+$/.test(skill.id) ||
          !skill.name ||
          !skill.formUnitId ||
          !skill.formKits ||
          !Number.isInteger(skill.duration) ||
          skill.duration < 1 ||
          skill.duration > 10 ||
          ["enPercent", "hpDrainPercent", "enDrainPercent"].some(
            (k) => !Number.isFinite(skill[k]) || skill[k] < 0 || skill[k] > 100,
          )
        )
          throw Error("Invalid overdrive skill: " + label);
        continue;
      }
      if (skill?.type === "recon") {
        if (
          !/^[A-Za-z0-9_]+$/.test(skill.id) ||
          !skill.name ||
          (skill.reconMode !== undefined && !["camera", "scan"].includes(skill.reconMode)) ||
          (skill.reconMode &&
            (!Number.isInteger(skill.actionCost) ||
              skill.actionCost < 1 ||
              !Number.isInteger(skill.durationRounds) ||
              skill.durationRounds < 1)) ||
          (skill.reconMode === "camera" &&
            ![skill.areaSight, skill.areaRadar].every((v) => Number.isFinite(v) && v > 0)) ||
          !Number.isFinite(skill.range) ||
          skill.range < 1 ||
          skill.range > 100 ||
          !Number.isFinite(skill.enCost) ||
          skill.enCost <= 0 ||
          !Number.isInteger(skill.maxUses) ||
          skill.maxUses < 1 ||
          skill.maxUses > 99 ||
          typeof skill.consumeAction !== "boolean" ||
          typeof skill.waterOnly !== "boolean"
        )
          throw Error("Invalid reconnaissance skill: " + label);
        continue;
      }
      if (skill?.type === "minovsky") {
        if (
          !/^[A-Za-z0-9_]+$/.test(skill.id) ||
          !skill.name ||
          !Number.isInteger(skill.radius) ||
          skill.radius < 1 ||
          skill.radius > 20 ||
          !Number.isFinite(skill.enCost) ||
          skill.enCost <= 0 ||
          !Number.isInteger(skill.actionCost) ||
          skill.actionCost < 1 ||
          !Number.isInteger(skill.durationRounds) ||
          skill.durationRounds < 1 ||
          !Number.isInteger(skill.cooldownTurns) ||
          skill.cooldownTurns < 1 ||
          !Number.isInteger(skill.maxUses) ||
          skill.maxUses < 1 ||
          typeof skill.consumeAction !== "boolean"
        )
          throw Error("Invalid Minovsky skill: " + label);
        continue;
      }
      if (skill?.type === "repair") {
        if (
          !/^[A-Za-z0-9_]+$/.test(skill.id) ||
          !skill.name ||
          !Number.isInteger(skill.range) ||
          skill.range < 1 ||
          skill.range > 12 ||
          !Number.isFinite(skill.enCost) ||
          skill.enCost <= 0 ||
          !Number.isInteger(skill.maxUses) ||
          skill.maxUses < 1 ||
          skill.maxUses > 99 ||
          typeof skill.consumeAction !== "boolean" ||
          ["hpRecoveryPercent", "enRecoveryPercent", "shieldRecoveryPercent"].some(
            (key) => !Number.isFinite(skill[key]) || skill[key] < 0 || skill[key] > 100,
          )
        )
          throw Error("Invalid repair skill: " + label);
        continue;
      }
      if (
        !skill ||
        typeof skill.id !== "string" ||
        !/^[A-Za-z0-9_]+$/.test(skill.id) ||
        !["escape", "transform", "armor_purge"].includes(skill.type) ||
        typeof skill.name !== "string" ||
        !skill.name.trim() ||
        !Number.isInteger(skill.range) ||
        skill.range < 0 ||
        skill.range > 12 ||
        !Number.isInteger(skill.maxUses) ||
        skill.maxUses < 1 ||
        skill.maxUses > 99 ||
        typeof skill.consumeAction !== "boolean" ||
        !["remove", "keep", "transform"].includes(skill.source?.mode) ||
        (skill.source.mode === "remove" && !skill.spawn)
      )
        throw Error("Invalid escape skill: " + label);
      if (
        skill.minRange !== undefined &&
        (!Number.isInteger(skill.minRange) || skill.minRange < 0 || skill.minRange > skill.range)
      )
        throw Error("Invalid skill minimum range: " + label);
      if (
        skill.type !== "escape" &&
        (skill.spawn || skill.source.mode !== "transform" || skill.range !== 0)
      )
        throw Error("Transformation must replace the unit in place: " + label);
      if (skill.source.mode !== "remove") validateResult(skill.source, label + "/source");
      if (skill.spawn) validateResult(skill.spawn, label + "/spawn");
    }
  }
  function create(G) {
    const { models, modelOf, fits, dist, mapWidth, mapHeight, dimensions, center, parts, sensors } =
      G;
    const of = (unit) => models[unit.model]?.skills || [];
    const usageKey = (unit, skill) => models[unit.model].prefabId + "/" + skill.id;
    function canUse(game, unit, skillId) {
      const skill = of(unit).find((s) => s.id === skillId);
      return (
        !!skill &&
        (unit.skillReadyRound?.[skill.id] ?? 0) <= game.round &&
        (!skill.actionCost ||
          (unit.actionPoints ?? modelOf(unit).actionPoints ?? 5) >= skill.actionCost) &&
        (skill.type !== "transform" || !Object.values(unit.brokenParts || {}).some(Boolean)) &&
        (skill.type !== "flight" ||
          ((unit.actionPoints ?? modelOf(unit).actionPoints ?? 5) >= skill.actionCost &&
            !skill.requiredParts.some((part) => unit.brokenParts?.[part]) &&
            game.environment !== "space" &&
            (!unit.flying || fits(game, { ...unit, flying: false }, unit.x, unit.y)))) &&
        (skill.type !== "overboost" ||
          (!unit.overBoost &&
            unit.en >= skill.enCost &&
            (unit.actionPoints ?? modelOf(unit).actionPoints ?? 5) >= skill.actionCost)) &&
        (skill.type !== "fullboost" || (!unit.fullBoost && unit.en >= skill.enCost)) &&
        (skill.type !== "overdrive" ||
          (!unit.overdrive &&
            !unit.brokenParts?.head &&
            unit.en >= (modelOf(unit).en * skill.enPercent) / 100 &&
            !!models[skill.formUnitId + "__" + skill.formKits[models[unit.model].kitId]])) &&
        (!["repair", "recon", "minovsky"].includes(skill.type) || unit.en >= skill.enCost) &&
        game.units.includes(unit) &&
        !(
          ["escape", "transform", "armor_purge", "overdrive"].includes(skill.type) &&
          game.units.some((other) => other.hp > 0 && other.embarked?.carrierId === unit.id)
        ) &&
        unit.hp > 0 &&
        !unit.embarked &&
        !unit.acted &&
        !unit.plan &&
        unit.team === game.team &&
        game.winner === null &&
        (!game.deployment || game.deployment.every(Boolean)) &&
        (!Number.isInteger(skill.maxUses) ||
          (unit.skillUses?.[usageKey(unit, skill)] || 0) < skill.maxUses)
      );
    }
    // Resource inheritance preserves the old percentage, then adds the configured percentage
    // of the NEW maximum. Zero recovery therefore does not silently refill a transformed unit.
    function resultUnit(unit, oldModel, config, id, x, y, skillUses, consumeAction) {
      const model = config.unitId + "__" + (config.kitMap?.[oldModel.kitId] ?? config.kitId);
      const next = {
        id,
        model,
        x,
        y,
        team: unit.team,
        ownerSeat: unit.ownerSeat ?? unit.team,
        environment: unit.environment,
        performance: unit.performance ?? 1,
        ...(unit.customName ? { customName: unit.customName } : {}),
        angle: unit.angle,
        skillUses: { ...skillUses },
        brokenParts: config.repairAllParts ? {} : { ...unit.brokenParts },
        moved: consumeAction || unit.moved,
        acted: consumeAction || unit.acted,
        actionPoints: consumeAction ? 0 : (unit.actionPoints ?? model.actionPoints ?? 5),
        origin: null,
        plan: null,
        moduleHp: undefined,
        counterCount: unit.counterCount ?? 0,
        ...(unit.counterTargetId ? { counterTargetId: unit.counterTargetId } : {}),
      };
      const nextModel = modelOf(next);
      const recover = (current, before, after, percent) =>
        Math.max(
          0,
          Math.min(
            after,
            (config.inheritResources && before > 0 ? (current / before) * after : 0) +
              (after * percent) / 100,
          ),
        );
      next.hp = Math.round(recover(unit.hp, oldModel.hp, nextModel.hp, config.hpRecoveryPercent));
      next.en = recover(unit.en, oldModel.en, nextModel.en, config.enRecoveryPercent);
      next.shield = recover(
        unit.shield,
        oldModel.shield.hp,
        nextModel.shield.hp,
        config.shieldRecoveryPercent,
      );
      if (!parts.shieldUsable(next, nextModel.shield)) next.shield = 0;
      if (nextModel.ship)
        next.moduleHp = Object.fromEntries(
          nextModel.modules.map((m) => [
            m.id,
            config.repairAllParts ? m.hp : (unit.moduleHp?.[m.id] ?? m.hp),
          ]),
        );
      next.heldWeapon = nextModel.weapons[0]?.id ?? null;
      return next;
    }
    function prepare(game, unit, skill) {
      const uses = {
        ...unit.skillUses,
        [usageKey(unit, skill)]: (unit.skillUses?.[usageKey(unit, skill)] || 0) + 1,
      };
      const oldModel = modelOf(unit);
      if (
        skill.source.mode === "keep" &&
        (skill.source.unitId !== oldModel.prefabId || skill.source.kitId !== oldModel.kitId)
      )
        return null;
      const source =
        skill.source.mode === "remove"
          ? null
          : resultUnit(
              unit,
              oldModel,
              skill.source,
              unit.id,
              unit.x,
              unit.y,
              uses,
              skill.consumeAction,
            );
      if (
        source &&
        (source.hp <= 0 ||
          (models[source.model].adaptability?.[game.environment ?? "ground"] ?? 100) <= 0 ||
          !fits({ ...game, units: game.units.filter((u) => u !== unit) }, source))
      )
        return null;
      const world = { ...game, units: game.units.filter((u) => u !== unit) };
      if (source) world.units.push(source);
      return { uses, oldModel, source, world };
    }
    function reconTargets(game, unit, skill) {
      if (skill.reconMode === "scan")
        return sensors.scanTargets(game, unit, skill.range, skill.waterOnly);
      return game.units.filter(
        (other) =>
          other.team !== unit.team &&
          other.hp > 0 &&
          !other.embarked &&
          dist(unit, other) <= skill.range &&
          (!skill.waterOnly || game.tiles[other.y][other.x] === "water") &&
          !(other.detectedBy?.[unit.team] >= game.round),
      );
    }
    function targets(game, unit, skillId) {
      if (!canUse(game, unit, skillId)) return [];
      const skill = of(unit).find((s) => s.id === skillId);
      if (["overdrive", "overboost", "fullboost", "flight", "minovsky"].includes(skill.type))
        return [{ x: unit.x, y: unit.y }];
      if (skill.type === "recon") {
        if (skill.reconMode === "camera") {
          const result = [];
          for (
            let y = Math.max(0, Math.ceil(unit.y - skill.range));
            y < Math.min(mapHeight(game), unit.y + skill.range + 1);
            y++
          )
            for (
              let x = Math.max(0, Math.ceil(unit.x - skill.range));
              x < Math.min(mapWidth(game), unit.x + skill.range + 1);
              x++
            )
              if (sensors.distance(unit, { x, y, groundTarget: true }) <= skill.range)
                result.push({ x, y });
          return result;
        }
        return skill.reconMode === "scan" || reconTargets(game, unit, skill).length
          ? [{ x: unit.x, y: unit.y }]
          : [];
      }
      if (skill.type === "repair")
        return game.units
          .filter(
            (other) =>
              other !== unit &&
              other.team === unit.team &&
              other.hp > 0 &&
              !other.embarked &&
              dist(unit, other) <= skill.range &&
              (other.hp < modelOf(other).hp ||
                other.en < modelOf(other).en ||
                other.shield < modelOf(other).shield.hp),
          )
          .map((other) => ({ x: other.x, y: other.y }));
      const plan = prepare(game, unit, skill);
      if (!plan) return [];
      if (!skill.spawn) return [{ x: unit.x, y: unit.y }];
      const probe = resultUnit(
        unit,
        plan.oldModel,
        skill.spawn,
        "__escape_probe__",
        unit.x,
        unit.y,
        plan.uses,
        skill.consumeAction,
      );
      if (
        probe.hp <= 0 ||
        (models[probe.model].adaptability?.[game.environment ?? "ground"] ?? 100) <= 0
      )
        return [];
      const cells = [],
        size = dimensions(unit);
      for (
        let y = Math.max(0, unit.y - skill.range);
        y <= Math.min(mapHeight(game) - 1, unit.y + size.height - 1 + skill.range);
        y++
      )
        for (
          let x = Math.max(0, unit.x - skill.range);
          x <= Math.min(mapWidth(game) - 1, unit.x + size.width - 1 + skill.range);
          x++
        )
          if (
            dist(unit, { x, y }) >= (skill.minRange ?? 0) &&
            dist(unit, { x, y }) <= skill.range &&
            fits(plan.world, probe, x, y)
          )
            cells.push({ x, y });
      return cells;
    }
    function use(game, unit, skillId, x, y) {
      if (
        !Number.isInteger(x) ||
        !Number.isInteger(y) ||
        !targets(game, unit, skillId).some((cell) => cell.x === x && cell.y === y)
      )
        throw Error("技能不可用，或目标不在合法范围内");
      const skill = of(unit).find((s) => s.id === skillId);
      if (skill.type === "flight") {
        unit.flying = !unit.flying;
        unit.actionPoints =
          (unit.actionPoints ?? modelOf(unit).actionPoints ?? 5) - skill.actionCost;
        unit.origin = null;
        return {
          type: "skill",
          skillId,
          unitId: unit.id,
          resultId: unit.id,
          from: { x: unit.x, y: unit.y },
          to: { x, y },
          effect: skill.effect,
          sound: skill.sound,
        };
      }
      if (skill.type === "overboost") {
        unit.en -= skill.enCost;
        unit.actionPoints =
          (unit.actionPoints ?? modelOf(unit).actionPoints ?? 5) - skill.actionCost;
        unit.overBoost = {
          skillId: skill.id,
          startedRound: game.round,
          moveBonus: skill.moveBonus,
          mobilityMultiplier: skill.mobilityMultiplier,
          hpDrainPercent: skill.hpDrainPercent,
        };
        unit.skillUses = {
          ...unit.skillUses,
          [usageKey(unit, skill)]: (unit.skillUses?.[usageKey(unit, skill)] || 0) + 1,
        };
        if (skill.consumeAction) {
          unit.acted = true;
          unit.actionPoints = 0;
        }
        unit.origin = null;
        return {
          type: "skill",
          skillId,
          unitId: unit.id,
          resultId: unit.id,
          from: { x: unit.x, y: unit.y },
          to: { x, y },
          effect: skill.effect,
          sound: skill.sound,
        };
      }
      if (skill.type === "fullboost") {
        unit.en -= skill.enCost;
        unit.fullBoost = {
          skillId: skill.id,
          remaining: skill.duration,
          cooldownTurns: skill.cooldownTurns,
          moveBonus: skill.moveBonus,
          mobilityMultiplier: skill.mobilityMultiplier,
        };
        unit.origin = null;
        return {
          type: "skill",
          skillId,
          unitId: unit.id,
          resultId: unit.id,
          from: { x: unit.x, y: unit.y },
          to: { x, y },
          effect: skill.effect,
          sound: skill.sound,
        };
      }
      if (skill.type === "overdrive") {
        const baseModel = unit.model,
          maximum = modelOf(unit).en;
        unit.en -= (maximum * skill.enPercent) / 100;
        unit.overdrive = {
          baseModel,
          remaining: skill.duration,
          skillId: skill.id,
          hpDrainPercent: skill.hpDrainPercent,
          enDrainPercent: skill.enDrainPercent,
        };
        unit.skillUses = {
          ...unit.skillUses,
          [usageKey(unit, skill)]: (unit.skillUses?.[usageKey(unit, skill)] || 0) + 1,
        };
        unit.model = skill.formUnitId + "__" + skill.formKits[models[baseModel].kitId];
        if (!models[unit.model].weapons.some((w) => w.id === unit.heldWeapon))
          unit.heldWeapon = models[unit.model].weapons[0]?.id || null;
        unit.origin = null;
        if (skill.consumeAction) {
          unit.acted = true;
          unit.actionPoints = 0;
        }
        return {
          type: "skill",
          skillId,
          unitId: unit.id,
          resultId: unit.id,
          from: { x: unit.x, y: unit.y },
          to: { x, y },
          effect: skill.effect,
          sound: skill.sound,
        };
      }
      if (skill.type === "minovsky") {
        const origin = center(unit);
        game.minovskyFields = (game.minovskyFields || []).filter(
          (field) => field.expiresRound > game.round,
        );
        game.minovskyFields.push({
          id: `minovsky_${game.round}_${game.minovskyFields.length}`,
          x: origin.x,
          y: origin.y,
          radius: skill.radius,
          expiresRound: game.round + skill.durationRounds,
        });
        unit.en -= skill.enCost;
        unit.actionPoints =
          (unit.actionPoints ?? modelOf(unit).actionPoints ?? 5) - skill.actionCost;
        unit.skillReadyRound = {
          ...unit.skillReadyRound,
          [skill.id]: game.round + skill.cooldownTurns * 2,
        };
        unit.skillUses = {
          ...unit.skillUses,
          [usageKey(unit, skill)]: (unit.skillUses?.[usageKey(unit, skill)] || 0) + 1,
        };
        if (skill.consumeAction) {
          unit.acted = true;
          unit.actionPoints = 0;
        }
        unit.origin = null;
        return {
          type: "skill",
          skillId,
          unitId: unit.id,
          resultId: unit.id,
          from: { x: unit.x, y: unit.y },
          to: { x, y },
          radius: skill.radius,
          expiresRound: game.round + skill.durationRounds,
          effect: skill.effect,
          sound: skill.sound,
        };
      }
      if (skill.type === "recon") {
        const targets = skill.reconMode === "camera" ? [] : reconTargets(game, unit, skill);
        if (skill.reconMode === "camera") {
          game.visionAreas = (game.visionAreas || []).filter(
            (area) => area.expiresRound > game.round,
          );
          game.visionAreas.push({
            team: unit.team,
            x,
            y,
            sight: skill.areaSight,
            radar: skill.areaRadar,
            expiresRound: game.round + skill.durationRounds,
          });
        }
        for (const other of targets)
          other.detectedBy = {
            ...other.detectedBy,
            [unit.team]: game.round + (skill.durationRounds ?? 2) - 1,
          };
        if (skill.cooldownTurns)
          unit.skillReadyRound = {
            ...unit.skillReadyRound,
            [skill.id]: game.round + skill.cooldownTurns * 2,
          };
        if (skill.actionCost)
          unit.actionPoints =
            (unit.actionPoints ?? modelOf(unit).actionPoints ?? 5) - skill.actionCost;
        unit.en -= skill.enCost;
        unit.skillUses = {
          ...unit.skillUses,
          [usageKey(unit, skill)]: (unit.skillUses?.[usageKey(unit, skill)] || 0) + 1,
        };
        if (skill.consumeAction) {
          unit.acted = true;
          unit.actionPoints = 0;
        }
        for (const other of game.units)
          if ((other.ownerSeat ?? other.team) === (unit.ownerSeat ?? unit.team))
            other.origin = null;
        return {
          type: "skill",
          skillId,
          unitId: unit.id,
          resultId: unit.id,
          reconMode: skill.reconMode,
          weaponDisplayIndex: skill.weaponDisplayIndex,
          from: { x: unit.x, y: unit.y },
          to: { x, y },
          effect: skill.effect,
          sound: skill.sound,
        };
      }
      if (skill.type === "repair") {
        const target = game.units.find(
          (other) =>
            other !== unit &&
            other.hp > 0 &&
            !other.embarked &&
            other.team === unit.team &&
            other.x === x &&
            other.y === y,
        );
        const targetModel = modelOf(target),
          before = { hp: target.hp, en: target.en, shield: target.shield };
        for (const [key, percent, maximum] of [
          ["hp", skill.hpRecoveryPercent, targetModel.hp],
          ["en", skill.enRecoveryPercent, targetModel.en],
          ["shield", skill.shieldRecoveryPercent, targetModel.shield.hp],
        ])
          target[key] = Math.min(maximum, target[key] + Math.round((maximum * percent) / 100));
        unit.en -= skill.enCost;
        unit.skillUses = {
          ...unit.skillUses,
          [usageKey(unit, skill)]: (unit.skillUses?.[usageKey(unit, skill)] || 0) + 1,
        };
        if (skill.consumeAction) {
          unit.acted = true;
          unit.actionPoints = 0;
        }
        for (const other of game.units)
          if ((other.ownerSeat ?? other.team) === (unit.ownerSeat ?? unit.team))
            other.origin = null;
        return {
          type: "skill",
          skillId,
          unitId: unit.id,
          resultId: unit.id,
          targetId: target.id,
          before,
          after: { hp: target.hp, en: target.en, shield: target.shield },
          from: { x, y },
          to: { x, y },
          effect: skill.effect,
          sound: skill.sound,
        };
      }
      const plan = prepare(game, unit, skill);
      let serial = game.nextUnitSerial || 0,
        spawned = null;
      if (skill.spawn) {
        let id;
        do {
          id = unit.id + "-escape-" + ++serial;
        } while (game.units.some((u) => u.id === id));
        spawned = resultUnit(
          unit,
          plan.oldModel,
          skill.spawn,
          id,
          x,
          y,
          plan.uses,
          skill.consumeAction,
        );
      }
      // All checks finish before mutation. Invalid destinations never consume a skill or remove a unit.
      for (const other of game.units)
        if ((other.ownerSeat ?? other.team) === (unit.ownerSeat ?? unit.team)) other.origin = null;
      const index = game.units.indexOf(unit);
      if (plan.source) {
        delete unit.overdrive;
        delete unit.snipeOrder;
        delete unit.rotationPivot;
        const baseForm = unit.defaultFormModel || unit.model;
        Object.assign(unit, plan.source);
        delete unit.flying;
        if (skill.type === "transform" && unit.model !== baseForm) unit.defaultFormModel = baseForm;
        else delete unit.defaultFormModel;
      } else game.units.splice(index, 1);
      if (spawned) game.units.push(spawned);
      game.nextUnitSerial = serial;
      return {
        type: "skill",
        skillId,
        unitId: unit.id,
        resultId: spawned?.id ?? unit.id,
        from: { x: unit.x, y: unit.y },
        to: { x, y },
        effect: skill.effect,
        sound: skill.sound,
      };
    }
    function revertDamaged(unit) {
      if (!Object.values(unit.brokenParts || {}).some(Boolean)) return false;
      let changed = !!unit.flying;
      delete unit.flying;
      if (unit.overdrive && unit.brokenParts?.head) {
        endOverdrive(unit);
        changed = true;
      }
      if (unit.defaultFormModel) {
        unit.model = unit.defaultFormModel;
        delete unit.defaultFormModel;
        const base = modelOf(unit);
        unit.hp = Math.min(unit.hp, base.hp);
        unit.en = Math.min(unit.en, base.en);
        unit.shield = Math.min(unit.shield, base.shield.hp);
        if (!base.weapons.some((w) => w.id === unit.heldWeapon))
          unit.heldWeapon = base.weapons[0]?.id;
        changed = true;
      }
      if (changed) {
        unit.origin = null;
        delete unit.snipeOrder;
      }
      return changed;
    }
    function endOverdrive(unit) {
      if (!unit.overdrive) return false;
      unit.model = unit.overdrive.baseModel;
      delete unit.overdrive;
      const base = modelOf(unit);
      unit.hp = Math.min(unit.hp, base.hp);
      unit.en = Math.min(unit.en, base.en);
      unit.shield = Math.min(unit.shield, base.shield.hp);
      if (!base.weapons.some((w) => w.id === unit.heldWeapon))
        unit.heldWeapon = base.weapons[0]?.id ?? null;
      unit.origin = null;
      return true;
    }
    return { of, canUse, targets, use, endOverdrive, revertDamaged };
  }
  return { validate, create };
})();
if (typeof module !== "undefined") module.exports = UnitSkills;
