const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
async function open(page) {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
}
test("a composed multipart shadow stays 25 percent in both single and overlapping regions", async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(() => {
    const id = "Type61__standard",
      model = SpriteRenderer.models[id],
      saved = structuredClone(model),
      oldSetting = ClientSettings.unitShadows;
    const patch = document.createElement("canvas");
    patch.width = patch.height = 20;
    patch.getContext("2d").fillRect(0, 0, 20, 20);
    SpriteRenderer.images["shadow-test-patch"] = patch;
    model.bones.shadowTest = { x: 0, y: 0 };
    model.decals = [
      {
        name: "shadowTestA",
        bone: "shadowTest",
        asset: "shadow-test-patch",
        worldOffset: { x: 0, y: 0 },
      },
      {
        name: "shadowTestB",
        bone: "shadowTest",
        asset: "shadow-test-patch",
        worldOffset: { x: 10, y: 0 },
      },
    ];
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 300;
    const ctx = canvas.getContext("2d");
    ClientSettings.unitShadows = () => true;
    globalThis.ProjectGreedMapLighting = {
      direction: "lower",
      horizontalAngle: 0,
      distance: 2,
      intensity: 0.25,
    };
    try {
      SpriteRenderer.draw(ctx, id, 100, 50, 1, 0, "shadowTest", 0);
      return [95, 105, 115].map((x) => ctx.getImageData(x, 178, 1, 1).data[3]);
    } finally {
      SpriteRenderer.models[id] = saved;
      ClientSettings.unitShadows = oldSetting;
    }
  });
  expect(result).toEqual([64, 64, 64]);
});
test("first dialogue batch draws foreground bubbles for ordinary and destroyed pilots at distant zoom", async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(() => {
    Net.leave();
    const e = { unitId: "Type61", kitId: "standard" };
    game = Rules.create(false, 1, [[e], [e]], false);
    game.units[1].hp = 0;
    lastNetworkDialogueId = null;
    lastNetworkDialogueMatch = null;
    receiveBattleDialogue([], "bubble-test");
    const text = ["目标击破。", "机体受损，脱出！"];
    receiveBattleDialogue(
      game.units.map((u, i) => ({
        id: "speech-" + i,
        speakerId: u.id,
        pilotName: "联邦军驾驶员",
        defeatUnitId: game.units[1].id,
        text: text[i],
        position: { x: 3 + i, y: 3 },
      })),
      "bubble-test",
    );
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 300;
    const ctx = canvas.getContext("2d");
    const printed = [], textPositions = [];
    const fill = ctx.fillText.bind(ctx);
    ctx.fillText = (text, ...args) => {
      printed.push(text);
      textPositions.push({x:args[0], y:args[1], align:ctx.textAlign, baseline:ctx.textBaseline});
      fill(text, ...args);
    };
    MapCamera.setPercent(50);
    mapGeo = { tile: 12, ox: 0, oy: 0 };
    const snapshotDescriptor=Object.getOwnPropertyDescriptor(Net,"snapshot"),oldHealth=MapCombat.health,oldView=battleView;
    Object.defineProperty(Net,"snapshot",{configurable:true,value:{phase:"playback",playback:{id:"dialogue-playback"}}});
    battleView={networkId:"dialogue-playback"};MapCombat.health=()=>100;
    drawDialogueBubbles(ctx,new Map(),{visibleIds:[]},400,300,performance.now());
    const beforeImpact=printed.length;MapCombat.health=()=>0;
    drawDialogueBubbles(
      ctx,
      new Map(),
      { visibleIds: [] },
      400,
      300,
      performance.now(),
    );
    Object.defineProperty(Net,"snapshot",snapshotDescriptor);MapCombat.health=oldHealth;battleView=oldView;
    const entry = BattleDialogue.generate({
      event: "defeat",
      speaker: game.units[1],
      sequence: 1,
    });
    entry.unitName = Rules.unitLogName(game.units[1]);
    return {
      printed, textPositions, beforeImpact,
      count: dialogueBubbles.size,
      line: BattleDialogue.format(entry),
    };
  });
  expect(result.printed).toEqual(["联邦军驾驶员:", "目标击破。", "联邦军驾驶员:", "机体受损，脱出！"]);
  for (let i = 0; i < result.textPositions.length; i += 2) {
    const [name, speech] = result.textPositions.slice(i, i + 2);
    expect(name.align).toBe("center"); expect(name.baseline).toBe("middle");
    expect(speech.x).toBe(name.x); expect(speech.y - name.y).toBe(20);
  }
  expect(result.count).toBe(2);expect(result.beforeImpact).toBe(0);
  expect(result.line).toContain("[No.1]");
});
test("selection reuses the roster and action availability while updating the chosen pilot", async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(() => {
    Net.leave();
    session++;
    const e = { unitId: "RGM_79", kitId: "machine_gun" };
    game = Rules.create(false, 1, [[e], [e]], false, { fogMode: "disabled" });
    game.tiles.forEach((row) => row.fill("plain"));
    const source = game.units[0];
    game.units = Array.from({ length: 120 }, (_, i) => ({
      ...structuredClone(source),
      id: "perf-" + i,
      x: 2 + (i % 30),
      y: 2 + Math.floor(i / 30) * 2,
      team: i < 60 ? 0 : 1,
      ownerSeat: i < 60 ? 0 : 1,
    }));
    game.deployment = null;
    game.ai = false;
    phase = "idle";
    pending = moving = battleView = null;
    selected = null;
    mode = "select";
    setPageView("game");
    update();
    const first = byId("unitRoster").querySelector(".roster-unit"),
      saved = Rules.hasActions;
    let scans = 0;
    Rules.hasActions = (...args) => {
      scans++;
      return saved(...args);
    };
    const samples = [];
    try {
      for (let i = 0; i < 6; i++) {
        const start = performance.now();
        select(game.units[i].id);
        samples.push(performance.now() - start);
      }
    } finally {
      Rules.hasActions = saved;
    }
    Rules.hasActions = (...args) => {
      scans++;
      return saved(...args);
    };
    game.units[5].moved = true;
    game.units[5].en -= 1;
    update();
    Rules.hasActions = saved;
    const movingReused =
      first === byId("unitRoster").querySelector(".roster-unit");
    const status = byId("unitRoster").querySelector(
      '[data-unit-id="perf-5"] .roster-status',
    ).textContent;
    return {
      samples,
      scans,
      movingReused,
      status,
      reused: first === byId("unitRoster").querySelector(".roster-unit"),
      selected: byId("unitRoster").querySelector(".selected")?.dataset.unitId,
    };
  });
  console.log("SELECTION_PROFILE", JSON.stringify(result));
  expect(result.reused).toBe(true);
  expect(result.scans).toBe(1);
  expect(result.movingReused).toBe(true);
  expect(result.status).toContain("已移动");
  expect(result.selected).toBe("perf-5");
});
for (const width of [1280, 390])
  test(`weather and day-night room settings are in a collapsed independent panel at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await page.locator("#openSkirmish").click();
    await page.locator("#createOfflineRoom").click();
    if (width < 700) await page.locator('[data-room-tab="settings"]').click();
    const panel = page.locator("#roomClimateOptions");
    await expect(panel).toHaveCount(1);
    await panel.evaluate((el) => {
      for (let p = el.parentElement; p; p = p.parentElement)
        if (p.tagName === "DETAILS") p.open = true;
    });
    expect(await panel.evaluate((el) => el.open)).toBe(false);
    await expect(page.locator("#roomWeather")).toBeHidden();
    await panel.locator("summary").click();
    await expect(page.locator("#roomWeather")).toBeVisible();
    await page.locator("#roomWeather").selectOption("rain");
    await expect
      .poll(() => page.evaluate(() => Net.snapshot.settings.weather))
      .toBe("rain");
    await panel.locator("summary").click();
    await expect(page.locator("#roomWeather")).toBeHidden();
  });

for (const viewport of [{width:320,height:640}, {width:390,height:844}, {width:430,height:932}]) {
  test(`phone workshop keeps all card content inside its own row at ${viewport.width}px`, async ({page}) => {
    await page.setViewportSize(viewport);
    await open(page);
    await page.evaluate(() => { I18n.setLanguage("zh"); MenuShell.go("production"); });
    await expect(page.locator("#productionList > .production-unit").first()).toBeVisible();
    for (const language of ["zh", "en"]) {
      await page.evaluate(language => I18n.setLanguage(language), language);
      await page.locator("#productionSearch").fill("吉姆");
      await page.locator("#productionSearch").fill("");
      await page.waitForTimeout(100);
      const rows = await page.locator("#productionList > .production-unit").evaluateAll(cards => cards.slice(0,20).map(card => {
        const bounds=card.getBoundingClientRect();
        const blocks=[...card.querySelectorAll(".production-unit-portrait, .production-unit-info, .unit-line-heading, .unit-line-meta, .production-unit-footer")];
        return {height:bounds.height, overflow:blocks.filter(block=> {
          const r=block.getBoundingClientRect();
          return r.top<bounds.top-1 || r.bottom>bounds.bottom+1 || r.right>bounds.right+1;
        }).map(block=>block.className)};
      }));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) { expect(row.height).toBeGreaterThanOrEqual(112); expect(row.overflow).toEqual([]); }
    }
    if (viewport.width===390) {
      await page.evaluate(() => I18n.setLanguage("zh"));
      await page.locator("#productionFaction").selectOption("EFSF");
      await page.locator("#productionEra").selectOption("0079T1");
      await page.locator("#productionType").selectOption("type:MS");
      await page.screenshot({path:"tmp/verification/screenshots/workshop-mobile-readable.png"});
    }
  });
}

test("dialogue log filters accept both arrow-prefixed and existing dialogue records", async ({page}) => {
  await open(page);
  const result = await page.evaluate(() => {
    I18n.setLanguage("zh");
    Chat.setLog(["→ [战场对话][EFSF][驾驶员]「正在掩护。」", "[战场对话][EFSF][驾驶员]「旧记录。」", "普通交战记录"], []);
    const filter=byId("battleLogView");
    filter.value="dialogue"; filter.dispatchEvent(new Event("change"));
    const dialogue=byId("log").textContent;
    filter.value="combat"; filter.dispatchEvent(new Event("change"));
    return {dialogue, combat:byId("log").textContent};
  });
  expect(result.dialogue).toContain("→ [战场对话]");
  expect(result.dialogue).toContain("旧记录");
  expect(result.dialogue).not.toContain("普通交战记录");
  expect(result.combat).toBe("普通交战记录");
});
