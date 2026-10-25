const { waitForRoomReturn } = require("./room-return-fixture.cjs");
const { test } = require("@playwright/test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");

async function fixture(page) {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.evaluate(async () => {
    await SpriteRenderer.load();
    I18n.setLanguage("zh");
    Net.leave();
    TurnFlow.reset();
    session++;
    AttackControls.reset();
    MapCombat.reset();
    const entry = { unitId: "RGM_79", kitId: "machine_gun" };
    game = Rules.create(
      false,
      1,
      [
        [entry, entry],
        [entry, entry],
      ],
      false,
      { costLimit: 99999, unitCostLimit: 10000 },
    );
    game.tiles.forEach((row) => row.fill("plain"));
    game.units.forEach((u, i) => Object.assign(u, { x: i < 2 ? 10 : 12, y: i % 2 ? 14 : 10 }));
    selected = weaponId = pending = battleView = moving = null;
    mode = "select";
    phase = "idle";
    setPageView("game");
    MapCamera.focus(11, 11, { preserveZoom: true });
    update();
    drawMap(performance.now());
    Chat.setLog(["[蓝方][Player01]吉姆：确认攻击计划", "[红方][AI 1]老虎：部位破坏：左臂"]);
  });
}
async function clickCell(page, x, y) {
  const point = await page.evaluate(
    ({ x, y }) => {
      drawMap(performance.now());
      const r = byId("map").getBoundingClientRect();
      return {
        x: r.left + mapGeo.ox + (x + 0.5) * mapGeo.tile,
        y: r.top + mapGeo.oy + (y + 0.5) * mapGeo.tile,
      };
    },
    { x, y },
  );
  await page.mouse.click(point.x, point.y);
}

test("map fills the battle stage and unit inspection is contextual", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await fixture(page);
  const idle = await page.evaluate(() => ({
    width: byId("map").clientWidth,
    height: byId("map").clientHeight,
    panel: byId("hudUnitPanel").hidden,
    roster: byId("hudRosterPanel").hidden,
  }));
  assert.equal(idle.width, 1920);
  assert.ok(idle.height > 800);
  assert.ok(idle.panel && idle.roster);
  await clickCell(page, 10, 10);
  let state = await page.evaluate(() => {
    drawMap(performance.now());
    return {
      selected,
      panel: byId("hudUnitPanel").hidden,
      commands: byId("hudUnitCommands").hidden,
      range: Number(byId("map").dataset.attackRangeCells),
      bars: document.querySelectorAll(".hud-resource-track").length,
    };
  });
  assert.equal(state.selected, "0-0");
  assert.equal(state.panel, true);
  assert.equal(state.commands, false);
  assert.equal(state.bars, 2);
  assert.ok(state.range > 0);
  await page.locator('[data-unit-command="info"]').click();
  assert.equal(await page.evaluate(() => byId("hudUnitPanel").hidden), false);
  await page.evaluate(() => select(game.units[1].id));
  assert.equal(await page.evaluate(() => byId("hudUnitPanel").hidden), false);
  await page.locator('[data-unit-command="info"]').click();
  await page.evaluate(() => select(game.units[0].id));
  assert.deepEqual(
    await page.evaluate(() => [
      selected,
      byId("hudUnitPanel").hidden,
      byId("hudUnitCommands").hidden,
    ]),
    ["0-0", true, false],
  );
  await page.evaluate(() => byId("hudSelectionSummary").click());
  assert.equal(await page.evaluate(() => byId("hudUnitPanel").hidden), false);
  await page.screenshot({ path: ".openai/hud-selected.png" });
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => selected), null);
  assert.deepEqual(errors, []);
});

test("floating movement and target-first weapon commands reuse existing actions", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fixture(page);
  await clickCell(page, 10, 10);
  await page.evaluate(() => document.querySelector('[data-unit-command="move"]').click());
  assert.equal(await page.evaluate(() => mode), "move");
  await page.evaluate(async () => {
    drawMap(performance.now());
    const r = byId("map").getBoundingClientRect();
    await byId("map").onclick({
      clientX: r.left + mapGeo.ox + 11.5 * mapGeo.tile,
      clientY: r.top + mapGeo.oy + 10.5 * mapGeo.tile,
    });
  });
  assert.deepEqual(
    await page.evaluate(() => [
      game.units[0].x,
      game.units[0].moved,
      mode,
      byId("hudUnitCommands").hidden,
      document.querySelector('[data-unit-command="move"]').textContent,
    ]),
    [11, true, "select", false, "撤回移动"],
  );
  await page.evaluate(() => document.querySelector('[data-unit-command="move"]').click());
  assert.deepEqual(await page.evaluate(() => [game.units[0].x, game.units[0].moved]), [10, false]);
  await page.evaluate(() => document.querySelector('[data-unit-command="attack"]').click());
  assert.equal(await page.evaluate(() => byId("hudUnitPanel").hidden), true);
  assert.equal(await page.evaluate(() => byId("hudCancelAction").textContent), "取消攻击");
  await clickCell(page, 12, 10);
  assert.equal(await page.evaluate(() => mode), "attack-weapons");
  assert.equal(
    await page.evaluate(() => byId("attackEditor").parentElement.id),
    "hudAttackPlanner",
  );
  assert.equal(await page.evaluate(() => byId("hudUnitPanel").hidden), false);
  assert.equal(
    await page.evaluate(() => byId("hudAttackPlanner").parentElement.id),
    "hudUnitPanel",
  );
  await page.screenshot({ path: ".openai/hud-attack-planner.png" });
  await page.evaluate(() => document.querySelector('[data-queue-weapon="EF_90mmMG"]').click());
  assert.ok((await page.evaluate(() => byId("attackQueueBudget").textContent)).includes("3 AP"));
  await page.evaluate(() => byId("confirmAttackQueue").click());
  const reaction = await page.evaluate(() => ({
    phase,
    panel: byId("hudUnitPanel").hidden,
    commands: byId("hudUnitCommands").hidden,
    reaction: byId("reaction").hidden,
  }));
  assert.deepEqual(reaction, { phase: "reaction", panel: true, commands: true, reaction: false });
  await page.screenshot({ path: ".openai/hud-reaction.png" });
  assert.deepEqual(errors, []);
});

test("bottom dock keeps chat, logs, roster and turn actions accessible", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => byId("showChat").click());
  assert.equal(await page.evaluate(() => byId("chatPanel").hidden), false);
  await page.evaluate(() => byId("showLog").click());
  assert.ok((await page.evaluate(() => byId("log").textContent)).includes("部位破坏"));
  const height = await page.evaluate(() => byId("map").clientHeight);
  await page.evaluate(() => byId("hudCollapseConsole").click());
  assert.ok((await page.evaluate(() => byId("map").clientHeight)) > height);
  await page.evaluate(() => byId("showLog").click());
  assert.equal(await page.evaluate(() => byId("gameScene").dataset.consoleSize), "normal");
  await page.evaluate(() => byId("hudExpandConsole").click());
  assert.ok((await page.evaluate(() => byId("map").clientHeight)) < height);
  await page.evaluate(() => byId("hudToggleRoster").click());
  assert.equal(await page.evaluate(() => byId("hudRosterPanel").hidden), false);
  await page.evaluate(() => document.querySelector("#allies .roster-unit").click());
  assert.equal(await page.evaluate(() => byId("hudRosterPanel").hidden), true);
  assert.equal(await page.evaluate(() => byId("endTurn").parentElement.id), "hudTurnActions");
  await page.evaluate(() => setPageView("room"));
  assert.equal(await page.evaluate(() => byId("musicPlayer").parentElement.id), "");
  assert.equal(
    await page.evaluate(() => document.body.classList.contains("battle-hud-active")),
    false,
  );
});

test("laptop and phone keep the map full width and floating panels within the viewport", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await fixture(page);
    await clickCell(page, 10, 10);
    await page.locator('[data-unit-command="info"]').click();
    const result = await page.evaluate(() => {
      const box = (id) => byId(id).getBoundingClientRect().toJSON();
      return {
        settingsInHeader:
          byId("openClientSettings").parentElement ===
          document.querySelector("#gameScene .header-buttons"),
        settings: box("openClientSettings"),
        menu: box("netSettings"),
        status: document.querySelector(".hud-room-status").getBoundingClientRect().toJSON(),
        nav: document.querySelector("#gameScene > header").getBoundingClientRect().toJSON(),
        brand: document.querySelector("#gameScene .brand").getBoundingClientRect().toJSON(),
        buttons: document
          .querySelector("#gameScene .header-buttons")
          .getBoundingClientRect()
          .toJSON(),
        round: byId("turnBadge").getBoundingClientRect().toJSON(),
        map: box("map"),
        panel: box("hudUnitPanel"),
        commands: box("hudUnitCommands"),
        turn: box("endTurn"),
        zoom: document.querySelector(".map-camera-controls").getBoundingClientRect().toJSON(),
        dock: document.querySelector(".log").getBoundingClientRect().toJSON(),
        scroll: document.documentElement.scrollWidth,
      };
    });
    assert.ok(result.status.top >= result.nav.top);
    assert.ok(result.status.bottom <= result.nav.bottom);
    assert.ok(result.status.left >= result.brand.right);
    assert.ok(result.status.right <= result.buttons.left);
    assert.ok(result.round.right <= viewport.width);
    assert.ok(result.round.bottom <= result.status.bottom);
    assert.ok(
      result.turn.right <= result.zoom.left ||
        result.turn.bottom <= result.zoom.top ||
        result.turn.top >= result.zoom.bottom,
    );
    assert.ok(result.settingsInHeader);
    assert.equal(result.settings.top, result.menu.top);
    assert.equal(result.settings.height, result.menu.height);
    assert.ok(result.settings.right <= viewport.width);
    assert.equal(Math.round(result.map.width), viewport.width);
    assert.ok(result.map.height > viewport.height * 0.68);
    assert.ok(result.panel.right <= viewport.width && result.panel.left >= 0);
    assert.ok(result.panel.bottom <= result.dock.top);
    assert.ok(result.commands.right <= viewport.width && result.commands.left >= 0);
    assert.ok(result.commands.bottom <= result.dock.top);
    assert.equal(result.scroll, viewport.width);
    await page.screenshot({
      path: viewport.width === 390 ? ".openai/hud-phone.png" : ".openai/hud-laptop.png",
    });
  }
  assert.deepEqual(errors, []);
});

test("offline room uses the same dock through final assembly, deployment and return to room", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.evaluate(async () => {
    await SpriteRenderer.load();
    LocalRoom.open();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.deepEqual(await page.evaluate(() => [Net.active, Net.local, pageView]), [
    true,
    true,
    "room",
  ]);
  await page.evaluate(async () => {
    Net.request("start_game", { formation: [{ unitId: "RGM_79", kitId: "machine_gun" }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.equal(await page.evaluate(() => Net.snapshot.phase), "assembly");
  await page.evaluate(async () => {
    byId("confirmFinalFormation").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const state = await page.evaluate(() => ({
    phase,
    pageView,
    control: byId("confirmDeployment").parentElement.id,
    visible: !byId("confirmDeployment").hidden,
    topCentered: (() => {
      const button = byId("confirmDeployment").getBoundingClientRect(),
        map = byId("map").getBoundingClientRect();
      return (
        Math.abs(button.left + button.width / 2 - map.left - map.width / 2) < 1 &&
        Math.abs(button.top - map.top - 12) < 1
      );
    })(),
  }));
  assert.deepEqual(state, {
    phase: "deployment",
    pageView: "game",
    control: "hudTurnActions",
    visible: true,
    topCentered: true,
  });
  assert.deepEqual(
    await page.evaluate(() => [
      byId("hudRoomName").textContent,
      byId("hudPing").textContent,
      byId("hudPlayerCount").textContent,
    ]),
    ["房间名: 离线遭遇战", "PING 离线", "玩家人数: 2/2"],
  );
  const own = await page.evaluate(() => {
    const unit = game.units.find((u) => Net.owns(u));
    return { x: unit.x, y: unit.y };
  });
  await clickCell(page, own.x, own.y);
  assert.equal(await page.evaluate(() => byId("hudUnitPanel").hidden), true);
  await page.locator('[data-unit-command="info"]').click();
  assert.equal(await page.evaluate(() => byId("hudUnitPanel").hidden), false);
  await page.evaluate(async () => {
    byId("confirmDeployment").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.equal(await page.evaluate(() => phase), "idle");
  await page.evaluate(async () => {
    const unit = game.units.find((u) => Net.owns(u));
    select(unit.id);
    document.querySelector('[data-unit-command="move"]').click();
    const cell = [...Rules.reachable(game, unit).values()].find(
      (c) => c.cost > 0 && !game.units.some((u) => u.hp > 0 && u.x === c.x && u.y === c.y),
    );
    if (!cell) throw Error("No reachable destination");
    await performMove(unit, cell.x, cell.y);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.deepEqual(
    await page.evaluate(() => [mode, getUnit(selected).moved, byId("hudUnitCommands").hidden]),
    ["select", true, false],
  );
  await page.evaluate(async () => {
    Net.request("return_room", { matchId: Net.snapshot.matchId });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await waitForRoomReturn(page);
  assert.equal(await page.evaluate(() => pageView), "room");
  assert.equal(await page.evaluate(() => byId("openClientSettings").parentElement.tagName), "BODY");
  assert.equal(
    await page.evaluate(() => document.body.classList.contains("battle-hud-active")),
    false,
  );
  await page.evaluate(() => Net.leave());
  assert.deepEqual(errors, []);
});

test("map clicks cannot move or attack before an explicit command, and cancellation preserves resources", async ({
  page,
}) => {
  await fixture(page);
  await clickCell(page, 10, 10);
  await clickCell(page, 11, 10);
  assert.deepEqual(
    await page.evaluate(() => [game.units[0].x, game.units[0].y, game.units[0].moved]),
    [10, 10, false],
  );
  await clickCell(page, 10, 10);
  await clickCell(page, 12, 10);
  assert.deepEqual(
    await page.evaluate(() => [mode, selected, !!AttackControls.draft(game.units[0])]),
    ["select", "1-0", false],
  );
  await clickCell(page, 10, 10);
  await page.locator('[data-unit-command="info"]').click();
  const before = await page.evaluate(() =>
    JSON.stringify({
      x: game.units[0].x,
      y: game.units[0].y,
      en: game.units[0].en,
      ap: game.units[0].actionPoints,
      moved: game.units[0].moved,
      plan: game.units[0].plan,
    }),
  );
  const mapHeight = await page.evaluate(() => byId("map").clientHeight);
  await page.evaluate(() => document.querySelector('[data-unit-command="move"]').click());
  assert.deepEqual(
    await page.evaluate(() => [mode, byId("hudUnitPanel").hidden, byId("hudActionBand").hidden]),
    ["move", true, false],
  );
  const cancelLayout = await page.evaluate(() => ({
    map: byId("map").getBoundingClientRect().toJSON(),
    button: byId("hudCancelAction").getBoundingClientRect().toJSON(),
    container: byId("hudActionBand").getBoundingClientRect().toJSON(),
    label: byId("hudCancelAction").textContent,
    parent: byId("hudActionBand").parentElement.id,
    turn: byId("endTurn").getBoundingClientRect().toJSON(),
  }));
  assert.equal(cancelLayout.map.height, mapHeight);
  assert.equal(cancelLayout.parent, "mapWrap");
  assert.equal(cancelLayout.label, "取消移动");
  assert.ok(
    Math.abs(
      (cancelLayout.button.left + cancelLayout.button.right) / 2 -
        (cancelLayout.map.left + cancelLayout.map.right) / 2,
    ) < 1,
  );
  assert.ok(cancelLayout.button.bottom <= cancelLayout.map.bottom - 10);
  assert.equal(cancelLayout.container.width, cancelLayout.button.width);
  assert.ok(
    Math.abs(
      (cancelLayout.turn.left + cancelLayout.turn.right) / 2 -
        (cancelLayout.button.left + cancelLayout.button.right) / 2,
    ) < 1,
  );
  assert.ok(cancelLayout.turn.top >= cancelLayout.map.top + 10);
  await page.screenshot({ path: ".openai/hud-floating-cancel.png" });
  await page.evaluate(() => byId("hudCancelAction").click());
  assert.deepEqual(await page.evaluate(() => [mode, selected, byId("hudUnitPanel").hidden]), [
    "select",
    "0-0",
    false,
  ]);
  await page.evaluate(() => document.querySelector('[data-unit-command="attack"]').click());
  await clickCell(page, 12, 10);
  await page.evaluate(() => document.querySelector('[data-queue-weapon="EF_90mmMG"]').click());
  assert.ok(
    (await page.evaluate(() => byId("hudAttackPlanner").textContent)).includes("当前攻击计划"),
  );
  await page.evaluate(() => byId("hudCancelAction").click());
  assert.equal(await page.evaluate(() => AttackControls.draft(game.units[0])), null);
  assert.equal(await page.evaluate(() => byId("hudAttackPlanner").hidden), true);
  assert.equal(await page.evaluate(() => byId("hudUnitPanel").hidden), false);
  const after = await page.evaluate(() =>
    JSON.stringify({
      x: game.units[0].x,
      y: game.units[0].y,
      en: game.units[0].en,
      ap: game.units[0].actionPoints,
      moved: game.units[0].moved,
      plan: game.units[0].plan,
    }),
  );
  assert.equal(after, before);
  await page.evaluate(() => document.querySelector('[data-unit-command="move"]').click());
  await page.keyboard.press("Escape");
  assert.deepEqual(await page.evaluate(() => [mode, selected]), ["select", "0-0"]);
});

test("terrain badges and chat compose as full-width rows, with a right-side planner on small screens", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await fixture(page);
    const info = await page.evaluate(() => {
      const box = (id) => byId(id).getBoundingClientRect().toJSON();
      byId("hoverInfo").textContent = "K11 · 平地 · 蓝方 吉姆 · 远战命中 -0% / 近战命中 -0%";
      byId("showChat").click();
      return {
        badge: box("mapEnvironment"),
        terrain: box("hoverInfo"),
        chat: box("chatPanel"),
        form: box("chatForm"),
        input: box("chatInput"),
        channel: box("chatChannel"),
        dock: document.querySelector(".log").getBoundingClientRect().toJSON(),
      };
    });
    assert.ok(info.terrain.left >= info.badge.right);
    assert.ok(Math.abs(info.terrain.top - info.badge.top) < 8);
    assert.ok(info.form.width > info.chat.width * 0.9);
    assert.ok(info.input.width > viewport.width * 0.4);
    assert.ok(info.channel.width >= 80);
    assert.ok(info.dock.height >= (viewport.width === 390 ? 165 : 158));
    await page.screenshot({
      path: viewport.width === 390 ? ".openai/hud-chat-phone.png" : ".openai/hud-chat-laptop.png",
    });
    await clickCell(page, 10, 10);
    await page.evaluate(() => document.querySelector('[data-unit-command="attack"]').click());
    await clickCell(page, 12, 10);
    const plan = await page.evaluate(() => ({
      hidden: byId("hudAttackPlanner").hidden,
      parent: byId("hudAttackPlanner").parentElement.id,
      rect: byId("hudAttackPlanner").getBoundingClientRect().toJSON(),
      confirm: byId("confirmAttackQueue").getBoundingClientRect().toJSON(),
      bandTop: byId("hudActionBand").getBoundingClientRect().top,
    }));
    assert.equal(plan.hidden, false);
    assert.equal(plan.parent, "hudUnitPanel");
    assert.ok(plan.rect.bottom <= plan.bandTop);
    assert.ok(plan.rect.left >= 0 && plan.rect.right <= viewport.width);
    assert.ok(plan.confirm.bottom <= plan.rect.bottom && plan.confirm.top >= plan.rect.top);
    await page.screenshot({
      path: viewport.width === 390 ? ".openai/hud-plan-phone.png" : ".openai/hud-plan-laptop.png",
    });
  }
  assert.deepEqual(errors, []);
});

test("unit commands stay in a horizontal row at the screen right above the message dock", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await fixture(page);
  await clickCell(page, 10, 10);
  await page.locator('[data-unit-command="info"]').click();
  const measure = () =>
    page.evaluate(() => {
      const row = byId("hudUnitCommands").getBoundingClientRect(),
        dock = document.querySelector(".log").getBoundingClientRect();
      return {
        right: row.right,
        left: row.left,
        top: row.top,
        bottom: row.bottom,
        dockTop: dock.top,
        direction: getComputedStyle(byId("unitActions")).flexDirection,
        panelBottom: byId("hudUnitPanel").getBoundingClientRect().bottom,
      };
    });
  const before = await measure();
  assert.equal(before.right, 1354);
  assert.equal(before.direction, "row");
  assert.ok(before.bottom <= before.dockTop);
  assert.ok(before.panelBottom <= before.top);
  await page.evaluate(() => {
    select(game.units[1].id);
    MapCamera.setZoom(3);
    MapCamera.focus(15, 15, { preserveZoom: true });
    drawMap(performance.now());
  });
  const after = await measure();
  assert.equal(after.right, before.right);
  assert.equal(after.top, before.top);
  assert.equal(after.left, before.left);
  await page.screenshot({ path: ".openai/hud-fixed-command-row.png" });
});

test("room status measures a real WebSocket ping and counts connected seats and spectators", async ({
  page,
}) => {
  const { WebSocketServer } = require("ws");
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((resolve) => server.once("listening", resolve));
  server.on("connection", (socket) =>
    socket.on("message", (raw) => {
      if (JSON.parse(raw).type === "ping") socket.send(JSON.stringify({ type: "pong" }));
    }),
  );
  try {
    await fixture(page);
    const result = await page.evaluate(async (port) => {
      Net.active = true;
      Net.local = Net.manual = false;
      Net.memberId = "test-player";
      Net.snapshot = {
        room: "状态测试房间",
        connected: [true, true, false, false],
        members: [
          { seat: 0, connected: true },
          { seat: 1, connected: true, bot: true },
          { seat: 2, connected: false },
          { seat: null, connected: true },
        ],
      };
      BattleHUD.refreshRoomStatus();
      const before = byId("hudPing").textContent;
      await new Promise((resolve, reject) => {
        const socket = (Net.socket = new WebSocket("ws://127.0.0.1:" + port));
        socket.onerror = reject;
        socket.onmessage = ({ data }) => {
          const message = JSON.parse(data);
          Net.receive(message, socket);
          if (message.type === "pong") resolve();
        };
        socket.onopen = () => window.dispatchEvent(new Event("focus"));
      });
      const result = {
        before,
        ping: Net.pingMs,
        label: byId("hudPing").textContent,
        room: byId("hudRoomName").textContent,
        players: byId("hudPlayerCount").textContent,
      };
      Net.leave();
      return result;
    }, server.address().port);
    assert.equal(result.before, "PING —");
    assert.ok(Number.isInteger(result.ping) && result.ping >= 0);
    assert.equal(result.label, "PING " + result.ping + " ms");
    assert.equal(result.room, "房间名: 状态测试房间");
    assert.equal(result.players, "玩家人数: 2/4 · 观战玩家: 1");
  } finally {
    for (const socket of server.clients) socket.terminate();
    await new Promise((resolve) => server.close(resolve));
  }
});
