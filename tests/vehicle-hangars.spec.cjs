const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

test("formation can assign a loaded vehicle to a carrier without hiding nested infantry", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openFormation")).toBeEnabled();
  await page.evaluate(() => {
    const entry = (unitId) => {
      const m = Object.values(UnitModels).find((m) => m.prefabId === unitId && !m.formOnly);
      return { unitId, kitId: m.kitId };
    };
    localStorage.setItem(
      "slg-formations-v1.EFSF",
      JSON.stringify({
        version: 3,
        squads: [
          {
            name: "Vehicle transport",
            units: [
              entry("Medea"),
              entry("Type74"),
              {
                ...entry("Army_Squad_EFSF_0079_N_G_A"),
                preload: { carrierIndex: 1, hangarId: "Hangar_1" },
              },
            ],
          },
        ],
      }),
    );
  });
  await page.reload();
  await page.evaluate(() => Formation.open());
  await page.locator('[data-formation-index="1"] .formation-detail-button').click();
  await expect(page.locator("#formationDetailCarrierField")).toBeVisible();
  const preload = JSON.stringify({ carrierIndex: 0, hangarId: "Hangar_1" });
  await page.locator("#formationDetailCarrier").selectOption(preload);
  await expect(page.locator("#formationDetailCarrier")).toHaveValue(preload);
  await page.locator("#closeFormationDetail").click();
  await expect(page.locator(".formation-row")).toHaveCount(3);
  expect(
    await page.evaluate(() =>
      Formation.current().map((entry) => entry.preload?.carrierIndex ?? null),
    ),
  ).toEqual([null, 0, 1]);
  await page.reload();
  await page.evaluate(() => Formation.open());
  await expect(page.locator(".formation-row")).toHaveCount(3);
});
