const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
async function campaign(page) {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.evaluate(() => {
    const f = createRoomEngine;
    createRoomEngine = (o) => (window.testEngine = f(o));
  });
  await page.locator("#openSkirmish").click();
  await page.locator("#offlineRoomMode").selectOption("campaign");
  await page.locator("#createOfflineRoom").click();
  await page.locator("#startRoomGame").click();
  await page.locator(".campaign-setup button").last().click();
  await expect(page.locator("#campaignScreen")).toBeVisible();
  await expect.poll(() => page.evaluate(() => Net.awaiting)).toBe(null);
}
test("encounter sidebar follows each pending region instead of retaining Jaburo and its Dish", async ({
  page,
}) => {
  await campaign(page);
  await expect(page.locator(".campaign-detail h3")).toContainText("贾布罗");
  await page.evaluate(() => {
    const room = [...testEngine.rooms.values()][0],
      s = room.campaign,
      ctx = { G: Rules, production: PRODUCTION_CATALOG };
    // Keep Jaburo's real Dish; only the currently selected region must change.
    s.units = s.units.filter((u) => u.region === "jaburo");
    for (const r of ["canada_east", "canada"]) {
      CampaignRules.addUnit(ctx, s, 0, r, "Type61");
      const e = CampaignRules.addUnit(ctx, s, 1, r, "MS_06F");
      e.entryFrom = "new_york";
    }
    s.phase = "encounters";
    s.encounters = [{ region: "canada_east", turn: 0, battleSave: null, roster: {}, settled: [] }];
    room.revision++;
    testEngine.broadcast(room);
  });
  await expect(page.locator("#campaignEncounterDialog")).toBeVisible();
  await expect(page.locator(".campaign-detail h3")).toHaveText("加拿大东部");
  await expect(page.locator(".campaign-detail .campaign-force-card")).toHaveCount(1);
  await expect(page.locator(".campaign-detail")).not.toContainText("天碟");
  await page.evaluate(() => {
    const room = [...testEngine.rooms.values()][0],
      s = room.campaign;
    s.preparation = null;
    s.encounters = [{ region: "canada", turn: 0, battleSave: null, roster: {}, settled: [] }];
    room.revision++;
    testEngine.broadcast(room);
  });
  await expect(page.locator(".campaign-detail h3")).toHaveText("加拿大西部");
  await expect(page.locator(".campaign-detail .campaign-force-card")).toHaveCount(1);
});
test("strategic research prices, localized search and repeated language switches render correctly", async ({
  page,
}) => {
  await campaign(page);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluate(() => CampaignWorkspace.open("research", "jaburo"));
  const panel = page.locator("#campaignWorkspace");
  await expect(panel).toBeVisible();
  const tech = await page.evaluate(() => {
    const n = Development.nodes("EFSF").find(
      (n) => !Net.snapshot.campaign.teams[0].researched.includes(n.id),
    );
    return { id: n.id, price: CampaignRules.researchPoints({ world: CAMPAIGN_WORLD }, n) };
  });
  await expect(panel.locator('[data-tech-id="' + tech.id + '"]')).toContainText(
    "科技 " + tech.price.toLocaleString("en-US"),
  );
  for (const language of ["en", "ja", "zh", "en"]) {
    await page.evaluate((l) => {
      I18n.setLanguage(l);
      CampaignWorkspace.refresh();
    }, language);
    await expect(panel.locator("h2")).toHaveText(
      language === "en" ? "Technology research" : language === "ja" ? "技術開発" : "科技开发",
    );
    const scan = await page.evaluate(() => ({
      text: document.querySelector("#campaignWorkspace").innerText,
      tech: Development.factions
        .flatMap((f) => Development.nodes(f))
        .map((n) => I18n.text(n.name) + " " + I18n.text(n.description)),
      factions: ["奥古", "提坦斯", "新吉翁"].map(I18n.text),
    }));
    if (language === "en") {
      expect(scan.text).not.toMatch(/[\u3400-\u9fff]/);
      expect(scan.tech.join(" ")).not.toMatch(/[\u3400-\u9fff]/);
      expect(scan.factions).toEqual(["AEUG", "Titans", "Neo Zeon"]);
      await panel.locator("input[type=search]").fill("Anti-MS");
      await expect(panel.locator(".campaign-tech-node")).toHaveCount(1);
      await expect(panel.locator(".campaign-tech-node")).toContainText("Anti-MS Project");
      await panel.locator("input[type=search]").fill("");
    } else if (language === "ja") {
      expect(scan.text).toContain("ジム開発計画");
      expect(scan.text).not.toContain("解锁");
      expect(scan.factions).toEqual(["エゥーゴ", "ティターンズ", "ネオ・ジオン"]);
    }
  }
  expect(errors).toEqual([]);
});
