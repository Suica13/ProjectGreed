const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
for (const viewport of [{width:390,height:844},{width:844,height:390}]) {
  test("room sheets stay above navigation and close at "+viewport.width, async ({page}) => {
    await page.setViewportSize(viewport);
    const errors=[];
    page.on("pageerror", e=>errors.push(e.message));
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.locator("#openSkirmish").click();
    await page.locator("#createOfflineRoom").click();
    await expect(page.locator("#roomPreparation")).toBeVisible();
    async function topButton(id) {
      const result=await page.locator(id).evaluate(el=>{
        const r=el.getBoundingClientRect();
        return r.x>=0 && r.y>=0 && r.right<=innerWidth && r.bottom<=innerHeight &&
          el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
      });
      expect(result).toBe(true);
    }
    await page.locator(".room-member-button").first().click();
    await expect(page.locator("#roomDetailPanel")).toHaveJSProperty("open",true);
    await topButton("#closeRoomDetail");
    await page.locator("#closeRoomDetail").click();
    await expect(page.locator("#roomMain")).toHaveJSProperty("inert",false);
    await page.locator("#teamBanSummary0").click();
    await topButton("#closeRoomDetail");
    await page.keyboard.press("Escape");
    await expect(page.locator("#roomDetailPanel")).not.toBeVisible();
    await page.locator('[data-room-tab="settings"]').click();
    await expect(page.locator("#roomSettingsSheet")).toHaveJSProperty("open",true);
    await expect(page.locator("#roomMapSelect")).toBeVisible();
    await page.locator("#roomSettingsPage").evaluate(el=>el.scrollTop=el.scrollHeight);
    await topButton("#closeRoomSettingsSheet");
    await page.locator("#closeRoomSettingsSheet").click();
    await expect(page.locator("#roomSettingsSheet")).not.toBeVisible();
    await page.locator("#shellSettings").click();
    await page.locator("#clientSettingsDialog").evaluate(el=>el.scrollTop=el.scrollHeight);
    await topButton("#closeClientSettings");
    await page.locator("#closeClientSettings").click();
    await expect(page.locator("#clientSettingsDialog")).not.toBeVisible();
    await page.locator('[data-room-tab="settings"]').click();
    await page.setViewportSize({width:1280,height:900});
    await expect(page.locator("#roomSettingsSheet")).not.toBeVisible();
    await expect(page.locator("#roomMapSelect")).toBeVisible();
    expect(errors).toEqual([]);
  });
}
