const { test, expect } = require("@playwright/test"),
  { createServer } = require("../server.js");
for (const width of [1280, 390])
  test(`server mail welcome, durable identity and GUI publishing at ${width}px`, async ({
    page,
    context,
  }) => {
    const app = createServer({ host: "127.0.0.1", port: 0 }),
      address = await app.listen(),
      base = `http://127.0.0.1:${address.port}`;
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    try {
      await page.goto(base);
      await page.waitForFunction(() => assetsReady);
      await page.evaluate(() => I18n.setLanguage("zh"));
      await page.evaluate((base) => Lobby.reconnect(base), base);
      await expect(page.locator("#lobby")).toBeVisible();
      await expect(page.locator("#openServerActivities")).toBeEnabled();
      await page.locator("#openServerActivities").click();
      await expect(page.locator("#serverActivitiesDialog")).toContainText("首次加入服务器奖励");
      await expect(page.locator("#serverActivitiesDialog")).toContainText("陆战型吉姆");
      await expect(page.locator("#serverActivitiesDialog")).toContainText("大魔");
      await page.locator("#acceptServerActivity").click();
      await expect(page.locator("#acceptServerActivity")).toHaveText("已接受");
      const before = await page.evaluate(() => ({
        money: Economy.snapshot().money,
        supplies: Economy.snapshot().supplies,
        gm: Economy.quantity("RGM_79_G"),
        dom: Economy.quantity("MS_09"),
        identity: ProfileIdentity.snapshot(),
      }));
      expect(before).toMatchObject({ money: 10000, supplies: 20000, gm: 3, dom: 3 });
      expect(await page.evaluate(() => ProfileSave.exportData().identity)).toEqual(before.identity);
      await page.reload();
      await page.waitForFunction(() => assetsReady);
      await page.evaluate(() => I18n.setLanguage("zh"));
      await page.evaluate((base) => Lobby.reconnect(base), base);
      await expect(page.locator("#openServerActivities")).toBeEnabled();
      await page.locator("#openServerActivities").click();
      await page
        .locator(".server-activities-list button")
        .filter({ hasText: "首次加入服务器奖励" })
        .click();
      await expect(page.locator("#acceptServerActivity")).toHaveText("已接受");
      expect(await page.evaluate(() => Economy.snapshot().money)).toBe(10000);
      const admin = await context.newPage();
      await admin.goto(base + "/admin/activities.html");
      await expect(admin.locator("#activities button")).toHaveCount(4);
      await admin.locator("#activities button").filter({ hasText: "首次加入服务器奖励" }).click();
      await expect(admin.locator("#newActivityPanel")).toBeHidden();
      await admin.locator("#editTitle").fill("更新后的欢迎活动");
      await admin.locator("#editBody").fill("更新后的欢迎文案");
      await admin.locator("#saveCopy").click();
      await expect(admin.locator("#status")).toContainText("文案和时期已保存");
      await expect(page.locator(".server-activities-detail")).toContainText("更新后的欢迎文案");
      await expect(page.locator("#acceptServerActivity")).toHaveText("已接受");
      await admin.locator("#newActivity").click();
      await expect(admin.locator("#newActivityPanel")).toBeVisible();
      await admin.locator("#title").fill("在线补给测试");
      await admin.locator("#body").fill("GUI发布的邮件正文");
      await admin.locator("#mode").selectOption("online_now");
      await admin.locator("#money").fill("123");
      await admin.locator("#supplies").fill("456");
      await admin.locator("#addUnlock").click();
      await admin.locator("#unlocks select").selectOption("RGM_79_G");
      await admin.locator("#addUnlock").click();
      await admin.locator("#unlocks select").nth(1).selectOption("MS_09");
      await admin
        .locator("#unlocks .reward-unlock")
        .nth(1)
        .getByRole("button", { name: "删除开发单位 MS_09", exact: true })
        .click();
      await expect(admin.locator("#unlocks select")).toHaveCount(1);
      await expect(admin.locator("#unlocks select")).toHaveValue("RGM_79_G");
      await expect(admin.locator("#unlocks select[multiple]")).toHaveCount(0);
      await admin.locator("#addUnit").click();
      await admin.locator(".reward-unit select").selectOption("Type61");
      await admin.locator(".reward-unit input").fill("2");
      await admin.locator("#publish").click();
      await expect(admin.locator("#status")).toContainText("已投递 1 封");
      await page
        .locator(".server-activities-list button")
        .filter({ hasText: "在线补给测试" })
        .click();
      await expect(page.locator(".server-activities-detail")).toContainText("立即开发");
      await page.locator("#acceptServerActivity").click();
      await expect(page.locator("#acceptServerActivity")).toHaveText("已接受");
      expect(
        await page.evaluate(() => ({
          money: Economy.snapshot().money,
          supplies: Economy.snapshot().supplies,
          owned: Economy.quantity("Type61"),
          unlocked: Development.allows("EFSF", "RGM_79_G"),
        })),
      ).toEqual({ money: 10123, supplies: 20456, owned: 26, unlocked: true });
      expect(
        await page
          .locator("#serverActivitiesDialog")
          .evaluate((node) => node.scrollWidth > node.clientWidth),
      ).toBe(false);
      await admin.close();
      expect(errors).toEqual([]);
    } finally {
      await app.close();
    }
  });

test("administrator API rejects cross-origin publishing and hostile Host headers", async ({
  request,
}) => {
  const app = createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen(),
    base = `http://127.0.0.1:${address.port}`;
  try {
    expect(
      (
        await request.get(base + "/api/activities/admin", { headers: { Host: "evil.example" } })
      ).status(),
    ).toBe(403);
    expect(
      (
        await request.post(base + "/api/activities/admin/publish", {
          headers: { Origin: "https://evil.example" },
          data: {},
        })
      ).status(),
    ).toBe(403);
    expect(
      (await request.post(base + "/api/activities/admin/publish", { data: {} })).status(),
    ).toBe(403);
  } finally {
    await app.close();
  }
});

test("failed local persistence retries the same server mail after reconnect without duplicate rewards", async ({
  page,
}) => {
  const app = createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen(),
    base = `http://127.0.0.1:${address.port}`;
  try {
    await page.goto(base);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => I18n.setLanguage("zh"));
    await page.evaluate((base) => Lobby.reconnect(base), base);
    await expect(page.locator("#openServerActivities")).toBeEnabled();
    await page.locator("#openServerActivities").click();
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      let failed = false;
      Storage.prototype.setItem = function (key, value) {
        if (!failed && key === "projectgreed.developmentProgress.v1") {
          failed = true;
          throw Error("test quota");
        }
        return original.call(this, key, value);
      };
    });
    await page.locator("#acceptServerActivity").click();
    await expect(page.locator("#serverActivityStatus")).toContainText("接收失败");
    expect(await page.evaluate(() => Economy.snapshot().money)).toBe(5000);
    await page.reload();
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => I18n.setLanguage("zh"));
    await page.evaluate((base) => Lobby.reconnect(base), base);
    await expect.poll(() => page.evaluate(() => Economy.snapshot().money)).toBe(10000);
    await page.locator("#openServerActivities").click();
    await expect(page.locator("#acceptServerActivity")).toHaveText("已接受");
    expect(await page.evaluate(() => Economy.quantity("RGM_79_G"))).toBe(3);
    expect(app.activities.adminSnapshot().activities[0].accepted).toBe(1);
  } finally {
    await app.close();
  }
});

for (const width of [1280, 390])
  test(`login activity types and editable periods at ${width}px`, async ({ page }) => {
    const app = createServer({ host: "127.0.0.1", port: 0 }),
      address = await app.listen();
    const base = `http://127.0.0.1:${address.port}`;
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(base + "/admin/activities.html");
      await expect(page.locator("#activities button")).toHaveCount(4);
      const start = new Date(Date.now() + 86400000),
        end = new Date(Date.now() + 3 * 86400000);
      const local = (date) => {
        const d = new Date(date);
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        return d.toISOString().slice(0, 16);
      };
      for (const mode of ["daily_login", "weekly_login", "cumulative_login", "battle_bonus"]) {
        await page.locator("#newActivity").click();
        await page.locator("#title").fill("test-" + mode);
        await page.locator("#mode").selectOption(mode);
        await page.locator("#startsAt").fill(local(start));
        await page.locator("#endsAt").fill(local(end));
        if (mode === "cumulative_login") {
          await expect(page.locator("#loginDaysLabel")).toBeVisible();
          await page.locator("#loginDays").fill("3");
        }
        if (mode === "battle_bonus") {
          await expect(page.locator("#rewardFields")).toBeHidden();
          await expect(page.locator("#bonusFields")).toBeVisible();
          for (const key of ["experience", "money", "supplies", "technology"])
            await page.locator("#multiplier" + key).fill("2");
        } else await page.locator("#money").fill("10");
        await page.locator("#publish").click();
        await expect(page.locator("#selectedTitle")).toHaveText("test-" + mode);
        await expect(page.locator("#newActivityPanel")).toBeHidden();
        await expect(page.locator("#editStartsAt")).toHaveValue(local(start));
        const changed = new Date(end.getTime() + 86400000);
        await page.locator("#editEndsAt").fill(local(changed));
        if (mode === "cumulative_login") await page.locator("#editLoginDays").fill("4");
        if (mode === "battle_bonus") await page.locator("#editMultipliermoney").fill("3");
        await page.locator("#saveCopy").click();
        await expect(page.locator("#status")).toContainText("文案和时期已保存");
        const response = await page.request.get(base + "/api/activities/admin"),
          data = await response.json();
        const activity = data.activities.find((activity) => activity.title === "test-" + mode);
        expect(activity.endsAt).toBe(new Date(local(changed)).getTime());
        if (mode === "cumulative_login") expect(activity.loginDays).toBe(4);
        if (mode === "battle_bonus")
          expect(activity.multipliers).toEqual({
            experience: 2,
            money: 3,
            supplies: 2,
            technology: 2,
          });
      }
      expect(errors).toEqual([]);
    } finally {
      await app.close();
    }
  });

test("opening the admin HTML file connects through the configured local server", async ({
  page,
}) => {
  const { pathToFileURL } = require("node:url"),
    path = require("node:path");
  const app = createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(pathToFileURL(path.resolve("admin/activities.html")).href);
    await expect(page.locator("#serverConnection")).toBeVisible();
    await expect(page.locator("main")).toBeHidden();
    await page.locator("#adminServerAddress").fill(`127.0.0.1:${address.port}`);
    await page.locator("#serverConnection button").click();
    await expect(page).toHaveURL(`http://127.0.0.1:${address.port}/admin/activities.html`);
    await expect(page.locator("#activities button")).toHaveCount(4);
    await page.locator("#activities button").filter({ hasText: "超级煤球真理部" }).click();
    await page.locator("#editBody").fill("从本地HTML连接后编辑");
    await page.locator("#saveCopy").click();
    await expect(page.locator("#status")).toContainText("文案和时期已保存");
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
