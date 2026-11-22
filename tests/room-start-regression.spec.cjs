const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
const { createServer } = require("../server.js");
for (const online of [false, true])
  for (const mode of ["quick", "battlefield", "mission", "sweep"])
    test(`${online ? "online" : "offline"} ${mode} starts through room UI and reaches assembly and deployment`, async ({
      page,
    }) => {
      test.setTimeout(90000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const app = online ? createServer({ host: "127.0.0.1", port: 0 }) : null;
      const address = app ? await app.listen() : null;
      const base = address
        ? "http://127.0.0.1:" + address.port
        : pathToFileURL(path.resolve("public/client.html")).href;
      const idle = () => page.waitForFunction(() => Net.snapshot && !Net.awaiting);
      const act = async (action, fields = {}) => {
        await idle();
        await page.evaluate(({ action, fields }) => Net.request(action, fields), {
          action,
          fields,
        });
        await idle();
      };
      try {
        await page.goto(base);
        await page.waitForFunction(() => assetsReady);
        await page.evaluate(() => {
          I18n.setLanguage("zh");
          Economy.creditActivity({
            id: "start-regression",
            matchId: "start-regression",
            money: 0,
            supplies: 0,
            inventory: { Medea: 3 },
          });
          const stock = Economy.snapshot().storage.ships.find((item) => item.unitId === "Medea");
          localStorage.setItem(
            "slg-formations-v1.PMC",
            JSON.stringify({
              version: 3,
              squads: [
                {
                  name: "Start regression",
                  units: [{ unitId: stock.unitId, kitId: stock.kitId, stockId: stock.id }],
                },
              ],
            }),
          );
          localStorage.setItem("slg-formations-v1.PMC-active", "0");
        });
        await page.reload();
        await page.waitForFunction(() => assetsReady);
        if (online) {
          await page.evaluate((base) => Lobby.reconnect(base), base);
          await expect(page.locator("#lobby")).toBeVisible();
          await page.locator("#createRoom").click();
          await page.locator("#roomCode").fill("START_" + mode.toUpperCase());
          await page.locator("#newRoomMode").selectOption(mode);
          await page.locator('#roomCreateForm button[type="submit"]').click();
          await idle();
          if (["quick", "battlefield"].includes(mode)) await act("add_ai", { seat: 1 });
        } else {
          await page.locator("#openSkirmish").click();
          await page.locator("#createOfflineRoom").click();
          await page.locator("#offlineRoomMode").selectOption(mode);
          await page.locator("#confirmOfflineMode").click();
          await idle();
        }
        if (mode === "mission") await act("configure_room", { mapId: "mission_no_fool" });
        await expect(page.locator("#startRoomGame")).toBeEnabled();
        expect(errors).toEqual([]);
        await page.locator("#startRoomGame").click();
        await expect.poll(() => page.evaluate(() => Net.snapshot.phase)).toBe("assembly");
        await expect(page.locator("#confirmFinalFormation")).toBeVisible();
        await page.locator("#confirmFinalFormation").click();
        if (mode === "sweep") {
          await expect(page.locator("#contractHud")).toBeVisible();
          await page.locator("#contractHud button").filter({hasText:"入场区"}).click();
          await page.locator("#contractHud button").filter({hasText:"事件目标"}).click();
          await expect(page.locator("#contractObjectives .contract-objective")).toHaveCount(1);
          await page.locator("#contractObjectives header button").click();
        }
        await expect.poll(() => page.evaluate(() => Net.snapshot.phase)).toBe("deployment");
        await expect(page.locator("#gameScene")).toBeVisible();
        await expect(page.locator("#confirmDeployment")).toBeVisible();
        expect(errors).toEqual([]);
      } finally {
        await page.evaluate(() => Net.leave()).catch(() => {});
        if (app) await app.close();
      }
    });
