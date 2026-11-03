const UnitEditor=(()=>{
 const $=id=>document.getElementById(id),clone=UnitAuthoring.clone;
 let project,history=[],future=[],selected=0,playing=true,time=0,last=0,dirty=false,loadGeneration=0;
 const canvas=$('preview'),ctx=canvas.getContext('2d');
 const layer=()=>project.unit.layers[selected],weapon=()=>project.unit.weapons[$('weapon').value],animation=()=>project.animations[$('clip').value];
 function status(s){$('status').textContent=s;}
 function run(fn){try{Promise.resolve(fn()).catch(e=>status('操作失败：'+e.message));}catch(e){status('操作失败：'+e.message);}}
 function options(id,entries,value){const e=$(id);e.replaceChildren(...entries.map(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;return o;}));e.value=value??entries[0]?.[0]??'';}
 function checkpoint(){history.push(clone(project));if(history.length>30)history.shift();future=[];dirty=true;}
 function transaction(fn){const before=clone(project);try{fn();UnitAuthoring.validate(project,EXISTING_UNIT_IDS);}catch(e){project=before;throw e;}history.push(before);if(history.length>30)history.shift();future=[];dirty=true;sync();refresh();status('修改已应用，请保存工程');}
 function sync(){const {visual,model}=UnitAuthoring.projection(project,$('kit').value);SpriteRenderer.models.preview=visual;ART.models.preview=model;ART.assets=project.textures;}
 async function images(){const generation=++loadGeneration;const entries=await Promise.all(Object.entries(project.textures).map(async([key,src])=>{const im=new Image();im.src=src;await im.decode();return[key,im];}));if(generation!==loadGeneration)return;for(const [key,im]of entries)SpriteRenderer.images[key]=im;}
 function fields(id,specs,get){$(id).replaceChildren();for(const [key,title,def]of specs){const label=document.createElement('label');label.textContent=title;const input=document.createElement('input');input.type='number';input.step='0.25';input.value=get()[key]??def;input.onchange=()=>run(()=>transaction(()=>get()[key]=Number(input.value)));label.append(input);$(id).append(label);}}
 function refresh(){const u=project.unit,l=layer(),clip=$('clip').value,kit=$('kit').value,w=$('weapon').value;
 for(const k of ['id','name','code'])$(k).value=u[k]||'';
 options('kit',u.weaponKits.map(k=>[k.id,k.name]),u.weaponKits.some(k=>k.id===kit)?kit:u.weaponKits[0].id);
 const weapons=u.weaponKits.find(k=>k.id===$('kit').value).weapons;options('weapon',weapons.map(id=>[id,u.weapons[id].name||id]),weapons.includes(w)?w:weapons[0]);
 options('clip',Object.keys(project.animations).map(id=>[id,id]),project.animations[clip]?clip:u.presentation.idle);
 options('layer',u.layers.map((l,i)=>[String(i),l.name]),String(selected));options('bone',Object.keys(u.skeleton).map(k=>[k,k]),l.bone);
 options('texture',Object.keys(project.textures).map(k=>[k,k]),l.texture);$('layerName').value=l.name;$('hidden').checked=!!l.hidden;
 fields('layerFields',[['order','绘制顺序',0],['scale','总缩放',1],['scaleX','X 缩放 / 镜像',1],['scaleY','Y 缩放 / 镜像',1],['rotation','旋转 / 度',0],['height','高度',0],['frames','横向帧数',1],['frame','静态帧',0],['frameWidth','单帧宽 / px',32],['frameHeight','单帧高 / px',32],['frameFps','贴图帧率',1]],()=>layer());
 for(const [key,title]of [['x','贴图偏移 X'],['y','贴图偏移 Y']]){const label=document.createElement('label');label.textContent=title;const input=document.createElement('input');input.type='number';input.step='0.25';input.value=l.offset?.[key]||0;input.onchange=()=>run(()=>transaction(()=>{layer().offset={x:0,y:0,...layer().offset,[key]:Number(input.value)};}));label.append(input);$('layerFields').append(label);}
 fields('boneFields',[['x','骨骼 X',0],['y','骨骼 Y',0],['endDirOffset','方向偏移',0]],()=>project.unit.skeleton[layer().bone]);
 options('visibleKits',u.weaponKits.map(k=>[k.id,k.name]));for(const o of $('visibleKits').options)o.selected=Array.isArray(l.visibleWhen?.kit)?l.visibleWhen.kit.includes(o.value):l.visibleWhen?.kit===o.value;
 $('heldRule').value='keep';$('attackRule').value='keep';$('visibility').value=JSON.stringify(l.visibleWhen||{},null,2);$('visibilityWindow').value=JSON.stringify(l.animationVisibility||{},null,2);
 options('weaponClip',[['','无动画'],...Object.keys(project.animations).map(k=>[k,k])],weapon().clip||'');$('displayIndex').value=weapon().displayIndex??0;
 options('muzzleLayer',[['','保留原枪口'],...u.layers.map(l=>[l.name,l.name])],weapon().muzzle?.layer||'');$('muzzleX').value=weapon().muzzle?.point?.x||0;$('muzzleY').value=weapon().muzzle?.point?.y||0;
 $('duration').value=animation().duration;$('time').max=animation().duration;time=Math.min(time,animation().duration);keys();sync();
 }
 function keys(){const points=animation().curves[layer().bone]?.[$('curveField').value]||[];$('keys').replaceChildren();for(const [index,pt]of points.entries()){const row=document.createElement('div');row.className='row';const jump=document.createElement('button');jump.textContent=pt[0].toFixed(3)+' s → '+pt[1];jump.onclick=()=>{time=pt[0];playing=false;$('keyValue').value=pt[1];$('play').textContent='播放';};const del=document.createElement('button');del.textContent='删除';del.onclick=()=>run(()=>transaction(()=>{const curves=animation().curves[layer().bone];curves[$('curveField').value].splice(index,1);if(!curves[$('curveField').value].length)delete curves[$('curveField').value];}));row.append(jump,del);$('keys').append(row);}}
 async function load(p){UnitAuthoring.validate(p,EXISTING_UNIT_IDS);project=clone(p);selected=0;history=[];future=[];time=0;dirty=false;refresh();await images();status('工程已加载。绿色标记为所选骨骼；金色标记为当前武器枪口。');}
 options('template',UNIT_TEMPLATES.map((p,i)=>[String(i),p.unit.code+' · '+p.unit.name]));
 $('new').onclick=()=>run(async()=>{if(dirty&&!confirm('当前工程有未保存修改，仍要复制新模板吗？'))return;await load(UnitAuthoring.newProject(UNIT_TEMPLATES[Number($('template').value)]));dirty=true;});
 for(const id of ['id','name','code'])$(id).onchange=()=>run(()=>transaction(()=>{project.unit[id]=$(id).value.trim();if(id==='name')project.unit.localization={zh:{name:project.unit.name}};}));
 $('layer').onchange=()=>{selected=Number($('layer').value);refresh();};$('kit').onchange=refresh;$('weapon').onchange=refresh;
 $('bone').onchange=()=>run(()=>transaction(()=>layer().bone=$('bone').value));$('texture').onchange=()=>run(()=>transaction(()=>layer().texture=$('texture').value));
 $('layerName').onchange=()=>run(()=>transaction(()=>{const old=layer().name,next=$('layerName').value.trim();for(const w of Object.values(project.unit.weapons))for(const k of ['muzzle','chargeMuzzle'])if(w[k]?.layer===old)w[k].layer=next;layer().name=next;}));
 $('hidden').onchange=()=>run(()=>transaction(()=>layer().hidden=$('hidden').checked));
 $('duplicate').onclick=()=>run(()=>transaction(()=>{const l=clone(layer());let n=1;while(project.unit.layers.some(x=>x.name===l.name+'_copy'+n))n++;l.name+='_copy'+n;project.unit.layers.push(l);selected=project.unit.layers.length-1;}));
 $('remove').onclick=()=>run(()=>{if(project.unit.layers.length<2)throw Error('至少保留一个图层');const prev=selected;try{transaction(()=>{project.unit.layers.splice(selected,1);selected=Math.min(selected,project.unit.layers.length-1);});}catch(e){selected=prev;throw e;}});
 $('applyVisibility').onclick=()=>run(()=>transaction(()=>{const l=layer(),v=l.visibleWhen||{};const kits=[...$('visibleKits').selectedOptions].map(o=>o.value);if(kits.length)v.kit=kits;else delete v.kit;
 const h=$('heldRule').value;if(h==='any')delete v.heldWeapon;else if(h==='is')v.heldWeapon=$('weapon').value;else if(h==='not')v.heldWeapon={not:$('weapon').value};
 const a=$('attackRule').value;if(a==='any')delete v.attacking;else if(a!=='keep')v.attacking=a==='yes';l.visibleWhen=v;}));
 $('applyVisibilityJson').onclick=()=>run(()=>transaction(()=>{const v=JSON.parse($('visibility').value);if(!v||Array.isArray(v))throw Error('请输入 JSON 对象');layer().visibleWhen=v;}));
 $('applyWindow').onclick=()=>run(()=>transaction(()=>{const v=JSON.parse($('visibilityWindow').value);if(!v||Array.isArray(v)||typeof v!=='object')throw Error('请输入对象');if(Object.keys(v).length)layer().animationVisibility=v;else delete layer().animationVisibility;}));
 $('applyWeapon').onclick=()=>run(()=>transaction(()=>{const w=weapon();w.clip=$('weaponClip').value||null;const i=Number($('displayIndex').value);if(!Number.isInteger(i)||i<0)throw Error('显示索引必须是非负整数');w.displayIndex=i;if($('muzzleLayer').value)w.muzzle={layer:$('muzzleLayer').value,point:{x:Number($('muzzleX').value),y:Number($('muzzleY').value)}};}));
 $('clip').onchange=()=>{time=0;refresh();};$('curveField').onchange=keys;
 $('duration').onchange=()=>run(()=>transaction(()=>animation().duration=Number($('duration').value)));
 $('addKey').onclick=()=>run(()=>transaction(()=>{const a=animation(),bone=layer().bone,f=$('curveField').value,t=Number(time.toFixed(3)),v=Number($('keyValue').value);a.curves[bone]??={};a.curves[bone][f]??=[];const pts=a.curves[bone][f],old=pts.find(pt=>Math.abs(pt[0]-t)<.0005);if(old)old[1]=v;else pts.push([t,v]);pts.sort((a,b)=>a[0]-b[0]);}));
 $('copyClip').onclick=()=>run(()=>transaction(()=>{const name=$('newClip').value.trim();if(project.animations[name])throw Error('动画名称已存在');project.animations[name]=clone(animation());}));
 $('play').onclick=()=>{playing=!playing;$('play').textContent=playing?'暂停':'播放';};$('step').onclick=()=>{playing=false;$('play').textContent='播放';time=Math.min(time+1/30,animation().duration);};$('time').oninput=()=>{time=Number($('time').value);playing=false;$('play').textContent='播放';};
 for(const [id,from,to]of [['undo',()=>history,()=>future],['redo',()=>future,()=>history]])$(id).onclick=()=>run(async()=>{if(!from().length)return;to().push(clone(project));project=from().pop();selected=Math.min(selected,project.unit.layers.length-1);dirty=true;refresh();await images();});
 function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);status('已导出 '+name);}
 $('save').onclick=()=>run(()=>{UnitAuthoring.validate(project,EXISTING_UNIT_IDS);download(new Blob([JSON.stringify(project)],{type:'application/json'}),project.unit.id+'.pgunit.json');dirty=false;});
 $('export').onclick=()=>run(()=>{download(MapAuthoring.zip(UnitAuthoring.exportFiles(project,EXISTING_UNIT_IDS)),project.unit.id+'.zip');});
 $('exportRW').onclick=()=>run(()=>{const template=UNIT_TEMPLATES.find(t=>t.templateId===project.templateId);const result=RWUnitExport.prepare(project,template,RW_TEMPLATES);if(result.errors.length){status('RW 导出未完成，请处理以下不兼容修改：\n'+result.errors.map(x=>'• '+x).join('\n'));return;}download(MapAuthoring.zip(result.files),project.unit.id+'-RW_GW.zip');});
 let purpose='project';function pick(p){purpose=p;$('file').accept=p==='project'?'.json':'image/png,image/jpeg,image/webp';$('file').value='';$('file').click();}
 $('open').onclick=()=>pick('project');$('replaceTexture').onclick=()=>pick('replace');$('uniqueTexture').onclick=()=>pick('unique');$('setIcon').onclick=()=>run(()=>transaction(()=>project.unit.materials.icon=layer().texture));
 $('file').onchange=()=>run(async()=>{const file=$('file').files[0];if(!file)return;if(file.size>32*1024*1024)throw Error('文件超过32MB');if(purpose==='project'){const p=JSON.parse(await file.text());UnitAuthoring.validate(p,EXISTING_UNIT_IDS);if(dirty&&!confirm('替换未保存工程？'))return;await load(p);return;}
 if(!/^image\/(png|jpeg|webp)$/.test(file.type))throw Error('请选择 PNG/JPEG/WebP');const src=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('读取图片失败'));reader.readAsDataURL(file);});const im=new Image();im.src=src;await im.decode();if(im.width>4096||im.height>4096)throw Error('图片长宽上限4096像素');transaction(()=>{const key=purpose==='replace'?layer().texture:'custom_'+Date.now()+'.'+file.type.split('/')[1];project.textures[key]=src;layer().texture=key;});await images();});
 window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
 function draw(now){requestAnimationFrame(draw);if(!project)return;const dt=Math.min(.1,(now-last)/1000||0);last=now;if(playing)time=(time+dt)%animation().duration;
 const box=$('viewport').getBoundingClientRect(),dpr=devicePixelRatio||1; if(canvas.width!==Math.round(box.width*dpr)||canvas.height!==Math.round(box.height*dpr)){canvas.width=Math.round(box.width*dpr);canvas.height=Math.round(box.height*dpr);}
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,box.width,box.height);const cx=box.width/2,cy=box.height/2,z=Number($('zoom').value),angle=Number($('angle').value);
 if($('grid').checked){ctx.strokeStyle='#24313d';ctx.lineWidth=.5;const step=Math.max(z,4);ctx.beginPath();for(let x=cx%step;x<box.width;x+=step){ctx.moveTo(x,0);ctx.lineTo(x,box.height);}for(let y=cy%step;y<box.height;y+=step){ctx.moveTo(0,y);ctx.lineTo(box.width,y);}ctx.stroke();}
 ctx.strokeStyle='#496575';ctx.beginPath();ctx.moveTo(cx,0);ctx.lineTo(cx,box.height);ctx.moveTo(0,cy);ctx.lineTo(box.width,cy);ctx.stroke();
 try{SpriteRenderer.draw(ctx,'preview',cx,cy,z,angle,$('clip').value,time,$('weapon').value,false,$('shield').checked,$('moving').checked,{},angle,$('attacking').checked,true,$('environment').value);
 const pose=SpriteRenderer.pose('preview',$('clip').value,time,false);
 if($('bones').checked)for(const bone of Object.keys(project.unit.skeleton)){const t=SpriteRenderer.layerTransform('preview',{bone},angle,pose);ctx.fillStyle=bone===layer().bone?'#77ffd0':'#ffffff88';ctx.fillRect(cx+t.x*z-2,cy+t.y*z-2,4,4);if(bone===layer().bone){ctx.fillStyle='#77ffd0';ctx.fillText(bone,cx+t.x*z+6,cy+t.y*z-5);}}
 if(weapon().muzzle?.layer){const w={...weapon(),attack:weapon().attack||{}};const m=SpriteRenderer.muzzle('preview',w,{x:cx,y:cy,angle,scale:z},$('clip').value,time);ctx.strokeStyle='#ffd273';ctx.beginPath();ctx.arc(m.x,m.y,5,0,Math.PI*2);ctx.stroke();}
 const visible=SpriteRenderer.visibleLayers('preview',$('weapon').value,$('shield').checked,$('moving').checked,$('clip').value,time,false,{},$('attacking').checked,true,$('environment').value);$('visibleStatus').textContent=visible.some(l=>l.name===layer().name)?'当前图层：可见':'当前图层：隐藏（条件未满足）';
 }catch(e){status('预览失败：'+e.message);playing=false;}
 $('time').value=time;$('clock').textContent=time.toFixed(3)+' / '+animation().duration.toFixed(3)+' s';
 }
 run(()=>load(UnitAuthoring.newProject(UNIT_TEMPLATES[0])));requestAnimationFrame(draw);
 return {get project(){return project},load,exportFiles:()=>UnitAuthoring.exportFiles(project,EXISTING_UNIT_IDS)};
})();
