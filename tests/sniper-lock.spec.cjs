const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("native lock stays white through the charge and turns red only for a valid next-turn shot", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const result = await page.evaluate(async () => {
    Net.leave();
    game = Rules.create(
      false,
      1,
      [
        [
          {
            unitId: "RGM_79_G_SP",
            kitId: Object.values(UnitModels).find((m) => m.prefabId === "RGM_79_G_SP").kitId,
          },
        ],
        [{ unitId: "RGM_79", kitId: "machine_gun" }],
      ],
      false,
      { costLimit: 99999, unitCostLimit: 10000 },
    );
    await SpriteRenderer.ensureAssets([...SpriteRenderer.battleKeys(game), ART.effects.SniperLock.asset]);
    game.tiles.forEach((r) => r.fill("plain"));
    const [a, b] = game.units;
    Object.assign(a, { x: 10, y: 10 });
    Object.assign(b, { x: 14, y: 10, hp: 100000 });
    const w = Rules.modelOf(a).weapons.find((w) => w.special?.type === "snipe");
    a.snipeOrder = { target: b.id, weapon: w.id, readyRound: 3 };
    a.acted = true;
    battleView = null;
    phase = "idle";
    setPageView("game");
    MapCamera.setZoom(3);
    MapCamera.focus(12, 10, { preserveZoom: true });
    drawMap(performance.now());
    const ctx = byId("map").getContext("2d");
    PlanningUI.reset();
    const beginning = PlanningUI.sniperLocks(ctx, 0),
      waiting = PlanningUI.sniperLocks(ctx, 60000);
    Rules.end(game);
    const enemyTurn = PlanningUI.sniperLocks(ctx, 120000);
    Rules.end(game);
    const ready = PlanningUI.sniperLocks(ctx, 120100);
    drawMap(performance.now());
    const image = SpriteRenderer.images[ART.effects.SniperLock.asset];
    const ordinary = Rules.modelOf(a).weapons.find((v) => v.id === w.special.baseWeapon);
    return {
      beginning,
      waiting,
      enemyTurn,
      ready,
      imageReady: image.complete,
      frames: ART.effects.SniperLock.frames,
      speed: w.projectile.speed,
      ordinarySpeed: ordinary.projectile.speed,
      projectileTexture:w.projectile.texture,
    };
  });
  expect(result.beginning[0]).toMatchObject({ frame: 0, red: false });
  expect(result.waiting[0]).toMatchObject({ frame: 2, red: false });
  expect(result.enemyTurn[0]).toMatchObject({ frame: 2, red: false });
  expect(result.ready[0]).toMatchObject({ frame: 19, red: true });
  expect(result.imageReady).toBe(true);
  expect(result.frames).toBe(20);
  expect(result.projectileTexture).not.toMatch(/LockTarget/);
  expect(result.speed).toBe(result.ordinarySpeed);
  expect(result.speed).toBeGreaterThan(1);
  await page.screenshot({ path: "tmp/sniper-lock-red.png" });
  expect(errors).toEqual([]);
});

test("all sniper charge variants render real bullets and finish their playback",async({page})=>{
 test.setTimeout(60000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await expect(page.locator('#openSkirmish')).toBeEnabled();
 const result=await page.evaluate(async()=>{
  Net.leave();session++;
  const variants=new Map();
  for(const model of Object.values(UnitModels))for(const weapon of model.weapons)
   if(weapon.special?.type==='snipe')variants.set(weapon.id,{unitId:model.prefabId,kitId:model.kitId});
  const finish=CombatPlayback.finish;let completed=0,maxSeconds=0;
  CombatPlayback.finish=()=>{completed++;battleView=null;MapCombat.reset();};
  try {
   for(const entry of variants.values()){
    game=Rules.create(false,1,[[entry],[{unitId:'Type61',kitId:'standard'}]],false,{costLimit:99999,unitCostLimit:99999,fogMode:'disabled'});
    game.tiles.forEach(r=>r.fill('plain'));game.deployment=null;game.winner=null;
    const [a,b]=game.units,weapon=Rules.modelOf(a).weapons.find(w=>w.special?.type==='snipe');
    Object.assign(a,{x:5,y:5});Object.assign(b,{x:5+Math.ceil((weapon.min+weapon.max)/2),y:5,hp:1000000});
    const room={game},planner=createAttackPlanner(Rules,()=>Math.random().toString(36));planner.reset(room);
    planner.plan(room,a,b,weapon,0);planner.prepare(room);planner.resolve(room);
    Rules.end(game);Rules.end(game);planner.resumeCharges(room);planner.prepare(room);
    while(room.reactions.length)planner.choose(room,room.reactions[0].id,'defend');
    const battles=planner.resolve(room);
    if(!battles.length)throw Error('Ready sniper did not fire: '+entry.unitId);
    await SpriteRenderer.ensureModels(game.units.map(u=>u.model));
    MapCombat.reset();MapCombat.seed(battles);
    battleView={networkId:'sniper-test',battles,events:battles.flatMap(b=>b.events),actors:battles.flatMap(b=>b.actors)};
    phase='battle';pending=moving=null;setPageView('game');MapCombat.begin(battleView,()=>0);
    let now=performance.now(),elapsed=0;
    while(battleView&&elapsed<10000){elapsed+=40;now+=40;MapCombat.update(now);drawMap(now);}
    if(battleView)throw Error('Sniper playback exceeded ten seconds: '+entry.unitId);
    maxSeconds=Math.max(maxSeconds,elapsed/1000);
   }
  } finally {CombatPlayback.finish=finish;MapCombat.reset();battleView=null;}
  return {expected:variants.size,completed,maxSeconds};
 });
 expect(result.expected).toBeGreaterThanOrEqual(6);expect(result.completed).toBe(result.expected);
 expect(result.maxSeconds).toBeLessThan(10);expect(errors).toEqual([]);
});
