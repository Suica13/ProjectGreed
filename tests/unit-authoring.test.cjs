const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const A=require('../unit-editor/model.js'),Store=require('../tools/weapon-store.cjs'),root=path.resolve(__dirname,'..');
function template(id){const dir=path.join(root,'assets/units',id),u=Store.parse(fs.readFileSync(path.join(dir,'unit.json'),'utf8'));return {format:'pg-unit-project',version:1,templateId:id,unit:u,textures:Object.fromEntries(Object.entries(u.materials.textures).map(([k,f])=>[k,'data:image/png;base64,'+fs.readFileSync(path.resolve(dir,f)).toString('base64')])),animations:Object.fromEntries(Object.entries(u.animations).map(([k,f])=>[k,JSON.parse(fs.readFileSync(path.resolve(dir,f)))]))};}
test('three MS templates export and pass the actual catalog loader without overwriting source',()=>{
 const suffix='_EditorTest_'+process.pid;
 const catalog=JSON.parse(fs.readFileSync(path.join(root,'assets/unit-catalog.json'))),dirs=[];
 try{for(const id of ['RGM_79','MS_06F','RX_78_2']){
  const p=A.newProject(template(id));p.unit.id=id+suffix;const dir=path.join(root,'assets/units',p.unit.id);assert.ok(!fs.existsSync(dir));dirs.push(dir);
  for(const f of A.exportFiles(p)){if(!f.name.startsWith('assets/'))continue;const file=path.join(root,f.name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,f.data);}
  catalog.units.push('units/'+p.unit.id+'/unit.json');
 }
 const loaded=require('../tools/load-catalog.cjs').loadCatalog({catalogOverride:catalog,embedAssets:false});for(const id of ['RGM_79','MS_06F','RX_78_2'])assert.ok(loaded.prefabs.some(p=>p.id===id+suffix));
 }finally{for(const dir of dirs)fs.rmSync(dir,{recursive:true,force:true});}
});
test('authoring rejects destructive IDs and invalid references; cloning keeps source raw values',()=>{
 const source=template('RGM_79'),p=A.newProject(source);assert.equal(p.unit.stats.hp,source.unit.stats.hp);p.unit.layers[0].offset.x=12;assert.notEqual(source.unit.layers[0].offset.x,12);
 const initial=JSON.stringify(p);for(const mutate of [p=>p.unit.id='../bad',p=>p.unit.layers[0].texture='missing',p=>p.unit.layers[0].bone='missing',p=>p.unit.layers[0].visibleWhen={heldWeapon:'bad'},p=>p.unit.weapons.EF_BeamSprayGun.clip='bad']){const q=JSON.parse(initial);mutate(q);assert.throws(()=>A.validate(q));}
 assert.throws(()=>A.validate(p,[p.unit.id]));
});
test('preview uses shared renderer for conditional layers and interpolated animation',()=>{
 const p=A.newProject(template('RGM_79'));p.unit.layers[0].visibleWhen={heldWeapon:'EF_BeamSprayGun',attacking:true};const {visual,model}=A.projection(p,'beam_spray');
 const context=vm.createContext({ART:{units:[visual],models:{preview:model},assets:{}},performance:{now:()=>0}});vm.runInContext(fs.readFileSync(path.join(root,'client/renderer.js'),'utf8')+';globalThis.renderer=SpriteRenderer;',context);
 const visible=attack=>context.renderer.visibleLayers('preview','EF_BeamSprayGun',true,false,'Common_Idle',0,false,{},attack);
 assert.ok(visible(true).some(l=>l.name===p.unit.layers[0].name));assert.ok(!visible(false).some(l=>l.name===p.unit.layers[0].name));
 const sample=context.renderer.sample({curves:{Head:{x:[[0,0],[1,10]]}}},.5);assert.equal(sample.Head.x,5);
});
