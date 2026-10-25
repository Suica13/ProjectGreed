const { waitForRoomSettings } = require("./room-settings-fixture.cjs");
const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;
test("compact roster opens details only on selection and persists weapon changes", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.locator("#openFormation").click();
  await expect(page.locator("#formationUnitDetail")).toBeHidden();
  const row = page.locator(".formation-row").first();
  await expect(row.locator("select")).toHaveCount(0);
  await expect(row).not.toContainText("HP ");
  await expect(row.locator(".formation-row-description")).not.toBeEmpty();
  await row.getByRole("button", { name: "详情", exact: true }).click();
  await expect(page.locator("#formationUnitDetail")).toBeVisible();
  const expectedHP = await page.evaluate(() => {
    const entry = Formation.current()[0];
    return UnitModels[entry.unitId + "__" + entry.kitId].hp.toLocaleString();
  });
  await expect(page.locator("#formationDetailStats")).toContainText("HP " + expectedHP);
  await expect(page.locator("#formationDetailWeapons")).not.toContainText("undefined");
  await expect(page.locator("#formationDetailWeapons")).not.toContainText("NaN");
  await expect(page.locator("#formationDetailDefense")).toContainText("实弹");
  await page.evaluate(() => I18n.setLanguage("en"));
  await expect(page.locator("#formationDetailWeapons")).toContainText("Shots");
  await expect(page.locator("#formationDetailMovement")).toContainText("Move");
  await expect(page.locator("#formationDetailWeapons")).not.toContainText("发射次数");
  await page.evaluate(() => I18n.setLanguage("zh"));
  await page.screenshot({ path: ".openai/formation-unit-details.png" });
  await page.locator("#formationDetailKit").selectOption("bazooka");
  await page.keyboard.press("Escape");
  await expect(page.locator("#formationUnitDetail")).toBeHidden();
  await page.locator("#openFormationPicker").click();
  await page.locator('[data-unit-id="MS_06F"]').click();
  for (let i = 0; i < 9; i++) await page.locator("#addFormationUnit").click();
  await expect(page.locator(".formation-row")).toHaveCount(12);
  const localLimit = await page.evaluate(() => Rules.catalog.formation.maxUnits * 3);
  await expect(page.locator("#formationBudget")).toContainText("12 / " + localLimit);
  await expect(page.locator("#addFormationUnit")).toBeEnabled();
  await page.locator("#closeFormationPicker").click();
  await page.locator("#saveFormation").click();
  await page.reload();
  await page.locator("#openFormation").click();
  await expect(page.locator(".formation-row")).toHaveCount(12);
  await expect(page.locator(".formation-row").first().locator(".formation-row-kit")).toContainText(
    "火箭筒",
  );
  await page.screenshot({ path: ".openai/formation-12-units.png" });
  expect(errors).toEqual([]);
});
test("offline room cap blocks oversized saved squads and limits the editor and AI to three", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.locator("#openFormation").click();
  await page.locator("#openFormationPicker").click();
  await page.locator("#addFormationUnit").click();
  await page.locator("#closeFormationPicker").click();
  await page.locator("#saveFormation").click();
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await expect(page.locator("#roomUnitLimit")).toHaveValue(
    String(await page.evaluate(() => Rules.catalog.formation.defaultUnits)),
  );
  await page.locator("#roomUnitLimit").fill("3");
  await waitForRoomSettings(page);
  await expect(page.locator("#startRoomGame")).toBeDisabled();
  await page.locator("#roomFormation").click();
  await expect(page.locator("#formationBudget")).toContainText("4 / 3");
  await expect(page.locator("#openFormationPicker")).toBeDisabled();
  await page
    .locator(".formation-row")
    .last()
    .getByRole("button", { name: "移除", exact: true })
    .click();
  await page.locator("#saveFormation").click();
  await expect(page.locator("#startRoomGame")).toBeEnabled();
  await page.locator("#startRoomGame").click();
  await expect(page.locator("#finalAssemblyPanel")).toBeVisible();
  await page.locator("#confirmFinalFormation").click();
  await expect(page.locator("#deploymentPanel")).toBeVisible();
  expect(await page.evaluate(() => game.units.filter((u) => u.ownerSeat === 1).length)).toBe(3);
  expect(errors).toEqual([]);
});
