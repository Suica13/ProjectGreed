const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
const { createDeveloperServer } = require("../tools/developer-server.cjs");
const { editorFixture } = require("./catalog-editor-fixture.cjs");

test("weapon class tags, rules and filters agree in the client catalog", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => MenuShell.go("encyclopedia"));
  await page.locator("#encyclopediaWeaponsTab").click();
  await page.locator("#encyclopediaFaction").selectOption("");
  await page.locator("#encyclopediaType").selectOption("main:wrist");
  await expect(page.locator("#encyclopediaList")).toHaveAttribute("data-rendering", "false");
  const first = page.locator("#encyclopediaList .weapon-card").first();
  await expect(first.locator('[data-weapon-main-class="wrist"]')).toBeVisible();
  await expect(first.locator(".weapon-rule-grid")).toHaveCount(0);
  await first.locator(".weapon-inspector > summary").click();
  await first.locator(".weapon-conversion-rules > summary").click();
  await expect(first.locator(".weapon-rule-body")).toContainText("3 AP");
  await expect(first.locator(".weapon-rule-body")).toContainText("1–2");
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll("#encyclopediaList .weapon-card")].every((c) =>
        c.querySelector('[data-weapon-main-class="wrist"]'),
      ),
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("developer edits a shared class and a unit-specific class, saves and reloads the tags", async ({
  page,
}) => {
  test.setTimeout(120000);
  const f = editorFixture(),
    app = createDeveloperServer({ port: 0, store: f.store, catalog: f.catalog });
  const address = await app.listen(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto("http://127.0.0.1:" + address.port + "/developer.html");
    await page.locator("#editorServerAddress").fill("http://127.0.0.1:" + address.port);
    await page.locator("#editorAccessKey").fill("13450");
    await page.locator("#confirmEditorLogin").click();
    await expect(page.locator("#editorLoginScreen")).toBeHidden({ timeout: 30000 });
    await page.locator("#encyclopediaWeaponsTab").click();
    await page.locator("#encyclopediaSearch").fill("EF_RX_78_2_BR");
    await page.locator("#encyclopediaList .edit-common-weapon").first().click();
    await page.locator('[data-weapon-main-class-editor="common"]').selectOption("wrist");
    await expect(page.locator("#commonWeaponEditor .weapon-rule-body")).toContainText("3 AP");
    await page
      .locator("#commonWeaponEditor")
      .getByRole("button", { name: "保存修改", exact: true })
      .click();
    await expect(page.locator("#commonWeaponEditor")).not.toBeVisible({ timeout: 30000 });
    const ref = f.read("assets/units/RX_78_2/unit.json").weapons.EF_RX_78_2_BR.ref;
    expect(f.read("assets/weapons.json").definitions[ref].weaponMainClass).toBe("wrist");
    await page.locator("#encyclopediaUnitsTab").click();
    await page.locator("#encyclopediaSearch").fill("RX_78_2");
    await page.locator('[data-unit-id="RX_78_2"] button').click();
    await expect(
      page.locator('#formationDetailSlots [data-weapon-main-class="wrist"]').first(),
    ).toBeVisible();
    await page.locator("#editUnitProperties").click();
    await page.locator('[data-source-weapon="EF_RX_78_2_BR"] > summary').click();
    await page
      .locator('[data-weapon-main-class-editor="weapon.EF_RX_78_2_BR"]')
      .selectOption("head");
    await page
      .locator('[data-weapon-class-editor="weapon.EF_RX_78_2_BR"]')
      .selectOption("small_vulcan");
    await page.locator("#editUnitProperties").click();
    await expect(page.locator("#editUnitProperties")).toHaveText("修改属性", { timeout: 30000 });
    expect(f.store.getUnit("RX_78_2").unit.weapons.EF_RX_78_2_BR.weaponMainClass).toBe("head");
    expect(f.read("assets/weapons.json").definitions[ref].weaponMainClass).toBe("wrist");
    await expect(
      page.locator('#formationDetailSlots [data-weapon-main-class="head"]').first(),
    ).toBeVisible();
    await page.locator("#closeFormationDetail").click();
    await page.locator("#encyclopediaWeaponsTab").click();
    await page.locator("#encyclopediaSearch").fill("");
    await page.locator("#encyclopediaType").selectOption("irradiation");
    const beamCard = page.locator("#encyclopediaList .weapon-card").first();
    const source = await beamCard.getAttribute("data-weapon-source");
    await beamCard.locator(".edit-common-weapon").click();
    await page.locator('[data-weapon-class-editor="common"]').selectOption("sniper");
    await page
      .locator("#commonWeaponEditor")
      .getByRole("button", { name: "保存修改", exact: true })
      .click();
    await expect(page.locator("#commonWeaponEditor")).not.toBeVisible({ timeout: 30000 });
    expect(
      Object.values(f.read("assets/weapons.json").definitions).find(
        (w) => w.sourceWeapon === source && w.type === "irradiation",
      ).weaponSubClass,
    ).toBe("sniper");
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await app.close();
    f.cleanup();
  }
});
