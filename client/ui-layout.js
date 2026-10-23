/* Shared by developer and release builds. Only whitelisted properties become CSS. */
(()=>{
 'use strict';
 const targets=[
 ['header','顶栏','header'],['brand','标题标志','.brand'],['headerTitle','主标题','header h1'],['headerButtons','顶栏按钮组','.header-buttons'],
 ['roster','左侧机体面板','.left'],['center','地图与战报区','main.center'],['command','右侧指令面板','.right'],
 ['phase','回合提示栏','.phase-row'],['phaseTitle','行动阶段标题','#phaseTitle'],['endTurn','结束回合按钮','#endTurn'],['map','战术地图','#mapWrap'],['legend','地图图例','.legend'],['combatLog','战斗记录面板','.log'],['logLines','战报内容','#log'],
 ['rosterRow','机体列表项（全部）','.roster-unit'],['unitHead','单位信息标题','.unit-card-head'],['stats','单位属性区','.stats'],['actions','单位动作按钮组','.actions'],['weapon','武器按钮（全部）','.weapon'],['weaponName','武器名称（全部）','.weapon-name'],['weaponMeta','武器参数（全部）','.weapon-meta'],['target','攻击目标按钮（全部）','.target-button'],
 ['startModal','连接／开始窗口','#start>.modal'],['netForm','连接表单','.net-form'],['netButtons','连接按钮组','.net-buttons'],['startTitle','开始窗口标题','#startTitle'],
 ['reactionModal','应战窗口','#reaction>.modal'],['engagement','交战双方信息','#engagement'],['responses','应战选项组','.responses'],['response','应战选项（全部）','.response'],['counterList','反击武器列表','#counterList'],['confirmResponse','确认应战按钮','#confirmResponse'],
 ['battleModal','战斗演出窗口','#battle>.modal'],['battleStage','战斗画面','.battle-stage'],['battleCaption','战斗字幕','#battleCaption'],['battleInfo','战斗状态栏','#battleInfo'],['continueBattle','返回地图按钮','#continueBattle'],
 ['helpModal','说明窗口','#help>.modal'],['victoryModal','胜利窗口','#victory>.modal']
 ].map(([id,name,selector])=>({id,name,selector}));
 const fields={x:[-4096,4096],y:[-4096,4096],width:[40,4096],height:[20,4096],fontSize:[8,72],padding:[0,120],gap:[0,120],opacity:[.1,1]};
 const anchors=['flow','top-left','top-right','bottom-left','bottom-right','center'];
 const profiles=['desktop','tablet','mobile'];
 function validate(raw){
  if(!raw||raw.version!==1||!raw.profiles||typeof raw.profiles!=='object'||Array.isArray(raw.profiles))throw Error('需要 version:1 和 profiles 的布局JSON');
  const out={version:1,profiles:{desktop:{},tablet:{},mobile:{}}};
  for(const profile of profiles){const entries=raw.profiles[profile]||{};if(typeof entries!=='object'||Array.isArray(entries))throw Error('布局分组格式错误');
   for(const [id,props] of Object.entries(entries)){
    if(!targets.some(t=>t.id===id))throw Error('未知UI元素：'+id);
    if(!props||typeof props!=='object'||Array.isArray(props))throw Error('元素属性格式错误：'+id);
    const safe={};for(const [key,value]of Object.entries(props)){
     if(key==='anchor'){if(!anchors.includes(value))throw Error('锚点无效');safe[key]=value;}
     else if(key==='color'||key==='background'){if(typeof value!=='string'||!/^#[\da-f]{6}$/i.test(value))throw Error('颜色需为#RRGGBB');safe[key]=value;}
     else if(fields[key]){const [min,max]=fields[key];if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw Error(key+' 超出范围 '+min+'–'+max);safe[key]=value;}
     else throw Error('不支持的布局属性：'+key);
    }out.profiles[profile][id]=safe;
   }
  }return out;
 }
 const empty=()=>({version:1,profiles:{desktop:{},tablet:{},mobile:{}}});
 let layout;try{layout=validate(JSON.parse(document.getElementById('ui-layout-data').textContent));}catch(e){console.warn('布局未应用：',e.message);layout=empty();}
 const style=document.createElement('style');style.id='ui-layout-style';document.head.append(style);
 function css(props){
  let out=[];const a=props.anchor||'flow',x=props.x||0,y=props.y||0;
  if(a==='flow'){if('x'in props||'y'in props)out.push(`translate:${x}px ${y}px`);}
  else{out.push('position:fixed','margin:0','z-index:12','max-width:none','max-height:none','translate:none','right:auto','bottom:auto','left:auto','top:auto');
   if(a==='center')out.push('left:50%','top:50%',`translate:calc(-50% + ${x}px) calc(-50% + ${y}px)`);
   else{out.push(a.endsWith('right')?`right:${-x}px`:`left:${x}px`,a.startsWith('bottom')?`bottom:${-y}px`:`top:${y}px`);}
  }
  for(const key of ['width','height','fontSize','padding','gap'])if(key in props){out.push(`${key==='fontSize'?'font-size':key}:${props[key]}px`);if(key==='width')out.push('max-width:none','min-width:0');if(key==='height')out.push('min-height:0','max-height:none','overflow:auto');}
  for(const key of ['color','background','opacity'])if(key in props)out.push(`${key}:${props[key]}`);
  return out.map(s=>s+' !important').join(';');
 }
 function apply(raw){layout=validate(raw);style.textContent=profiles.map((p,i)=>{const query=['(min-width:1101px)','(min-width:601px) and (max-width:1100px)','(max-width:600px)'][i];return `@media ${query}{`+Object.entries(layout.profiles[p]).map(([id,props])=>`${targets.find(t=>t.id===id).selector}{${css(props)}}`).join('\n')+'}';}).join('\n');window.dispatchEvent(new Event('ui-layout-change'));}
 window.UILayout={targets,fields,anchors,empty,validate,apply,get:()=>structuredClone(layout),profile:()=>innerWidth>1100?'desktop':innerWidth>600?'tablet':'mobile'};
 apply(layout);
})();
