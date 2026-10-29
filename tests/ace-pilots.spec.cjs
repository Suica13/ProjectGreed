const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
async function open(page, html = "client", unlock = true) {
  await page.addInitScript(() => {
    localStorage.setItem("projectgreed.language", "zh");
    if (!localStorage.getItem("ace-test-wallet")) {
      localStorage.setItem(
        "projectgreed.economy.v1",
        JSON.stringify({ money: 1000000, supplies: 1000000, inventory: {}, kits: {} }),
      );
      localStorage.setItem("ace-test-wallet", "1");
    }
  });
  await page.goto(pathToFileURL(path.resolve("public/" + html + ".html")).href);
  await page.waitForFunction(() => assetsReady);
  if (unlock)
    await page.evaluate(() => {
      for (const p of PilotSystem.catalog.aces) Development.grantUnit(p.faction, p.id);
    });
  await page.locator("#shellHangar").click();
  await page
    .locator("#shellSubnav button")
    .filter({ hasText: /^\u9a7e\u9a76\u5458$/ })
    .click();
}
for (const [html, width] of [
  ["client", 1280],
  ["developer", 390],
])
  test(`${html} ACE recruitment is atomic, shared, persistent and read-only at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await open(page, html);
    const a = await page.locator("#createCustomPilot").boundingBox(),
      b = await page.locator("#recruitAcePilot").boundingBox();
    expect(Math.abs(a.width - b.width)).toBeLessThan(2);
    expect(Math.abs(a.y - b.y)).toBeLessThan(2);
    expect(b.x + b.width).toBeLessThanOrEqual(width);
    const before = await page.evaluate(() => Economy.snapshot());
    await page.locator("#recruitAcePilot").click();
    await expect(page.locator("#aceRecruitDialog")).toBeVisible();
    const id = await page
      .locator('#aceRecruitList [aria-pressed="true"]')
      .getAttribute("data-ace-id");
    const profile = await page.evaluate((id) => PilotSystem.aceProfile(id), id);
    await expect(page.locator("#aceRecruitPreview")).toContainText("ACE技能");
    if (profile.skills.some((skill) => skill.durationTurns)) {
      await expect(page.locator("#aceRecruitPreview")).toContainText(
        "持续1回合 · 冷却6回合（效果结束后开始）",
      );
      await expect(page.locator("#aceRecruitPreview")).not.toContainText("15秒");
    }

    await page.locator("#confirmRecruitAce").click();
    await expect(page.locator("#customPilotPanel")).toBeVisible();
    await expect(page.locator("#customPilotStats button:visible")).toHaveCount(0);
    await expect(page.locator("#resetPilotTraining")).toBeHidden();
    await expect(page.locator("#renameCustomPilot")).toBeHidden();
    await expect(page.locator("#changeCustomPilotPortrait")).toBeDisabled();
    await expect(page.locator("#pilotTrainingActions")).toBeHidden();
    await expect(page.locator("#acePilotDetails")).toContainText("ACE技能");
    await expect(page.locator("#acePilotDetails")).toContainText("50 COST/Lv.");
    const after = await page.evaluate(() => Economy.snapshot());
    expect(after.money).toBe(before.money - profile.price.money);
    expect(after.supplies).toBe(before.supplies - profile.price.supplies);
    expect(after.inventory).toEqual(before.inventory);
    const exported = await page.evaluate(() => ProfileSave.exportData());
    expect(
      Object.values(exported.pilots)
        .flatMap((s) => s.pilots)
        .filter((p) => p.aceId === profile.id),
    ).toHaveLength(1);
    await page.reload();
    await page.waitForFunction(() => assetsReady);
    await page.locator("#shellHangar").click();
    await page
      .locator("#shellSubnav button")
      .filter({ hasText: /^\u9a7e\u9a76\u5458$/ })
      .click();
    await expect(page.locator("#customPilotList")).toContainText(profile.name);
    await page.locator("#recruitAcePilot").click();
    await expect(page.locator(`#aceRecruitList [data-ace-id="${id}"]`)).toContainText("已招募");
    await page.evaluate(() => byId("aceRecruitDialog").close());
    await page.locator("#shellLobby").click();
    await page.locator("#menuFactionSelect").selectOption("ZEON");
    await page.locator("#shellHangar").click();
    await page
      .locator("#shellSubnav button")
      .filter({ hasText: /^\u9a7e\u9a76\u5458$/ })
      .click();
    await expect(page.locator("#customPilotList")).toContainText(profile.name);
    expect(errors).toEqual([]);
  });
test("ACE recruitment disables when exhausted and a failed roster write rolls back both currencies", async ({
  page,
}) => {
  await open(page);
  await page.locator("#recruitAcePilot").click();
  const before = await page.evaluate(() => Economy.snapshot());
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    window.restoreAceStorage = () => (Storage.prototype.setItem = original);
    Storage.prototype.setItem = function (k, v) {
      if (k === "projectgreed.custom-pilots.v3.shared") throw new Error("quota-test");
      return original.call(this, k, v);
    };
  });
  await page.locator("#confirmRecruitAce").click();
  expect(await page.evaluate(() => Economy.snapshot())).toEqual(before);
  await page.evaluate(() => {
    restoreAceStorage();
    localStorage.setItem(
      "projectgreed.custom-pilots.v3.shared",
      JSON.stringify({
        pilots: PilotSystem.catalog.aces
          .filter((p) => p.price)
          .map((p) => PilotSystem.createAce(p.id)),
        awards: [],
      }),
    );
  });
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  await page.locator("#shellHangar").click();
  await page
    .locator("#shellSubnav button")
    .filter({ hasText: /^\u9a7e\u9a76\u5458$/ })
    .click();
  await expect(page.locator("#recruitAcePilot")).toBeEnabled();
});

test("technology unlocks ACE recruitment and renders native ACE portraits in the development tree", async ({
  page,
}) => {
  await open(page, "client", false);
  await expect(page.locator("#recruitAcePilot")).toBeEnabled();
  await page.evaluate(() =>
    Development.creditAward({
      id: "ace-tech-test",
      matchId: "test",
      faction: "EFSF",
      points: 1200,
    }),
  );
  await page.locator("#shellDevelopment").click();
  await page.locator('[data-tech-id="Tech_EFSF_0079_AntiMSPlan"]').click();
  const ace = page.locator('#developmentDetails [data-ace-id="Pilot_EFSF_0079_N_ACE_YDR"]');
  await expect(ace.locator("img")).toBeVisible();
  await expect(ace).not.toContainText("尚未接入");
  await ace.click();
  await expect(page.locator("#confirmRecruitAce")).toBeDisabled();
  await page.evaluate(() => byId("aceRecruitDialog").close());
  await page.locator("#developmentDetails > button").click();
  await ace.click();
  await expect(page.locator("#confirmRecruitAce")).toBeEnabled();
  await page.locator("#confirmRecruitAce").click();
  await expect(page.locator("#customPilotPanel")).toBeVisible();
});

test("ACE loss archives progress, removes assignments and re-recruitment restores the same pilot", async ({
  page,
}) => {
  await open(page);
  await page.locator("#recruitAcePilot").click();
  await page.locator("#confirmRecruitAce").click();
  await page.locator("#finishCustomPilot").click();
  const archive = await page.evaluate(() => {
    const p = Formation.exportPilotStores().EFSF.pilots.find((p) => p.ace);
    Formation.receivePilotAwards({
      pilotAwards: [
        {
          id: "ace-earned",
          pilotId: p.id,
          kind: "kill",
          points: 250,
          experiencePoints: PilotSystem.experienceRequired(0, p) + 123,
          requiresRecruitment: false,
        },
      ],
    });
    const grown = Formation.exportPilotStores().EFSF.pilots.find((p) => p.ace);
    const units = [{ unitId: "Type61", kitId: "standard", customPilot: grown }];
    localStorage.setItem(
      "slg-formations-v1.EFSF",
      JSON.stringify({ version: 3, squads: [{ name: "ACE", units }] }),
    );
    return grown;
  });
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  await page.locator("#shellHangar").click();
  expect(await page.evaluate(() => Formation.current()[0].customPilot.id)).toBe(archive.id);
  await page.evaluate((id) => {
    Formation.receivePilotAwards({
      pilotAwards: [
        {
          id: "ace-loss",
          pilotId: id,
          kind: "loss",
          points: 50,
          experiencePoints: 0,
          requiresRecruitment: true,
        },
      ],
    });
    Formation.refresh();
  }, archive.id);
  expect(await page.evaluate(() => Formation.current()[0].customPilot)).toBeUndefined();
  await page
    .locator("#shellSubnav button")
    .filter({ hasText: /^驾驶员$/ })
    .click();
  await expect(page.locator("#customPilotList")).toContainText("待回归");
  const before = await page.evaluate(() => Economy.snapshot());
  await page
    .locator("#customPilotList button")
    .filter({ hasText: /^重新招募$/ })
    .click();
  await page.locator("#confirmRecruitAce").click();
  const result = await page.evaluate(() =>
    Formation.exportPilotStores().EFSF.pilots.find((p) => p.ace),
  );
  expect(result.needsRecruitment).toBe(false);
  expect(result.id).toBe(archive.id);
  expect(result.level).toBe(archive.level);
  expect(result.experience).toBe(0);
  expect(result.record.kills).toBe(archive.record.kills);
  expect(result.record.losses).toBe(archive.record.losses + 1);
  const price = await page.evaluate((id) => PilotSystem.aceProfile(id).price, result.aceId);
  expect((await page.evaluate(() => Economy.snapshot())).money).toBe(
    before.money - Math.ceil(price.money / 2),
  );
});

test("legacy ACE profile import migrates embedded formations and persists five-level caps", async ({
  page,
}) => {
  await open(page, "client", false);
  const expected = await page.evaluate(() => {
    const profile = PilotSystem.catalog.aces.find((p) => p.price && p.faction === "EFSF");
    const legacy = {
      id: "ace-" + profile.id,
      aceId: profile.id,
      ace: true,
      custom: true,
      name: profile.name,
      faction: profile.faction,
      level: profile.nativeGrowth.maxLevel,
      experience: 0,
      stats: { ...profile.maxStats },
      record: { kills: 7, destroyedCost: 2000 },
      points: 0,
    };
    const save = ProfileSave.exportData();
    save.pilots.EFSF.pilots = [legacy];
    save.formations.EFSF = {
      version: 3,
      index: 0,
      squads: [
        {
          name: "Legacy ACE",
          units: [{ unitId: "Type61", kitId: "standard", customPilot: legacy }],
        },
      ],
    };
    ProfileSave.importData(save);
    return { id: legacy.id, stats: profile.maxStats };
  });
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  const actual = await page.evaluate(() => {
    const save = ProfileSave.exportData(),
      pilot = save.pilots.EFSF.pilots.find((p) => p.ace);
    const embedded = save.formations.EFSF.squads[0].units[0].customPilot;
    return {
      id: pilot.id,
      level: pilot.level,
      stats: pilot.stats,
      version: pilot.aceGrowthVersion,
      kills: pilot.record.kills,
      cost: PilotSystem.cost(pilot),
      embeddedLevel: embedded.level,
    };
  });
  expect(actual).toEqual({
    ...expected,
    level: 5,
    version: 2,
    kills: 7,
    cost: 350,
    embeddedLevel: 5,
  });
});
