/* Presentation-only climate renderer. Blends old and new states over 1.8 seconds. */
const BattlefieldWeather = (() => {
  let lastKey = null, current = null, previous = null, changedAt = 0;
  const names = {clear:"晴天",rain:"雨天",heavy_rain:"暴雨",fog:"雾天",overcast:"阴天",
    snow:"雪天",blizzard:"暴雪",sand:"沙尘",sandstorm:"沙尘暴",none:"无天气"};
  const times = {dawn:"清晨",morning:"上午",noon:"正午",afternoon:"下午",dusk:"黄昏",
    evening:"晚上",late_night:"深夜",pre_dawn:"凌晨",none:"无时间"};
  function resolve(map, settings, round, seed) {
    return BattlefieldClimate.resolve(map, settings, round, seed);
  }
  function layer(ctx,w,h,now,state,alpha) {
    if (!state || alpha <= 0) return;
    ctx.save(); ctx.globalAlpha=alpha;
    const t=state.time;
    const darkness={dawn:.13,morning:.02,noon:0,afternoon:.04,dusk:.23,
      evening:.36,late_night:.48,pre_dawn:.39}[t] || 0;
    if(darkness){ctx.fillStyle="rgba(6,16,45,"+darkness+")";ctx.fillRect(0,0,w,h);}
    const weather=state.weather;
    const overlays={fog:["190,205,211",.24],overcast:["75,86,99",.19],
      sand:["186,137,69",.18],sandstorm:["169,117,46",.36],
      heavy_rain:["49,71,99",.21],blizzard:["199,219,233",.18]};
    if(overlays[weather]){
      const [rgb,opacity]=overlays[weather];ctx.fillStyle="rgba("+rgb+","+opacity+")";ctx.fillRect(0,0,w,h);
    }
    if(["rain","heavy_rain","snow","blizzard","sand","sandstorm"].includes(weather)){
      const rain=weather==="rain"||weather==="heavy_rain";
      const snow=weather==="snow"||weather==="blizzard";
      const heavy=["heavy_rain","blizzard","sandstorm"].includes(weather);
      const count=Math.min(heavy?300:145,Math.ceil(w*h/(heavy?2000:4200)));
      ctx.lineWidth=1;
      ctx.strokeStyle=rain?"rgba(158,200,235,.48)":snow?"rgba(238,247,255,.78)":"rgba(210,177,117,.5)";
      ctx.fillStyle=ctx.strokeStyle;
      for(let i=0;i<count;i++){
        const x=((i*131.7+now*(rain?.22:snow?.026:.085))%(w+20)+w+20)%(w+20);
        const y=((i*79.3+now*(rain?.56:snow?.043:.12))%(h+20)+h+20)%(h+20);
        if(rain){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-4,y+(heavy?15:9));ctx.stroke();}
        else {ctx.beginPath();ctx.arc(x,y,snow?1.6:1.1,0,Math.PI*2);ctx.fill();}
      }
    }
    ctx.restore();
  }
  function draw(ctx,w,h,now,map,settings,round,seed=1){
    const state=resolve(map,settings,round,seed);
    const key=state.weather+":"+state.time;
    if(lastKey===null){lastKey=key;current=state;}
    else if(key!==lastKey){previous=current;current=state;lastKey=key;changedAt=now;}
    const progress=Math.min(1,Math.max(0,(now-changedAt)/1800));
    if(previous && progress<1)layer(ctx,w,h,now,previous,1-progress);
    else previous=null;
    layer(ctx,w,h,now,current,previous?progress:1);
    return state;
  }
  return {draw,resolve,names,times};
})();
if(typeof module!=="undefined") module.exports=BattlefieldWeather;
