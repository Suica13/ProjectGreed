const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

for (const width of [1440, 850, 390]) test(`mode-specific room rules and era controls at ${width}px`, async ({ page }) => {
  test.setTimeout(90000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width, height: 950 });
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.locator("#openSkirmish").click();
  await page.locator("#offlineRoomMode").selectOption("battlefield");
  await page.locator("#createOfflineRoom").click();
  if (width === 390) await page.getByRole("button", { name: "房间设置", exact: true }).click();
  const before = async (first, second) => page.evaluate(([a,b]) => !!(document.querySelector(a).compareDocumentPosition(document.querySelector(b)) & Node.DOCUMENT_POSITION_FOLLOWING), [first,second]);
  await expect(page.locator("#battlefieldEra")).toHaveValue("0079T1");
  expect(await before("#roomBattleMode", "#roomLoadSave")).toBe(true);
  const actions = await page.locator("#roomRulesActions").evaluate(el => [...el.children].map(child => {
    const r = child.getBoundingClientRect(); return {left:r.left,right:r.right,bottom:r.bottom};
  }));
  expect(actions[0].right).toBeLessThanOrEqual(actions[1].left);
  expect(Math.abs(actions[0].bottom-actions[1].bottom)).toBeLessThan(2);
  expect(await page.locator(".room-mode-selector").evaluate(el => {
    const label=el.querySelector("span").getBoundingClientRect(), select=el.querySelector("select").getBoundingClientRect();
    return label.right <= select.left && Math.abs((label.top+label.bottom-select.top-select.bottom)/2)<2;
  })).toBe(true);
  await expect(page.locator("#roomTechnologyRules")).toBeHidden();
  await expect(page.locator("#roomFormationRules")).toBeHidden();
  expect(await page.locator("#battlefieldEra option").evaluateAll(o=>o.map(el=>el.value))).toEqual(["0079T1","0079T2","0087T1","0087T2"]);
  await expect(page.locator("#battlefieldTeam0era, #battlefieldCustomScale")).toHaveCount(0);
  expect(await before("#battlefieldRoomRules", "#roomGeneralBattleRules")).toBe(true);
  expect(await before("#battlefieldEra", "#battlefieldTeam0faction")).toBe(true);
  expect(await before("#battlefieldTeam1faction", "#battlefieldScalePreset")).toBe(true);
  await page.locator("#battlefieldEra").selectOption("0087T2");
  await expect.poll(()=>page.evaluate(()=>Net.snapshot.settings.battlefieldTeams.map(t=>t.era))).toEqual(["0087T2","0087T2"]);
  await expect(page.locator("#battlefieldScalePreset option")).toHaveCount(9);
  await page.locator("#roomBattleMode").selectOption("sweep");
  await expect(page.locator("#sweepEra")).toBeVisible();
  expect(await before("#sweepRoomOptions", "#roomGeneralBattleRules")).toBe(true);
  expect(await before("#sweepEra", "#sweepFaction")).toBe(true);
  expect(await before("#sweepFaction", "#sweepEnvironment")).toBe(true);
  await expect(page.locator("#roomTechnologyRules")).toBeHidden();
  await page.locator("#sweepEra").selectOption("0093T1");
  await expect.poll(()=>page.evaluate(()=>Net.snapshot.settings.sweepEra)).toBe("0093T1");
  expect(await page.locator("#sweepFaction option").evaluateAll(options=>options.map(option=>option.value))).toEqual(["EFSF","NEO_ZEON"]);
  await page.locator("#sweepEra").selectOption("0087T1");
  await expect.poll(()=>page.evaluate(()=>Net.snapshot.settings.sweepEra)).toBe("0087T1");
  expect(await page.locator("#sweepFaction").inputValue()).toBeTruthy();
  await page.locator("#sweepEnvironment").selectOption("space");
  await expect.poll(()=>page.evaluate(()=>Net.snapshot.settings.sweepEnvironment)).toBe("space");
  await page.locator("#roomGeneralBattleRules").scrollIntoViewIfNeeded();
  const alignment = await page.evaluate(()=>["roomFogMode","roomShareAlliedUnits"].map(id=>{
    const r=document.getElementById(id).getBoundingClientRect();return {top:r.top,height:r.height};
  }));
  expect(Math.abs(alignment[0].top-alignment[1].top)).toBeLessThan(2);
  expect(alignment[0].height).toBe(alignment[1].height);
  await page.screenshot({path:`tmp/verification/screenshots/room-mode-rules-${width}.png`});
  for (const mode of ["campaign","regular","quick","battlefield"]) {
    await page.locator("#roomBattleMode").selectOption(mode);
    await expect.poll(()=>page.evaluate(()=>Net.snapshot.settings.mode)).toBe(mode);
    if (mode === "campaign") {
      await expect(page.locator("#campaignRoomOptions")).toBeVisible();
      expect(await before("#campaignRoomOptions", "#roomGeneralBattleRules")).toBe(true);
    }
    if (["regular","quick"].includes(mode)) {
      if (mode === "regular") {
        await expect(page.locator("#regularEra")).toHaveValue("0079T1");
        expect(await before("#regularRoomOptions", "#roomTechnologyRules")).toBe(true);
        await page.locator("#regularEra").selectOption("0087T2");
        await expect.poll(()=>page.evaluate(()=>Net.snapshot.settings.regularEra)).toBe("0087T2");
      } else await expect(page.locator("#regularRoomOptions")).toBeHidden();
      await expect(page.locator("#roomTechnologyRules")).toBeVisible();
      expect(await page.locator("#roomFormationRules").evaluate(el=>el.nextElementSibling.id)).toBe("roomGeneralBattleRules");
      await expect(page.locator("#roomTechnologyRules > summary")).toHaveText("单位科技限制");
      await page.locator("#roomTechnologyRules").scrollIntoViewIfNeeded();
      expect(await page.locator("#roomTechnologyRules").evaluate(el=>{
        const frame=el.getBoundingClientRect(), title=el.querySelector("summary").getBoundingClientRect();
        const inputs=[...el.querySelectorAll("select")].filter(el=>el.offsetParent).map(el=>el.getBoundingClientRect());
        return title.top>=frame.top && title.left>=frame.left && title.right<=frame.right && inputs.every(r=>r.top>=title.bottom && r.right<=frame.right);
      })).toBe(true);
      if (mode === "regular") await page.screenshot({path:`tmp/verification/screenshots/room-technology-rules-${width}.png`});
    }
  }
  expect(await page.locator("#roomSettingsPage").evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  expect(errors).toEqual([]);
});
