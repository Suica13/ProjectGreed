const {test}=require('node:test'), assert=require('node:assert/strict');
const A=require('../map-editor/authoring.js'), M=require('../shared/map-document.js');
const catalog=[{id:'RGM_79',name:'吉姆'}];
test('text units validate atomically, wrap rows and preserve teams/history',()=>{
 const d=M.create(); const u=A.parseUnits('吉姆,2,47,2,2',d,catalog);
 assert.deepEqual(u.map(v=>[v.team,v.x,v.y]),[[1,47,2],[1,0,3]]);
 d.units=u.map((v,i)=>({...v,id:'u'+i})); const snapshot=M.snapshot(d); d.units[0].x=1;assert.equal(snapshot.units[0].x,47);
 assert.deepEqual(M.importMap(M.compile(snapshot)).units,snapshot.units);
 for(const text of ['invalid,1,1,1','吉姆,3,1,1','吉姆,1,1,1,0','吉姆,1,47,31,2','吉姆,1,0,3']) assert.throws(()=>A.parseUnits(text,d,catalog));
 assert.throws(()=>M.resize(snapshot,12,9));
});
test('resources deduplicate original bytes and reject remote references',()=>{
 const src='data:image/png;base64,AQID', d={tilesets:[{id:'a',image:src}],layers:[{id:'b',type:'image',image:{src}}]};
 const r=A.resourceFiles(d);assert.equal(r.files.length,1);assert.equal(r.manifest.length,2);assert.deepEqual([...r.files[0].data],[1,2,3]);
 assert.throws(()=>A.resourceFiles({tilesets:[{image:'https://example.com/a.png'}],layers:[]}));
});
