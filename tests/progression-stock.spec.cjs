const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
const tree = require("../shared/development-tree.json");
async function open(page, full = true) {
  await page.addInitScript(
    ({ tree, full }) => {
      if (localStorage.getItem("progression-stock-seeded")) return;
      localStorage.setItem("progression-stock-seeded", "1");
      localStorage.setItem("projectgreed.combatFaction", "EFSF");
      localStorage.setItem(
        "projectgreed.economy.v1",
        JSON.stringify({
          schemaVersion: 2,
          money: full ? 1000000 : 0,
          supplies: full ? 1000000 : 0,
          licenses: { Type61: true },
        }),
      );
      localStorage.setItem(
        "projectgreed.developmentProgress.v1",
        JSON.stringify({
          points: { EFSF: full ? 100000 : 1200, ZEON: 0 },
          claimed: {},
          researched: full
            ? { EFSF: tree.EFSF.map((n) => n.id), ZEON: tree.ZEON.map((n) => n.id) }
            : {},
        }),
      );
      localStorage.setItem(
        "slg-formations-v1.EFSF",
        JSON.stringify({
          version: 3,
          squads: [
            {
              name: "库存验证",
              units: Array.from({ length: 2 }, () => ({ unitId: "Type61", kitId: "standard" })),
            },
          ],
        }),
      );
    },
    { tree, full },
  );
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => I18n.setLanguage("zh"));
}
for (const width of [1280, 390])
  test(`single chassis production, separate equipment and persistent stock at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await open(page);
    await expect(page.locator("#openProduction")).toHaveText("生产车间");
    expect(await page.evaluate(() => Economy.quantity("Type61"))).toBe(0);
    await page.evaluate(() => ProductionUI.openUnit("RGM_79"));
    await expect(page.locator("#productionKit")).toHaveValue("beam_spray");
    await expect(page.locator("#produceUnit")).toBeDisabled();
    for (const id of ["produceUnit", "buyProductionKit"]) {
      const mask = await page.locator("#" + id).evaluate((button) => ({
        locked: button.dataset.licenseLocked,
        opacity: getComputedStyle(button).opacity,
        overlay: getComputedStyle(button, "::after").backgroundColor,
      }));
      expect(mask).toEqual({ locked: "true", opacity: "1", overlay: "rgba(0, 0, 0, 0.68)" });
    }

    const before = await page.evaluate(() => Economy.snapshot().money);
    const permit = await page.evaluate(() => Economy.licenseOffer("RGM_79").money);
    await page.locator("#purchaseProductionLicense").click();
    expect(await page.evaluate(() => Economy.quantity("RGM_79"))).toBe(1);
    await expect(page.locator("#produceUnit")).toBeEnabled();
    const cost = await page.evaluate(() => Economy.productionOffer("RGM_79", "beam_spray").money);
    await page.locator("#produceUnit").click();
    await expect(page.locator("#productionQuantity")).toContainText("机体库存 2");
    expect(await page.evaluate(() => Economy.kitQuantity("RGM_79__beam_spray"))).toBe(2);
    await page.locator("#productionKit").selectOption("bazooka");
    const kit = await page.evaluate(() => Economy.kitOffer("RGM_79__bazooka").money);
    await page.locator("#buyProductionKit").click();
    expect(await page.evaluate(() => Economy.quantity("RGM_79"))).toBe(2);
    expect(await page.evaluate(() => Economy.kitQuantity("RGM_79__bazooka"))).toBe(1);
    expect(await page.evaluate(() => Economy.snapshot().money)).toBe(before - permit - cost - kit);
    await expect(page.locator("#productionPrice")).toContainText("机体生产费");
    await expect(page.locator("#productionPrice")).toContainText("出厂套件费");
    await page.locator("#produceUnit").scrollIntoViewIfNeeded();
    const overlap = await page.evaluate(() => {
      const a = byId("produceUnit").getBoundingClientRect(),
        b = byId("buyProductionKit").getBoundingClientRect();
      return a.bottom > b.top + 1;
    });
    expect(overlap).toBe(false);
    await page.screenshot({ path: `tmp/verification/screenshots/counted-stock-production-${width}.png` });
    await page.reload();
    await page.waitForFunction(() => assetsReady);
    const save = await page.evaluate(() => ProfileSave.validate(ProfileSave.exportData()).economy);
    expect(save.inventory.RGM_79).toBe(2);
    expect(save.kits.RGM_79__bazooka).toBe(1);
    expect(save.kits.RGM_79__beam_spray).toBe(2);
    await page.evaluate(() => Formation.previewUnit("RGM_79"));
    await page.locator("#formationDetailKit").selectOption("bazooka");
    await expect(page.locator("#buyPreviewKit")).toBeVisible();
    await page.locator("#buyPreviewKit").click();
    expect(await page.evaluate(() => Economy.kitQuantity("RGM_79__bazooka"))).toBe(2);
    expect(await page.evaluate(() => Economy.quantity("RGM_79"))).toBe(2);
    expect(errors).toEqual([]);
  });

test("cumulative technology unlock consumes neither research progress nor currency", async ({
  page,
}) => {
  await open(page, false);
  await page.locator("#shellHangar").click();
  await page.locator("#shellDevelopment").click();
  await page.locator('[data-tech-id="Tech_EFSF_0079_AntiMSPlan"]').click();
  await expect(page.locator("#developmentDetails")).toContainText("所需科技点");
  const develop = page
    .locator("#developmentDetails")
    .getByRole("button", { name: "开发", exact: true });
  await expect(develop).toBeEnabled();
  await develop.click();
  expect(await page.evaluate(() => Development.pointBalance("EFSF"))).toBe(1200);
  expect(await page.evaluate(() => Economy.snapshot().money)).toBe(0);
  await expect(
    page.locator("#developmentDetails").getByRole("button", { name: "已开发", exact: true }),
  ).toBeDisabled();
});

test("formation shortage replenishment acquires exactly the required chassis and kits", async ({
  page,
}) => {
  await open(page);
  await page.locator("#shellHangar").click();
  await expect(page.locator("#formationUnits .inventory-shortage")).toHaveCount(2);
  await expect(page.locator("#produceMissingFormation")).toBeVisible();
  await page.locator("#produceMissingFormation").click();
  await expect(page.locator("#gameDialog")).toBeVisible();
  await page.locator("#gameDialog").getByRole("button", { name: "确认购买", exact: true }).click();
  await expect(page.locator("#formationUnits .inventory-shortage")).toHaveCount(0);
  expect(await page.evaluate(() => Economy.quantity("Type61"))).toBe(2);
  expect(await page.evaluate(() => Economy.kitQuantity("Type61__standard"))).toBe(2);
});

test("workshop unit selection preserves the list and scroll without a full rebuild", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    ProductionUI.openUnit("Type61");
    byId("productionSearch").value = "";
    ProductionUI.render();
  });
  const result = await page.evaluate(() => {
    const list = byId("productionList"),
      cards = [...list.children];
    const observer = new MutationObserver(() => {});
    observer.observe(list, { childList: true });
    list.scrollTop = 120;
    const scroll = list.scrollTop,
      times = [];
    for (const card of cards.filter((card) => card.dataset.unitId).slice(0, 6)) {
      const start = performance.now();
      card.click();
      times.push(performance.now() - start);
    }
    const removals = observer
      .takeRecords()
      .reduce((count, event) => count + event.removedNodes.length, 0);
    observer.disconnect();
    return {
      count: cards.length,
      same: cards.every((card, index) => list.children[index] === card),
      removals,
      scrollKept: list.scrollTop === scroll,
      median: times.sort((a, b) => a - b)[3],
    };
  });
  expect(result.count).toBeGreaterThan(100);
  expect(result.same).toBe(true);
  expect(result.removals).toBe(0);
  expect(result.scrollKept).toBe(true);
  expect(result.median).toBeLessThan(100);
});

test("PMC quick room synchronizes caps, redistributes research and never debits physical stock", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("projectgreed.combatFaction", "PMC");
    localStorage.setItem(
      "projectgreed.economy.v1",
      JSON.stringify({
        schemaVersion: 3,
        money: 5000,
        supplies: 10000,
        licenses: { Type61: true, MS_06F: true },
        inventory: {},
        kits: {},
      }),
    );
    localStorage.setItem(
      "projectgreed.developmentProgress.v1",
      JSON.stringify({ points: { EFSF: 23990, ZEON: 0 }, claimed: {} }),
    );
    localStorage.setItem(
      "slg-formations-v1.PMC",
      JSON.stringify({
        version: 3,
        squads: [
          {
            name: "PMC比例",
            units: [
              ...Array.from({ length: 10 }, () => ({ unitId: "Type61", kitId: "standard" })),
              { unitId: "MS_06F", kitId: "machine_gun" },
            ],
          },
        ],
      }),
    );
  });
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.evaluate(() => {
    const factory = createRoomEngine;
    createRoomEngine = (options) => (window.pmcTestEngine = factory(options));
  });
  await page.locator("#openSkirmish").click();
  await page.locator("#offlineRoomMode").selectOption("quick");
  await page.locator("#createOfflineRoom").click();
  await expect.poll(() => page.evaluate(() => Net.awaiting)).toBe(null);
  await page.evaluate(() => {
    const room = [...pmcTestEngine.rooms.values()][0];
    room.seats[1].formationPreset = {
      id: "test-opponent",
      name: "测试对手",
      units: [{ unitId: "Type61", kitId: "standard" }],
    };
    Net.request("configure_room", {
      ...Rules.defaultRoomSettings(),
      battleMode: "quick",
      costLimit: 99999,
      unitCostLimit: 99999,
      unitLimit: 72,
    });
  });
  await expect.poll(() => page.evaluate(() => Net.awaiting)).toBe(null);
  await page.evaluate(() =>
    Net.request("start_game", {
      formation: [
        ...Array.from({ length: 10 }, () => ({ unitId: "Type61", kitId: "standard" })),
        { unitId: "MS_06F", kitId: "machine_gun" },
      ],
    }),
  );
  await expect.poll(() => page.evaluate(() => Net.snapshot.phase)).toBe("assembly");
  await expect.poll(() => page.evaluate(() => Net.awaiting)).toBe(null);
  await page.evaluate(() => Net.request("confirm_formation"));
  await expect.poll(() => page.evaluate(() => Net.snapshot.phase)).toBe("deployment");
  await expect.poll(() => page.evaluate(() => Net.awaiting)).toBe(null);
  expect(await page.evaluate(() => Economy.quantity("Type61"))).toBe(0);
  const start = await page.evaluate(() => {
    const room = [...pmcTestEngine.rooms.values()][0],
      player = room.seats[0];
    const balance = room.technologyStartPoints[player.id].EFSF;
    for (const actor of room.game.units) actor.hp = 0;
    // Focus on transport, settlement and receipt application; combat resolution is covered in Node.
    room.techParticipation[player.id] = ["EFSF"];
    room.game.winner = 0;
    room.phase = "finished";
    room.revision++;
    pmcTestEngine.broadcast(room);
    return balance;
  });
  expect(start).toBe(23990);
  await expect.poll(() => page.evaluate(() => Development.pointBalance("EFSF"))).toBe(24000);
  expect(await page.evaluate(() => Development.pointBalance("ZEON"))).toBe(56);
  const stock = await page.evaluate(() => Economy.exportProgress());
  expect(stock.inventory).toEqual({});
  expect(stock.kits).toEqual({});
  expect(errors).toEqual([]);
});


test("legacy faction formations and ACE rosters are accessible together under PMC",async({page})=>{
 await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
 await page.waitForFunction(()=>assetsReady);
 await page.evaluate(()=>{
  const save=ProfileSave.exportData();
  for(const faction of Object.keys(save.pilots)) {save.pilots[faction]={pilots:[],awards:[]};save.formations[faction]=null;}
  for(const faction of ["EFSF","ZEON"]){
   const ace=PilotSystem.createAce(PilotSystem.catalog.aces.find(p=>p.faction===faction).id);
   save.pilots[faction].pilots=[ace];
   save.formations[faction]={version:3,index:0,squads:[{name:faction+"旧编组",units:[{unitId:"Type61",kitId:"standard",customPilot:ace}]}]};
  }
  ProfileSave.importData(save);
  localStorage.setItem("projectgreed.combatFaction","ZEON");
 });
 await page.reload();await page.waitForFunction(()=>assetsReady);
 expect(await page.evaluate(()=>PlayerProfile.faction())).toBe("PMC");
 expect(await page.evaluate(()=>Formation.group())).toBe("PMC");
 expect(await page.evaluate(()=>Formation.presets().map(s=>s.name))).toEqual(["EFSF旧编组","ZEON旧编组"]);
 await expect(page.locator("#menuFactionSelect")).toBeHidden();
 await page.locator("#shellHangar").click();
 await page.locator("#shellSubnav").getByRole("button",{name:"驾驶员",exact:true}).click();
 await expect(page.locator("#customPilotList .formation-row")).toHaveCount(2);
 expect(await page.evaluate(()=>Formation.presets().every(s=>!!s.units[0].customPilot))).toBe(true);
 await page.reload();await page.waitForFunction(()=>assetsReady);
 expect(await page.evaluate(()=>Formation.presets().length)).toBe(2);
 await page.locator("#shellHangar").click();
 await page.locator("#shellEncyclopedia").click();
 await page.locator("#encyclopediaSearch").fill("Medea");
 await expect(page.locator('#encyclopediaList [data-unit-id="Medea"] .production-turns')).toContainText("2回合");
});
