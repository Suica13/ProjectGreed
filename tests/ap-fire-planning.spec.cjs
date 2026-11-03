const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
async function open(page) {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.evaluate(() => {
    Net.leave();
    session++;
    game = Rules.create(
      false,
      1,
      [[{ unitId: "RGM_79", kitId: "machine_gun" }], [{ unitId: "RGM_79", kitId: "machine_gun" }]],
      false,
      { fogMode: "disabled" },
    );
    game.tiles.forEach((row) => row.fill("plain"));
    game.deployment = null;
    game.units.forEach((u, i) =>
      Object.assign(u, { x: 8 + i, y: 7, hp: 100000, en: 10000, shield: 0, actionPoints: 10 }),
    );
    phase = "idle";
    pending = null;
    selected = game.units[0].id;
    battleView = null;
    mode = "select";
    setPageView("game");
    update();
  });
}
test("default AP plan can be edited, restored and submitted without spending during preview", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  await page.evaluate(() => AttackControls.choose(game.units[0], game.units[1]));
  const editor = page.locator("#attackEditor");
  await expect(editor).toBeVisible();
  const initial = await editor.locator("[data-fire-remove]").count();
  expect(initial).toBeGreaterThan(0);
  await editor.locator("[data-fire-remove]").last().click();
  await expect(editor.locator("[data-fire-remove]")).toHaveCount(initial - 1);
  await expect(editor.getByRole("button", { name: "恢复自动", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => game.units[0].actionPoints)).toBe(10);
  await editor.getByRole("button", { name: "恢复自动", exact: true }).click();
  await expect(editor.locator("[data-fire-remove]")).toHaveCount(initial);
  await editor.locator("[data-fire-remove]").last().click();
  const selected = await page.evaluate(
    () => AttackControls.draft(game.units[0]).firePlans[game.units[0].id],
  );
  await page.locator("#confirmAttackQueue").click();
  expect(await page.evaluate(() => pending.manualPlans[0].weapons)).toEqual(selected);
  expect(await page.evaluate(() => game.units[0].actionPoints)).toBe(10);
  expect(errors).toEqual([]);
});
test("counter screen accepts per-unit manual plans and preserves independent budget display", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  await page.evaluate(() =>
    beginAttack(game.units[0], game.units[1], Rules.modelOf(game.units[0]).weapons[0]),
  );
  await expect(page.locator("#reaction")).toBeVisible();
  await page.locator("#responseCounter").click();
  const list = page.locator("#counterList");
  const before = await list.locator("[data-fire-remove]").count();
  expect(before).toBeGreaterThan(0);
  await list.locator("[data-fire-remove]").last().click();
  await expect(list.getByRole("button", { name: "恢复自动", exact: true })).toBeEnabled();
  const choice = await page.evaluate(() => counterChoices()[0]);
  expect(choice.weaponIds).toHaveLength(before - 1);
  expect(await page.evaluate(() => game.units[1].en)).toBe(10000);
  await list.getByRole("button", { name: "恢复自动", exact: true }).click();
  await expect(list.locator("[data-fire-remove]")).toHaveCount(before);
  expect(errors).toEqual([]);
});

test("three-member squad keeps manual edits independent", async ({page}) => {
  await open(page);
  await page.evaluate(()=>{
    const root=game.units[0];root.squadId="ap-squad";root.squadSlot=0;
    for(let slot=1;slot<3;slot++)game.units.push({...structuredClone(root),id:"ap-member-"+slot,squadSlot:slot});
    squadSingleMove=false;AttackControls.choose(root,game.units[1]);
  });
  const cards=page.locator('#attackEditor [data-attack-member]');
  await expect(cards).toHaveCount(3);
  const second=cards.nth(1), before=await second.locator('[data-fire-remove]').count();
  await second.locator('[data-fire-remove]').last().click();
  await expect(cards.nth(0).getByRole('button',{name:'自动规划',exact:true})).toBeDisabled();
  await expect(second.locator('[data-fire-remove]')).toHaveCount(before-1);
  await page.locator('#confirmAttackQueue').click();
  const plans=await page.evaluate(()=>pending.manualPlans);
  expect(plans).toHaveLength(1);expect(plans[0].unitId).toBe('ap-member-1');
});
