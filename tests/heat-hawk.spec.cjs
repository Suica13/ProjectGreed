const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

test("actual Zaku draw renders one axe layer and flips during the swing", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const result = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1050;
    canvas.height = 700;
    canvas.id = "heatHawkPreview";
    Object.assign(canvas.style, { position: "fixed", inset: "0", zIndex: "99999" });
    document.body.append(canvas);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#152530";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const draws = [];
    for (const [row, unit] of ["MS_06F", "MS_06J", "MS_06F2"].entries()) {
      for (const [column, time] of [0.4, 0.8, 2].entries()) {
        const model = unit + "__machine_gun";
        const axe = rendererAxeImage(model);
        let count = 0;
        const drawImage = ctx.drawImage;
        ctx.drawImage = function (image, ...args) {
          if (image === axe) count++;
          return drawImage.call(this, image, ...args);
        };
        SpriteRenderer.draw(
          ctx,
          model,
          160 + column * 350,
          120 + row * 220,
          2.5,
          90,
          "Common_Melee_A",
          time,
          "ZN_HeatHawk_A",
          false,
        );
        ctx.drawImage = drawImage;
        ctx.fillStyle = "#ffffff";
        ctx.font = "16px sans-serif";
        ctx.fillText(`${unit} / ${time}s`, 60 + column * 350, 210 + row * 220);
        draws.push(count);
      }
    }
    function rendererAxeImage(model) {
      const layer = SpriteRenderer.models[model].decals.find((l) => l.name === "ZN_HeatHawk_A");
      return SpriteRenderer.images[layer.asset];
    }
    return draws;
  });
  expect(result).toEqual(Array(9).fill(1));
  await page.locator("#heatHawkPreview").screenshot({ path: ".openai/heat-hawk-switch.png" });
  expect(errors).toEqual([]);
});
