const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const { createServer } = require("../server.js");
const url = pathToFileURL(path.resolve("public/client.html")).href;
test("menu loads a small resource set; previews request their own textures", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => assetsReady);
  const initial = await page.evaluate(() => ({
    images: Object.keys(SpriteRenderer.images).length,
    all: Object.keys(ART.assets).length,
    units: game.units.length,
    animationCount: new Set(ART.units.flatMap((unit) => Object.values(unit.animations))).size,
    logicalAnimations: ART.units.reduce((n, unit) => n + Object.keys(unit.animations).length, 0),
  }));
  expect(initial.images).toBeLessThan(100);
  expect(initial.all).toBeGreaterThan(4000);
  expect(initial.units).toBe(0);
  expect(initial.animationCount).toBeLessThan(initial.logicalAnimations / 10);
  await page.evaluate(() => ProductionUI.openUnit("RX_78NT_1"));
  await page.waitForFunction(() => SpriteRenderer.modelsReady([Economy.baseModel("RX_78NT_1")]));
  expect(await page.evaluate(() => Object.keys(SpriteRenderer.images).length)).toBeLessThan(300);
  expect(errors).toEqual([]);
});
test("battle loading blocks commands and stale callbacks never resume after cancellation", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => {
    const NativeImage = Image;
    let first = true;
    window.Image = class extends NativeImage {
      set src(value) {
        if (first) {
          first = false;
          window.releaseBattleImage = () => {
            super.src = value;
          };
        } else super.src = value;
      }
    };
    window.loadResumes = 0;
    window.loadingAcks = 0;
    Net.memberId = "asset-test";
    Net.snapshot = {
      phase: "playback",
      matchId: "asset-test",
      playback: { id: "batch", ready: [], members: ["asset-test"] },
    };
    Net.request = () => loadingAcks++;
    pageView = "game";
    CombatPlayback.receive(Net.snapshot, false);
    const model = Economy.baseModel("MA_08");
    window.sampleSnapshot = { phase: "playback", game: { units: [{ model }] } };
    BattleAssets.guard(sampleSnapshot, () => loadResumes++);
  });
  await expect(page.locator("#resourceLoading")).toBeVisible();
  expect(await page.evaluate(() => [BattleAssets.loading, Net.canAct(), loadResumes])).toEqual([
    true,
    false,
    0,
  ]);
  await page.evaluate(() => CombatPlayback.show());
  expect(await page.evaluate(() => loadingAcks)).toBe(0);
  await page.evaluate(() => window.releaseBattleImage());
  await expect.poll(() => page.evaluate(() => loadResumes)).toBe(1);
  await expect(page.locator("#resourceLoading")).toBeHidden();
  await page.evaluate(() => CombatPlayback.show());
  expect(await page.evaluate(() => loadingAcks)).toBe(1);
  expect(
    await page.evaluate(() =>
      SpriteRenderer.readyAssets(SpriteRenderer.battleKeys(sampleSnapshot)),
    ),
  ).toBe(true);
  await page.evaluate(() => {
    const NativeImage = Image;
    let first = true;
    window.Image = class extends NativeImage {
      set src(value) {
        if (first) {
          first = false;
          window.releaseCancelledImage = () => {
            super.src = value;
          };
        } else super.src = value;
      }
    };
    BattleAssets.guard(
      { phase: "playback", game: { units: [{ model: Economy.baseModel("AlbionClass") }] } },
      () => loadResumes++,
    );
    BattleAssets.cancel();
  });
  await page.evaluate(() => releaseCancelledImage());
  await page.waitForFunction(() => SpriteRenderer.modelsReady([Economy.baseModel("AlbionClass")]));
  expect(await page.evaluate(() => loadResumes)).toBe(1);
  expect(errors).toEqual([]);
});
test("shared immutable payloads support localization and combat resolution", async ({ page }) => {
  await page.goto(url);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(() => {
    I18n.setLanguage("en");
    I18n.setLanguage("ja");
    I18n.setLanguage("zh");
    const unitId = "RX_78NT_1",
      kitId = ART.prefabs.find((unit) => unit.id === unitId).weaponKits[0].id;
    const entry = { unitId, kitId };
    const state = Rules.create(
      false,
      1,
      Rules.getMap().spawns.map(() => [{ ...entry }]),
      false,
      { costLimit: 99999, fogMode: "disabled" },
    );
    state.tiles.forEach((row) => row.fill("plain"));
    const [a, b] = state.units;
    Object.assign(a, { x: 10, y: 10 });
    Object.assign(b, { x: 12, y: 10 });
    const weapon = Rules.modelOf(a).weapons.find((weapon) => weapon.type !== "melee");
    const estimate = Rules.estimate(state, a, b, weapon);
    Rules.fight(state, a, b, weapon, "defend");
    return { damage: estimate.damage, hp: b.hp };
  });
  expect(result.damage).toBeGreaterThan(0);
  expect(result.hp).toBeGreaterThanOrEqual(0);
});
test("HTTP mode loads cached media URLs and an offline room reaches deployment with assets ready", async ({
  page,
}) => {
  test.setTimeout(60000);
  const app = createServer({ host: "127.0.0.1", port: 0 });
  const address = await app.listen();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.waitForFunction(() => assetsReady);
    const audio = await page.evaluate(() => ART.music.tracks[0].source);
    expect(audio).toMatch(/^\/client-assets\//);
    await page.evaluate(() => {
      const pilot = PilotSystem.createCustom(
        "custom-load-avatar",
        "Test",
        PilotSystem.catalog.portraits[0].id,
      );
      const image = document.createElement("img");
      image.id = "runtimePilotIcon";
      image.src = unitIcon(Economy.baseModel("RX_78NT_1"), pilot);
      document.body.append(image);
    });
    await expect
      .poll(() => page.locator("#runtimePilotIcon").getAttribute("src"))
      .toMatch(/^data:image\/png/);
    const response = await page.request.get(`http://127.0.0.1:${address.port}${audio}`, {
      headers: { Range: "bytes=0-31" },
    });
    expect(response.status()).toBe(206);
    expect((await response.body()).length).toBe(32);
    await page.locator("#openSkirmish").click();
    await page.locator("#createOfflineRoom").click();
    await expect(page.locator("#roomPreparation")).toBeVisible();
    await page.locator("#startRoomGame").click();
    await page.locator("#confirmFinalFormation").click();
    await expect(page.locator("#gameScene")).toBeVisible();
    await expect(page.locator("#resourceLoading")).toBeHidden();
    await expect.poll(() => page.evaluate(() => phase)).toBe("deployment");
    expect(
      await page.evaluate(() =>
        SpriteRenderer.readyAssets(SpriteRenderer.battleKeys(Net.snapshot)),
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("two HTTP clients prepare and deploy through the real WebSocket with staged assets", async ({
  browser,
}) => {
  test.setTimeout(60000);
  const app = createServer({ host: "127.0.0.1", port: 0 });
  const address = await app.listen();
  const contexts = [await browser.newContext(), await browser.newContext()];
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const errors = [];
  pages.forEach((page) => page.on("pageerror", (error) => errors.push(error.message)));
  try {
    for (let i = 0; i < pages.length; i++) {
      await pages[i].goto(`http://127.0.0.1:${address.port}/`);
      await pages[i].waitForFunction(() => assetsReady);
      await pages[i].evaluate((port) => Lobby.reconnect("127.0.0.1:" + port), address.port);
      await pages[i].waitForFunction(() => !!Lobby.endpoint());
      await pages[i].evaluate(
        (mode) => Net.connect(mode, false, "LOADNET"),
        i === 0 ? "create" : "join",
      );
      await expect(pages[i].locator("#roomPreparation")).toBeVisible();
    }
    const [host, guest] = pages;
    await host.waitForFunction(() => Net.snapshot.members.length === 2 && !Net.awaiting);
    await guest.locator("#toggleReady").click();
    await expect(host.locator("#startRoomGame")).toBeEnabled();
    await host.locator("#startRoomGame").click();
    for (const page of pages) await page.locator("#confirmFinalFormation").click();
    for (const page of pages) {
      await expect(page.locator("#resourceLoading")).toBeHidden();
      await expect(page.locator("#confirmDeployment")).toBeVisible();
      expect(
        await page.evaluate(() =>
          SpriteRenderer.readyAssets(SpriteRenderer.battleKeys(Net.snapshot)),
        ),
      ).toBe(true);
      await page.locator("#confirmDeployment").click();
    }
    for (const page of pages) await expect.poll(() => page.evaluate(() => phase)).toBe("idle");
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await app.close();
  }
});
