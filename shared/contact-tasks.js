/* Persistent liaison commissions; separate from scripted battle missions. */
const ContactTasks = (() => {
  const zeon = typeof ZeonContact !== "undefined" ? ZeonContact : require("./contact-zeon.js");
  const anaheim = typeof AnaheimContact !== "undefined" ? AnaheimContact : require("./contact-anaheim.js");
  const ce = typeof CEContacts !== "undefined" ? CEContacts : require("./contact-ce.js");
  const planningVersion = "1.4";
  const tasks = [...(typeof EFSF_CONTACT_DATA !== "undefined" ? EFSF_CONTACT_DATA : require("./contact-efsf.json"))];
  tasks.push(...zeon.tasks);
  tasks.push(...anaheim.tasks);
  tasks.push(...ce.tasks);
  const byId = new Map(tasks.map(t=>[t.id,t]));
  const technologyTree = typeof DEVELOPMENT_TREE !== "undefined" ? DEVELOPMENT_TREE : require("./development-tree.json");
  const plans = new Map(Object.values(technologyTree).flat().map(node=>[node.id,node]));
  const mainTasks = new Set();
  const planIds = task => [...new Set([task?.licensePlan,...(task?.licensePlans || []),...(task?.extraLicensePlans || [])].filter(Boolean))];
  const pending = tasks.filter(task=>{
    return planIds(task).some(id=>plans.get(id)?.row==="mid" && !plans.get(id).placeholder);
  }).map(task=>task.id);
  while(pending.length) {
    const id=pending.pop();
    if(mainTasks.has(id) || !byId.has(id)) continue;
    mainTasks.add(id);
    pending.push(...(byId.get(id).requires || []));
  }
  const isSideTask = task => !!task && !mainTasks.has(task.id);
  const intro = [
    ["联邦联络人","＊有些不是很健康的电影的声音＊"],["玩家","咳咳。"],["联邦联络人","操！"],
    ["联邦联络人","＊似乎有什么东西摔在了地上＊"],["联邦联络人","该死，没想到已经到了联络时间。"],
    ["联邦联络人","呃......你是【玩家公司名】的人是吧？"],["联邦联络人","我是你们以后的专属联络人。"],
    ["联邦联络人","你们这些野狗以后就由我负责了。"],["玩家","......"],["联邦联络人","怎么，觉得不够正式？"],
    ["联邦联络人","得了吧，联邦能容忍你们这帮家伙存在已经很了不得了。"],
    ["联邦联络人","闻到死人的血味就出来觅食的秃鹫还指望好脸色吗？"],
    ["联邦联络人","但话说回来，我也不是什么好人，好汉子现在还在前线作战呢！"],
    ["联邦联络人","我比较......自爱一点。"],["玩家","......"],["联邦联络人","笑一下好不好，冷血杀手。"],
    ["联邦联络人","不爱笑算了。"],["联邦联络人","佣兵头子，我听说你们公司现在缺一些装备？"],
    ["联邦联络人","巧合的是我刚刚好有个渠道可以整一点装备......"],
    ["联邦联络人","不要问是从哪里来的......朋友，我们都有一些秘密。"],
    ["联邦联络人","这次通信就到这里吧，希望...我们可以合作愉快......"],
  ];
  const contactId = task => task?.contactId || "efsf";
  function met(value, id="efsf") {
    return typeof value === "boolean" ? id === "efsf" && value :
      id === "efsf" ? value?.contactIntro === true : value?.merchantIntros?.[id] === true;
  }
  const introFor = id => ce.contacts[id]?.intro || (id === "zeon" ? zeon.intro : id === "efsf" ? intro : id === "anaheim" ? anaheim.intro : []);
  const introPlan = id => ce.contacts[id]?.introPlan || (id === "zeon" ? zeon.introPlan : id === "efsf" ? "Tech_EFSF_0079_BaseTech" : null);
  const introPlans = id => [ce.contacts[id]?.basePlan, introPlan(id)].filter(Boolean);
  const available = (state,id) => id === "anaheim" ? !!state?.merchantIntros?.anaheim ||
    (state?.contactTasks || []).some(e=>["efsf-15","zeon-11"].includes(e.id) && e.status === "claimed") : !ce.contacts[id] || ce.available(state);
  const contactName = id => ce.contacts[id]?.name || (id === "zeon" ? "吉翁联络人" : id === "efsf" ? "联邦联络人" : "阿纳海姆");
  function normalize(value) {
    if (!Array.isArray(value)) return [];
    return tasks.flatMap(task=>{
      const saved=value.find(e=>e?.id===task.id && ["accepted","ready","claimed"].includes(e.status));
      // A completed former 60-target event remains deliverable after becoming cumulative.
      const entry=task.id === "efsf-20" && saved?.status === "ready" && saved.progressVersion !== task.progressVersion
        ? {...saved,progress:task.required,progressVersion:task.progressVersion} : saved;
      const reset = task.progressVersion && entry && entry.status !== "claimed" && entry.progressVersion !== task.progressVersion;
      return entry?[{id:task.id,status:reset?"accepted":entry.status,progress:entry.status==="claimed"?task.required:reset?0:Math.max(0,Math.min(task.required,Math.floor(Number(entry.progress)||0))),
        ...(task.progressVersion ? {progressVersion:task.progressVersion} : {}),
        ...(task.moneyPerKill ? {rewardKills:Math.min(768,Math.max(0,Math.floor(Number(entry.rewardKills)||0)))} : {}),
        ...(task.reclaim && entry.loanTracking===true ? {loanTracking:true} : {}),
        ...(task.reclaim && entry.loanReturned===true ? {loanReturned:true} : {})}]:[];
    });
  }
  const active = value => normalize(value).filter(e=>e.status==="accepted").map(e=>e.id);
  function eligible(task, settings) {
    if (task?.missionId) return settings.mode === "mission" && settings.mapId === task.missionId;
    return task && settings.mode==="sweep" && (task.anyEnemyFaction || settings.sweepFaction===(task.enemyFaction || "ZEON")) &&
      (!task.era || settings.sweepEra===task.era || task.era==="UC_0079_T1"&&settings.sweepEra==="UC_0079_T2") && (!task.environment || settings.sweepEnvironment===task.environment) &&
      Number(settings.sweepDifficulty)>=task.difficulty && (!task.ground || settings.sweepEnvironment==="ground");
  }
  function unlocked(task, entries, intro) {
    return !!task && !unmetRequirements(task,entries,intro).length;
  }
  function unmetRequirements(task, entries, intro) {
    if(!task) return [];
    const claimed=new Set(normalize(entries).filter(entry=>entry.status==="claimed").map(entry=>entry.id));
    return [
      ...(!met(intro,contactId(task))?[{type:"intro"}]:[]),
      ...(!available({...intro,contactTasks:entries},contactId(task))?[{type:"task",name:contactId(task)==="anaheim"?"特别联络或不可退让":"小菜一碟或不可退让"}]:[]),
      ...(task.requires || []).filter(id=>!claimed.has(id)).map(id=>({type:"task",id,name:byId.get(id)?.name || id})),
    ];
  }
  function specialTasks(room) {
    const ids=new Set(room.seats.filter(p=>p&&!p.bot&&p.seat%2===0).flatMap(p=>active(p.contactTasks)));
    return tasks.filter(t=>!["kills","all_events"].includes(t.kind) && ids.has(t.id) && eligible(t,room.settings));
  }
  return {planningVersion,tasks,byId,intro,introFor,introPlan,introPlans,available,contactId,contactName,met,planIds,normalize,active,eligible,unlocked,unmetRequirements,isSideTask,specialTasks};
})();
if(typeof module!=="undefined")module.exports=ContactTasks;
