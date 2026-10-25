const { test, expect } = require("@playwright/test"),
  assert = require("node:assert/strict"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;

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
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value) => (window.__copiedFormation = value) },
    });
  });
  await page.locator("#openFormation").click();
  await page.locator("#formationName").fill("玩家A编组");
  await page.locator("#openFormationShare").click();
  await expect(page.locator("#formationSharePanel")).toBeVisible();
  await page.locator("#generateFormationShare").click();
  const code = await page.locator("#formationShareCode").inputValue();
  assert.match(code, /^PGF1\.[A-Za-z0-9_-]+$/);
  assert.equal(await page.evaluate(() => window.__copiedFormation), code);
  await expect(page.locator("#toast")).toHaveText("分享代码已复制。");

  await page.locator("#closeFormationShare").click();
  await expect(page.locator("#openFormationShare")).toBeFocused();
  const before = await page.locator("#formationSelect option").count();
  await page.locator("#openFormationShare").click();
  await page.locator("#formationShareCode").fill(code);
  await page.locator("#loadSharedFormation").click();
  await expect(page.locator("#formationSharePanel")).toBeHidden();
  await expect(page.locator("#formationSelect option")).toHaveCount(before + 1);
  await expect(page.locator("#formationName")).toHaveValue("玩家A编组");
  const saved = await page.evaluate(() => {
    const squads = JSON.parse(localStorage.getItem("slg-formations-v1"));
    return { active: localStorage.getItem("slg-formations-v1-active"), last: squads.at(-1) };
  });
  assert.equal(saved.active, String(before));
  assert.equal(saved.last.name, "玩家A编组");
  assert(saved.last.units.length > 0);
  assert(saved.last.units.some((unit) => unit.preload));

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
  await page.locator("#openFormation").click();
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
