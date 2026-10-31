const {test,expect}=require("@playwright/test");
const {pathToFileURL}=require("node:url");
const path=require("node:path");

test("long map movements accelerate and two player animations coexist",async({page})=>{
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(()=>assetsReady);
  const result=await page.evaluate(()=>{
    byId("quick").checked=false;
    const actors=[{id:"ai-first",model:"Type61__standard"},{id:"ai-second",model:"Type61__standard"}];
    const paths=[Array.from({length:20},(_,i)=>({x:i+1,y:2})),Array.from({length:8},(_,i)=>({x:i+1,y:4}))];
    PlanningUI.reset();
    for(let i=0;i<2;i++)PlanningUI.move({unitId:actors[i].id,from:{x:0,y:2+i*2},path:paths[i]},actors[i]);
    const first=PlanningUI.motion(actors[0],100),second=PlanningUI.motion(actors[1],100);
    const values={both:!!first&&!!second,long:first.step*paths[0].length,short:second.step*paths[1].length};
    values.longAlive=!!PlanningUI.motion(actors[0],100+values.long-1);
    values.shortFinished=PlanningUI.motion(actors[1],100+values.short+1)===null;
    values.longFinished=PlanningUI.motion(actors[0],100+values.long+1)===null;
    PlanningUI.reset();return values;
  });
  expect(result.both).toBe(true);
  expect(result.long).toBeLessThanOrEqual(1200);
  expect(result.long).toBeLessThan(20*120);
  expect(result.long).toBeGreaterThan(result.short);
  expect(result.longAlive&&result.shortFinished&&result.longFinished).toBe(true);
  expect(errors).toEqual([]);
});
