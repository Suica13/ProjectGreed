"use strict";
const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path"),
  fs = require("node:fs/promises");
const PilotSystem = require("../shared/pilots.js");
const Economy = require("../shared/economy.js");
function fixture() {
  const sides = ["PMC", "EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON"],
    pilot = PilotSystem.createCustom("custom-editor", "编辑测试");
  return {
    format: "ProjectGreed-profile",
    schemaVersion: 1,
    identity: { id: "editor-fixture-identity", secret: "a".repeat(64) },
    pilots: Object.fromEntries(
      sides.map((side) => [
        side,
        { pilots: side === "PMC" ? [pilot] : [], awards: ["keep-receipt"] },
      ]),
    ),
    formations: Object.fromEntries(
      sides.map((side) => [
        side,
        side === "PMC"
          ? {
              version: 3,
              index: 0,
              squads: [
                {
                  name: "运输编组",
                  units: [
                    { unitId: "FatUncle", kitId: "standard" },
                    {
                      unitId: "MS_06F",
                      kitId: "machine_gun",
                      customPilot: pilot,
                      preload: { carrierIndex: 0, hangarId: "Hangar_1" },
                    },
                  ],
                },
              ],
            }
          : null,
      ]),
    ),
    economy: {
      ...Economy.validate(),
      money: 12000,
      supplies: 24000,
      claimed: { "activity:unchanged": "activity" },
    },
    development: { points: { EFSF: 1000, ZEON: 2000 }, claimed: { "tech:unchanged": "battle" } },
  };
}
const file = (value, name = "profile.json") => ({
  name,
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify(value)),
});
async function downloaded(page, button) {
  const pending = page.waitForEvent("download");
  await page.locator(button).click();
  return JSON.parse(await fs.readFile(await (await pending).path(), "utf8"));
}
for (const width of [1440, 390])
  test(`offline save editor edits and validates a portable save at ${width}px`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto(pathToFileURL(path.resolve("public/save-editor.html")).href);
    await page.locator("#openSave").setInputFiles(file(fixture()));
    await expect(page.locator("#status")).toContainText("已读取");
    await fs.mkdir("tmp/verification/screenshots", { recursive: true });
    await page.screenshot({
      path: `tmp/verification/screenshots/save-editor-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("spinbutton", { name: "资金", exact: true }).fill("87654");
    await page.getByRole("spinbutton", { name: "EFSF 科技点", exact: true }).fill("4321");
    await page.locator('[data-tab="units"]').click();
    await page.locator("#unitSearch").fill("MS_06F");
    const unit = page.locator('#unitRows tr[data-unit-id="MS_06F"]');
    await unit.locator('input[type="number"]').fill("19");
    await page.locator('[data-tab="pilots"]').click();
    await page.getByRole("textbox", { name: "名字", exact: true }).fill("修改后的驾驶员");
    const save = await downloaded(page, "#downloadSave");
    expect(save.schemaVersion).toBe(3);
    expect(save.economy.money).toBe(87654);
    expect(save.economy.inventory.MS_06F).toBe(19);
    expect(save.pilots.PMC.pilots[0].name).toBe("修改后的驾驶员");
    expect(save.formations.PMC.squads[0].units[1].customPilot).toEqual({ id: "custom-editor" });
    expect(save.formations.PMC.squads[0].units[1].preload).toEqual({
      carrierIndex: 0,
      hangarId: "Hangar_1",
    });
    await page.locator("#openSave").setInputFiles(file(save));
    await expect(page.getByRole("textbox", { name: "名字", exact: true })).toHaveValue(
      "修改后的驾驶员",
    );
    await page.getByRole("spinbutton", { name: "射击", exact: true }).fill("999");
    await page.locator("#downloadSave").click();
    await expect(page.locator("#status")).toContainText("保存失败");
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    expect(overflows).toBe(false);
    expect(errors).toEqual([]);
  });
test("native save editor preserves unrelated campaign/settings values and original identity", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => typeof assetsReady !== "undefined" && assetsReady);
  const snapshot = await page.evaluate((profile) => {
    const values = Object.fromEntries(
      [...ProfileSave.storageEntries(profile)].filter(([, value]) => value !== null),
    );
    values["projectgreed.campaign.backup"] = '{"turn":123,"preserve":"unchanged"}';
    values["projectgreed.settings"] = '{"music":0.3}';
    return { format: "ProjectGreed-app-store", version: 1, revision: 17, values };
  }, fixture());
  await page.goto(pathToFileURL(path.resolve("public/save-editor.html")).href);
  await page.locator("#openSave").setInputFiles(file(snapshot));
  await expect(page.locator("#status")).toContainText("已读取");
  await page.getByRole("spinbutton", { name: "资金", exact: true }).fill("98765");
  const result = await downloaded(page, "#downloadSave");
  expect(result.format).toBe("ProjectGreed-app-store");
  expect(result.revision).toBe(17);
  expect(result.values["projectgreed.campaign.backup"]).toBe(
    snapshot.values["projectgreed.campaign.backup"],
  );
  expect(result.values["projectgreed.settings"]).toBe(snapshot.values["projectgreed.settings"]);
  expect(result.values["projectgreed.profile-identity.v1"]).toBe(
    snapshot.values["projectgreed.profile-identity.v1"],
  );
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const decoded = await page.evaluate((value) => {
    const clean = ProfileSave.fromNativeSnapshot(value);
    ProfileSave.importData(clean);
    return clean;
  }, result);
  expect(decoded.economy.money).toBe(98765);
  expect(decoded.economy.claimed).toEqual({ "activity:unchanged": "activity" });
  expect(decoded.development.claimed).toEqual({ "tech:unchanged": "battle" });
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  expect(await page.evaluate(() => Economy.exportProgress().money)).toBe(98765);
  expect(
    await page.evaluate(() => ProfileSave.exportData().formations.PMC.squads[0].units[1].preload),
  ).toEqual({ carrierIndex: 0, hangarId: "Hangar_1" });
});

test("pilot creation, ACE growth, research and formation edits share the same validated save", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/save-editor.html")).href);
  await page.locator("#openSave").setInputFiles(file(fixture()));
  await page.locator('[data-tab="formations"]').click();
  const formation = JSON.parse(await page.locator("#formationJson").inputValue());
  formation.squads[0].name = "修改编组";
  await page.locator("#formationJson").fill(JSON.stringify(formation));
  await page.locator("#applyFormation").click();
  await page.locator('[data-tab="pilots"]').click();
  await page.getByRole("textbox", { name: "名字", exact: true }).fill("编组修改后的驾驶员");
  await page.locator("#addPilot").click();
  await expect(page.locator("#pilotSelect option")).toHaveCount(2);
  await page.locator("#addAce").click();
  await expect(page.locator("#pilotSelect option")).toHaveCount(3);
  await page.getByRole("spinbutton", { name: "等级", exact: true }).fill("5");
  await expect(page.getByRole("spinbutton", { name: "射击", exact: true })).toBeDisabled();
  await page.locator('[data-tab="research"]').click();
  const node = require("../shared/development.js")
    .nodes("EFSF")
    .find((node) => node.requires.length > 0);
  await page.locator(`[data-tech-id="${node.id}"]`).check();
  const value = await downloaded(page, "#downloadSave");
  expect(Object.values(value.pilots).flatMap((store) => store.pilots)).toHaveLength(3);
  expect(value.pilots.PMC.pilots.find((p) => p.id === "custom-editor").name).toBe(
    "编组修改后的驾驶员",
  );
  expect(
    Object.values(value.pilots)
      .flatMap((store) => store.pilots)
      .find((p) => p.aceId).level,
  ).toBe(5);
  expect(value.development.researched.EFSF).toContain(node.id);
  expect(value.formations.PMC.squads[0].name).toBe("修改编组");
});
test("game settings exports the standalone editor without a server", async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  await page.locator("#shellSettings").click();
  await page.getByRole("tab", { name: "存档", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.locator("#downloadSaveEditor").click();
  const html = await fs.readFile(await (await pending).path(), "utf8");
  expect(html).toContain("ProjectGreed 存档编辑器");
  expect(html).not.toContain("__SCRIPT__");
});
test("compact runtime receipts survive restart and still reject duplicate economy and technology awards", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const expected = await page.evaluate(() => {
    for (let i = 0; i < 50; i++) {
      Economy.creditAward({
        id: "performance-receipt-test-long-prefix-" + i,
        matchId: "one-battle",
        money: 1,
        supplies: 2,
      });
      Development.creditAward({
        id: "technology-receipt-test-long-prefix-" + i,
        matchId: "one-battle",
        faction: "EFSF",
        points: 1,
      });
    }
    return {
      money: Economy.exportProgress().money,
      points: Development.pointBalance("EFSF"),
      economyPacked: !!JSON.parse(localStorage.getItem(Economy.key)).claimedPacked,
      technologyPacked: !!JSON.parse(localStorage.getItem("projectgreed.developmentProgress.v1"))
        .claimedPacked,
    };
  });
  expect(expected.economyPacked).toBe(true);
  expect(expected.technologyPacked).toBe(true);
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(() => ({
    economyAccepted: Economy.creditAward({
      id: "performance-receipt-test-long-prefix-1",
      matchId: "one-battle",
      money: 10000,
      supplies: 10000,
    }),
    technologyAccepted: Development.creditAward({
      id: "technology-receipt-test-long-prefix-1",
      matchId: "one-battle",
      faction: "EFSF",
      points: 10000,
    }),
    money: Economy.exportProgress().money,
    points: Development.pointBalance("EFSF"),
  }));
  expect(result.economyAccepted).toBe(false);
  expect(result.technologyAccepted).toBe(false);
  expect(result.money).toBe(expected.money);
  expect(await page.evaluate(() => Development.pointBalance("EFSF"))).toBe(expected.points);
});
