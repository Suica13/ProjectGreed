const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

for (const viewport of [
  { width: 1440, height: 900, team: 0 },
  { width: 390, height: 844, team: 0 },
]) {
  test(`Earth campaign team ${viewport.team} opens and enters a local battle at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await expect(page.locator("#openSkirmish")).toBeEnabled();
    await page.evaluate(() => {
      const factory = createRoomEngine;
      createRoomEngine = (options) => {
        window.campaignTestEngine = factory(options);
        return campaignTestEngine;
      };
    });
    await expect(page.locator("#openCampaign")).toHaveCount(0);
    async function createRoom() {
      await page.locator("#openSkirmish").click();
      await page
        .locator("#offlineRoomMode")
        .selectOption(viewport.width === 1440 ? "regular" : "campaign");
      await page.locator("#createOfflineRoom").click();
      await expect(page.locator("#roomPreparation")).toBeVisible();
      if (viewport.width === 1440) await page.locator("#roomBattleMode").selectOption("campaign");
      await expect(page.locator("#roomBattleMode")).toHaveValue("campaign");
      await expect(page.locator("#roomFormationControls")).toBeHidden();
      await expect(page.locator("#roomFormationPreset")).toBeHidden();
      await expect(page.locator("#roomTagRestrictions")).toBeHidden();
      await expect(page.locator("#roomMapSelect")).toBeHidden();
      await expect(page.locator("#roomScenarioSelect option")).toHaveText(["地球攻略战[0079中期]"]);
      await expect(page.locator("#roomMapTitle")).toHaveText("地球攻略战[0079中期]");
      expect(
        await page.locator("#roomMapPreview").evaluate((canvas) => canvas.width / canvas.height),
      ).toBeCloseTo(1200 / 560);
      expect(
        await page
          .locator("#roomMapPreview")
          .evaluate((canvas) => getComputedStyle(canvas).objectFit),
      ).toBe("contain");
    }
    await createRoom();
    await page.locator("#startRoomGame").click();
    await expect(page.locator("#campaignRounds")).toHaveValue("10");
    await page.locator("#campaignRounds").fill("1");
    await page.locator(".campaign-setup button").last().click();
    await expect(page.locator("#campaignScreen")).toBeVisible();
    await expect(page.locator("#campaignScreen [data-region]")).toHaveCount(43);
    await expect(page.locator("#menuShell")).toBeHidden();
    await expect(page.locator("#shellSidebar")).toBeHidden();
    await expect(page.getByRole("button", { name: "调动", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "调动", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "转交", exact: true })).toBeVisible();
    await expect(page.locator("#campaignScreen")).not.toContainText("COST");
    expect(
      await page.locator(".campaign-force-list").evaluate((el) => getComputedStyle(el).overflowY),
    ).toBe("scroll");
    await page.getByRole("button", { name: "预览 / 装备 / 技能", exact: true }).first().click();
    await expect(page.locator("#campaignArmyDialog")).toBeVisible();
    await expect(page.locator("#campaignArmyDialog canvas")).toBeVisible();
    await expect(page.locator("#campaignArmyDialog")).not.toContainText("COST");
    await page
      .locator("#campaignArmyDialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await expect(page.locator("#campaignScreen")).toContainText("资金");

    await page.screenshot({ path: `tmp/campaign-earth-overview-${viewport.width}.png` });
    for (let i = 0; i < 4; i++) await page.locator(".campaign-map-tools button").last().click();
    const position = await page.evaluate(() => {
      const map = document.querySelector(".campaign-map-scroll");
      map.scrollLeft = 40;
      map.scrollTop = innerWidth > 760 ? 60 : 0;
      window.campaignMapIdentity = map;
      return { x: map.scrollLeft, y: map.scrollTop, windowX: scrollX, windowY: scrollY };
    });
    await page.locator('#campaignScreen [data-region="canada"]').evaluate(el => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const after = await page.evaluate(() => {
      const map = document.querySelector(".campaign-map-scroll");
      return {
        same: map === window.campaignMapIdentity,
        x: map.scrollLeft,
        y: map.scrollTop,
        windowX: scrollX,
        windowY: scrollY,
      };
    });
    expect(after.same).toBe(true);
    expect(after.x).toBeCloseTo(position.x, 0);
    expect(after.y).toBeCloseTo(position.y, 0);
    expect(after.windowX).toBe(position.windowX);
    expect(after.windowY).toBe(position.windowY);
    await page
      .locator('#campaignScreen [data-region="jaburo"]')
      .evaluate((el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const firstArmy = page.locator(".campaign-force-card").first();
    await expect(firstArmy.locator(".campaign-force-portrait")).toBeVisible();
    await expect(firstArmy.locator(".campaign-force-vitals")).toContainText("HP");
    await expect(firstArmy.locator(".campaign-force-vitals")).toContainText("EN");
    const costs = await page.locator(".campaign-force-card").evaluateAll((rows) =>
      rows.map((row) => {
        const unit = Net.snapshot.campaign.units.find((unit) => unit.id === row.dataset.unitId);
        return UnitModels[unit.unitId + "__" + unit.kitId].cost;
      }),
    );
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    await page.screenshot({ path: `tmp/campaign-scene-${viewport.width}.png` });
    await firstArmy.locator("input").check();
    await expect(page.locator(".campaign-selection-summary")).toContainText("已选 1 台");
    await page
      .locator(".campaign-unit-actions button")
      .filter({ hasText: /^调动$/ })
      .click();
    await expect(page.locator("#campaignOrderDialog")).toBeVisible();
    await page.locator('#campaignOrderDialog [data-destination="andes"]').click();
    await expect(firstArmy.locator(".campaign-force-status")).toContainText("南美西部");
    await page.locator(".campaign-unit-actions button").filter({ hasText: "撤销调动" }).click();
    await expect(firstArmy.locator(".campaign-force-status")).toContainText("待命");
    await firstArmy.locator("input").uncheck();
    await expect(page.locator("#campaignMoveTarget")).toHaveCount(0);
    await expect(page.locator("#campaignTransferTarget")).toHaveCount(0);
    await page.evaluate(() => {
      const room = [...campaignTestEngine.rooms.values()][0];
      const unit = CampaignRules.addUnit(
        { G: Rules, production: PRODUCTION_CATALOG },
        room.campaign,
        0,
        "jaburo",
        "RGM_79",
      );
      window.equipmentTestArmy = unit.id;
      room.revision++;
      campaignTestEngine.broadcast(room);
    });
    await expect.poll(() => page.evaluate(() => Net.awaiting)).toBe(null);
    await page
      .locator(".campaign-force-card")
      .filter({ hasText: "光束喷枪套件" })
      .getByRole("button", { name: "预览 / 装备 / 技能" })
      .click();
    const armyPanel = page.locator("#campaignArmyDialog");
    await armyPanel.locator("#campaignArmyKit").selectOption("bazooka");
    await expect(armyPanel.locator(".campaign-army-equip")).toContainText("200");
    const suppliesBeforeEquip = await page.evaluate(() => Net.snapshot.campaign.teams[0].supplies);
    await armyPanel.getByRole("button", { name: "确认换装", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => Net.snapshot.campaign.units.find((unit) => unit.id === equipmentTestArmy).kitId,
        ),
      )
      .toBe("bazooka");
    expect(await page.evaluate(() => Net.snapshot.campaign.teams[0].supplies)).toBe(
      suppliesBeforeEquip - 200,
    );
    await expect.poll(() => page.evaluate(() => Net.awaiting)).toBe(null);
    await armyPanel.locator("#campaignArmyKit").selectOption("beam_spray");
    await expect(armyPanel.locator(".campaign-army-equip")).toContainText("150");
    await expect(armyPanel.locator(".campaign-army-equip")).toContainText("300");
    await armyPanel.getByRole("button", { name: "确认换装", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => Net.snapshot.campaign.units.find((unit) => unit.id === equipmentTestArmy).kitId,
        ),
      )
      .toBe("beam_spray");
    await armyPanel.getByRole("button", { name: "关闭", exact: true }).click();
    await page.locator(".campaign-side-actions button").first().click();
    const workspace = page.locator("#campaignWorkspace");
    await expect(workspace).toBeVisible();
    await workspace.locator('[data-unit-id="Type61"]').click();
    await expect(workspace.locator(".campaign-inspector h3")).toContainText("61");
    await expect(workspace.locator(".campaign-purchase")).toContainText("资金");
    await expect(workspace.locator(".campaign-purchase")).toContainText("物资");
    await expect(workspace.locator(".campaign-purchase")).toContainText("每批3台");
    const before = await page.evaluate(() => Net.snapshot.campaign.teams[0].money);
    await workspace.locator(".campaign-purchase > button").click();
    await expect.poll(() => page.evaluate(() => Net.snapshot.campaign.orders.length)).toBe(1);
    expect(await page.evaluate(() => Net.snapshot.campaign.teams[0].money)).toBeLessThan(before);
    await workspace.locator('[data-unit-id="RFF_06"]').click();
    await workspace.locator("#campaignProductionKit").selectOption("kit_1");
    await expect(workspace.locator(".campaign-unit-preview")).toHaveAttribute(
      "data-preview-model",
      "RFF_06__kit_1",
    );
    await expect(workspace.locator(".campaign-purchase")).toContainText("2,100");
    await expect(workspace.locator(".campaign-purchase")).toContainText("3,200");
    await workspace.locator(".campaign-kit-breakdown > summary").click();
    await expect(workspace.locator(".campaign-kit-breakdown")).toContainText("600");
    await expect(workspace.locator(".campaign-kit-breakdown")).toContainText("1,200");
    await workspace.locator(".campaign-purchase > button").click();
    await expect.poll(() => page.evaluate(() => Net.snapshot.campaign.orders.length)).toBe(2);
    expect(await page.evaluate(() => Net.snapshot.campaign.orders[1].kitId)).toBe("kit_1");
    await workspace.locator(".campaign-workspace-header > button").click();
    await page.locator(".campaign-side-actions button").last().click();
    await workspace.locator('[data-tech-id="Tech_EFSF_0079_AntiMSPlan"]').click();
    const mask = await workspace
      .locator('[data-tech-id="Tech_EFSF_0079_AntiMSPlan"]')
      .evaluate((el) => ({
        background: getComputedStyle(el, "::after").backgroundColor,
        pointer: getComputedStyle(el, "::after").pointerEvents,
      }));
    expect(mask.background).toBe("rgba(0, 0, 0, 0.58)");
    expect(mask.pointer).toBe("none");
    await expect(workspace.locator(".campaign-inspector h3")).toHaveText("反MS计划");
    await expect(workspace.locator(".campaign-unlock-unit")).not.toHaveCount(0);
    await expect(workspace.locator(".campaign-purchase")).toContainText("6,000");
    await expect(workspace.locator(".campaign-purchase")).toContainText("2,000");
    await workspace.locator(".campaign-purchase > button").click();
    await expect(workspace.locator('[data-tech-id="Tech_EFSF_0079_AntiMSPlan"]')).toHaveAttribute(
      "data-status",
      "researched",
    );
    await expect.poll(() => page.evaluate(() => Net.awaiting)).toBe(null);
    await workspace.locator(".campaign-workspace-header > button").click();
    await expect(workspace).not.toBeVisible();
    const bounds = await page.locator("#campaignScreen").boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
    if (viewport.width === 1440) {
      await expect
        .poll(() => page.evaluate(() => !!localStorage.getItem("projectgreed.campaign.backup.v1")))
        .toBe(true);
      await page.evaluate(() => {
        Net.leave();
        setPageView("menu");
      });
      await createRoom();
      await page.locator("#restoreCampaignBackup").click();
      await expect(page.locator("#campaignScreen")).toBeVisible();
      await expect.poll(() => page.evaluate(() => Net.awaiting)).toBe(null);
    }
    await page.getByRole("button", { name: "结束战略回合", exact: true }).click();
    await expect(page.locator(".campaign-battle-hint")).toContainText("黄色");
    const encounter = page.locator("#campaignEncounterDialog");
    await expect(encounter).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(encounter).toBeVisible();
    await expect(encounter.locator(".campaign-ready-marker")).toHaveCount(2);
    await expect(encounter.locator('.campaign-ready-marker[data-ready="true"]')).toHaveCount(1);
    await page.screenshot({ path: `tmp/campaign-ready-${viewport.width}.png` });
    await expect(encounter.locator(".campaign-encounter-team")).toHaveCount(2);
    await expect(encounter.locator(".campaign-encounter-unit").first()).toContainText("驾驶员");
    await expect(encounter.locator(".campaign-encounter-unit").first()).toContainText("HP");
    await expect(encounter.locator(".campaign-encounter-unit").first()).toContainText("EN");
    await expect(encounter.locator(".campaign-encounter-actions button")).toHaveText([
      "AI委任",
      "手动指挥",
    ]);
    await encounter
      .locator(".campaign-encounter-actions button")
      .nth(viewport.width === 390 ? 0 : 1)
      .click();
    await expect.poll(() => page.evaluate(() => Net.started)).toBe(true);
    await expect.poll(() => page.evaluate(() => pageView)).toBe("game");
    await expect(page.locator("#campaignScreen")).toBeHidden();
    expect(await page.evaluate(() => Net.snapshot.campaign.activeRegion)).toBeTruthy();
    expect(await page.evaluate(() => Rules.seatTeam(Net.seat))).toBe(viewport.team);
    if (viewport.width === 390) {
      expect(await page.evaluate(() => Net.snapshot.campaign.delegatedSeats)).toEqual([0]);
      expect(await page.evaluate(() => Net.canAct())).toBe(false);
      await expect(page.locator(".campaign-delegation-badge")).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}
