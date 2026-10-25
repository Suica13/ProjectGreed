const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const { waitForRoomSettings } = require("./room-settings-fixture.cjs");

test("RX-78-1 formation explains ejection and offline room uses a clicked legal cell to create the aircraft", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem("slg-language", "zh");
    localStorage.setItem(
      "slg-formations-v1",
      JSON.stringify([
        {
          name: "脱出测试",
          units: [{ unitId: "RX_78_1", kitId: "beam_rifle", customName: "白色一号" }],
        },
      ]),
    );
  });
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.locator("#openFormation").click();
  await page
    .locator(".formation-row")
    .first()
    .getByRole("button", { name: "详情", exact: true })
    .click();
  await expect(page.locator("#formationDetailWeapons")).toContainText("原机体移除");
  await expect(page.locator("#formationDetailWeapons")).toContainText("HP +100%");
  await expect(page.locator("#formationDetailWeapons")).toContainText("修复所有破损部位");
  await page.locator("#closeFormationDetail").click();
  await page.locator("#saveFormation").click();
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await page.locator("#roomUnitCostLimit").fill("1500");
  await waitForRoomSettings(page);
  await page.locator("#startRoomGame").click();
  await page.locator("#confirmFinalFormation").click();
  await expect(page.locator("#deploymentPanel")).toBeVisible();
  await page.locator("#confirmDeployment").click();
  await expect(page.locator("#deploymentPanel")).toBeHidden();
  const original = await page.evaluate(() => {
    const u = game.units.find((u) => Net.owns(u));
    selected = u.id;
    MapCamera.setZoom(3);
    MapCamera.focus(u.x, u.y, { preserveZoom: true });
    update();
    return { id: u.id, x: u.x, y: u.y };
  });
  const button = page.locator('[data-unit-skill="ExitUnit"]');
  await expect(button).toBeEnabled();
  await expect(button).toContainText("独立生成 核心战斗机");
  await button.click();
  const cell = await page.evaluate(() => {
    const u = getUnit(selected);
    const candidates = Rules.skillTargets(game, u, "ExitUnit");
    const cell = candidates.find((c) => c.x === u.x + 1 && c.y === u.y) || candidates[0];
    const p = mapPosition(cell.x, cell.y),
      box = byId("map").getBoundingClientRect();
    return { x: box.left + p.x, y: box.top + p.y, cell };
  });
  await page.mouse.click(cell.x, cell.y);
  await expect
    .poll(() => page.evaluate(() => game.units.find((u) => Net.owns(u))?.model))
    .toBe("FF_X7__standard");
  const craft = await page.evaluate(() => {
    const u = game.units.find((u) => Net.owns(u));
    return {
      x: u.x,
      y: u.y,
      hp: u.hp,
      en: u.en,
      acted: u.acted,
      selected,
      id: u.id,
      old: game.units.some((o) => Net.owns(o) && o.model.startsWith("RX_78_1")),
    };
  });
  expect([craft.x, craft.y]).toEqual([cell.cell.x, cell.cell.y]);
  expect(craft.hp).toBe(8500);
  expect(craft.en).toBe(450);
  expect(craft.acted).toBe(true);
  expect(craft.old).toBe(false);
  expect(craft.selected).toBe(craft.id);
  await expect(page.locator("#unitPartStatus")).toContainText("空军");
  await page.screenshot({ path: ".openai/rx78-ejection.png" });
  expect(errors).toEqual([]);
});

test("RX-78-1 weapon layers and muzzles match the selected kit and melee weapon in both facings", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/developer.html")).href);
  await page.waitForFunction(
    () => typeof SpriteRenderer !== "undefined" && Object.keys(SpriteRenderer.images).length > 0,
  );
  const result = await page.evaluate(() => {
    const issues = [];
    for (const kit of ["machine_gun", "bazooka", "beam_rifle"]) {
      const model = "RX_78_1__" + kit,
        main = UnitModels[model].weapons[0];
      for (const angle of [90, -90]) {
        const sign = angle === 90 ? 1 : -1;
        for (const scale of [0.4, 2]) {
          const point = SpriteRenderer.muzzle(
            model,
            main,
            { x: 100, y: 80, angle, scale },
            null,
            0,
          );
          if (
            Math.abs(point.x - (100 + sign * main.source.barrelY * scale)) > 1e-8 ||
            Math.abs(point.y - (80 + sign * main.source.barrelX * scale)) > 1e-8
          )
            issues.push(kit + ": wrong native muzzle");
        }
      }
      for (const held of [
        main.id,
        "EF_BeamSaber_AF_Fast_A",
        "EF_BeamSaber_Double_AALDF",
        "EF_BeamJavelin_BF_B",
      ]) {
        const layers = SpriteRenderer.visibleLayers(model, held).map((l) => l.name);
        if (held === main.id && !layers.includes(main.id)) issues.push(kit + ": missing main");
        if (held !== main.id && layers.includes(main.id)) issues.push(kit + ": main still held");
        if (held === "EF_BeamSaber_Double_AALDF" && layers.includes("EF_BeamSaber_AF_Fast"))
          issues.push("duplicate right saber");
      }
    }
    const preview = document.createElement("canvas");
    preview.id = "rx78-preview";
    preview.width = 900;
    preview.height = 400;
    preview.style.cssText = "position:fixed;inset:0;z-index:99999;background:#11202b";
    document.body.append(preview);
    const ctx = preview.getContext("2d");
    const kits = ["machine_gun", "bazooka", "beam_rifle"];
    for (let i = 0; i < kits.length; i++) {
      const model = "RX_78_1__" + kits[i],
        main = UnitModels[model].weapons[0];
      SpriteRenderer.draw(ctx, model, 130 + i * 300, 100, 2, 90, null, 0, main.id, false, true);
      SpriteRenderer.draw(
        ctx,
        model,
        130 + i * 300,
        280,
        2,
        -90,
        "Common_Melee_A_Fast",
        0.5,
        "EF_BeamSaber_AF_Fast_A",
        false,
        true,
      );
      ctx.fillStyle = "#ffffff";
      ctx.fillText(kits[i], 80 + i * 300, 170);
    }
    return issues;
  });
  expect(result).toEqual([]);
  await page.locator("#rx78-preview").screenshot({ path: ".openai/rx78-weapons.png" });
});

test("core fighter moves across water and mountains with a rigid body and the native boost loop", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => {
    const unit = ART.units.find((u) => u.id === "FF_X7__standard");
    const boost = unit.decals.find((l) => l.name === "BoostLoop");
    return SpriteRenderer.images[boost.asset]?.complete;
  });
  const result = await page.evaluate(async () => {
    game = Rules.create(false, 1, [
      [{ unitId: "FF_X7", kitId: "standard" }],
      [{ unitId: "MS_06F", kitId: "machine_gun" }],
    ]);
    game.tiles = game.tiles.map((row) => row.map(() => "plain"));
    const u = game.units[0];
    Object.assign(u, { x: 4, y: 4 });
    game.tiles[4][5] = "water";
    game.tiles[4][6] = "rock";
    selected = u.id;
    phase = "idle";
    setPageView("game");
    MapCamera.setZoom(3);
    MapCamera.focus(5, 4, { preserveZoom: true });
    update();
    const boost = ART.units
      .find((a) => a.id === u.model)
      .decals.find((l) => l.name === "BoostLoop");
    const image = SpriteRenderer.images[boost.asset];
    let boostDraws = 0;
    const nativeDraw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (args[0] === image) boostDraws++;
      return nativeDraw.apply(this, args);
    };
    try {
      await performMove(u, 6, 4);
    } finally {
      CanvasRenderingContext2D.prototype.drawImage = nativeDraw;
    }
    return { x: u.x, y: u.y, boostDraws, moved: u.moved, phase };
  });
  expect(result.x).toBe(6);
  expect(result.y).toBe(4);
  expect(result.moved).toBe(true);
  expect(result.phase).toBe("idle");
  expect(result.boostDraws).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
