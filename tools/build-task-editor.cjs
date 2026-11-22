"use strict";
const fs=require('node:fs'),path=require('node:path');
function buildTaskEditor(root=path.resolve(__dirname,'..')){
  const read=file=>fs.readFileSync(path.join(root,file),'utf8'),version=JSON.parse(read('project.json')).version;
  const data={statuses:require('../task-editor/catalog.cjs')};
  const escape=s=>s.replace(/<\/script/gi,'<\\/script');
  const html=read('task-editor/editor.html').replace('__VERSION__',()=>version).replace('__CSS__',()=>read('task-editor/editor.css')).replace('__DATA__',()=>escape('const EDITOR_DATA = '+JSON.stringify(data)+';')).replace('__JS__',()=>escape(read('task-editor/model.js')+'\n'+read('task-editor/editor.js')));
  const output=path.join(root,'admin/task-tree-editor.html');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);
  const release=path.join(root,'build',version,'admin/task-tree-editor.html');fs.mkdirSync(path.dirname(release),{recursive:true});fs.copyFileSync(output,release);
  console.log('Built admin/task-tree-editor.html: '+Buffer.byteLength(html)+' bytes');return {output,release};
}
module.exports={buildTaskEditor};if(require.main===module)buildTaskEditor();
