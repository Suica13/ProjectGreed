const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");

test("unchanged snapshots retain chat and LOG nodes while edits and perspective changes replace stale content", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  const result = await page.evaluate(() => {
    const snapshot = {
      ...Net.snapshot,
      log: ["First", "Duplicate", "Duplicate"],
      chat: [{ id: "c1", name: "Pilot", memberId: "p", text: "Original", channel: "all", at: 1 }],
    };
    Chat.setSnapshot(snapshot);
    const chat = byId("roomChatLines").firstChild,
      rows = [...byId("log").children];
    Chat.setSnapshot(structuredClone(snapshot));
    const unchanged =
      chat === byId("roomChatLines").firstChild &&
      rows.every((row, i) => row === byId("log").children[i]);
    snapshot.log.unshift("Newest");
    Chat.setSnapshot(snapshot);
    const retained = rows.every((row, i) => row === byId("log").children[i + 1]);
    snapshot.chat[0].text = "Corrected";
    Chat.setSnapshot(snapshot);
    const edited =
      byId("roomChatLines").textContent.includes("Corrected") &&
      !byId("roomChatLines").textContent.includes("Original");
    snapshot.log = ["Other team"];
    snapshot.chat = [];
    Chat.setSnapshot(snapshot);
    return {
      unchanged,
      retained,
      edited,
      log: byId("log").textContent,
      chat: byId("roomChatLines").textContent,
    };
  });
  expect(result).toMatchObject({
    unchanged: true,
    retained: true,
    edited: true,
    log: "Other team",
  });
  expect(result.chat).not.toContain("Corrected");
});

test("LOG reconciliation remains bounded and invalidates literal unit names and language", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const result = await page.evaluate(() => {
    Chat.setLog(["Alice opens fire"], ["Alice"]);
    const first = byId("log").firstChild;
    Chat.setLog(["Alice opens fire"], ["opens"]);
    const namesInvalidated = first !== byId("log").firstChild;
    const second = byId("log").firstChild;
    I18n.setLanguage(I18n.language === "en" ? "zh" : "en");
    Chat.setLog(["Alice opens fire"], ["opens"]);
    const languageInvalidated = second !== byId("log").firstChild;
    for (let i = 0; i < 100; i++)
      Chat.setLog(
        Array.from({ length: 150 }, (_, n) => "round " + i + " line " + n),
        [],
      );
    return {
      namesInvalidated,
      languageInvalidated,
      count: byId("log").children.length,
      text: byId("log").textContent,
    };
  });
  expect(result.namesInvalidated && result.languageInvalidated).toBe(true);
  expect(result.count).toBe(80);
  expect(result.text).toContain("round 99 line 79");
  expect(result.text).not.toContain("round 98");
});
