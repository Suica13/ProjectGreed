const { finishPlanning } = require("./planning-fixture.cjs");
const { openPresentationFixture } = require("./presentation-fixture.cjs");
const { test: base, expect } = require("@playwright/test");
const { createServer } = require("../server.js");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { WebSocketServer } = require("ws");

// 每个测试进程使用操作系统分配的空闲端口，不占用用户正在运行的服务器。
let activeServer;
const test = base.extend({
  serverURL: [
    async ({}, use) => {
      const app = createServer({ host: "127.0.0.1", port: 0 });
      activeServer = app;
      const address = await app.listen();
      try {
        await use("http://127.0.0.1:" + address.port);
      } finally {
        await app.close();
      }
    },
    { scope: "worker" },
  ],
  baseURL: async ({ serverURL }, use) => {
    await use(serverURL);
  },
});

test("six embedded BGM tracks play offline, pause persists, next is random and ended loops the playlist", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#musicTitle")).toHaveText("GRNYB_01_Remix");
  expect(await page.evaluate(() => ART.music.tracks.length)).toBe(6);
  await page.locator("#musicToggle").click();
  await expect
    .poll(() => page.evaluate(() => !MusicPlayer.audio.paused && MusicPlayer.audio.duration > 0))
    .toBe(true);
  expect(await page.evaluate(() => MusicPlayer.audio.volume)).toBe(0.25);
  await page.locator("#musicToggle").click();
  expect(await page.evaluate(() => MusicPlayer.audio.paused)).toBe(true);
  await page.locator("#openFormation").click();
  expect(await page.evaluate(() => MusicPlayer.audio.paused)).toBe(true);
  await page.locator("#cancelFormation").click();
  await page.locator("#musicNext").click();
  const index = await page.evaluate(() => MusicPlayer.index);
  expect(index).not.toBe(0);
  expect(await page.evaluate(() => MusicPlayer.audio.paused)).toBe(true);
  for (let i = 0; i < 6; i++) {
    const duration = await page.evaluate(async (i) => {
      const audio = new Audio(ART.music.tracks[i].source);
      audio.preload = "metadata";
      await new Promise((resolve, reject) => {
        audio.onloadedmetadata = resolve;
        audio.onerror = reject;
      });
      return audio.duration;
    }, i);
    expect(duration).toBeGreaterThan(10);
  }
  await page.locator("#musicToggle").click();
  await expect
    .poll(() => page.evaluate(() => !MusicPlayer.audio.paused && MusicPlayer.audio.readyState >= 2))
    .toBe(true);
  await page.evaluate(() => {
    MusicPlayer.audio.currentTime = MusicPlayer.audio.duration - 0.1;
  });
  await expect.poll(() => page.evaluate(() => MusicPlayer.index)).toBe((index + 1) % 6);
  await expect.poll(() => page.evaluate(() => !MusicPlayer.audio.paused)).toBe(true);
  expect(errors).toEqual([]);
});

test("new GM variants appear in formation and render native cannon and two-stage saber attacks", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.locator("#openFormation").click();
  await page.locator('[data-unit-id="RGC_80"]').click();
  await page.locator("#addFormationUnit").click();
  await expect(page.locator(".formation-row").last()).toContainText("肩部加农炮");
  await expect(page.locator(".formation-row").last()).toContainText("移动 4 格");
  await page.locator('[data-unit-id="RGM_79L"]').click();
  await page.locator("#addFormationUnit").click();
  await expect(page.locator(".formation-row").last()).toContainText("移动 7 格");
  await page.locator("#cancelFormation").click();
  await openEditor(page);
  await preview(page, () => {
    GamePreview.configure({
      scene: "battle",
      leftModel: "RGC_80__machine_gun",
      rightModel: "RGM_79L__beam_gun",
      weapon: "Common_Cannon",
      result: "miss",
      progress: 0.5,
    });
    GamePreview.tick(performance.now());
  });
  await page.screenshot({ path: ".openai/new-gm-variants.png" });
  await preview(page, () => {
    GamePreview.configure({
      scene: "battle",
      leftModel: "RGM_79L__beam_gun",
      rightModel: "RGC_80__machine_gun",
      weapon: "EF_BeamSaber_BF",
      result: "hit",
      progress: 0.5,
    });
    GamePreview.tick(performance.now());
  });
  await page.screenshot({ path: ".openai/light-gm-saber.png" });
  expect(errors).toEqual([]);
});

async function openEditor(page) {
  await page.goto("/developer.html");
  await expect(page.locator("#loading")).toContainText("已就绪");
  await page.locator("#ui-dev-launch").click();
  await page.waitForFunction(
    () => document.getElementById("ui-preview-frame").contentWindow.GamePreview?.ready,
  );
  return page.frameLocator("#ui-preview-frame");
}

test("mixed burst results animate every Miss and apply only landed damage; both GM saber stages visibly play", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openEditor(page);
  const result = await preview(page, () => {
    GamePreview.configure({
      scene: "battle",
      leftModel: "RGM_79__machine_gun",
      rightModel: "RGM_79__bazooka",
      weapon: "EF_90mmMG",
      response: "defend",
      result: "hit",
      playing: false,
    });
    const a = GamePreview.left,
      b = GamePreview.right,
      w = getWeapon(a, "EF_90mmMG");
    b.shield = 0;
    game.seed = 1500;
    const event = Rules.fight(game, a, b, w, "defend")[0];
    GamePreview.events = [event];
    const canvas = byId("battleCanvas"),
      box = canvas.getBoundingClientRect(),
      view = BattleScene.timeline(event, a, b, box.width, box.height),
      calls = [],
      draw = SpriteRenderer.draw;
    let current = 0;
    SpriteRenderer.draw = function (...args) {
      if (args[0] === canvas.getContext("2d") && args[1] === b.model)
        calls.push({ index: current, clip: args[6] });
      return draw(...args);
    };
    const hp = [];
    try {
      for (const [i, contact] of view.plan.contacts.entries()) {
        current = i;
        GamePreview.progress = (contact.at + 0.001) / view.plan.duration;
        GamePreview.tick(performance.now());
        hp.push(WeaponEffects.health(event, view.plan, contact.at + 0.001, event.before));
      }
    } finally {
      SpriteRenderer.draw = draw;
    }
    return {
      hit: event.strikes.map((s) => s.hit),
      clips: calls.map((c) => c.clip),
      hp,
      damage: event.strikes.map((s) => s.damage),
      before: event.before,
      after: event.after,
      cues: view.plan.cues.length,
      hitCount: event.hitCount,
    };
  });
  expect(result.hit.some(Boolean)).toBe(true);
  expect(result.hit.some((hit) => !hit)).toBe(true);
  let hp = result.before;
  for (let i = 0; i < result.hit.length; i++) {
    hp -= result.damage[i];
    expect(result.hp[i]).toBe(hp);
    expect(result.clips[i]).toBe(result.hit[i] ? "Common_Stagger" : "Common_Dodge_L");
  }
  expect(hp).toBe(result.after);
  expect(result.cues).toBe(9 + result.hitCount);
  const stages = await preview(page, () => {
    const outputs = [];
    for (const model of ["RGM_79__machine_gun", "RGM_79L__beam_gun"]) {
      const id = model.startsWith("RGM_79L") ? "EF_BeamSaber_BF" : "EF_BeamSaber_A";
      GamePreview.configure({
        scene: "battle",
        leftModel: model,
        rightModel: "RGC_80__machine_gun",
        weapon: id,
        response: "defend",
        result: "hit",
        playing: false,
      });
      const event = GamePreview.events[0],
        a = GamePreview.left,
        b = GamePreview.right,
        canvas = byId("battleCanvas"),
        box = canvas.getBoundingClientRect(),
        view = BattleScene.timeline(event, a, b, box.width, box.height),
        draw = SpriteRenderer.draw,
        calls = [];
      SpriteRenderer.draw = function (...args) {
        if (args[0] === canvas.getContext("2d") && args[1] === a.model)
          calls.push({
            clip: args[6],
            angle: SpriteRenderer.pose(a.model, args[6], args[7]).RightWeapon.dir,
          });
        return draw(...args);
      };
      try {
        for (const contact of view.plan.contacts) {
          GamePreview.progress = (contact.at + 0.001) / view.plan.duration;
          GamePreview.tick(performance.now());
        }
      } finally {
        SpriteRenderer.draw = draw;
      }
      outputs.push(calls);
    }
    return outputs;
  });
  for (const calls of stages) {
    expect(calls).toHaveLength(2);
    expect(calls[0].clip).not.toBe("Common_Melee_F");
    expect(calls[1].clip).toBe("Common_Melee_F");
    expect(calls[1].angle).not.toBe(calls[0].angle);
  }
  await page.screenshot({ path: ".openai/melee-second-stage.png" });
  expect(errors).toEqual([]);
});
async function preview(page, callback) {
  return page
    .locator("#ui-preview-frame")
    .evaluate((frame, source) => frame.contentWindow.eval(`(${source})()`), callback.toString());
}
async function numberField(page, id, value) {
  const input = page.locator(id);
  await input.fill(String(value));
  await input.dispatchEvent("change");
}

async function connectLobby(page, serverURL) {
  await page.locator("#openSkirmish").click();
  await page.locator("#openRooms").click();
  await expect(page.locator("#serverConnect")).toBeVisible();
  await expect(page.locator("#lobby")).toBeHidden();
  if (serverURL) await page.locator("#serverAddress").fill(serverURL);
  await page.locator("#connectServer").click();
  await expect(page.locator("#serverConnect")).toBeHidden();
  await expect(page.locator("#lobby")).toBeVisible();
}
async function readyGame(first, second) {
  await expect(first.locator("#roomPreparation")).toBeVisible();
  await expect(second.locator("#roomPreparation")).toBeVisible();
  await second.locator("#roomFormation").click();
  await second.locator("#formationName").fill("等待时编辑");
  await first.evaluate(() => Net.request("sync"));
  await expect(second.locator("#formationScreen")).toBeVisible();
  await expect(second.locator("#formationName")).toHaveValue("等待时编辑");
  await second.locator("#cancelFormation").click();
  await expect(second.locator("#teamSlots")).toContainText("房主");
  for (const p of [first, second])
    if (await p.evaluate(() => Net.snapshot.you.id !== Net.snapshot.hostId))
      await p.locator("#toggleReady").click();
  for (const p of first.context().pages())
    if (
      await p.evaluate(
        () =>
          typeof Net !== "undefined" &&
          !!Net.snapshot &&
          Net.snapshot.you.id === Net.snapshot.hostId,
      )
    )
      await p.locator("#startRoomGame").click();
  await first.locator("#confirmFinalFormation").click();
  await second.locator("#confirmFinalFormation").click();
  await expect(first.locator("#gameScene")).toBeVisible();
  await expect(second.locator("#gameScene")).toBeVisible();
  await first.evaluate(() => Net.request("deploy", { unitId: "0-0", x: 2, y: 8 }));
  await expect.poll(() => first.evaluate(() => Net.awaiting)).toBe(null);
  await first.locator("#confirmDeployment").click();
  await expect.poll(() => second.evaluate(() => game.deployment[0])).toBe(true);
  await second.locator("#confirmDeployment").click();
  await expect.poll(() => first.evaluate(() => phase)).toBe("idle");
  // Close-range fixture for protocol/UI battles; full-map AI tests keep actual spawns.
  const code = await first.evaluate(() => Net.room),
    room = activeServer.rooms.get(code);
  for (const unit of room.game.units) {
    unit.x = unit.team ? 10 : 2;
    unit.y = 4 - Number(unit.id.split("-")[1]);
    room.game.tiles[unit.y][unit.x] = "plain";
  }
}
async function returnFromBattle(page) {
  if (await page.locator("#battle").isVisible()) {
    await page.locator("#continueBattle").evaluate((button) => button.click());
    await expect(page.locator("#battle")).toBeHidden();
  }
}
async function leaveGame(page, button = "#netSettings") {
  await page.locator(button).click();
  await expect(page.locator("#leaveConfirm")).toBeVisible();
  await page.locator("#confirmLeave").click();
  await expect(page.locator("#gameScene")).toBeHidden();
  await expect(page.locator("#start")).toBeVisible();
}

test("formation persists selected weapon kits and offline deployment uses map clicks", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.locator("#openFormation").click();
  await expect(page.locator("#formationScreen")).toBeVisible();
  await page.locator("#newFormation").click();
  await page.locator("#formationName").fill("火箭筒单机编组");
  await page.locator(".formation-row button").last().click();
  await page.locator(".formation-row button").last().click();
  await page
    .locator(".formation-row")
    .first()
    .getByRole("button", { name: "详情", exact: true })
    .click();
  await page.locator("#formationDetailKit").selectOption("bazooka");
  await page.locator("#closeFormationDetail").click();
  await expect(page.locator("#formationName")).toHaveValue("火箭筒单机编组");
  await expect(page.locator("#formationBudget")).toContainText("1 / 12");
  await page.screenshot({ path: ".openai/rgm79-formation.png" });
  await page.locator("#saveFormation").click();
  await page.reload();
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  expect(await page.evaluate(() => Formation.name())).toBe("火箭筒单机编组");
  expect(await page.evaluate(() => Formation.current())).toEqual([
    { unitId: "RGM_79", kitId: "bazooka" },
  ]);
  await openPresentationFixture(page, true);
  await expect(page.locator("#deploymentPanel")).toBeVisible();
  expect(await page.evaluate(() => game.units.filter((u) => u.team === 0).length)).toBe(1);
  expect(
    await page.evaluate(() => UnitModels[game.units[0].model].weapons.map((w) => w.id)),
  ).toEqual(["EF_HypeBazooka", "EF_BeamSaber_A", "Common_DoubleVulcan_MS"]);
  await expect(page.locator("#endTurn")).toBeDisabled();
  await page.waitForFunction(() => !!mapGeo);
  async function cell(x, y) {
    const p = await page.evaluate(
      ({ x, y }) => {
        const r = byId("map").getBoundingClientRect();
        return {
          x: r.left + mapGeo.ox + (x + 0.5) * mapGeo.tile,
          y: r.top + mapGeo.oy + (y + 0.5) * mapGeo.tile,
        };
      },
      { x, y },
    );
    await page.mouse.click(p.x, p.y);
  }
  await cell(2, 8);
  await cell(3, 8);
  expect(await page.evaluate(() => game.units[0].x)).toBe(3);
  await page.screenshot({ path: ".openai/rgm79-deployment.png" });
  await page.locator("#confirmDeployment").click();
  await expect(page.locator("#deploymentPanel")).toBeHidden();
  await expect(page.locator("#endTurn")).toBeEnabled();
  expect(errors).toEqual([]);
});

test("server dialog gates the table until handshake succeeds; refresh requests new rows and disconnect hides them", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((resolve) => server.once("listening", resolve));
  let peer = null,
    requests = 0,
    attempts = 0;
  server.on("connection", (socket) => {
    peer = socket;
    socket.on("message", (data) => {
      if (JSON.parse(data).type === "list_rooms") requests++;
    });
  });
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).port === String(server.address().port)) attempts++;
  });
  for (const host of ["114.66.40.147:1313", "126.227.168.176:1313"])
    await page.routeWebSocket("ws://" + host + "/ws", (ws) => ws.close());
  try {
    await page.goto("/");
    await expect(page.locator("#openRooms")).toBeEnabled();
    await page.locator("#openSkirmish").click();
    await page.locator("#openRooms").click();
    await expect(page.getByRole("dialog", { name: "连接服务器", exact: true })).toBeVisible();
    await expect(page.locator("#lobby")).toBeHidden();
    expect(attempts).toBe(0);
    await page.locator("#serverAddress").fill(`127.0.0.1:${server.address().port}`);
    await page.locator("#serverAddress").press("Enter");
    await expect.poll(() => requests).toBe(1);
    await expect(page.locator("#serverConnect")).toBeVisible();
    await expect(page.locator("#lobby")).toBeHidden();
    const waiting = {
      code: "TEST-ROOM",
      players: 1,
      capacity: 2,
      phase: "waiting",
      joinable: true,
    };
    peer.send(JSON.stringify({ type: "rooms", rooms: [waiting] }));
    await expect(page.locator("#serverConnect")).toBeHidden();
    await expect(page.getByRole("table", { name: "房间列表" })).toBeVisible();
    await expect(page.locator(".room-list thead th")).toHaveText([
      "房间名",
      "当前游戏状态",
      "玩家人数",
      "操作",
    ]);
    const row = page.locator(".room-card").filter({ hasText: "TEST-ROOM" });
    await expect(row.locator("th")).toHaveText("TEST-ROOM");
    await expect(row.locator(".room-state")).toHaveText("等待玩家");
    await expect(row.locator(".room-players")).toHaveText("1/2");
    await page.getByRole("button", { name: "刷新服务器列表", exact: true }).click();
    await expect.poll(() => requests).toBe(2);
    peer.send(
      JSON.stringify({
        type: "rooms",
        rooms: [{ ...waiting, players: 2, phase: "playing", joinable: false }],
      }),
    );
    await expect(row.locator(".room-state")).toHaveText("对战中");
    await expect(row.locator(".room-players")).toHaveText("2/2");
    await expect(row.getByRole("button")).toBeDisabled();
    peer.close();
    await expect(page.locator("#serverConnect")).toBeVisible();
    await expect(page.locator("#lobby")).toBeHidden();
    await expect(page.locator("#serverStatus")).toContainText("中断");
    await page.locator("#serverAddress").fill("ftp://127.0.0.1");
    await page.locator("#connectServer").click();
    await expect(page.locator("#serverStatus")).toContainText("格式不正确");
    expect(attempts).toBe(1);
    await page.locator("#cancelServer").click();
    await expect(page.locator("#serverConnect")).toBeHidden();
    await openPresentationFixture(page, true);
    await page.locator("#confirmDeployment").click();
    await expect(page.locator("#start")).toBeHidden();
    expect(errors).toEqual([]);
  } finally {
    for (const socket of server.clients) socket.terminate();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("all scenes preview independently; canvas dragging, resizing, history and responsive profiles", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const frame = await openEditor(page);
  const original = await page.evaluate(() => JSON.stringify({ game, phase, selected, battleView }));
  for (const scene of [
    "start",
    "serverConnect",
    "rooms",
    "roomPreparation",
    "formation",
    "deployment",
    "leaveConfirm",
    "map",
    "reaction",
    "battle",
    "help",
    "victory",
  ]) {
    await page.locator("#uie-scene").selectOption(scene);
    if (scene !== "map")
      await expect(
        frame.locator(
          "#" +
            ({ rooms: "lobby", formation: "formationScreen", deployment: "deploymentPanel" }[
              scene
            ] || scene),
        ),
      ).toBeVisible();
    await expect(page.locator("#uie-target option")).not.toHaveCount(0);
  }
  await page.locator("#uie-left-actor").click();
  await expect.poll(() => preview(page, () => GamePreview.boxes.length)).toBe(2);
  // 使用参考框中心拖动机体。先缩小以便左右包围框不会重叠。
  await page.locator("summary").filter({ hasText: "战斗与地图画布参数" }).click();
  await numberField(page, "#uie-b-scale", 0.45);
  await expect.poll(() => preview(page, () => UILayout.battle().scale)).toBe(0.45);
  const actor = await page.locator("#ui-selection").boundingBox();
  await page.mouse.move(actor.x + actor.width / 2, actor.y + actor.height / 2);
  await page.mouse.down();
  await page.mouse.move(actor.x + actor.width / 2 + 50, actor.y + actor.height / 2 + 20, {
    steps: 4,
  });
  await page.mouse.up();
  await expect.poll(() => preview(page, () => UILayout.battle().leftX)).toBeGreaterThan(0.25);
  const moved = await preview(page, () => UILayout.battle().leftX);
  await page.locator("#uie-undo").click();
  expect(await preview(page, () => UILayout.battle().leftX ?? 0.25)).toBe(0.25);
  await page.locator("#uie-redo").click();
  expect(await preview(page, () => UILayout.battle().leftX)).toBe(moved);
  const handle = await page.locator("#ui-resize").boundingBox();
  await page.mouse.move(handle.x + 8, handle.y + 8);
  await page.mouse.down();
  await page.mouse.move(handle.x + 40, handle.y + 40, { steps: 4 });
  await page.mouse.up();
  expect(await preview(page, () => UILayout.battle().leftScale)).toBeGreaterThan(1);
  await page.locator("#uie-size").selectOption("390,844");
  await expect.poll(() => preview(page, () => UILayout.profile())).toBe("mobile");
  await numberField(page, "#uie-b-scale", 0.6);
  expect(await preview(page, () => UILayout.battle().scale)).toBe(0.6);
  await page.locator("#uie-size").selectOption("1440,900");
  await expect.poll(() => preview(page, () => UILayout.battle().scale)).toBe(0.45);
  expect(await page.evaluate(() => JSON.stringify({ game, phase, selected, battleView }))).toBe(
    original,
  );
  await page.locator("#uie-close").click();
  expect(await preview(page, () => GamePreview.suspended)).toBe(true);
  await page.locator("#ui-dev-launch").click();
  await page.locator("#uie-replay").click();
  await expect.poll(() => preview(page, () => GamePreview.progress)).toBeGreaterThan(0.01);
  expect(errors).toEqual([]);
});

test("model, weapon, timeline and results render without playing a match", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const frame = await openEditor(page);
  await page.locator("#uie-scene").selectOption("battle");
  for (const model of ["RGM_79__beam_spray", "RGM_79__machine_gun", "RGM_79__bazooka"]) {
    await page.locator("#uie-left").selectOption(model);
    const weapons = await page
      .locator("#uie-weapon option")
      .evaluateAll((items) => items.map((item) => item.value));
    for (const weapon of weapons) {
      await page.locator("#uie-weapon").selectOption(weapon);
      await page.locator("#uie-progress").fill("0.15");
      await expect.poll(() => preview(page, () => GamePreview.boxes[0]?.unit.model)).toBe(model);
    }
  }
  await page.locator("#uie-result").selectOption("miss");
  await page.locator("#uie-response").selectOption("defend");
  await page.locator("#uie-progress").fill("0.7");
  await expect.poll(() => preview(page, () => GamePreview.events[0].hit)).toBe(false);
  await page.locator("#uie-result").selectOption("kill");
  await page.locator("#uie-progress").fill("1");
  await expect.poll(() => preview(page, () => GamePreview.events[0].after)).toBe(0);
  await expect(frame.locator("#battleInfo")).toContainText("HP 0 /");
  await page.locator("#uie-replay").click();
  await expect.poll(() => preview(page, () => GamePreview.progress)).toBeGreaterThan(0);
  await page.locator("#uie-play").click();
  expect(await preview(page, () => GamePreview.playing)).toBe(false);
  expect(errors).toEqual([]);
});

test("successive misses move from the current lane and remain within the upper and lower bounds", async ({
  page,
}) => {
  await openEditor(page);
  const values = await preview(page, () => {
    GamePreview.configure({
      scene: "battle",
      leftModel: "RGM_79__machine_gun",
      rightModel: "RGM_79__bazooka",
      weapon: "EF_90mmMG",
      response: "defend",
      result: "miss",
      playing: false,
    });
    const event = GamePreview.events[0],
      a = GamePreview.left,
      b = GamePreview.right,
      weapon = getWeapon(a, event.weapon);
    event.strikes = weapon.attack.strikes.map((step, index) => ({
      ...step,
      executed: true,
      hit: false,
      damage: 0,
      dodgeTo: [-1, 0, 1, 0, -1, 0, 1, 0, 1][index],
    }));
    const canvas = byId("battleCanvas"),
      box = canvas.getBoundingClientRect(),
      view = BattleScene.timeline(event, a, b, box.width, box.height),
      ys = [],
      draw = SpriteRenderer.draw;
    SpriteRenderer.draw = function (...args) {
      if (args[0] === canvas.getContext("2d") && args[1] === b.model) ys.push(args[3]);
      return draw(...args);
    };
    const times = [
      0,
      view.plan.moves[1].at - 0.0001,
      view.plan.moves[2].at - 0.0001,
      view.plan.moves[3].at - 0.0001,
      view.plan.duration,
    ];
    try {
      for (const time of times) {
        GamePreview.progress = time / view.plan.duration;
        GamePreview.tick(performance.now());
      }
    } finally {
      SpriteRenderer.draw = draw;
    }
    return {
      ys,
      center: view.target.y,
      distance: view.target.scale * ART.presentation.dodgeDistance,
    };
  });
  expect(values.ys[0]).toBeCloseTo(values.center, 3);
  expect(values.ys[1]).toBeCloseTo(values.center - values.distance, 2);
  expect(values.ys[2]).toBeCloseTo(values.center, 2);
  expect(values.ys[3]).toBeCloseTo(values.center + values.distance, 2);
  expect(values.ys[4]).toBeCloseTo(values.center + values.distance, 2);
});

test("lethal hit plays death explosion once in battle then once on map before showing victory", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await openPresentationFixture(page, false);
  await page.locator("#confirmDeployment").click();
  await page.locator("#confirmDeployment").click();
  await page.evaluate(() => {
    window.deathPlays = { battle: 0, map: 0 };
    window.deathOrder = [];
    const ages = {};
    const draw = SpriteEffects.draw;
    SpriteEffects.draw = function (ctx, id, x, y, scale, age, ...rest) {
      if (id === "Explosion_Ground_1" && age >= 0 && age < ART.effects[id].duration) {
        const scene = ctx === byId("battleCanvas").getContext("2d") ? "battle" : "map";
        if (ages[scene] === undefined || age < ages[scene]) {
          window.deathPlays[scene]++;
          window.deathOrder.push(scene);
        }
        ages[scene] = age;
      }
      return draw(ctx, id, x, y, scale, age, ...rest);
    };
    const a = game.units[0],
      b = game.units.find((u) => u.team === 1);
    game.units = [a, b];
    b.hp = 1;
    b.x = a.x + 2;
    b.y = a.y;
    game.seed = 1;
    beginAttack(a, b, UnitModels[a.model].weapons[0]);
  });
  await page.locator("#responseDefend").click();
  await page.locator("#confirmResponse").click();
  await expect.poll(() => page.evaluate(() => window.deathPlays.battle)).toBe(1);
  expect(await page.evaluate(() => window.deathPlays.map)).toBe(0);
  await page.screenshot({ path: ".openai/death-battle.png" });
  await expect(page.locator("#continueBattle")).toBeEnabled();
  await page.evaluate(() => {
    MapEffects.capture(battleView);
    MapEffects.capture(battleView);
  });
  await returnFromBattle(page);
  await expect(page.locator("#victory")).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.deathPlays.map)).toBe(1);
  await page.screenshot({ path: ".openai/death-map.png" });
  await expect(page.locator("#victory")).toBeVisible();
  expect(await page.evaluate(() => window.deathPlays)).toEqual({ battle: 1, map: 1 });
  expect(await page.evaluate(() => window.deathOrder)).toEqual(["battle", "map"]);
  expect(errors).toEqual([]);
});

test("battle actors stay still between actions and vulcan preserves the held weapon with no animation", async ({
  page,
}) => {
  await openEditor(page);
  await page.locator("#uie-scene").selectOption("battle");
  await page.locator("#uie-response").selectOption("defend");
  await page.locator("#uie-result").selectOption("miss");
  await page.locator("#uie-weapon").selectOption("Common_DoubleVulcan_MS");
  const poses = await preview(page, () => {
    const draw = SpriteRenderer.draw,
      canvas = byId("battleCanvas"),
      calls = [];
    SpriteRenderer.draw = function (...args) {
      if (args[0] === canvas.getContext("2d"))
        calls.push({
          model: args[1],
          clip: args[6],
          time: args[7],
          heldWeapon: args[8],
          loop: args[9],
        });
      return draw(...args);
    };
    try {
      GamePreview.progress = 0.1;
      GamePreview.tick(1000);
      GamePreview.progress = 0.8;
      GamePreview.tick(3000);
    } finally {
      SpriteRenderer.draw = draw;
    }
    return calls;
  });
  expect(poses).toHaveLength(4);
  for (const pose of [poses[0], poses[2]]) {
    expect(pose.clip).toBe(null);
    expect(pose.time).toBe(0);
    expect(pose.loop).toBe(false);
  }
  expect([poses[1], poses[3]].some((pose) => pose.clip === "Common_Dodge_L")).toBe(true);
  expect(poses[0].heldWeapon).toBe("EF_BeamSprayGun");
  expect(poses[2].heldWeapon).toBe("EF_BeamSprayGun");
  const origins = await preview(page, () => {
    const box = byId("battleCanvas").getBoundingClientRect();
    const { plan } = BattleScene.timeline(
      GamePreview.events[0],
      GamePreview.left,
      GamePreview.right,
      box.width,
      box.height,
    );
    return {
      xs: [...new Set(plan.shots.map((s) => s.origin.x))],
      ys: [...new Set(plan.shots.map((s) => s.origin.y))],
    };
  });
  expect(origins.xs).toHaveLength(1);
  expect(origins.ys).toHaveLength(2);
});

test("standalone HTML decodes original weapon OGGs and schedules a single 9-shot burst that skip cancels", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.audioStarts = [];
    window.audioStops = 0;
    window.audioDecoded = [];
    const start = AudioBufferSourceNode.prototype.start,
      stop = AudioBufferSourceNode.prototype.stop,
      decode = AudioContext.prototype.decodeAudioData;
    AudioBufferSourceNode.prototype.start = function (at) {
      window.audioStarts.push({ at, duration: this.buffer?.duration });
      return start.call(this, at);
    };
    AudioBufferSourceNode.prototype.stop = function (...args) {
      window.audioStops++;
      return stop.apply(this, args);
    };
    AudioContext.prototype.decodeAudioData = function (...args) {
      return decode.apply(this, args).then((buffer) => {
        window.audioDecoded.push(buffer.duration);
        return buffer;
      });
    };
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await openPresentationFixture(page, false);
  await page.locator("#confirmDeployment").click();
  await page.locator("#confirmDeployment").click();
  await page.evaluate(() => WeaponAudio.unlock());
  expect(await page.evaluate(() => window.audioDecoded.length)).toBe(
    await page.evaluate(() => Object.keys(ART.sounds).length),
  );
  expect(await page.evaluate(() => window.audioDecoded.every((duration) => duration > 0))).toBe(
    true,
  );
  await page.evaluate(() => {
    const a = game.units.find((u) => u.team === 0 && u.model.endsWith("machine_gun")),
      b = game.units.find((u) => u.team === 1);
    b.x = a.x + 2;
    b.y = a.y;
    game.seed = 1;
    beginAttack(a, b, getWeapon(a, "EF_90mmMG"));
  });
  await page.locator("#responseDefend").click();
  await page.locator("#confirmResponse").click();
  const soundCount = await page.evaluate(() => 9 + battleView.events[0].hitCount);
  expect(soundCount).toBeGreaterThan(9);
  expect(soundCount).toBeLessThan(18);
  await expect.poll(() => page.evaluate(() => window.audioStarts.length)).toBe(soundCount);
  await expect(page.locator("#battleCaption")).toContainText("90mm机枪");
  const starts = await page.evaluate(() => window.audioStarts);
  for (let i = 1; i < 9; i++) expect(starts[i].at - starts[i - 1].at).toBeCloseTo(0.1 / 0.85, 3);
  await page.locator("#skipBattle").click();
  await expect.poll(() => page.evaluate(() => window.audioStops)).toBeGreaterThan(0);
  await returnFromBattle(page);
  expect(await page.evaluate(() => window.audioStarts.length)).toBe(soundCount);
  expect(errors).toEqual([]);
});

test("original projectile textures fire from sampled weapon mounts at each weapon Step", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openEditor(page);
  await page.locator("#uie-scene").selectOption("battle");
  await page.locator("#uie-response").selectOption("defend");
  await page.locator("#uie-right").selectOption("RGM_79__bazooka");
  await page.locator("summary").filter({ hasText: "战斗与地图画布参数" }).click();
  await numberField(page, "#uie-b-scale", 0.55);
  await preview(page, () => {
    const draw = WeaponEffects.draw;
    WeaponEffects.draw = function (ctx, weapon, plan, time, source, event, size) {
      let draws = 0;
      const original = ctx.drawImage;
      ctx.drawImage = function (image, ...args) {
        if (image === SpriteRenderer.images[weapon.projectile?.asset]) draws++;
        return original.call(this, image, ...args);
      };
      try {
        draw(ctx, weapon, plan, time, source, event, size);
      } finally {
        ctx.drawImage = original;
      }
      window.projectileSample = {
        weapon: weapon.id,
        draws,
        shots: plan.shots.length,
        origin: plan.shots[0].origin,
        texture: weapon.projectile?.texture,
      };
    };
  });
  for (const [kit, weapon, count] of [
    ["beam_spray", "EF_BeamSprayGun", 3],
    ["machine_gun", "EF_90mmMG", 9],
    ["bazooka", "EF_HypeBazooka", 2],
    ["beam_spray", "Common_DoubleVulcan_MS", 16],
  ]) {
    await page.locator("#uie-left").selectOption("RGM_79__" + kit);
    await page.locator("#uie-weapon").selectOption(weapon);
    await preview(page, () => {
      const event = GamePreview.events[0],
        box = byId("battleCanvas").getBoundingClientRect();
      const view = BattleScene.timeline(
        event,
        GamePreview.left,
        GamePreview.right,
        box.width,
        box.height,
      );
      const shot = view.plan.shots[0];
      GamePreview.progress = (shot.at + shot.flight / 2) / view.plan.duration;
    });
    await expect
      .poll(() =>
        preview(
          page,
          () =>
            window.projectileSample?.draws > 0 &&
            window.projectileSample.weapon === GamePreview.weapon,
        ),
      )
      .toBe(true);
    const sample = await preview(page, () => window.projectileSample);
    expect(sample.shots).toBe(count);
    expect(sample.texture).toMatch(/\.png$/);
    await page.screenshot({ path: ".openai/weapon-" + weapon + ".png" });
  }
  expect(errors).toEqual([]);
});

test("DOM properties, parent anchors, import, persistence and release export", async ({
  page,
  context,
}) => {
  const frame = await openEditor(page);
  await page.locator("#uie-scene").selectOption("battle");
  await page.locator("#uie-target").selectOption("battleCaption");
  await numberField(page, "#uie-fontSize", 28);
  await expect(frame.locator("#battleCaption")).toHaveCSS("font-size", "28px");
  await page.locator("#uie-anchor").selectOption("parent-top-left");
  await numberField(page, "#uie-x", 15);
  await expect(frame.locator("#battleCaption")).toHaveCSS("position", "absolute");
  await expect(frame.locator("#battleCaption").locator("..")).toHaveCSS("position", "relative");
  await page.locator("#uie-hidden").check();
  await expect(frame.locator("#battleCaption")).toHaveCSS("visibility", "hidden");
  await page.locator("#uie-hidden").uncheck();
  const layoutPromise = page.waitForEvent("download");
  await page.locator("#uie-export").click();
  const download = await layoutPromise;
  const json = await fs.readFile(await download.path(), "utf8");
  expect(JSON.parse(json).profiles.desktop.battleCaption.fontSize).toBe(28);
  await page.locator("#uie-reset").click();
  await page.locator("#uie-file").setInputFiles({
    name: "layout.json",
    mimeType: "application/json",
    buffer: Buffer.from(json),
  });
  await expect(frame.locator("#battleCaption")).toHaveCSS("font-size", "28px");
  const exportPromise = page.waitForEvent("download");
  await page.locator("#uie-publish").click();
  const exported = await exportPromise;
  const html = await fs.readFile(await exported.path(), "utf8");
  expect(html).not.toMatch(
    /ui-editor-panel|ui-preview-source|GamePreview\.configure|slg-ui-layout-dev-v1/,
  );
  const release = await context.newPage();
  const errors = [];
  release.on("pageerror", (e) => errors.push(e.message));
  const exportedPath = path.resolve(".openai/exported-release.html");
  await exported.saveAs(exportedPath);
  await release.goto(pathToFileURL(exportedPath).href);
  await expect(release.locator("#loading")).toContainText("已就绪");
  expect(await release.evaluate(() => UILayout.get().profiles.desktop.battleCaption.fontSize)).toBe(
    28,
  );
  await expect(release.locator("#ui-dev-launch")).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.reload();
  await page.locator("#ui-dev-launch").click();
  await page.waitForFunction(
    () => document.getElementById("ui-preview-frame").contentWindow.GamePreview?.ready,
  );
  expect(await preview(page, () => UILayout.get().profiles.desktop.battleCaption.fontSize)).toBe(
    28,
  );
});

test("release still starts an offline match and uses common battle drawing", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#loading")).toContainText("已就绪");
  await openPresentationFixture(page, false);
  await page.locator("#confirmDeployment").click();
  await page.locator("#confirmDeployment").click();
  await expect(page.locator("#start")).toBeHidden();
  await page.evaluate(() => {
    const left = game.units[0],
      right = game.units[3];
    right.x = left.x + 2;
    right.y = left.y;
    beginAttack(left, right, UnitModels[left.model].weapons[0]);
  });
  await page.locator("#responseDefend").click();
  await page.locator("#confirmResponse").click();
  await expect(page.locator("#battle")).toBeVisible();
  await page.locator("#skipBattle").click();
  await returnFromBattle(page);
  await expect(page.locator("#battle")).toBeHidden();
  expect(errors).toEqual([]);
});

test("standalone developer HTML also opens the isolated editor", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve("public/developer.html")).href);
  await expect(page.locator("#loading")).toContainText("已就绪");
  await page.locator("#ui-dev-launch").click();
  await page.waitForFunction(
    () => document.getElementById("ui-preview-frame").contentWindow.GamePreview?.ready,
  );
  await page.locator("#uie-scene").selectOption("battle");
  await expect.poll(() => preview(page, () => GamePreview.boxes.length)).toBe(2);
  expect(errors).toEqual([]);
});

test("network snapshots keep updating the real match while the preview stays isolated", async ({
  page,
  context,
  baseURL,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/developer.html");
  await expect(page.locator("#loading")).toContainText("已就绪");
  await connectLobby(page, baseURL);
  await page.locator("#roomCode").fill("EDITOR");
  await page.locator("#createRoom").click();
  await expect.poll(() => page.evaluate(() => phase)).toBe("waiting");
  const guest = await context.newPage();
  await guest.goto("/");
  await expect(guest.locator("#loading")).toContainText("已就绪");
  await connectLobby(guest, baseURL);
  await guest
    .locator(".room-card")
    .filter({ hasText: "EDITOR" })
    .getByRole("button", { name: "加入", exact: true })
    .click();
  await readyGame(page, guest);
  await page.locator("#ui-dev-launch").click();
  await page.waitForFunction(
    () => document.getElementById("ui-preview-frame").contentWindow.GamePreview?.ready,
  );
  await page.locator("#uie-scene").selectOption("battle");
  await expect.poll(() => preview(page, () => GamePreview.boxes.length)).toBe(2);
  expect(await preview(page, () => Net.active)).toBe(false);
  const revision = await page.evaluate(() => Net.revision);
  await page.evaluate(() => Net.request("end_turn"));
  await expect.poll(() => guest.evaluate(() => game.team)).toBe(1);
  await guest.evaluate(() => Net.request("end_turn"));
  await expect.poll(() => page.evaluate(() => game.round)).toBe(3);
  expect(await page.evaluate(() => Net.revision)).toBeGreaterThan(revision);
  expect(await preview(page, () => GamePreview.scene)).toBe("battle");
  expect(await preview(page, () => game.round)).toBe(1);
  await page.locator("#uie-close").click();
  await expect(page.locator("#turnBadge")).toContainText("第3回合");
  expect(errors).toEqual([]);
});

test("local HTML plays a complete AI turn with networking disabled and no server", async ({
  page,
  context,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.setOffline(true);
  await page.addInitScript(() => {
    window.networkAttempts = 0;
    window.WebSocket = class {
      static OPEN = 1;
      constructor() {
        window.networkAttempts++;
        throw Error("Offline game attempted a connection");
      }
    };
  });
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await expect(page.locator("#openSkirmish")).toBeVisible();
  await expect(page.locator("#resumeRoom,#leaveNetwork,#joinRoom,#newGame")).toHaveCount(0);
  await page.evaluate(() => LocalRoom.open());
  await page.locator("#startRoomGame").click();
  await page.locator("#confirmFinalFormation").click();
  await page.locator("#confirmDeployment").click();
  await expect(page.locator("#start")).toBeHidden();
  expect(
    await page.evaluate(() => ({
      ai: Net.snapshot.members.some((m) => m.bot),
      online: Net.active && !Net.local,
      attempts: window.networkAttempts,
    })),
  ).toEqual({ ai: true, online: false, attempts: 0 });
  await page.locator("#allies .roster-unit").first().click();
  await expect(page.locator("#unitPanel")).toContainText("吉姆");
  expect(await page.evaluate(() => game.units.filter((u) => u.team === 1).length)).toBe(12);
  expect(await page.evaluate(() => ({ width: Rules.W, height: Rules.H }))).toEqual({
    width: 30,
    height: 18,
  });
  await page.evaluate(() => performMove(game.units[0], 3, 8));
  expect(await page.evaluate(() => game.units[0].moved)).toBe(true);
  await page.locator("#endTurn").click();
  await page.locator("#endTurn").click();
  for (let step = 0; step < 8; step++) {
    await expect
      .poll(() => page.evaluate(() => ["reaction", "battle"].includes(phase) || game.round >= 3), {
        timeout: 15000,
      })
      .toBe(true);
    if (await page.evaluate(() => game.round >= 3)) break;
    if (await page.evaluate(() => phase === "reaction")) {
      await page.locator("#responseDefend").click();
      await page.locator("#confirmResponse").click();
    }
    await page.locator("#skipBattle").click();
    await returnFromBattle(page);
  }
  expect(await page.evaluate(() => game.round)).toBe(3);
  expect(await page.evaluate(() => window.networkAttempts)).toBe(0);
  await leaveGame(page);
  await expect(page.locator("#openSkirmish")).toBeVisible();
  await page.evaluate(() => LocalRoom.open());
  await page.locator("#startRoomGame").click();
  await page.locator("#confirmFinalFormation").click();
  await page.locator("#confirmDeployment").click();
  expect(await page.evaluate(() => game.round)).toBe(1);
  expect(errors).toEqual([]);
});

test("room list updates live; selecting a room joins it, refresh resumes automatically, menu removes it", async ({
  page,
  context,
  baseURL,
}) => {
  const host = page,
    guest = await context.newPage();
  await host.goto("/");
  await guest.goto("/");
  await expect(host.locator("#openRooms")).toBeEnabled();
  await expect(guest.locator("#openRooms")).toBeEnabled();
  await connectLobby(guest, baseURL);
  await expect(guest.locator(".room-card").filter({ hasText: "LISTTEST" })).toHaveCount(0);
  await connectLobby(host, baseURL);
  await host.locator("#roomCode").fill("LISTTEST");
  await host.locator("#createRoom").click();
  const row = guest.locator(".room-card").filter({ hasText: "LISTTEST" });
  await expect(row).toContainText("1/2");
  await row.getByRole("button", { name: "加入", exact: true }).click();
  await readyGame(host, guest);
  const before = await guest.evaluate(() => ({ seat: Net.seat, room: Net.room }));
  await guest.reload();
  await expect.poll(() => guest.evaluate(() => phase)).toBe("idle");
  expect(await guest.evaluate(() => ({ seat: Net.seat, room: Net.room }))).toEqual(before);
  const watcher = await context.newPage();
  await watcher.goto("/");
  await connectLobby(watcher, baseURL);
  await expect(watcher.locator(".room-card").filter({ hasText: "LISTTEST" })).toContainText("2/2");
  await leaveGame(host);
  await expect.poll(() => guest.evaluate(() => Net.active)).toBe(true);
  await expect(watcher.locator(".room-card").filter({ hasText: "LISTTEST" })).toContainText("1/2");
  await leaveGame(guest);
  await expect(watcher.locator(".room-card").filter({ hasText: "LISTTEST" })).toHaveCount(0);
});

test("Menu never draws a battle; leaving requires confirmation and cancels the render loop", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await expect(page.locator("#gameScene")).toBeHidden();
  expect(await page.evaluate(() => ({ view: pageView, frame: animationFrameId }))).toEqual({
    view: "menu",
    frame: null,
  });
  await page.evaluate(() => {
    window.spriteDraws = 0;
    const original = SpriteRenderer.draw;
    SpriteRenderer.draw = (...args) => {
      spriteDraws++;
      return original(...args);
    };
  });
  await openPresentationFixture(page, true);
  await page.locator("#confirmDeployment").click();
  await expect.poll(() => page.evaluate(() => spriteDraws)).toBeGreaterThan(0);
  await page.locator("#netSettings").click();
  await expect(page.getByRole("dialog", { name: "是否离开游戏？" })).toBeVisible();
  await expect(page.locator("#gameScene")).toBeVisible();
  await page.locator("#cancelLeave").click();
  await expect(page.locator("#leaveConfirm")).toBeHidden();
  expect(await page.evaluate(() => pageView)).toBe("game");
  await leaveGame(page);
  expect(
    await page.evaluate(() => ({
      view: pageView,
      frame: animationFrameId,
      battle: battleView,
      selected,
    })),
  ).toEqual({ view: "menu", frame: null, battle: null, selected: null });
  const stopped = await page.evaluate(() => spriteDraws);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect(await page.evaluate(() => spriteDraws)).toBe(stopped);
  await openPresentationFixture(page, false);
  await page.locator("#confirmDeployment").click();
  await page.locator("#confirmDeployment").click();
  await expect(page.locator("#gameScene")).toBeVisible();
  expect(errors).toEqual([]);
});

test("three players prepare, swap spectator/team roles and watch battles without blocking teams", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(45000);
  const first = page,
    second = await context.newPage(),
    third = await context.newPage();
  const errors = [];
  for (const client of [first, second, third])
    client.on("pageerror", (error) => errors.push(error.message));
  await first.goto("/");
  await connectLobby(first, baseURL);
  await first.locator("#roomCode").fill("SEATS");
  await first.locator("#createRoom").click();
  await expect(first.locator("#roomPreparation")).toBeVisible();
  await expect(first.locator("#gameScene")).toBeHidden();
  for (const client of [second, third]) {
    await client.goto("/");
    await connectLobby(client, baseURL);
    await client
      .locator(".room-card")
      .filter({ hasText: "SEATS" })
      .getByRole("button", { name: "加入", exact: true })
      .click();
    await expect(client.locator("#roomPreparation")).toBeVisible();
  }
  expect(await third.evaluate(() => Net.seat)).toBe(null);
  await expect(third.locator("#toggleReady")).toBeHidden();
  await expect(first.locator("#toggleReady")).toBeHidden();
  await expect(second.locator("#teamSlots")).toContainText("房主");
  await first.locator("#becomeSpectator").click();
  await expect(third.locator("#joinTeam1")).toBeEnabled();
  await third.locator("#joinTeam1").click();
  await expect(first.locator("#spectatorSlots")).not.toContainText("（你）");
  expect(await first.evaluate(() => Net.seat)).toBe(null);
  await readyGame(third, second);
  await expect(first.locator("#gameScene")).toBeVisible();
  await expect(first.locator("#endTurn")).toBeDisabled();
  await first.locator("#roomSettings").click();
  await second.locator("#roomSettings").click();
  await second.locator("#becomeSpectator").click();
  await expect(first.locator("#joinTeam2")).toBeEnabled();
  await first.locator("#joinTeam2").click();
  await expect.poll(() => first.evaluate(() => Net.seat)).toBe(1);
  await first.locator("#roomMainMenu").click();
  await second.locator("#roomMainMenu").click();
  await third.evaluate(() => Net.request("move", { unitId: "0-0", x: 5, y: 4 }));
  await expect.poll(() => third.evaluate(() => phase)).toBe("idle");
  await third.evaluate(() =>
    Net.request("attack", { unitId: "0-0", targetId: "1-0", weaponId: "EF_BeamSprayGun" }),
  );
  await finishPlanning([third, first, second]);
  await expect(first.locator("#reaction")).toBeVisible();
  await first.locator("#responseDefend").click();
  await first.locator("#confirmResponse").click();
  await expect(second.locator("#mapCombatControls")).toBeVisible();
  await expect(second.locator("#battle")).toBeHidden();
  // 地图交战播放中打开席位页再返回，继续同一场本地演出。
  await second.locator("#roomSettings").click();
  await expect(second.locator("#roomPreparation")).toBeVisible();
  await second.locator("#roomMainMenu").click();
  await expect(second.locator("#mapCombatControls")).toBeVisible();
  for (const client of [third, first, second]) {
    await client.locator("#mapSkipBattle").evaluate((button) => button.click());
  }
  await expect.poll(() => third.evaluate(() => phase)).toBe("idle");
  await expect(second.locator("#battle")).toBeHidden();
  expect(await second.evaluate(() => Net.seat)).toBe(null);
  await first.locator("#roomSettings").click();
  await first.locator("#roomMainMenu").click();
  await first.locator("#netSettings").click();
  await first.locator("#cancelLeave").click();
  await expect(first.locator("#gameScene")).toBeVisible();
  await leaveGame(first, "#netSettings");
  await expect.poll(() => third.evaluate(() => Net.active)).toBe(true);
  expect(errors).toEqual([]);
});
