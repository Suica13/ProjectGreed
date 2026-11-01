const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
const tree = require("../shared/development-tree.json");
const url = pathToFileURL(path.resolve("public/client.html")).href;
async function ready(page) {
  await page.waitForFunction(() => typeof assetsReady !== "undefined" && assetsReady);
}
test("all three 0087 trees and unit details remain masked before complete 0079/0083 research", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await ready(page);
  await page.evaluate(() => document.getElementById("openDevelopment").click());
  for (const faction of ["AEUG", "TITANS", "NEO_ZEON"]) {
    await page.locator("#developmentFactionSelect").selectOption(faction);
    await expect(page.locator(".development-era-lock")).toHaveCount(1);
    await expect(page.locator(".development-workspace > .development-era-lock")).toHaveText(
      "请先完成任何0079科技树",
    );
    const coverage = await page.evaluate(() => {
      const scroll = document.querySelector(".development-tree-scroll");
      scroll.scrollTop = scroll.scrollHeight;
      const area = document.querySelector(".development-workspace").getBoundingClientRect();
      const mask = document.querySelector(".development-era-lock").getBoundingClientRect();
      return (
        mask.top <= area.top + 1 &&
        mask.bottom >= area.bottom - 1 &&
        mask.left <= area.left + 1 &&
        mask.right >= area.right - 1
      );
    });
    expect(coverage).toBe(true);
    expect(
      await page
        .locator("#developmentMain")
        .evaluate((el) => el.classList.contains("development-era-locked")),
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});
test("completed legacy tree opens free BASE, new faction starts empty, old saves round-trip and reload works", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    ({ ids }) =>
      localStorage.setItem(
        "projectgreed.developmentProgress.v1",
        JSON.stringify({ points: { EFSF: 0, ZEON: 0 }, claimed: {}, researched: { EFSF: ids } }),
      ),
    { ids: tree.EFSF.map((n) => n.id) },
  );
  await page.goto(url);
  await ready(page);
  await page.locator("#menuFactionSelect").selectOption("TITANS");
  expect(await page.evaluate(() => Formation.current().length)).toBe(0);
  const result = await page.evaluate(() => {
    const exported = ProfileSave.exportData();
    for (const f of ["AEUG", "TITANS", "NEO_ZEON"]) {
      delete exported.pilots[f];
      delete exported.formations[f];
      delete exported.development.points[f];
    }
    const old = ProfileSave.validate(exported);
    return {
      points: old.development.points.TITANS,
      pilots: old.pilots.TITANS.pilots.length,
      formation: old.formations.TITANS,
    };
  });
  expect(result).toEqual({ points: 0, pilots: 0, formation: null });
  await page.evaluate(() => document.getElementById("openDevelopment").click());
  await expect(page.locator("#developmentFactionSelect")).toHaveValue("TITANS");
  await expect(page.locator(".development-era-lock")).toHaveCount(0);
  await expect(page.locator('[data-tech-id="Tech_TITANS_0087_BaseTech"]')).toHaveAttribute(
    "data-state",
    "unlocked",
  );
  await page.screenshot({ path: "tmp/0087-tech-unlocked.png" });
  await page.reload();
  await ready(page);
  expect(await page.evaluate(() => PlayerProfile.faction())).toBe("TITANS");
  expect(errors).toEqual([]);
});

test("0087 kit labels stay correct through language switches and cluster fragments render with loaded assets", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await ready(page);
  await page.evaluate(() => Formation.previewUnit("RMS_179_AEUG"));
  await expect(page.locator('#formationDetailKit option[value="kit_2"]')).toContainText(
    "90mm机枪套件",
  );
  await expect(page.locator('#formationDetailKit option[value="kit_0"]')).toContainText(
    "光束步枪套件",
  );
  await page.evaluate(() => I18n.setLanguage("en"));
  await expect(page.locator('#formationDetailKit option[value="kit_2"]')).toContainText(
    "Machine Gun",
  );
  await page.evaluate(() => I18n.setLanguage("zh"));
  await expect(page.locator('#formationDetailKit option[value="kit_2"]')).toContainText(
    "90mm机枪套件",
  );
  const count = await page.evaluate(async () => {
    const model = Object.values(UnitModels).find(
      (m) => m.prefabId === "RMS_099" && m.weapons.some((w) => w.projectile?.cluster),
    );
    const w = model.weapons.find((w) => w.projectile?.cluster);
    const keys = SpriteRenderer.battleKeys({
      units: [{ model: model.prefabId + "__" + model.kitId }],
    });
    if (!keys.includes(w.projectile.cluster.asset))
      throw Error("Fragment texture missing from battle preload");
    await SpriteRenderer.ensureAssets(keys);
    const source = {
      unit: { id: "a", model: model.prefabId + "__" + model.kitId },
      x: 100,
      y: 100,
      angle: 90,
      scale: 1,
    };
    const target = { unit: { id: "b", model: "RGM_79__machine_gun" }, x: 600, y: 100, scale: 1 };
    const event = { hit: true, damage: 1000 },
      plan = WeaponEffects.plan(w, source, target, event);
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 250;
    const ctx = canvas.getContext("2d");
    const carrier = plan.shots.find((s) => !s.isFragment);
    WeaponEffects.draw(ctx, w, plan, carrier.splitAt + 0.05, source, event);
    const pixels = ctx.getImageData(0, 0, 800, 250).data;
    return {
      fragments: plan.shots.filter((s) => s.isFragment).length,
      painted: pixels.some((v, i) => i % 4 === 3 && v > 0),
    };
  });
  expect(count).toEqual({ fragments: 12, painted: true });
  expect(errors).toEqual([]);
});
