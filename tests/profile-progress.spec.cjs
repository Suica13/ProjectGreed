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
  await page.addInitScript(() => {
    if (!localStorage.getItem("projectgreed.economy.v1"))
      localStorage.setItem(
        "projectgreed.economy.v1",
        JSON.stringify({ money: 1000000, supplies: 1000000, inventory: {}, kits: {} }),
      );
  });
  await open(page);
  const original = await page.evaluate(() => {
    Development.grantUnit("ZEON", "MS_06F");
    Economy.produce("Type61", "EFSF");
    Economy.buyKit("MS_06F__bazooka", "PMC");
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
    value.economy.inventory.MS_14S = 99;
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
  await page.locator("#shellSettings").click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#exportProfileSave").click();
  const download = await downloadPromise,
    downloaded = await fs.readFile(await download.path(), "utf8");
  expect(downloaded).not.toContain("secret-do-not-export");
  const data = await page.evaluate(value => ProfileSave.validate(value), JSON.parse(downloaded));
  expect(data.pilots.EFSF).toEqual(original.pilots.EFSF);
  expect(data.development).toEqual(original.development);
  expect(data.economy).toEqual(original.economy);
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage))
      if (
        key.startsWith("projectgreed.custom-pilots.v2.") ||
        key.startsWith("slg-formations-v1.") ||
        key === "projectgreed.developmentProgress.v1" ||
        key === "projectgreed.economy.v1"
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
  expect(await page.evaluate(() => ProfileSave.exportData().economy)).toEqual(original.economy);
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
test("technology credits immediately and combines delayed toasts including final turn", async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(() => {
    byId("gameScene").hidden = false;
    const snapshot = {
      matchId: "turn-reward",
      phase: "playback",
      playback: {id:"turn-batch",ready:[]}, combats:[{}],
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
  expect(result.ended).toContain("50");
  expect(result.final).toContain("75");
  expect(result.count).toBe(1);
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
    const snapshot = { matchId: "map-test", phase: "playback", playback: {id:"map-batch",ready:[]}, combats:[{}], pilotAwards: [award] };
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
    if (calls.length !== 0) throw Error("XP must wait until playback finishes");
    calls.length = 0;
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

for (const width of [1280, 360])
  test(`personal save controls have spacing and new-save resets only progress at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await open(page);
    await page.evaluate(() => {
      const data = ProfileSave.exportData();
      for (const faction of ["PMC", "EFSF", "ZEON"]) {
        const pilot = PilotSystem.createCustom(
          "custom-reset-" + faction,
          "旧驾驶员",
          undefined,
          faction,
        );
        data.pilots[faction] = { pilots: [pilot], awards: ["old-award"] };
        data.formations[faction] = {
          version: 3,
          index: 0,
          squads: [
            {
              name: "旧编组",
              units: [{ unitId: "Type61", kitId: "standard", customPilot: pilot }],
            },
          ],
        };
      }
      data.economy = {
        money: 123,
        supplies: 456,
        inventory: { Type61: 6 },
        kits: { MS_06F__bazooka: 3 },
      };
      data.development.points = { EFSF: 1234, ZEON: 5678 };
      data.development.claimed = { old: "old-match" };
      data.development.researched = {
        EFSF: Development.nodes("EFSF").map((node) => node.id),
        ZEON: Development.nodes("ZEON").map((node) => node.id),
      };
      ProfileSave.importData(data);
      localStorage.setItem("unrelated-setting", "keep-me");
    });
    await page.reload();
    await page.waitForFunction(() => assetsReady);
    await page.locator("#shellSettings").click();
    const geometry = await page.evaluate(() => {
      const buttons = ["exportProfileSave", "importProfileSave", "newProfileSave"].map((id) =>
        byId(id).getBoundingClientRect(),
      );
      const help = document
        .querySelector(".profile-save-controls .settings-help")
        .getBoundingClientRect();
      return {
        tops: buttons.map((b) => b.top),
        right: buttons[2].right,
        left: buttons[1].right,
        newLeft: buttons[2].left,
        gap: help.top - Math.max(...buttons.map((b) => b.bottom)),
      };
    });
    expect(geometry.gap).toBeGreaterThanOrEqual(9);
    expect(geometry.newLeft).toBeGreaterThan(geometry.left);
    expect(geometry.right).toBeLessThan(width);
    expect(Math.max(...geometry.tops) - Math.min(...geometry.tops)).toBeLessThan(1);
    await page.locator("#newProfileSave").click();
    await page
      .locator("#gameDialog .game-dialog-actions button")
      .getByText("取消", { exact: true })
      .click();
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("projectgreed.custom-pilots.v2.PMC")).pilots.length,
      ),
    ).toBe(1);
    await page.evaluate(() => {
      Net.active = true;
    });
    await page.locator("#newProfileSave").click();
    await expect(page.locator(".profile-save-controls .settings-help")).toContainText(
      "请先退出当前战局",
    );
    await page.evaluate(() => {
      Net.active = false;
    });
    const refreshed = page.waitForEvent("load");
    await page.locator("#newProfileSave").click();
    await page
      .locator("#gameDialog .game-dialog-actions button")
      .getByText("新建存档", { exact: true })
      .click();
    await refreshed;
    await page.waitForFunction(() => assetsReady);
    const data = await page.evaluate(() => ProfileSave.exportData());
    for (const faction of ["PMC", "EFSF", "ZEON"]) {
      expect(data.pilots[faction]).toEqual({ pilots: [], awards: [] });
      expect(JSON.stringify(data.formations[faction])).not.toContain("旧编组");
    }
    expect(data.development.points).toEqual({ EFSF: 0, ZEON: 0 });
    expect(data.development.claimed).toEqual({});
    expect(data.economy).toEqual({
      money: 5000,
      supplies: 10000,
      inventory: { Type61: 24, FF_B2: 12, Medea: 3, MS_06F: 4, MS_06S: 2, FatUncle: 3 },
      kits: {},
    });
    expect(data.development.researched.EFSF).toEqual(["Tech_EFSF_0079_BaseTech"]);
    expect(data.development.researched.ZEON).toEqual(["Tech_ZEON_0079_BaseTech"]);
    expect(await page.evaluate(() => localStorage.getItem("unrelated-setting"))).toBe("keep-me");
  });
test("damaged wallet keeps menu navigation and import recovery available", async ({page})=>{
 const damaged=JSON.stringify({money:12345,supplies:6789,inventory:{MS_14S:-1},kits:{}});
 await page.addInitScript(damaged=>{
   if(!localStorage.getItem("damaged-seeded")){
     localStorage.setItem("damaged-seeded","yes");
     localStorage.setItem("projectgreed.economy.v1",damaged);
   }
 },damaged);
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await open(page);
 await page.locator("#shellHangar").click();
 await expect(page.locator("#formationMain")).toBeVisible();
 await page.locator("#shellProduction").click();
 await expect(page.locator("#productionScreen")).toBeVisible();
 await page.locator("#shellLobby").click();
 await page.locator("#openSkirmish").click();
 await expect(page.locator("#skirmishSetup")).toBeVisible();
 await page.locator("#closeSkirmish").click();
 await page.locator("#shellSettings").click();
 await page.locator("#exportProfileSave").click();
 await expect(page.locator("#clientSettingsDialog .profile-save-controls [role=status]")).toContainText("MS_14S");
 expect(await page.evaluate(()=>localStorage.getItem(Economy.key))).toBe(damaged);
 expect(await page.evaluate(()=>localStorage.getItem(Economy.key+".recovery-backup"))).toBe(damaged);
 const valid=await page.evaluate(()=>({
   format:"ProjectGreed-profile",schemaVersion:1,
   pilots:Object.fromEntries(["PMC","EFSF","ZEON"].map(f=>[f,{pilots:[],awards:[]}])),
   formations:{PMC:null,EFSF:null,ZEON:null},
   development:Development.exportProgress(),
   economy:{money:12345,supplies:6789,inventory:{MS_14S:99},kits:{}}
 }));
 const loaded=page.waitForEvent("load");
 await page.locator("#profileSaveFile").setInputFiles({name:"repaired.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(valid))});
 await loaded;
 await page.waitForFunction(()=>typeof assetsReady!=="undefined"&&assetsReady);
 expect(await page.evaluate(()=>ProfileSave.exportData().economy)).toEqual(valid.economy);
 expect(errors).toEqual([]);
});
