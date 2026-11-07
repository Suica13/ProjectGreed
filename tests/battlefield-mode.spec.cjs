const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
for (const width of [1600, 390])
  test("battlefield room, PMC deployment and reinforcement HUD / " + width, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await expect(page.locator("#openSkirmish")).toBeEnabled();
    await page.evaluate(() => {
      const original = createRoomEngine;
      createRoomEngine = (options) =>
        (window.bfEngine = original({ ...options, aiDelayMs: 999999 }));
      Formation.current = () => [{ unitId: "Type61", kitId: "standard" }];
    });
    await page.locator("#openSkirmish").click();
    await page.locator("#offlineRoomMode").selectOption("battlefield");
    await page.locator("#createOfflineRoom").click();
    if (width === 390) await page.getByRole("button", { name: "房间设置", exact: true }).click();
    await expect(page.locator("#battlefieldRoomOptions")).toBeVisible();
    if (width === 390) await page.locator("#closeRoomSettingsSheet").click();
    expect(await page.evaluate(() => Net.snapshot.you.seat)).toBe(2);
    expect(await page.locator("#removeSeatAI0, #removeSeatAI1").count()).toBe(0);
    await page.locator("#startRoomGame").click();
    await expect(page.locator("#confirmFinalFormation")).toBeVisible();
    await page.locator("#confirmFinalFormation").click();
    await expect(page.locator("#confirmDeployment")).toBeVisible();
    await page.locator("#confirmDeployment").click();
    await expect(page.locator("#battlefieldStatus")).toBeVisible();
    await expect(page.locator("#battlefieldRounds")).toHaveText("0/100");
    await expect(page.locator(".battlefield-strength-text").first()).toHaveText("20,000/20,000");
    await expect.poll(() => page.evaluate(() => !BattleAssets.loading && Net.canAct())).toBe(true);
    await page.evaluate(() => {
      const room = [...bfEngine.rooms.values()][0];
      room.game.units.find(unit => unit.ownerSeat === Net.seat && !unit.facility).hp = 0;
      room.revision++; bfEngine.broadcast(room);
    });
    async function clickSite(kind) {
      const position = await page.evaluate(kind => {
        const site = Rules.battlefieldMode.deploymentSites(Rules, game, Net.team()).find(item => item.id.startsWith(kind + ":"));
        mode = "select";
        MapCamera.setPercent(35); MapCamera.focus(site.x, site.y, { preserveZoom: true });
        const rect = byId("map").getBoundingClientRect();
        return { x: rect.left + mapGeo.ox + (site.x + .5) * mapGeo.tile,
          y: rect.top + mapGeo.oy + (site.y + .5) * mapGeo.tile };
      }, kind);
      await page.mouse.click(position.x, position.y);
      await expect(page.locator("#battlefieldDeploymentDialog")).toBeVisible();
    }
    await clickSite("base");
    const deploy = page.locator("#battlefieldDeploymentDialog .battlefield-reserve button");
    await expect(deploy).toBeDisabled();
    await expect(page.locator(".battlefield-reserve small")).toContainText("维修中");
    await page.evaluate(() => {
      const room = [...bfEngine.rooms.values()][0];
      room.game.round = room.game.battlefield.reserves[0].readyRound;
      room.revision++; bfEngine.broadcast(room);
    });
    await expect(deploy).toBeEnabled();
    const geometry = await page.locator(".battlefield-reserve").evaluate(row => {
      const info = row.children[1].getBoundingClientRect(), button = row.children[2].getBoundingClientRect();
      return { infoRight: info.right, buttonLeft: button.left, right: row.getBoundingClientRect().right };
    });
    expect(geometry.infoRight).toBeLessThan(geometry.buttonLeft);
    expect(geometry.right).toBeLessThanOrEqual(width);
    await deploy.click();
    await expect(page.locator(".battlefield-reserve small")).toContainText("下一回合空投");
    await expect(deploy).toBeDisabled();
    await page.screenshot({ path: "build/mercenary-deployment-" + width + ".png" });
    await page.locator("#battlefieldDeploymentDialog").getByRole("button", { name: "关闭", exact: true }).click();
    await page.evaluate(() => {
      const room = [...bfEngine.rooms.values()][0];
      room.game.round++; Rules.battlefieldMode.advance(Rules, room.game);
      room.game.battlefield.points[0].owner = 0;
      room.revision++; bfEngine.broadcast(room);
    });
    await expect.poll(() => page.evaluate(() => game.units.filter(unit => unit.id.startsWith("pmc-airdrop-") && unit.hp > 0).length)).toBe(1);
    await clickSite("point");
    await expect(page.locator("#battlefieldDeploymentDialog")).toContainText("暂无阵亡单位");
    await page.locator("#battlefieldDeploymentDialog").getByRole("button", { name: "关闭", exact: true }).click();
    await page.evaluate(() => {
      const room = [...bfEngine.rooms.values()][0];
      room.game.round = 6;
      Rules.battlefieldMode.advance(Rules, room.game);
      room.revision++;
      bfEngine.broadcast(room);
    });
    await expect(page.locator("#battlefieldRounds")).toHaveText("5/100");
    await expect.poll(() => page.evaluate(() => !BattleAssets.loading)).toBe(true);
    const info = await page.evaluate(() => ({
      wave: game.battlefield.wave,
      team: Net.snapshot.you.seat % 2,
      arrivals: game.units.filter(
        (unit) => unit.airdropRound === 6 && unit.team === Net.snapshot.you.seat % 2,
      ).length,
      facilities: game.units.filter(
        (unit) => unit.facility && unit.team === Net.snapshot.you.seat % 2,
      ).length,
      awards: Net.snapshot.economyAwards || [],
    }));
    expect(info.wave).toBe(2);
    expect(info.arrivals).toBeGreaterThan(0);
    expect(info.facilities).toBe(6);
    expect(info.awards.map(award => award.kind)).toEqual(["loss"]);
    const box = await page.locator("#battlefieldStatus").boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: "build/battlefield-" + width + ".png" });
    expect(errors).toEqual([]);
  });
