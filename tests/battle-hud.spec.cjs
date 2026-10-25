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

test("attack cards and every queued attack forecast armor using the same reaction estimates", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fixture(page);
  const expected = await page.evaluate(() => {
    const attacker = game.units[0],
      target = game.units[2];
    select(attacker.id);
    AttackControls.start(attacker);
    AttackControls.choose(attacker, target);
    const weapon = Rules.modelOf(attacker).weapons.find((w) => w.id === "EF_90mmMG");
    const estimate = Rules.estimate(game, attacker, target, weapon);
    return { damage: estimate.damage, hit: Math.round(estimate.hit * 10) / 10, raw: weapon.damage };
  });
  assert.ok(expected.damage < expected.raw, "armor must reduce the displayed damage");
  const card = page.locator('[data-queue-weapon="EF_90mmMG"]');
  const read = async (locator) =>
    locator.evaluate((el) => ({ damage: Number(el.dataset.damage), hit: Number(el.dataset.hit) }));
  assert.deepEqual(await read(card.locator(".attack-forecast")), {
    damage: expected.damage,
    hit: expected.hit,
  });
  await card.click();
  const extra = await page.evaluate(() => {
    const attacker = game.units[0],
      target = game.units[2];
    const weapon = Rules.modelOf(attacker).weapons.find(
      (w) =>
        w.slot !== "skill" &&
        Rules.actionCost(w) === 1 &&
        Rules.canAttack(game, attacker, target, w),
    );
    return { id: weapon.id, forecast: attackForecast(attacker, target, weapon) };
  });
  await page.locator('[data-queue-weapon="' + extra.id + '"]').click();
  await page.locator('[data-queue-weapon="' + extra.id + '"]').click();
  assert.deepEqual(
    await page
      .locator(".hud-attack-queue .attack-forecast")
      .evaluateAll((elements) =>
        elements.map((el) => ({ damage: Number(el.dataset.damage), hit: Number(el.dataset.hit) })),
      ),
    [{ damage: expected.damage, hit: expected.hit }, extra.forecast, extra.forecast],
  );
  const combined = await page.evaluate(() =>
    attackForecast(game.units[0], game.units[2], [
      getWeapon(game.units[0], "EF_90mmMG"),
      ...Array(2).fill(Rules.modelOf(game.units[0]).weapons.find((w) => Rules.actionCost(w) === 1)),
    ]),
  );
  await page.locator("#confirmAttackQueue").click();
  assert.equal(await page.evaluate(() => phase), "reaction");
  assert.equal(
    await page.locator(".incoming-forecast").first().textContent(),
    `${combined.hit}% · ${combined.damage.toLocaleString("en-US")}`,
  );
  await page.locator("#responseDefend").click();
  const defending = await page.evaluate(() => {
    const entry = pending.counterTargets?.[0] || pending;
    return attackForecast(
      getUnit(entry.attacker),
      getUnit(pending.target),
      entry.weapons.map((id) => getWeapon(getUnit(entry.attacker), id)),
      "defend",
    );
  });
  assert.ok(defending.damage < combined.damage);
  assert.equal(
    await page.locator(".incoming-forecast").first().textContent(),
    `${defending.hit}% · ${defending.damage.toLocaleString("en-US")}`,
  );
  assert.deepEqual(errors, []);
});

test("counter editor adds different and repeated weapons, enforces total AP and plays every counter", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fixture(page);
  await page.evaluate(() => {
    const a = game.units[0],
      b = game.units[2];
    a.hp = b.hp = 1000000;
    beginAttack(a, b, getWeapon(a, "EF_90mmMG"));
  });
  const mg = page.locator('[data-add-counter-weapon="EF_90mmMG"]'),
    vulcan = page.locator('[data-add-counter-weapon="Common_DoubleVulcan_MS"]');
  await vulcan.click();
  assert.equal(await page.locator("#counterQueue > .actions").count(), 2);
  assert.ok(await mg.isDisabled());
  assert.ok(await vulcan.isDisabled());
  assert.ok((await page.locator("#counterActionPoints").textContent()).includes("0/4"));
  await page.locator("#clearCounterQueue").click();
  for (let i = 0; i < 4; i++) await vulcan.click();
  assert.equal(await page.locator("#counterQueue > .actions").count(), 4);
  assert.ok(await vulcan.isDisabled());
  await page.locator("#clearCounterQueue").click();
  assert.ok(await page.locator("#clearCounterQueue").isDisabled());
  assert.equal(await page.locator("[data-remove-counter-weapon]").count(), 0);
  assert.ok(await page.locator("#confirmResponse").isDisabled());
  await mg.click();
  await vulcan.click();
  await page.locator("#confirmResponse").click();
  assert.deepEqual(
    await page.evaluate(() =>
      battleView.events.filter((e) => e.from === game.units[2].id).map((e) => e.weapon),
    ),
    ["EF_90mmMG", "Common_DoubleVulcan_MS"],
  );
  assert.equal(await page.evaluate(() => game.units[2].counterCount), 1);
  assert.deepEqual(errors, []);
});

test("attack editor and independent response columns clear the whole draft", async ({
  page,
}) => {
  page.setDefaultTimeout(6000);
  const scrollSurfaces = (root) =>
    [root, ...root.querySelectorAll("*")]
      .filter(
        (el) =>
          el.getClientRects().length &&
          ["auto", "scroll"].includes(getComputedStyle(el).overflowY) &&
          el.scrollHeight > el.clientHeight + 1,
      )
      .map((el) => el.id || el.className);
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await fixture(page);
    await page.evaluate(() => {
      const a = game.units[0],
        b = game.units[2];
      select(a.id);
      AttackControls.start(a);
      AttackControls.choose(a, b);
    });
    assert.deepEqual(await page.locator("#hudUnitPanel").evaluate(scrollSurfaces), [
      "hudAttackPlanner",
    ]);
    const weapon = page.locator('[data-queue-weapon="Common_DoubleVulcan_MS"]');
    await weapon.click();
    await weapon.click();
    assert.equal(await page.locator(".hud-attack-queue > .actions").count(), 2);
    assert.equal(await page.locator("[data-remove-queue-weapon]").count(), 0);
    await page.locator("#clearAttackQueue").click();
    assert.equal(await page.locator(".hud-attack-queue > .actions").count(), 0);
    assert.ok(await page.locator("#confirmAttackQueue").isDisabled());
    assert.ok(await page.locator("#clearAttackQueue").isDisabled());
    await weapon.click();
    await page.locator("#confirmAttackQueue").click();
    const surfaces = await page.locator("#reaction").evaluate(scrollSurfaces);
    assert(surfaces.includes("response-side response-defender"));
    assert(surfaces.every(name => name.includes("response-side")));
    const scrollCheck = await page.locator("#reaction").evaluate(root => {
      const left=root.querySelector('.response-attacker'), right=root.querySelector('.response-defender');
      const before={top:left.getBoundingClientRect().top,scroll:left.scrollTop};
      right.scrollTop=right.scrollHeight;
      return {before,after:{top:left.getBoundingClientRect().top,scroll:left.scrollTop},right:right.scrollTop,root:root.scrollTop};
    });
    assert.deepEqual(scrollCheck.before,scrollCheck.after);
    assert(scrollCheck.right>0);assert.equal(scrollCheck.root,0);
    await page.locator("#clearCounterQueue").click();
    assert.equal(await page.locator("#counterQueue > .actions").count(), 0);
    assert.ok(await page.locator("#confirmResponse").isDisabled());
    await page.locator('[data-add-counter-weapon="Common_DoubleVulcan_MS"]').click();
    assert.equal(await page.locator("#counterQueue > .actions").count(), 1);
    await page.locator("#reaction").evaluate((el) => {
      el.scrollTop = 0;
    });
    if (viewport.width === 1366) {
      // The shared scroll surface must not swallow clicks on a map target between the columns.
      const target = await page.evaluate(() => {
        const a = game.units[0],
          extra = game.units[1];
        Object.assign(extra, { x: a.x + 1, y: a.y });
        const base = { ...pending, attacker: a.id };
        pending.counterTargets = [base, { ...base, attacker: extra.id }];
        renderReaction();
        return extra.id;
      });
      await clickCell(page, 11, 10);
      assert.equal(await page.evaluate(() => counterTargetId), target);
    }
    await page.screenshot({ path: `.openai/response-single-scroll-${viewport.width}.png` });
  }
});

test("keyboard commands reuse buttons and ignore editable fields", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => select(game.units[0].id));
  await page.keyboard.press("q");
  assert.equal(await page.evaluate(() => mode), "move");
  await page.keyboard.press("Escape");
  await page.keyboard.press("w");
  assert.equal(await page.evaluate(() => mode), "attack-target");
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.id = "shortcutTest";
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press("q");
  assert.equal(await page.evaluate(() => mode), "select");
  await page.locator("#shortcutTest").evaluate((e) => e.remove());
  await page.keyboard.press("v");
  assert.equal(await page.evaluate(() => game.units[0].acted), true);
});

test("ship attack outlines share the damage eligibility set", async ({ page }) => {
  await fixture(page);
  const result = await page.evaluate(() => {
    const ship = game.units[0],
      target = game.units.find((u) => u.team !== ship.team);
    ship.model = "SalamisClass__standard";
    ship.angle = 0;
    ship.moduleHp = Object.fromEntries(Rules.modelOf(ship).modules.map((m) => [m.id, m.hp]));
    Object.assign(target, { x: 10, y: 5 });
    const weapon = Rules.modelOf(ship).weapons.find((w) => w.moduleIds?.length > 2);
    selected = ship.id;
    weaponId = weapon.id;
    ship.plan = { target: target.id, weapon: weapon.id };
    const valid = Rules.availableStrikes(ship, weapon, target);
    ship.moduleHp[valid[0].moduleId] = 0;
    ship.brokenParts = { [valid[0].moduleId]: true };
    const original = SpriteRenderer.draw;
    let status;
    SpriteRenderer.draw = (...args) => {
      if (args[1] === ship.model) status = args.at(-1);
      original(...args);
    };
    update();
    MapCamera.focus(10, 9, { preserveZoom: true });
    drawMap(performance.now());
    SpriteRenderer.draw = original;
    const expected = Rules.availableStrikes(ship, weapon, target).map((s) => s.moduleId);
    const forecast = Rules.estimate(game, ship, target, weapon);
    const filtered = Rules.estimate(game, ship, target, {
      ...weapon,
      attack: {
        ...weapon.attack,
        strikes: weapon.attack.strikes.filter((s) => expected.includes(s.moduleId)),
      },
    });
    return { status, expected, damage: forecast.damage, filteredDamage: filtered.damage };
  });
  assert(Object.values(result.status).includes(true));
  assert(Object.values(result.status).includes(false));
  assert.deepEqual(
    Object.keys(result.status)
      .filter((k) => result.status[k])
      .sort(),
    [...new Set(result.expected)].sort(),
  );
  assert.equal(result.damage, result.filteredDamage);
  await page.screenshot({ path: ".openai/ship-turret-outlines.png" });
});


test("battle nickname applies only on the second button click",async({page})=>{
 await fixture(page);await page.evaluate(()=>{select(game.units[0].id);BattleHUD.setTab('overview');});
 const before=await page.evaluate(()=>unitName(game.units[0]));
 await page.locator('#editBattleUnitName').click();await page.locator('#battleUnitNameInput').fill('新昵称');
 assert.equal(await page.evaluate(()=>unitName(game.units[0])),before);
 await page.locator('#editBattleUnitName').click();
 assert.equal(await page.evaluate(()=>unitName(game.units[0])),'新昵称');
});


test("50 percent zoom renders occupancy thumbnails and restores sprites above the threshold",async({page})=>{
 await fixture(page);
 const result=await page.evaluate(()=>{
  game.units[0].model='SalamisClass__standard';
  const original=SpriteRenderer.draw;let calls=0;SpriteRenderer.draw=(...args)=>{calls++;return original(...args)};
  MapCamera.setZoom(.1);drawMap(performance.now());
  const small={zoom:MapCamera.zoom,mode:byId('map').dataset.unitThumbnails,calls};
  calls=0;MapCamera.setZoom(.6);drawMap(performance.now());
  const large={mode:byId('map').dataset.unitThumbnails,calls};
  SpriteRenderer.draw=original;MapCamera.setZoom(.5);drawMap(performance.now());
  return {small,large};
 });
 assert.deepEqual(result.small,{zoom:.5,mode:'true',calls:0});assert.equal(result.large.mode,'false');assert(result.large.calls>0);
 await page.screenshot({path:'.openai/map-thumbnails.png'});
});


test("counter targets switch from list and map and clear the entire incompatible queue", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    const a=game.units[0], extra=game.units[1], b=game.units[2];
    Object.assign(extra,{x:11,y:10});
    pending={id:"switch-test",attacker:a.id,target:b.id,weapon:"EF_90mmMG",
      counterTargets:[a,extra].map(u=>({attacker:u.id,weapon:"EF_90mmMG"}))};
    phase="reaction"; response="counter"; counterTargetId=a.id; counterId="EF_90mmMG";
    counterDraftState={key:pending.id,session,ids:["EF_90mmMG","Common_DoubleVulcan_MS"]};
    renderReaction();
    byId("reaction").hidden=false;
    update();
  });
  await page.locator('.incoming-entry[data-unit-id="0-1"]').click();
  assert.deepEqual(await page.evaluate(()=>[counterTargetId,counterDraftState.ids]),["0-1",[]]);
  assert.ok(await page.locator('#confirmResponse').isDisabled());
  await page.locator('[data-add-counter-weapon="Common_DoubleVulcan_MS"]').click();
  await clickCell(page,10,10);
  assert.deepEqual(await page.evaluate(()=>[counterTargetId,counterDraftState.ids]),["0-0",["Common_DoubleVulcan_MS"]]);
  await page.locator('[data-add-counter-weapon="EF_90mmMG"]').click();
  await clickCell(page,11,10);
  assert.deepEqual(await page.evaluate(()=>[counterTargetId,counterDraftState.ids]),["0-1",[]]);
});


test("dodge position persists through counter delay and into gunfire", async ({ page }) => {
  await fixture(page);
  const result=await page.evaluate(()=>{
    const a=game.units[0], b=game.units[2], w=Rules.modelOf(a).weapons.find(w=>w.id==="EF_90mmMG");
    const actors=JSON.parse(JSON.stringify([a,b]));
    const events=Rules.fight(game,a,b,w,"counter",w.id);
    if(events.length!==2) throw Error("counter fixture missing");
    for(const strike of events[0].strikes) Object.assign(strike,{hit:false,damage:0,shieldDamage:0,dodgeTo:1});
    Object.assign(events[0],{hit:false,damage:0,targetDodgeEnd:1,after:events[0].before});
    events[1].sourceDodgeSlot=0;
    const record={id:"dodge-transition",actors,events,before:Object.fromEntries(actors.map(u=>[u.id,u.hp]))};
    MapCombat.reset();MapCombat.seed([record]);
    battleView={battles:[record],mapBattle:true};phase="battle";
    MapCombat.begin(battleView,()=>0.5);
    const now=performance.now()+600;MapCombat.update(now);
    const f=MapCombat.frames[0];f.time=f.plan.duration;f.lastNow=now;
    const before=MapCombat.units().find(u=>u.id===b.id).mapPose;
    MapCombat.update(now);
    const waiting=MapCombat.units().find(u=>u.id===b.id).mapPose;
    MapCombat.update(now+501);
    const firing=MapCombat.units().find(u=>u.id===b.id).mapPose;
    return {before:{x:before.x,y:before.y},waiting:{x:waiting.x,y:waiting.y},firing:{x:firing.x,y:firing.y}};
  });
  assert.deepEqual(result.waiting,result.before);
  assert.deepEqual(result.firing,result.before);
});


test("reaction map gap allows wheel zoom while response columns keep their own scrolling", async ({page})=>{
  await fixture(page);
  await page.evaluate(()=>{
    const a=game.units[0],b=game.units[2];
    beginAttack(a,b,getWeapon(a,"EF_90mmMG"));
  });
  const gap=await page.evaluate(()=>{
    const left=byId("reaction").querySelector(".response-attacker").getBoundingClientRect();
    const right=byId("reaction").querySelector(".response-defender").getBoundingClientRect();
    return {x:(left.right+right.left)/2,y:Math.max(left.top,right.top)+90,zoom:MapCamera.zoom};
  });
  await page.mouse.move(gap.x,gap.y);
  await page.mouse.wheel(0,-300);
  await page.waitForFunction(z=>MapCamera.zoom>z,gap.zoom);
  const zoom=await page.evaluate(()=>MapCamera.zoom);
  await page.locator(".response-defender").hover();
  await page.mouse.wheel(0,300);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(()=>MapCamera.zoom),zoom);
});
