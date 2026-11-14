const { test, expect } = require("@playwright/test"),
  assert = require("node:assert/strict"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;
async function openFormation(page) {
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => I18n.setLanguage("zh"));
  await page.locator("#shellHangar").click();
}

test("formation share code copies, validates and saves an imported preset", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.evaluate(() => {
    localStorage.removeItem("slg-formations-v1");
    localStorage.removeItem("slg-formations-v1-active");
  });
  await page.reload();
  await page.evaluate(() => {
    I18n.setLanguage("zh");
    document.execCommand = () => false;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value) => (window.__copiedFormation = value) },
    });
  });
  await openFormation(page);
  await page.locator("#formationName").fill("玩家A编组");
  await page.locator("#openFormationShare").click();
  await expect(page.locator("#formationSharePanel")).toBeVisible();
  expect(
    await page.locator("#formationSharePanel").evaluate((el) => el.parentElement === document.body),
  ).toBe(true);
  await page.locator("#generateFormationShare").click();
  let code = await page.locator("#formationShareCode").inputValue();
  assert.match(code, /^PGF1\.[A-Za-z0-9_-]+$/);
  const expectedUnits = await page.evaluate(() =>
    Formation.current().map(({ unitId, kitId, preload }) => ({
      unitId,
      kitId,
      ...(preload ? { preload } : {}),
    })),
  );
  assert.equal(await page.evaluate(() => window.__copiedFormation), code);
  await expect(page.locator("#toast")).toHaveText("分享代码已复制。");
  const payload = JSON.parse(Buffer.from(code.slice(5), "base64url").toString("utf8"));
  expect(payload.units.every((u) => !u.customPilot && !u.pilotId)).toBe(true);
  payload.units[0].customPilot = { id: "foreign", name: "Must not import" };
  payload.units[0].pilotId = "foreign";
  code = "PGF1." + Buffer.from(JSON.stringify(payload)).toString("base64url");

  await page.locator("#closeFormationShare").click();
  await expect(page.locator("#openFormationShare")).toBeFocused();
  const before = await page.locator("#formationSelect option").count();
  const economyBefore = await page.evaluate(()=>Economy.snapshot());
  await page.locator("#openFormationShare").click();
  await page.locator("#formationShareCode").fill(code);
  await page.locator("#loadSharedFormation").click();
  await expect(page.locator("#formationSharePanel")).toBeHidden();
  await expect(page.locator("#formationSelect option")).toHaveCount(before + 1);
  await expect(page.locator("#formationName")).toHaveValue("玩家A编组 (2)");
  const saved = await page.evaluate(() => {
    const key = "slg-formations-v1." + Formation.group();
    const { squads } = JSON.parse(localStorage.getItem(key));
    return { active: localStorage.getItem(key + "-active"), last: squads.at(-1) };
  });
  assert.equal(saved.active, String(before));
  assert.equal(saved.last.name, "玩家A编组 (2)");
  assert(saved.last.units.length > 0);
  assert(saved.last.units.every((u) => !u.customPilot && !u.pilotId));
  assert(saved.last.units.some((unit) => unit.preload));
  expect(saved.last.units).toEqual(expectedUnits);
  expect(await page.evaluate(()=>Economy.snapshot())).toEqual(economyBefore);
  await page.reload();
  await openFormation(page);
  await expect(page.locator("#formationName")).toHaveValue("玩家A编组 (2)");
  expect(await page.evaluate(() => Formation.current())).toEqual(expectedUnits);

  await page.locator("#openFormationShare").click();
  await page.locator("#formationShareCode").fill("not-a-share-code");
  await page.locator("#loadSharedFormation").click();
  await expect(page.locator("#formationSharePanel")).toBeVisible();
  await expect(page.locator("#formationSelect option")).toHaveCount(before + 1);
  await expect(page.locator("#toast")).toHaveText("编组分享代码无效。");
  assert.deepEqual(errors, []);
});

test("formation share panel fits a compact landscape screen and traps keyboard focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(url);
  await page.evaluate(() => I18n.setLanguage("zh"));
  await openFormation(page);
  await page.locator("#openFormationShare").click();
  const geometry = await page
    .locator("#formationSharePanel .formation-share-dialog")
    .evaluate((el) => {
      const box = el.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    });
  assert(
    geometry.left >= 0 && geometry.right <= 844 && geometry.top >= 0 && geometry.bottom <= 390,
  );
  await page.locator("#generateFormationShare").focus();
  await page.locator("#generateFormationShare").press("Tab");
  await expect(page.locator("#closeFormationShare")).toBeFocused();
  await page.locator("#closeFormationShare").press("Shift+Tab");
  await expect(page.locator("#generateFormationShare")).toBeFocused();
});

for (const width of [1440, 390])
  test(`legacy free formation import restores its editor at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto(url);
    await openFormation(page);
    const payload = {
      version: 1,
      name: "旧版自由编组",
      units: [{ unitId: "Type61", kitId: "standard" }],
    };
    const code = "PGF1." + Buffer.from(JSON.stringify(payload)).toString("base64url");
    await page.locator("#openFormationShare").click();
    await page.locator("#formationShareCode").fill(code);
    await page.locator("#loadSharedFormation").click();
    await expect(page.locator("#formationEditorStyle")).toHaveValue("free");
    await expect(page.locator("#formationBudget")).toContainText("单位容量点");
    await page.reload();
    await openFormation(page);
    await expect(page.locator("#formationEditorStyle")).toHaveValue("free");
    expect(await page.evaluate(() => Formation.current())).toEqual(payload.units);
  });

test("malformed imports do not modify presets and storage failure is not reported as saved", async ({
  page,
}) => {
  await page.goto(url);
  await openFormation(page);
  const count = await page.locator("#formationSelect option").count();
  await page.locator("#openFormationShare").click();
  await page
    .locator("#formationShareCode")
    .fill(
      "PGF1." +
        Buffer.from(JSON.stringify({ version: 1, name: "bad", units: [null] })).toString(
          "base64url",
        ),
    );
  await page.locator("#loadSharedFormation").click();
  await expect(page.locator("#formationSelect option")).toHaveCount(count);
  await expect(page.locator("#formationSharePanel")).toBeVisible();
  await expect(page.locator("#toast")).toHaveText("编组分享代码无效。");
  const code = await page.evaluate(() => {
    const payload = { version: 1, name: "Session only", units: Economy.starterFormation() };
    const original = Storage.prototype.setItem;
    window.__restoreStorage = () => (Storage.prototype.setItem = original);
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("slg-formations-v1."))
        throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, key, value);
    };
    return "PGF1." + btoa(JSON.stringify(payload));
  });
  await page.locator("#formationShareCode").fill(code);
  await page.locator("#loadSharedFormation").click();
  await expect(page.locator("#formationName")).toHaveValue("Session only");
  await expect(page.locator("#toast")).toHaveText(
    "分享编组已加载，但浏览器无法保存，请检查存储空间。",
  );
  await page.evaluate(() => window.__restoreStorage());
});
