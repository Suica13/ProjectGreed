const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { WebSocket } = require("ws");
let app, base, testRoot;
test.beforeAll(async () => {
  fs.mkdirSync(path.resolve(".openai"), { recursive: true });
  testRoot = fs.mkdtempSync(path.resolve(".openai/developer-project-"));
  for (const entry of [
    "assets",
    "client",
    "shared",
    "tools",
    "build.cjs",
    "server.js",
    "project.json",
    "cfg.json",
  ])
    fs.cpSync(path.resolve(entry), path.join(testRoot, entry), { recursive: true });
  require("node:child_process").execFileSync(process.execPath, [path.join(testRoot, "build.cjs")], {
    cwd: testRoot,
    windowsHide: true,
  });
  app = require(path.join(testRoot, "server.js")).createServer({ host: "127.0.0.1", port: 0 });
  base = "http://127.0.0.1:" + (await app.listen()).port;
});
test.afterAll(async () => {
  await app?.close();
  if (testRoot && testRoot.startsWith(path.resolve(".openai") + path.sep))
    fs.rmSync(testRoot, { recursive: true, force: true });
});
async function open(page, developer = true) {
  await page.goto(base + (developer ? "/developer.html" : "/client.html"));
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => I18n.setLanguage("zh"));
}
for (const width of [1280, 390]) {
  test(`pilot formation shares the unit layout and creates a pilot with 60 training points at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => localStorage.setItem("projectgreed.combatFaction", "EFSF"));
    await open(page, false);
    await page.locator("#openFormation").click();
    const tabs = await page.locator(".formation-mode-tabs").boundingBox();
    const banner = await page.locator(".formation-group-banner").boundingBox();
    const heading = await page.locator(".formation-heading").boundingBox();
    const unitTab = await page.locator("#formationUnitsTab").boundingBox();
    const pilotTab = await page.locator("#formationPilotsTab").boundingBox();
    expect(tabs.width).toBeGreaterThan(banner.width);
    expect(tabs.y).toBeGreaterThanOrEqual(heading.y + heading.height);
    expect(Math.abs(unitTab.width - pilotTab.width)).toBeLessThanOrEqual(1);
    const unitList = await page.locator("#formationUnits").boundingBox();
    const unitAdd = await page.locator("#openFormationPicker").boundingBox();
    await page.locator("#formationPilotsTab").click();
    await expect(page.locator("#formationUnitsWorkspace")).toBeHidden();
    await expect(page.locator("#formationPilotRoster")).toBeVisible();
    const pilotList = await page.locator("#customPilotList").boundingBox();
    const pilotAdd = await page.locator("#createCustomPilot").boundingBox();
    const group = await page.locator(".formation-group-banner").boundingBox();
    expect(Math.abs(pilotList.x - unitList.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(pilotList.width - unitList.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(pilotAdd.y - unitAdd.y)).toBeLessThanOrEqual(4);
    expect(group.y).toBeGreaterThanOrEqual(pilotList.y + pilotList.height);
    await expect(page.locator("#createCustomPilot")).toBeInViewport();
    await page.locator("#createCustomPilot").click();
    await expect(page.locator("#customPilotRole")).toHaveCount(0);
    await expect(page.locator("#customPilotStats")).toContainText("指挥 70");
    await expect(page.locator("#customPilotStats")).toContainText("射击 90");
    await expect(page.locator("#customPilotStats")).toContainText("觉醒 50");
    await expect(page.locator("#customPilotProgress")).toContainText("强化点 60");
    await expect(page.locator("#formationPilotToolbar small")).toHaveCount(0);
    await expect(page.locator("#confirmPilotTraining")).toHaveText("确认强化");
    await expect(page.locator("#cancelPilotTraining")).toHaveText("取消强化");
    await expect(page.locator("#confirmPilotTraining")).toBeDisabled();
    await expect(page.locator("#pilotTrainingActions")).toHaveCSS("position", "static");
    await page.getByRole("button", { name: "强化射击", exact: true }).click();
    await expect(page.locator("#pilotTrainingStatus")).toContainText("已分配1点");
    await page.locator("#cancelPilotTraining").click();
    await expect(page.locator("#customPilotStats")).toContainText("射击 90");
    await page.getByRole("button", { name: "强化射击", exact: true }).click();
    await page.locator("#confirmPilotTraining").click();
    await expect(page.locator("#confirmPilotTraining")).toBeDisabled();
    const training = await page.locator("#customPilotStats").boundingBox();
    const actions = await page.locator("#pilotTrainingActions").boundingBox();
    expect(actions.y).toBeGreaterThanOrEqual(training.y + training.height);
    await page.screenshot({ path: `.openai/pilot-training-panel-${width}.png` });
    await page.locator("#createPilotConfirm").click();
    await expect(page.locator(".custom-pilot-card")).toHaveCount(1);
    await expect(page.locator(".custom-pilot-card")).toHaveClass(/formation-row/);
    await page.screenshot({ path: `.openai/pilot-formation-${width}.png` });
    const pilots = await page.evaluate(
      () => JSON.parse(localStorage.getItem("projectgreed.custom-pilots.v2.EFSF")).pilots,
    );
    expect(pilots[0].stats.shooting).toBe(91);
    expect(pilots[0].points).toBe(59);
    expect(pilots[0].role).toBeUndefined();
    await page.locator("#pilotRosterSearch").fill("不存在的驾驶员");
    await expect(page.locator(".custom-pilot-card")).toHaveCount(0);
    await page.locator("#pilotRosterSearch").fill("");
    await page.locator(".custom-pilot-card .formation-detail-button").click();
    await expect(page.locator("#customPilotStats")).toContainText("射击 91");
    await expect(page.locator("#customPilotProgress")).toContainText("强化点 59");
    await page.locator("#finishCustomPilot").click();
    await page.locator("#formationUnitsTab").click();
    await expect(page.locator("#formationUnitsWorkspace")).toBeVisible();
    await expect(page.locator("#formationPilotRoster")).toBeHidden();
  });
}
function socket() {
  const ws = new WebSocket(base.replace("http:", "ws:") + "/ws");
  const frames = [];
  ws.on("message", (data) => frames.push(JSON.parse(data)));
  async function request(body, predicate) {
    await new Promise((resolve, reject) => {
      if (ws.readyState === 1) resolve();
      else {
        ws.once("open", resolve);
        ws.once("error", reject);
      }
    });
    const from = frames.length;
    ws.send(JSON.stringify(body));
    return new Promise((resolve, reject) => {
      const end = Date.now() + 5000;
      const poll = () => {
        const found = frames.slice(from).find(predicate);
        if (found) resolve(found);
        else if (Date.now() > end) reject(Error(JSON.stringify(frames.at(-1))));
        else setTimeout(poll, 10);
      };
      poll();
    });
  }
  return { ws, frames, request };
}
test("unit and technology edits save real JSON; reload rebuilds both clients and server rules", async ({
  page,
}) => {
  test.setTimeout(90000);
  const unitPath = path.join(testRoot, "assets/units/Type61/unit.json"),
    treePath = path.join(testRoot, "shared/development-tree.json");
  const originalUnit = fs.readFileSync(unitPath),
    originalTree = fs.readFileSync(treePath);
  const unit = JSON.parse(originalUnit),
    tree = JSON.parse(originalTree);
  let host, guest;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await open(page);
    await expect(page.locator("#ui-dev-launch")).toHaveCount(0);
    await page.locator("#openDevelopment").click();
    await page.evaluate(() => Formation.previewUnit("Type61"));
    await page.locator("#developerUnitEdit").click();
    await expect(page.locator("#developerUnitEdit")).toHaveText("保存属性");
    await page.locator('[data-source-field="stats.hp"]').fill(String(unit.stats.hp + 123));
    const weapon = page
      .locator("#developerUnitFields > details > summary")
      .filter({ hasText: "武器性能" });
    await weapon.click();
    await page
      .locator("#developerUnitFields summary")
      .filter({ hasText: "加农炮" })
      .first()
      .click();
    await page
      .locator('[data-source-field="weapons.EF_Type61_Cannon.max"]')
      .fill(String(unit.weapons.EF_Type61_Cannon.max + 1));
    await page.locator("#developerUnitEdit").click();
    await expect(page.locator("#developerUnitEdit")).toHaveText("修改属性");
    expect(JSON.parse(fs.readFileSync(unitPath)).stats.hp).toBe(unit.stats.hp + 123);
    expect(await page.evaluate(() => Rules.models.Type61__standard.hp)).toBe(unit.stats.hp);
    await page.locator("#closeFormationDetail").click();
    await page.locator("#developerTreeEdit").click();
    await page.locator("#developerTechAdd").click();
    await page.locator('#developerTreeFields [aria-label="名称"]').fill("编辑测试科技");
    await page.locator('#developerTreeFields [aria-label="说明"]').fill("测试持久保存");
    await page.locator('#developerTreeFields [aria-label="科技点"]').fill("123");
    await page.locator('#developerTreeFields [aria-label="解锁单位"]').selectOption(["Type61"]);
    await page
      .locator('[aria-label="上传科技图标"]')
      .setInputFiles(path.join(testRoot, tree.EFSF[0].icon));
    await expect(page.locator("#developerTreeEdit")).toBeEnabled();
    await page.locator("#developerTreeEdit").click();
    await expect(page.locator("#developerTreeEdit")).toHaveText("修改属性");
    const saved = JSON.parse(fs.readFileSync(treePath)).EFSF.at(-1);
    expect(saved.name).toBe("编辑测试科技");
    expect(saved.points).toBe(123);
    expect(saved.unlocks).toEqual(["Type61"]);
    // Delete the newly added node, then cancel: saved data must remain untouched.
    await page.locator("#developerTreeEdit").click();
    await page.locator("#developerTechSelect").selectOption(saved.id);
    await page.locator("#developerTechDelete").click();
    await page
      .locator("#developerTreeFields")
      .getByRole("button", { name: "取消编辑", exact: true })
      .click();
    expect(JSON.parse(fs.readFileSync(treePath)).EFSF.at(-1).id).toBe(saved.id);
    await page.locator("#closeDevelopment").click();
    await page.locator("#openClientSettings").click();
    await page.locator("#developerReload").click();
    await page.waitForEvent("load");
    await page.waitForFunction(() => assetsReady);
    expect(await page.evaluate(() => Rules.models.Type61__standard.hp)).toBe(unit.stats.hp + 123);
    expect(await page.evaluate(() => Rules.models.Type61__standard.weapons[0].max)).toBe(
      unit.weapons.EF_Type61_Cannon.max + 1,
    );
    expect(await page.evaluate(() => Development.nodes("EFSF").at(-1).name)).toBe("编辑测试科技");
    await page.screenshot({ path: ".openai/developer-after-reload.png" });
    host = socket();
    guest = socket();
    for (const [client, mode] of [
      [host, "create"],
      [guest, "join"],
    ]) {
      const joined = await client.request(
        {
          type: "hello",
          version: require("../project.json").version,
          characterFaction: "PMC",
          mode,
          room: "EDITVERIFY",
          researched: { EFSF: [...tree.EFSF.map(node => node.id), saved.id] },
          name: mode,
        },
        (m) => m.type === "joined" || m.type === "error",
      );
      expect(joined.type).toBe("joined");
    }
    const room = app.rooms.get("EDITVERIFY");
    expect(room.seats[0].researched.EFSF).toContain(saved.id);
    const act = async (client, action, fields = {}) => {
      const id = randomUUID();
      const result = await client.request(
        {
          type: "action",
          id,
          revision: room.revision,
          round: room.game.round,
          matchId: room.matchId,
          action,
          ...fields,
        },
        (m) => m.ack === id || m.id === id,
      );
      expect(result.type, JSON.stringify(result)).toBe("state");
    };
    for (const client of [host, guest])
      await act(client, "set_ready", {
        ready: true,
        formation: [{ unitId: "Type61", kitId: "standard" }],
      });
    await act(host, "start_game", { formation: [{ unitId: "Type61", kitId: "standard" }] });
    for (const client of [host, guest])
      await act(client, "confirm_formation", {
        formation: [{ unitId: "Type61", kitId: "standard" }],
      });
    expect(room.game.units[0].hp).toBe(unit.stats.hp + 123);
    expect(errors).toEqual([]);
  } finally {
    for (const client of [host, guest])
      if (client) {
        // Explicit exits release rooms before the restoration rebuild.
        if (client.ws.readyState === 1) client.ws.send(JSON.stringify({ type: "leave" }));
        client.ws.terminate();
      }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});

test("developer unit and technology forms fit a mobile viewport and retain invalid drafts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.locator("#openDevelopment").click();
  await page.locator("#developerTreeEdit").click();
  await expect(page.locator("#developerTreeFields")).toBeVisible();
  expect(
    await page
      .locator("#developerTreeFields")
      .evaluate((node) => node.getBoundingClientRect().right),
  ).toBeLessThanOrEqual(390);
  await page.locator("#developerTechAdd").click();
  await page.locator('#developerTreeFields [aria-label="名称"]').fill("移动端草稿");
  await page.screenshot({ path: ".openai/developer-tech-mobile.png" });
  await page
    .locator("#developerTreeFields")
    .getByRole("button", { name: "取消编辑", exact: true })
    .click();
  await page.evaluate(() => Formation.previewUnit("Type61"));
  await page.locator("#developerUnitEdit").click();
  const file = path.join(testRoot, "assets/units/Type61/unit.json");
  const original = fs.readFileSync(file, "utf8");
  await page.locator('[data-source-field="stats.hp"]').fill("-1");
  await page.locator("#developerUnitEdit").click();
  await expect(page.locator("#developerUnitEdit")).toBeEnabled();
  await expect(page.locator("#developerUnitEdit")).toHaveText("保存属性");
  expect(fs.readFileSync(file, "utf8")).toBe(original);
  await expect(page.locator('[data-source-field="stats.hp"]')).toHaveValue("-1");
  await page.screenshot({ path: ".openai/developer-unit-mobile.png" });
  await page
    .locator("#developerUnitFields")
    .getByRole("button", { name: "取消编辑", exact: true })
    .click();
});

test("deleting a pilot clears all saved assignments and survives reload", async ({ page }) => {
  const P = require("../shared/pilots.js");
  const pilot = P.createCustom("custom-delete-test", "待删除驾驶员", null, "EFSF");
  const units = [{ unitId: "Type61", kitId: "standard", customPilot: pilot }];
  await page.addInitScript(
    ({ pilot, units }) => {
      if (localStorage.getItem("pilot-delete-fixture")) return;
      localStorage.setItem("projectgreed.combatFaction", "EFSF");
      localStorage.setItem(
        "projectgreed.custom-pilots.v2.EFSF",
        JSON.stringify({ pilots: [pilot], awards: [] }),
      );
      localStorage.setItem("projectgreed.custom-pilots.v2.migrated", "EFSF");
      localStorage.setItem(
        "slg-formations-v1.EFSF",
        JSON.stringify({
          version: 3,
          squads: [
            { name: "编组一", units },
            { name: "编组二", units },
          ],
        }),
      );
      localStorage.setItem("pilot-delete-fixture", "1");
    },
    { pilot, units },
  );
  await open(page, false);
  await page.locator("#openFormation").click();
  await page.locator("#formationPilotsTab").click();
  const remove = page.getByRole("button", { name: "删除驾驶员 待删除驾驶员", exact: true });
  await remove.click();
  await page.locator("#gameDialog").getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.locator(".custom-pilot-card")).toHaveCount(1);
  await remove.click();
  await page.locator("#gameDialog").getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.locator(".custom-pilot-card")).toHaveCount(0);
  const stored = await page.evaluate(() => ({
    pilots: JSON.parse(localStorage.getItem("projectgreed.custom-pilots.v2.EFSF")).pilots,
    squads: JSON.parse(localStorage.getItem("slg-formations-v1.EFSF")).squads,
    current: Formation.current(),
  }));
  expect(stored.pilots).toEqual([]);
  for (const squad of stored.squads) expect(squad.units[0].customPilot).toBeUndefined();
  expect(stored.current[0].customPilot).toBeUndefined();
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  await page.locator("#openFormation").click();
  await page.locator("#formationPilotsTab").click();
  await expect(page.locator(".custom-pilot-card")).toHaveCount(0);
});
