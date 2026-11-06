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
    test.setTimeout(60000);
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
      if (viewport.width === 390) await page.locator('[data-room-tab="settings"]').click();
      const rulesGroup = page.locator("#roomBattleMode").locator("xpath=ancestor::details[1]");
      const rulesWereOpen = await rulesGroup.evaluate((details) => details.open);
      if (!rulesWereOpen) await rulesGroup.locator(":scope > summary").click();
      await expect(page.locator("#campaignAIDifficulty")).toHaveValue("normal");
      await page.locator("#campaignAIDifficulty").selectOption("hard");
      await expect.poll(() => page.evaluate(() => Net.snapshot.settings.campaignOptions.difficulty)).toBe("hard");
      await page.locator("#campaignAIAggression").selectOption("high");
      await expect.poll(() => page.evaluate(() => Net.snapshot.settings.campaignOptions.aggression)).toBe("high");
      await expect(page.locator("#campaignResources0")).toHaveValue("1");
      await expect(page.locator("#campaignResearch0 option")).toHaveCount(3);
      await expect(page.locator("#campaignDurability1 option")).toHaveCount(3);
      await expect(page.locator("#campaignResources1 option")).toHaveCount(7);
      if (!rulesWereOpen) await rulesGroup.locator(":scope > summary").click();
      if (viewport.width === 390) await page.locator("#closeRoomSettingsSheet").click();
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
    await expect(page.locator(".spawn-slot .commander-badge")).toHaveCount(2);
    expect(await page.locator(".commander-badge").first().evaluate((badge) => getComputedStyle(badge).color)).toBe("rgb(246, 204, 97)");
    await page.locator("#startRoomGame").click();
    await expect(page.locator("#campaignRounds")).toHaveValue("10");
    await page.locator("#campaignRounds").fill("1");
    await page.locator(".campaign-setup button").last().click();
    await expect(page.locator("#campaignScreen")).toBeVisible();
    await expect(page.locator("#campaignScreen [data-region]")).toHaveCount(43);
    expect(await page.evaluate(() => {
      const s = Net.snapshot.campaign;
      return CAMPAIGN_WORLD.regions.every((region) => {
        const label = document.querySelector(`[data-region-label="${region.id}"] .campaign-region-name`).textContent;
        return label === I18n.text(region.name);
      });
    })).toBe(true);
    const economy = await page.locator(".campaign-header-resources").evaluate((panel) => ({
      colors: [...panel.children].map((item) => getComputedStyle(item).color),
      icons: panel.querySelectorAll("svg").length,
      income: [...panel.querySelectorAll(".resource-income")].map((item) => item.textContent),
      expected: Object.values(CampaignRules.income({world:CAMPAIGN_WORLD}, Net.snapshot.campaign, 0)).map((amount) => "+" + formatNumber(amount)),
    }));
    expect(economy.colors).toEqual(["rgb(242, 203, 101)", "rgb(131, 212, 154)", "rgb(142, 212, 250)"]);
    expect(economy.icons).toBe(3);
    expect(economy.income).toEqual(economy.expected);
    await expect(page.locator(".campaign-region-income")).toHaveCount(0);
    await expect(page.locator(".campaign-region-cost")).toHaveCount(0);
    await expect(page.locator(".campaign-region-count")).toHaveCount(43);
    await expect(page.locator(".campaign-map-commands .campaign-end-turn")).toBeVisible();
    const impactBay = await page.evaluate(() => {
      const world = CAMPAIGN_WORLD;
      const cutout = world.coastalCutouts.find((item) => item.id === "sydney_impact_bay");
      const project = ([lon, lat]) => [
        ((lon + 180) * world.width) / 360,
        ((85 - lat) * world.height) / 145,
      ];
      const canvas = document.createElement("canvas"),
        context = canvas.getContext("2d");
      const land = new Path2D(world.landPath);
      const center = project(cutout.lonLat),
        coast = project([156, -26]);
      const torrington = world.regions.find((region) => region.id === "torrington");
      const selectedLand = world.regions.filter((region) => region.kind === "land");
      CampaignUI.preview(canvas, Net.snapshot.campaign);
      return {
        centerOnLand: context.isPointInPath(land, ...center, "evenodd"),
        coastOnLand: context.isPointInPath(land, ...coast, "evenodd"),
        centerInTerritory: selectedLand.some((region) =>
          context.isPointInPath(new Path2D(region.path), ...center, "evenodd"),
        ),
        torringtonOnLand: context.isPointInPath(land, ...torrington.center, "evenodd"),
        bayAboveTorrington: center[1] < torrington.center[1],
        previewPixel: [
          ...context.getImageData(Math.round(center[0]), Math.round(center[1]), 1, 1).data,
        ],
      };
    });
    expect(impactBay).toEqual({
      centerOnLand: false,
      coastOnLand: false,
      centerInTerritory: false,
      torringtonOnLand: true,
      bayAboveTorrington: true,
      previewPixel: [14, 27, 43, 255],
    });

    await expect(page.locator("#menuShell")).toBeHidden();
    await expect(page.locator("#shellSidebar")).toBeHidden();
    await expect(page.locator(".campaign-header-save-name")).toHaveText("地球攻略战[0079中期]");
    await expect(page.locator(".campaign-header-utilities button")).toHaveText([
      "存档",
      "玩家席位",
      "离开房间",
      "设置",
    ]);
    await expect(page.locator(".campaign-side-actions button")).toHaveText([
      "生产",
      "科技",
      "驾驶员",
      "谍报",
    ]);
    await expect(page.locator(".campaign-map-commands > .campaign-end-turn")).toHaveText("结束战略回合");
    const ordersRow = await page.locator(".campaign-header-state > strong").boundingBox();
    const balancesRow = await page.locator(".campaign-header-balances").boundingBox();
    expect(Math.abs(ordersRow.y - balancesRow.y)).toBeLessThan(3);
    expect(
      Math.abs(
        balancesRow.x + balancesRow.width - viewport.width + (viewport.width > 900 ? 18 : 8),
      ),
    ).toBeLessThan(2);
    await page.getByRole("button", { name: "存档", exact: true }).click();
    const savePanel = page.locator("#campaignSaveDialog");
    await expect(savePanel).toBeVisible();
    await expect(savePanel.getByRole("button", { name: "导入战役", exact: true })).toBeEnabled();
    await expect(savePanel.getByRole("button", { name: "导出战役", exact: true })).toBeEnabled();
    await savePanel.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "玩家席位", exact: true }).click();
    const seatsPanel = page.locator("#campaignSeatsDialog");
    await expect(seatsPanel).toBeVisible();
    await expect(seatsPanel.locator(".team-slot")).toHaveCount(2);
    await expect(seatsPanel.locator(".spawn-slot")).toHaveCount(10);
    await expect(seatsPanel.locator('.team-slot[data-team="0"] .spawn-slot')).toHaveCount(5);
    await expect(seatsPanel.locator(".lineup-faction select")).toHaveCount(0);
    await expect(seatsPanel.locator(".campaign-team-faction")).toHaveText(["EFSF", "ZEON"]);
    expect(
      await seatsPanel
        .locator(".choose-spawn")
        .evaluateAll((buttons) =>
          buttons.every((button) => button.scrollWidth <= button.clientWidth + 1),
        ),
    ).toBe(true);
    await seatsPanel.locator("#campaignBecomeSpectator").click();
    await expect.poll(() => page.evaluate(() => Net.seat)).toBe(null);
    await expect(seatsPanel.locator("#campaignBecomeSpectator")).toBeDisabled();
    await expect(seatsPanel.locator("#addAI0")).toBeVisible();
    await seatsPanel.locator("#addAI0").click();
    await expect(seatsPanel.locator('[data-commander-seat="0"]')).toBeVisible();
    await expect(seatsPanel.locator("#removeSeatAI0")).toBeVisible();
    await expect(seatsPanel.locator("#addAI0")).toHaveCount(0);
    await seatsPanel.locator("#removeSeatAI0").click();
    await expect(seatsPanel.locator("#addAI0")).toBeVisible();
    await seatsPanel.locator("#addAI0").click();
    await expect(seatsPanel.locator("#chooseSeat0")).toBeEnabled();
    await expect(seatsPanel.locator("#chooseSeat1")).toBeEnabled();
    await seatsPanel.locator("#chooseSeat0").click();
    await expect.poll(() => page.evaluate(() => Net.seat)).toBe(0);
    await expect(seatsPanel.locator("#addAI2")).toBeVisible();
    await expect(seatsPanel).toBeVisible();
    expect(
      await seatsPanel.locator(".spawn-slot").evaluateAll((rows) =>
        rows.every((row) => {
          const faction = row.querySelector(".lineup-faction").getBoundingClientRect();
          const status = row.querySelector(".lineup-ready").getBoundingClientRect();
          const control = row.querySelector(".lineup-faction > *").getBoundingClientRect();
          return faction.right <= status.left && control.right <= faction.right + 1;
        }),
      ),
    ).toBe(true);
    expect(await page.evaluate(() => pageView)).toBe("campaign");
    await seatsPanel.locator(".room-member-button").first().click();
    await expect(page.locator("#roomDetailPanel")).toBeVisible();
    await page.locator("#closeRoomDetail").click();
    await page.evaluate(() => {
      const room = [...campaignTestEngine.rooms.values()][0];
      room.revision++;
      campaignTestEngine.broadcast(room);
    });
    await expect(seatsPanel).toBeVisible();
    await page.screenshot({ path: `tmp/campaign-seats-${viewport.width}.png` });
    await seatsPanel.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(page.locator("#roomPreparation #roomSeatsPage")).toHaveCount(1);

    await page.getByRole("button", { name: "谍报", exact: true }).click();
    const intelligence = page.locator("#campaignIntelligenceDialog");
    await expect(intelligence.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    const beforeIntelligence = await page.evaluate(() => Net.snapshot.campaign.teams[0].money);
    await intelligence.getByRole("button", { name: "投入谍报资金", exact: true }).click();
    await expect(intelligence.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "80");
    await expect(
      intelligence.getByRole("button", { name: "本回合已投入", exact: true }),
    ).toBeDisabled();
    await page.screenshot({ path: `tmp/campaign-intelligence-${viewport.width}.png` });
    expect(await page.evaluate(() => Net.snapshot.campaign.teams[0].money)).toBe(
      beforeIntelligence - 2000,
    );
    await intelligence.getByRole("button", { name: "关闭", exact: true }).click();
    await page
      .locator('[data-region="odessa"]')
      .evaluate((el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const enemyArmy = page.locator(".campaign-force-card").first();
    await expect(enemyArmy).toBeVisible();
    await expect(enemyArmy.locator(".campaign-force-vitals")).toHaveCount(0);
    await enemyArmy.getByRole("button", { name: "详情", exact: true }).click();
    await expect(page.locator("#campaignArmyDialog .campaign-metrics dt")).not.toContainText([
      "HP",
      "EN",
    ]);
    await expect(page.locator("#campaignArmyDialog")).toContainText("信息保密");
    await page
      .locator("#campaignArmyDialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.evaluate(() => {
      const room = [...campaignTestEngine.rooms.values()][0];
      room.campaign.teams[0].intelligence.progress = 100;
      room.revision++;
      campaignTestEngine.broadcast(room);
    });
    await expect(
      page.locator(".campaign-force-card").first().locator(".campaign-force-vitals"),
    ).toBeVisible();
    await page
      .locator(".campaign-force-card")
      .first()
      .getByRole("button", { name: "详情", exact: true })
      .click();
    await expect(page.locator("#campaignArmyDialog .campaign-metrics")).toContainText("HP");
    await expect(page.locator("#campaignArmyDialog")).toContainText("驾驶员：");
    await page
      .locator("#campaignArmyDialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.evaluate(() => {
      const room = [...campaignTestEngine.rooms.values()][0];
      room.campaign.teams[0].intelligence.progress = 80;
      room.revision++;
      campaignTestEngine.broadcast(room);
    });
    await page
      .locator('[data-region="jaburo"]')
      .evaluate((el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    await expect(page.locator(".campaign-map-title")).toHaveText("地球联邦军 - 地球");
    if (viewport.width > 700) {
      const operationBounds = await page.locator(".campaign-detail").boundingBox();
      const mapBounds = await page.locator(".campaign-world").boundingBox();
      expect(operationBounds.x + operationBounds.width).toBeLessThanOrEqual(mapBounds.x);
    }
    const consolePanel = page.locator("#campaignConsole");
    await expect(page.locator("#campaignMusicSlot #musicPlayer")).toBeVisible();
    expect(await page.locator("#musicPlayer").evaluate((el) => getComputedStyle(el).position)).toBe(
      "static",
    );
    const dockBounds = await consolePanel.boundingBox();
    expect(Math.abs(dockBounds.y + dockBounds.height - viewport.height)).toBeLessThan(2);
    const musicBounds = await page.locator("#musicPlayer").boundingBox();
    const foldBounds = await page.locator("#campaignConsoleFold").boundingBox();
    expect(musicBounds.x + musicBounds.width).toBeLessThanOrEqual(foldBounds.x + 1);
    expect(Math.abs(musicBounds.y - foldBounds.y)).toBeLessThan(8);
    expect(
      await page
        .locator(".campaign-header-utilities button")
        .evaluateAll((buttons) =>
          buttons.every(
            (button) =>
              button.scrollWidth <= button.clientWidth &&
              getComputedStyle(button).whiteSpace === "nowrap",
          ),
        ),
    ).toBe(true);
    await expect(consolePanel).toHaveAttribute("data-tab", "log");
    await expect(page.locator("#campaignStrategicLog")).toBeVisible();
    await page.evaluate(() => {
      Net.local = false;
      CampaignUI.render();
    });
    await expect(consolePanel).toHaveAttribute("data-tab", "chat");
    await page.evaluate(() => {
      Net.local = true;
      CampaignUI.render();
    });
    await expect(consolePanel).toHaveAttribute("data-tab", "log");
    await page.locator("#campaignShowChat").click();
    await page.evaluate(() => CampaignUI.render());
    await expect(consolePanel).toHaveAttribute("data-tab", "chat");
    await page.locator("#campaignChatInput").fill("战略聊天测试");
    await page.locator("#campaignChatSend").click();
    await expect(page.locator("#campaignChatLines")).toContainText("战略聊天测试");
    await expect(page.locator("#campaignChatInput")).toHaveValue("");
    const chatRow = await page.locator("#campaignChatForm").boundingBox();
    const messages = await page.locator("#campaignChatLines").boundingBox();
    expect(messages.y + messages.height).toBeLessThanOrEqual(chatRow.y + 1);
    expect(chatRow.x + chatRow.width).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: `tmp/campaign-chat-dock-${viewport.width}.png` });
    await page.locator("#campaignShowLog").click();
    await page.locator("#campaignConsoleFold").click();
    await expect(consolePanel).toHaveAttribute("data-collapsed", "true");
    await expect(page.locator("#campaignStrategicLog")).toBeHidden();
    await page.locator("#campaignShowLog").click();
    await expect(consolePanel).toHaveAttribute("data-collapsed", "false");
    const normalDockHeight = (await consolePanel.boundingBox()).height;
    await page.locator("#campaignConsoleExpand").click();
    await expect(consolePanel).toHaveAttribute("data-expanded", "true");
    expect((await consolePanel.boundingBox()).height).toBeGreaterThan(normalDockHeight);
    await page.locator("#campaignConsoleExpand").click();
    await expect(consolePanel).toHaveAttribute("data-expanded", "false");
    const mapViewport = page.locator(".campaign-map-scroll");
    const mapBounds = await mapViewport.boundingBox();
    const mouseX = mapBounds.x + mapBounds.width / 2;
    const mouseY = mapBounds.y + mapBounds.height / 2;
    const commandBounds = () =>
      page.locator(".campaign-end-turn").evaluate((button) => {
        const { x, y, width, height } = button.getBoundingClientRect();
        return { x, y, width, height };
      });
    await expect.poll(async () => (await commandBounds()).width).toBeGreaterThan(0);
    const fixedCommand = await commandBounds();
    await expect(page.locator(".campaign-end-turn")).toBeEnabled();
    expect(await page.locator(".campaign-end-turn").evaluate((button) => getComputedStyle(button).animationName)).toBe("campaign-command-pulse");
    for (let i = 0; i < 5; i++) await page.locator(".campaign-map-tools button").first().click();
    const zoomedOut = await page.locator(".campaign-map-scroll svg").boundingBox();
    expect(zoomedOut.width).toBeLessThan(mapBounds.width * 0.9);
    expect(zoomedOut.height).toBeLessThan(mapBounds.height * 0.9);
    await page.screenshot({path:`tmp/campaign-map-panels-${viewport.width}.png`});
    await page.locator(".campaign-map-tools button").last().click();
    const beforeZoom = await page.locator(".campaign-map-scroll svg").boundingBox();
    const anchoredX = (mouseX - beforeZoom.x) / beforeZoom.width;
    await page.mouse.move(mouseX, mouseY);
    await page.mouse.wheel(0, -300);
    await expect
      .poll(async () => (await page.locator(".campaign-map-scroll svg").boundingBox()).width)
      .toBeGreaterThan(beforeZoom.width * 1.2);
    const afterZoom = await page.locator(".campaign-map-scroll svg").boundingBox();
    expect(Math.abs((mouseX - afterZoom.x) / afterZoom.width - anchoredX)).toBeLessThan(0.005);
    const selectedBeforeDrag = await page.locator(".campaign-detail > h3").textContent();
    const leftBeforeDrag = await mapViewport.evaluate((el) => el.scrollLeft);
    await page.mouse.move(mouseX, mouseY);
    await page.mouse.down();
    await page.mouse.move(mouseX - 70, mouseY, { steps: 8 });
    await page.mouse.up();
    expect(await mapViewport.evaluate((el) => el.scrollLeft)).toBeGreaterThan(leftBeforeDrag + 60);
    await expect(page.locator(".campaign-detail > h3")).toHaveText(selectedBeforeDrag);
    expect(await commandBounds()).toEqual(fixedCommand);
    await page.mouse.wheel(0, 250);
    await expect
      .poll(async () => (await page.locator(".campaign-map-scroll svg").boundingBox()).width)
      .toBeLessThan(afterZoom.width);

    await expect(page.getByRole("button", { name: "调动", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "调动", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "转交", exact: true })).toBeVisible();
    await expect(page.locator(".campaign-force-list")).not.toContainText("COST");
    await expect(page.locator(".campaign-region-count")).toHaveCount(43);
    expect(
      await page.locator(".campaign-force-list").evaluate((el) => getComputedStyle(el).overflowY),
    ).toBe("scroll");
    await page.getByRole("button", { name: "详情", exact: true }).first().click();
    await expect(page.locator("#campaignArmyDialog")).toBeVisible();
    await expect(page.locator("#campaignArmyDialog canvas")).toBeVisible();
    await expect(page.locator("#campaignArmyDialog")).not.toContainText("COST");
    await page
      .locator("#campaignArmyDialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await expect(page.locator('.campaign-header-balances [aria-label^="资金"]')).toBeVisible();

    await page.screenshot({ path: `tmp/campaign-earth-overview-${viewport.width}.png` });
    for (let i = 0; i < 4; i++) await page.locator(".campaign-map-tools button").last().click();
    const position = await page.evaluate(() => {
      const map = document.querySelector(".campaign-map-scroll");
      map.scrollLeft = 40;
      map.scrollTop = innerWidth > 760 ? 60 : 0;
      window.campaignMapIdentity = map;
      return { x: map.scrollLeft, y: map.scrollTop, windowX: scrollX, windowY: scrollY };
    });
    await page
      .locator('#campaignScreen [data-region="canada"]')
      .evaluate((el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
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
    const compactHeight = await firstArmy.evaluate((el) => el.getBoundingClientRect().height);
    expect(compactHeight).toBeLessThan(125);
    const personalBefore = await page.evaluate(() =>
      Object.fromEntries(
        Object.entries(localStorage).filter(([key]) => !key.startsWith("projectgreed.campaign")),
      ),
    );
    await firstArmy.getByRole("button", { name: "配属驾驶员", exact: true }).click();
    const crews = page.locator("#campaignPilotDialog");
    await expect(crews).toBeVisible();
    await crews.getByRole("button", { name: "招募PMC驾驶员", exact: true }).click();
    await crews.getByRole("textbox", { name: "驾驶员名称", exact: true }).fill("战略驾驶员");
    await crews.getByRole("button", { name: "招募 · 资金 1,000", exact: true }).click();
    await expect(crews.locator(".campaign-pilot-card")).toHaveCount(1);
    await crews.getByRole("button", { name: "配属", exact: true }).click();
    await expect(crews.getByRole("button", { name: "已配属", exact: true })).toBeDisabled();
    const armyNumber = (await firstArmy.getAttribute("data-unit-id")).slice(5);
    await expect(crews.locator(".campaign-order-header h3")).toContainText(`[No.${armyNumber}]`);
    await expect(crews.locator(".campaign-pilot-copy")).toContainText(
      `已配属：61式主战坦克[No.${armyNumber}] · 贾布罗`,
    );
    await expect(firstArmy.locator(".campaign-force-pilot")).toHaveText("配属驾驶员");
    await expect(firstArmy.locator(".campaign-force-assigned-pilot")).toHaveText("战略驾驶员");
    await crews.getByRole("button", { name: "详情", exact: true }).click();
    await crews
      .locator(".campaign-pilot-stat")
      .first()
      .getByRole("button", { name: "+5", exact: true })
      .click();
    await expect(crews.locator(".campaign-pilot-stat").first()).toContainText("105");
    await expect(crews.locator(".campaign-pilot-details")).toContainText("剩余强化点：75");
    await page.screenshot({ path: `tmp/campaign-pilots-${viewport.width}.png` });
    await crews.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(page.locator("#campaignStrategicLog")).toContainText("招募驾驶员：战略驾驶员");
    await expect(page.locator("#campaignStrategicLog")).toContainText("强化驾驶员");
    await expect(page.locator("#campaignStrategicLog")).toContainText(
      `配属驾驶员：战略驾驶员 → 61式主战坦克[No.${armyNumber}]`,
    );
    expect(
      await page.evaluate(() =>
        Object.fromEntries(
          Object.entries(localStorage).filter(([key]) => !key.startsWith("projectgreed.campaign")),
        ),
      ),
    ).toEqual(personalBefore);
    await page.screenshot({ path: `tmp/campaign-scene-${viewport.width}.png` });
    const transportId = await firstArmy.getAttribute("data-unit-id");
    await firstArmy.getByRole("button", {name:"搭载",exact:true}).click();
    await page.locator("#campaignOrderDialog [data-carrier-id]").first().click();
    const transported = page.locator(`.campaign-force-card[data-unit-id="${transportId}"]`);
    await expect(transported).toHaveAttribute("data-carrier-id", /army-/);
    expect(await transported.evaluate((row) => parseFloat(getComputedStyle(row).marginLeft))).toBe(16);
    await transported.getByRole("button", {name:"离舰",exact:true}).click();
    await expect(transported).not.toHaveAttribute("data-carrier-id");
    await firstArmy.locator("input").check();
    await expect(page.locator(".campaign-selection-summary")).toContainText("已选 1 台");
    await page
      .locator(".campaign-unit-actions button")
      .filter({ hasText: /^调动$/ })
      .click();
    await expect(page.locator("#campaignOrderDialog")).not.toBeVisible();
    const moveDock = page.locator("#campaignMoveDock");
    await expect(moveDock).toBeVisible();
    await expect(page.locator(".campaign-map-commands")).toBeHidden();
    await expect(moveDock.locator("[data-destination]").first()).toContainText(/\/.*C/);
    expect(await moveDock.evaluate((dock) => Math.abs(dock.getBoundingClientRect().bottom - dock.parentElement.getBoundingClientRect().bottom))).toBeLessThanOrEqual(2);
    const scrollingTargets = await moveDock.locator(".campaign-move-targets").evaluate((targets) => {
      const children = [...targets.children];
      for (let i = 0; i < 30; i++) targets.append(children[i % children.length].cloneNode(true));
      const result = { overflow: getComputedStyle(targets).overflowY, scrolls: targets.scrollHeight > targets.clientHeight };
      targets.scrollTop = targets.scrollHeight;
      result.moved = targets.scrollTop > 0;
      [...targets.children].slice(children.length).forEach((item) => item.remove());
      targets.scrollTop = 0;
      return result;
    });
    expect(scrollingTargets).toEqual({overflow:"auto", scrolls:true, moved:true});
    await page.screenshot({path:`tmp/campaign-move-cost-${viewport.width}.png`});
    await expect(page.locator("#campaignConfirmMove")).toBeHidden();
    const movingArmyId = await firstArmy.getAttribute("data-unit-id");
    const beforeOrder = await page.evaluate((id) => Net.snapshot.campaign.units.find((u) => u.id === id).moveTo, movingArmyId);
    await moveDock.locator('[data-destination="andes"]').click();
    await expect(page.locator("#campaignConfirmMove")).toBeVisible();
    await expect(page.locator('.campaign-move-outline[data-move-region="andes"]')).toHaveCount(1);
    await expect(page.locator(".campaign-move-outline .campaign-encounter-particle")).toHaveCount(viewport.width <= 700 ? 4 : 16);
    await expect(page.locator(".campaign-move-preview .campaign-march-arrow")).not.toHaveCount(0);
    expect(await page.evaluate((id) => Net.snapshot.campaign.units.find((u) => u.id === id).moveTo, movingArmyId)).toBe(beforeOrder);
    expect(await page.locator("#campaignConfirmMove").evaluate((button) => {
      const css = getComputedStyle(button);
      const row = button.parentElement.getBoundingClientRect();
      const targets = button.closest(".campaign-move-dock").querySelector(".campaign-move-targets").getBoundingClientRect();
      return { background: css.backgroundColor, animation: css.animationName, above: row.bottom <= targets.top };
    })).toEqual({ background: "rgb(25, 123, 96)", animation: "campaign-command-pulse", above: true });
    expect(await page.locator(".campaign-move-outline path").first().evaluate((path) => getComputedStyle(path).fill)).toBe("none");
    await moveDock.getByRole("button", { name: "取消", exact: true }).click();
    await expect(moveDock).toHaveCount(0);
    await expect(page.locator(".campaign-map-commands")).toBeVisible();
    await expect(page.locator(".campaign-move-outline")).toHaveCount(0);
    expect(await page.evaluate((id) => Net.snapshot.campaign.units.find((u) => u.id === id).moveTo, movingArmyId)).toBe(beforeOrder);
    await page.locator(".campaign-unit-actions button").filter({ hasText: /^调动$/ }).click();
    await page.locator('#campaignMoveDock [data-destination="andes"]').click();
    await page.locator("#campaignConfirmMove").click();
    await expect(moveDock).toHaveCount(0);
    await expect(firstArmy.locator(".campaign-force-status")).toContainText("南美西部");
    const march = page.locator('.campaign-movement-label[data-movement="0:jaburo:andes"]');
    await expect(march).toContainText("行进部队");
    await march.evaluate((el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const movement = page.locator("#campaignMovementDialog");
    await expect(movement).toBeVisible();
    await expect(movement.locator(".campaign-movement-unit")).toHaveCount(1);
    await expect(movement).toContainText("61式主战坦克");
    await movement.getByRole("button", { name: "关闭", exact: true }).click();
    await page.locator(".campaign-unit-actions button").filter({ hasText: "撤销调动" }).click();
    await expect(march).toHaveCount(0);
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
      .getByRole("button", { name: "详情", exact: true })
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
    expect(await workspace.locator('[data-unit-id="Type61"]').evaluate((el) => getComputedStyle(el,"::after").content)).toBe("none");
    const lockedUnit = workspace.locator('.campaign-catalog-card[data-developed="false"]').first();
    expect(await lockedUnit.evaluate((el) => getComputedStyle(el,"::after").backgroundColor)).toBe("rgba(0, 0, 0, 0.58)");
    expect(await lockedUnit.evaluate((el) => getComputedStyle(el,"::after").pointerEvents)).toBe("none");
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
    await page
      .locator(".campaign-side-actions")
      .getByRole("button", { name: "科技", exact: true })
      .click();
    await workspace.locator('[data-tech-id="Tech_EFSF_0079_AntiMSPlan"]').click();
    const mask = await workspace
      .locator('[data-tech-id="Tech_EFSF_0079_AntiMSPlan"]')
      .evaluate((el) => ({
        content: getComputedStyle(el, "::after").content,
      }));
    expect(mask.content).toBe("none");
    expect(await workspace.locator('.campaign-tech-node[data-status="locked"]').first().evaluate((el) => getComputedStyle(el,"::after").backgroundColor)).toBe("rgba(0, 0, 0, 0.58)");
    await expect(workspace.locator(".campaign-inspector h3")).toHaveText("反MS计划");
    await expect(workspace.locator(".campaign-unlock-unit")).not.toHaveCount(0);
    await expect(workspace.locator(".campaign-purchase")).toContainText("6,000");
    await expect(workspace.locator(".campaign-purchase")).toContainText("2,000");
    await workspace.locator(".campaign-purchase > button").click();
    await expect(workspace.locator('[data-tech-id="Tech_EFSF_0079_AntiMSPlan"]')).toHaveAttribute(
      "data-status",
      "researching",
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
      expect(await page.locator("#musicPlayer").evaluate((el) => el.parentElement.id)).toBe(
        "campaignMusicSlot",
      );
      await expect.poll(() => page.evaluate(() => Net.awaiting)).toBe(null);
    }
    await page.getByRole("button", { name: "结束战略回合", exact: true }).click();
    await expect(page.locator("#gameDialog")).toBeVisible();
    await page.locator("#gameDialog").getByRole("button", {name:"取消",exact:true}).click();
    await expect.poll(() => page.evaluate(() => Net.snapshot.campaign.turn)).toBe(1);
    await page.getByRole("button", { name: "结束战略回合", exact: true }).click();
    await page.locator("#gameDialog").getByRole("button", {name:"确定",exact:true}).click();
    await expect(page.locator(".campaign-battle-hint")).toContainText("黄色");
    const encounter = page.locator("#campaignEncounterDialog");
    await expect(encounter).toBeVisible();
    await expect(encounter).toHaveAttribute("data-expanded", "false");
    await expect(encounter.locator(".campaign-encounter-count")).toHaveCount(2);
    await expect(encounter.locator(".campaign-encounter-unit")).toHaveCount(0);
    await expect
      .poll(async () => {
        const box = await encounter.boundingBox();
        const map = await page.locator(".campaign-world").boundingBox();
        return Math.abs(box.y + box.height - map.y - map.height);
      })
      .toBeLessThan(2);
    const compact = await encounter.boundingBox();
    expect(compact.height).toBeLessThan(viewport.height * 0.75);
    const mapFrame = await page.locator(".campaign-world").boundingBox();
    expect(Math.abs(compact.y + compact.height - mapFrame.y - mapFrame.height)).toBeLessThan(2);
    await expect(page.locator(".campaign-encounter-outline")).toHaveCount(1);
    await expect(page.locator(".campaign-encounter-particle")).toHaveCount(viewport.width <= 700 ? 4 : 16);
    expect(await page.evaluate(() => {
      const effect = document.querySelector(".campaign-encounter-outline");
      const labels = document.querySelector(".campaign-world-labels");
      return !!(effect.compareDocumentPosition(labels) & Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const scroll = document.querySelector(".campaign-map-scroll");
          const svg = scroll.querySelector("svg");
          const region = CAMPAIGN_WORLD.regions.find(
            (item) => item.id === scroll.dataset.focusRegion,
          );
          if (!region) return false;
          const bounds = scroll.getBoundingClientRect(),
            map = svg.getBoundingClientRect();
          const drawer = document.querySelector("#campaignEncounterDialog").getBoundingClientRect();
          const x = map.left + (region.center[0] * map.width) / 1200;
          const y = map.top + (region.center[1] * map.width) / 1200;
          return (
            x > bounds.left &&
            x < bounds.right &&
            y > bounds.top &&
            y < Math.min(bounds.bottom, drawer.top)
          );
        }),
      )
      .toBe(true);
    await page.screenshot({ path: `tmp/campaign-compact-${viewport.width}.png` });
    await encounter.getByRole("button", { name: "展开详情", exact: true }).click();
    await expect(encounter).toHaveAttribute("data-expanded", "true");
    await expect.poll(async () => (await encounter.boundingBox()).y).toBeLessThan(compact.y - 100);
    await page.waitForTimeout(300);
    const expanded = await encounter.boundingBox();
    expect(Math.abs(expanded.y + expanded.height - mapFrame.y - mapFrame.height)).toBeLessThan(2);
    expect(expanded.width).toBeCloseTo(compact.width, 0);
    await page.keyboard.press("Escape");
    await expect(encounter).toBeVisible();
    await expect(encounter.locator(".campaign-ready-marker")).toHaveCount(2);
    await expect(encounter.locator(".campaign-ready-group")).toHaveCount(2);
    await expect(encounter.locator(".campaign-ready-group").first()).toHaveAttribute("data-team", "0");
    await expect(encounter.locator(".campaign-ready-group").last()).toHaveAttribute("data-team", "1");
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
    if (viewport.width === 1440) {
      await expect(page.locator("#confirmDeployment")).toBeVisible();
      await page.evaluate(() => {
        const actor = Net.snapshot.game.units.find((unit) => unit.team === 0 && Rules.onMap(unit));
        const point = Net.snapshot.game.campaignBattlefield.layout.nodes.find(
          (node) => node.kind === "outpost",
        );
        selected = actor.id;
        update();
        window.deployTestActor = actor.id;
        window.deployTestX = point.x;
        Deployment.click({ x: point.x, y: point.y, mapX: point.x, mapY: point.y });
      });
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              Net.snapshot.game.units.find((unit) => unit.id === deployTestActor).x === deployTestX,
          ),
        )
        .toBe(true);
      await page.locator("#confirmDeployment").click();
      await expect.poll(() => page.evaluate(() => Net.snapshot.phase)).toBe("idle");
    }
    expect(await page.locator("#musicPlayer").evaluate((el) => el.parentElement.id)).toBe(
      "hudMusicSlot",
    );
    if (viewport.width === 1440)
      await expect(page.locator("#hudMusicSlot #musicPlayer")).toBeVisible();
    expect(await page.evaluate(() => Net.snapshot.campaign.activeRegion)).toBeTruthy();
    expect(await page.evaluate(() => Rules.seatTeam(Net.seat))).toBe(viewport.team);
    if (viewport.width === 390) {
      expect(await page.evaluate(() => Net.snapshot.campaign.delegatedSeats)).toEqual([0]);
      expect(await page.evaluate(() => Net.canAct())).toBe(false);
      await expect(page.locator("#campaignDelegationToggle")).toBeVisible();
    }
    const delegateButton = page.locator("#campaignDelegationToggle");
    await expect(delegateButton).toBeVisible();
    expect(await delegateButton.evaluate((button) => button.closest(".log-tabs") !== null)).toBe(true);
    const wasDelegated = await delegateButton.getAttribute("aria-pressed");
    await page.evaluate(() => {
      const room = [...campaignTestEngine.rooms.values()][0];
      room.turnNotBefore = Date.now() + 60000;
    });
    await delegateButton.click();
    await expect(delegateButton).toHaveAttribute("aria-pressed", String(wasDelegated !== "true"));
    await expect(delegateButton).toBeEnabled();
    await delegateButton.click();
    await expect(delegateButton).toHaveAttribute("aria-pressed", wasDelegated);
    await page.locator("#openMatchRecords").click();
    await expect(page.locator("#matchRecordsDialog #saveCampaignBattle")).toBeVisible();
    await expect(page.locator("#matchRecordsDialog #saveCampaignBattle")).toBeEnabled();
    await page.locator("#matchRecordsDialog .record-close").click();
    await page.evaluate(() => {
      const room = [...campaignTestEngine.rooms.values()][0];
      room.turnNotBefore = 0;
    });
    if (viewport.width === 1440) {
      await page.evaluate(() => {
        const room = [...campaignTestEngine.rooms.values()][0];
        const actor = room.game.units.find((unit) => unit.team === 0 && Rules.onMap(unit));
        const point = room.game.campaignBattlefield.layout.nodes.find(
          (node) => node.kind === "outpost",
        );
        actor.x = point.x;
        actor.y = point.y;
        actor.actionPoints = 10;
        actor.acted = false;
        room.game.campaignBattlefield.owners[point.id] = 1;
        room.game.campaignBattlefield.version++;
        room.revision++;
        campaignTestEngine.broadcast(room);
        window.captureTestActor = actor.id;
        window.captureTestPoint = point.id;
        selected = actor.id;
        mode = "select";
        update();
      });
      await expect(page.locator("#hudCapturePoint")).toBeVisible();
      expect(
        await page
          .locator("#hudCapturePoint")
          .evaluate((button) => button.parentElement.firstElementChild.id),
      ).toBe("hudCapturePoint");
      await page.locator("#hudCapturePoint").click();
      await expect
        .poll(() =>
          page.evaluate(
            () => Net.snapshot.game.units.find((unit) => unit.id === captureTestActor).actionPoints,
          ),
        )
        .toBe(5);
      await expect(page.locator("#hudCapturePoint")).toBeHidden();
      await page.evaluate(() => {
        const room = [...campaignTestEngine.rooms.values()][0];
        const actor = room.game.units.find((unit) => unit.id === captureTestActor);
        const gate = room.game.campaignBattlefield.layout.gates[0];
        actor.x = gate.x;
        actor.y = gate.y;
        room.revision++;
        campaignTestEngine.broadcast(room);
        selected = actor.id;
        update();
      });
      await expect(page.locator("#hudTransferRegion")).toBeVisible();
      await page.locator("#hudTransferRegion").click();
      await expect(page.locator("#gameDialog")).toContainText("下一战略回合");
      await page.locator("#gameDialog").getByRole("button", { name: "取消", exact: true }).click();
      await page.screenshot({ path: "tmp/campaign-supply-objectives.png" });
      const previousRegion = await page.evaluate(() => Net.snapshot.campaign.activeRegion);
      await expect.poll(() => page.evaluate(() => Net.awaiting)).toBe(null);
      await page.evaluate(() => {
        const room = [...campaignTestEngine.rooms.values()][0];
        room.turnNotBefore = 0;
        Net.request("end_turn");
      });
      await expect(page.locator("#roomReturnCountdown")).toBeVisible();
      await expect(page.locator("#roomReturnTitle")).toHaveText("战局中断，返回战略地图");
      await expect(page.locator("#roomReturnMessage")).toContainText(
        "秒后所有玩家一起返回战略地图",
      );
      await expect(page.locator("#turnBadge")).toContainText("1 / 1");
      await page.screenshot({ path: "tmp/campaign-interrupted-countdown.png" });
      await expect.poll(() => page.evaluate(() => Net.started), { timeout: 8000 }).toBe(false);
      await expect(page.locator("#campaignScreen")).toBeVisible();
      await expect(page.locator("#roomReturnCountdown")).toBeHidden();
      await expect(encounter).toBeVisible();
      await expect(encounter).toHaveAttribute("data-expanded", "false");
      expect(await page.evaluate(() => Net.snapshot.campaign.preparation.region)).not.toBe(
        previousRegion,
      );
    }
    expect(errors).toEqual([]);
  });
}
