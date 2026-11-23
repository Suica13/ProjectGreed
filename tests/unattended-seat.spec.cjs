const {test,expect}=require("@playwright/test");
const {pathToFileURL}=require("node:url"),path=require("node:path");

test("the standalone client temporarily controls an unattended ally and restores normal permissions",async({page})=>{
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(()=>assetsReady);
  const result=await page.evaluate(()=>{
    Net.leave();
    const entry={unitId:"RGM_79",kitId:"machine_gun"};
    game=Rules.create(false,1,[[entry],[entry],[entry],[entry]],false,{mapId:"crossroads_2v2",fogMode:"disabled"});
    Net.active=true;Net.seat=0;Net.socket={readyState:WebSocket.OPEN};Net.awaiting=false;
    Net.snapshot={started:true,settings:{shareAlliedUnits:false},connected:[true,true,true,true],
      members:[{seat:0,connected:true},{seat:1,connected:true},{seat:3,connected:true}],
      delegatedSeats:[],turnDone:[false,false,false,false],game};
    const ally=game.units.find(unit=>Rules.ownerOf(unit)===2),enemy=game.units.find(unit=>Rules.ownerOf(unit)===1);
    const shared=Net.canControl(ally),acting=Net.canAct(),opponent=Net.canControl(enemy);
    Net.seat=null;const spectator=Net.canControl(ally);Net.seat=0;
    Net.snapshot.members.push({seat:2,connected:true});
    const reconnected=Net.canControl(ally);
    Net.active=false;Net.socket=null;
    return {shared,acting,opponent,spectator,reconnected,owner:Rules.ownerOf(ally)};
  });
  expect(result).toEqual({shared:true,acting:true,opponent:false,spectator:false,reconnected:false,owner:2});
  expect(errors).toEqual([]);
});
