const { test } = require("@playwright/test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
async function fixture(page) {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.evaluate(async () => {
    await SpriteRenderer.load();
    I18n.setLanguage("zh");
    LocalRoom.open();
    await new Promise((r) => setTimeout(r, 0));
    window.weakBaseline = structuredClone(Net.snapshot);
    Net.leave();
    window.weakSent = [];
    window.weakSocket = {
      readyState: WebSocket.OPEN,
      send: (raw) => weakSent.push(JSON.parse(raw)),
      close() {
        this.readyState = 3;
      },
    };
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    Net.beginLocal(weakSocket);
    Net.local = false;
    Net.memberId = weakBaseline.you.id;
    Net.receive(structuredClone(weakBaseline), weakSocket);
  });
}
test("late own acknowledgments cannot be replaced by teammate updates; foreground events request just one sync", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fixture(page);
  const result = await page.evaluate(() => {
    Net.request("set_ready", { ready: true, formation: Formation.current() });
    const request = Net.awaiting.id;
    Net.receive(
      { ...structuredClone(weakBaseline), revision: Net.revision + 1, ack: "other-player-action" },
      weakSocket,
    );
    const afterTeammate = Net.awaiting?.id;
    Net.receive({ type: "error", id: "unrelated-request", message: "other response" }, weakSocket);
    const afterOtherError = Net.awaiting?.id;
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    const whileAwaiting = weakSent.filter((m) => m.action === "sync").length;
    Net.receive(
      { ...structuredClone(weakBaseline), revision: Net.revision + 1, ack: request },
      weakSocket,
    );
    const afterOwn = Net.awaiting;
    for (let i = 0; i < 3; i++) {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("resume"));
    }
    return {
      request,
      afterTeammate,
      afterOtherError,
      whileAwaiting,
      afterOwn,
      syncs: weakSent.filter((m) => m.action === "sync").length,
    };
  });
  assert.equal(result.afterTeammate, result.request);
  assert.equal(result.afterOtherError, result.request);
  assert.equal(result.whileAwaiting, 0);
  assert.equal(result.afterOwn, null);
  assert.equal(result.syncs, 1);
  assert.deepEqual(errors, []);
});
test("slow responses get fifteen seconds before recovery and an old timer cannot sync a new connection", async ({
  page,
}) => {
  await fixture(page);
  await page.clock.install();
  await page.evaluate(() =>
    Net.request("set_ready", { ready: true, formation: Formation.current() }),
  );
  await page.clock.fastForward(8001);
  assert.ok(await page.evaluate(() => !!Net.awaiting));
  assert.equal(await page.evaluate(() => weakSent.filter((m) => m.action === "sync").length), 0);
  await page.clock.fastForward(7000);
  assert.equal(await page.evaluate(() => Net.awaiting), null);
  assert.equal(await page.evaluate(() => weakSent.filter((m) => m.action === "sync").length), 1);
  await page.evaluate(() => {
    Net.request("set_ready", { ready: true, formation: Formation.current() });
    window.replacementSent = [];
    Net.socket = {
      readyState: WebSocket.OPEN,
      send: (raw) => replacementSent.push(JSON.parse(raw)),
      close() {},
    };
  });
  await page.clock.fastForward(15001);
  assert.equal(
    await page.evaluate(() => replacementSent.filter((m) => m.action === "sync").length),
    0,
  );
});

test("abandon reconnect closes modal and forgets the session", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    Net.serverURL = "ws://127.0.0.1:1313/ws";
    Net.room = "ABANDON";
    sessionStorage.setItem("slg-last", JSON.stringify({ url: Net.serverURL, room: Net.room }));
    Net.connecting = true;
    byId("disconnectDialog").showModal();
  });
  await page.locator("#abandonReconnect").click();
  assert.deepEqual(
    await page.evaluate(() => ({
      active: Net.active,
      connecting: Net.connecting,
      open: byId("disconnectDialog").open,
      page: pageView,
      last: sessionStorage.getItem("slg-last"),
    })),
    { active: false, connecting: false, open: false, page: "menu", last: null },
  );
});
