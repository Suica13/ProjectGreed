const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path"),
  fs = require("node:fs/promises");
async function open(page) {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => {
    I18n.setLanguage("zh");
    PlayerProfile.select?.("EFSF");
  });
}
test("personal save download and file import preserve pilots, formations and spent technology balances", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  const original = await page.evaluate(() => {
    const pilot = PilotSystem.createCustom("custom-profile-1", "备份驾驶员", undefined, "EFSF");
    pilot.stats.shooting += 10;
    const node = Development.nodes("EFSF").find(
      (n) =>
        n.points > 0 && n.requires.every((id) => Development.unlockedTech("EFSF").includes(id)),
    );
    Development.creditAward({
      id: "profile-credit",
      matchId: "profile-match",
      faction: "EFSF",
      points: 100000,
    });
    Development.research("EFSF", node.id);
    const value = ProfileSave.exportData();
    value.pilots.EFSF.pilots = [PilotSystem.custom(pilot)];
    value.formations.EFSF = {
      version: 3,
      index: 0,
      squads: [
        {
          name: "备份编组",
          units: [{ unitId: "Type61", kitId: "standard", customPilot: PilotSystem.custom(pilot) }],
        },
      ],
    };
    ProfileSave.importData(value);
    localStorage.setItem("slg-last:EFSF", JSON.stringify({ token: "secret-do-not-export" }));
    return value;
  });
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  await page.locator("#openClientSettings").click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#exportProfileSave").click();
  const download = await downloadPromise,
    downloaded = await fs.readFile(await download.path(), "utf8");
  expect(downloaded).not.toContain("secret-do-not-export");
  const data = JSON.parse(downloaded);
  expect(data.pilots.EFSF).toEqual(original.pilots.EFSF);
  expect(data.development).toEqual(original.development);
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage))
      if (
        key.startsWith("projectgreed.custom-pilots.v2.") ||
        key.startsWith("slg-formations-v1.") ||
        key === "projectgreed.developmentProgress.v1"
      )
        localStorage.removeItem(key);
  });
  const imported = page.waitForEvent("load");
  await page.locator("#profileSaveFile").setInputFiles({
    name: "progress.json",
    mimeType: "application/json",
    buffer: Buffer.from(downloaded),
  });
  await imported;
  await page.waitForFunction(
    () =>
      typeof assetsReady !== "undefined" &&
      assetsReady &&
      !!localStorage.getItem("projectgreed.custom-pilots.v2.EFSF"),
  );
  expect(await page.evaluate(() => ProfileSave.exportData().development)).toEqual(
    original.development,
  );
  expect(await page.evaluate(() => ProfileSave.exportData().pilots.EFSF)).toEqual(
    original.pilots.EFSF,
  );
  expect(await page.evaluate(() => ProfileSave.exportData().formations.EFSF)).toEqual(
    original.formations.EFSF,
  );
  const unchanged = await page.evaluate(() => {
    const baseline = ProfileSave.exportData();
    delete baseline.createdAt;
    const before = JSON.stringify(baseline),
      bad = ProfileSave.exportData();
    bad.development.points.EFSF = -1;
    try {
      ProfileSave.importData(bad);
    } catch {}

    const originalSet = Storage.prototype.setItem;
    let writes = 0;
    Storage.prototype.setItem = function (key, value) {
      if (++writes === 3) throw Error("simulated storage quota");
      return originalSet.call(this, key, value);
    };
    try {
      const replacement = ProfileSave.exportData();
      replacement.pilots.EFSF.pilots = [];
      ProfileSave.importData(replacement);
    } catch {
    } finally {
      Storage.prototype.setItem = originalSet;
    }
    const after = ProfileSave.exportData();
    delete after.createdAt;
    return before === JSON.stringify(after);
  });
  expect(unchanged).toBe(true);
  expect(errors).toEqual([]);
});
test("technology credits immediately but shows a combined toast only after turn end, including final turn", async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(() => {
    byId("gameScene").hidden = false;
    const snapshot = {
      matchId: "turn-reward",
      phase: "playback",
      game: { round: 2, team: 0 },
      techAwards: [1, 2].map((i) => ({
        id: "turn-award-" + i,
        matchId: "turn-reward",
        faction: "EFSF",
        points: 25,
        round: 2,
        team: 0,
      })),
    };
    const before = Development.pointBalance("EFSF");
    DevelopmentUI.receiveAwards(snapshot);
    const during = {
      balance: Development.pointBalance("EFSF") - before,
      count: byId("techRewardStack").childElementCount,
    };
    DevelopmentUI.receiveAwards({ ...snapshot, phase: "idle", game: { round: 3, team: 1 } });
    const ended = byId("techRewardStack").textContent;
    const final = {
      ...snapshot,
      matchId: "final-reward",
      techAwards: [
        {
          id: "final-award",
          matchId: "final-reward",
          faction: "ZEON",
          points: 75,
          round: 2,
          team: 0,
        },
      ],
    };
    DevelopmentUI.receiveAwards(final);
    DevelopmentUI.receiveAwards({ ...final, phase: "finished" });
    DevelopmentUI.receiveAwards({ ...final, phase: "finished" });
    return {
      during,
      ended,
      final: byId("techRewardStack").textContent,
      count: byId("techRewardStack").childElementCount,
    };
  });
  expect(result.during).toEqual({ balance: 50, count: 0 });
  expect(result.ended).toContain("50点");
  expect(result.final).toContain("75点");
  expect(result.count).toBe(2);
});
test("map XP and level-up labels are deduplicated and follow an embarked pilot's carrier", async ({
  page,
}) => {
  await open(page);
  const labels = await page.evaluate(() => {
    const award = {
      id: "map-xp",
      unitId: "passenger",
      carrierId: "carrier",
      experiencePoints: 62,
      leveledUp: true,
    };
    const snapshot = { matchId: "map-test", phase: "playback", pilotAwards: [award] };
    PilotRewards.receive(snapshot);
    const calls = [];
    const ctx = new Proxy(
      {},
      {
        get: (_, key) =>
          key === "fillText" ? (text, x, y) => calls.push({ text, x, y }) : () => {},
        set: () => true,
      },
    );
    PilotRewards.draw(ctx, { id: "carrier" }, 100, 200, performance.now());
    if (calls.length) throw Error("XP displayed before playback finished");
    PilotRewards.receive({ ...snapshot, phase: "idle" });
    PilotRewards.receive({ ...snapshot, phase: "idle" });
    PilotRewards.draw(ctx, { id: "passenger" }, 100, 200, performance.now());
    PilotRewards.draw(ctx, { id: "carrier" }, 100, 200, performance.now());
    return calls;
  });
  expect(labels.map((c) => c.text)).toEqual(["+62经验值", "LEVEL UP"]);
  expect(labels[0].x).toBe(100);
  expect(labels[0].y).toBeGreaterThan(195);
});
