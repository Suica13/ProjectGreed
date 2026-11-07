const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs");
function fixture(){
 const config=structuredClone(require("../client/climate-effects.json"));config.lightning.enabled=false;
 const sandbox=vm.createContext({CLIMATE_EFFECT_PRESETS:config,BattlefieldClimate:require("../shared/battlefield-climate.js")});
 vm.runInContext(fs.readFileSync("client/battlefield-weather.js","utf8")+";globalThis.weather=BattlefieldWeather",sandbox);
 const points=[],ends=[],fills=[],stack=[];
 const ctx={globalAlpha:1,fillStyle:"",save(){stack.push({alpha:this.globalAlpha,fill:this.fillStyle});},restore(){const s=stack.pop();this.globalAlpha=s.alpha;this.fillStyle=s.fill;},fillRect(){fills.push(this.fillStyle);},beginPath(){},moveTo(x,y){points.push([x,y,this.globalAlpha]);},lineTo(x,y){ends.push([x,y]);},stroke(){},arc(x,y,r){points.push([x,y,this.globalAlpha,r]);},fill(){}};
 return {draw:(weather,time,now=1000)=>sandbox.weather.draw(ctx,900,600,now,{environment:"ground"},{weather,dayNight:time},1,1),points,ends,fills};
}
for(const weather of ["heavy_rain","blizzard"])test(weather+" has independent positions, velocities, sizes and opacity instead of a translating lattice",()=>{
 const f=fixture();f.draw(weather,"noon");const first=f.points.splice(0);const ends=f.ends.splice(0);
 assert(first.length>100);
 assert(new Set(first.map(p=>p[2].toFixed(4))).size>50);
 assert(new Set(first.slice(1).map((p,i)=>(p[0]-first[i][0]).toFixed(3))).size>50);
 f.draw(weather,"noon",1100);
 const wrap=(n,l)=>((n%l)+l)%l;
 assert(new Set(first.map((p,i)=>wrap(f.points[i][0]-p[0],980).toFixed(3))).size>50);
 if(weather==="blizzard")assert(new Set(first.map(p=>p[3].toFixed(3))).size>50);
 else assert(new Set(first.map((p,i)=>(ends[i][1]-p[1]).toFixed(3))).size>50);
 const again=fixture();again.draw(weather,"noon");assert.deepEqual(again.points,first);
});
test("late night is dark navy, noon a restrained warm cream and space stays unfiltered",()=>{
 const night=fixture();night.draw("clear","late_night");assert.equal(night.fills[0],"rgba(3,10,32,0.62)");
 const noon=fixture();noon.draw("clear","noon");assert.equal(noon.fills[0],"rgba(255,237,195,0.055)");
 const state=require("../shared/battlefield-climate.js").resolve({environment:"space"},{dayNight:"late_night"},1);
 assert.equal(state.time,"none");
});
