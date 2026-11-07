const {test}=require("node:test"), assert=require("node:assert/strict");
const audio=require("../client/dialogue-audio.js");
test("voice provider is pluggable and safe without a browser audio context",()=>{
  assert.equal(Object.keys(audio.presets).length,4);
  assert.equal(audio.bleep({personality:"calm",text:"测试"}),false);
  assert.throws(()=>audio.registerVoiceProvider(42),TypeError);
  audio.registerVoiceProvider(()=>true);
  assert.doesNotThrow(()=>audio.play({text:"测试"}));
  audio.registerVoiceProvider(null);
  audio.configure({enabled:false,volume:0});
  assert.doesNotThrow(()=>audio.play({text:"测试"}));
});
