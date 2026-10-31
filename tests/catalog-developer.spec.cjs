const { test, expect } = require("@playwright/test");
const { createDeveloperServer } = require("../tools/developer-server.cjs");
const { editorFixture } = require("./catalog-editor-fixture.cjs");
async function login(page, base, standalone = false) {
  if (standalone) {
    const { pathToFileURL } = require("node:url"),
      path = require("node:path");
    await page.goto(pathToFileURL(path.resolve("public/developer.html")).href);
  } else await page.goto(base + "/developer.html");
  await page.locator("#editorServerAddress").fill(base);
  await page.locator("#editorAccessKey").fill("13450");
  await page.locator("#confirmEditorLogin").click();
  await expect(page.locator("#editorLoginScreen")).toBeHidden({ timeout: 30000 });
}

test("developer catalog edits unit overrides, offers save/discard on close, and edits common templates", async ({
  page,
}) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  const f = editorFixture(),
    app = createDeveloperServer({ port: 0, store: f.store, catalog: f.catalog });
  const address = await app.listen(),
    errors = [];
  const editorRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/editor/")) editorRequests.push(new URL(request.url()));
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  try {
    await login(page, "http://127.0.0.1:" + address.port);
    await expect(page.locator("#encyclopediaScreen")).toBeVisible();
    await expect(page.locator(".developer-toolbar small")).toHaveText("已连接");
    await expect(page.locator("#menuShell")).toBeHidden();
    const pane = await page.locator("#encyclopediaList").boundingBox();
    expect(pane.height).toBeGreaterThan(500);
    await page.locator("#encyclopediaSearch").fill("RX_78_2");
    await page.locator('[data-unit-id="RX_78_2"] button').click();
    await expect(page.locator("#editUnitProperties")).toBeVisible();
    await page.locator("#editUnitProperties").click();
    await expect(page.locator("#editUnitProperties")).toHaveText("保存修改");
    await page.locator('[data-field="stats.hp"]').fill("55500");
    await expect(
      page.locator('[data-field="stats.hp"]').locator("..").locator(".catalog-numeric-delta"),
    ).toContainText("基准");
    await expect(
      page.locator('[data-field="stats.hp"]').locator("..").locator(".catalog-numeric-delta"),
    ).toContainText("调整");
    await page.locator('[data-field="price.money"]').fill("450");
    await page.locator('[data-field="unit.name.en"]').fill("Editor Gundam");
    await page.locator('[data-source-weapon="EF_HypeBazooka"] > summary').click();
    await page.locator('[data-field="weapon.EF_HypeBazooka.hit"]').fill("92");
    await page.locator("#closeFormationDetail").click();
    await expect(page.locator("#gameDialog")).toBeVisible();
    await page.getByRole("button", { name: "保存并关闭", exact: true }).click();
    await expect(page.locator("#formationUnitDetail")).toBeHidden();
    expect(f.store.getUnit("RX_78_2").unit.stats.hp).toBe(55500);
    expect(f.store.getUnit("RX_78_2").unit.weapons.EF_HypeBazooka.hit).toBe(92);
    expect(f.store.getUnit("RX_78_2").price.money).toBe(450);
    await page.locator('[data-unit-id="RX_78_2"] button').click();
    await page.locator("#editUnitProperties").click();
    await page.locator('[data-field="stats.hp"]').fill("99999");
    const requestsBeforeDiscard = editorRequests.length;
    await page.locator("#closeFormationDetail").click();
    await page.getByRole("button", { name: "取消修改并关闭", exact: true }).click();
    await expect(page.locator("#formationUnitDetail")).toBeHidden();
    expect(f.store.getUnit("RX_78_2").unit.stats.hp).toBe(55500);
    expect(editorRequests.length).toBe(requestsBeforeDiscard);
    await page.locator('[data-unit-id="RX_78_2"] button').click();
    await page.locator("#formationDetailSlots .edit-common-weapon").first().click();
    await expect(page.locator("#commonWeaponEditor")).toBeVisible();
    const old = Number(await page.locator('[data-field="common.hit"]').inputValue());
    await page.locator('[data-field="common.hit"]').fill(String(old + 1));
    await page
      .locator("#commonWeaponEditor")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.getByRole("button", { name: "保存并关闭", exact: true }).click();
    await expect(page.locator("#commonWeaponEditor")).not.toBeVisible();
    await page.locator("#closeFormationDetail").click();
    await page.locator("#encyclopediaWeaponsTab").click();
    await page.locator("#encyclopediaSearch").fill("EF_HypeBazooka");
    await expect(page.locator("#encyclopediaList .edit-common-weapon").first()).toBeVisible();
    await page.locator("#encyclopediaList .edit-common-weapon").first().click();
    await expect(page.locator("#commonWeaponEditor")).toBeVisible();
    await page
      .locator("#commonWeaponEditor")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.getByRole("button", { name: "取消修改并关闭", exact: true }).click();
    expect(errors).toEqual([]);
    const catalogRequests = editorRequests.filter((url) => url.pathname === "/api/editor/catalog");
    expect(catalogRequests).toHaveLength(2);
    expect(catalogRequests.every((url) => !!url.searchParams.get("ids"))).toBe(true);
    expect(editorRequests.filter((url) => url.pathname === "/api/editor/bootstrap")).toHaveLength(1);
    await page.screenshot({ path: "tmp/catalog-developer.png" });
  } finally {
    await page.close();
    await app.close();
    f.cleanup();
  }
});

test("async catalog cancels stale batches when filters or tabs change", async ({ page }) => {
  const { pathToFileURL } = require("node:url"),
    path = require("node:path");
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const first = await page.evaluate(() => {
    MenuShell.go("encyclopedia");
    return {
      cards: document.querySelectorAll(".encyclopedia-unit").length,
      total: Rules.catalog.prefabs.length,
      loading: document.getElementById("encyclopediaList").dataset.rendering,
    };
  });
  expect(first.cards).toBeLessThan(first.total);
  expect(first.loading).toBe("true");
  await page.locator("#encyclopediaWeaponsTab").click();
  await page.locator("#encyclopediaUnitsTab").click();
  await page.locator("#encyclopediaFaction").selectOption("ZEON");
  await page.locator("#encyclopediaSearch").fill("MS_06F");
  await expect(page.locator("#encyclopediaList")).toHaveAttribute("data-rendering", "false");
  const result = await page.evaluate(() => ({
    ids: [...document.querySelectorAll(".encyclopedia-unit")].map((node) => node.dataset.unitId),
    weapons: document.querySelectorAll("#encyclopediaList .weapon-card").length,
  }));
  expect(result.weapons).toBe(0);
  expect(result.ids.length).toBeGreaterThan(0);
  expect(result.ids.every((id) => id.includes("MS_06F"))).toBe(true);
});

test("mobile developer preview keeps edit and close controls accessible", async ({ page }) => {
  const app = createDeveloperServer({ port: 0 });
  const address = await app.listen();
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    await login(page, "http://127.0.0.1:" + address.port);
    await expect(page.locator(".developer-toolbar small")).toHaveText("已连接");
    await page.locator("#encyclopediaSearch").fill("RGM_79");
    await page.locator('[data-unit-id="RGM_79"] button').click();
    await page.locator("#editUnitProperties").click();
    await expect(page.locator("#unitSourceEditor")).toBeVisible();
    await page.locator('[data-field="stats.hp"]').fill("12345");
    await page.locator("#closeFormationDetail").click();
    await page.getByRole("button", { name: "取消修改并关闭", exact: true }).click();
    await expect(page.locator("#formationUnitDetail")).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: "tmp/catalog-developer-mobile.png" });
  } finally {
    await page.close();
    await app.close();
  }
});

test("developer unit preview hides gameplay purchase and preload buttons", async ({ page }) => {
  const app = createDeveloperServer({ port: 0 });
  const address = await app.listen();
  try {
    await login(page, "http://127.0.0.1:" + address.port);
    await expect(page.locator("#encyclopediaScreen")).toBeVisible();
    await page.locator("#encyclopediaSearch").fill("Medea");
    await page.locator('[data-unit-id="Medea"] button').click();
    await expect(page.locator("#producePreviewUnit")).toBeHidden();
    const preload = page.locator("#formationDetailHangars [data-preload-hangar]");
    await expect(preload).toHaveCount(0);
    await expect(page.locator("#formationDetailHangarsBlock")).toBeVisible();
    await expect(page.locator("#editUnitProperties")).toBeVisible();
    await expect(page.locator("#closeFormationDetail")).toBeVisible();
  } finally {
    await page.close();
    await app.close();
  }
});

test("standalone developer HTML can read source through the loopback service", async ({ page }) => {
  const app = createDeveloperServer({ port: 0 });
  const address = await app.listen();
  const { pathToFileURL } = require("node:url"),
    path = require("node:path");
  try {
    await login(page, "http://127.0.0.1:" + address.port, true);
    await expect(page.locator(".developer-toolbar small")).toHaveText("已连接");
    await page.locator("#encyclopediaSearch").fill("RX_78_2");
    await page.locator('[data-unit-id="RX_78_2"] button').click();
    await page.locator("#editUnitProperties").click();
    await expect(page.locator("#unitSourceEditor")).toBeVisible();
    await page.locator("#closeFormationDetail").click();
    await page.getByRole("button", { name: "取消修改并关闭", exact: true }).click();
    await expect(page.locator("#formationUnitDetail")).toBeHidden();
  } finally {
    await page.close();
    await app.close();
  }
});

test("missing IP service gives connection instructions before loading catalog", async ({
  page,
}) => {
  const { pathToFileURL } = require("node:url"),
    path = require("node:path");
  await page.route("http://127.0.0.1:1314/api/editor/**", (route) =>
    route.abort("connectionrefused"),
  );
  await page.goto(pathToFileURL(path.resolve("public/developer.html")).href);
  await page.locator("#editorAccessKey").fill("13450");
  await page.locator("#confirmEditorLogin").click();
  await expect(page.locator("#editorLoginStatus")).toContainText("无法连接编辑服务器");
  await expect(page.locator("#encyclopediaScreen")).toBeHidden();
  await expect(page.locator("#editorLoginStatus")).not.toContainText("Failed to fetch");
});

test("authentication gates live catalog and developer runtime never accesses saves or audio", async ({
  page,
}) => {
  const app = createDeveloperServer({ port: 0 });
  const address = await app.listen();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.storageTouches = 0;
    window.audioTouches = 0;
    for (const name of ["localStorage", "sessionStorage"])
      Object.defineProperty(window, name, {
        get() {
          window.storageTouches++;
          throw Error("Storage forbidden in developer runtime");
        },
      });
    window.Audio = function () {
      window.audioTouches++;
      throw Error("Audio forbidden");
    };
  });
  try {
    const base = "http://127.0.0.1:" + address.port;
    await page.goto(base + "/developer.html");
    await expect(page.locator("#encyclopediaScreen")).toBeHidden();
    await expect(page.locator(".encyclopedia-unit")).toHaveCount(0);
    await page.locator("#editorAccessKey").fill("wrong");
    await page.locator("#confirmEditorLogin").click();
    await expect(page.locator("#editorLoginStatus")).toContainText("密钥不正确");
    await page.locator("#editorAccessKey").fill("13450");
    await page.locator("#confirmEditorLogin").click();
    await expect(page.locator("#editorLoginScreen")).toBeHidden({ timeout: 30000 });
    await expect(page.locator("#encyclopediaList")).toHaveAttribute("data-rendering", "false");
    await expect(page.locator("#encyclopediaStatus")).toBeHidden();
    await expect(page.locator("#encyclopediaList .encyclopedia-unit .muted")).toHaveCount(0);
    expect(
      await page.evaluate(() => ({
        storage: window.storageTouches,
        audio: window.audioTouches,
        tags: document.querySelectorAll("audio").length,
      })),
    ).toEqual({ storage: 0, audio: 0, tags: 0 });
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await app.close();
  }
});

for (const width of [1440, 390])
  test(`developer top navigation edits conversion settings and refreshes previews (${width})`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    const f = editorFixture(),
      app = createDeveloperServer({ port: 0, store: f.store, catalog: f.catalog });
    const address = await app.listen();
    try {
      await page.setViewportSize({ width, height: 960 });
      await login(page, "http://127.0.0.1:" + address.port);
      await page
        .locator(".developer-toolbar")
        .getByRole("button", { name: "换算规则", exact: true })
        .click();
      await expect(page.locator("#conversionRulesScreen")).toBeVisible();
      await expect(page.locator("#encyclopediaScreen")).toBeHidden();
      await page.locator('[data-field="conversion.weaponClasses.hand.beam.damage"]').fill("1.35");
      await page.locator('[data-field="conversion.weapons.ap"]').fill("1.5");
      await page
        .locator("#conversionRulesScreen")
        .getByRole("button", { name: "保存规则", exact: true })
        .click();
      await expect(page.locator("#conversionRulesScreen [role=status]")).toContainText("已保存");
      expect(f.read("shared/conversion-rules.json").weapons.ap).toBe(1.5);
      await page.locator("[data-rule-main-class]").selectOption("leg");
      await page.locator("[data-rule-sub-class]").selectOption("missile");
      for (const [key, value] of Object.entries({
        baseAP: 2,
        baseEN: 25,
        baseHit: 88,
        minRange: 2,
        maxRange: 5,
      }))
        await page
          .locator(`[data-field="conversion.weaponClasses.leg.missile.${key}"]`)
          .fill(String(value));
      await page
        .locator("#conversionRulesScreen")
        .getByRole("button", { name: "保存规则", exact: true })
        .click();
      await expect(page.locator("#conversionRulesScreen [role=status]")).toContainText("已保存");
      await expect(page.locator("[data-rule-main-class]")).toHaveValue("leg");
      const leg = f.store.getUnit("RX_80PR").unit.weapons.EF_RX_80PR_LegMS;
      expect([leg.actionCost, leg.en, leg.hit, leg.min, leg.max]).toEqual([3, 25, 88, 2, 6]);

      await page
        .locator(".developer-toolbar")
        .getByRole("button", { name: "图鉴", exact: true })
        .click();
      await expect(page.locator("#encyclopediaScreen")).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            Object.values(Rules.catalog.prefabs.find((u) => u.id === "RX_78_2").weapons).find(
              (w) => w.category === "machine_gun",
            ).actionCost,
        ),
      ).toBe(3);
      await page
        .locator(".developer-toolbar")
        .getByRole("button", { name: "换算规则", exact: true })
        .click();
      await page.locator('[data-field="conversion.weapons.ap"]').fill("2");
      await page
        .locator(".developer-toolbar")
        .getByRole("button", { name: "图鉴", exact: true })
        .click();
      await expect(page.locator("#gameDialog")).toBeVisible();
      await page.getByRole("button", { name: "取消修改并切换", exact: true }).click();
      expect(f.read("shared/conversion-rules.json").weapons.ap).toBe(1.5);
    } finally {
      await page.close();
      await app.close();
      f.cleanup();
    }
  });

for (const width of [1440, 390])
  test(`developer WIP navigation adds and removes project unit entries (${width})`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    const f = editorFixture(),
      app = createDeveloperServer({ port: 0, store: f.store, catalog: f.catalog });
    const address = await app.listen();
    try {
      await page.setViewportSize({ width, height: 960 });
      await login(page, "http://127.0.0.1:" + address.port);
      await page
        .locator(".developer-toolbar")
        .getByRole("button", { name: "WIP列表", exact: true })
        .click();
      await expect(page.locator("#wipEditorScreen")).toBeVisible();
      await page.locator("#wipUnitSearch").fill("RX_78_2");
      await page.locator("#wipUnitSelect").selectOption("RX_78_2");
      await page.getByRole("button", { name: "添加单位", exact: true }).click();
      await page.getByRole("button", { name: "保存列表", exact: true }).click();
      await expect(page.locator("#wipEditorScreen [role=status]")).toContainText("已保存");
      expect(f.read("assets/unit-wip.json").units).toContain("RX_78_2");
      expect(
        await page.evaluate(() => Rules.catalog.prefabs.find((u) => u.id === "RX_78_2").wip),
      ).toBe(true);
      await page
        .locator('[data-wip-id="RX_78_2"]')
        .getByRole("button", { name: "移除", exact: true })
        .click();
      await page.getByRole("button", { name: "保存列表", exact: true }).click();
      await expect(page.locator("#wipEditorScreen [role=status]")).toContainText("已保存");
      expect(f.read("assets/unit-wip.json").units).not.toContain("RX_78_2");
      expect(
        await page.evaluate(() => Rules.catalog.prefabs.find((u) => u.id === "RX_78_2").wip),
      ).toBe(false);
    } finally {
      await page.close();
      await app.close();
      f.cleanup();
    }
  });


test("developer uses data-only catalog without unit icons or preview rendering", async ({ page }) => {
  const app = createDeveloperServer({ port: 0 });
  const address = await app.listen();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const images = [];
  page.on("request", (request) => {
    if (request.resourceType() === "image") images.push(request.url());
  });
  try {
    await login(page, "http://127.0.0.1:" + address.port, true);
    await page.locator("#encyclopediaSearch").fill("RX_78_2");
    await page.locator('[data-unit-id="RX_78_2"] button').click();
    await expect(page.locator("#formationUnitDetail")).toBeVisible();
    await expect(page.locator("#formationDetailPreview")).toBeHidden();
    await expect(page.locator("#encyclopediaList img")).toHaveCount(0);
    expect(await page.evaluate(() => Object.keys(Rules.catalog.assets).length)).toBe(0);
    await page.locator("#editUnitProperties").click();
    await expect(page.locator("#unitSourceEditor")).toBeVisible();
    expect(images).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await app.close();
  }
});


test("remote editor completes a slow download and shows transfer progress", async ({ page }) => {
  test.setTimeout(90000);
  const app = createDeveloperServer({ port: 0 });
  const address = await app.listen();
  const { pathToFileURL } = require("node:url");
  const path = require("node:path");
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(pathToFileURL(path.resolve("public/developer.html")).href);
    const network = await page.context().newCDPSession(page);
    await network.send("Network.enable");
    await network.send("Network.emulateNetworkConditions", {
      offline: false, latency: 150, downloadThroughput: 80 * 1024, uploadThroughput: 80 * 1024,
    });
    await page.locator("#editorServerAddress").fill("http://127.0.0.1:" + address.port);
    await page.locator("#editorAccessKey").fill("13450");
    await page.locator("#confirmEditorLogin").click();
    await expect(page.locator("#editorLoginStatus")).toContainText("已接收", { timeout: 20000 });
    await expect(page.locator("#editorDownloadProgress")).toBeVisible();
    await expect.poll(() => page.locator("#editorDownloadProgress").evaluate((bar) => bar.value)).toBeGreaterThan(0);
    expect(await page.locator("#editorDownloadProgress").evaluate((bar) => bar.value)).toBeLessThan(100);
    await expect(page.locator("#editorLoginScreen")).toBeHidden({ timeout: 60000 });
    await expect(page.locator("#encyclopediaScreen")).toBeVisible();
    await page.locator("#encyclopediaWeaponsTab").click();
    await expect(page.locator("#encyclopediaList .weapon-name").first()).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await app.close();
  }
});

test("editor runtime failures stay visible on the login screen", async ({ page }) => {
  const app = createDeveloperServer({ port: 0 });
  const address = await app.listen();
  try {
    await page.goto("http://127.0.0.1:" + address.port + "/developer.html");
    await page.evaluate(() => {
      document.getElementById("catalogRuntime").textContent = 'throw Error("TEST_RUNTIME_FAILURE")';
    });
    await page.locator("#editorAccessKey").fill("13450");
    await page.locator("#confirmEditorLogin").click();
    await expect(page.locator("#editorLoginStatus")).toContainText("编辑界面初始化失败：TEST_RUNTIME_FAILURE", { timeout: 15000 });
    await expect(page.locator("#editorDownloadProgress")).toBeHidden();
    await expect(page.locator("#editorLoginScreen")).toBeVisible();
    await expect(page.locator("#confirmEditorLogin")).toBeEnabled();
  } finally {
    await page.close();
    await app.close();
  }
});


test("shared head vulcan editor agrees with converted AP and saves a final-value adjustment", async ({ page }) => {
  test.setTimeout(60000);
  const f = editorFixture();
  const app = createDeveloperServer({ port: 0, store: f.store, catalog: f.catalog });
  const address = await app.listen();
  try {
    await login(page, "http://127.0.0.1:" + address.port);
    await page.locator("#encyclopediaSearch").fill("RX_78_2");
    await page.locator('[data-unit-id="RX_78_2"] button').click();
    await page.locator('#formationDetailSlots [data-weapon-id="Common_DoubleVulcan_MS"] .edit-common-weapon').click();
    const initialRef = f.read("assets/units/RX_78_2/unit.json").weapons.Common_DoubleVulcan_MS.ref;
    const currentAP = f.store.getWeapon(initialRef).weapon.actionCost;
    await expect(page.locator('[data-field="common.actionCost"]')).toHaveValue(String(currentAP));
    await expect(page.locator('[data-field="common.actionCost"]').locator("..")).toContainText("基准 3 · 调整 " + (currentAP >= 3 ? "+" : "") + (currentAP - 3));
    await page.locator('[data-field="common.actionCost"]').fill("2");
    await page.locator("#commonWeaponEditor").getByRole("button", { name: "保存修改", exact: true }).click();
    await expect(page.locator("#commonWeaponEditor")).not.toBeVisible();
    const ref = f.read("assets/units/RX_78_2/unit.json").weapons.Common_DoubleVulcan_MS.ref;
    expect(f.read("assets/weapons.json").definitions[ref].actionCost).toBe(1);
    expect(f.read("shared/editor-adjustments.json").weapons[ref]["/actionCost"]).toBe(-1);
    expect(f.store.getUnit("RX_78_2").unit.weapons.Common_DoubleVulcan_MS.actionCost).toBe(2);
  } finally {
    await page.close();
    await app.close();
    f.cleanup();
  }
});
