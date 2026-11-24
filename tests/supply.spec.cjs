const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"), path = require("node:path");
for (const width of [1440, 390]) test(`supply page, item wallet and persistent single/ten draws at ${width}px`, async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width, height: 960 });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => {
    I18n.setLanguage("zh");
    const profile = Economy.initial("EFSF");
    // Explicit test wallet; production no longer grants development tokens.
    profile.itemInventory = { "0079t1-token": 99999 };
    localStorage.setItem(Economy.key, SaveCodec.stringify(profile));
  });
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  await page.locator("#shellMissions").click();
  await page.locator("#shellContactSupply").click();
  await expect(page.locator("#contactSupply")).toBeVisible();
  await expect(page.locator("#contactTasks")).toBeHidden();
  await expect(page.locator("#contactMerchants")).toBeHidden();
  await expect(page.locator("#supplyTokenCount")).toContainText("99,999");
  await expect(page.locator(".supply-wallet")).toContainText("0079年代补给代币");
  await expect(page.locator(".supply-pool-card").first()).toContainText("0079年代扭蛋机");
  await expect(page.locator(".supply-cover")).toContainText("高达4号机");
  await expect(page.locator(".supply-cover")).toContainText("高达5号机");
  await expect(page.locator('.supply-cover canvas[data-preview-model="RX_78_5__kit_0"]')).toHaveAttribute("data-preview-angle", "90");
  await expect(page.locator('.supply-cover canvas[data-preview-model^="RX_78_4__"]')).toHaveAttribute("data-preview-angle", "270");
  await expect(page.locator('.supply-cover canvas[data-preview-model="RX_78_5__kit_0"]')).toHaveAttribute("data-shooting", "true");
  await page.waitForFunction(() => [...document.querySelectorAll(".supply-unit-preview")].every(canvas => SpriteRenderer.modelsReady([canvas.dataset.previewModel])));
  await page.waitForFunction(() => [...document.querySelectorAll(".supply-cover canvas")].every(canvas => canvas.dataset.spriteReady === "true"));
  expect(await page.locator(".supply-cover canvas").evaluateAll(nodes => nodes.every(node => node.width === 960 && getComputedStyle(node).imageRendering === "pixelated"))).toBe(true);
  await page.locator("#contactSupply").getByRole("button", { name: "商品一览", exact: true }).click();
  await expect(page.locator(".supply-products")).toContainText("S品 · 3%");
  await expect(page.locator(".supply-products")).toContainText("C品仅包含资金、物资、代币和零件");
  for (const [grade, weight, rental] of [["S",3,1.2],["A",5,2],["B",10,4]]) {
    const section=page.locator(`.supply-product-grade[data-grade="${grade}"]`);
    await expect(section.locator("h3")).toHaveText(`${grade}品 · ${weight}%`);
    await expect(section.locator("h4").filter({hasText:"租赁机"})).toHaveText(`指定单位租赁机 · 剩余次数 10 次 · ${rental}%`);
  }
  await expect(page.locator('.supply-product-grade[data-grade="A"]')).toContainText("0079年代补给代币 ×10 · 0.5%");
  await expect(page.locator('.supply-product-grade[data-grade="A"]')).toContainText("高达6号机[WIP]");
  const ordinary=page.locator('.supply-product-grade[data-grade="C"]');
  await expect(ordinary.locator("h3")).toHaveText("C品 · 82%");
  await expect(ordinary.locator("h4").filter({hasText:"库存"})).toHaveCount(0);
  await expect(ordinary).toContainText("物资 · 1000–3000 · 25%");
  await expect(ordinary).toContainText("资金 · 1000–3000 · 25%");
  await expect(ordinary).toContainText("0079年代补给代币 ×1 · 4%");
  await expect(ordinary).toContainText("稀有度1 ×1 · 16%");
  await expect(ordinary).toContainText("稀有度2 ×1 · 8%");
  await expect(ordinary).toContainText("稀有度3 ×1 · 4%");
  await expect(ordinary.locator("li").filter({hasText:/^高达4号机 ·/})).toHaveCount(0);
  await expect(page.locator(".supply-products")).toContainText("强化骨架");
  await page.locator(".supply-products").getByRole("button", { name: "关闭", exact: true }).click();
  await page.evaluate(() => {
    window.supplyCues = [];
    window.supplyDrawResults = [];
    const draw=Economy.drawSupply;
    Economy.drawSupply=(...args)=>{
      const rolls=args[1]===1?[.05,.95]:[
        0,0,.5, .05,0,.25, .05,.75,.8, .1,0,.99, .1,.85,.5,
        .4,.4,.2, .5,.05,0, .5,.4,.999999, .5,.63, .5,.99,.5
      ];
      const random=crypto.getRandomValues;
      crypto.getRandomValues=array=>{if(!rolls.length)throw Error("Unexpected supply RNG");array[0]=Math.floor(rolls.shift()*4294967296);return array;};
      try{const results=draw(...args);window.supplyDrawResults.push(...results);return results;}
      finally{crypto.getRandomValues=random;}
    };
    const play = WeaponAudio.play;
    WeaponAudio.play = (...args) => { if(args[3] === "supply") window.supplyCues.push(args[0].asset); return play(...args); };
  });
  await page.screenshot({ path: `tmp/verification/screenshots/supply-pose-${width}.png` });
  await page.locator("#supplyDrawOnce").click();
  const delivery = page.locator(".supply-delivery");
  await expect(delivery).toBeVisible();
  await expect(delivery.locator(".supply-reward-panel")).toBeHidden();
  await expect(delivery.locator("#supplyOpenCrate")).toBeDisabled();
  await expect(delivery.locator(".supply-aircraft")).toHaveAttribute("data-transport", /Medea|FatUncle/);
  await expect(delivery).toHaveAttribute("data-phase", "dropping");
  await page.screenshot({ path: `tmp/verification/screenshots/supply-drop-${width}.png` });
  await expect(delivery.locator("#supplyOpenCrate")).toBeEnabled();
  await delivery.locator("#supplyOpenCrate").click();
  await expect(delivery.locator(".supply-reward-panel")).toBeVisible();
  await expect(delivery.locator(".supply-result")).toHaveCount(1);
  await expect(delivery.locator(".supply-result")).toContainText("0079年代补给代币 ×10");
  await delivery.getByRole("button", { name: "收下补给", exact: true }).click();
  await page.locator("#supplyDrawTen").click();
  await expect(delivery.locator("#supplyOpenCrate")).toBeEnabled();
  await delivery.locator("#supplyOpenCrate").click();
  await expect(delivery.locator(".supply-reward-panel")).toBeVisible();
  await expect(delivery.locator(".supply-result")).toHaveCount(10);
  expect(await delivery.evaluate(dialog => dialog.scrollTop)).toBe(0);
  await expect(delivery.locator(".supply-reward-icon > canvas, .supply-reward-icon > img, .supply-reward-icon > svg, .supply-reward-icon > .supply-token-symbol")).toHaveCount(10);
  await page.screenshot({ path: `tmp/verification/screenshots/supply-rewards-${width}.png` });
  expect(await page.evaluate(() => window.supplyCues)).toEqual(expect.arrayContaining([
    "presentation/moveSound", "presentation/deploymentSound", "presentation/changeEquipmentSound", "presentation/researchSound"
  ]));
  await delivery.getByRole("button", { name: "收下补给", exact: true }).click();
  await expect(page.locator("#supplyLastResults")).toHaveAttribute("data-count", "10");
  const balance=await page.evaluate(()=>99999-11+window.supplyDrawResults.filter(result=>result.itemId).reduce((sum,result)=>sum+result.quantity,0));
  expect(await page.evaluate(() => Economy.snapshot().itemInventory["0079t1-token"])).toBe(balance);
  await page.screenshot({ path: `tmp/verification/screenshots/supply-${width}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("#shellHangar").click();
  await page.locator("#shellItemStorage").click();
  await page.locator("#warehouseItemsTab").click();
  await expect(page.locator(".item-storage-detail")).toContainText("0079年代补给代币");
  await expect(page.locator(".item-storage-count")).toHaveText("×"+balance.toLocaleString("en-US"));
  await page.reload();await page.waitForFunction(() => assetsReady);
  expect(await page.evaluate(() => Economy.snapshot().itemInventory["0079t1-token"])).toBe(balance);
  await page.locator("#shellMissions").click();await page.locator("#shellContactSupply").click();
  await page.evaluate(() => {
    const profile = Economy.snapshot();profile.itemInventory["0079t1-token"] = 0;
    localStorage.setItem(Economy.key, SaveCodec.stringify(profile));
  });
  await page.reload();await page.waitForFunction(() => assetsReady);
  await page.locator("#shellMissions").click();await page.locator("#shellContactSupply").click();
  await expect(page.locator("#supplyDrawOnce")).toBeDisabled();
  await expect(page.locator("#supplyDrawTen")).toBeDisabled();
  expect(errors).toEqual([]);
});

test("closing or reloading a delivery preserves paid rewards and releases the next draw", async ({ page }) => {
  test.setTimeout(90000);
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => {
    I18n.setLanguage("zh");
    const profile = Economy.initial("EFSF");profile.itemInventory = { "0079t1-token": 50 };
    localStorage.setItem(Economy.key, SaveCodec.stringify(profile));
  });
  await page.reload();await page.waitForFunction(() => assetsReady);
  await page.locator("#shellMissions").click();await page.locator("#shellContactSupply").click();
  await page.locator("#supplyDrawTen").click();
  await page.locator(".supply-delivery").getByRole("button", {name:"关闭演出",exact:true}).click();
  await expect(page.locator("#supplyLastResults")).toHaveAttribute("data-count", "10");
  const balanceAfterTen=await page.evaluate(()=>Economy.snapshot().itemInventory["0079t1-token"]);
  expect(balanceAfterTen).toBeGreaterThanOrEqual(40);
  await page.locator("#supplyLastResults").click();
  await expect(page.locator(".supply-delivery")).toHaveAttribute("data-phase", "rewards");
  await expect(page.locator(".supply-delivery .supply-result")).toHaveCount(10);
  expect(await page.evaluate(()=>Economy.snapshot().itemInventory["0079t1-token"])).toBe(balanceAfterTen);
  await page.locator(".supply-delivery").getByRole("button",{name:"收下补给",exact:true}).click();
  expect(await page.locator(".supply-detail").evaluate(node=>node.scrollHeight<=node.clientHeight+1)).toBe(true);
  await expect(page.locator("#supplyDrawOnce")).toBeEnabled();
  await page.locator("#supplyDrawOnce").click();
  const saved = await page.evaluate(()=>JSON.stringify(Economy.snapshot()));
  await page.reload();await page.waitForFunction(() => assetsReady);
  expect(await page.evaluate(()=>JSON.stringify(Economy.snapshot()))).toBe(saved);
  await expect(page.locator(".supply-delivery")).toHaveCount(0);
  await page.locator("#shellMissions").click();await page.locator("#shellContactSupply").click();
  await expect(page.locator("#supplyDrawTen")).toBeEnabled();
});

test("0079T1 token migration and full deliveries block both draws until units are received", async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({width:390,height:844});
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => {
    I18n.setLanguage("zh");
    const profile=Economy.initial("EFSF");
    profile.itemInventory={"supply-token":100};
    profile.storage.deliveries=Array.from({length:100},()=>({unitId:"RGM_79",kitId:Economy.defaultKit("RGM_79")}));
    localStorage.setItem(Economy.key,SaveCodec.stringify(profile));
  });
  await page.reload();await page.waitForFunction(() => assetsReady);
  await page.locator("#shellMissions").click();await page.locator("#shellContactSupply").click();
  await expect(page.locator("#supplyDrawOnce")).toBeDisabled();
  await expect(page.locator("#supplyDrawTen")).toBeDisabled();
  await expect(page.locator(".supply-capacity-warning")).toContainText("超过99台");
  expect(await page.evaluate(() => Economy.snapshot().itemInventory)).toEqual({"0079t1-token":100});
  const checked=await page.evaluate(() => {
    const before=JSON.stringify(Economy.snapshot());let rejected=0;
    for(const count of [1,10])try{Economy.drawSupply("gundam-04-05",count);}catch(error){if(error.message.includes("超过99"))rejected++;}
    return {rejected,unchanged:JSON.stringify(Economy.snapshot())===before};
  });
  expect(checked).toEqual({rejected:2,unchanged:true});
  await page.screenshot({path:"tmp/verification/screenshots/supply-capacity-blocked-390.png"});
  expect(await page.locator(".supply-detail").evaluate(node=>node.scrollHeight<=node.clientHeight+1)).toBe(true);
  await page.evaluate(() => Economy.receiveDeliveries());
  await expect(page.locator("#supplyDrawOnce")).toBeEnabled();
  await expect(page.locator("#supplyDrawTen")).toBeEnabled();
  expect(await page.evaluate(()=>Economy.snapshot().itemInventory["0079t1-token"])).toBe(100);
});
