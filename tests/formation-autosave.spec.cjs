const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
const P = require("../shared/pilots.js");
for (const width of [1280, 390, 360])
  test(`formation edits save immediately and faction stays on the footer right at ${width}px`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const pilot = P.createCustom("custom-autosave", "自动保存驾驶员");
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(
      ({ pilot }) => {
        if (localStorage.getItem("autosave-test-seeded")) return;
        localStorage.setItem("autosave-test-seeded", "yes");
        localStorage.setItem("projectgreed.combatFaction", "PMC");
        localStorage.setItem("projectgreed.custom-pilots.v2.migrated", "PMC");
        localStorage.setItem(
          "projectgreed.custom-pilots.v2.PMC",
          JSON.stringify({ pilots: [pilot], awards: [] }),
        );
        localStorage.setItem(
          "slg-formations-v1.PMC",
          JSON.stringify({
            version: 3,
            squads: [
              {
                name: "原编组",
                units: [
                  { unitId: "MS_06F", kitId: "machine_gun" },
                  { unitId: "Type61", kitId: "standard" },
                ],
              },
              { name: "备用", units: [{ unitId: "Type61", kitId: "standard" }] },
            ],
          }),
        );
      },
      { pilot },
    );
    const saved = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("slg-formations-v1.PMC")));
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => I18n.setLanguage("zh"));
    await page.locator("#openFormation").click();
    await expect(page.locator("#saveFormation")).toHaveText("返回");
    await expect(page.locator("#cancelFormation")).toHaveCount(0);
    await expect(page.locator("#formationUnitsWorkspace h3")).toHaveCount(0);
    await expect(page.locator("#formationPilotRoster h3")).toHaveCount(0);
    const back = await page.locator("#saveFormation").boundingBox(),
      group = await page.locator("#formationGroup").boundingBox(),
      list = await page.locator("#formationUnits").boundingBox();
    expect(Math.abs(back.y + back.height / 2 - group.y - group.height / 2)).toBeLessThan(3);
    expect(back.width).toBeCloseTo(125, 0);
    expect(back.height).toBeLessThan(50);
    expect(group.height).toBeCloseTo(38, 0);
    expect(Number.parseFloat(await page.locator("#saveFormation").evaluate(el => getComputedStyle(el).fontSize))).toBeLessThanOrEqual(14);
    const share = await page.locator("#openFormationShare").boundingBox();
    expect(share.width).toBeGreaterThanOrEqual(94);
    expect(share.height).toBeLessThan(50);
    expect(group.x).toBeGreaterThan(back.x + back.width);
    expect(group.x + group.width).toBeLessThanOrEqual(width);
    expect(list.height).toBeGreaterThan(220);
    await page.locator("#formationName").fill("自动保存编组");
    expect((await saved()).squads[0].name).toBe("自动保存编组");
    await page
      .locator('#formationUnits [data-formation-index="0"] .formation-detail-button')
      .click();
    const kit = await page.locator("#formationDetailKit option").last().getAttribute("value");
    await page.locator("#formationDetailKit").selectOption(kit);
    expect((await saved()).squads[0].units[0].kitId).toBe(kit);
    await page.locator("#closeFormationDetail").click();
    await page
      .locator('#formationUnits [data-formation-index="0"] .formation-pilot-button')
      .click();
    await page
      .locator(".formation-pilot-card")
      .filter({ hasText: "自动保存驾驶员" })
      .getByRole("button", { name: "配属", exact: true })
      .click();
    expect((await saved()).squads[0].units[0].customPilot.id).toBe(pilot.id);
    await page
      .locator('#formationUnits [data-formation-index="1"]')
      .getByRole("button", { name: "移除", exact: true })
      .click();
    expect((await saved()).squads[0].units).toHaveLength(1);
    await page.locator("#openFormationPicker").click();
    await page.locator('[data-unit-id="Type61"]').click();
    await page.locator("#addFormationUnit").click();
    await page.locator("#closeFormationPicker").click();
    expect((await saved()).squads[0].units).toHaveLength(2);
    await page.screenshot({ path: `.openai/formation-autosave-${width}.png` });
    await page.reload();
    await page.waitForFunction(() => assetsReady);
    await page.locator("#openFormation").click();
    await expect(page.locator("#formationName")).toHaveValue("自动保存编组");
    await expect(page.locator("#formationUnits .formation-row")).toHaveCount(2);
    await page.locator("#formationSelect").selectOption("1");
    expect(await page.evaluate(() => localStorage.getItem("slg-formations-v1.PMC-active"))).toBe(
      "1",
    );
    await page.locator("#newFormation").click();
    await page.locator("#formationName").fill("即时新编组");
    expect((await saved()).squads.at(-1).name).toBe("即时新编组");
    await page.locator("#formationGroup").selectOption("EFSF");
    expect((await saved()).squads.at(-1).name).toBe("即时新编组");
    await page.locator("#formationPilotsTab").click();
    await expect(page.locator("#saveFormation")).toBeVisible();
    await page.locator("#saveFormation").click();
    await expect(page.locator("#formationScreen")).toBeHidden();
    expect(errors).toEqual([]);
  });

test("returning from an automatically saved formation synchronizes the authoritative room", async ({
  page,
}) => {
  const app = require("../server.js").createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen();
  try {
    await page.addInitScript(() => {
      localStorage.setItem("projectgreed.combatFaction", "PMC");
      localStorage.setItem(
        "slg-formations-v1.PMC",
        JSON.stringify({
          version: 3,
          squads: [{ name: "联机自动保存", units: [{ unitId: "Type61", kitId: "standard" }] }],
        }),
      );
    });
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    await page.locator("#openSkirmish").click();
    await page.locator("#openRooms").click();
    await page.locator("#serverAddress").fill("127.0.0.1:" + address.port);
    await page.locator("#connectServer").click();
    await expect(page.locator("#lobby")).toBeVisible();
    await page.locator("#createRoom").click();
    await page.locator('#roomCreateForm button[type="submit"]').click();
    await expect(page.locator("#roomPreparation")).toBeVisible();
    await page.evaluate(() => Net.request("update_formation", { formation: Formation.current() }));
    const room = () => app.rooms.get("ROOM1");
    await expect.poll(() => room().seats[0].formation.length).toBe(1);
    await page.locator("#roomFormation").click();
    await page.locator("#openFormationPicker").click();
    await page.locator('[data-unit-id="Type61"]').click();
    await page.locator("#addFormationUnit").click();
    await page.locator("#closeFormationPicker").click();
    expect(await page.evaluate(() => Formation.current().length)).toBe(2);
    await page.locator("#saveFormation").click();
    await expect(page.locator("#roomPreparation")).toBeVisible();
    await expect.poll(() => room().seats[0].formation.length).toBe(2);
  } finally {
    await page.evaluate(() => Net.leave()).catch(() => {});
    await app.close();
  }
});
