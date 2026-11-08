const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;
for (const width of [1920, 820, 390])
  test(
    "single-column carrier formation with compact five-button actions / " + width,
    async ({ page }) => {
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1080 });
      await page.addInitScript(() => {
        localStorage.setItem(
          "slg-formations-v1.PMC",
          JSON.stringify({
            version: 3,
            squads: [
              {
                name: "Compact carriers",
                units: [
                  { unitId: "Medea", kitId: "standard" },
                  {
                    unitId: "Type61",
                    kitId: "standard",
                    preload: { carrierIndex: 0, hangarId: "Hangar_1" },
                  },
                  { unitId: "MS_06F", kitId: "machine_gun" },
                ],
              },
            ],
          }),
        );
        localStorage.setItem("projectgreed.combatFaction", "PMC");
      });
      await page.goto(url);
      await page.waitForFunction(() => assetsReady);
      await page.evaluate(() => {
        I18n.setLanguage("zh");
        Formation.open();
      });
      const geometry = await page.evaluate(() =>
        [...document.querySelectorAll("#formationUnits > .formation-row")].map((row) => {
          const r = row.getBoundingClientRect(),
            buttons = [...row.querySelectorAll(".formation-row-actions > button")].map((b) => {
              const a = b.getBoundingClientRect();
              return { bottom: a.bottom, right: a.right, height: a.height };
            });
          return {
            top: r.top,
            left: r.left,
            right: r.right,
            bottom: r.bottom,
            height: r.height,
            buttons,
          };
        }),
      );
      expect(geometry).toHaveLength(3);
      expect(geometry[1].top).toBeGreaterThan(geometry[0].top);
      expect(geometry[1].left - geometry[0].left).toBeGreaterThan(10);
      expect(geometry[2].left).toBe(geometry[0].left);
      for (const r of geometry) {
        expect(r.buttons).toHaveLength(5);
        for (const b of r.buttons) {
          expect(b.bottom).toBeLessThanOrEqual(r.bottom + 1);
          expect(b.right).toBeLessThanOrEqual(r.right + 1);
          expect(b.height).toBeGreaterThanOrEqual(20);
        }
      }
      expect(await page.locator("#customPilotBackground").count()).toBe(0);
      await page.locator('[data-formation-index="2"] .formation-kit-button').click();
      await expect(page.locator(".formation-kit-dialog")).toBeVisible();
      const second = page.locator(".formation-kit-options button").nth(1),
        kit = await second.getAttribute("data-kit-id");
      await second.click();
      expect(await page.evaluate(() => Formation.current()[2].kitId)).toBe(kit);
      await page.screenshot({
        path: "tmp/verification/screenshots/formation-one-column-" + width + ".png",
      });
      expect(errors).toEqual([]);
    },
  );
test("local logs survive reload, append without duplication and retain ten matches", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto(url);
  await page.waitForFunction(() => assetsReady);
  const first = await page.evaluate(async () => {
    const log = Array.from(
      { length: 14000 },
      (_, i) => "战报 " + i + " " + "单位移动与战场对话".repeat(20),
    );
    const snapshot = {
      matchId: "archive-long",
      started: true,
      phase: "idle",
      you: { seat: 0 },
      settings: { mapId: "frontier_1v1" },
      logExport: { perspective: "team:0" },
      log,
    };
    LocalRecords.receive(snapshot);
    await LocalRecords.flush();
    const first = (await LocalRecords.list())[0];
    LocalRecords.receive(snapshot);
    await LocalRecords.flush();
    const again = (await LocalRecords.list())[0];
    snapshot.log = ["新增一行", ...log];
    LocalRecords.receive(snapshot);
    await LocalRecords.flush();
    const last = (await LocalRecords.list())[0];
    return { first, again, last, preferences: LocalRecords.preferences };
  });
  expect(first.first.bytes).toBeGreaterThan(5 * 1024 * 1024);
  expect(first.again.bytes).toBe(first.first.bytes);
  expect(first.last.count).toBe(14001);
  expect(first.preferences.autoLog).toBe(true);
  expect(first.preferences.autoReplay).toBe(false);
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  expect((await page.evaluate(() => LocalRecords.list()))[0].count).toBe(14001);
  await page.evaluate(async () => {
    for (let i = 0; i < 11; i++) {
      LocalRecords.receive({
        matchId: "archive-" + i,
        started: true,
        phase: "idle",
        you: { seat: 0 },
        settings: { mapId: "frontier_1v1" },
        logExport: { perspective: "team:0" },
        log: ["新对局 " + i],
      });
      await LocalRecords.flush();
    }
  });
  const remaining = await page.evaluate(() => LocalRecords.list());
  expect(new Set(remaining.map((m) => m.matchId)).size).toBe(10);
  expect(remaining.some((m) => m.matchId === "archive-long")).toBe(false);
  await page.locator("#shellSettings").click();
  await page.locator('[data-settings-tab="records"]').click();
  await page.locator("#openLocalRecords").click();
  await expect(page.locator("#localRecordsDialog .local-record-row")).toHaveCount(10);
});
test("battlefield ready warns about two chassis reserves and cancellation preserves formation", async ({
  page,
}) => {
  await page.goto(url);
  await page.waitForFunction(() => assetsReady);
  await page.locator("#shellSettings").waitFor({ state: "visible" });
  await page.evaluate(() => {
    I18n.setLanguage("zh");
    Net.snapshot = { settings: { mode: "battlefield" } };
    window.reserveProceeded = false;
    Formation.checkLicenses(
      Array.from({ length: Economy.quantity("Type61") - 1 }, () => ({
        unitId: "Type61",
        kitId: "standard",
      })),
      () => (window.reserveProceeded = true),
    );
  });
  await expect(
    page.getByText("以下单位没有预备库存，确定要准备吗？", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).last().click();
  expect(await page.evaluate(() => window.reserveProceeded)).toBe(false);
});

test("generated atlas resolves once and renders a detailed encounter preview", async ({ page }) => {
  await page.goto(url);
  await page.waitForFunction(() => assetsReady);
  await page.locator("#shellSettings").waitFor({ state: "visible" });
  const result = await page.evaluate(async () => {
    let ready;
    const loaded = new Promise((resolve) => (ready = resolve)),
      painter = TileMapView.create({ changed: () => ready() });
    painter.image("asset:biome-tropical");
    await loaded;
    const image = painter.image("asset:biome-tropical");
    if (!image?.naturalWidth) throw Error("Biome atlas was not loaded");
    const canvas = document.createElement("canvas");
    canvas.id = "biomeMapPreview";
    canvas.width = 1000;
    canvas.height = 660;
    canvas.style.cssText = "position:fixed;inset:0;margin:auto;z-index:100000;background:#14202b";
    document.body.append(canvas);
    const map = Rules.getMap("serpentine_rainforest_3v3");
    painter.draw(canvas.getContext("2d"), map.tileMap, "below", {
      ox: 0,
      oy: 0,
      cellWidth: 1000 / map.width,
      cellHeight: 660 / map.height,
      width: 1000,
      height: 660,
    });
    const data = canvas.getContext("2d").getImageData(0, 0, 1000, 660).data,
      colors = new Set();
    for (let i = 0; i < data.length; i += 400)
      colors.add(data[i] + "," + data[i + 1] + "," + data[i + 2]);
    return { width: image.width, colors: colors.size };
  });
  expect(result.width).toBe(1254);
  expect(result.colors).toBeGreaterThan(300);
  await page
    .locator("#biomeMapPreview")
    .screenshot({ path: "tmp/verification/screenshots/encounter-rainforest-biomes.png" });
});
test("team marker panel chooses a type and sends the selected tile to the team channel", async ({
  page,
}) => {
  await page.goto(url);
  await page.waitForFunction(() => assetsReady);
  await page.locator("#shellSettings").waitFor({ state: "visible" });
  const sent = await page.evaluate(() => {
    const s = { matchId: "marker-test", started: true, you: { seat: 0 }, chat: [] };
    Net.snapshot = s;
    Net.seat = 0;
    TeamMarkers.snapshot(s);
    const original = Net.sendChat;
    let sent;
    Net.sendChat = (...args) => (sent = args);
    document.querySelector(".team-marker-controls > button").click();
    document.querySelector('[data-kind="defend"]').click();
    TeamMarkers.click({ x: 4, y: 7 });
    Net.sendChat = original;
    const m = {
      id: "marker-message",
      memberId: "ally",
      name: "队友",
      text: "防守 E8",
      channel: "team1",
      at: Date.now(),
      marker: { kind: "defend", x: 4, y: 7, matchId: "marker-test" },
    };
    const played = [],
      play = GameAudio.play;
    GameAudio.play = (name) => played.push(name);
    Chat.receive(m);
    TeamMarkers.receive(m);
    GameAudio.play = play;
    return { sent, played, hidden: document.querySelector(".team-marker-choices").hidden };
  });
  expect(sent.sent[2]).toBe("team1");
  expect(sent.sent[3]).toEqual({ kind: "defend", x: 4, y: 7 });
  expect(sent.played).toContain("infoSound");
  expect(sent.hidden).toBe(true);
});
