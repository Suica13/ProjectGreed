const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
async function open(page) {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.evaluate(() => {
    Net.leave();
    session++;
    const e = { unitId: "RGM_79", kitId: "machine_gun" };
    game = Rules.create(
      false,
      1,
      [
        [e, e, e],
        [e, e, e],
      ],
      false,
      { fogMode: "disabled" },
    );
    game.tiles.forEach((row) => row.fill("plain"));
    game.units.forEach((u, i) =>
      Object.assign(u, {
        x: i < 3 ? 5 : 6,
        y: 5,
        hp: 1000000,
        en: 100000,
        shield: 0,
        actionPoints: 20,
      }),
    );
    phase = "idle";
    pending = moving = battleView = null;
    selected = game.units[0].id;
    mode = "select";
    squadSingleMove = false;
    setPageView("game");
    update();
  });
}
test("response portraits default to all and edit each member independently without overlapping stats", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    game.units.slice(3).forEach((u, i) => Object.assign(u, { squadId: "response", squadSlot: i }));
    beginAttack(game.units[0], game.units[3], Rules.modelOf(game.units[0]).weapons[0]);
  });
  await expect(page.locator("#reaction")).toBeVisible();
  await expect(page.locator("#mapWrap > #hudSquad")).toBeVisible();
  await expect(page.locator("#squadSelectAll")).toHaveAttribute("aria-pressed", "true");
  const stripStyle = await page.locator("#hudSquad").evaluate(el => {
    const style = getComputedStyle(el);
    return { position: style.position, bottom: style.bottom, left: style.left };
  });
  expect(stripStyle.position).toBe("absolute");
  expect(stripStyle.bottom).toBe("66px");
  await expect(page.locator(".response-defender #hudSquad")).toHaveCount(0);

  const avatars = page.locator("#hudSquad [data-squad-member]");
  await expect(avatars).toHaveCount(3);
  const first = await avatars.nth(0).getAttribute("data-squad-member");
  const second = await avatars.nth(1).getAttribute("data-squad-member");
  await avatars.nth(0).click();
  await page.locator("#responseDefend").click();
  await expect(page.locator("#counterList [data-attack-member]")).toHaveCount(1);
  const bounds = await page.evaluate(() => {
    const card = byId("counterList").firstElementChild;
    return {
      header: card.querySelector("header").getBoundingClientRect().bottom,
      empty: card.querySelector(".hud-attack-member-weapons > .helper").getBoundingClientRect().top,
    };
  });
  expect(bounds.empty).toBeGreaterThanOrEqual(bounds.header);
  await page.locator(`#hudSquad [data-squad-member="${second}"]`).click();
  await page.locator("#responseEvade").click();
  await page.locator("#squadSelectAll").click();
  const choices = await page.evaluate(() => counterChoices());
  expect(choices.find((c) => c.unitId === first).response).toBe("defend");
  expect(choices.find((c) => c.unitId === second).response).toBe("evade");
  await expect(page.locator("#counterList [data-attack-member]")).toHaveCount(3);
});
test("deployment clicking a compatible ally offers squad merge", async ({ page }) => {
  await open(page);
  const point = await page.evaluate(() => {
    const [a, b, c] = game.units;
    game.deployment = [false, false];
    const cells = Rules.deploymentCells(game, 0, a);
    [a, b, c].forEach((u, i) => {
      delete u.squadId;
      delete u.squadSlot;
      Object.assign(u, cells[i]);
    });
    phase = "deployment";
    selected = a.id;
    update();
    Deployment.click({ x: b.x, y: b.y });
    return { x: b.x, y: b.y };
  });
  await expect(page.locator("#gameDialog")).toBeVisible();
  await page.locator("#gameDialog").getByRole("button", { name: "合并小队", exact: true }).click();
  expect(await page.evaluate(() => Rules.squadMembers(game, game.units[0]).length)).toBe(2);
  await page.evaluate((point) => {
    selected = game.units[2].id;
    Deployment.click(point);
  }, point);
  await page.locator("#gameDialog").getByRole("button", { name: "合并小队", exact: true }).click();
  expect(await page.evaluate(() => Rules.squadMembers(game, game.units[0]).length)).toBe(3);
  expect(
    await page.evaluate(() => game.units.slice(0, 3).every((u) => u.actionPoints === 20)),
  ).toBe(true);
});
test("unconfirmed multi-unit launch already renders a separated triangle while preserving cargo state", async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const [carrier, ...others] = game.units;
    carrier.model = Object.keys(Rules.models).find((id) => id.startsWith("PegasusClass__"));
    Object.assign(carrier, { x: 8, y: 8 });
    delete carrier.squadId;
    const extra = { ...structuredClone(others[0]), id: "extra-cargo" };
    const cargo = [...others.slice(0, 2), extra];
    game.units = [carrier, ...cargo];
    const h = Rules.hangars.of(carrier)[0];
    cargo.forEach((u) => {
      delete u.squadId;
      u.embarked = { carrierId: carrier.id, hangarId: h.id };
    });
    Rules.hangars.sync(game);
    await SpriteRenderer.ensureModels(game.units.map((u) => u.model));
    const cell = Rules.hangars.launchSquadCells(game, cargo)[0];
    const event = Rules.hangars.previewLaunchSquad(game, cargo, cell.x, cell.y);
    PlanningUI.move(event);
    selected = carrier.id;
    MapCamera.setZoom(3);
    MapCamera.focus(8, 8);
    const positions = [],
      original = SpriteRenderer.draw;
    SpriteRenderer.draw = (...args) => {
      if (args[1] === cargo[0].model) positions.push([args[2], args[3]]);
      return original(...args);
    };
    try {
      drawMap(performance.now());
    } finally {
      SpriteRenderer.draw = original;
    }
    return { positions, stored: cargo.every((u) => u.embarked && !u.squadId && u.pendingMove) };
  });
  expect(result.stored).toBe(true);
  expect(result.positions).toHaveLength(3);
  expect(new Set(result.positions.map((p) => p.map((v) => v.toFixed(2)).join(","))).size).toBe(3);
});
