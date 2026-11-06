const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;
async function open(page) {
  await page.goto(url);
  await page.waitForFunction(() => assetsReady);
}
test("legacy faction archives merge copied pilot IDs into one advanced shared profile", async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(() => {
    const data = ProfileSave.exportData();
    const first = PilotSystem.createCustom("custom-copied", "Original", undefined, "PMC");
    data.pilots.PMC = { pilots: [first], awards: ["first"] };
    data.pilots.EFSF = {
      pilots: [{ ...first, faction: "EFSF", name: "Advanced", experience: 100 }],
      awards: ["second"],
    };
    ProfileSave.importData(data);
    return JSON.parse(localStorage.getItem("projectgreed.custom-pilots.v3.shared"));
  });
  expect(result.pilots).toHaveLength(1);
  expect(result.pilots[0].name).toBe("Advanced");
  expect(result.awards).toEqual(["first", "second"]);
});
for (const width of [1440, 390])
  test(`search preserves card slots and clickable results at ${width}px`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await page.evaluate(() =>
      localStorage.setItem(
        "projectgreed.custom-pilots.v3.shared",
        JSON.stringify({
          pilots: Array.from({ length: 20 }, (_, i) =>
            PilotSystem.createCustom("custom-search-" + i, "SearchPilot " + i, undefined, "PMC"),
          ),
          awards: [],
        }),
      ),
    );
    await page.reload();
    await page.waitForFunction(() => assetsReady);
    for (const [view, list, input, query] of [
      ["production", "productionList", "productionSearch", "Medea"],
      ["encyclopedia", "encyclopediaList", "encyclopediaSearch", "Medea"],
      ["pilots", "customPilotList", "pilotRosterSearch", "SearchPilot 1"],
      ["formation", "formationCatalog", "formationSearch", "Medea"],
    ]) {
      await page.evaluate((view) => MenuShell.go(view), view);
      if (view === "formation") await page.locator("#openFormationPicker").click();
      const baseline = await page
        .locator("#" + list + " > :first-child")
        .evaluate((el) => el.getBoundingClientRect().height);
      await page.evaluate((id) => (document.getElementById(id).scrollTop = 999999), list);
      for (const value of [query, "nothing-matches-this", "", query]) {
        await page.locator("#" + input).fill(value);
        await page.waitForTimeout(250);
        if (value === "nothing-matches-this") continue;
        const result = await page.locator("#" + list).evaluate((el, baseline) => {
          const panel = el.getBoundingClientRect();
          const cards = [...el.children]
            .filter((card) => card.tagName !== "P")
            .map((card) => {
              const r = card.getBoundingClientRect();
              return { x: r.x, y: r.y, w: r.width, h: r.height };
            });
          return {
            stable: cards.every((r) => Math.abs(r.h - baseline) < 2),
            firstVisible: cards[0]?.y >= panel.y,
            overlap: cards.some((a, i) =>
              cards
                .slice(i + 1)
                .some(
                  (b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h,
                ),
            ),
          };
        }, baseline);
        expect(result).toEqual({ stable: true, firstVisible: true, overlap: false });
      }
      // A real mouse/touch click must reach the result, not an overlaid later card.
      const first = page.locator("#" + list + " > :first-child");
      if (view === "pilots") {
        await first.locator("button").first().click();
        await expect(page.locator("#customPilotPanel")).toBeVisible();
        await page.locator("#finishCustomPilot").click();
      } else if (view !== "encyclopedia") {
        const button = view === "formation" ? first.locator(".catalog-unit") : first;
        await button
          .locator(view === "formation" ? ".catalog-unit-portrait" : ".production-unit-portrait")
          .click();
        await expect(button).toHaveAttribute("aria-selected", "true");
      }
      if (view === "formation") await page.locator("#closeFormationPicker").click();
    }
  });
test("full browser storage can replace a large roster with a new profile", async ({ page }) => {
  await open(page);
  const result = await page.evaluate(() => {
    const clean = ProfileSave.exportData();
    const key = "projectgreed.custom-pilots.v3.shared";
    const pilot = PilotSystem.createCustom("custom-quota", "Kept pilot", undefined, "PMC");
    // Model a large roster occupying the profile's storage allocation.
    localStorage.setItem(
      key,
      JSON.stringify({ pilots: [pilot], awards: [], padding: "x".repeat(200000) }),
    );
    const set = Storage.prototype.setItem;
    const limit =
      Object.keys(localStorage).reduce((n, k) => n + k.length + localStorage.getItem(k).length, 0) +
      100;
    Storage.prototype.setItem = function (key, value) {
      const next =
        Object.keys(this)
          .filter((k) => k !== key)
          .reduce((n, k) => n + k.length + this.getItem(k).length, 0) +
        key.length +
        String(value).length;
      if (next > limit) throw new DOMException("Full", "QuotaExceededError");
      return set.call(this, key, value);
    };
    try {
      ProfileSave.importData(clean);
      return JSON.parse(localStorage.getItem(key));
    } finally {
      Storage.prototype.setItem = set;
    }
  });
  expect(result.pilots).toEqual([]);
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  expect(await page.evaluate(() => ProfileSave.exportData().pilots.PMC.pilots)).toEqual([]);
});
test("legacy roster duplicates are reclaimed before purchases without losing pilots or avatars", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    const pilot = PilotSystem.createCustom("custom-legacy-quota", "Preserved", undefined, "PMC");
    pilot.uploadedPortrait = "data:image/jpeg;base64,/9j/" + "A".repeat(12000);
    const pilots = Array.from({ length: 15 }, (_, i) => ({
      ...pilot,
      id: "custom-legacy-quota-" + i,
    }));
    const roster = { pilots, awards: ["preserved-award"] };
    localStorage.setItem("projectgreed.custom-pilots.v3.shared", JSON.stringify(roster));
    localStorage.setItem("projectgreed.custom-pilots.v2.PMC", JSON.stringify(roster));
    const units = pilots.map((pilot) => ({
      unitId: "Type61",
      kitId: "standard",
      customPilot: pilot,
    }));
    localStorage.setItem(
      "slg-formations-v1.PMC",
      JSON.stringify({ version: 3, squads: [{ name: "Quota squad", units }] }),
    );
    localStorage.setItem("slg-formations-v1.pmc-unified", "1");
  });
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    const limit =
      Object.keys(localStorage).reduce((n, k) => n + k.length + localStorage.getItem(k).length, 0) +
      100;
    Storage.prototype.setItem = function (key, value) {
      const total =
        Object.keys(this)
          .filter((k) => k !== key)
          .reduce((n, k) => n + k.length + this.getItem(k).length, 0) +
        key.length +
        String(value).length;
      if (total > limit) throw new DOMException("Full", "QuotaExceededError");
      return set.call(this, key, value);
    };
  });
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(() => {
    const before = Economy.quantity("Type61");
    try {
      Economy.produce("Type61", "standard", "PMC");
    } catch (error) {
      return {
        error: error.message,
        issue: Economy.storageIssue(),
        sizes: Object.fromEntries(
          Object.keys(localStorage).map((key) => [key, localStorage.getItem(key).length]),
        ),
      };
    }
    const archive = ProfileSave.exportData();
    return {
      produced: Economy.quantity("Type61") - before,
      legacy: localStorage.getItem("projectgreed.custom-pilots.v2.PMC"),
      storedSize: localStorage.getItem("slg-formations-v1.PMC").length,
      pilot: archive.pilots.PMC.pilots[0],
      assigned: archive.formations.PMC.squads[0].units[0].customPilot,
    };
  });
  expect(result.error, JSON.stringify(result)).toBeUndefined();
  expect(result.produced).toBe(1);
  expect(result.legacy).toBeNull();
  expect(result.storedSize).toBeLessThan(4000);
  expect(result.pilot.name).toBe("Preserved");
  expect(result.pilot.uploadedPortrait.length).toBeGreaterThan(12000);
  expect(result.assigned).toEqual(result.pilot);
});
