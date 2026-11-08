const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
const kits = require("../shared/production-data.cjs").defaultKits;
const pilots = require("../shared/pilots.js");
for (const width of [1440, 390, 360])
  test(`preloaded passengers have visible badges and independent pilot assignment at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    const profiles = [
      pilots.createCustom("custom-cargo-a", "Cargo Pilot A"),
      pilots.createCustom("custom-cargo-b", "Cargo Pilot B"),
    ];
    await page.addInitScript(
      ({ kits, profiles }) => {
        if (localStorage.getItem("preload-pilots-seeded")) return;
        localStorage.setItem("preload-pilots-seeded", "yes");
        const units = [
          { unitId: "MedeaKai", kitId: kits.MedeaKai },
          ...["RGM_79", "RGC_80"].map((unitId) => ({
            unitId,
            kitId: kits[unitId],
            preload: { carrierIndex: 0, hangarId: "Hangar_1" },
          })),
        ];
        localStorage.setItem(
          "slg-formations-v1.PMC",
          JSON.stringify({ version: 3, squads: [{ name: "Cargo", units }] }),
        );
        localStorage.setItem(
          "projectgreed.custom-pilots.v3.shared",
          JSON.stringify({ pilots: profiles, awards: [] }),
        );
        localStorage.setItem(
          "projectgreed.economy.v1",
          JSON.stringify({
            schemaVersion: 3,
            money: 10000,
            supplies: 20000,
            licenses: Object.fromEntries(units.map((u) => [u.unitId, true])),
            inventory: Object.fromEntries(units.map((u) => [u.unitId, 1])),
            kits: Object.fromEntries(units.map((u) => [u.unitId + "__" + u.kitId, 1])),
          }),
        );
      },
      { kits, profiles },
    );
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => typeof assetsReady !== "undefined" && assetsReady);
    await page.evaluate(() => {
      I18n.setLanguage("zh");
      MenuShell.go("formation");
    });
    await expect(page.locator(".formation-preload-badge")).toHaveCount(2);
    await expect(page.locator('[data-formation-index="0"] .formation-preload-badge')).toHaveCount(
      0,
    );
    await expect(page.locator('[data-formation-index="1"] .formation-preload-badge')).toBeVisible();
    await page.locator('[data-formation-index="0"] .formation-detail-button').click();
    const cargo = page.locator("#formationDetailHangars");
    await expect(cargo.locator("[data-preload-pilot]")).toHaveCount(2);
    for (const [i, name] of [
      [1, "Cargo Pilot A"],
      [2, "Cargo Pilot B"],
    ]) {
      await cargo.locator(`[data-preload-pilot="${i}"]`).click();
      await expect(page.locator("#formationPilotPanel")).toBeVisible();
      if (i === 2)
        await expect(
          page
            .locator(".formation-pilot-card")
            .filter({ hasText: "Cargo Pilot A" })
            .getByRole("button"),
        ).toBeDisabled();
      await page
        .locator(".formation-pilot-card")
        .filter({ hasText: name })
        .getByRole("button")
        .click();
      await expect(page.locator("#formationPilotPanel")).toBeHidden();
      await expect(cargo.locator(`[data-preload-pilot="${i}"]`)).toContainText(name);
      await expect(cargo.locator(`[data-preload-pilot="${i}"]`)).toBeFocused();
    }
    await cargo.screenshot({ path: `tmp/verification/screenshots/preload-pilots-${width}.png` });
    const bounds = await cargo.locator(".formation-cargo-row").evaluateAll((rows) =>
      rows.map((r) => ({
        overflow: r.scrollWidth > r.clientWidth + 1,
        buttons: [...r.querySelectorAll("button")].map((b) => ({
          w: b.getBoundingClientRect().width,
          h: b.getBoundingClientRect().height,
        })),
      })),
    );
    expect(bounds.every((r) => !r.overflow)).toBe(true);
    expect(bounds.every((r) => r.buttons.every((b) => b.w > 0 && b.h > 0))).toBe(true);
    // Closing without a choice preserves the assignment and returns to the cargo control.
    await cargo.locator('[data-preload-pilot="1"]').click();
    await page.keyboard.press("Escape");
    await expect(cargo.locator('[data-preload-pilot="1"]')).toBeFocused();
    await page.locator("#closeFormationDetail").click();
    await expect(page.locator('[data-formation-index="1"] .formation-pilot-button')).toContainText(
      "Cargo Pilot A",
    );
    await page.evaluate(() => MenuShell.go("encyclopedia"));
    await page.reload();
    await page.waitForFunction(() => typeof assetsReady !== "undefined" && assetsReady);
    const saved = await page.evaluate(() =>
      Formation.current().map((e) => ({ pilot: e.customPilot?.id, preload: e.preload })),
    );
    expect(saved[1]).toEqual({
      pilot: "custom-cargo-a",
      preload: { carrierIndex: 0, hangarId: "Hangar_1" },
    });
    expect(saved[2]).toEqual({
      pilot: "custom-cargo-b",
      preload: { carrierIndex: 0, hangarId: "Hangar_1" },
    });
  });
