const { expect } = require("@playwright/test");
async function finishPlanning(pages) {
  const team = await pages[0].evaluate(() => Net.snapshot.game.team);
  for (const page of pages) {
    const owns = await page.evaluate(
      (team) => Net.seat !== null && Rules.seatTeam(Net.seat) === team,
      team,
    );
    if (!owns) continue;
    await expect.poll(() => page.evaluate(() => !Net.awaiting)).toBe(true);
    if (
      await page.evaluate(() => Net.snapshot.phase === "idle" && !Net.snapshot.turnDone[Net.seat])
    ) {
      await page.evaluate(() => Net.request("end_turn"));
      await expect.poll(() => page.evaluate(() => !Net.awaiting)).toBe(true);
    }
  }
}
module.exports = { finishPlanning };
