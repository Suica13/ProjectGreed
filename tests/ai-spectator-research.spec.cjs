const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const tree = require("../shared/development-tree.json");

async function action(page, name, fields = {}) {
  const revision = await page.evaluate(
    ({ name, fields }) => {
      const previous = Net.revision;
      Net.request(name, fields);
      return previous;
    },
    { name, fields },
  );
  await page.waitForFunction((revision) => !Net.awaiting && Net.revision > revision, revision);
}

for (const mode of ["regular", "quick"])
  test(`offline ${mode}: spectator host technology reaches the AI formations`, async ({ page }) => {
    const researched = { EFSF: tree.EFSF.map((node) => node.id) };
    await page.addInitScript((researched) => {
      localStorage.setItem("projectgreed.combatFaction", "EFSF");
      localStorage.setItem(
        "projectgreed.developmentProgress.v1",
        JSON.stringify({ points: { EFSF: 0, ZEON: 0 }, claimed: {}, researched }),
      );
    }, researched);
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await expect(page.locator("#openSkirmish")).toBeEnabled();
    await page.locator("#openSkirmish").click();
    await page.locator("#offlineRoomMode").selectOption(mode);
    await page.locator("#createOfflineRoom").click();
    await page.waitForFunction(
      () => Net.local && !Net.awaiting && Net.snapshot?.members.some((member) => member.bot),
    );
    await action(page, "configure_room", {
      mapId: "frontier_1v1",
      costLimit: 4000,
      unitCostLimit: 800,
      unitLimit: 12,
    });
    await action(page, "switch_seat", { seat: null });
    await action(page, "add_ai", { seat: 0 });
    await action(page, "start_game");
    const result = await page.evaluate(() => ({
      phase: Net.snapshot.phase,
      spectator: Net.isSpectator(),
      players: Net.snapshot.assembly.players.map((bot) => ({
        bot: bot.bot,
        count: bot.entries.length,
        disabled: bot.disabled.length,
        advanced: bot.entries.some((entry) => !Development.allows("PMC", entry.unitId, {})),
      })),
    }));
    expect(result.phase).toBe("assembly");
    expect(result.spectator).toBe(true);
    expect(result.players).toHaveLength(2);
    expect(
      result.players.every((player) => player.bot && player.count > 0 && player.disabled === 0),
    ).toBe(true);
    expect(result.players.some((player) => player.advanced)).toBe(true);
    await page.evaluate(() => Net.leave());
  });
