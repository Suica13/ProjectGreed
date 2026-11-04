const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
const { createServer } = require("../server.js");
const fileURL = pathToFileURL(path.resolve("public/client.html")).href;
const addresses = ["64.83.48.234:1313", "126.227.168.176:1313"];
async function open(page) {
  await page.locator("#openSkirmish").click();
  await page.locator("#openRooms").click();
}
async function noVisibleIPs(page) {
  const visible = await page.locator("body").innerText();
  for (const address of addresses) expect(visible).not.toContain(address);
  expect(await page.locator("#serverAddress").inputValue()).toBe("");
}

test("preset status probes are independent, refreshable, and preset connections never show their IP", async ({
  page,
}, testInfo) => {
  const online = [true, false], counts = [17,5],
    messages = [];
  for (let i = 0; i < addresses.length; i++)
    await page.routeWebSocket("ws://" + addresses[i] + "/ws", (ws) => {
      if (!online[i]) {
        ws.close();
        return;
      }
      ws.onMessage((raw) => {
        const message = JSON.parse(raw);
        messages.push(message.type);
        if (message.type === "list_rooms")
          setTimeout(()=>ws.send(JSON.stringify({ type: "rooms", rooms: [], onlinePlayers: counts[i] })),35);
        if (message.type === "ping")
          setTimeout(()=>ws.send(JSON.stringify({ type: "pong", onlinePlayers: counts[i] })),35);
      });
    });
  await page.goto(fileURL);
  await open(page);
  await expect(page.locator("#preset-status-primary")).toHaveText("在线");
  await expect(page.locator("#preset-status-test")).toHaveText("离线");
  await expect(page.locator("#preset-primary2")).toHaveCount(0);
  await expect(page.locator("#preset-players-primary")).toHaveText("17");
  await expect(page.locator("#preset-ping-primary")).toHaveText(/\d+ ms/);
  await noVisibleIPs(page);
  await page.screenshot({ path: testInfo.outputPath("server-presets.png") });
  await expect(page.locator("#lobby")).toBeHidden();
  expect(messages.every((type) => type === "list_rooms")).toBe(true);
  await page.locator("#preset-primary").click();
  await expect(page.locator("#lobby")).toBeVisible();
  await expect(page.locator("#connectedServer")).toHaveText("主要服务器");
  await expect(page.locator("#connectedOnlinePlayers")).toHaveText("17");
  await expect(page.locator("#connectedServerPing")).toHaveText(/\d+ ms/);
  counts[0]=18;
  await expect(page.locator("#connectedOnlinePlayers")).toHaveText("18",{timeout:7000});
  expect(await page.evaluate(() => Lobby.endpoint())).toBe("ws://" + addresses[0] + "/ws");
  await noVisibleIPs(page);
  await page.evaluate(() => Lobby.open());
  online[1] = true;
  await page.locator("#refreshServerStatus").click();
  await expect(page.locator("#preset-status-test")).toHaveText("在线");
  await page.locator("#preset-test").click();
  await expect(page.locator("#connectedServer")).toHaveText("测试服务器");
  expect(await page.evaluate(() => Lobby.endpoint())).toBe("ws://" + addresses[1] + "/ws");
  await noVisibleIPs(page);
});

test("silent sockets time out; closing the dialog cancels probes and preserves custom-address connection", async ({
  page,
}) => {
  const app = createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen();
  let active = 0;
  for (const host of addresses)
    await page.routeWebSocket("ws://" + host + "/ws", (ws) => {
      active++;
      ws.onClose(() => {
        active--;
      });
    });
  try {
    await page.goto(fileURL);
    await open(page);
    await expect(page.locator("#preset-status-primary")).toHaveText("离线", { timeout: 6000 });
    await expect(page.locator("#preset-status-test")).toHaveText("离线");
    await expect.poll(() => active).toBe(0);
    await page.locator("#refreshServerStatus").click();
    await expect.poll(() => active).toBe(addresses.length);
    await page.locator("#cancelServer").click();
    await expect.poll(() => active).toBe(0);
    await open(page);
    await page.locator("#serverAddress").fill("127.0.0.1:" + address.port);
    await page.locator("#connectServer").click();
    await expect(page.locator("#lobby")).toBeVisible();
    await expect.poll(() => active).toBe(0);
    await page.locator("#createRoom").click();
    await page.locator("#roomCode").fill("CUSTOM");
    await page.locator('#roomCreateForm button[type="submit"]').click();
    await expect(page.locator("#roomPreparation")).toBeVisible();
    expect(app.rooms.get("CUSTOM").members.size).toBe(1);
  } finally {
    await page.evaluate(() => Net.leave());
    await app.close();
  }
});

test("remembered preset addresses remain hidden and do not populate the custom IP box", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem(
      "slg-last",
      JSON.stringify({ url: "ws://64.83.48.234:1313/ws", room: "PRIOR" }),
    ),
  );
  for (const host of addresses)
    await page.routeWebSocket("ws://" + host + "/ws", (ws) => ws.close());
  await page.goto(fileURL);
  await open(page);
  await noVisibleIPs(page);
  await page.setViewportSize({ width: 430, height: 900 });
  await expect(page.locator("#preset-primary")).toBeVisible();
  await expect(page.locator("#preset-test")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
