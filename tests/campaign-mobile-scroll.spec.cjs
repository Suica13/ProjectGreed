const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const width of [360, 390, 700, 1440])
  test("campaign regional panel and production remain scrollable / " + width, async ({ page }) => {
    test.setTimeout(45000);
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 740 });
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await expect(page.locator("#openSkirmish")).toBeEnabled();
    await page.locator("#openSkirmish").click();
    await page.locator("#offlineRoomMode").selectOption("campaign");
    await page.locator("#createOfflineRoom").click();
    await page.locator("#startRoomGame").click();
    await page.locator(".campaign-setup button").last().click();
    await expect(page.locator("#campaignScreen")).toBeVisible();
    const detail = page.locator(".campaign-detail");
    if (width <= 700) {
      const info = await detail.evaluate((el) => ({
        overflow: getComputedStyle(el).overflowY,
        client: el.clientHeight,
        scroll: el.scrollHeight,
      }));
      expect(["auto", "scroll"]).toContain(info.overflow);
      expect(info.client).toBeGreaterThan(50);
    }
    if (width <= 700) {
      const box = await detail.boundingBox(),
        session = await page.context().newCDPSession(page),
        x = box.x + 12,
        start = box.y + box.height - 15,
        end = box.y + 15;
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y: start }],
      });
      for (let i = 1; i <= 5; i++) {
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: start + ((end - start) * i) / 5 }],
        });
        await page.waitForTimeout(25);
      }
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect.poll(() => detail.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      await session.detach();
    }
    await detail.getByRole("button", { name: "生产", exact: true }).click();
    const workspace = page.locator("#campaignWorkspace");
    await expect(workspace).toBeVisible();
    await workspace.locator('[data-unit-id="Type61"]').click();
    const submit = workspace.getByRole("button", { name: "提交生产请求", exact: true });
    await submit.scrollIntoViewIfNeeded();
    const visible = await submit.evaluate((el) => {
      const r = el.getBoundingClientRect(),
        p = el.closest(".campaign-workspace-body").getBoundingClientRect();
      return r.top >= p.top - 1 && r.bottom <= p.bottom + 1;
    });
    expect(visible).toBe(true);
    if (width <= 700) {
      const body = workspace.locator(".campaign-workspace-body");
      expect(await body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      await body.evaluate((el) => (el.scrollTop = 0));
      await page.mouse.move(width / 2, 450);
      await page.mouse.wheel(0, 800);
      await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    }
    await page.screenshot({
      path: "tmp/verification/screenshots/campaign-mobile-scroll-" + width + ".png",
    });
  });
