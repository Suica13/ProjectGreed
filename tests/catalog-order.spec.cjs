const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("all factions sort by faction then localized name and show corrected model codes and 25-step costs", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.locator("#openFormation").click();
  const read = () =>
    page.locator(".catalog-unit").evaluateAll((cards) =>
      cards.map((card) => {
        const p = Rules.catalog.prefabs.find((p) => p.id === card.dataset.unitId);
        return { id: p.id, faction: p.faction, name: p.name };
      }),
    );
  let entries = await read();
  expect(entries.map((e) => e.faction)).toEqual([
    ...Array(5).fill("EFSF"),
    ...Array(6).fill("ZEON"),
  ]);
  expect(entries.slice(0, 5).map((e) => e.id)).toEqual([
    "RGM_79",
    "RGC_80",
    "RX_79_G",
    "RGM_79_G",
    "RGM_79L",
  ]);
  expect(entries.slice(5, 7).map((e) => e.id)).toEqual(["MS_09", "MS_14A"]);
  await expect(page.locator('[data-unit-id="MS_14A"]')).toContainText("MS-14A");
  await expect(page.locator('[data-unit-id="RX_79_G"]')).toContainText("RX-79[G]");
  await expect(page.locator('[data-unit-id="RX_79_G"]')).not.toContainText("RGM-79[G]");
  await expect(page.locator('[data-unit-id="MS_14A"]')).toContainText("Cost:800-825");
  await expect(page.locator('[data-unit-id="RX_79_G"]')).toContainText("Cost:825-850");
  await page.locator("#formationFaction").selectOption("ZEON");
  expect((await read()).every((e) => e.faction === "ZEON")).toBe(true);
  await page.locator("#formationFaction").selectOption("ALL");
  await page.evaluate(() => I18n.setLanguage("en"));
  entries = await read();
  expect(entries.slice(0, 5).map((e) => e.id)).toEqual([
    "RGM_79",
    "RGC_80",
    "RGM_79_G",
    "RGM_79L",
    "RX_79_G",
  ]);
  expect(entries.slice(5).map((e) => e.id)).toEqual([
    "MS_09",
    "MS_14A",
    "MS_06K",
    "MS_06F",
    "MS_06F2",
    "MS_06J",
  ]);
  await page.screenshot({ path: ".openai/catalog-order.png" });
  expect(errors).toEqual([]);
});
