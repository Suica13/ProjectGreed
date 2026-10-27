const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;
test("deleting saved formations keeps the automatically selected neighbor through return and reload", async ({page}) => {
  await page.addInitScript(()=>localStorage.setItem("projectgreed.combatFaction","PMC"));
  await page.goto(url); await page.locator("#openFormation").click();
  await expect(page.locator("#deleteFormation")).toBeDisabled();
  for (const name of ["预备编组","保留编组"]) {
    await page.locator("#newFormation").click(); await page.locator("#formationName").fill(name);
  }
  await page.locator("#formationSelect").selectOption("0"); await page.locator("#deleteFormation").click();
  await expect(page.locator("#formationSelect option")).toHaveCount(2);
  await expect(page.locator("#formationName")).toHaveValue("预备编组");
  await page.locator("#saveFormation").click(); await page.reload(); await page.locator("#openFormation").click();
  await expect(page.locator("#formationName")).toHaveValue("预备编组"); await page.locator("#deleteFormation").click();
  await expect(page.locator("#formationName")).toHaveValue("保留编组"); await expect(page.locator("#deleteFormation")).toBeDisabled();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("slg-formations-v1.PMC")).squads.map(squad=>squad.name))).toEqual(["保留编组"]);
});

test("both formation lists have equal scroll heights on desktop and mobile with redundant hints removed", async ({
  page,
}) => {
  await page.goto(url);
  await page.locator("#openFormation").click();
  await page.locator('[data-unit-id="MS_06F"]').click();
  for (let i = 0; i < 6; i++) await page.locator("#addFormationUnit").click();
  await expect(page.locator(".catalog-unit").first().locator(".unit-tags > span")).toHaveText([
    "EFSF",
    "0079",
  ]);
  await expect(page.locator(".formation-row").last().locator(".unit-tags > span")).toHaveText([
    "ZEON",
    "0079",
  ]);
  await expect(page.locator("#formationWeapons")).toHaveCount(0);
  await expect(page.locator(".formation-catalog > p")).toHaveCount(0);
  for (const size of [
    { width: 1600, height: 1000 },
    { width: 430, height: 900 },
  ]) {
    await page.setViewportSize(size);
    const geometry = await page.evaluate(() => {
      const units = byId("formationUnits"),
        catalog = byId("formationCatalog"),
        a = units.getBoundingClientRect(),
        b = catalog.getBoundingClientRect();
      units.scrollTop = units.scrollHeight;
      catalog.scrollTop = catalog.scrollHeight;
      return {
        leftHeight: a.height,
        rightHeight: b.height,
        leftTop: a.top,
        rightTop: b.top,
        leftScroll: units.scrollTop,
        rightScroll: catalog.scrollTop,
        footer: byId("saveFormation").getBoundingClientRect().bottom,
        width: document.documentElement.scrollWidth,
        screen: innerWidth,
        height: innerHeight,
        toolbarTops: ["formationSelect", "formationName", "deleteFormation", "newFormation"].map(
          (id) => byId(id).getBoundingClientRect().top,
        ),
      };
    });
    expect(Math.abs(geometry.leftHeight - geometry.rightHeight)).toBeLessThan(1);
    if (size.width > 700) {
      expect(Math.abs(geometry.leftTop - geometry.rightTop)).toBeLessThan(1);
      expect(Math.max(...geometry.toolbarTops) - Math.min(...geometry.toolbarTops)).toBeLessThan(1);
      expect(geometry.leftHeight).toBeGreaterThan(600);
    }
    expect(geometry.leftScroll).toBeGreaterThan(0);
    expect(geometry.rightScroll).toBeGreaterThan(0);
    expect(geometry.footer).toBeLessThanOrEqual(geometry.height);
    expect(geometry.width).toBeLessThanOrEqual(geometry.screen);
    await page.screenshot({ path: ".openai/formation-lists-" + size.width + ".png" });
  }
  await page.evaluate(() => I18n.setLanguage("en"));
  await expect(page.locator("#deleteFormation")).toHaveText("Delete formation");
  await page.evaluate(() => I18n.setLanguage("ja"));
  await expect(page.locator("#deleteFormation")).toHaveText("編成を削除");
});
