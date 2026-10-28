const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;
for (const width of [1440, 390])
  test(`only early tech is visible and fits three columns at ${width}px`, async ({ page }) => {
    test.setTimeout(60000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto(url);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => I18n.setLanguage("zh"));
    await page.locator("#shellHangar").click();
    await page.locator("#shellSubnav").getByRole("button", { name: "开发", exact: true }).click();
    for (const faction of ["EFSF", "ZEON"]) {
      await page.selectOption("#developmentFactionSelect", faction);
      await expect(page.locator("#developmentPageSelect")).toBeHidden();
      await expect(page.locator('#developmentPageSelect option[value="1"]')).toHaveCount(0);
      await expect(page.locator("#developmentTree .development-node")).toHaveCount(
        faction === "EFSF" ? 8 : 9,
      );
      expect(
        await page.evaluate(() => DEVELOPMENT_TREE.EFSF.filter((node) => node.page === 1).length),
      ).toBe(10);
      await page.waitForTimeout(150);
      const layout = await page.evaluate(() => {
        const graph = document.getElementById("developmentTree");
        const scroll = graph.closest(".development-tree-scroll");
        const bounds = scroll.getBoundingClientRect();
        const cards = [...graph.querySelectorAll(".development-node")].map((card) =>
          card.getBoundingClientRect(),
        );
        const pageSelect = document.getElementById("developmentPageSelect").getBoundingClientRect();
        return {
          overflow: scroll.scrollWidth - scroll.clientWidth,
          left: Math.min(...cards.map((card) => card.left)) - bounds.left,
          right: Math.max(...cards.map((card) => card.right)) - bounds.right,
          selectRight: pageSelect.right,
          headingOverlap:
            document.querySelector(".development-heading").getBoundingClientRect().bottom -
            bounds.top,
          identityOverlap:
            pageSelect.bottom -
            document.querySelector(".development-faction-identity").getBoundingClientRect().top,
          bodyOverflow: document.documentElement.scrollWidth - innerWidth,
        };
      });
      expect(layout.overflow).toBeLessThanOrEqual(1);
      expect(layout.left).toBeGreaterThanOrEqual(-1);
      expect(layout.right).toBeLessThanOrEqual(1);
      expect(layout.selectRight).toBeLessThanOrEqual(width);
      expect(layout.bodyOverflow).toBeLessThanOrEqual(1);
      expect(layout.headingOverlap).toBeLessThanOrEqual(1);
      expect(layout.identityOverlap).toBeLessThanOrEqual(1);
    }
    await page.screenshot({ path: `.openai/page-two-tech-${width}.png` });
    expect(errors).toEqual([]);
  });

test("shared clips load and render representative late MS, MA and ship loadouts", async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => SpriteRenderer.load());
  const samples = await page.evaluate(() => {
    const ids = [
      "RGM_79SC",
      "RX_78GP01",
      "RX_78GP02A",
      "RX_80PR_SpaceType_HADES",
      "MA_08",
      "MSN_02",
      "AlbionClass",
    ];
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 800;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#20242c";
    ctx.fillRect(0, 0, 1600, 800);
    const result = ids.map((id, index) => {
      const [model, data] = Object.entries(ART.models).find(([, model]) => model.prefabId === id);
      const layers = SpriteRenderer.visibleLayers(model);
      if (
        !layers.length ||
        layers.some((layer) => !SpriteRenderer.images[layer.asset]?.naturalWidth)
      )
        throw Error("missing art " + id);
      const weapon = data.weapons[0];
      const pose = weapon && WeaponSequence.pose(weapon, weapon.attack.shots[0]);
      SpriteRenderer.draw(
        ctx,
        model,
        150 + (index % 4) * 390,
        index < 4 ? 200 : 600,
        0.9,
        90,
        pose?.clip || null,
        pose?.time || 0,
        weapon?.id,
        false,
      );
      ctx.fillStyle = "#fff";
      ctx.fillText(id, 75 + (index % 4) * 390, index < 4 ? 340 : 740);
      return { id, layers: layers.length };
    });
    document.body.replaceChildren(canvas);
    return result;
  });
  expect(samples).toHaveLength(7);
  await page.screenshot({ path: ".openai/page-two-render.png" });
  expect(errors).toEqual([]);
});
