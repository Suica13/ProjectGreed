const { finishPlanning } = require("./planning-fixture.cjs");
const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const { openPresentationFixture } = require("./presentation-fixture.cjs");
const { createServer } = require("../server.js");

test("map boost uses original posture and loops attached flames only while moving; walk mode has no flames", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await openPresentationFixture(page, false);
  const result = await page.evaluate(() => {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
    const unit = game.units[0],
      model = SpriteRenderer.models[unit.model];
    const boost = model.decals.find((l) => l.name === "BoostLoop"),
      image = SpriteRenderer.images[boost.asset];
    const ctx = byId("map").getContext("2d"),
      drawImage = ctx.drawImage,
      draw = SpriteRenderer.draw;
    const frames = [],
      clips = [];
    ctx.drawImage = function (img, ...args) {
      if (img === image) frames.push(args[0]);
      return drawImage.call(this, img, ...args);
    };
    SpriteRenderer.draw = function (...args) {
      if (args[1] === unit.model && args[11]) clips.push(args[6]);
      return draw(...args);
    };
    try {
      moving = {
        id: unit.id,
        from: { x: unit.x, y: unit.y },
        path: [{ x: unit.x + 1, y: unit.y }],
        start: 0,
        step: 1000,
      };
      for (const at of [0, 250, 500, 750]) drawMap(at);
      const active = frames.splice(0);
      const boostClips = clips.splice(0);
      model.presentation.movement = "walk";
      drawMap(800);
      const walkFrames = frames.splice(0),
        walkClip = clips.splice(0);
      model.presentation.movement = "boost";
      moving = null;
      drawMap(900);
      return {
        active,
        boostClips,
        walkFrames,
        walkClip,
        stationary: frames,
        width: Math.floor(image.width / boost.frames),
      };
    } finally {
      model.presentation.movement = "boost";
      moving = null;
      ctx.drawImage = drawImage;
      SpriteRenderer.draw = draw;
    }
  });
  expect(result.active).toEqual([0, result.width, result.width * 2, 0]);
  expect(result.boostClips).toEqual(Array(4).fill("OnMoving"));
  expect(result.walkFrames).toEqual([]);
  expect(result.walkClip).toEqual(["OnMovingWalk"]);
  expect(result.stationary).toEqual([]);
  await page.evaluate(() => {
    const u = game.units[0];
    moving = {
      id: u.id,
      from: { x: u.x, y: u.y },
      path: [{ x: u.x + 1, y: u.y }],
      start: 0,
      step: 1000,
    };
    drawMap(500);
  });
  await page.screenshot({ path: ".openai/boost-map.png" });
  expect(errors).toEqual([]);
});

async function connect(page, port, name) {
  await page.goto("http://127.0.0.1:" + port);
  await page.locator("#playerId").fill(name);
  await page.locator("#openSkirmish").click();
  await page.locator("#openRooms").click();
  await page.locator("#serverAddress").fill("127.0.0.1:" + port);
  await page.locator("#connectServer").click();
  await expect(page.locator("#lobby")).toBeVisible();
  await page.evaluate(() => {
    window.notices = [];
    const play = WeaponAudio.play;
    WeaponAudio.play = (sound, ...args) => {
      window.notices.push(sound?.asset);
      return play(sound, ...args);
    };
  });
}

test("two real clients hear game start, own turn, attack lock and target warning without snapshot repeats", async ({
  page,
  context,
}) => {
  const app = createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen(),
    guest = await context.newPage();
  try {
    await connect(page, address.port, "Host");
    await page.locator("#createRoom").click();
    await page.locator("#roomCode").fill("SOUNDS");
    await page.locator('#roomCreateForm button[type="submit"]').click();
    await connect(guest, address.port, "Guest");
    await guest.locator(".room-card").filter({ hasText: "SOUNDS" }).getByRole("button").click();
    await guest.locator("#roomChatInput").fill("message from guest");
    await guest.locator("#roomChatInput").press("Enter");
    await expect
      .poll(() => page.evaluate(() => notices.filter((s) => s === "presentation/infoSound").length))
      .toBe(1);
    expect(
      await guest.evaluate(() => notices.filter((s) => s === "presentation/infoSound").length),
    ).toBe(0);
    await guest.locator("#toggleReady").click();
    await page.locator("#startRoomGame").click();
    await page.locator("#confirmFinalFormation").click();
    await guest.locator("#confirmFinalFormation").click();
    for (const p of [page, guest])
      await expect
        .poll(() =>
          p.evaluate(() => notices.filter((s) => s === "presentation/gameStartSound").length),
        )
        .toBe(1);
    await page.locator("#confirmDeployment").click();
    await guest.locator("#confirmDeployment").click();
    await expect
      .poll(() => page.evaluate(() => notices.filter((s) => s === "presentation/turnSound").length))
      .toBe(1);
    expect(
      await guest.evaluate(() => notices.filter((s) => s === "presentation/turnSound").length),
    ).toBe(0);
    await page.locator("#allies .roster-unit").first().click();
    await expect
      .poll(() =>
        page.evaluate(() => notices.filter((s) => s === "presentation/selectUnitSound").length),
      )
      .toBe(1);
    await page.getByRole("button", { name: "攻击武器 光束喷枪", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => notices.filter((s) => s === "presentation/selectWeaponSound").length),
      )
      .toBe(1);
    const room = app.rooms.get("SOUNDS"),
      a = room.game.units.find((u) => u.id === "0-0"),
      b = room.game.units.find((u) => u.id === "1-0");
    Object.assign(a, { x: 2, y: 4 });
    Object.assign(b, { x: 4, y: 4 });
    room.game.tiles[4][2] = room.game.tiles[4][4] = "plain";
    await page.evaluate(() => Net.request("sync"));
    await expect.poll(() => page.evaluate(() => !Net.awaiting)).toBe(true);
    await page.locator('.target-button[data-target-id="1-0"]').click();
    await expect
      .poll(() =>
        page.evaluate(() => notices.filter((s) => s === "presentation/lockonSound").length),
      )
      .toBe(1);
    expect(room.phase).toBe("idle");
    expect(
      await guest.evaluate(
        () => notices.filter((s) => s === "presentation/underAttackSound").length,
      ),
    ).toBe(0);
    await finishPlanning([page, guest]);
    await expect(guest.locator("#reaction")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => notices.filter((s) => s === "presentation/lockonSound").length),
      )
      .toBe(1);
    await expect
      .poll(() =>
        guest.evaluate(() => notices.filter((s) => s === "presentation/underAttackSound").length),
      )
      .toBe(1);
    await guest.locator(".incoming-entry").first().click();
    await expect
      .poll(() =>
        guest.evaluate(() => notices.filter((s) => s === "presentation/lockonSound").length),
      )
      .toBe(1);
    await page.evaluate(() => Net.receive(JSON.parse(JSON.stringify(Net.snapshot)), Net.socket));
    expect(
      await page.evaluate(() => notices.filter((s) => s === "presentation/lockonSound").length),
    ).toBe(1);
    expect(
      await guest.evaluate(() => notices.filter((s) => s === "presentation/gameStartSound").length),
    ).toBe(1);
  } finally {
    await guest.close();
    await app.close();
  }
});

test("every dodge shows loop thrust without any Boost_Start burst", async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  const result = await page.evaluate(() => {
    byId("battle").hidden = false;
    byId("battle").style.opacity = 1;
    const entry = { unitId: "RGM_79", kitId: "machine_gun" },
      g = Rules.create(false, 1, [[entry], [entry]]),
      [left, right] = g.units;
    const w = Rules.modelOf(left).weapons[0],
      event = {
        from: left.id,
        to: right.id,
        weapon: w.id,
        type: w.type,
        before: right.hp,
        after: right.hp,
        damage: 0,
        hit: false,
      };
    const canvas = byId("battleCanvas"),
      box = canvas.getBoundingClientRect(),
      plan = BattleScene.timeline(event, left, right, box.width, box.height).plan;
    const ctx = canvas.getContext("2d"),
      original = ctx.drawImage,
      startImage = SpriteRenderer.images[ART.effects.Boost_Start.asset];
    const layer = SpriteRenderer.models[right.model].decals.find((l) => l.name === "BoostLoop"),
      loopImage = SpriteRenderer.images[layer.asset];
    const starts = [],
      loops = [],
      output = [];
    ctx.drawImage = function (image, ...args) {
      if (image === startImage) starts.push(args[0]);
      if (image === loopImage) loops.push(args[0]);
      return original.call(this, image, ...args);
    };
    try {
      for (const time of [
        plan.moves[0].at - 0.01,
        plan.moves[0].at + 0.01,
        plan.moves[1].at + 0.01,
        plan.moves.at(-1).at + 0.7,
      ]) {
        starts.length = loops.length = 0;
        BattleScene.draw(canvas, {
          left,
          right,
          event,
          ratio: time / plan.duration,
          elapsed: time,
          time,
          completed: false,
          displayHp: { [left.id]: left.hp, [right.id]: right.hp },
        });
        output.push({ starts: [...starts], loops: loops.length });
      }
    } finally {
      ctx.drawImage = original;
    }
    return output;
  });
  expect(result[0]).toEqual({ starts: [], loops: 0 });
  expect(result[1].starts).toEqual([]);
  expect(result[1].loops).toBeGreaterThan(0);
  expect(result[2].starts).toEqual([]);
  expect(result[2].loops).toBeGreaterThan(0);
  expect(result[3].starts).toEqual([]);
});

test("map movement animation does not overwrite the authoritative combat facing", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await openPresentationFixture(page, false);
  const result = await page.evaluate(() => {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
    const unit = game.units[0],
      original = SpriteRenderer.draw,
      angles = [];
    unit.angle = 37;
    SpriteRenderer.draw = (...args) => {
      angles.push(args[5]);
      return original(...args);
    };
    try {
      moving = {
        id: unit.id,
        from: { x: unit.x, y: unit.y },
        path: [{ x: unit.x + 1, y: unit.y }],
        start: 0,
        step: 1000,
      };
      drawMap(500);
      const movingAngle = angles[0],
        storedAngle = unit.angle;
      moving = null;
      angles.length = 0;
      drawMap(1000);
      return {
        movingAngle,
        storedAngle,
        stationaryAngle: angles[0],
        selectVolume: ART.presentation.selectUnitSound.volume,
        weaponVolume: ART.presentation.selectWeaponSound.volume,
      };
    } finally {
      SpriteRenderer.draw = original;
      moving = null;
    }
  });
  expect(result).toEqual({
    movingAngle: 90,
    storedAngle: 37,
    stationaryAngle: 37,
    selectVolume: 0.35,
    weaponVolume: 0.5,
  });
});
