const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const width of [1440, 390])
  test(`mission illustrations, lock marker and transactional servicing at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 950 });
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await expect(page.locator("#openSkirmish")).toBeEnabled();
    await page.evaluate(() => {
      const original = createRoomEngine;
      createRoomEngine = (options) =>
        (window.logisticsEngine = original({ ...options, randomSeed: () => 7319, aiDelayMs: 999999 }));
    });
    await page.locator("#openSkirmish").click();
    await page.locator("#offlineRoomMode").selectOption("sweep");
    await page.locator("#createOfflineRoom").click();
    if (width === 390) await page.getByRole("button", { name: "房间设置", exact: true }).click();
    await expect(page.locator("#roomTechnologyLimitMode")).toHaveValue("host");
    await page.locator("#roomTechnologyLimitMode").selectOption("custom");
    await expect(page.locator("#roomTechnologyLimit")).toBeVisible();
    await page.locator("#roomTechnologyLimit").fill("2500");
    await page.locator("#roomTechnologyLimit").press("Tab");
    await expect.poll(() => page.evaluate(() => Net.snapshot.settings.technologyLimit)).toBe(2500);
    if (width === 390) await page.locator("#closeRoomSettingsSheet").click();
    await page.locator("#startRoomGame").click();
    await page.locator("#confirmFinalFormation").click();
    await expect(page.locator("#sweepMission")).toBeVisible();
    await expect(page.locator("#sweepSummary .resource-icon")).toHaveCount(3);
    const progressText = await page.locator(".sweep-progress > span").boundingBox();
    const lootButton = await page.locator("#sweepLootButton").boundingBox();
    expect(lootButton.x).toBeGreaterThanOrEqual(progressText.x + progressText.width);
    expect(Math.abs(lootButton.y + lootButton.height / 2 - progressText.y - progressText.height / 2)).toBeLessThan(2);
    await page.locator("#sweepLootButton").click();
    await expect(page.locator("#sweepInfo")).toBeVisible();
    await page.locator("#sweepInfo").getByRole("button", { name: "关闭", exact: true }).click();
    await expect(page.locator(".sweep-node .sweep-scene").first()).toBeVisible();
    const rowSpacing = await page.locator("#sweepRoute").evaluate((route) => {
      const rows = [...new Set([...route.querySelectorAll("button[data-sweep-node]")].map((b) => b.offsetTop))].sort((a,b) => a-b);
      return rows.slice(1).map((y,i) => y-rows[i]);
    });
    expect(rowSpacing.length).toBeGreaterThan(1);
    expect(Math.min(...rowSpacing)).toBe(150);
    const routeState = await page.locator("#sweepRoute").evaluate((route) => ({
      depths: [...route.querySelectorAll("button[data-sweep-node]")].map((b) => Number(b.dataset.sweepNode.split(":")[0])),
      bottom: route.parentElement.scrollHeight - route.parentElement.clientHeight - route.parentElement.scrollTop,
    }));
    expect(Math.max(...routeState.depths)).toBe(4);
    expect(routeState.bottom).toBeLessThan(2);
    await expect(page.locator("#sweepRoute svg line").first()).toHaveAttribute("stroke-width", "3.5");
    await expect(page.locator("#sweepRoute svg line").first()).toHaveAttribute("marker-end", "url(#sweepRouteArrow)");
    expect(
      await page.locator(".sweep-stage").evaluate((el) => getComputedStyle(el).backgroundImage),
    ).toContain("data:image/png;base64");
    await page.evaluate(() => {
      const room = [...window.logisticsEngine.rooms.values()][0];
      room.sweep.nodes.find((n) => n.id === "0:0").type = "rest";
      const own = room.seats[0];
      room.sweep.pending[own.id].money = 10000;
      room.sweep.pending[own.id].supplies = 10000;
      room.sweep.pending[own.id].technology = 750;
      Net.request("sync");
    });
    await expect(page.locator("#hudMatchIncome .resource-money")).toHaveText("10,000");
    await expect(page.locator("#hudMatchIncome .resource-technology")).toHaveText("750");
    await page.locator('[data-sweep-node="0:0"]').click();
    await expect(page.locator(".sweep-node.selected")).toHaveCount(1);
    expect(
      await page
        .locator(".sweep-node.selected")
        .evaluate((el) => getComputedStyle(el, "::after").animationName),
    ).toBe("sweep-lock");
    await page.locator("#sweepConfirm").click();
    await expect(page.locator(".sweep-event-scene")).toBeVisible();
    await page.getByRole("button", { name: "开放机库补员", exact: true }).click();
    await expect(page.locator(".sweep-restock-cost")).toBeVisible();
    await expect(page.locator(".sweep-restock-cost .resource-icon")).toHaveCount(5);
    const before = await page.evaluate(
      () => Net.snapshot.sweep.teams.find((t) => t.id === Net.memberId).units.length,
    );
    await page.getByRole("button", { name: "遣返回机库", exact: true }).first().click();
    await expect(page.locator(".sweep-restock-cost")).toContainText("遣返机体 1/3");
    expect(
      await page.evaluate(
        () => Net.snapshot.sweep.teams.find((t) => t.id === Net.memberId).units.length,
      ),
    ).toBe(before);
    await page
      .locator(".sweep-restock-cost")
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await expect(page.getByRole("button", { name: "开放机库补员", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "开放机库补员", exact: true }).click();
    await page.getByRole("button", { name: "遣返回机库", exact: true }).first().click();
    await page.getByRole("button", { name: "＋", exact: true }).first().click();
    await expect(page.locator(".sweep-picker")).toBeVisible();
    await expect(page.locator(".sweep-restock-card.blocked").first()).toBeVisible();
    await page
      .locator(".sweep-picker")
      .getByRole("button", { name: "关闭选择", exact: true })
      .click();
    await page
      .locator(".sweep-restock-cost")
      .getByRole("button", { name: "确定", exact: true })
      .click();
    await expect(page.locator(".sweep-restock-cost")).toContainText("已确认整备");
    expect(
      await page.evaluate(
        () => Net.snapshot.sweep.teams.find((t) => t.id === Net.memberId).units.length,
      ),
    ).toBe(before - 1);
    await page.screenshot({ path: `tmp/verification/screenshots/mission-logistics-${width}.png` });
    expect(errors).toEqual([]);
  });
test("pilot sorting keeps PMC first and sorts names or descending levels inside faction groups", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.evaluate(() => {
    const a = PilotSystem.createCustom("custom-sort-a", "Zeta", null, "PMC"),
      b = PilotSystem.createCustom("custom-sort-b", "Alpha", null, "PMC");
    a.level = 3;
    a.experience = 3000;
    const ace = PilotSystem.createAce(PilotSystem.catalog.aces.find((a) => a.price).id);
    localStorage.setItem(
      "projectgreed.custom-pilots.v3.shared",
      JSON.stringify({ pilots: [a, ace, b], awards: [] }),
    );
  });
  await page.reload();
  await page.locator("#shellHangar").click();
  await page.locator("#shellSubnav").getByRole("button", { name: "驾驶员", exact: true }).click();
  await expect(page.locator("#pilotRosterSort")).toHaveValue("name");
  await expect(page.locator("#customPilotList .custom-pilot-card").first()).toHaveAttribute(
    "data-pilot-id",
    "custom-sort-b",
  );
  await page.locator("#pilotRosterSort").selectOption("level");
  await expect(page.locator("#customPilotList .custom-pilot-card").first()).toHaveAttribute(
    "data-pilot-id",
    "custom-sort-a",
  );
});
