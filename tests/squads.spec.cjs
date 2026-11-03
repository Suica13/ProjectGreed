const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

async function open(page) {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.evaluate(async () => {
    Net.leave();
    session++;
    const entry = { unitId: "RGM_79", kitId: "machine_gun" };
    game = Rules.create(false, 1, [[entry], [entry]], false, { fogMode: "disabled" });
    const source = game.units[0],
      enemy = game.units[1];
    const members = Array.from({ length: 3 }, (_, index) => ({
      ...structuredClone(source),
      id: "squad-" + index,
      x: 5,
      y: 5,
      squadId: "browser-squad",
      squadSlot: index,
      hp: 100000,
      en: 10000,
      actionPoints: 10,
    }));
    Object.assign(enemy, { x: 5, y: 6, hp: 100000, en: 10000 });
    game.units = [...members, enemy];
    game.tiles.forEach((row) => row.fill("plain"));
    game.deployment = null;
    phase = "idle";
    pending = moving = battleView = null;
    selected = members[0].id;
    mode = "select";
    squadSingleMove = false;
    squadCombatMode = "melee";
    await SpriteRenderer.ensureModels(game.units.map((unit) => unit.model));
    setPageView("game");
    update();
  });
}

test("counter target can switch between incoming attackers and remains selected", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    const attackers = game.units.slice(0, 3),
      defender = game.units.at(-1);
    attackers.forEach((unit, index) => Object.assign(unit, { x: 4 + index, y: 5, squadId: null }));
    const weapon = Rules.modelOf(attackers[0]).weapons.find((w) => w.type !== "melee");
    pending = {
      id: "counter-switch",
      attacker: attackers[0].id,
      target: defender.id,
      weapon: weapon.id,
      weapons: [weapon.id],
      counterTargets: attackers.map((unit) => ({
        attacker: unit.id,
        weapon: weapon.id,
        weapons: [weapon.id],
      })),
    };
    phase = "reaction";
    response = "counter";
    counterTargetId = attackers[0].id;
    counterDraftState = null;
    renderReaction();
    byId("reaction").hidden = false;
    update();
  });
  await page.locator("#counterTarget").selectOption("squad-1");
  expect(await page.evaluate(() => counterChoices()[0].counterTargetId)).toBe("squad-1");
  await page.locator('.incoming-entry[data-unit-id="squad-2"]').click();
  expect(await page.evaluate(() => counterChoices()[0].counterTargetId)).toBe("squad-2");
});

for (const width of [1440, 390])
  test(`offline counter selects the whole incoming squad at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await page.evaluate(() => {
      const a = game.units[0],
        b = game.units.at(-1);
      beginAttack(a, b, Rules.automaticSquadQueue(game, a, b)[0]);
    });
    await expect(page.locator("#counterTarget option")).toHaveCount(1);
    await page.evaluate(() => selectCounterTarget("squad-2"));
    expect(await page.evaluate(() => counterChoices()[0].counterTargetId)).toBe("squad-0");
    await page.evaluate(() => {
      renderReaction();
      update();
    });
    await expect(page.locator("#counterTarget")).toHaveValue("squad-0");
    await page.locator("#confirmResponse").click();
    await expect(page.locator("#reaction")).toBeHidden();
    expect(
      await page.evaluate(() =>
        battleView.battles.some((event) => event.combatStage === "counter"),
      ),
    ).toBe(true);
  });

for (const width of [1440, 390])
  test(`squad controls select three members without front/rear controls at width ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page);
    await expect(page.locator("#hudSquad")).toBeVisible();
    await expect(page.locator("[data-squad-member]")).toHaveCount(3);
    await expect(page.locator("#squadSelectAll")).toHaveAttribute("aria-pressed", "true");
    await page.locator('[data-squad-member="squad-2"]').click();
    await expect(page.locator('[data-squad-member="squad-2"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator("#squadSelectAll")).toHaveAttribute("aria-pressed", "false");
    await page.locator("#squadSelectAll").click();
    await expect(page.locator("#squadSelectAll")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#hudSquad")).toContainText("3/3");
    await expect(page.locator("#hudSquad")).not.toContainText("前排");
    await expect(page.locator("#hudSquad")).not.toContainText("后排");
    await page.locator("#squadCombatMode").click();
    await expect(page.locator("#squadCombatMode")).toHaveText("射击战");
    const bounds = await page.locator("#hudSquad").boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    expect(errors).toEqual([]);
  });

test("single-unit exit goes through ordinary move confirmation and leaves two members behind", async ({
  page,
}) => {
  await open(page);
  await page.locator("#squadCombatMode").click();
  await page.locator('[data-squad-member="squad-0"]').click();
  await page.locator('[data-unit-command="move"]').click();
  await page.evaluate(() => performMove(getUnit(selected), 6, 5));
  await expect(page.locator("#hudConfirmMove")).toBeEnabled();
  await page.locator("#hudConfirmMove").click();
  const result = await page.evaluate(() => ({
    departed: { x: getUnit(selected).x, squadId: getUnit(selected).squadId },
    remaining: game.units.filter((u) => u.squadId === "browser-squad").map((u) => [u.x, u.y]),
  }));
  expect(result.departed).toEqual({ x: 6, squadId: undefined });
  expect(result.remaining).toEqual(Array(2).fill([5, 5]));
  expect(await page.evaluate(() => squadCombatMode)).toBe("melee");
});

test("repeated misses dodge between offset positions without centering after each dodge", async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(() => {
    const from = game.units[0],
      to = game.units.at(-1),
      native = Rules.modelOf(from).weapons.find((w) => w.type !== "melee");
    const actors = [from, to].map((unit) => ({
      unit,
      x: unit.x * 64,
      y: unit.y * 64,
      scale: 1,
      angle: 0,
      arenaWidth: 2000,
      arenaHeight: 2000,
    }));
    const weapon = {
      ...native,
      attack: {
        ...native.attack,
        shots: [0, 2, 4],
        strikes: [0, 1, 2].map((index) => ({
          ...native.attack.strikes[0],
          at: index * 2,
          shotIndex: index,
          hitIndex: index,
        })),
        muzzleIndices: [0, 0, 0],
        muzzleShotIndices: [0, 1, 2],
      },
    };
    const event = {
      from: from.id,
      to: to.id,
      weapon: native.id,
      hit: false,
      damage: 0,
      before: to.hp,
      after: to.hp,
      targetDodgeSlot: 0,
      strikes: [0, 1, 2].map((index) => ({
        shotIndex: index,
        hitIndex: index,
        executed: true,
        hit: false,
        damage: 0,
        dodgeTo: index % 2 ? 0 : 1,
      })),
    };
    const plan = WeaponEffects.plan(weapon, actors[0], actors[1], event);
    return plan.moves.map((move) => ({ from: move.from, to: move.to }));
  });
  expect(result.length).toBeGreaterThanOrEqual(2);
  expect(result.every((move) => move.to !== 0)).toBe(true);
  expect(result.slice(1).every((move) => Math.abs(move.from) >= 0.7)).toBe(true);
});

test("large cells render squad members at the same scale as a standalone unit", async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(() => {
    const scales = [],
      original = SpriteRenderer.draw;
    SpriteRenderer.draw = function (...args) {
      if (args[1] === game.units[0].model) scales.push(args[4]);
      return original.apply(this, args);
    };
    MapCamera.focus(5, 5);
    drawMap(performance.now());
    SpriteRenderer.draw = original;
    return {
      scales,
      span: Rules.mapCellPixels,
      groupScale: Rules.squadOffset(game, game.units[0]).scale,
    };
  });
  expect(result.span).toBe(160);
  expect(result.groupScale).toBe(1);
  expect(result.scales.length).toBeGreaterThanOrEqual(4);
  expect(result.scales.every((scale) => Math.abs(scale - result.scales[0]) < 0.0001)).toBe(true);
  await page.screenshot({ path: "tmp/squad-large-grid.png" });
});

test("hangar launch can be confirmed onto a two-member squad", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const passenger = game.units[0];
    const carrier = {
      ...structuredClone(passenger),
      id: "browser-carrier",
      x: 6,
      y: 5,
      model: Object.keys(Rules.models).find((id) => id.startsWith("PegasusClass__")),
    };
    delete carrier.squadId;
    delete carrier.squadSlot;
    game.units.push(carrier);
    Rules.hangars.embark(game, passenger, carrier, Rules.hangars.of(carrier)[0].id);
    passenger.embarked.boardRound = game.round - 2;
    passenger.acted = passenger.moved = false;
    selected = passenger.id;
    PlanningUI.move(Rules.hangars.previewLaunch(game, passenger, 5, 5));
    update();
  });
  await expect(page.locator("#hudConfirmMove")).toBeEnabled();
  await page.locator("#hudConfirmMove").click();
  const result = await page.evaluate(() => ({
    embarked: game.units[0].embarked,
    count: Rules.squadMembers(game, game.units[0]).length,
    position: [game.units[0].x, game.units[0].y],
  }));
  expect(result).toEqual({ embarked: undefined, count: 3, position: [5, 5] });
});

test("completed melee fighters return home before unmatched members approach", async ({ page }) => {
  await open(page);
  const result = await page.evaluate(() => {
    const a = game.units[0],
      b = game.units.at(-1);
    const base = Rules.models[a.model],
      sword = base.weapons.find((w) => w.type === "melee");
    Rules.models[a.model] = {
      ...base,
      weapons: [
        {
          ...structuredClone(sword),
          en: 0,
          hit: 0,
          attack: {
            ...sword.attack,
            strikes: sword.attack.strikes.map((strike) => ({ ...strike, accuracy: 0 })),
          },
        },
      ],
    };
    b.squadId = "enemy-squad";
    b.squadSlot = 0;
    game.units.forEach((unit) => {
      unit.hp = 100000000;
    });
    const room = { game, matchId: "squad-yield" };
    let id = 0;
    const planner = createAttackPlanner(Rules, () => "yield-" + ++id);
    planner.reset(room);
    planner.plan(room, a, b, null, 0);
    planner.prepare(room);
    planner.choose(room, room.pending.id, "defend");
    const battles = planner.resolve(room);
    const pairs = [...new Set(battles.map((battle) => battle.meleeExchange))].sort(
      (x, y) => x.start - y.start,
    );
    MapCombat.reset();
    MapCombat.seed(battles);
    battleView = {
      a: a.id,
      b: b.id,
      battles,
      actors: battles.flatMap((battle) => battle.actors),
      events: battles.flatMap((battle) => battle.events),
      index: 0,
      completed: false,
    };
    phase = "battle";
    const zero = performance.now();
    MapCombat.update(zero);
    MapCombat.begin(battleView, () => 0);
    const rate = MovementTiming.combatRate(false, false);
    const capture = (time) => {
      MapCombat.update(zero + (time * 1000) / rate);
      const units = MapCombat.units();
      return [a.id, game.units[1].id].map((id) => units.find((unit) => unit.id === id)?.mapPose);
    };
    MapCombat.update(zero);
    const before = capture(pairs[0].end - pairs[0].retreat - 0.01);
    const after = capture(pairs[0].end + 0.01);
    const later = capture(pairs[1].start + 0.2);
    const offset = MapCombat.formationOffset(a);
    return {
      before,
      after,
      later,
      homeX: (Rules.center(a).x + 0.5 + offset.x) * Rules.mapCellPixels,
      starts: pairs.map((pair) => pair.start),
      positions: game.units.slice(0, 3).map((unit) => [unit.x, unit.y]),
    };
  });
  expect(result.starts.length).toBe(3);
  expect(
    Math.hypot(result.after[0].x - result.before[0].x, result.after[0].y - result.before[0].y),
  ).toBeGreaterThan(20);
  expect(result.after[0].x).toBeCloseTo(result.homeX, 5);
  expect(result.later[0].x).toBeCloseTo(result.after[0].x, 5);
  expect(result.later[0].y).toBeCloseTo(result.after[0].y, 5);
  expect(result.positions).toEqual(Array(3).fill([5, 5]));
});

test("selection frames enclose a squad once, while individual noncombat selection stays separate", async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(() => {
    const poses = game.units
      .slice(0, 3)
      .map((u, i) => ({ u, pos: { x: 100 + i * 48, y: 100 }, unitSize: { width: 1, height: 1 } }));
    const marks = poses.map(({ u }) => ({ unitId: u.id, kind: "selected", group: true }));
    const frames = PlanningUI.selectionFrames(poses, marks, 160);
    const targets = PlanningUI.selectionFrames(
      poses,
      marks.map((mark) => ({ ...mark, kind: "target" })),
      160,
    );
    const individual = PlanningUI.selectionFrames(poses, [{ ...marks[1], group: false }], 160);
    return { frames, targets, individual };
  });
  expect(result.frames).toHaveLength(1);
  expect(result.targets).toHaveLength(1);
  expect(result.frames[0].width).toBe(160);
  expect(result.frames[0].height).toBe(160);
  expect(result.individual).toHaveLength(1);
  expect(result.individual[0].width).toBeLessThan(result.frames[0].width);
});

test("drawing other squad members never clears the selected squad's attack draft", async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(() => {
    const attacker = game.units[0],
      target = game.units.at(-1);
    AttackControls.choose(attacker, target);
    const unrelated = AttackControls.draft(game.units[1]);
    drawMap(performance.now());
    drawMap(performance.now() + 16);
    return { unrelated, selected: AttackControls.draft(attacker)?.targetId, expected: target.id };
  });
  expect(result.unrelated).toBe(null);
  expect(result.selected).toBe(result.expected);
});

for (const width of [1440, 390])
  test(`whole squad plan has one framed card per member, individual mode has one at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await page.evaluate(() => AttackControls.choose(game.units[0], game.units.at(-1)));
    await expect(page.locator("#attackEditor [data-attack-member]")).toHaveCount(3);
    for (const card of await page.locator("#attackEditor [data-attack-member]").all()) {
      await expect(card.locator(".hud-attack-member-heading img")).toHaveCount(1);
      await expect(card.locator(".hud-attack-member-heading span")).toContainText("EN");
      expect(await card.locator(".weapon").count()).toBeGreaterThan(0);
    }
    const facing = await page.evaluate(() => {
      const target = game.units.at(-1);
      const result = game.units.slice(0, 3).map((unit) => PlanningUI.facing(unit));
      const tip = Rules.squadOffset(game, game.units[1], result[0]);
      return {
        result,
        tip,
        mutated: game.units.slice(0, 3).some((unit) => unit.acted),
        targetY: target.y,
      };
    });
    expect(new Set(facing.result).size).toBe(1);
    expect(facing.tip.y).toBeGreaterThan(0);
    expect(facing.mutated).toBe(false);
    await page.screenshot({ path: `tmp/squad-plan-${width}.png` });
    await page.locator('[data-squad-member="squad-2"]').click();
    await page.evaluate(() => AttackControls.choose(getUnit(selected), game.units.at(-1)));
    await expect(page.locator("#attackEditor [data-attack-member]")).toHaveCount(1);
    await expect(page.locator('#attackEditor [data-attack-member="squad-2"]')).toBeVisible();
    await page.locator("#confirmAttackQueue").click();
    expect(await page.evaluate(() => pending.single)).toBe(true);
    await page.locator("#confirmResponse").click();
    expect(await page.evaluate(() => game.units.slice(0, 3).map((unit) => unit.acted))).toEqual([
      false,
      false,
      true,
    ]);
  });

test("whole squad uses the longest attack range, individual selection uses only that member", async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(() => {
    const base = Rules.modelOf(game.units[0]);
    for (const [index, range] of [1, 2, 5].entries()) {
      const id = "range-test-" + index;
      Rules.models[id] = {
        ...base,
        weapons: base.weapons
          .filter((w) => w.type !== "melee")
          .map((w) => ({ ...w, min: 1, max: range })),
      };
      SpriteRenderer.models[id] = SpriteRenderer.models[game.units[index].model];
      game.units[index].model = id;
    }
    const target = game.units.at(-1);
    Object.assign(target, { x: 5, y: 9 });
    select(game.units[0].id);
    const all = AttackControls.canTarget(game.units[0], target);
    const allArea = mapRanges(game.units[0], false, null, true).attackArea.has(Rules.key(5, 9));
    select(game.units[0].id, { single: true });
    return {
      all,
      allArea,
      single: AttackControls.canTarget(game.units[0], target),
      singleArea: mapRanges(game.units[0], false, null, true).attackArea.has(Rules.key(5, 9)),
    };
  });
  expect(result).toEqual({ all: true, allArea: true, single: false, singleArea: false });
});

for (const width of [1440, 390])
  test(`counter UI defaults to the defending squad and supports member overrides at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await page.evaluate(() => {
      const enemy = game.units.at(-1);
      const defenders = [
        enemy,
        ...[1, 2].map((i) => ({ ...structuredClone(enemy), id: "counter-member-" + i })),
      ];
      defenders.forEach((unit, index) =>
        Object.assign(unit, { squadId: "counter-squad", squadSlot: index }),
      );
      game.units.push(...defenders.slice(1));
      const unit = game.units[0],
        weapon = Rules.automaticSquadQueue(game, unit, enemy)[0];
      beginAttack(unit, enemy, weapon);
    });
    await expect(page.locator("#reaction")).toBeVisible();
    await expect(page.locator("#squadSelectAll")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#counterList [data-attack-member]")).toHaveCount(3);
    await page.locator('[data-squad-member="counter-member-2"]').click();
    await expect(page.locator("#counterList [data-attack-member]")).toHaveCount(1);
    await page.locator("#responseEvade").click();
    await page.locator("#squadSelectAll").click();
    await expect(page.locator("#counterList [data-attack-member]")).toHaveCount(3);
    expect(await page.evaluate(() => counterChoices().map((choice) => choice.response))).toEqual([
      "counter",
      "counter",
      "evade",
    ]);
    await page.screenshot({ path: `tmp/squad-counter-${width}.png` });
    await page.locator("#confirmResponse").click();
    await expect(page.locator("#reaction")).toBeHidden();
    expect(
      await page.evaluate(() =>
        battleView.battles
          .filter((battle) => battle.combatStage === "counter")
          .some((battle) => battle.a === "counter-member-2"),
      ),
    ).toBe(false);
  });

test("whole squad can board through the hangar panel", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const passenger = game.units[0];
    const carrier = { ...structuredClone(passenger), id: "browser-carrier", x: 6, y: 5,
      model: Object.keys(Rules.models).find((id) => id.startsWith("PegasusClass__")) };
    delete carrier.squadId; delete carrier.squadSlot;
    game.units.push(carrier);
    squadSingleMove = false;
    HangarUI.open(passenger);
    HangarUI.click({x:carrier.x,y:carrier.y});
  });
  await page.locator('[data-board-id="squad-0"]').first().click();
  expect(await page.evaluate(() => Rules.hangars.cargo(game, getUnit("browser-carrier")).length)).toBe(3);
});

for (const width of [1440, 390]) test(`counter panel can choose squad C when B and C attack different members at ${width}px`, async ({ page }) => {
  await page.setViewportSize({width, height:900});
  await open(page);
  await page.evaluate(() => {
    const source = game.units[0], defender = game.units.at(-1);
    const second = [0,1,2].map(i=>({...structuredClone(source),id:"group-c-"+i,squadId:"group-c",squadSlot:i,x:6,y:6}));
    const defenders = [defender, ...[1,2].map(i=>({...structuredClone(defender),id:"defender-"+i}))];
    defenders.forEach((u,i)=>Object.assign(u,{squadId:"defenders",squadSlot:i}));
    game.units.push(...second,...defenders.slice(1));
    let seq=0;
    const planner=createAttackPlanner(Rules,()=>"browser-"+(++seq));
    const room={game};planner.reset(room);
    planner.plan(room,source,defender,null,0,"shooting");
    planner.plan(room,second[0],defenders[1],null,0,"shooting");
    planner.prepare(room);
    pending=room.pending;phase="reaction";response="counter";
    counterTargetId=pending.attacker;counterDraftState=null;
    renderReaction();byId("reaction").hidden=false;update();
  });
  await expect(page.locator("#counterTarget option")).toHaveCount(2);
  await page.locator("#counterTarget").selectOption("group-c-0");
  expect(await page.evaluate(()=>counterChoices().map(c=>c.counterTargetId))).toEqual(["group-c-0","group-c-0","group-c-0"]);
  await page.evaluate(()=>{renderReaction();update();});
  await expect(page.locator("#counterTarget")).toHaveValue("group-c-0");
});
