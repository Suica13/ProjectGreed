/* Native overlays retain combat/driver/resource logic through ROOT inheritance. */
const RWUnitExport=(()=>{
 const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b),num=n=>Number(Number(n).toFixed(6));
 const parts={leftArm:'armLBreaked',rightArm:'armRBreaked',leftLeg:'legLBreaked',rightLeg:'legRBreaked',head:'headBreaked',backpack:'backpackBreaked'};
 function prepare(p,baseline,metadata){
  UnitAuthoring.validate(p);if(!baseline||p.templateId!==baseline.templateId)throw Error('缺少原模板基准');
  const native=metadata.templates[p.templateId];if(!native)throw Error('此模板不支持 RW 导出');
  if(p.unit.id===p.templateId)throw Error('请使用新单位 ID，不能覆盖原模板');
  const errors=[],warnings=['此包依赖原 RW_GW 0079 DLC 与 Main 包；不包含科技树入口。','继承模板的攻击、驾驶员、变形和改造行为；变形/改造后的单位仍为原 MOD 单位。'],sections={},files=[];
  const add=(name,values)=>{sections[name]={...(sections[name]||{}),...values};};
  const u=p.unit,b=baseline.unit,folder='GW_BattleUniverse_DLC_0079/Units/BattleUnits/'+u.id+'/';
  for(const key of Object.keys(u))if(!['id','name','code','localization','refits','production','layers','skeleton','materials','animations'].includes(key)&&!equal(u[key],b[key]))errors.push('暂不转换 '+key+' 的修改；原 MOD 将继承模板，需保持该字段不变');
  // Original source weapons are not equivalent to compiled RTS attack chains.
  if(!equal(u.weapons,b.weapons))errors.push('武器动画绑定、显示索引或枪口已修改：尚不支持反写原 MOD 攻击动作链，请恢复这些修改后导出');
  const texturePaths={};for(const [i,[key,src]]of Object.entries(p.textures).entries()){
   const match=/^data:image\/(png|jpeg|webp|gif);base64,(.+)$/.exec(src);
   if(!match||match[1]!=='png'){errors.push('RW 导出仅支持 PNG 贴图：'+key);continue;}
   texturePaths[key]='Image/texture_'+i+'.png';files.push({name:folder+texturePaths[key],data:Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0))});
  }
  const text=s=>String(s||'').replace(/[\r\n\[\]$]/g,' ').trim();
  add('core',{copyFrom:'ROOT:'+native.path,name:u.id,displayText:text(u.name),displayText_zh:text(u.name),tags:native.tags,showActionsWithMixedSelectionIfOtherUnitsHaveTag:p.templateId});
  add('graphics',{icon_build:texturePaths[u.materials.icon]});
  const boneNative=name=>{const v=metadata.bones[name];if(!v)throw Error('未知原生骨骼：'+name);return v;};
  for(const [name,bone]of Object.entries(u.skeleton))if(!equal(bone,b.skeleton[name])){
   try{const n=boneNative(name),sec=n.replace(/(arm|leg)(\d+)/,'$1_$2');add(sec,bone);}catch(e){errors.push(e.message);}
  }
  function condition(key,value){
   const not=value&&typeof value==='object'&&!Array.isArray(value);const list=not?(Array.isArray(value.not)?value.not:[value.not]):Array.isArray(value)?value:[value];
   const expr=list.map(v=>{
    if(key==='kit'){if(native.kits[v]===undefined)throw Error('套件没有原生装备索引：'+v);return 'self.resource().EquipmentIndex=='+native.kits[v];}
    if(key==='weaponDisplayIndex'){if(!Number.isInteger(v))throw Error('武器显示索引无效');return 'memory.nowWeaponIndex=='+v;}
    if(key==='heldWeapon'){
     const index=native.weapons[v]?.displayIndex;if(index===undefined)throw Error('武器没有原生持握索引：'+v);
     const kits=b.weaponKits.filter(k=>k.weapons.includes(v));
     for(const kit of kits){const peers=kit.weapons.filter(w=>w!==v&&native.weapons[w]?.displayIndex===index);if(peers.length)throw Error('原 MOD 不能区分同索引武器 '+v+' 与 '+peers.join(','));}
     return '(memory.nowWeaponIndex=='+index+' and ('+kits.map(k=>condition('kit',k.id)).join(' or ')+'))';
    }
    const vars={attacking:'${onAttacking}',moving:'self.isMoving',visorClosed:'memory.close',shieldVisible:'(self.shield>0)'};
    if(!vars[key]||typeof v!=='boolean')throw Error('无法可靠映射显隐变量：'+key);
    return vars[key]+'=='+v;
   }).join(' or ');return not?'not ('+expr+')':'('+expr+')';
  }
  const known={kit:/EquipmentIndex/,heldWeapon:/nowWeaponIndex|EquipmentIndex/,weaponDisplayIndex:/nowWeaponIndex/,attacking:/onAttacking/,moving:/isMoving/,visorClosed:/memory\.close/,shieldVisible:/self\.shield/};
  for(const l of u.layers){
   const old=b.layers.find(x=>x.name===l.name),src=native.layers[l.name];
   try{
    if(!/^[\w-]+$/.test(l.name))throw Error('图层名称只能含字母、数字、下划线和连字符');
    if(old&&!src&&equal(l,old)&&p.textures[l.texture]===baseline.textures[old.texture]){warnings.push('保留原 MOD 推进表现，不导出网页附加层：'+l.name);continue;}
    if(!old||!src)throw Error('新增/重命名图层尚未建立原生映射：'+l.name);
    const values={image:texturePaths[l.texture]};
    const mapping={order:'order',scale:'imageScale',scaleX:'imageScaleX',scaleY:'imageScaleY',rotation:'dirOffset',pivot:'pivotOffset',height:'hOffset',alpha:'alpha',frames:'total_frames',frameWidth:'frame_width',frameHeight:'frame_height',frame:'frame'};
    for(const [k,rw]of Object.entries(mapping))if(!equal(l[k],old[k]))values[rw]=l[k]??(['scale','scaleX','scaleY','alpha'].includes(k)?1:0);
    if(l.bone!==old.bone)values.basePositionFromLegEnd=boneNative(l.bone);
    if(!equal(l.offset,old.offset)){values.xOffsetRelative=l.offset?.x||0;values.yOffsetRelative=l.offset?.y||0;}
    const allowed=['name','texture','bone','offset','hidden','visibleWhen','requiredParts',...Object.keys(mapping)];
    for(const k of new Set([...Object.keys(l),...Object.keys(old)]))if(!allowed.includes(k)&&!equal(l[k],old[k]))throw Error('暂不支持图层字段 '+l.name+'.'+k);
    if(!equal(l.requiredParts,old.requiredParts))throw Error('原生肢体破损条件修改尚未支持：'+l.name);
    if(!equal(l.visibleWhen,old.visibleWhen)||l.hidden!==old.hidden){
     if(l.hidden)values.isVisible='false';else{
      const changed=new Set([...Object.keys(l.visibleWhen||{}),...Object.keys(old.visibleWhen||{})].filter(k=>!equal(l.visibleWhen?.[k],old.visibleWhen?.[k])));
      let original=(src.isVisible||'true').replace(/^if\s+/,'').trim();
      if(changed.size&&/\bor\b/.test(original))throw Error('原生显隐含 OR 分支，需人工适配：'+l.name);
      const residual=original.split(/\s+and\s+/).filter(term=>term!=='true'&&!(term==='false'&&changed.size)).filter(term=>![...changed].some(k=>known[k]?.test(term)));
      for(const k of changed){if(!known[k])throw Error('不能替换原生显隐条件：'+k);if(l.visibleWhen?.[k]!==undefined)residual.push(condition(k,l.visibleWhen[k]));}
      values.isVisible='if '+(residual.filter(Boolean).map(x=>'('+x+')').join(' and ')||'true');
     }
    }
    add('decal_'+l.name,values);
   }catch(e){errors.push(e.message);}
  }
  for(const l of b.layers)if(!u.layers.some(x=>x.name===l.name)&&native.layers[l.name])add('decal_'+l.name,{isVisible:'false'});
  for(const [clip,a]of Object.entries(p.animations))if(!equal(a,baseline.animations[clip])){
   try{
    const source=native.animations[clip];if(!source)throw Error('新动画尚未接入原 MOD 动作链：'+clip);
    const out={'@copyFrom_skipThisSection':'true',KeyframeTimeScale:1},scale=Number(source.KeyframeTimeScale||1);
    if(!Number.isFinite(scale))throw Error('原生时间缩放不是常数：'+clip);
    const mapped=new Set(Object.keys(metadata.bones).map(k=>metadata.bones[k]));
    for(const [key,value]of Object.entries(source)){
     if(['KeyframeTimeScale','@copyFromSection'].includes(key))continue;
     const m=/^(\w+)_([\d.]+)s$/.exec(key);
     if(m){if(mapped.has(m[1]))continue;const t=Number(m[2])*scale;if(t>a.duration)throw Error('缩短时长会截断原生附加轨道：'+clip);out[m[1]+'_'+num(t)+'s']=value;}
     else out[key]=value;
    }
    let hasTrack=false;
    for(const [bone,fields]of Object.entries(a.curves)){
     const n=boneNative(bone),rows=new Map();
     for(const [field,points]of Object.entries(fields))for(const [t,v]of points){if(!rows.has(t))rows.set(t,{});rows.get(t)[field]=v;}
     if(!rows.size)continue;
     const last={};for(const [field,points]of Object.entries(fields))last[field]=points.at(-1)[1];rows.set(a.duration,{...last,...rows.get(a.duration)});
     for(const [t,values]of [...rows].sort((a,b)=>a[0]-b[0]))out[n+'_'+num(t)+'s']='{'+Object.entries(values).map(([k,v])=>k+':'+num(v)).join(', ')+'}';hasTrack=true;
    }
    if(!hasTrack)throw Error('动画缺少有效骨骼轨道：'+clip);add('animation_'+clip,out);
   }catch(e){errors.push(e.message);}
  }
  // Removing a clip cannot remove inherited action references.
  for(const clip of Object.keys(baseline.animations))if(!p.animations[clip])errors.push('不能删除原生动作引用的动画：'+clip);
  if(errors.length)return {errors:[...new Set(errors)],warnings,files:[]};
  const ini='# Generated for '+metadata.repository+' @ '+metadata.commit+'\n'+Object.entries(sections).map(([name,fields])=>'\n['+name+']\n'+Object.entries(fields).map(([k,v])=>k+':'+v).join('\n')).join('\n')+'\n';
  files.push({name:folder+u.id+'.ini',data:ini});
  files.push({name:'RW-EXPORT-REPORT.txt',data:['来源：'+metadata.repository+' @ '+metadata.commit,'原生模板：'+native.path,'安装：把 GW_BattleUniverse_DLC_0079 合并到同版本原 MOD 目录，不要单独加载此 ZIP。','新单位可从沙盒搜索 '+u.id+' 测试；生产建筑和科技树未自动注册。','未经过铁锈战争引擎实机验收，请先在副本测试。',...warnings].join('\n')});
  return {errors,warnings,files};
 }
 return {prepare};
})();
if(typeof module!=='undefined')module.exports=RWUnitExport;
