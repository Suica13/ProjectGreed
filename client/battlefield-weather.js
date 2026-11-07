/* Presentation-only climate renderer. Blends old and new states over 1.8 seconds. */
const BattlefieldWeather = (() => {
  let lastKey = null, current = null, previous = null, changedAt = 0;
  const presets = typeof CLIMATE_EFFECT_PRESETS !== "undefined" ? CLIMATE_EFFECT_PRESETS : null;
  const textureCache = new Map();
  let surfaceCacheKey=null,surfaceCacheValue=null;
  function texture(path) {
    if (!path || typeof Image === "undefined") return null;
    if (!textureCache.has(path)) { const img = new Image(); img.src = path; textureCache.set(path,img); }
    const img = textureCache.get(path);
    return img.complete && img.naturalWidth > 0 ? img : null;
  }
  function textureLayer(ctx, path, w, h, alpha) {
    const img = texture(path); if (!img) return false;
    ctx.save();ctx.globalAlpha *= alpha;
    const pattern = ctx.createPattern(img,"repeat");
    if (pattern) {ctx.fillStyle=pattern;ctx.fillRect(0,0,w,h);}
    ctx.restore();return !!pattern;
  }
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
    const darkness=(presets?.timeDarkness || {dawn:.13,morning:.02,noon:0,afternoon:.04,dusk:.23,
      evening:.36,late_night:.48,pre_dawn:.39})[t] || 0;
    if(darkness){ctx.fillStyle="rgba(6,16,45,"+darkness+")";ctx.fillRect(0,0,w,h);}
    const weather=state.weather;
    const overlays=presets?.overlays || {fog:{rgb:"190,205,211",opacity:.24},overcast:{rgb:"75,86,99",opacity:.19},
      sand:{rgb:"186,137,69",opacity:.18},sandstorm:{rgb:"169,117,46",opacity:.36},
      heavy_rain:{rgb:"49,71,99",opacity:.21},blizzard:{rgb:"199,219,233",opacity:.18}};
    if(overlays[weather]){
      const overlay=overlays[weather];const rgb=overlay.rgb ?? overlay[0],opacity=overlay.opacity ?? overlay[1];
      ctx.fillStyle="rgba("+rgb+","+opacity+")";ctx.fillRect(0,0,w,h);
    }
    const customTexture=presets?.assets?.[weather];
    if(customTexture && textureLayer(ctx,customTexture,w,h,1)){ctx.restore();return;}
    if(["rain","heavy_rain","snow","blizzard","sand","sandstorm"].includes(weather)){
      const rain=weather==="rain"||weather==="heavy_rain";
      const snow=weather==="snow"||weather==="blizzard";
      const heavy=["heavy_rain","blizzard","sandstorm"].includes(weather);
      const visual=presets?.precipitation?.[weather] || {};
      const count=Math.min(visual.count ?? (heavy?300:145),Math.ceil(w*h/(heavy?2000:4200)));
      ctx.lineWidth=1;
      ctx.strokeStyle=visual.stroke ? visual.stroke : rain?"rgba(158,200,235,.48)":snow?"rgba(238,247,255,.78)":"rgba(210,177,117,.5)";
      ctx.globalAlpha *= visual.opacity ?? 1;
      ctx.fillStyle=ctx.strokeStyle;
      for(let i=0;i<count;i++){
        const x=((i*131.7+now*(visual.speedX ?? (rain?.22:snow?.026:.085)))%(w+20)+w+20)%(w+20);
        const y=((i*79.3+now*(visual.speedY ?? (rain?.56:snow?.043:.12)))%(h+20)+h+20)%(h+20);
        if(rain){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-4,y+(visual.length ?? (heavy?15:9)));ctx.stroke();}
        else {ctx.beginPath();ctx.arc(x,y,visual.radius ?? (snow?1.6:1.1),0,Math.PI*2);ctx.fill();}
      }
    }
    ctx.restore();
  }
  function surfaceState(map,settings,round,seed) {
    const rules=presets?.surfaces || {};
    let snow=0,wet=0,dust=0;
    // Derive surface accumulation from the same seeded history on every client.
    // No extra state is written to save files; replays remain deterministic.
    const start=Math.max(1,round-160);
    for(let turn=start;turn<=round;turn++){
      const state=resolve(map,settings,turn,seed), weather=state.weather;
      snow=Math.max(0,Math.min(100,snow+(weather==="snow"?(rules.snow?.snow??5):weather==="blizzard"?(rules.snow?.blizzard??12):weather==="rain"||weather==="heavy_rain"?-(rules.snow?.meltRain??8):weather==="clear"?-(rules.snow?.meltClear??3):0)));
      wet=Math.max(0,Math.min(100,wet+(weather==="rain"?(rules.wet?.rain??10):weather==="heavy_rain"?(rules.wet?.heavy_rain??22):-(rules.wet?.dry??4))));
      dust=Math.max(0,Math.min(100,dust+(weather==="sand"?(rules.dust?.sand??6):weather==="sandstorm"?(rules.dust?.sandstorm??14):weather==="clear"?-(rules.dust?.clear??3):0)));
    }
    return {snow,wet,dust};
  }
  function ground(ctx,w,h,map,settings,round,seed,geometry) {
    const state=resolve(map,settings,round,seed);
    // Explicit map opt-in plus room veto; no accidental cover on legacy maps.
    if(state.space || map.surfaceCover !== true || settings.surfaceCover === false) return;
    const cacheKey=[map?.id||map?.name||"",round,seed,JSON.stringify(settings)].join(":");
    if(cacheKey!==surfaceCacheKey){surfaceCacheKey=cacheKey;surfaceCacheValue=surfaceState(map,settings,round,seed);}
    const surface=surfaceCacheValue;
    if(!geometry || !Array.isArray(map.tiles))return;
    const {tile,ox,oy}=geometry;
    if(!(tile>0))return;
    const firstX=Math.max(0,Math.floor(-ox/tile)),lastX=Math.min(map.width,Math.ceil((w-ox)/tile));
    const firstY=Math.max(0,Math.floor(-oy/tile)),lastY=Math.min(map.height,Math.ceil((h-oy)/tile));
    const terrains=typeof MapDocument !== "undefined" ? MapDocument.terrains : {};
    ctx.save();
    for(let y=firstY;y<lastY;y++)for(let x=firstX;x<lastX;x++){
      const terrain=terrains[map.tiles[y]?.[x]];
      const cover=terrain?.cover || {snow:1,wet:1,dust:1};
      for(const [kind,rgb,opacity] of [["snow","231,241,247",.35],["wet","27,43,58",.24],["dust","191,147,87",.21]]){
        const strength=surface[kind]/100*(cover[kind]??1);
        if(strength<=0)continue;
        ctx.fillStyle="rgba("+rgb+","+(opacity*strength)+")";
        ctx.fillRect(ox+x*tile,oy+y*tile,tile+0.3,tile+0.3);
      }
    }
    ctx.restore();
  }
  function lightning(ctx,w,h,now,state,round,seed) {
    const spec=presets?.lightning;
    if(!spec?.enabled || !spec.weather?.includes(state.weather) || state.space)return;
    const interval=Math.max(1,spec.frequencyRounds||3);
    if(round%interval!==0)return;
    const duration=spec.flashDurationMs||500;
    const cycle=12000;
    const phase=((now+((seed>>>0)%3000))%cycle+cycle)%cycle;
    if(phase>=duration)return;
    const fraction=phase/duration;
    const intensity=fraction<.18?fraction/.18:fraction<.32?.25:fraction<.45?.8*(1-(fraction-.32)/.13):Math.max(0,.3*(1-fraction)/.55);
    ctx.save();ctx.fillStyle="rgba(235,243,255,"+(Math.max(0,Math.min(1,intensity*(spec.maxOpacity??.62))))+")";ctx.fillRect(0,0,w,h);ctx.restore();
  }
  function draw(ctx,w,h,now,map,settings,round,seed=1,geometry=null){
    const state=resolve(map,settings,round,seed);
    const key=state.weather+":"+state.time;
    if(lastKey===null){lastKey=key;current=state;}
    else if(key!==lastKey){previous=current;current=state;lastKey=key;changedAt=now;}
    const progress=Math.min(1,Math.max(0,(now-changedAt)/(presets?.transitionMs || 1800)));
    ground(ctx,w,h,map,settings,round,seed,geometry);
    if(previous && progress<1)layer(ctx,w,h,now,previous,1-progress);
    else previous=null;
    layer(ctx,w,h,now,current,previous?progress:1);
    lightning(ctx,w,h,now,state,round,seed);
    return state;
  }
  return {draw,resolve,names,times,surfaceState};
})();
if(typeof module!=="undefined") module.exports=BattlefieldWeather;
