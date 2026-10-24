const { waitForRoomSettings } = require("./room-settings-fixture.cjs");
const { test, expect } = require("@playwright/test");
const { createServer } = require("../server.js");
const WebSocket = require("ws");
async function lobby(page, port, name) {
  await page.goto("http://127.0.0.1:" + port);
  await page.locator("#playerId").fill(name);
  await page.locator("#openSkirmish").click();
  await page.locator("#openRooms").click();
  await page.locator("#serverAddress").fill("127.0.0.1:" + port);
  await page.locator("#connectServer").click();
  await expect(page.locator("#lobby")).toBeVisible();
}
async function say(page, channel, text, prefix = "roomChat") {
  await page.locator("#" + prefix + "Channel").selectOption(channel);
  await page.locator("#" + prefix + "Input").fill(text);
  await page.locator("#" + prefix + "Send").click();
  await expect(page.locator("#" + prefix + "Lines")).toContainText(text);
}
test("lineup buttons, three-column observers and shared room/game channel permissions", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  const app = createServer({ port: 0, host: "127.0.0.1" }),
    address = await app.listen();
  const red = await context.newPage(),
    observer = await context.newPage(),
    peers = [],
    errors = [];
  for (const p of [page, red, observer]) p.on("pageerror", (e) => errors.push(e.message));
  try {
    await lobby(page, address.port, "GoldHost");
    await page.locator("#roomCode").fill("LINEUP");
    await page.locator("#createRoom").click();
    for (const [p, name] of [
      [red, "BlueRed"],
      [observer, "Watcher"],
    ]) {
      await lobby(p, address.port, name);
      await p.locator(".room-card").filter({ hasText: "LINEUP" }).getByRole("button").click();
      await expect(p.locator("#roomPreparation")).toBeVisible();
    }
    await expect(page.locator(".lineup-header").first()).toHaveText("玩家ID/空位出生地准备状态");
    expect(
      await page
        .locator(".spawn-slot")
        .first()
        .evaluate((e) => e.children.length),
    ).toBe(3);
    await expect(observer.locator("#joinTeam2")).toBeDisabled();
    await red.locator("#becomeSpectator").click();
    await expect(observer.locator("#joinTeam2")).toBeEnabled();
    await observer.locator("#joinTeam2").click();
    await expect.poll(() => observer.evaluate(() => Net.seat)).toBe(1);
    await expect(observer.locator("#joinTeam2")).toHaveText("当前队伍2");
    for (let i = 0; i < 5; i++) {
      const ws = new WebSocket("ws://127.0.0.1:" + address.port + "/ws");
      peers.push(ws);
      await new Promise((resolve, reject) => {
        ws.on("error", reject);
        ws.on("open", () =>
          ws.send(
            JSON.stringify({ type: "hello", mode: "join", room: "LINEUP", name: "Watcher" + i }),
          ),
        );
        ws.on("message", (d) => {
          if (JSON.parse(d).type === "state") resolve();
        });
      });
    }
    await expect(page.locator(".spectator-slot")).toHaveCount(6);
    const boxes = await page.locator(".spectator-slot").evaluateAll((es) =>
      es.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y };
      }),
    );
    expect(new Set(boxes.map((b) => Math.round(b.x))).size).toBe(3);
    expect(new Set(boxes.map((b) => Math.round(b.y))).size).toBe(2);
    await say(page, "team1", "<b>TEAM ONE SECRET</b>");
    await red.locator("#roomChatChannel").selectOption("team1");
    await expect(red.locator("#roomChatLines")).toContainText("<b>TEAM ONE SECRET</b>");
    await expect(red.locator("#roomChatLines b")).toHaveCount(0);
    await expect(red.locator("#roomChatInput")).toBeDisabled();
    expect(
      await observer.locator("#roomChatChannel option").evaluateAll((es) => es.map((e) => e.value)),
    ).toEqual(["all", "team2"]);
    await say(observer, "team2", "TEAM TWO SECRET");
    await red.locator("#roomChatChannel").selectOption("team2");
    await expect(red.locator("#roomChatLines")).toContainText("TEAM TWO SECRET");
    await say(red, "spectators", "OBSERVER SECRET");
    expect(
      await page.evaluate(() => Net.snapshot.chat.some((m) => m.text === "OBSERVER SECRET")),
    ).toBe(false);
    await page.locator("#toggleReady").click();
    await observer.locator("#toggleReady").click();
    await page.locator("#confirmFinalFormation").click();
    await observer.locator("#confirmFinalFormation").click();
    await expect(page.locator("#confirmDeployment")).toBeVisible();
    await page.locator("#showChat").click();
    await expect(page.locator("#chatChannel")).toHaveValue("team1");
    await expect(page.locator("#chatLines")).toContainText("TEAM ONE SECRET");
    await say(page, "all", "IN GAME PUBLIC", "chat");
    await red.locator("#showChat").click();
    await red.locator("#chatChannel").selectOption("all");
    await expect(red.locator("#chatLines")).toContainText("IN GAME PUBLIC");
    await page.locator("#roomSettings").click();
    await expect(page.locator("#roomChatChannel")).toHaveValue("all");
    await expect(page.locator("#roomChatLines")).toContainText("IN GAME PUBLIC");
    await page.screenshot({ path: ".openai/lineup-chat-desktop.png" });
    await page.setViewportSize({ width: 430, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: ".openai/lineup-chat-mobile.png" });
    expect(errors).toEqual([]);
  } finally {
    peers.forEach((ws) => ws.terminate());
    await red.close();
    await observer.close();
    await page.close();
    await app.close();
  }
});

test("offline join buttons move the host into a free team spawn", async ({ page }) => {
  const { pathToFileURL } = require("node:url"),
    path = require("node:path");
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await page.locator("#roomMapSelect").selectOption("crossroads_2v2");
  await waitForRoomSettings(page);
  await expect(page.locator("#joinTeam2")).toBeEnabled();
  await page.locator("#joinTeam2").click();
  await expect.poll(() => page.evaluate(() => Net.seat)).toBe(3);
  await expect(page.locator('.spawn-slot[data-seat="3"] .lineup-name > strong')).toHaveClass(
    /player-host/,
  );
  await page.locator("#becomeSpectator").click();
  await page.locator("#joinTeam1").click();
  await expect.poll(() => page.evaluate(() => Net.seat)).toBe(0);
  await expect(page.locator("#roomMapSelect")).toBeEnabled();
  await expect(page.locator("#roomChatChannel option")).toHaveCount(2);
});
