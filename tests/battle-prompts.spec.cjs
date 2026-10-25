const { test } = require("@playwright/test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;
function nextRoom(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const observer = new MutationObserver(() => {
          if (Net.snapshot && !Net.snapshot.started) {
            observer.disconnect();
            resolve({ pageView, phase, open: byId("roomReturnCountdown").open });
          }
        });
        observer.observe(byId("roomPreparation"), {
          childList: true,
          attributes: true,
          subtree: true,
        });
      }),
  );
}

test("end action confirmation is centered at Cutin width and cancel preserves the turn", async ({
  page,
}) => {
  await page.goto(url);
  await page.evaluate(async () => {
    await SpriteRenderer.load();
    I18n.setLanguage("zh");
    Net.leave();
    TurnFlow.reset();
    session++;
    const entry = { unitId: "RGM_79", kitId: "machine_gun" };
    game = Rules.create(false, 1, [[entry], [entry]], false, {
      costLimit: 3000,
      unitCostLimit: 1000,
    });
    phase = "idle";
    setPageView("game");
    update();
  });
  const before = await page.evaluate(() => ({ round: game.round, team: game.team }));
  await page.locator("#endTurn").click();
  const box = await page.evaluate(() => {
    const dialog = byId("endActionConfirm").getBoundingClientRect();
    byId("turnCutin").hidden = false;
    const cutin = byId("turnCutinCard").getBoundingClientRect();
    byId("turnCutin").hidden = true;
    return {
      open: byId("endActionConfirm").open,
      width: dialog.width,
      cutinWidth: cutin.width,
      cx: dialog.x + dialog.width / 2,
      cy: dialog.y + dialog.height / 2,
      w: innerWidth,
      h: innerHeight,
      text: byId("endActionMessage").textContent,
    };
  });
  assert.ok(box.open);
  assert.equal(box.width, box.cutinWidth);
  assert.ok(Math.abs(box.cx - box.w / 2) < 1);
  assert.ok(Math.abs(box.cy - box.h / 2) < 1);
  assert.ok(box.text.includes("1台"));
  await page.locator("#cancelEndAction").click();
  assert.deepEqual(await page.evaluate(() => ({ round: game.round, team: game.team })), before);
  await page.locator("#endTurn").click();
  await page.locator("#confirmEndAction").click();
  assert.equal(await page.evaluate(() => game.team), 1);
  assert.equal(await page.evaluate(() => byId("endActionConfirm").open), false);
});

test("host final assembly and combat return buttons show a five-second modal before returning everyone", async ({
  page,
}) => {
  test.setTimeout(30000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.evaluate(async () => {
    await SpriteRenderer.load();
    I18n.setLanguage("zh");
    LocalRoom.open();
    await new Promise((r) => setTimeout(r, 0));
  });
  for (const stage of ["assembly", "battle"]) {
    await page.evaluate(async () => {
      Net.request("start_game", { formation: Formation.current() });
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.equal(await page.evaluate(() => Net.snapshot.phase), "assembly");
    if (stage === "battle") {
      await page.evaluate(async () => {
        byId("confirmFinalFormation").click();
        await new Promise((r) => setTimeout(r, 0));
        byId("confirmDeployment").click();
        await new Promise((r) => setTimeout(r, 0));
        byId("roomSettings").click();
      });
    }
    const returning = nextRoom(page);
    await page.locator(stage === "assembly" ? "#returnAssemblyToRoom" : "#returnAllToRoom").click();
    const state = await page.evaluate(() => ({
      started: Net.snapshot.started,
      open: byId("roomReturnCountdown").open,
      text: byId("roomReturnMessage").textContent,
      delta: Net.snapshot.returnCountdown.at - Net.snapshot.serverTime,
    }));
    assert.ok(state.started && state.open);
    assert.ok(state.delta >= 4900 && state.delta <= 5000);
    assert.ok(state.text.includes("5秒"));
    await page.keyboard.press("Escape");
    assert.ok(await page.evaluate(() => byId("roomReturnCountdown").open));
    if (stage === "assembly") await page.evaluate(() => setPageView("formation"));
    assert.deepEqual(await returning, { pageView: "room", phase: "waiting", open: false });
  }
  assert.deepEqual(errors, []);
});
