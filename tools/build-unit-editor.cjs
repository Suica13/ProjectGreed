'use strict';
const fs=require('node:fs'),path=require('node:path'),Store=require('./weapon-store.cjs');
function buildUnitEditor(root=path.resolve(__dirname,'..')) {
 const read=p=>fs.readFileSync(path.join(root,p),'utf8'), catalog=JSON.parse(read('assets/unit-catalog.json'));
 const ids=catalog.units.map(f=>JSON.parse(read('assets/'+f)).id);
 const templates=['RGM_79','MS_06F','RX_78_2'].map(id=>{
  const dir=path.join(root,'assets/units',id), unit=Store.parse(fs.readFileSync(path.join(dir,'unit.json'),'utf8'));
  const textures=Object.fromEntries(Object.entries(unit.materials.textures).map(([key,file])=>[key,'data:image/'+(path.extname(file).slice(1)==='jpg'?'jpeg':path.extname(file).slice(1))+';base64,'+fs.readFileSync(path.resolve(dir,file)).toString('base64')]));
  const animations=Object.fromEntries(Object.entries(unit.animations).map(([key,file])=>[key,JSON.parse(fs.readFileSync(path.resolve(dir,file),'utf8'))]));
  return {format:'pg-unit-project',version:1,templateId:id,unit,textures,animations};
 });
 const inline=s=>s.replace(/<\/script/gi,'<\\/script');
 const html=read('unit-editor/editor.html').replace('__CSS__',()=>read('unit-editor/editor.css')).replace('__JS__',()=>inline('const UNIT_TEMPLATES='+JSON.stringify(templates)+';const EXISTING_UNIT_IDS='+JSON.stringify(ids)+';const RW_TEMPLATES='+read('unit-editor/rw-templates.json')+';\n'+read('unit-editor/rw-export.js')+'\n'+read('unit-editor/model.js')+'\n'+read('map-editor/authoring.js')+'\nconst ART={units:[],models:{},assets:{}};const SpriteEffects={clipFog(){},brokenModules(){}};\n'+read('client/renderer.js')+'\n'+read('unit-editor/editor.js')));
 fs.writeFileSync(path.join(root,'public/unit-editor.html'),html);console.log('Built unit-editor.html: '+Buffer.byteLength(html)+' bytes');
}
module.exports={buildUnitEditor};if(require.main===module)buildUnitEditor();
