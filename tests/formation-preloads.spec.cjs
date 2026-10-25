const { test, expect } = require("@playwright/test"),
  assert = require("node:assert/strict"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;
test("one picker replaces the sidebar and configures saved ship preloads with weapon kits", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.evaluate(() => I18n.setLanguage("zh"));
  await page.locator("#openFormation").click();
  await expect(page.locator("#formationCatalog")).toBeHidden();
  await expect(page.locator("#openFormationPicker")).toBeVisible();
  await page.locator("#openFormationPicker").click();
  await page.locator('[data-unit-id="PegasusClass"]').click();
  await page.locator("#addFormationUnit").click();
  await page.locator("#closeFormationPicker").click();
  await page
    .locator(".formation-row")
    .last()
    .getByRole("button", { name: "详情", exact: true })
    .click();
  await expect(page.locator("#formationDetailHangarsBlock")).toBeVisible();
  await page.locator('[data-preload-hangar="Hangar_1"]').click();
  await expect(page.locator("#formationUnitPicker")).toBeVisible();
  await expect(page.locator("#formationUnitDetail")).toBeHidden();
  await expect(page.locator('[data-unit-id="PegasusClass"]')).toHaveCount(0);
  await page.locator('[data-detail-unit-id="RGM_79"]').click();
  await page.locator("#formationDetailKit").selectOption("bazooka");
  await page.locator("#closeFormationDetail").click();
  await expect(page.locator("#formationUnitPicker")).toBeVisible();
  await page.locator("#addFormationUnit").click();
  await expect(page.locator("#formationUnitPicker")).toBeHidden();
  await expect(page.locator("#formationDetailHangars")).toContainText("2 / 6");
  await expect(page.locator(".formation-cargo-row")).toContainText("火箭筒");
  await page.screenshot({ path: ".openai/formation-preloads.png" });
  await page.locator("#closeFormationDetail").click();
  await expect(page.locator(".formation-row").last()).toContainText("预先搭载");
  await page.locator("#saveFormation").click();
  await page.reload();
  const saved = await page.evaluate(() => Formation.current()),
    p = saved.find((e) => e.preload);
  assert(p);
  assert.equal(p.kitId, "bazooka");
  assert.equal(saved[p.preload.carrierIndex].unitId, "PegasusClass");
  const spawned = await page.evaluate(() => {
    const units = Formation.current();
    const enemy = { unitId: "RGM_79", kitId: "machine_gun" };
    const g = Rules.create(false, 1, [units, [enemy]], true, {
      costLimit: 99999,
      unitCostLimit: 99999,
    });
    const cargo = g.units.find((u) => u.embarked);
    return {
      carrier: g.units.find((u) => u.id === cargo.embarked.carrierId).model,
      cargo: cargo.model,
    };
  });
  assert(spawned.carrier.startsWith("PegasusClass__"));
  assert.equal(spawned.cargo, "RGM_79__bazooka");
  assert.deepEqual(errors, []);
});
test("picker cancel and deleting a carrier preserve its passengers as independent units on a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await page.goto(url);
  await page.evaluate(() => I18n.setLanguage("zh"));
  await page.locator("#openFormation").click();
  await page.locator("#openFormationPicker").click();
  await page.locator('[data-unit-id="PegasusClass"]').click();
  await page.locator("#addFormationUnit").click();
  await page.locator("#closeFormationPicker").click();
  await page
    .locator(".formation-row")
    .last()
    .getByRole("button", { name: "详情", exact: true })
    .click();
  await page.locator('[data-preload-hangar="Hangar_1"]').click();
  await page.locator('[data-unit-id="RGM_79"]').click();
  await page.locator("#addFormationUnit").click();
  await page.locator("#closeFormationDetail").click();
  await page
    .locator(".formation-row")
    .nth(3)
    .getByRole("button", { name: "移除", exact: true })
    .click();
  await expect(page.locator(".formation-row")).toHaveCount(4);
  await expect(page.locator(".formation-row").last()).not.toContainText("预先搭载");
  await page.locator("#openFormationPicker").click();
  await page.locator("#closeFormationPicker").press("Escape");
  await expect(page.locator("#formationUnitPicker")).toBeHidden();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator("#saveFormation").click();
  assert(!(await page.evaluate(() => Formation.current())).some((e) => e.preload));
});

test("catalog ship preview can add the carrier and configure its first preload directly", async ({
  page,
}) => {
  await page.goto(url);
  await page.evaluate(() => I18n.setLanguage("zh"));
  await page.locator("#openFormation").click();
  await page.locator("#openFormationPicker").click();
  await page.locator('[data-detail-unit-id="PegasusClass"]').click();
  await expect(page.locator("#formationDetailHangars")).toContainText("预先搭载会先");
  await page.locator('[data-preload-hangar="Hangar_1"]').click();
  await page.locator('[data-unit-id="RGM_79"]').click();
  await page.locator("#addFormationUnit").click();
  await expect(page.locator("#formationDetailHangars")).toContainText("2 / 6");
  await page.locator("#closeFormationDetail").click();
  await expect(page.locator(".formation-row")).toHaveCount(5);
  await page.locator("#saveFormation").click();
  const saved = await page.evaluate(() => Formation.current());
  assert.equal(saved[3].unitId, "PegasusClass");
  assert.equal(saved[4].preload.carrierIndex, 3);
});

test("preloaded passengers change equipment inline and preserve the assignment and name after saving", async ({
  page,
}) => {
  await page.goto(url);
  await page.evaluate(() => I18n.setLanguage("zh"));
  await page.locator("#openFormation").click();
  await page.locator("#openFormationPicker").click();
  await page.locator('[data-detail-unit-id="PegasusClass"]').click();
  await page.locator('[data-preload-hangar="Hangar_1"]').click();
  await page.locator('[data-unit-id="RGM_79"]').click();
  await page.locator("#addFormationUnit").click();
  const cargo = page.locator(".formation-cargo-row"),
    before = await cargo.locator("strong").innerText();
  await cargo.locator("select").selectOption("beam_spray");
  await expect(cargo.locator("select")).toHaveValue("beam_spray");
  const expected = await page.evaluate(() => UnitModels.RGM_79__beam_spray.cost);
  await expect(cargo.locator("small").first()).toHaveText("COST " + expected);
  await expect(page.locator("#formationDetailHangars")).toContainText("2 / 6");
  await expect(cargo.locator("strong")).toHaveText(before);
  await page.setViewportSize({ width: 430, height: 900 });
  const bounds = await cargo.locator("select").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, width: innerWidth };
  });
  assert(bounds.left >= 0 && bounds.right <= bounds.width);
  await page.locator("#closeFormationDetail").click();
  await page.locator("#saveFormation").click();
  await page.reload();
  const saved = await page.evaluate(() => Formation.current()),
    passenger = saved.find((e) => e.preload);
  assert.equal(passenger.kitId, "beam_spray");
  assert.equal(passenger.customName, before);
  assert.equal(saved[passenger.preload.carrierIndex].unitId, "PegasusClass");
});

test("passengers display immediately below their carrier and remove buttons align with equipment controls", async ({
  page,
}) => {
  await page.goto(url);
  await page.evaluate(() => I18n.setLanguage("zh"));
  await page.locator("#openFormation").click();
  await page.locator("#openFormationPicker").click();
  await page.locator('[data-unit-id="PegasusClass"]').click();
  await page.locator("#addFormationUnit").click();
  await page.locator("#addFormationUnit").click();
  await page.locator("#closeFormationPicker").click();
  for (const carrierIndex of [3, 3, 4]) {
    await page
      .locator(`[data-formation-index="${carrierIndex}"]`)
      .getByRole("button", { name: "详情", exact: true })
      .click();
    await page.locator('[data-preload-hangar="Hangar_1"]').click();
    await page.locator('[data-unit-id="RGM_79"]').click();
    await page.locator("#addFormationUnit").click();
    await page.locator("#closeFormationDetail").click();
  }
  const order = await page
    .locator("#formationUnits > .formation-row")
    .evaluateAll((rows) => rows.map((r) => Number(r.dataset.formationIndex)));
  assert.deepEqual(order, [0, 1, 2, 3, 5, 6, 4, 7]);
  await expect(
    page.locator('[data-formation-index="5"] .formation-unit-name > strong'),
  ).toContainText("→");
  await page
    .locator('[data-formation-index="3"]')
    .getByRole("button", { name: "详情", exact: true })
    .click();
  for (const size of [
    { width: 1600, height: 1000 },
    { width: 430, height: 900 },
  ]) {
    await page.setViewportSize(size);
    const geometry = await page.locator(".formation-cargo-row").evaluateAll((rows) =>
      rows.map((row) => {
        const s = row.querySelector("select").getBoundingClientRect(),
          b = row.querySelector("button").getBoundingClientRect();
        return {
          selectBottom: s.bottom,
          buttonBottom: b.bottom,
          right: b.right,
          width: innerWidth,
        };
      }),
    );
    assert.equal(geometry.length, 2);
    for (const g of geometry) {
      assert(Math.abs(g.selectBottom - g.buttonBottom) < 1);
      assert(g.right <= g.width);
    }
    assert(Math.abs(geometry[0].right - geometry[1].right) < 1);
  }
  await page.locator("#closeFormationDetail").click();
  await expect(page.locator('[data-formation-index="3"] .formation-detail-button')).toBeFocused();
  await page.locator("#saveFormation").click();
  const saved = await page.evaluate(() => Formation.current());
  assert.equal(saved[5].preload.carrierIndex, 3);
  assert.equal(saved[6].preload.carrierIndex, 3);
  assert.equal(saved[7].preload.carrierIndex, 4);
});

test("unit previews assign and transfer passengers between numbered hangars and independent deployment", async ({
  page,
}) => {
  await page.goto(url);
  await page.evaluate(() => I18n.setLanguage("zh"));
  await page.locator("#openFormation").click();
  await page.locator("#openFormationPicker").click();
  await page.locator('[data-unit-id="PegasusClass"]').click();
  await page.locator("#addFormationUnit").click();
  await page.locator("#addFormationUnit").click();
  await page.locator('[data-detail-unit-id="RGM_79"]').click();
  const select = page.locator("#formationDetailCarrier");
  await expect(select).toBeVisible();
  await expect(select.locator("option")).toHaveCount(5);
  const first = JSON.stringify({ carrierIndex: 3, hangarId: "Hangar_2" });
  await select.selectOption(first);
  await expect(select).toHaveValue(first);
  await page.locator("#closeFormationDetail").click();
  await page.locator("#closeFormationPicker").click();
  await expect(page.locator('[data-formation-index="5"]')).toContainText("格纳库2");
  await page.locator('[data-formation-index="5"] .formation-detail-button').click();
  await select.selectOption(JSON.stringify({ carrierIndex: 3, hangarId: "Hangar_1" }));
  await page.locator("#closeFormationDetail").click();
  await expect(page.locator('[data-formation-index="5"]')).toContainText("格纳库1");
  await page.locator('[data-formation-index="5"] .formation-detail-button').click();
  await select.selectOption("");
  await page.locator("#closeFormationDetail").click();
  await expect(page.locator('[data-formation-index="5"]')).not.toHaveClass(
    /formation-preloaded-row/,
  );
  await page.locator('[data-formation-index="5"] .formation-detail-button').click();
  await select.selectOption(JSON.stringify({ carrierIndex: 4, hangarId: "Hangar_2" }));
  await page.locator("#closeFormationDetail").click();
  await page.locator("#saveFormation").click();
  await page.reload();
  const saved = await page.evaluate(() => Formation.current());
  assert.equal(saved[5].preload.carrierIndex, 4);
  assert.equal(saved[5].preload.hangarId, "Hangar_2");
  assert.equal(saved.length, 6);
});
test("full hangars are excluded for other units but retained for their own existing passengers", async ({
  page,
}) => {
  await page.goto(url);
  await page.evaluate(() => {
    const carrier = Object.values(UnitModels).find((m) => m.prefabId === "PegasusClass"),
      gm = { unitId: "RGM_79", kitId: "machine_gun" },
      units = [
        { unitId: carrier.prefabId, kitId: carrier.kitId },
        ...Array.from({ length: 3 }, () => ({
          ...gm,
          preload: { carrierIndex: 0, hangarId: "Hangar_1" },
        })),
        gm,
      ];
    localStorage.setItem("slg-formations-v1", JSON.stringify([{ name: "满舱测试", units }]));
  });
  await page.reload();
  await page.evaluate(() => I18n.setLanguage("zh"));
  await page.locator("#openFormation").click();
  await page.locator('[data-formation-index="4"] .formation-detail-button').click();
  let options = await page
    .locator("#formationDetailCarrier option")
    .evaluateAll((os) => os.map((o) => o.value));
  assert(!options.includes(JSON.stringify({ carrierIndex: 0, hangarId: "Hangar_1" })));
  assert(options.includes(JSON.stringify({ carrierIndex: 0, hangarId: "Hangar_2" })));
  await page.locator("#closeFormationDetail").click();
  await page.locator('[data-formation-index="1"] .formation-detail-button').click();
  await expect(page.locator("#formationDetailCarrier")).toHaveValue(
    JSON.stringify({ carrierIndex: 0, hangarId: "Hangar_1" }),
  );
});

test("hangar groups have visible dividers and every unit addition emits one success cue and toast", async ({
  page,
}) => {
  await page.goto(url);
  await page.evaluate(() => {
    I18n.setLanguage("zh");
    window.additionCues = [];
    const original = GameAudio.play;
    GameAudio.play = (key) => {
      additionCues.push(key);
      original(key);
    };
  });
  await page.locator("#openFormation").click();
  await page.locator("#openFormationPicker").click();
  await page.locator('[data-unit-id="PegasusClass"]').click();
  await page.locator("#addFormationUnit").click();
  await expect(page.locator("#toast")).toHaveClass(/show/);
  await expect(page.locator("#toast")).toHaveText("成功添加");
  assert.equal(await page.evaluate(() => additionCues.filter((k) => k === "infoSound").length), 1);
  assert(
    await page
      .locator("#toast")
      .evaluate(
        (el) =>
          Number(getComputedStyle(el).zIndex) >
          Number(getComputedStyle(byId("formationUnitPicker")).zIndex),
      ),
  );
  await page.locator("#closeFormationPicker").click();
  for (const hangarId of ["Hangar_1", "Hangar_2"]) {
    await page.locator('[data-formation-index="3"] .formation-detail-button').click();
    await page.locator(`[data-preload-hangar="${hangarId}"]`).click();
    await page.locator('[data-unit-id="RGM_79"]').click();
    await page.locator("#addFormationUnit").click();
    await expect(page.locator("#toast")).toHaveText("成功添加");
    await page.locator("#closeFormationDetail").click();
  }
  await expect(page.locator(".formation-hangar-divider")).toHaveText(["格纳库1", "格纳库2"]);
  assert.equal(await page.evaluate(() => additionCues.filter((k) => k === "infoSound").length), 3);
  const gap = await page.locator('[data-hangar-group="3/Hangar_2"]').evaluate((el) => {
    const prev = el.previousElementSibling.getBoundingClientRect(),
      r = el.getBoundingClientRect();
    return r.top - prev.bottom;
  });
  assert(gap >= 12);
  await page.locator("#openFormationPicker").click();
  await page.locator('[data-detail-unit-id="RGM_79"]').click();
  await page
    .locator("#formationDetailCarrier")
    .selectOption(JSON.stringify({ carrierIndex: 3, hangarId: "Hangar_2" }));
  assert.equal(await page.evaluate(() => additionCues.filter((k) => k === "infoSound").length), 4);
  await expect(page.locator("#toast")).toHaveText("成功添加");
  await page
    .locator("#formationDetailCarrier")
    .selectOption(JSON.stringify({ carrierIndex: 3, hangarId: "Hangar_1" }));
  assert.equal(await page.evaluate(() => additionCues.filter((k) => k === "infoSound").length), 4);
});
