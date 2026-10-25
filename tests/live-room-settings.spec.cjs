const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
const { createServer } = require("../server.js");
const url = pathToFileURL(path.resolve("public/client.html")).href;

test("map, count, COST and room/team bans apply automatically without confirmation", async ({
  page,
}) => {
  await page.goto(url);
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await page.locator("#roomCostLimit").fill("4000");
  await page.locator("#roomUnitCostLimit").fill("750");
  await page.locator("#roomFogMode").selectOption("visible");
  await expect.poll(() => page.evaluate(() => Net.snapshot.settings.fogMode)).toBe("visible");
  const preview = await page.evaluate(() => {
    byId("roomMapSelect").value = "frontline_3v3";
    byId("roomMapSelect").dispatchEvent(new Event("change"));
    return { text: byId("roomMapInfo").textContent, selected: byId("roomMapSelect").value };
  });
  expect(preview.text).toContain("林海战线");
  expect(preview.selected).toBe("frontline_3v3");
  await expect.poll(() => page.evaluate(() => Net.snapshot.settings.mapId)).toBe("frontline_3v3");
  await expect
    .poll(() =>
      page.evaluate(() => [Net.snapshot.settings.costLimit, Net.snapshot.settings.unitCostLimit]),
    )
    .toEqual([4000, 750]);
  await expect(page.locator("#roomCostLimit")).toHaveValue("4000");
  await expect(page.locator("#roomUnitCostLimit")).toHaveValue("750");
  await page.locator("#roomBan-bannedFactions").selectOption("ZEON");
  await expect
    .poll(() => page.evaluate(() => Net.snapshot.settings.bannedFactions))
    .toEqual(["ZEON"]);
  await page.locator("#roomUnitLimit").fill("6");
  await expect.poll(() => page.evaluate(() => Net.snapshot.settings.unitLimit)).toBe(6);
  await page.locator(".team-filters").first().locator("summary").click();
  await page.locator("#teamBan-0-bannedEras").selectOption("0079");
  await expect
    .poll(() => page.evaluate(() => Net.snapshot.settings.teamRestrictions[0].bannedEras))
    .toEqual(["0079"]);
  await expect(page.locator("#teamBanSummary0")).toContainText("0079");
  await expect(page.locator("#teamBan-0-bannedFactions")).toBeVisible();
  await expect(page.locator('[id^="applyTeamRestrictions"]')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => [Net.snapshot.settings.costLimit, Net.snapshot.settings.unitCostLimit]),
    )
    .toEqual([4000, 750]);
  await expect(page.locator("#roomCostLimit")).toHaveValue("4000");
  await expect(page.locator("#applyRoomSettings")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => [Net.snapshot.settings.costLimit, Net.snapshot.settings.unitCostLimit]),
    )
    .toEqual([4000, 750]);
  expect(await page.evaluate(() => Net.snapshot.settings.mapId)).toBe("frontline_3v3");
  await page.locator("#roomCostLimit").fill("");
  await page.locator("#roomMapSelect").selectOption("frontier_1v1");
  await expect.poll(() => page.evaluate(() => Net.snapshot.settings.mapId)).toBe("frontier_1v1");
  await expect(page.locator("#roomCostLimit")).toHaveValue("");
  expect(await page.evaluate(() => Net.snapshot.settings.costLimit)).toBe(4000);
  await page.locator("#roomUnitCostLimit").fill("100000");
  await page.locator("#roomCostLimit").fill("4500");
  await expect.poll(() => page.evaluate(() => Net.snapshot.settings.costLimit)).toBe(4500);
  expect(await page.evaluate(() => Net.snapshot.settings.unitCostLimit)).toBe(750);
  await expect(page.locator("#roomUnitCostLimit")).toHaveValue("100000");
  await page.locator("#roomUnitCostLimit").fill("900");
  await expect.poll(() => page.evaluate(() => Net.snapshot.settings.unitCostLimit)).toBe(900);
});

async function connect(page, port, name) {
  for (const address of ["114.66.40.147:1313", "126.227.168.176:1313"])
    await page.routeWebSocket("ws://" + address + "/ws", (ws) => ws.close());
  await page.goto("http://127.0.0.1:" + port);
  await page.locator("#playerId").fill(name);
  await page.locator("#openSkirmish").click();
  await page.locator("#openRooms").click();
  await page.locator("#serverAddress").fill("127.0.0.1:" + port);
  await page.locator("#connectServer").click();
  await expect(page.locator("#lobby")).toBeVisible();
}

test("host COST inputs sync to another client, reset readiness and preserve invalid drafts through chat", async ({
  page,
  context,
}) => {
  const app = createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen(),
    guest = await context.newPage();
  try {
    await connect(page, address.port, "Host");
    await page.locator("#roomCode").fill("LIVESET");
    await page.locator("#createRoom").click();
    await connect(guest, address.port, "Guest");
    await guest.locator(".room-card").filter({ hasText: "LIVESET" }).getByRole("button").click();
    await guest.locator("#toggleReady").click();
    await page.locator("#roomCostLimit").fill("4300");
    await page.locator("#roomUnitCostLimit").fill("800");
    await guest.locator("#roomChatInput").fill("keep the host's drafts");
    await guest.locator("#roomChatInput").press("Enter");
    await page.locator("#roomMapSelect").selectOption("crossroads_2v2");
    await expect
      .poll(() => guest.evaluate(() => Net.snapshot.settings.mapId))
      .toBe("crossroads_2v2");
    expect(
      await guest.evaluate(() => Net.snapshot.members.find((m) => m.name === "Guest").ready),
    ).toBe(false);
    await expect(guest.locator("#roomMapInfo")).toContainText("2v2");
    await expect(page.locator("#roomCostLimit")).toHaveValue("4300");
    await expect(guest.locator("#roomCostLimit")).toHaveValue("4300");
    await page.locator("#roomBan-bannedFactions").selectOption("ZEON");
    await expect
      .poll(() => guest.evaluate(() => Net.snapshot.settings.bannedFactions))
      .toEqual(["ZEON"]);
    await page.locator(".team-filters").nth(1).locator("summary").click();
    await page.locator("#teamBan-1-bannedEras").selectOption("0079");
    await expect
      .poll(() => guest.evaluate(() => Net.snapshot.settings.teamRestrictions[1].bannedEras))
      .toEqual(["0079"]);
    await expect(guest.locator("#teamBanSummary1")).toContainText("0079");
    await expect(guest.locator("#roomMapSelect")).toBeDisabled();
    await expect(guest.locator("#roomBan-bannedFactions")).toBeDisabled();
    await expect(page.locator("#applyRoomSettings")).toHaveCount(0);
    await expect
      .poll(() =>
        guest.evaluate(() => [
          Net.snapshot.settings.costLimit,
          Net.snapshot.settings.unitCostLimit,
        ]),
      )
      .toEqual([4300, 800]);
  } finally {
    await guest.close();
    await page.evaluate(() => Net.leave());
    await app.close();
  }
});

test("continued COST typing while an earlier update is in flight applies the latest values without losing focus", async ({
  page,
}) => {
  await page.goto(url);
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await page.evaluate(() => {
    const send = Net.socket.send.bind(Net.socket);
    let held = false;
    Net.socket.send = (raw) => {
      if (!held && JSON.parse(raw).action === "configure_room") {
        held = true;
        window.releaseCostUpdate = () => send(raw);
      } else send(raw);
    };
  });
  await page.locator("#roomCostLimit").fill("4000");
  await page.locator("#roomCostLimit").press("Enter");
  await expect.poll(() => page.evaluate(() => !!Net.awaiting)).toBe(true);
  await expect(page.locator("#roomCostLimit")).toBeEnabled();
  await page.locator("#roomCostLimit").fill("4500");
  await page.locator("#roomUnitCostLimit").fill("800");
  await page.locator("#roomUnitCostLimit").press("Enter");
  await expect(page.locator("#roomUnitCostLimit")).toBeFocused();
  await page.evaluate(() => releaseCostUpdate());
  await expect
    .poll(() =>
      page.evaluate(() => [Net.snapshot.settings.costLimit, Net.snapshot.settings.unitCostLimit]),
    )
    .toEqual([4500, 800]);
  await expect(page.locator("#roomCostLimit")).toHaveValue("4500");
  await expect(page.locator("#roomUnitCostLimit")).toHaveValue("800");
  await expect(page.locator("#roomUnitCostLimit")).toBeFocused();
});
