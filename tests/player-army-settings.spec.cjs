const { test } = require("@playwright/test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

test("host edits human army settings and assigns a complete exempt preset", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const units = Array.from({ length: 13 }, (_, i) => ({
    unitId: "RX_79_G",
    kitId: "beam_rifle",
    customName: "指定机体" + (i + 1),
  }));
  await page.addInitScript(
    (units) =>
      localStorage.setItem(
        "slg-formations-v1",
        JSON.stringify([
          { name: "普通编组", units: [{ unitId: "RGM_79", kitId: "machine_gun" }] },
          { name: "房主预设", units },
        ]),
      ),
    units,
  );
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.evaluate(async () => {
    await SpriteRenderer.load();
    I18n.setLanguage("zh");
    LocalRoom.open();
    await new Promise((r) => setTimeout(r, 0));
  });
  const memberId = await page.evaluate(() => Net.memberId);
  await page.locator("#managePlayer-" + memberId).click();
  for (const field of ["difficulty", "fill", "countPercent", "unitCostPercent"]) {
    assert.deepEqual(
      await page
        .locator("#player-" + field + "-" + memberId + " option")
        .evaluateAll((options) => options.map((o) => o.value)),
      Array.from({ length: 12 }, (_, i) => String((i + 1) * 25)),
    );
  }
  await page.locator("#player-difficulty-" + memberId).selectOption("300");
  await page.locator("#player-fill-" + memberId).selectOption("300");
  await page.locator("#player-countPercent-" + memberId).selectOption("300");
  await page.locator("#player-unitCostPercent-" + memberId).selectOption("200");
  assert.deepEqual(
    await page.evaluate(() => Net.snapshot.members.find((m) => m.id === Net.memberId).armySettings),
    {
      difficulty: 300,
      fill: 300,
      countPercent: 300,
      unitCostLimit: null,
      unitCostPercent: 200,
    },
  );
  const layout = await page.evaluate(() => {
    const spans = [...document.querySelectorAll(".army-cost-summary span")].map((el) =>
      el.getBoundingClientRect().toJSON(),
    );
    return {
      spans,
      count: document.querySelector(".army-count-summary").getBoundingClientRect().toJSON(),
    };
  });
  assert.equal(layout.spans[0].top, layout.spans[1].top);
  assert(layout.count.top >= layout.spans[0].bottom);
  await page.locator("#player-formation-" + memberId).selectOption("1");
  assert.deepEqual(
    await page.evaluate(
      () => Net.snapshot.members.find((m) => m.id === Net.memberId).formationPreset,
    ),
    { name: "房主预设", units },
  );
  assert.ok(await page.locator("#player-unitCostPercent-" + memberId).isDisabled());
  await page.locator("#closeRoomDetail").click();
  assert.ok(await page.locator("#roomFormationSelect").isDisabled());
  assert.ok(await page.locator("#roomFormation").isDisabled());
  assert.ok(await page.locator("#roomFormationWarning").isHidden());
  await page.locator("#startRoomGame").click();
  assert.ok(await page.locator("#editFinalFormation").isDisabled());
  await page.locator("#confirmFinalFormation").click();
  assert.equal(await page.evaluate(() => phase), "deployment");
  assert.deepEqual(
    await page.evaluate(() => game.units.filter((u) => u.ownerSeat === 0).map((u) => u.customName)),
    units.map((u) => u.customName),
  );
  assert.ok(
    await page.evaluate(() =>
      game.units
        .filter((u) => u.ownerSeat === 0)
        .every((u) => {
          const m = Rules.modelOf(u),
            base = Rules.models[u.model];
          return (
            u.performance === 3 &&
            m.accuracy === base.accuracy &&
            m.mobility === base.mobility &&
            m.hp === base.hp * 3 &&
            m.en === base.en * 3
          );
        }),
    ),
  );
  assert.deepEqual(errors, []);
});

test("team small-tag dropdown updates restrictions, summary and formation overlays", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.evaluate(async () => {
    I18n.setLanguage("zh");
    LocalRoom.open();
    await new Promise((r) => setTimeout(r, 0));
  });
  await page.locator(".team-filters").first().locator("summary").click();
  const select = page.locator("#teamBan-0-bannedTypes");
  assert(await select.isVisible());
  await select.selectOption("MS");
  assert.deepEqual(
    await page.evaluate(() => Net.snapshot.settings.teamRestrictions[0].bannedTypes),
    ["MS"],
  );
  const label = await page.evaluate(() => I18n.text(Rules.unitTagName("MS")));
  assert((await page.locator("#teamBanSummary0").textContent()).includes(label));
  await page.locator("#roomFormation").click();
  assert((await page.locator(".formation-row.not-allowed").count()) > 0);
  await page.locator("#saveFormation").click();
  await page.locator("#teamBan-0-bannedTypes").selectOption("NONE");
  assert.deepEqual(
    await page.evaluate(() => Net.snapshot.settings.teamRestrictions[0].bannedTypes),
    [],
  );
});
