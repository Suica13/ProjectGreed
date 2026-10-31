const { test, expect } = require("@playwright/test");
const { createServer } = require("../server.js"),
  G = require("../shared/rules.js"),
  D = require("../shared/development.js");
test("switching from advanced Zeon to starter EFSF lowers room AI technology and keeps varied caps stable", async ({
  page,
}) => {
  const app = createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const research = { ZEON: D.nodes("ZEON").map((n) => n.id) };
  const base = "http://127.0.0.1:" + address.port;
  const idle = () => page.waitForFunction(() => Net.active && Net.snapshot && !Net.awaiting);
  const act = async (action, fields = {}) => {
    await idle();
    await page.evaluate(({ action, fields }) => Net.request(action, fields), { action, fields });
    await idle();
  };
  try {
    await page.addInitScript(
      (researched) =>
        localStorage.setItem(
          "projectgreed.developmentProgress.v1",
          JSON.stringify({ points: { EFSF: 0, ZEON: 0 }, claimed: {}, researched }),
        ),
      research,
    );
    await page.goto(base);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate((base) => Lobby.reconnect(base), base);
    await expect(page.locator("#lobby")).toBeVisible();
    await page.locator("#createRoom").click();
    await page.locator("#roomCode").fill("AI_ACTIVE");
    await page.locator('#roomCreateForm button[type="submit"]').click();
    await idle();
    await act("set_faction", { faction: "ZEON" });
    await act("add_ai", { seat: 1 });
    await act("configure_ai", { seat: 1, characterFaction: "ZEON" });
    await act("set_faction", { faction: "EFSF" });
    await act("start_game", { formation: [{ unitId: "Type61", kitId: "standard" }] });
    const room = app.rooms.get("AI_ACTIVE"),
      bot = room.seats[1];
    expect(room.phase).toBe("assembly");
    expect(room.aiResearch).toEqual(
      D.aiResearch([{ characterFaction: "EFSF", researched: research }]),
    );
    for (const f of ["EFSF", "ZEON"])
      expect(D.nodes(f).some((n) => n.page === 1 && room.aiResearch[f].includes(n.id))).toBe(false);
    const variation = G.aiFormationVariation(room.aiFormationSeed, 1),
      player = { ...bot, formationVariation: variation };
    const caps = {
      cost: G.armyBudget(room.settings, player),
      points: G.armyUnitLimit(room.settings, player),
      unit: G.armyRestrictions(room.settings, player).unitCostLimit,
    };
    await page.locator("#confirmFinalFormation").click();
    await expect(page.locator("#confirmDeployment")).toBeVisible();
    await expect(page.locator("#resourceLoading")).toBeHidden();
    const units = room.game.units.filter((u) => u.ownerSeat === 1);
    expect(units.length).toBeGreaterThan(0);
    expect(units.reduce((n, u) => n + G.models[u.model].cost, 0)).toBeLessThanOrEqual(caps.cost);
    expect(units.reduce((n, u) => n + G.formationWeight(G.models[u.model]), 0)).toBeLessThanOrEqual(
      caps.points,
    );
    expect(
      units.every(
        (u) =>
          G.models[u.model].cost <= caps.unit &&
          D.allows(bot.characterFaction, G.models[u.model].prefabId, room.aiResearch),
      ),
    ).toBe(true);
    expect(G.aiFormationVariation(room.aiFormationSeed, 1)).toEqual(variation);
    expect(await page.evaluate(() => Development.researchSnapshot().ZEON.length)).toBe(
      D.normalizeResearch(research).ZEON.length,
    );
    expect(errors).toEqual([]);
  } finally {
    await page.evaluate(() => Net.leave()).catch(() => {});
    await app.close();
  }
});
