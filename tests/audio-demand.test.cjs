const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function runtime(){
 let fetches=0,decodes=0,active=0,maximum=0,plays=0;
 const sounds=new Proxy({a:'shared',alias:'shared',unused:'never'}, {ownKeys(){throw Error('Do not enumerate the whole audio catalog');}});
 class AudioContext{
  constructor(){this.state='running';this.currentTime=0;this.destination={};}
  async decodeAudioData(){decodes++;active++;maximum=Math.max(maximum,active);await new Promise(r=>setTimeout(r,2));active--;return {};}
  createBufferSource(){return {playbackRate:{},connect(){},start(){plays++;},stop(){},disconnect(){}};}
  createGain(){return {gain:{},connect(){},disconnect(){}};}
 }
 const context={ART:{sounds,presentation:{sfxVolume:1},models:{used:{weapons:[{sound:{asset:'a',volume:1}}]}}},window:{AudioContext,addEventListener(){}},document:{hidden:false,addEventListener(){}},setTimeout,
  fetch:async()=>{fetches++;return {arrayBuffer:async()=>new ArrayBuffer(1)};}};
 vm.createContext(context);vm.runInContext(fs.readFileSync('client/weapon-audio.js','utf8')+'\nglobalThis.audio=WeaponAudio;',context);
 return {audio:context.audio,stats:()=>({fetches,decodes,maximum,plays})};
}
test('unlock never scans unrelated sound data, requested aliases decode only once',async()=>{
 const r=runtime();await r.audio.unlock();assert.equal(r.stats().fetches,0);
 await r.audio.prepare([{asset:'a'},{asset:'alias'}]);assert.equal(r.stats().fetches,1);assert.equal(r.stats().decodes,1);
 r.audio.play({asset:'a',volume:1});r.audio.play({asset:'alias',volume:1});assert.equal(r.stats().plays,2);
});
test('battle prewarming only prepares the models in that battle',async()=>{
 const r=runtime();await r.audio.unlock();r.audio.prepareBattle({game:{units:[{model:'used'}]}});
 await r.audio.prepare([{asset:'a'}]);assert.equal(r.stats().fetches,1);assert(r.stats().maximum<=2);
});
test('stopping a scene cancels deferred uncached audio before it can play',async()=>{
 const r=runtime();await r.audio.unlock();r.audio.play({asset:'a',volume:1});r.audio.stop(true);
 await r.audio.prepare([{asset:'a'}]);await Promise.resolve();assert.equal(r.stats().plays,0);
});
