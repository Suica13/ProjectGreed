/* Pure authoring model: preserve source values, never export compiled balance values. */
const UnitAuthoring=(()=>{
 const clone=x=>JSON.parse(JSON.stringify(x));
 const safe=s=>typeof s==='string'&&/^[A-Za-z0-9_-]+$/.test(s)&&!['__proto__','prototype','constructor'].includes(s);
 function validate(p,existing=[]) {
  if(p?.format!=='pg-unit-project'||p.version!==1||!p.unit||!p.textures||!p.animations)throw Error('不是有效单位工程');
  const u=p.unit;
  if(!safe(u.id)||existing.includes(u.id))throw Error('新单位 ID 需使用字母、数字、下划线，且不能覆盖已有单位');
  if(typeof u.name!=='string'||!u.name.trim())throw Error('名称不能为空');
  if(!u.skeleton||!Array.isArray(u.layers)||!u.layers.length||!Array.isArray(u.weaponKits)||!u.weaponKits.length)throw Error('缺少骨骼、图层或武器套件');
  const names=new Set();
  for(const [key,b]of Object.entries(u.skeleton)) {
   if(!b||!Number.isFinite(b.x)||!Number.isFinite(b.y))throw Error('骨骼坐标无效：'+key);
   for(const v of Object.values(b))if(typeof v==='number'&&!Number.isFinite(v))throw Error('骨骼参数无效');
  }
  for(const [key,src]of Object.entries(p.textures))if(!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(src))throw Error('贴图必须是已嵌入图片：'+key);
  if(!p.textures[u.materials.icon])throw Error('缺少图标贴图');
  for(const l of u.layers){
   if(!l.name||names.has(l.name))throw Error('图层名称重复');names.add(l.name);
   if(!p.textures[l.texture]||!u.skeleton[l.bone])throw Error('图层缺少贴图或骨骼：'+l.name);
   for(const k of ['order','scale','scaleX','scaleY','rotation','height','alpha','frames','frame','frameWidth','frameHeight','frameFps'])if(l[k]!==undefined&&!Number.isFinite(l[k]))throw Error('图层数值无效：'+k);
   for(const k of ['frames','frameWidth','frameHeight'])if(l[k]!==undefined&&(!Number.isInteger(l[k])||l[k]<1))throw Error('帧尺寸必须是正整数');
   if(l.frameFps!==undefined&&(l.frameFps<=0||!Number.isInteger(l.frames)||l.frames<1))throw Error('设置贴图帧率时需填写有效帧数');
   if(l.frame!==undefined&&(!Number.isInteger(l.frame)||l.frame<0||l.frame>=(l.frames||1)))throw Error('静态帧超出帧数');
   if(l.offset&&(!Number.isFinite(l.offset.x)||!Number.isFinite(l.offset.y)))throw Error('图层偏移无效');
   if(l.visibleWhen&&typeof l.visibleWhen!=='object')throw Error('显隐规则必须是对象');
   for(const [key,v]of Object.entries(l.visibleWhen||{})){
    const allowed=['kit','heldWeapon','weaponDisplayIndex','attacking','heldAttacking','moving','shieldVisible','visorClosed','onLand','boosting','sustainedThrust','thrustActive','boostSkillActive'];
    if(!allowed.includes(key))throw Error('不支持的显隐变量：'+key);
    const values=Array.isArray(v)?v:v&&typeof v==='object'?(Array.isArray(v.not)?v.not:[v.not]):[v];
    if(values.some(x=>!['string','number','boolean'].includes(typeof x)))throw Error('显隐条件只能使用值、数组或 not');
    if(key==='heldWeapon'&&values.some(x=>!u.weapons[x]))throw Error('显隐规则引用未知武器');
    if(key==='kit'&&values.some(x=>!u.weaponKits.some(k=>k.id===x)))throw Error('显隐规则引用未知套件');
   }
   if(l.animationVisibility){const v=l.animationVisibility;if(!p.animations[v.clip]||!Number.isFinite(v.start)||!Number.isFinite(v.end)||v.start<0||v.end<=v.start||typeof v.visibleInside!=='boolean')throw Error('动画显隐区间无效');}
  }
  for(const [clip,a]of Object.entries(p.animations)){
   if(!safe(clip)||!Number.isFinite(a.duration)||a.duration<=0||!a.curves)throw Error('动画无效：'+clip);
   for(const [bone,fields]of Object.entries(a.curves)){
    if(!u.skeleton[bone])throw Error('动画引用未知骨骼：'+bone);
    for(const [field,points]of Object.entries(fields)){
     if(!['x','y','dir','height'].includes(field)||!Array.isArray(points)||!points.length)throw Error('无效动画曲线');
     let prev=-1;for(const pt of points){if(!Array.isArray(pt)||pt.length!==2||!pt.every(Number.isFinite)||pt[0]<0||pt[0]>a.duration||pt[0]<prev)throw Error('关键帧需按时间排序并在时长内');prev=pt[0];}
    }
   }
  }
  for(const [id,w]of Object.entries(u.weapons)){
   if(w.ref)throw Error('武器需先展开共用引用');
   if(w.clip&&!p.animations[w.clip])throw Error('武器动画不存在：'+id);
   if(w.displayIndex!==undefined&&(!Number.isInteger(w.displayIndex)||w.displayIndex<0))throw Error('武器显示索引无效');
   if(w.muzzle?.point&&!Object.values(w.muzzle.point).every(Number.isFinite))throw Error('枪口坐标无效');
   if(w.muzzle?.layer&&!names.has(w.muzzle.layer))throw Error('枪口引用无效图层：'+id);
  }
  for(const k of u.weaponKits)if(!k.weapons.every(id=>u.weapons[id]))throw Error('套件引用不存在的武器');
  return p;
 }
 function newProject(template){const p=clone(template);p.unit.id=template.unit.id+'_Custom';p.unit.name=template.unit.name+' 自制';p.unit.code=p.unit.id;p.unit.localization={zh:{name:p.unit.name}};p.unit.refits=[];p.unit.production={enabled:true,refitFrom:[]};return p;}
 function projection(p,kitId){
  const u=p.unit,k=u.weaponKits.find(k=>k.id===kitId)||u.weaponKits[0];
  const visual={id:'preview',kit:k.id,bones:u.skeleton,decals:u.layers.map(l=>({...l,asset:l.texture})).sort((a,b)=>(a.order||0)-(b.order||0)),animations:p.animations,presentation:u.presentation};
  const model={...u.stats,presentation:u.presentation,movementType:u.movementType,weapons:k.weapons.map(id=>({id,...u.weapons[id]}))};
  return {visual,model};
 }
 function exportFiles(p,existing=[]){
  validate(p,existing);const u=clone(p.unit),base='assets/units/'+u.id+'/',files=[];
  u.materials.textures={};
  for(const [i,[key,src]]of Object.entries(p.textures).entries()){
   const [,ext,body]=/^data:image\/(\w+);base64,(.+)$/.exec(src),file='textures/image-'+i+'.'+ext;
   u.materials.textures[key]=file;files.push({name:base+file,data:Uint8Array.from(atob(body),c=>c.charCodeAt(0))});
  }
  u.animations={};for(const [clip,a]of Object.entries(p.animations)){u.animations[clip]='animations/'+clip+'.json';files.push({name:base+u.animations[clip],data:JSON.stringify(a,null,2)});}
  files.push({name:base+'unit.json',data:JSON.stringify(u,null,2)});
  files.push({name:'README.txt',data:'将 assets/units/'+u.id+' 文件夹放入同版本 ProjectGreed 仓库，运行 npm run units:reload 完整校验并注册。不要覆盖已有单位。单位保留模板的数值、武器与共用音效/特效引用，需要原项目，不是独立 MOD。'});
  return files;
 }
 return {clone,validate,newProject,projection,exportFiles};
})();
if(typeof module!=='undefined')module.exports=UnitAuthoring;
