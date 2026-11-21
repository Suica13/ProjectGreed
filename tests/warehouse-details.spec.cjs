const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"), path = require("node:path"), P = require("../shared/pilots");
for (const width of [1440, 390]) test("damaged warehouse detail, pilot assignment and selected transformation at " + width, async ({ page }) => {
  test.setTimeout(120000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width, height: 960 });
  await page.addInitScript((pilot) => {
    if (!localStorage.getItem("projectgreed.custom-pilots.v3.shared"))
      localStorage.setItem("projectgreed.custom-pilots.v3.shared", JSON.stringify({ pilots: [pilot], awards: [] }));
  }, P.createCustom("custom-warehouse-detail", "WarehousePilot超级长名称超级长名称超级长名称"));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  // Explicit level-three fixture for cross-page stock relocation.
  await page.evaluate(() => {const p=Economy.snapshot();p.baseFacilities.levels={hq:3,factory:2,giantFactory:3,beacon:3,academy:1};localStorage.setItem(Economy.key,SaveCodec.stringify(p));});
  await page.reload();await page.waitForFunction(()=>assetsReady);
  await page.evaluate(() => {
    I18n.setLanguage("zh");
    Economy.creditActivity({ id: "detail-fixture", matchId: "detail-fixture", money: 100000, supplies: 100000,
      inventory: { RGM_79: 2, RGZ_91_MA: 1, MSZ_006: 1, MTank: 1, FF_X7: 1, Medea: 1, WhiteBase: 1 } });
    const item = Economy.snapshot().storage.units.find((item) => item.unitId === "RGM_79"), model = UnitModels[item.unitId + "__" + item.kitId];
    Economy.creditAward({ id: "detail-damage", matchId: "detail-battle", money: 0, supplies: 0, stockStates: [
      { stockId: item.id, unitId: item.unitId, kitId: item.kitId, hp: model.hp / 2, en: 10, brokenParts: { leftArm: true } }] });
  });
  await page.locator("#shellHangar").click();
  await expect(page.locator(".warehouse-card-zoom")).toHaveCount(0);
  await page.locator('.warehouse-bay[data-slot="0"]').click();
  const detail = page.locator("#warehouseDialog");
  await expect(detail).toBeVisible();
  await expect(detail.locator(".warehouse-detail-preview canvas")).toHaveAttribute("data-preview-angle", "180");
  expect(await detail.locator("canvas").evaluate((canvas) => canvas.previewParts)).toEqual({ leftArm: true });
  await expect(detail.locator('.warehouse-part[data-part-id="leftArm"]')).toHaveClass(/is-broken/);
  await expect(detail.locator('[role="meter"][aria-label="EN"]')).toHaveAttribute("aria-valuenow", "10");
  await expect(detail.locator("#warehouseMainStats")).toContainText("命中系数");
  await expect(detail.locator('#warehousePrimaryAttributes')).toContainText('伤害加成');
  await expect(detail.locator('#warehousePrimaryAttributes')).toBeVisible();
  await detail.getByRole('button',{name:'次要属性',exact:true}).click();
  await expect(detail.locator('#warehousePrimaryAttributes')).toBeHidden();
  await expect(detail.locator('#warehouseSecondaryAttributes')).toContainText('防护与结构');
  await expect(detail.locator('#warehouseSecondaryAttributes')).toContainText('适应性');
  const expectedSecondary = await page.evaluate(()=>{
    const stock=Economy.snapshot().storage.units[0],model=UnitModels[stock.unitId+'__'+stock.kitId];
    return {bonuses:Object.values(model.attackBonuses).map(value=>(value>=0?'+':'')+value+'%'),adaptability:['ground','mountain','space','water','atmosphere','air','forest','snow','desert','rubble'].map(key=>(model.adaptability[key]??0)+'%')};
  });
  expect(await detail.locator('#warehouseAttackBonuses dd').allTextContents()).toEqual(expectedSecondary.bonuses);
  expect(await detail.locator('#warehouseAdaptability dd').allTextContents()).toEqual(expectedSecondary.adaptability);
  await detail.getByRole('button',{name:'主要属性',exact:true}).click();
  await expect(detail.locator(".unit-preview-camera-controls")).toHaveCount(0);
  await expect(detail.locator(".warehouse-form-actions button")).toHaveCount(1);
  await expect(detail.locator("#warehouseTransform")).toBeDisabled();
  await expect(detail.locator("#warehouseOpenCatalog")).toBeVisible();
  await expect(detail.locator("button.warehouse-condition")).toHaveCount(0);
  await expect(detail.locator(".warehouse-slots-wip")).toHaveText("WIP");
  await expect(detail.locator(".warehouse-detail-parts h3")).toHaveText("部位状态");
  await expect(detail.locator("#warehouseDialogTags .unit-tags-more")).toHaveCount(0);
  const expectedTags = await page.evaluate(() => UnitPreview.unitTags(UnitModels[Economy.snapshot().storage.units[0].unitId + "__" + Economy.snapshot().storage.units[0].kitId], { limit: Infinity }).textContent);
  await expect(detail.locator("#warehouseDialogTags")).toHaveText(expectedTags);
  await expect(detail.locator(".warehouse-detail-preview .era-tag, .warehouse-detail-preview .faction-tag")).toHaveCount(0);
  const fixedParts = await detail.locator(".warehouse-detail-parts").evaluate((node) => node.getBoundingClientRect().height);
  const costHeight = await detail.locator(".warehouse-preview-cost").evaluate((node) => node.getBoundingClientRect().height);
  expect(costHeight).toBe(await detail.locator("#warehouseOpenCatalog").evaluate((node) => node.getBoundingClientRect().height));
  const controls = await detail.evaluate((node) => {
    const kit = node.querySelector(".warehouse-kit-field").getBoundingClientRect(), forms = node.querySelector(".warehouse-form-actions").getBoundingClientRect(),
      move = node.querySelector("#warehouseRelocate").getBoundingClientRect(), sell = node.querySelector("#warehouseSellUnit").getBoundingClientRect();
    return { alongside: kit.right <= forms.x && kit.bottom === forms.bottom, equal: Math.abs(move.width - sell.width) < 1, overflow: getComputedStyle(node.querySelector(".warehouse-detail-status")).overflowY };
  });
  expect(controls.alongside).toBe(true);
  expect(controls.equal).toBe(true);
  expect(controls.overflow).toBe("visible");
  const layout = await detail.evaluate((node) => {
    const rect = (selector) => node.querySelector(selector).getBoundingClientRect(),
      kit = rect("#warehouseDetailKit"), pilot = rect(".warehouse-detail-pilot"),
      basic = rect(".warehouse-detail-basic"), slots = rect(".warehouse-part-slots"),
      rows = [...node.querySelectorAll(".warehouse-part")].map((row) => row.getBoundingClientRect().y);
    return { ordered: kit.bottom <= pilot.y,
      paired: rows[0] === rows[1] && rows[2] > rows[0], basicWidth: basic.width, slotsWidth: slots.width,
      sideBySide: basic.right <= slots.x };
  });
  expect(layout.ordered).toBe(true);
  expect(layout.paired).toBe(true);
  if (width > 720) {
    expect(layout.sideBySide).toBe(true);
    expect(Math.abs(layout.basicWidth - layout.slotsWidth)).toBeLessThan(2);
  }
  const boxes = await detail.evaluate((node) => {
    const preview = node.querySelector(".warehouse-detail-preview").getBoundingClientRect(), status = node.querySelector(".warehouse-detail-status").getBoundingClientRect();
    return { preview: { x: preview.x, y: preview.y, right: preview.right, bottom: preview.bottom, height: preview.height }, status: { x: status.x, y: status.y, height: status.height }, overflow: node.scrollWidth > node.clientWidth + 1 };
  });
  expect(boxes.overflow).toBe(false);
  if (width > 720) expect(boxes.preview.right).toBeLessThanOrEqual(boxes.status.x);
  else expect(boxes.preview.bottom).toBeLessThanOrEqual(boxes.status.y);
  await page.screenshot({ path: `tmp/verification/screenshots/warehouse-detail-${width}.png` });
  await page.locator("#warehouseOpenCatalog").click();
  await expect(page.locator("#formationUnitDetail")).toBeVisible();
  await expect(page.locator("#warehouseDialog")).not.toBeVisible();
  await page.locator("#closeFormationDetail").click();
  await expect(detail).toBeVisible();
  await expect(page.locator("#warehouseOpenCatalog")).toBeFocused();
  await page.locator("#warehouseAssignPilot").click();
  await page.locator('.warehouse-pilot-choice[data-pilot-id="custom-warehouse-detail"]').click();
  await expect(detail.locator(".warehouse-detail-pilot")).toContainText("WarehousePilot");
  const pilotLayout = await detail.evaluate((node) => {
    const name = node.querySelector(".warehouse-pilot-name").getBoundingClientRect(), button = node.querySelector("#warehouseAssignPilot").getBoundingClientRect();
    return { right: name.right <= button.x, width: button.width, sameRow: button.y < name.bottom && button.bottom > name.y };
  });
  expect(pilotLayout.right).toBe(true);
  expect(pilotLayout.sameRow).toBe(true);
  expect(pilotLayout.width).toBeLessThan(140);
  if (width < 720) await expect(detail.locator(".warehouse-pilot-name")).toHaveClass(/is-scrolling/);
  const swapping = await page.evaluate(() => Economy.snapshot().storage.units.slice(0, 2));
  await page.locator("#warehouseRelocate").click();
  await expect(page.locator('.warehouse-relocate-choice[data-slot="0"]')).toBeDisabled();
  await expect(page.locator("#warehouseRelocatePage")).toHaveText("1 / 3 页");
  await expect(page.locator("#warehouseRelocatePrevious")).toBeDisabled();
  await page.locator("#warehouseRelocateNext").click();
  await page.locator('.warehouse-relocate-choice[data-slot="8"]').click();
  expect(await page.evaluate(id => Economy.snapshot().storage.units.find(item => item.id === id).slot, swapping[0].id)).toBe(8);
  await page.locator("#warehouseRelocate").click();
  await page.locator("#warehouseRelocatePrevious").click();
  await page.screenshot({ path: `tmp/verification/screenshots/warehouse-relocate-${width}.png` });
  const cards = await page.locator(".warehouse-relocate-choice").evaluateAll((nodes) => nodes.map((node) => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
  expect(new Set(cards.map((card) => card.height)).size).toBe(1);
  expect(Math.max(...cards.map((card) => card.width)) - Math.min(...cards.map((card) => card.width))).toBeLessThan(1);
  await page.locator('.warehouse-relocate-choice[data-slot="1"]').click();
  expect(await page.evaluate(id => Economy.snapshot().storage.units.find(item => item.id === id).slot, swapping[1].id)).toBe(8);
  await page.locator("#warehouseRelocate").click();
  await page.locator("#warehouseRelocateNext").click();
  await page.locator('.warehouse-relocate-choice[data-slot="8"]').click();
  await page.locator("#warehouseRelocate").click();
  await page.locator("#warehouseRelocatePrevious").click();
  await page.locator('.warehouse-relocate-choice[data-slot="0"]').click();
  const before = await page.evaluate(() => Economy.snapshot().storage.units[0]);
  const options = await page.locator("#warehouseDetailKit option").evaluateAll((nodes) => nodes.map((node) => node.value));
  if (options.length > 1) await page.locator("#warehouseDetailKit").selectOption(options.find((kit) => kit !== before.kitId));
  expect(await page.evaluate(() => Economy.snapshot().storage.units[0].hp)).toBe(before.hp);
  await page.locator("#warehouseClose").click();
  await page.locator('.warehouse-bay[data-slot="1"]').click();
  await page.locator("#warehouseAssignPilot").click();
  await expect(page.locator('.warehouse-pilot-choice[data-pilot-id="custom-warehouse-detail"]')).toBeDisabled();
  await page.locator("#warehouseClose").click();
  await page.locator('.warehouse-bay[data-slot="2"]').click();
  await expect(page.locator("#warehouseTransform")).toBeDisabled();
  await expect(page.locator("#warehouseArmorPurge")).toBeEnabled();
  const transformId = await page.evaluate(() => Economy.snapshot().storage.units.find((item) => item.unitId === "RGZ_91_MA").id);
  await page.locator("#warehouseArmorPurge").click();
  await expect(page.locator('.warehouse-form-choice[data-form-id="RGZ_91"] img')).toBeVisible();
  await expect(page.locator('.warehouse-form-choice[data-form-id="RGZ_91"] strong')).not.toBeEmpty();
  await page.locator('.warehouse-form-choice[data-form-id="RGZ_91"]').click();
  expect(await page.evaluate((id) => Economy.snapshot().storage.units.find((item) => item.id === id).unitId, transformId)).toBe("RGZ_91");
  await page.locator("#warehouseClose").click();
  await page.locator('.warehouse-bay[data-slot="3"]').click();
  await page.locator("#warehouseDetailKit").selectOption("kit_1");
  await page.locator("#warehouseTransform").click();
  await expect(page.locator('.warehouse-form-choice[data-form-id="MSZ_006_MA"] img')).toBeVisible();
  await page.screenshot({ path: `tmp/verification/screenshots/warehouse-transform-${width}.png` });
  await page.locator('.warehouse-form-choice[data-form-id="MSZ_006_MA"]').click();
  await expect(page.locator("#warehouseDetailKit")).toHaveValue("kit_1");
  await expect(page.locator(".warehouse-detail-preview canvas")).toHaveAttribute("data-preview-model", /MSZ_006_MA/);
  await expect(page.locator('#warehouseSellUnit')).toBeDisabled();
  await page.locator("#warehouseOpenCatalog").click();
  await expect(page.locator("#formationUnitDetail")).toBeVisible();
  await expect(page.locator("#formationDetailKit")).toHaveValue("kit_1");
  await page.screenshot({ path: `tmp/verification/screenshots/warehouse-catalog-${width}.png` });
  await page.locator("#closeFormationDetail").click();
  expect(await page.locator(".warehouse-detail-preview").evaluate((node) => node.getBoundingClientRect().height)).toBe(boxes.preview.height);
  expect(await page.locator(".warehouse-detail-status").evaluate((node) => node.getBoundingClientRect().height)).toBe(boxes.status.height);
  await page.locator("#warehouseClose").click();
  await page.locator('.warehouse-bay[data-slot="4"]').click();
  await expect(page.locator(".warehouse-form-actions button")).toHaveCount(1);
  await expect(page.locator("#warehouseTransform")).toBeDisabled();
  await expect(page.locator("#warehouseEscape")).toHaveCount(0);
  await page.locator("#warehouseSellUnit").click();
  await page.locator("#gameDialog").getByRole("button", { name: "取消", exact: true }).click();
  await expect(detail).toBeVisible();
  expect(await page.evaluate(() => Economy.quantity("MTank"))).toBe(1);
  await page.locator("#warehouseSellUnit").click();
  await page.locator("#gameDialog").getByRole("button", { name: "确认", exact: true }).click();
  await expect(detail).not.toBeVisible();
  expect(await page.evaluate(() => Economy.quantity("MTank"))).toBe(0);
  await page.locator('.warehouse-bay[data-slot="5"]').click();
  await expect(page.locator(".warehouse-detail-parts")).toContainText("无可破坏部位");
  expect(await page.locator(".warehouse-detail-parts").evaluate((node) => node.getBoundingClientRect().height)).toBe(fixedParts);
  await page.locator("#warehouseClose").click();
  await page.locator("#warehouseShips").click();
  await page.locator('.warehouse-bay[data-slot="0"]').click();
  expect(await page.locator(".warehouse-detail-preview").evaluate((node) => node.getBoundingClientRect().height)).toBe(boxes.preview.height);
  expect(await page.locator(".warehouse-detail-status").evaluate((node) => node.getBoundingClientRect().height)).toBe(boxes.status.height);
  await expect(page.locator("#warehouseDeployment")).toHaveText("部署");
  await expect(page.locator(".warehouse-detail-parts")).toHaveClass(/is-ship/);
  await page.locator("#warehouseDeployment").click();
  await page.locator('.warehouse-form-choice[data-form-id="Medea_DeployState"]').click();
  await expect(page.locator("#warehouseDeployment")).toHaveText("解除部署");
  await page.locator("#warehouseDeployment").click();
  await page.locator('.warehouse-form-choice[data-form-id="Medea"]').click();
  await page.locator("#warehouseClose").click();
  await page.locator('.warehouse-bay[data-slot="1"]').click();
  await expect(page.locator('#warehouseSellUnit')).toBeEnabled();
  await page.locator('#warehouseSellUnit').click();
  await expect(page.locator('#gameDialog')).toContainText('资金 0、物资 0');
  await page.locator('#gameDialog').getByRole('button',{name:'取消',exact:true}).click();
  const shipParts = await page.locator(".warehouse-detail-parts.is-ship .warehouse-parts-grid").evaluate((node) => ({ height: node.clientHeight, row: node.firstElementChild.getBoundingClientRect().height, scroll: node.scrollHeight > node.clientHeight }));
  expect(shipParts.height).toBe(shipParts.row * 3);
  expect(shipParts.scroll).toBe(true);
  expect(await page.locator(".warehouse-detail-parts").evaluate((node) => node.getBoundingClientRect().height)).toBe(fixedParts);
  expect(await page.locator(".warehouse-detail-status").evaluate((node) => node.scrollHeight <= node.clientHeight)).toBe(true);
  await page.screenshot({ path: `tmp/verification/screenshots/warehouse-ship-parts-${width}.png` });
  await page.evaluate(() => {
    const items = Economy.snapshot().storage.units.filter((item) => item.unitId === "RGM_79");
    localStorage.setItem("slg-formations-v1.PMC", JSON.stringify({ version: 3, squads: [{ name: "Stored pilots", units: [
      { unitId: "Medea", kitId: "standard" }, ...items.map((item) => ({ unitId: item.unitId, kitId: item.kitId,
        preload: { carrierIndex: 0, hangarId: "Hangar_1" } }))] }] }));
    localStorage.setItem("slg-formations-v1.PMC-active", "0");
  });
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  expect(await page.evaluate(() => Economy.snapshot().storage.units[0].pilotId)).toBe("custom-warehouse-detail");
  expect(await page.evaluate(() => Formation.current().filter((entry) => entry.customPilot?.id === "custom-warehouse-detail").length)).toBe(1);
  expect(errors).toEqual([]);
});
