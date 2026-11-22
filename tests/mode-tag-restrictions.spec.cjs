const {test,expect}=require("@playwright/test");
const {createServer}=require("../server");

test("cooperative and mercenary lobbies hide and disable all tag-ban controls",async({page})=>{
  test.setTimeout(90000);
  const app=createServer({host:"127.0.0.1",port:0});
  const address=await app.listen(),base="http://127.0.0.1:"+address.port;
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  try {
    await page.goto(base);
    await page.waitForFunction(()=>assetsReady);
    await page.evaluate(base=>{
      byId("newRoomMode").value="quick";
      Net.serverURL=base.replace("http:","ws:")+"/ws";
      Net.room="MODE_TAGS";
      Net.connect("create",true);
    },base);
    await page.waitForFunction(()=>Net.snapshot&&!Net.awaiting);
    for(const mode of ["quick","sweep","battlefield","mission","quick"]) {
      await page.evaluate(mode=>Net.request("configure_room",{
        ...Net.snapshot.settings,battleMode:mode,
        bannedFactions:["EFSF"],bannedEras:["UC_0079_T1"],bannedTypes:["MS"],
      }),mode);
      await expect.poll(()=>page.evaluate(()=>Net.snapshot.settings.mode)).toBe(mode);
      await page.waitForFunction(()=>!Net.awaiting);
      const enabled=mode==="quick";
      if(mode==="sweep") await expect(page.locator("#roomUnitLimit")).toHaveValue("2");
      expect(await page.locator("#roomTagRestrictions").evaluate(node=>node.closest("details").hidden)).toBe(!enabled);
      await expect(page.locator("#teamBanSummary0")).toHaveJSProperty("hidden",!enabled);
      await expect(page.locator("#teamBanSummary0")).toHaveJSProperty("disabled",!enabled);
      expect(await page.locator("#roomTagRestrictions select").evaluateAll(nodes=>nodes.every(node=>node.disabled))).toBe(!enabled);
      if(!enabled) {
        expect(await page.evaluate(()=>Net.snapshot.settings.bannedFactions)).toEqual([]);
        expect(await page.locator("#roomTeamRestrictions").evaluate(node=>node.closest("details").hidden)).toBe(true);
      }
    }
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});
