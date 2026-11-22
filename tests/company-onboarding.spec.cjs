const { test, expect } = require("@playwright/test"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url");
const url = pathToFileURL(path.resolve("public/client.html")).href;
const P = require("../shared/pilots");
const preservedPilots = Array.from({ length: 12 }, (_, i) =>
  P.custom({
    ...P.createCustom("custom-preserved-" + i, "Veteran " + i),
    level: 6,
    experience: 45000,
    reincarnations: 1,
    personality: "custom",
    record: { kills: i + 5, battles: 20, losses: 1, shipKills: 2 },
  }),
);
for (const [width, faction, inventory] of [
  [1440, "EFSF", { RGM_79_Commander: 1, RGM_79: 2, MedeaKai: 1, ColumbusClass: 1 }],
  [390, "ZEON", { MS_06F2_Commander: 1, MS_06F2: 2, FatUncleKai: 1, PapuaClass: 1 }],
])
  test(`first company registration, persistence and portable name at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 960 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => assetsReady);
    await expect(page.locator("#profileOnboarding")).toBeVisible();
    await expect(page.locator("#profileOnboardingCancel")).not.toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#profileOnboarding")).toBeVisible();
    expect(await page.evaluate(() => Economy.snapshot().inventory)).toEqual({});
    await expect(page.locator("#profileOnboarding")).toContainText("仅影响初始单位");
    await page.locator("#profileCompanyName").fill("测试PMC " + faction);
    await page.locator(`#profileOnboarding input[value="${faction}"]`).check();
    await page.screenshot({ path: `tmp/verification/screenshots/company-setup-${width}.png` });
    await page.locator("#profileOnboardingConfirm").click();
    await expect(page.locator("#profileOnboarding")).not.toBeVisible();
    const first = await page.evaluate(() => ({
      state: Economy.snapshot(),
      name: PlayerProfile.name(),
      profile: ProfileSave.encodeData(),
      missions: [...document.querySelectorAll('option[value="mission"]')].map((o) => o.disabled),
    }));
    expect(first.state.inventory).toEqual(inventory);
    expect(first.state.storage.units).toHaveLength(3);
    expect(first.state.storage.ships).toHaveLength(2);
    expect(first.name).toBe("测试PMC " + faction);
    expect(first.profile.companyName).toBe(first.name);
    expect(first.missions).toEqual([true, true, true]);
    await page.evaluate(() => ProfileSave.importData(ProfileSave.encodeData()));
    await page.reload();
    await page.waitForFunction(() => assetsReady);
    await expect(page.locator("#profileOnboarding")).not.toBeVisible();
    expect(await page.evaluate(() => Economy.snapshot().inventory)).toEqual(inventory);
    await page.evaluate(() => {
      const state = Economy.snapshot();
      delete state.startingFaction;
      delete state.onboardingPending;
      localStorage.setItem(Economy.key, SaveCodec.stringify(state));
    });
    await page.reload();
    await page.waitForFunction(() => assetsReady);
    await expect(page.locator("#profileOnboarding")).not.toBeVisible();
    expect(await page.evaluate(() => Economy.snapshot().inventory)).toEqual(inventory);
    expect(await page.evaluate(() => ProfileSave.encodeData().companyName)).toBe(first.name);
    expect(errors).toEqual([]);
  });

test("new-save selection and overwrite confirmation are cancellable before replacing an existing company", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto(url);
  await page.waitForFunction(() => assetsReady);
  await page.locator("#profileCompanyName").fill("First PMC");
  await page.locator("#profileOnboardingConfirm").click();
  await page.evaluate((pilots) => {
    const profile = ProfileSave.encodeData();
    profile.pilots.PMC.pilots = pilots;
    ProfileSave.importData(profile);
  }, preservedPilots);
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  const pilotsBefore = await page.evaluate(() => ProfileSave.encodeData().pilots.PMC.pilots);
  const before = await page.evaluate(() => Economy.snapshot());
  await page.evaluate(() => document.getElementById("newProfileSave").click());
  await page.locator("#profileCompanyName").fill("Cancelled PMC");
  await page.locator("#profileOnboardingCancel").click();
  expect(await page.evaluate(() => Economy.snapshot())).toEqual(before);
  await page.evaluate(() => document.getElementById("newProfileSave").click());
  await page.locator("#profileCompanyName").fill("New ZEON PMC");
  await page.locator('#profileOnboarding input[value="ZEON"]').check();
  await page.locator("#profileOnboardingConfirm").click();
  await expect(page.locator("#gameDialog")).toContainText("新建存档将重置");
  expect(await page.evaluate(() => Economy.snapshot())).toEqual(before);
  await page.locator("#gameDialog").getByRole("button", { name: "新建存档", exact: true }).click();
  await page.waitForFunction(
    () =>
      typeof assetsReady !== "undefined" &&
      assetsReady &&
      Economy.snapshot().startingFaction === "ZEON",
  );
  await expect(page.locator("#profileOnboarding")).not.toBeVisible();
  expect(await page.evaluate(() => PlayerProfile.name())).toBe("New ZEON PMC");
  const pilotsAfter = await page.evaluate(() => ProfileSave.encodeData().pilots.PMC.pilots);
  expect(pilotsAfter.map(({ inDormStorage, ...p }) => p)).toEqual(
    pilotsBefore.map(({ inDormStorage, ...p }) => p),
  );
  expect(pilotsAfter.filter((p) => p.inDormStorage)).toHaveLength(2);
  expect(await page.evaluate(() => Economy.snapshot().inventory)).toEqual({
    MS_06F2_Commander: 1,
    MS_06F2: 2,
    FatUncleKai: 1,
    PapuaClass: 1,
  });
});

test("existing epoch-one profile resets stock once and preserves full custom pilots through onboarding", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto(url);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate((pilots) => {
    localStorage.setItem(
      "projectgreed.custom-pilots.v3.shared",
      JSON.stringify({ pilots, awards: [] }),
    );
    localStorage.setItem("projectgreed.progress-reset.v1", "1");
    const economy = Economy.snapshot();
    economy.progressEpoch = 1;
    economy.money = 999999;
    localStorage.setItem(Economy.key, SaveCodec.stringify(economy));
  }, preservedPilots);
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  await expect(page.locator("#profileOnboarding")).toBeVisible();
  expect(await page.evaluate(() => Economy.snapshot().money)).toBe(8000);
  expect(await page.evaluate(() => Economy.snapshot().inventory)).toEqual({});
  const kept = await page.evaluate(() => ProfileSave.encodeData().pilots.PMC.pilots);
  expect(kept.map(({ inDormStorage, ...p }) => p)).toEqual(
    preservedPilots.map(({ inDormStorage, ...p }) => ({ ...p, faction: "PMC" })),
  );
  expect(kept.filter((p) => p.inDormStorage)).toHaveLength(2);
  await page.locator("#profileCompanyName").fill("Retained PMC");
  await page.locator("#profileOnboardingConfirm").click();
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  await expect(page.locator("#profileOnboarding")).not.toBeVisible();
  expect(await page.evaluate(() => ProfileSave.encodeData().pilots.PMC.pilots)).toEqual(kept);
  expect(await page.evaluate(() => Economy.snapshot().storage.units.length)).toBe(3);
});
