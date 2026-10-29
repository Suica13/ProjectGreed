const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
const { createServer } = require("../server.js");
for (const width of [1280, 390])
  test(`continuous tech pages, locked ACE preview and refit-only production at ${width}px`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => I18n.setLanguage("zh"));
    await page.locator("#shellHangar").click();
    await page.locator("#shellDevelopment").click();
    const rows = await page.evaluate(() => {
      const nodes = Development.nodes(byId("developmentFactionSelect").value);
      const bottom = (page) =>
        Math[page ? "min" : "max"](
          ...nodes
            .filter((n) => (n.page || 0) === page)
            .map(
              (n) =>
                byId("developmentTree")
                  .querySelector('[data-tech-id="' + n.id + '"]')
                  .getBoundingClientRect()[page ? "top" : "bottom"],
            ),
        );
      const scroll = byId("developmentTree").closest(".development-tree-scroll");
      return {
        early: bottom(0),
        late: bottom(1),
        count: document.querySelectorAll(".development-node").length,
        total: nodes.length,
        overflow: scroll.scrollWidth - scroll.clientWidth,
      };
    });
    expect(rows.count).toBe(rows.total);
    expect(rows.late).toBeGreaterThan(rows.early);
    expect(rows.overflow).toBeLessThanOrEqual(1);
    await expect(page.locator(".development-era-divider")).toHaveText("0079后期");
    await page
      .locator("#shellSubnav button")
      .filter({ hasText: /^驾驶员$/ })
      .click();
    await expect(page.locator("#recruitAcePilot")).toBeEnabled();
    await page.locator("#recruitAcePilot").click();
    await expect(page.locator("#aceRecruitList")).toContainText("未解锁");
    await expect(page.locator("#aceRecruitPreview")).toContainText("EFSF");
    await expect(page.locator("#aceRecruitPreview")).toContainText("0079");
    await expect(page.locator("#confirmRecruitAce")).toBeDisabled();
    const count = await page.locator("#aceRecruitList button").count();
    expect(count).toBe(20);
    await page.evaluate(() => byId("aceRecruitDialog").close());
    await page.evaluate(() => ProductionUI.openUnit("MS_06S_CharCustom"));
    await expect(page.locator("#produceUnit")).toBeDisabled();
    await expect(page.locator("#produceUnit")).toContainText("改装来自：");
    expect(errors).toEqual([]);
  });
test("admin configures ACE rewards and server-wide kill progress remains after reload", async ({
  page,
  context,
}) => {
  const app = createServer({ host: "127.0.0.1", port: 0 });
  const address = await app.listen();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    await page.goto(base);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => I18n.setLanguage("zh"));
    await page.evaluate((base) => Lobby.reconnect(base), base);
    await expect(page.locator("#openServerActivities")).toBeEnabled();
    const admin = await context.newPage();
    await admin.goto(base + "/admin/activities.html");
    await admin.locator("#newActivity").click();
    await admin.locator("#title").fill("累计COST测试");
    await admin.locator("#body").fill("test");
    await admin.locator("#mode").selectOption("cumulative_kill_cost");
    const period = await admin.evaluate(() => {
      const local = (n) => {
        const d = new Date(Date.now() + n);
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        return d.toISOString().slice(0, 16);
      };
      return [local(-60000), local(3600000)];
    });
    await admin.locator("#startsAt").fill(period[0]);
    await admin.locator("#endsAt").fill(period[1]);
    await admin.locator("#targetCost").fill("100");
    await admin.locator("#addAceUnlock").click();
    await admin.locator("#aceUnlocks select").selectOption("Pilot_ZEON_0079_N_ACE_CIA");
    await admin.locator("#publish").click();
    await expect(admin.locator("#selectedTitle")).toHaveText("累计COST测试");
    const id = await page.evaluate(() => ProfileIdentity.snapshot().id);
    app.activities.recordKill({ id: "browser-kill", cost: 100, profileIds: [id] });
    await page.locator("#openServerActivities").click();
    await page
      .locator(".server-activities-list button")
      .filter({ hasText: "累计COST测试" })
      .click();
    await expect(page.locator(".server-activities-detail")).toContainText("100 / 100");
    await expect(page.locator(".server-activities-detail")).toContainText("西玛");
    await page.locator("#acceptServerActivity").click();
    await expect(page.locator("#acceptServerActivity")).toHaveText("已接受");
    expect(await page.evaluate(() => Development.allows("EFSF", "Pilot_ZEON_0079_N_ACE_CIA"))).toBe(
      true,
    );
    await page.reload();
    await page.waitForFunction(() => assetsReady);
    await page.evaluate((base) => Lobby.reconnect(base), base);
    await expect(page.locator("#openServerActivities")).toBeEnabled();
    await page.locator("#openServerActivities").click();
    await page
      .locator(".server-activities-list button")
      .filter({ hasText: "累计COST测试" })
      .click();
    await expect(page.locator(".server-activities-detail")).toContainText("100 / 100");
    await expect(page.locator("#acceptServerActivity")).toHaveText("已接受");
  } finally {
    await app.close();
  }
});

test("automatic ACE hull preview keeps equipment valid and unassignment restores the original stock", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => {
    const pilot = PilotSystem.createAce("Pilot_ZEON_0079_N_ACE_CHA");
    PlayerProfile.setFaction("PMC");
    localStorage.setItem(
      "projectgreed.custom-pilots.v3.shared",
      JSON.stringify({ pilots: [pilot], awards: [] }),
    );
    localStorage.setItem(
      "slg-formations-v1.PMC",
      JSON.stringify({
        version: 3,
        squads: [
          {
            name: "Char",
            units: [{ unitId: "MS_06S", kitId: Economy.baseKit("MS_06S"), customPilot: pilot }],
          },
        ],
      }),
    );
  });
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  await page.locator("#shellHangar").click();
  await expect(page.locator("#formationUnits")).toContainText("夏亚");
  await page.locator("#formationUnits .formation-detail-button").first().click();
  await expect(page.locator("#formationDetailTitle")).toContainText("夏亚");
  await expect(page.locator("#formationDetailKit")).toHaveValue(
    await page.evaluate(() => Formation.current()[0].kitId),
  );
  await page.locator("#formationDetailPilot").click();
  await page
    .locator("#formationPilotList .formation-pilot-card")
    .first()
    .getByRole("button")
    .click();
  const canonical = await page.evaluate(() => Formation.current()[0]);
  expect(canonical.unitId).toBe("MS_06S");
  expect(canonical.customPilot).toBeUndefined();
  await expect(page.locator("#formationDetailTitle")).not.toContainText("夏亚");
  expect(errors).toEqual([]);
});
