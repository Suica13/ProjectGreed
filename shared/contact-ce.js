/* CE0071T1 liaison chains. Licenses are awarded only after the dialogue/hand-in. */
"use strict";
const CEContacts = (() => {
  const gateTasks = ["efsf-11", "zeon-11"];
  const available = state => gateTasks.some(id => state?.contactTasks?.some(e => e.id === id && e.status === "claimed"));
  const contacts = {
    omni: {
      name: "地球联合军联络人",
      introPlan: "Tech_OMNI_CE71_MilitaryReconstructionPlan",
      basePlan: "Tech_OMNI_CE71_BaseTech",
      intro: [
        ["地球联合军联络人", "听说你们在另一条战线上干得不错。这里是地球联合军对外事务处，以后的委托由我签字。"],
        ["玩家", "先说报酬，再说任务。"],
        ["地球联合军联络人", "很好，我喜欢明白人。扎夫特和那些调整人把地球当成了试验场，我要他们为每一寸占领区付出代价。"],
        ["玩家", "我们接军事目标，别把平民名单塞进合同。"],
        ["地球联合军联络人", "哼，合同会写清楚。眼前先把我们的地面军队重新组织起来。"],
        ["地球联合军联络人", "军队重建计划和基础装备许可已经转交。线性炮坦克、飞机、长刃，你可以自己挑。"],
        ["玩家", "奥布也在你的作战地图上？"],
        ["地球联合军联络人", "他们占着质量加速器，庇护调整人，却坚持说自己中立。联合不会永远有耐心。"],
        ["地球联合军联络人", "先完成N2地面合同。等你证明价值，我再让你接触真正的MS计划。"],
      ],
    },
    zaft: {
      name: "扎夫特联络人",
      introPlan: "Tech_ZAFT_CE71_HeavyarmsGINNDevelopmentPlan",
      basePlan: "Tech_ZAFT_CE71_BaseTech",
      intro: [
        ["扎夫特联络人", "你就是那家佣兵公司的负责人？履历勉强值得一看，别把这当作赞赏。"],
        ["玩家", "你可以直接谈合同。"],
        ["扎夫特联络人", "自然人的军队只会用数量填补能力的差距。我们需要的是执行力，不是他们那种低劣的喧嚣。"],
        ["玩家", "如果你想按出身给我的驾驶员排座次，这次通信可以结束了。"],
        ["扎夫特联络人", "至少你敢回答。拿到战果，再来讨论你的立场。"],
        ["扎夫特联络人", "基础装备和重装规格金恩开发计划已经授权。以金恩、迪恩和支援部队组织你的队伍。"],
        ["玩家", "那奥布呢？"],
        ["扎夫特联络人", "他们本该放弃那些自然人市民，站到调整人的未来这边，却执意维持那场平等的幻梦。"],
        ["玩家", "我的合同只对武装目标有效。把这一条也记进去。"],
        ["扎夫特联络人", "先在N2地面战场证明你能活着回来。其余计划要靠成果换取。"],
      ],
    },
  };
  const definitions = {
    omni: [
      {name:"重建的第一步", difficulty:2, kind:"salvage", guardCount:5, wreckUnit:"VTOLTransport",
        eventName:"回收联合军前线补给记录", plan:"MSDevelopmentPlan",
        description:"扎夫特截断了重建部队的补给线。运输机残骸里有分发记录，抢在他们销毁之前带回来。\n守军有金恩和空中掩护，别指望只开一辆卡车就能混过去。\n记录完整带回，我就把MS开发计划交给你。",
        ending:"记录还在，补给点可以重新启用。\n那些调整人以为炸掉几架运输机就能让我们停下来？现在轮到他们担心我们的MS了。"},
      {name:"量产的答案", difficulty:3, kind:"command", guardCount:3, targets:["ZGMF_1017","ZGMF_1017","ZGMF_515","AMF_101"],
        eventName:"击破扎夫特机动封锁队", plan:"MassProductionMSDevelopmentPlan",
        description:"我们不能永远依靠少数试验机守住战线。量产MS计划需要一条安全的运输走廊。\n扎夫特的封锁队占住了通道，金恩、希古和迪恩互相掩护。把他们全部清掉。\n你打通道路，强袭短剑和新型高达的资料就归你。",
        ending:"道路通了，量产计划也会继续。\n自然人未必需要和调整人比天赋，只要生产线上出来的每一台MS都能把他们赶回宇宙。"},
      {name:"夺回制空权", difficulty:4, kind:"radar", guardCount:6, turrets:2, eventName:"摧毁扎夫特空域引导站", plan:"SkyGrasperDevelopmentPlan",
        description:"扎夫特用雷达站给迪恩机群指示目标，后方的车队连白天都不敢移动。\n摧毁引导站，撑过守卫增援，再从地面撤离。\n空中霸王开发资料可以补上你的空中支援，我不想再听见空域丢失的报告。",
        ending:"空域终于能用了。空中霸王的许可给你。\n奥布那些工厂也很擅长制造飞机……总有一天，我们会认真谈谈他们的产能该为谁服务。"},
      {name:"装甲之下", difficulty:5, kind:"factory", guardCount:7, targetCount:3, turrets:2, eventName:"破坏扎夫特前线整备群", plan:"DuelDaggerDevelopmentPlan",
        description:"巴库和高机动金恩开始成批出现在前线，补给和整备比它们的驾驶员更值得下手。\n摧毁三座整备设施，注意工厂受击和被毁都会引来增援。\n决斗短剑计划已经备好，活着回来签收。",
        ending:"他们的整备线停了，我们的不会停。\n决斗短剑开发计划交给你。第一阶段的技术资料已经齐全，接下来用战果证明这笔投资值得。"},
    ],
    zaft: [
      {name:"空中的资格", difficulty:2, kind:"radar", guardCount:5, eventName:"摧毁联合军航空警戒站", plan:"DINNDevelopmentPlan",
        description:"联合军的常规航空队依靠地面警戒站勉强维持空域。别让那些自然人把这种配合当成优势。\n摧毁警戒站，并处理赶来支援的部队。\n完成后你可以取得迪恩开发计划，包括空中预警与格乌支援装备。",
        ending:"警戒站失联，空中部队已经开始推进。\n迪恩计划归你。你至少证明了自己比那些只会叫嚷的自然人军官更懂得执行命令。"},
      {name:"地面的尺度", difficulty:3, kind:"command", guardCount:3, targets:["GAT_01D","GAT_01D","LinearGunTank","LinearArtillery"],
        eventName:"击破联合军地面混成队", plan:"GroundTypeMSDevelopmentPlan",
        description:"长刃配合坦克和火炮，正在试探我们的地面防线。性能平庸的兵器，只要数量足够也会变成麻烦。\n歼灭这支混成队，别漏掉后方的火炮。\n地面战用MS开发计划会作为报酬，巴库和高机动金恩能让你的部队跟上我们的节奏。",
        ending:"混成队已经从战术图上消失。\n地面战用MS的许可已签发。记住，速度和判断比堆砌钢铁更有价值。"},
      {name:"夺取的代价", difficulty:4, kind:"salvage", guardCount:7, wreckUnit:"GAT_X102", eventName:"回收G系列作战数据", plan:"GundamSeizurePlan",
        description:"联合军正在转移G系列的作战记录。他们的量产短剑会掩护回收区，你不能只盯着残骸。\n取得数据后会有追击部队，组织好撤离顺序。\n高达夺取计划不是给无能者准备的，别让我后悔把这件事交给佣兵。",
        ending:"数据完整，技术部门可以继续推进。\n他们把少数新机当作救命稻草，我们会把这些设计用得更好。高达夺取计划已经授权。"},
      {name:"海岸的选择", difficulty:5, kind:"upload", guardCount:7, turrets:2, eventName:"上传联合军海岸部署资料", plan:"AquaMSDevelopmentPlan",
        description:"联合军把海岸仓库和新型MS部队连成了防线。潜入资料终端覆盖区，保持上传三回合。\n守军会试图打断传输，别让通讯员成为他们的靶子。\n奥布以为接纳自然人就能置身事外？海岸部署资料会让他们明白，中立并不等于没有代价。",
        ending:"海岸部署已经查明。水中MS开发计划交给你。\n至于奥布，他们迟早要作出选择。我认为他们早就该放弃那种保护自然人的执念。"},
      {name:"傲慢的试金石", difficulty:6, kind:"command", guardCount:5, targets:["GAT_X105","GAT_X103","GAT_01D1_AS","GAT_01","GAT_01","GAT_01"],
        eventName:"歼灭联合军强化MS试验队", plan:"DuelGundamEnhancementPlan",
        description:"联合军把高达与量产MS组成了试验队，打算证明自然人也能压过我们的主力。\n摧毁整支试验队，再带着你的部队回来。不要把撤离计划留到最后一分钟。\n决斗高达强化计划和盖茨许可会交给完成任务的人。",
        ending:"试验队全灭。你的战果已经足够，不必再重复证明。\n决斗高达强化与盖茨的许可已签发，第一阶段的科技资料全部开放。至少在战场上，你赢得了我的认可。"},
    ],
  };
  const tasks = Object.entries(definitions).flatMap(([contactId, chain]) => chain.map((entry,index) => {
    const {plan, targets, ...data} = entry, faction = contactId === "omni" ? "OMNI" : "ZAFT";
    return {...data, id:contactId+"-"+(index+1), number:index+1, contactId,
      era:"CE_0071_T1", ground:true, enemyFaction:faction === "OMNI" ? "ZAFT" : "OMNI",
      required:1, money:7500+entry.difficulty*4000, inventory:{}, affinity:100,
      requires:index ? [contactId+"-"+index] : [], licensePlan:"Tech_"+faction+"_CE71_"+plan,
      ...(targets ? {targetUnit:targets[0], targetUnits:targets.map(unitId=>({unitId}))} : {}),
      objective:"CE0071T1 · 地面 · N"+entry.difficulty+"以上 · "+entry.eventName+"，成功撤离后交付。"};
  }));
  return {contacts, tasks, available, gateTasks};
})();
if (typeof module !== "undefined") module.exports = CEContacts;
