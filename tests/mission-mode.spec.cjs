const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const width of [1440, 390])
  test(`mission dialogue portraits, camera and restored control at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 950 });
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await expect(page.locator("#openSkirmish")).toBeEnabled({ timeout: 20000 });
    await page.evaluate(() => {
      Economy.creditActivity({
        id: "briefing-mission-fixture",
        matchId: "briefing-mission-fixture",
        money: 0,
        supplies: 0,
        inventory: { ColumbusClass: 1 },
      });
      window.briefingSonars = 0;
      const audioPlay = GameAudio.play;
      GameAudio.play = (key) => { if (key === "sonarSound") window.briefingSonars++; return audioPlay(key); };
      const factory = createRoomEngine;
      createRoomEngine = (options) =>
        (window.missionEngine = factory({ ...options, aiDelayMs: 999999 }));
      const focus = MapCamera.focus;
      MapCamera.focus = (x, y, options) => {
        window.missionFocus = { x, y };
        focus(x, y, options);
      };
    });
    await page.locator("#openSkirmish").click();
    await page.locator("#createOfflineRoom").click();
    await page.locator("#offlineRoomMode").selectOption("mission");
    await page.locator("#confirmOfflineMode").click();
    await expect.poll(() => page.evaluate(() => Net.snapshot?.settings.mode)).toBe("mission");
    await page.evaluate(() => {
      const ship = Economy.snapshot().storage.ships.find((u) => u.unitId === "ColumbusClass");
      Net.request("start_game", {
        formation: [{ unitId: ship.unitId, kitId: ship.kitId, stockId: ship.id }],
      });
    });
    await expect(page.locator("#confirmFinalFormation")).toBeVisible();
    await page.locator("#confirmFinalFormation").click();
    await expect.poll(() => page.evaluate(() => Net.snapshot.phase)).toBe("deployment");
    const briefing = page.locator("#operationBriefing");
    await expect(briefing).toBeVisible();
    await expect(briefing).toHaveAttribute("data-mode", "mission");
    await expect(briefing).toContainText("消灭所有敌人");
    await expect(briefing).toContainText("保护目标被击坠");
    const goals = briefing.locator(".briefing-goal");
    expect(await goals.count()).toBeGreaterThan(1);
    await goals.last().click();
    await expect(goals.last()).toHaveClass(/active/);
    await expect(briefing.locator(".briefing-marker.active")).toBeVisible();
    await page.screenshot({ path: `tmp/verification/screenshots/briefing-mission-${width}.png` });
    await briefing.locator("footer").getByRole("button", { name: "关闭", exact: true }).click();

    await page.evaluate(() => Deployment.choose(game.units.find(u=>u.ownerSeat===0 && !u.missionActor && Rules.modelOf(u).ship)));
    const shipId = await page.evaluate(()=>selected);
    const facing = await page.evaluate(id=>getUnit(id).angle,shipId);
    await expect(page.locator("#deploymentTurnRight")).toBeVisible();
    for (let i=1;i<=4;i++) {
      await page.locator("#deploymentTurnRight").click();
      await expect.poll(()=>page.evaluate(id=>getUnit(id).angle,shipId)).toBe((facing+i*90)%360);
    }
    await page.evaluate(() => Net.request("auto_place_deployment"));
    await expect.poll(() => page.evaluate(() => !!Net.awaiting)).toBe(false);
    await page.evaluate(() => Net.request("confirm_deployment"));
    const dialog = page.locator("#missionDialogue");
    await expect(dialog).toBeVisible();
    await expect(page.locator("#map")).toBeVisible();
    await expect(dialog.locator("p")).toHaveText("赶在敌方开火之前开始迎击");
    expect(
      await dialog.locator("img").evaluate((img) => img.complete && img.naturalWidth > 0),
    ).toBe(true);
    expect(await page.evaluate(() => missionFocus)).toEqual(
      await page.evaluate(() => {
        const u = game.units.find((u) => u.missionActor === "whitebase");
        return { x: u.x, y: u.y };
      }),
    );
    expect(await page.evaluate(() => Net.canAct())).toBe(false);
    await page.screenshot({ path: `tmp/verification/screenshots/mission-opening-${width}.png` });
    await dialog.getByRole("button", { name: "继续", exact: true }).click();
    await expect(dialog.locator("p")).toHaveText("放出MS部队，作战开始");
    await dialog.getByRole("button", { name: "继续", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(briefing).toBeVisible();
    await expect(briefing.locator('[data-tactical="defend"]')).not.toHaveCount(0);
    await briefing.locator("footer button.primary").click();
    await page.evaluate(() => {
      const r = [...missionEngine.rooms.values()][0];
      r.game.units
        .filter((u) => u.missionGroup === "dom")
        .slice(0, 6)
        .forEach((u) => (u.hp = 0));
      missionEngine.broadcast(r);
    });
    for (const [name, text] of [
      ["阿姆罗:", "红色的MS，是夏亚吗？"],
      ["夏亚:", "白色的家伙，越来越能干了啊。"],
      ["阿姆罗:", "得赶紧支援布莱德才行。"],
    ]) {
      await expect(briefing).toBeHidden();
      await expect(dialog.locator("strong")).toHaveText(name);
      await expect(dialog.locator("p")).toHaveText(text);
      await dialog.getByRole("button", { name: "继续", exact: true }).click();
    }
    await expect(dialog).toBeHidden();
    await expect(briefing).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>briefingSonars)).toBe(3);
    await briefing.locator("footer button.primary").click();
    await page.evaluate(()=> {
      const s=structuredClone(Net.snapshot);
      s.game.mission.objectives.victory[0].current++;
      BriefingUI.receive(s);
    });
    await page.waitForTimeout(250);
    await expect(briefing).toBeHidden();
    await page.evaluate(()=> {
      const s=structuredClone(Net.snapshot);
      s.game.mission.objectives.failure.push({kind:"protected_destroyed", current:0, total:1, unitId:"RGM_79"});
      BriefingUI.receive(s);
    });
    await expect(briefing).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>briefingSonars)).toBe(4);
    await briefing.locator("footer button.primary").click();
    await expect.poll(() => page.evaluate(() => Net.canAct())).toBe(true);
    expect(errors).toEqual([]);
  });
test("visual mission editor loads sample and edits trigger and dialogue without JSON", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("admin/map-editor.html")).href);
  await page.locator('[data-tab="mission"]').click();
  page.once("dialog", (d) => d.accept());
  await page.locator("#missionLoadSample").click();
  await expect(page.locator("#missionScriptValidation")).toHaveText("✓ 脚本结构检查通过");
  await page.getByLabel("选择事件", { exact: true }).selectOption("red-comet");
  await page.getByLabel("最晚触发回合（包含）", { exact: true }).fill("9");
  await page.getByLabel("最晚触发回合（包含）", { exact: true }).press("Tab");
  expect(await page.evaluate(() => MapEditor.exportMap().mission.events[1].when.byRound)).toBe(9);
  await page.getByRole("button", { name: "预览对话", exact: true }).first().click();
  await expect(page.locator("dialog[open]")).toContainText("红色的MS，是夏亚吗？");
  await page.locator("dialog[open]").getByRole("button", { name: "关闭", exact: true }).click();
  await page.screenshot({ path: "tmp/verification/screenshots/mission-editor.png" });
  expect(errors).toEqual([]);
});

test("mission event templates expose compound conditions, named targets, sequence preview and map regions", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("admin/map-editor.html")).href);
  await page.locator('[data-tab="mission"]').click();
  page.once("dialog", (d) => d.accept());
  await page.locator("#missionLoadSample").click();
  await page.getByRole("button", { name: "＋危急支援", exact: true }).click();
  await expect(page.getByLabel("事件名称", { exact: true })).toHaveValue("危急支援");
  await expect(page.getByLabel("条件单位", { exact: true })).toContainText("白色基地");
  await page.getByLabel("触发条件", { exact: true }).selectOption("all");
  await page.getByRole("button", { name: "＋添加条件", exact: true }).click();
  await page.getByLabel("子条件", { exact: true }).nth(1).selectOption("actor_hp");
  await expect(page.locator("#missionScriptValidation")).toHaveText("✓ 脚本结构检查通过");
  await page.getByRole("button", { name: "预览事件流程", exact: true }).click();
  const preview = page.locator("dialog[open]");
  await expect(preview).toContainText("仅预览，不执行对局操作");
  await preview.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(preview).toContainText("作战开始。");
  await preview.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(preview).toContainText("恢复耐久与EN");
  await preview.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "复制事件", exact: true }).click();
  await expect(page.getByLabel("事件名称", { exact: true })).toHaveValue("危急支援（副本）");
  await page.getByRole("button", { name: "＋到达目标区域", exact: true }).click();
  const use = page.getByRole("button", { name: "使用地图选区作为触发区域", exact: true });
  await use.scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "在地图框选区域", exact: true }).click();
  const rect = await page.locator("#mapCanvas").boundingBox();
  // Centered map is fit automatically; drag a rectangle inside its visible center.
  await page.mouse.move(rect.x + rect.width * 0.45, rect.y + rect.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * 0.55, rect.y + rect.height * 0.55);
  await page.mouse.up();
  await use.click();
  const selected = await page.evaluate(() => ({
    selection: MapEditor.selection,
    condition: MapEditor.document.mission.events.at(-1).when,
  }));
  expect(selected.selection).toBeTruthy();
  expect(selected.condition.x).toBe(selected.selection.x);
  expect(selected.condition.width).toBe(selected.selection.width);
  await expect(page.locator("#missionScriptValidation")).toHaveText("✓ 脚本结构检查通过");
  await page.screenshot({ path: "tmp/verification/screenshots/mission-editor-events.png" });
});
