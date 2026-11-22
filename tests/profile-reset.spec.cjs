const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path"),
  P = require("../shared/pilots");
test('English and Japanese liaison text preserves the company placeholder',async({page})=>{
  test.setTimeout(120000);
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await page.waitForFunction(()=>assetsReady);
  for(const language of ['en','ja']){
    const result=await page.evaluate(language=>{
      I18n.setLanguage(language);
      const source=ContactTasks.intro.find(line=>line[1].includes('【玩家公司名】'))[1];
      return {source,translation:I18n.text(source).replaceAll('【玩家公司名】','TEST PMC'),task:I18n.text(ContactTasks.tasks[0].description)};
    },language);
    expect(result.translation).toContain('TEST PMC');
    expect(result.translation).not.toBe(result.source);
    expect(result.translation).not.toContain('【玩家公司名】');
    expect(result.task).toBeTruthy();
  }
});
for (const width of [1440, 390])
  test("old profile reset, dorm overflow and fixed contact layout " + width, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 1000 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const pilots = Array.from({ length: 12 }, (_, i) =>
      P.custom({
        ...P.createCustom("custom-kept-" + i, "保留驾驶员" + i),
        level: 8,
        record: { kills: i, battles: 2, losses: 1, shipKills: 0 },
      }),
    );
    await page.addInitScript((pilots) => {
      if (!localStorage.getItem("projectgreed.progress-reset.v1")) {
        localStorage.setItem(
          "projectgreed.custom-pilots.v3.shared",
          JSON.stringify({ pilots, awards: ["old"] }),
        );
        localStorage.setItem(
          "projectgreed.developmentProgress.v1",
          JSON.stringify({
            points: { EFSF: 9999 },
            researched: { EFSF: ["Tech_EFSF_0079_BaseTech"] },
          }),
        );
      }
    }, pilots);
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => I18n.setLanguage("zh"));
    let state = await page.evaluate(() => ({
      economy: Economy.snapshot(),
      pilots: JSON.parse(localStorage.getItem("projectgreed.custom-pilots.v3.shared")).pilots,
      development: Development.exportProgress(),
    }));
    expect(state.economy.money).toBe(8000);
    expect(state.economy.storage.ships).toHaveLength(4);
    expect(state.economy.licenses.MS_06F).toBe(true);
    expect(state.economy.licenses.RX_78_2).toBeUndefined();
    expect(state.pilots.filter((p) => p.inDormStorage)).toHaveLength(2);
    expect(state.pilots.every((p) => p.level === 0 && p.points === 80)).toBe(true);
    expect(state.pilots[5].record.kills).toBe(5);
    expect(state.development.researched.EFSF).toEqual(["Tech_EFSF_0079_BaseTech"]);
    expect(state.development.researched.ZEON).toEqual(["Tech_ZEON_0079_BaseTech"]);
    await page.locator("#shellHangar").click();
    await page.locator("#shellPilots").click();
    await page.locator("#dormPMCStorage").click();
    await expect(page.locator("#dormStorageDialog .warehouse-delivery-card")).toHaveCount(2);
    await expect(
      page.locator("#dormStorageDialog").getByRole("button", { name: "接受", exact: true }).first(),
    ).toBeDisabled();
    await page.screenshot({ path: `tmp/verification/screenshots/reset-dorm-${width}.png` });
    await page
      .locator("#dormStorageDialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.evaluate(() => {
      const k = "projectgreed.custom-pilots.v3.shared",
        s = JSON.parse(localStorage.getItem(k));
      s.pilots = s.pilots.filter((p) => p.id !== "custom-kept-0");
      localStorage.setItem(k, JSON.stringify(s));
      Economy.creditActivity({
        id: "new-earned",
        matchId: "new-earned",
        money: 100,
        supplies: 0,
        inventory: {},
      });
    });
    await page.reload();
    await page.waitForFunction(() => assetsReady);
    expect(await page.evaluate(() => Economy.snapshot().money)).toBe(8100);
    await page.locator("#shellHangar").click();
    await page.locator("#shellPilots").click();
    await page.locator("#dormPMCStorage").click();
    await page
      .locator("#dormStorageDialog")
      .getByRole("button", { name: "接受", exact: true })
      .first()
      .click();
    await expect(page.locator("#dormStorageDialog .warehouse-delivery-card")).toHaveCount(1);
    await page
      .locator("#dormStorageDialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.evaluate(() => {
      window.infoSounds = 0;
      const play = GameAudio.play;
      GameAudio.play = (...args) => {
        if (args[0] === "infoSound") window.infoSounds++;
        return play(...args);
      };
    });
    await page.locator("#shellMissions").click();
    await page.locator("#shellContactMerchants").click();
    await page.locator('[data-merchant-id="efsf"] .merchant-portrait').click();
    expect(await page.evaluate(() => window.infoSounds)).toBe(1);
    await page.locator("#liaisonDialogueNext").click();
    expect(await page.evaluate(() => window.infoSounds)).toBe(2);
    const geometry = await page.locator(".liaison-dialogue").evaluate((n) => {
      const img = n.querySelector("img").getBoundingClientRect(),
        text = n.querySelector(".liaison-dialogue-text").getBoundingClientRect(),
        box = n.getBoundingClientRect();
      return {
        portraitAbove: img.bottom <= text.top + 1,
        centered: Math.abs(img.left + img.right - (box.left + box.right)) < 3,
        overflow: n.scrollHeight > n.clientHeight + 1,
      };
    });
    expect(geometry).toEqual({ portraitAbove: true, centered: true, overflow: false });
    await page.screenshot({ path: `tmp/verification/screenshots/reset-dialogue-${width}.png` });
    for (let i = 1; i < 21; i++) await page.locator("#liaisonDialogueNext").click();
    await page
      .locator("#merchantTerminal")
      .getByRole("button", { name: "任务", exact: true })
      .click();
    await expect(page.locator('[data-task-id="efsf-2"]')).toBeDisabled();
    expect(
      await page
        .locator(".contact-task-layout")
        .evaluate((n) => n.clientWidth > n.parentElement.clientWidth * 0.9),
    ).toBe(true);
    expect(
      await page
        .locator("#merchantTerminal .resource-icon")
        .first()
        .evaluate((n) => n.getBoundingClientRect().width),
    ).toBe(18);
    await page.evaluate(() => {
      for (let i = 1; i <= 4; i++) {
        const id = "efsf-" + i;
        Economy.acceptContactTask(id);
        Economy.creditAward({
          id: "proof-" + id,
          matchId: "proof-" + id,
          money: 0,
          supplies: 0,
          contactProgress: [{ id, amount: ContactTasks.byId.get(id).required }],
        });
        Economy.completeContactTask(id);
      }
    });
    await page.locator('[data-task-id="efsf-5"]').click();
    await expect(page.locator(".contact-task-detail")).toContainText("初始装备");
    await expect(page.locator(".contact-task-detail")).toContainText("0 / 4");
    await page.screenshot({ path: `tmp/verification/screenshots/reset-task-${width}.png` });
    expect(errors).toEqual([]);
  });
test("old portable and native imports reset consistently; current profiles keep progress and ACE overflow", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(() => {
    const current = ProfileSave.exportData(),
      old = structuredClone(current);
    delete old.economy.progressEpoch;
    old.economy.money = 999999;
    const p = PilotSystem.custom({
      ...PilotSystem.createCustom("custom-import-kept", "Imported"),
      level: 8,
      record: { kills: 45, battles: 3, shipKills: 2, losses: 1 },
    });
    old.pilots.PMC.pilots = [p];
    const portable = ProfileSave.validate(old);
    const native = ProfileSave.fromNativeSnapshot({
      format: "ProjectGreed-app-store",
      version: 1,
      values: {
        [Economy.key]: JSON.stringify(old.economy),
        "projectgreed.custom-pilots.v3.shared": JSON.stringify({ pilots: [p], awards: [] }),
      },
    });
    current.economy.money = 12345;
    const advanced = ProfileSave.validate(ProfileSave.encodeData(current));
    const aces = PilotSystem.catalog.aces
      .filter((p) => p.price)
      .slice(0, 11)
      .map((p) => PilotSystem.createAce(p.id));
    localStorage.setItem(
      "projectgreed.custom-pilots.v3.shared",
      JSON.stringify({ pilots: aces, awards: [] }),
    );
    return {
      portable: {
        money: portable.economy.money,
        level: portable.pilots.PMC.pilots[0].level,
        kills: portable.pilots.PMC.pilots[0].record.kills,
      },
      native: {
        money: native.economy.money,
        level: native.pilots.PMC.pilots[0].level,
        kills: native.pilots.PMC.pilots[0].record.kills,
      },
      advanced: advanced.economy.money,
    };
  });
  expect(result.portable).toEqual({ money: 8000, level: 0, kills: 45 });
  expect(result.native).toEqual(result.portable);
  expect(result.advanced).toBe(12345);
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  await page.locator("#shellHangar").click();
  await page.locator("#shellPilots").click();
  await page.locator("#dormACEStorage").click();
  await expect(page.locator("#dormStorageDialog .warehouse-delivery-card")).toHaveCount(1);
  expect(await page.evaluate(() => Formation.availablePilots().filter((p) => p.ace).length)).toBe(
    10,
  );
});
