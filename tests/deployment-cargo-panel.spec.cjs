const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const width of [1600, 390])
  test(`deployment carrier groups and both passenger placement entry points at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await expect(page.locator("#openSkirmish")).toBeEnabled();
    await page.evaluate(() => {
      const original = createRoomEngine;
      createRoomEngine = (options) =>
        (window.cargoEngine = original({ ...options, aiDelayMs: 999999 }));
      Formation.current = () => [
        { unitId: "Medea", kitId: "standard" },
        ...Array.from({ length: 6 }, () => ({
          unitId: "Type61",
          kitId: "standard",
          preload: { carrierIndex: 0, hangarId: "Hangar_1" },
        })),
      ];
    });
    await page.locator("#openSkirmish").click();
    await page.locator("#offlineRoomMode").selectOption("quick");
    await page.locator("#createOfflineRoom").click();
    await page.locator("#startRoomGame").click();
    await page.locator("#confirmFinalFormation").click();
    const group = page.locator("#deploymentRoster .deployment-transport-group");
    await expect(group).toHaveCount(1);
    await expect(group.locator("button")).toHaveCount(7);
    const ids = await page.evaluate(() => {
      const carrier = game.units.find((u) => u.ownerSeat === Net.seat && !u.embarked);
      return { carrier: carrier.id, cargo: Rules.hangars.cargo(game, carrier).map((u) => u.id) };
    });
    await group.locator("button").first().click();
    await expect(page.locator("#hudDeploymentHangar")).toBeVisible();
    await page.locator("#hudDeploymentHangar").click();
    await expect(page.locator("#hangarDialog")).toBeVisible();
    await page
      .locator("#hangarDialog .hangar-unit")
      .first()
      .getByRole("button", { name: "出击", exact: true })
      .click();
    await expect(page.locator("#hangarDialog")).not.toBeVisible();
    const first = await page.evaluate(() => selected);
    expect(ids.cargo).toContain(first);
    async function place(id) {
      const data = await page.evaluate((id) => {
        const u = getUnit(id),
          p = Rules.deploymentCells(game, Net.seat, u).find((c) =>
            Rules.fits(game, u, c.x, c.y, u.angle, false, Net.seat),
          );
        MapCamera.focus(p.x, p.y, { preserveZoom: true });
        drawMap(performance.now());
        const r = byId("map").getBoundingClientRect();
        return {
          p,
          x: r.left + mapGeo.ox + (p.x + 0.5) * mapGeo.tile,
          y: r.top + mapGeo.oy + (p.y + 0.5) * mapGeo.tile,
          before: { hp: u.hp, en: u.en, moved: u.moved, acted: u.acted },
        };
      }, id);
      await page.mouse.click(data.x, data.y);
      await expect.poll(() => page.evaluate((id) => !getUnit(id).embarked, id)).toBe(true);
      expect(
        await page.evaluate((id) => {
          const u = getUnit(id);
          return { x: u.x, y: u.y };
        }, id),
      ).toEqual(data.p);
      expect(
        await page.evaluate((id) => {
          const u = getUnit(id);
          return { hp: u.hp, en: u.en, moved: u.moved, acted: u.acted };
        }, id),
      ).toEqual(data.before);
    }
    await place(first);
    const second = ids.cargo.find((id) => id !== first);
    await page.locator('#deploymentRoster button[data-unit-id="' + second + '"]').click();
    expect(await page.evaluate(() => selected)).toBe(second);
    await place(second);
    await expect(group.locator("button")).toHaveCount(5);
    const geometry = await group.evaluate((g) => ({
      width: g.getBoundingClientRect().width,
      available: g.parentElement.clientWidth,
      ys: [...g.children].map((c) => Math.round(c.getBoundingClientRect().top)),
    }));
    expect(geometry.width).toBeLessThanOrEqual(geometry.available);
    expect(new Set(geometry.ys).size).toBe(1);
    expect(errors).toEqual([]);
  });
