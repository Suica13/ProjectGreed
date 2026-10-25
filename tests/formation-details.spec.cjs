const { test, expect } = require("@playwright/test"),
  assert = require("node:assert/strict"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;
test("catalog and enlisted units reuse details with a preview and isolated kit editing", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.evaluate(() => I18n.setLanguage("zh"));
  await page.locator("#openFormation").click();
  await page.locator("#openFormationPicker").click();
  const count = await page.locator(".formation-row").count(),
    before = await page.locator("#formationUnits").innerText();
  const details = page.locator('[data-detail-unit-id="RGM_79"]');
  await details.click();
  await expect(page.locator("#formationUnitDetail")).toBeVisible();
  await expect(page.locator("#formationDetailTitle")).toContainText("RGM-79");
  await expect(page.locator("#formationDetailNameEditor")).toBeHidden();
  assert(
    await page
      .locator("#formationDetailPreview")
      .evaluate((img) =>
        [...img.getContext("2d").getImageData(0, 0, img.width, img.height).data].some(
          (value, i) => i % 4 === 3 && value > 0,
        ),
      ),
  );
  await page.locator("#formationDetailKit").selectOption("bazooka");
  await expect(page.locator("#formationDetailWeapons")).toContainText("火箭筒");
  await expect(page.locator("#formationDetailStats .unit-detail-metric")).toHaveCount(7);
  await expect(page.locator(".unit-defense-table thead")).toContainText("固定减伤");
  await expect(page.locator("#formationDetailSlots .formation-weapon-detail")).toHaveCount(4);
  await expect(
    page.locator("#formationDetailSlots .formation-weapon-detail").first(),
  ).toContainText("AP");
  await page.screenshot({ path: ".openai/formation-catalog-detail.png" });
  await page.locator("#formationDetailKit").press("Escape");
  await expect(details).toBeFocused();
  assert.equal(await page.locator(".formation-row").count(), count);
  assert.equal(await page.locator("#formationUnits").innerText(), before);
  await page.locator("#addFormationUnit").click();
  await page.locator("#closeFormationPicker").click();
  await page.locator(".formation-row").last().locator(".formation-unit-name").click();
  await expect(page.locator("#formationUnitDetail")).toBeHidden();
  await page
    .locator(".formation-row")
    .last()
    .getByRole("button", { name: "详情", exact: true })
    .click();
  await expect(page.locator("#formationDetailNameEditor")).toBeVisible();
  assert(
    await page
      .locator("#formationDetailPreview")
      .evaluate((img) =>
        [...img.getContext("2d").getImageData(0, 0, img.width, img.height).data].some(
          (value, i) => i % 4 === 3 && value > 0,
        ),
      ),
  );
  await page.locator("#editFormationUnitName").click();
  await page.locator("#formationDetailName").fill("测试吉姆");
  await page.locator("#editFormationUnitName").click();
  await page.locator("#formationDetailKit").selectOption("bazooka");
  await page.locator("#closeFormationDetail").click();
  await expect(page.locator(".formation-row").last()).toContainText("测试吉姆");
  await expect(page.locator(".formation-row").last()).toContainText("火箭筒");
  assert.deepEqual(errors, []);
});
test("catalog detail fits a phone and keyboard focus stays inside the shared panel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await page.goto(url);
  await page.evaluate(() => I18n.setLanguage("zh"));
  await page.locator("#openFormation").click();
  await page.locator("#openFormationPicker").click();
  await page.locator('[data-detail-unit-id="RGM_79"]').click();
  const lastControl = page
    .locator("#formationUnitDetail")
    .locator(
      "button:visible:not(:disabled),input:visible:not(:disabled),select:visible:not(:disabled),summary:visible",
    )
    .last();
  await lastControl.focus();
  await lastControl.press("Tab");
  await expect(page.locator("#closeFormationDetail")).toBeFocused();
  await page.locator("#closeFormationDetail").press("Shift+Tab");
  await expect(lastControl).toBeFocused();
  const geometry = await page
    .locator("#formationUnitDetail .formation-detail-dialog")
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        bottom: r.bottom,
        screen: innerWidth,
        height: innerHeight,
      };
    });
  assert(
    geometry.left >= 0 && geometry.right <= geometry.screen && geometry.bottom <= geometry.height,
  );
  await page.evaluate(() => I18n.setLanguage("en"));
  await expect(page.locator("#formationUnitDetail")).toBeVisible();
  await page.locator("#closeFormationDetail").click();
  await expect(page.locator('[data-detail-unit-id="RGM_79"]')).toHaveText("Details");
});

test("environment block, grouped heading tags and inclusion dropdowns share the catalog", async ({
  page,
}) => {
  await page.goto(url);
  await page.evaluate(() => I18n.setLanguage("zh"));
  await page.locator("#openFormation").click();
  await page.locator("#openFormationPicker").click();
  const total = await page.locator(".catalog-unit").count();
  assert(total > 100);
  for (const id of ["formationFaction", "formationEra", "formationEnvironment", "formationType"]) {
    await expect(page.locator("#" + id)).toHaveValue("");
    await expect(page.locator("#" + id + " option").first()).toHaveText("不限");
  }
  const verify = async (faction = "", type = "", era = "", environment = "") => {
    const result = await page.locator(".catalog-unit").evaluateAll(
      (cards, filters) => {
        const expected = Rules.catalog.prefabs
          .filter(
            (p) =>
              !p.formOnly &&
              (!filters.faction || p.faction === filters.faction) &&
              (!filters.type || p.unitTags.includes(filters.type)) &&
              (!filters.era || p.tags.includes(filters.era)) &&
              (!filters.environment || (p.stats.adaptability?.[filters.environment] ?? 0) >= 90),
          )
          .map((p) => p.id)
          .sort();
        return { actual: cards.map((c) => c.dataset.unitId).sort(), expected };
      },
      { faction, type, era, environment },
    );
    assert(result.actual.length > 0);
    assert.deepEqual(result.actual, result.expected);
  };
  await page.locator("#formationFaction").selectOption("ZEON");
  await verify("ZEON");
  await page.locator("#formationFaction").selectOption("EFSF");
  await verify("EFSF");
  await page.locator("#formationType").selectOption("MS");
  await page.locator("#formationEra").selectOption("0079");
  await verify("EFSF", "MS", "0079");
  await page.locator("#formationEnvironment").selectOption("ground");
  await verify("EFSF", "MS", "0079", "ground");
  await page.evaluate(() => I18n.setLanguage("en"));
  await expect(page.locator("#formationFaction")).toHaveValue("EFSF");
  await expect(page.locator("#formationType")).toHaveValue("MS");
  await verify("EFSF", "MS", "0079", "ground");
  await page.evaluate(() => I18n.setLanguage("zh"));
  for (const id of ["formationFaction", "formationEra", "formationEnvironment", "formationType"])
    await page.locator("#" + id).selectOption("");
  await expect(page.locator(".catalog-unit")).toHaveCount(total);
  await page.locator('[data-detail-unit-id="RGM_79"]').click();
  await expect(page.locator("#formationDetailMovement .unit-detail-metric")).toHaveCount(12);
  for (const text of [
    "地面适应性",
    "宇宙适应性",
    "水中适应性",
    "大气层适应性",
    "空中适应性",
    "山地适应性",
    "树林适应性",
    "雪地适应性",
    "沙漠适应性",
    "废墟适应性",
  ])
    await expect(page.locator("#formationDetailMovement")).toContainText(text);
  const atmosphere = page
    .locator("#formationDetailMovement .unit-detail-metric")
    .filter({ hasText: "大气层适应性" });
  await expect(atmosphere).toContainText("0%");
  for (const label of ["树林适应性", "雪地适应性", "沙漠适应性", "废墟适应性"])
    await expect(
      page.locator("#formationDetailMovement .unit-detail-metric").filter({ hasText: label }),
    ).toContainText("75%");
  await expect(page.locator("#formationDetailTags .unit-tags-primary")).toContainText("EFSF");
  await expect(page.locator("#formationDetailTags .unit-tags-primary")).toContainText("0079");
  await expect(page.locator("#formationDetailTags .unit-tags-types")).toContainText("MS");
  await expect(page.locator("#formationDetailStats")).not.toContainText("适应性");
  await page.screenshot({ path: ".openai/formation-movement-tags.png" });
  await page.locator("#closeFormationDetail").click();
  await page.setViewportSize({ width: 430, height: 900 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await expect(page.locator("#formationType")).toBeVisible();
});

test("unit picker heading shows live squad and selected-unit COST limits without overlapping on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(url);
  await page.evaluate(() => {
    localStorage.setItem(
      "slg-formations-v1",
      JSON.stringify([{ name: "Cost Probe", units: [{ unitId: "RGM_79", kitId: "machine_gun" }] }]),
    );
    localStorage.setItem("slg-formations-v1-active", "0");
  });
  await page.reload();
  await page.evaluate(() => I18n.setLanguage("zh"));
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await page.locator("#roomFormation").click();
  await page.locator("#openFormationPicker").click();
  await page.locator('[data-unit-id="MS_14A"]').click();
  const costs = await page.evaluate(() => {
    const squad = Formation.current().reduce(
      (sum, entry) => sum + UnitModels[entry.unitId + "__" + entry.kitId].cost,
      0,
    );
    const prefab = Rules.catalog.prefabs.find((entry) => entry.id === "MS_14A");
    const player = Net.snapshot.members.find((entry) => entry.id === Net.memberId);
    return {
      squad,
      unit: UnitModels[prefab.id + "__" + prefab.weaponKits[0].id].cost,
      budget: Rules.armyBudget(Net.snapshot.settings, player),
      unitLimit: Rules.armyRestrictions(Net.snapshot.settings, player).unitCostLimit,
    };
  });
  await expect(page.locator("#formationPickerSquadCost")).toHaveText(
    "\u7f16\u7ec4COST: " + costs.squad + " / " + costs.budget,
  );
  await expect(page.locator("#formationPickerUnitCost")).toHaveText(
    "\u5355\u4f4dCOST: " + costs.unit + " / " + costs.unitLimit,
  );
  await expect(page.locator("#formationPickerUnitCost")).toHaveClass(
    costs.unit > costs.unitLimit ? /danger-text/ : /^$/,
  );
  await page.locator("#addFormationUnit").click();
  await expect(page.locator("#formationPickerSquadCost")).toHaveText(
    "\u7f16\u7ec4COST: " + (costs.squad + costs.unit) + " / " + costs.budget,
  );
  const geometry = await page.evaluate(() => {
    const title = byId("formationPickerTitle").getBoundingClientRect();
    const cost = byId("formationPickerCost").getBoundingClientRect();
    const closeButton = byId("closeFormationPicker"),
      close = closeButton.getBoundingClientRect();
    return {
      titleRight: title.right,
      costLeft: cost.left,
      costRight: cost.right,
      closeLeft: close.left,
      headingRight: closeButton.closest("header").getBoundingClientRect().right,
      closeRight: close.right,
    };
  });
  assert(geometry.costLeft >= geometry.titleRight - 1);
  assert(geometry.closeLeft >= geometry.costRight - 1);
  assert(geometry.closeRight <= geometry.headingRight + 1);
});
