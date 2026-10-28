const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
for (const width of [1280, 390])
  test(`formation stock filter and sorting at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem("projectgreed.combatFaction", "PMC");
      localStorage.setItem(
        "projectgreed.economy.v1",
        JSON.stringify({
          money: 5000,
          supplies: 10000,
          inventory: { Type61: 2, MS_06F: 5, Medea: 1 },
          kits: {},
        }),
      );
    });
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => I18n.setLanguage("zh"));
    await page.locator("#openFormation").click();
    await page.locator("#openFormationPicker").click();
    await expect(page.locator("#formationStock")).toHaveValue("owned");
    const cards = page.locator("#formationCatalog .catalog-unit");
    await expect(cards).toHaveCount(3);
    await expect(page.locator("#formationSort")).toHaveCount(0);
    const values = await cards.evaluateAll((nodes) =>
      nodes.map((node) => {
        const p = Rules.catalog.prefabs.find((p) => p.id === node.dataset.unitId);
        return {
          developed: Development.allows("PMC", p.id),
          cost: Math.min(...p.weaponKits.map((k) => p.stats.cost + k.cost)),
        };
      }),
    );
    expect(values).toEqual(
      [...values].sort((a, b) => Number(b.developed) - Number(a.developed) || a.cost - b.cost),
    );
    await page.locator("#formationStock").selectOption("all");
    expect(await cards.count()).toBeGreaterThan(3);
    const sorted = await cards.evaluateAll(nodes => nodes.map(node => {
      const p=Rules.catalog.prefabs.find(p=>p.id===node.dataset.unitId);
      return {developed:Development.allows("PMC",p.id),cost:Math.min(...p.weaponKits.map(k=>p.stats.cost+k.cost))};
    }));
    expect(sorted).toEqual([...sorted].sort((a,b)=>Number(b.developed)-Number(a.developed)||a.cost-b.cost));
    await page.locator("#formationSearch").fill("RX_78_2");
    await expect(cards).toHaveCount(1);
    await page.locator("#formationStock").selectOption("owned");
    await expect(cards).toHaveCount(0);
    const filters = await page.locator(".formation-catalog-heading select").evaluateAll((nodes) =>
      nodes.map((node) => {
        const r = node.getBoundingClientRect();
        return { y: r.y, x: r.x, width: r.width, right: r.right };
      }),
    );
    expect(filters).toHaveLength(4);
    const heading = await page.locator(".formation-catalog-heading").boundingBox();
    expect(Math.abs(filters[0].x - heading.x)).toBeLessThan(1);
    expect(Math.abs(filters[3].right - heading.x - heading.width)).toBeLessThan(1);
    expect(Math.max(...filters.map(r => r.width)) - Math.min(...filters.map(r => r.width))).toBeLessThan(1);
    expect(
      Math.max(...filters.map((r) => r.y)) - Math.min(...filters.map((r) => r.y)),
    ).toBeLessThan(1);
    expect(Math.max(...filters.map((r) => r.right))).toBeLessThanOrEqual(width);
    const search = await page.locator("#formationSearch").boundingBox();
    expect(search.x + search.width).toBeLessThanOrEqual(width);
  });
