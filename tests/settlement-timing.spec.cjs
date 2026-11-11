const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"), path = require("node:path");
test("pending rewards and casualties never change the saved profile, final receipts apply once", async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => localStorage.setItem("projectgreed.custom-pilots.v3.shared", JSON.stringify({
    pilots: [PilotSystem.createCustom("custom-settlement", "Timing", null, "PMC")], awards: [],
  })));
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  const before = await page.evaluate(() => ({ economy: Economy.exportProgress(), tech: Development.exportProgress(), pilots: Formation.exportPilotStores() }));
  await page.evaluate(() => {
    window.pendingSettlement = { phase: "idle", rewardsSettled: false,
      economyAwards: [{ id: "timing-currency", matchId: "timing-match", money: 500, supplies: 750,
        stockLost: { inventory: { Medea: 1 } } }],
      techAwards: [{ id: "timing-tech", matchId: "timing-match", faction: "EFSF", points: 250 }],
      pilotAwards: [{ id: "timing-pilot", pilotId: "custom-settlement", kind: "kill", points: 100, experiencePoints: 100 }],
      pilotAwards: [{ id: "timing-pilot", pilotId: "custom-settlement", kind: "kill", points: 100, experiencePoints: 100 }],
    };
    ProductionUI.receiveAwards(window.pendingSettlement);
    DevelopmentUI.receiveAwards(window.pendingSettlement);
    Formation.receivePilotAwards(window.pendingSettlement);
    Formation.receivePilotAwards(window.pendingSettlement);
  });
  expect(await page.evaluate(() => Economy.exportProgress())).toEqual(before.economy);
  expect(await page.evaluate(() => Development.exportProgress())).toEqual(before.tech);
  expect(await page.evaluate(() => Formation.exportPilotStores())).toEqual(before.pilots);
  expect(await page.evaluate(() => Formation.exportPilotStores())).toEqual(before.pilots);
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  expect(await page.evaluate(() => Economy.exportProgress())).toEqual(before.economy);
  const after = await page.evaluate(() => {
    const result = { phase: "finished", rewardsSettled: true,
      economyAwards: [{ id: "timing-currency", matchId: "timing-match", money: 500, supplies: 750,
        stockLost: { inventory: { Medea: 1 } } }],
      techAwards: [{ id: "timing-tech", matchId: "timing-match", faction: "EFSF", points: 250 }],
      pilotAwards: [{ id: "timing-pilot", pilotId: "custom-settlement", kind: "kill", points: 100, experiencePoints: 100 }],
      pilotAwards: [{ id: "timing-pilot", pilotId: "custom-settlement", kind: "kill", points: 100, experiencePoints: 100 }],
    };
    for (let i=0; i<2; i++) { ProductionUI.receiveAwards(result); DevelopmentUI.receiveAwards(result); Formation.receivePilotAwards(result); }
    return { economy: Economy.exportProgress(), tech: Development.exportProgress(), pilots: Formation.exportPilotStores() };
  });
  expect(after.economy.money).toBe(before.economy.money+500);
  expect(after.economy.supplies).toBe(before.economy.supplies+750);
  expect(after.economy.inventory.Medea).toBe(before.economy.inventory.Medea-1);
  expect(after.tech.points.EFSF).toBe(before.tech.points.EFSF+250);
  expect(after.pilots.PMC.pilots[0].experience).toBe(before.pilots.PMC.pilots[0].experience+100);
  expect(after.pilots.PMC.pilots[0].record.kills).toBe(before.pilots.PMC.pilots[0].record.kills+1);
  expect(after.pilots.PMC.pilots[0].experience).toBe(before.pilots.PMC.pilots[0].experience+100);
  expect(after.pilots.PMC.pilots[0].record.kills).toBe(before.pilots.PMC.pilots[0].record.kills+1);
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  expect(await page.evaluate(() => Economy.exportProgress())).toEqual(after.economy);
  expect(await page.evaluate(() => Development.exportProgress())).toEqual(after.tech);
  expect(await page.evaluate(() => Formation.exportPilotStores())).toEqual(after.pilots);
  expect(await page.evaluate(() => Formation.exportPilotStores())).toEqual(after.pilots);
});
