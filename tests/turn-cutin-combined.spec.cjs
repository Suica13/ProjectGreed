const {test,expect}=require("@playwright/test");
const {pathToFileURL}=require("node:url"),path=require("node:path");
for(const [width,language,roundLabel,teamLabel]of [[1440,"zh","第1回合","队伍1"],[390,"zh","第1回合","队伍1"],[1440,"en","Turn 1","Team 1"],[1440,"ja","ターン1","チーム1"]])test(`one two-line turn animation at ${width}px in ${language}`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
 await expect(page.locator("#openSkirmish")).toBeEnabled();
 await page.evaluate(language=>{
  I18n.setLanguage(language);setPageView("game");
  const card=byId("turnCutinCard"),animate=card.animate.bind(card);window.cutinAnimations=0;
  card.animate=(...args)=>{window.cutinAnimations++;return animate(...args)};
  window.cutinDone=TurnFlow.play(1,1,0);
 },language);
 await expect(page.locator("#turnCutin")).toBeVisible();
 await expect(page.locator(".turn-cutin-round")).toHaveText(roundLabel);
 await expect(page.locator(".turn-cutin-team")).toHaveText(teamLabel);
 const geometry=await page.evaluate(()=>{
  const card=byId("turnCutinCard"),a=card.getAnimations()[0];a.pause();a.currentTime=a.effect.getTiming().duration/2;
  const r=card.querySelector('.turn-cutin-round').getBoundingClientRect(),t=card.querySelector('.turn-cutin-team').getBoundingClientRect(),box=card.getBoundingClientRect();
  return {r:r.bottom,t:t.top,left:box.left,right:box.right,count:cutinAnimations};
 });
 expect(geometry.count).toBe(1);expect(geometry.r).toBeLessThanOrEqual(geometry.t);expect(geometry.left).toBeGreaterThanOrEqual(0);expect(geometry.right).toBeLessThanOrEqual(width);
 await page.evaluate(async()=>{byId('turnCutinCard').getAnimations()[0].finish();await cutinDone});
 await expect(page.locator("#turnCutin")).toBeHidden();expect(await page.evaluate(()=>TurnFlow.active)).toBe(false);
});
test("the combined turn cutin supports pause, cancellation and replacement",async({page})=>{
 await page.goto(pathToFileURL(path.resolve("public/client.html")).href);await expect(page.locator("#openSkirmish")).toBeEnabled();
 await page.evaluate(()=>{setPageView('game');TurnFlow.setReplayPaused(true);window.cutinDone=TurnFlow.play(0,2,1)});
 expect(await page.evaluate(()=>byId('turnCutinCard').getAnimations()[0].playState)).toBe('paused');
 await page.evaluate(()=>{TurnFlow.setReplayPaused(false);window.cutinDone=TurnFlow.play(1,3,0)});
 await expect(page.locator('.turn-cutin-round')).toHaveText('第3回合');
 expect(await page.evaluate(()=>byId('turnCutinCard').getAnimations().length)).toBe(1);
 await page.evaluate(()=>TurnFlow.reset());await expect(page.locator('#turnCutin')).toBeHidden();
 expect(await page.evaluate(()=>TurnFlow.active)).toBe(false);
});
