const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createLocalizer } = require('../tools/display-localization.cjs');
const dictionaries = Object.fromEntries(['en','ja'].map(l=>[l,require('../client/locales/'+l+'.json')]));
test('every shipped mission label, description, dialogue and choice has English and Japanese text',()=>{
  let count=0;
  function walk(x){if(!x||typeof x!=='object')return;for(const[k,v]of Object.entries(x)){if(typeof v==='string'&&['name','text','description','label'].includes(k)&&/[\u3400-\u9fff]/.test(v)){for(const l of ['en','ja']){assert(dictionaries[l][v]?.trim(),l+': '+v);if(l==='en')assert(!/[\u3400-\u9fff]/.test(dictionaries[l][v]),v);}count++;}else if(typeof v==='object')walk(v);}}
  for(const f of fs.readdirSync('assets/maps/missions'))if(f.endsWith('.json'))walk(JSON.parse(fs.readFileSync('assets/maps/missions/'+f,'utf8')));
  assert(count>150);
});
test('0087 ACE localization covers every imported name and biography without changing stats',()=>{
 const source=require('../shared/pilots.json'),before=JSON.stringify(source);
 const localized=createLocalizer().pilotCatalog(structuredClone(source));
 const aces=localized.aces.filter(p=>p.id.includes('_0087_'));
 assert.equal(aces.length,14);
 for(const p of aces)for(const l of ['en','ja'])for(const field of ['name','description'])assert(p.localization?.[l]?.[field]?.trim(),p.id+'/'+l+'/'+field);
 assert.equal(JSON.stringify(source),before);
 for(const p of aces){const original=source.aces.find(a=>a.id===p.id);assert.deepEqual(p.stats,original.stats);assert.equal(p.costBase,original.costBase);}
});
test('locale keys match and translated placeholders are preserved',()=>{
 assert.deepEqual(Object.keys(dictionaries.en).sort(),Object.keys(dictionaries.ja).sort());
 const tokens=s=>(s.match(/\{\w+\}/g)||[]).sort();
 for(const l of ['en','ja'])for(const[k,v]of Object.entries(dictionaries[l]))assert.deepEqual(tokens(v),tokens(k),l+': '+k);
});
test('mission script editor labels have both translations',()=>{
 const locales=require('../map-editor/locales.json');
 const source=fs.readFileSync('map-editor/mission-editor.js','utf8');
 for(const m of source.matchAll(/(["'])([^\n"']*[\u3400-\u9fff][^\n"']*)\1/g)){
  const key=m[2].trim();if(/[<>\\{;]/.test(key))continue;
  for(const l of ['en','ja'])assert(locales[l][key]?.trim(),l+': '+key);
 }
});
