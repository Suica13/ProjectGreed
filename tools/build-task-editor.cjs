"use strict";
const fs=require('node:fs'),path=require('node:path');
function buildTaskEditor(root=path.resolve(__dirname,'..')){
  const read=file=>fs.readFileSync(path.join(root,file),'utf8');
  const version=JSON.parse(read('project.json')).version,types=require('../task-editor/catalog.cjs'),M=require('../task-editor/model.js');
  const sample=M.blank();sample.project.name='示例：回收资料并撤离';
  const add=(kind,parent,title,description)=>{const n=M.add(sample,types.find(t=>t.id===kind),parent);n.title=title;n.description=description;return n;};
  const rootNode=add('plan.task',null,'接受委托','PMC接到回收资料的任务；地面、0079T1、敌军吉翁。');
  const recover=add('contract.salvage',rootNode.id,'回收战场资料','接近残骸后手动回收；完成后召唤一队追击部队。');
  const branch=add('plan.branch',recover.id,'是否继续清除驻军？','玩家可提前撤离，或继续完成歼灭事件后撤离。');
  const fight=add('contract.command',branch.id,'消灭守备小队','驻军由3台扎古2F组成；需AI确定地图区域和套件。');fight.edgeLabel='继续作战';
  const exit=add('plan.task',branch.id,'提前撤离','逐台进入撤离区；多人时等待所有玩家撤离。');exit.edgeLabel='直接撤离';
  add('plan.task',fight.id,'完成额外目标后撤离','奖励按完成事件数结算，单位库存满时送至保管库。');
  const data={version,types,sample,eras:require('../shared/technology-eras.js').eras};
  const escape=source=>source.replace(/<\/script/gi,'<\\/script');
  const html=read('task-editor/editor.html').replace('__VERSION__',()=>version).replace('__CSS__',()=>read('task-editor/editor.css'))
    .replace('__DATA__',()=>escape('const EDITOR_DATA = '+JSON.stringify(data)+';'))
    .replace('__JS__',()=>escape(read('task-editor/model.js')+'\n'+read('task-editor/editor.js')));
  const output=path.join(root,'public/task-tree-editor.html');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);
  const release=path.join(root,'build',version,`ProjectGreed-${version}-task-tree-editor.html`);fs.mkdirSync(path.dirname(release),{recursive:true});fs.copyFileSync(output,release);
  console.log('Built task-tree-editor.html: '+Buffer.byteLength(html)+' bytes');return {output,release};
}
module.exports={buildTaskEditor};if(require.main===module)buildTaskEditor();
