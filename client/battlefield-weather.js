/* Cosmetic map weather and daylight. Deterministic frame math; no gameplay modifiers. */
const BattlefieldWeather = (() => {
  const validWeather = ["clear","rain","snow","sand"];
  const validDay = ["day","night","cycle"];
  function resolve(map = {}, settings = {}, round = 0) {
    const source = map.weather || map.environmentSettings || {};
    const weather = settings.weather && settings.weather !== "map" ? settings.weather : source.weather || "clear";
    const dayNight = settings.dayNight && settings.dayNight !== "map" ? settings.dayNight : source.dayNight || "day";
    const cycleRounds = Math.max(2, Math.min(100, Number(source.cycleRounds) || 12));
    const phase = dayNight === "cycle" ? (Math.floor(round / cycleRounds) % 2 ? "night" : "day") : dayNight;
    return { weather: validWeather.includes(weather) ? weather : "clear",
      phase: validDay.includes(phase) ? phase : "day", cycleRounds };
  }
  function draw(ctx, width, height, now, map, settings, round) {
    const state = resolve(map, settings, round);
    ctx.save();
    if (state.phase === "night") {
      ctx.fillStyle = "rgba(6,17,49,0.38)";
      ctx.fillRect(0,0,width,height);
    }
    if (state.weather === "sand") {
      ctx.fillStyle = "rgba(185,134,59,0.17)";
      ctx.fillRect(0,0,width,height);
    }
    if (state.weather === "rain" || state.weather === "snow") {
      ctx.strokeStyle = state.weather === "rain" ? "rgba(154,194,224,.4)" : "rgba(235,245,255,.65)";
      ctx.fillStyle = "rgba(235,245,255,.7)";
      ctx.lineWidth = 1;
      const count = Math.min(180, Math.ceil(width*height/3800));
      for(let i=0;i<count;i++) {
        const x = ((i*131.7 + now*(state.weather==="rain"?.15:.018)) % (width+20)+width+20)%(width+20);
        const y = ((i*79.3 + now*(state.weather==="rain"?.48:.035)) % (height+20)+height+20)%(height+20);
        if(state.weather==="rain"){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-3,y+10);ctx.stroke();}
        else {ctx.beginPath();ctx.arc(x,y,1.5,0,Math.PI*2);ctx.fill();}
      }
    }
    ctx.restore();
    return state;
  }
  return { resolve, draw };
})();
if(typeof module!=="undefined") module.exports=BattlefieldWeather;
