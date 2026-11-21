const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup(){
 const calls=[],models={};
 for(const [id,weapon,ship,mapScale] of [['Hull__base','short',false,1],['Hull__long','long',false,1],['Other__base','wide',false,1],['Small__base','short',false,0.5],['ShipA__base','gun',true,1],['ShipB__base','cannon',true,1]])models[id]={name:id,ship,weapons:[{id:weapon}],presentation:{mapScale,idle:'Common_Idle'}};
 const context=vm.createContext({assetsReady:true,UnitModels:models,Rules:{mapCellPixels:160},ART:{presentation:{unitMapScale:1.5}},SpriteRenderer:{modelsReady:()=>true,draw:(...args)=>calls.push(args)}});
 vm.runInContext(fs.readFileSync('client/unit-preview.js','utf8')+';globalThis.preview=UnitPreview;',context);
 context.preview.zoom('units',1); context.preview.zoom('ships',0.25);
 const canvas=()=>({width:360,height:320,dataset:{},setAttribute(){},getContext:()=>({clearRect(){}})});
 return {calls,context,canvas};
}
test('all unit previews retain map origins and one scale across chassis and weapon kits',()=>{
 const {calls,context,canvas}=setup();
 for(const id of ['Hull__base','Hull__long','Other__base'])context.preview.renderPreview(id,canvas(),180);
 for(const call of calls){assert.equal(call[2],180);assert.equal(call[3],160);assert.equal(call[4],2.55);assert.equal(call[6],'Common_Idle');}
 assert.equal(calls[0][8],'short');assert.equal(calls[1][8],'long');
 context.preview.renderPreview('Small__base',canvas(),180);
 assert.equal(calls[3][4],calls[0][4]*0.5);
});
test('ships share the same fixed viewport instead of individually filling it',()=>{
 const {calls,context,canvas}=setup();
 for(const id of ['ShipA__base','ShipB__base'])context.preview.renderPreview(id,canvas(),180);
 assert.equal(calls[0][4],calls[1][4]);
 assert.equal(calls[0][4],2.55/4);
 context.preview.zoom('ships',1);
 context.preview.renderPreview('ShipA__base',canvas(),180);
 assert.equal(calls[2][4],2.55); // Same percentage has the same world scale for ships and MS.
});

test('standalone data-only catalogs use the same map calibration',()=>{
 const {calls,context,canvas}=setup();
 delete context.Rules.mapCellPixels;
 context.preview.renderPreview('Hull__base',canvas(),180);
 assert.equal(calls[0][4],2.55);
});
test('inventory preview passes current broken parts into the battle sprite renderer',()=>{
 const {calls,context,canvas}=setup(),c=canvas();
 c.previewParts={leftArm:true,head:true};c.dataset.cardZoom='1';
 context.preview.renderPreview('Hull__base',c,180,'card');
 assert.deepEqual(calls[0][12],c.previewParts);
 assert.equal(calls[0][5],180);
});
