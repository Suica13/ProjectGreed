/* Persistent liaison commissions; separate from scripted battle missions. */
const ContactTasks = (() => {
  const planningVersion = "1.21";
  const tasks = [
    {
      "id": "efsf-1",
      "number": 1,
      "name": "首秀",
      "difficulty": 1,
      "kind": "kills",
      "required": 6,
      "description": "你好啊，佣兵头子。\n这个活对正规部队来说太小菜一碟了，但是挺适合你们这些新来的。\n嘿，别在那不爽，你至少得混个熟脸，我才能安排正经的差事给你！\n\n现在到处都是那些吉翁的杂碎，简直把这里当自己家了！\n有队吉翁的混蛋在一个很麻烦的地方安了家，把他们宰了再回来。",
      "objective": "合约模式 · N1以上 · 敌人吉翁军：歼灭6架吉翁军MS。",
      "money": 3000,
      "inventory": {
        "RGM_79_E": 3
      },
      "ending": "那么，这就干完啦？\n虽然我并不觉得意外，但还是得确认一下才保险！",
      "requires": [],
      "affinity": 100
    },
    {
      "id": "efsf-2",
      "number": 2,
      "name": "搜索任务",
      "difficulty": 1,
      "kind": "salvage",
      "ground": true,
      "required": 1,
      "description": "嘿，佣兵头子！\n长话短说，有架运输机失去联系已经有一段时间了。\n上面派他们去前线附近转移一件挺重要的货物。\n恐怕他们是遇到了什么埋伏，我和他们最后一次通话的时候，他们报告说有一伙吉翁巡逻队从附近的山丘方向接近了他们。\n\n去前线调查一下，看看现场有没有幸存者。\n从最后通报的情况来看，吉翁肯定在附近安顿了下来，说不定是搭了个营地，所以小心些。\n找到我们的运输机，取回里面的数据。现在解散！",
      "objective": "合约模式 · 地面 · N1以上 · 敌人吉翁军：取回坠落米迪亚残骸中的数据后撤离。",
      "eventName": "坠落米迪亚的数据",
      "money": 5000,
      "inventory": {
        "Medea": 1,
        "ColumbusClass": 1
      },
      "ending": "噢...你们活着回来了。\n把数据传过来吧，我这边有些装备不好处理。\n便宜卖给你们吧。",
      "requires": [
        "efsf-1"
      ],
      "affinity": 100
    },
    {
      "id": "efsf-3",
      "number": 3,
      "name": "罪证",
      "difficulty": 1,
      "kind": "command",
      "ground": true,
      "required": 1,
      "description": "别来无恙，我亲爱的朋友，来借一步说话。\n如果你有兴趣的话，我这有个活儿给你整。\n你得想办法帮我们找个东西，这会儿我已经没招了——\n长话短说，有个在他妈的前线的军官搞到了一批非常重要的文件。\n你也知道，外头有多少人为了能搞到联邦高层和帮凶的罪证在疯狂火拼。\n之后的展开你也猜到了，但是那些试图把东西搞到手的人又蠢又猴急，那军官还没来得及开口就被他们弄死了。\n你能想象吗？太不专业太没水平了！跟这些智障真是没法做生意……\n\n好了，让我们回到正题吧。\n虽然我们不知道为什么一个在前线的军官为什么能搞到这东西，但我要你把那玩意带回来。\n这玩意多半在那军官的部下那里，我要你以吉翁人的身份入场，把他们干掉，把东西拿回来。\n\n别这么看我，这只是生意。",
      "objective": "合约模式 · 地面 · N1以上 · 敌人吉翁军：击败记名联邦MS小队。",
      "eventName": "记名联邦MS小队",
      "money": 6000,
      "inventory": {
        "RGM_79_G": 1,
        "RGM_79_E": 2
      },
      "ending": "你们成功了对吧？\n太好了，我现在让我的人去你们营地取文件。\n对了，这几台MS原本是那个小队的补给。\n现在他们肯定用不上了......放心，不会有问题的。\n他们会在纸面上活得好好的。",
      "requires": [
        "efsf-2"
      ],
      "affinity": 100
    },
    {
      "id": "efsf-4",
      "number": 4,
      "name": "硝烟野餐",
      "difficulty": 2,
      "kind": "command",
      "ground": true,
      "required": 1,
      "description": "活得还滋润吧，佣兵头子？好小子！\n说明你脑子里还算有点货，不会把自己给蠢死。\n那我就再交待个差事给你吧。\n\n几个挺有身份的大人物在你们附件的某些地方有点事情要处理。\n但问题是，吉翁的人渣总是跳出来碍事——那帮家伙可能是缺根筋，真当这儿是他们自个的地盘了，你能想象这种事情吗？\n\n根据我的消息，这些白痴也就十来个MS，但说不好会不会更多。\n我需要你帮我们办挺那群混蛋。\n对于你们这些专业人士来说，肯定不费功夫就能办完了。",
      "objective": "合约模式 · 地面 · N2以上 · 敌人吉翁军：击毁指定区域的12台吉翁MS。",
      "eventName": "硝烟野餐：吉翁驻军",
      "money": 7500,
      "inventory": {
        "RGM_79_G": 2
      },
      "ending": "办得怎么样了？\n啊，别说了，我早就知道结果不错。\n你不是好端端的站在这嘛，身上也没少零件，对吧？\n那些大佬也传话过来，说他们那边也很顺利。\n给，这是你的报酬，有我的小小心意，还有大人物们的酬谢。",
      "requires": [
        "efsf-3"
      ],
      "affinity": 100
    },
    {
      "id": "efsf-5",
      "number": 5,
      "name": "武力说服",
      "difficulty": 2,
      "kind": "factory",
      "ground": true,
      "required": 4,
      "description": "你好，佣兵头子！\n有个挺特别的任务要交给你。\n我需要对一款MS来上一场真正的实战测试，必须是最真实的交战情况，不能靠猎杀那些杂鱼充数。\n我想你大概知道上哪儿去测试了，对吧？\n\n有些大人物不相信这玩意儿的效果……你能让他们改变想法吗？\n\n哦对了，还有一点：如果你不小心把MS弄坏了，我可以给你搞来一架新的，但这可不是免费的。",
      "objective": "合约模式 · 地面 · N2以上 · 敌人吉翁军：使用苍白骑士摧毁工厂。",
      "eventName": "苍白骑士实战测试",
      "money": 7500,
      "inventory": {
        "RX_79_G": 1
      },
      "grant": {
        "RX_80PR": 1
      },
      "licensePlan": "Tech_EFSF_0079_EarlyTypeMSDevelopmentPlan",
      "ending": "你居然没死在外面？\n另一个负责实验这MS的部队把自己基地都玩没了。\n好啦好啦，我会把他们的装备弄到你这里的。\n当然，不是免费的。",
      "requires": [
        "efsf-4"
      ],
      "affinity": 100,
      "reclaim": {
        "RX_80PR": 1
      }
    },
    {
      "id": "efsf-6",
      "number": 6,
      "name": "绿色通道",
      "difficulty": 3,
      "kind": "salvage",
      "ground": true,
      "required": 1,
      "description": "这些杀千刀的吉翁佬！\n他们就是想要屠杀一切！\n我们明明谈判过了，还付了钱让他们放我们通行！\n但是，他们还是想吸掉我们的血！\n总之，佣兵头子，过来听好了。\n战区里会有一支车队经过，他们护送着非常重要的货物。\n非 常 重 要。就连我都不知道具体是什么。\n吉翁佬收钱之后给车队开了安全通道，然后车队就不见了，太混蛋了！\n去看看到底发生了什么，找一找有没有什么还在的东西。\n然后调查清楚，袭击是从那边来的...",
      "objective": "合约模式 · 地面 · N3以上 · 敌人吉翁军：调查运输车队残骸后成功撤离。",
      "eventName": "运输车队残骸",
      "money": 12500,
      "inventory": {
        "RX_77_2": 1
      },
      "facilityUnlock": true,
      "ending": "车队都被抢干净了，哈？\n所以这都是从一开始就有预谋的...\n袭击是从联邦那边来的？\n那就是【雷纳斯】了...\n不好意思，我只是在自言自语，上面的人会好好想明白的。\n谢谢你，之后再来一趟吧。",
      "requires": [
        "efsf-5"
      ],
      "affinity": 100
    },
    {
      "id": "efsf-7",
      "number": 7,
      "name": "掠地攻城",
      "difficulty": 3,
      "kind": "command",
      "ground": true,
      "required": 1,
      "enemyFaction": "EFSF",
      "money": 22500,
      "inventory": {
        "RX_78_1": 1
      },
      "licensePlan": "Tech_EFSF_0079_BlueDestinyProject",
      "targetUnit": "RGM_79_G",
      "targetKits": [
        "machine_gun",
        "bazooka",
        "beam_rifle"
      ],
      "targetPilotGrade": "veteran",
      "requires": [
        "efsf-6"
      ],
      "affinity": 100,
      "description": "嘿！佣兵头子！\n我这里有一个很棒的差事，你还记得之前让你去调查的那个车队对吧？\n那个车队被我们这边的一个混蛋抢了，他叫【不死的雷纳斯】。\n去把他和他的部队干掉，把东西拿回来。\n但是要小心，他的部队有些实力，我可不想我们的好合作伙伴把自己玩死了！\n吉翁佬也对这里面的东西很感兴趣，所以不要把他们当自己人！\n这次的报酬非常棒，但风险也很高，考虑一下吧。",
      "objective": "合约模式 · 地面 · N3以上 · 敌人联邦军：击坠敌方小股兵力记名机",
      "ending": "都处理好了？\n干得好佣兵，看来他也不是真的死不了是吧？\n我这就派人去把东西运走。\n这台MS给你了，这可是个好东西。\n上面的大人物说可以给你们提供一些“先进”的装备。\n当然......不是免费的。",
      "eventName": "【不死的雷纳斯】"
    },
    {
      "id": "efsf-8",
      "number": 8,
      "name": "最好的差事",
      "difficulty": 3,
      "kind": "kills",
      "ground": true,
      "required": 50,
      "money": 30000,
      "inventory": {},
      "requires": [
        "efsf-6"
      ],
      "affinity": 100,
      "description": "好了，佣兵头子！\n听好了，我代表伟大的联邦授予你一项任务！\n我需要除掉一些吉翁佬，为我们在当地的记录再添一笔。\n觉得这事很简单？别得意忘形。\n脚踏实地把任务完成了再说。\n完事之后一定要回来向我汇报情况。\n要是汇报没让我满意，就等着和你的报酬说再见吧。",
      "objective": "合约模式 · 地面 · N3以上 · 敌人吉翁军：歼灭50架吉翁军MS。",
      "ending": "哦，你居然还记得要回来打报告。\n挺不错，来，这是给你的奖励。"
    },
    {
      "id": "efsf-9",
      "number": 9,
      "name": "往事速递",
      "difficulty": 3,
      "kind": "enemybase",
      "ground": true,
      "required": 1,
      "money": 22500,
      "inventory": {},
      "licensePlan": "Tech_EFSF_0079_OperationVDataRecoveryProject",
      "requiresExtraction": true,
      "guardCount": 12,
      "turrets": 4,
      "requires": [
        "efsf-8"
      ],
      "affinity": 100,
      "description": "气色不错啊，佣兵。\n看样子你还待在这破地儿没走？\n闲话不多说了。\n我这有件事儿，挺敏感的事情。\n我们现在算是互相信任了吧？\n所以我也相信你。\n具体的我就不和你说太多了，反正和我交给你的事没啥大关系。\n你的任务就是去拿一样东西，再把它放到另一个地方。\n听起来不难，是吧？\n但是这里有点细节问题，这个东西在沦陷的基地里面，现在这个基地在吉翁手里。\n听上去有点强人所难对吧？但这个东西真的很重要。\n但不要太担心，我把你们的IFF登录到前线联邦军的系统里面了。\n怎么样，有兴趣跑这一趟吗？",
      "objective": "合约模式 · 地面 · N3以上 · 敌人吉翁军：摧毁敌方大量兵力保守的基地",
      "ending": "什么，又成功了？\n很快你就能名震整个联邦，吉翁佬听了你的名字就要尿裤子的那种，哈哈！\n嘿，说着玩的，不过事情干得不错。\n我这个人很容易相处——只要你能把活办成，那就你好我好大家好，明白了吗？\n上面的人觉得可以和你们分享一下这次的成果......有偿。",
      "eventName": "摧毁敌方大量兵力保守的基地"
    },
    {
      "id": "efsf-10",
      "number": 10,
      "name": "艺术就是爆炸",
      "difficulty": 4,
      "kind": "kills",
      "ground": true,
      "required": 30,
      "money": 25000,
      "inventory": {},
      "licensePlan": "Tech_EFSF_0079_HeavyGuncannonPlan",
      "killMethod": "artillery",
      "requires": [
        "efsf-9"
      ],
      "affinity": 100,
      "description": "嘿，你好啊，佣兵头子！\n上面谈成了一单MS供应的生意，全新类型的家伙什，你之前绝对没见过的那种。\n和量产型钢坦克算是一类玩意儿，但要劲爆得多。\n这种东西可不能随随便便卖给其他人，想要用好它们，必须要有严格的开火纪律，精准的判断力。\n况且库存有限，我就算是想多卖也没货。\n所以啊，如果你真想从我这儿买这种正经的大威力武器，那就得先向我证明你是个真正的爆炸物专家，能把爆炸物精准送到敌人脸上。",
      "objective": "合约模式 · 地面 · N4以上 · 敌人吉翁军：以炮击的方式击坠30架MS。",
      "ending": "没错，你的“光辉事迹”连我都听说了，整个战线都知道有个疯子见人就炸。\n相信我，钢加农重装型在你手里只会让你如虎添翼。\n虽然我说过，这种货实在是不好搞，但是我可以在每次补货的时候都给你留几台。"
    }
  ];
  const byId = new Map(tasks.map(t=>[t.id,t]));
  const technologyTree = typeof DEVELOPMENT_TREE !== "undefined" ? DEVELOPMENT_TREE : require("./development-tree.json");
  const plans = new Map(Object.values(technologyTree).flat().map(node=>[node.id,node]));
  const mainTasks = new Set();
  const pending = tasks.filter(task=>{
    const plan=plans.get(task.licensePlan);
    return plan?.row==="mid" && !plan.placeholder;
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
  function normalize(value) {
    if (!Array.isArray(value)) return [];
    return tasks.flatMap(task=>{
      const entry=value.find(e=>e?.id===task.id && ["accepted","ready","claimed"].includes(e.status));
      return entry?[{id:task.id,status:entry.status,progress:Math.max(0,Math.min(task.required,Math.floor(Number(entry.progress)||0))),
        ...(task.reclaim && entry.loanTracking===true ? {loanTracking:true} : {}),
        ...(task.reclaim && entry.loanReturned===true ? {loanReturned:true} : {})}]:[];
    });
  }
  const active = value => normalize(value).filter(e=>e.status==="accepted").map(e=>e.id);
  function eligible(task, settings) {
    return task && settings.mode==="sweep" && settings.sweepFaction===(task.enemyFaction || "ZEON") &&
      Number(settings.sweepDifficulty)>=task.difficulty && (!task.ground || settings.sweepEnvironment==="ground");
  }
  function unlocked(task, entries, intro) {
    return !!task && !unmetRequirements(task,entries,intro).length;
  }
  function unmetRequirements(task, entries, intro) {
    if(!task) return [];
    const claimed=new Set(normalize(entries).filter(entry=>entry.status==="claimed").map(entry=>entry.id));
    return [
      ...(!intro?[{type:"intro"}]:[]),
      ...(task.requires || []).filter(id=>!claimed.has(id)).map(id=>({type:"task",id,name:byId.get(id)?.name || id})),
    ];
  }
  function specialTasks(room) {
    const ids=new Set(room.seats.filter(p=>p&&!p.bot&&p.seat%2===0).flatMap(p=>active(p.contactTasks)));
    return tasks.filter(t=>t.kind!=="kills" && ids.has(t.id) && eligible(t,room.settings));
  }
  return {planningVersion,tasks,byId,intro,normalize,active,eligible,unlocked,unmetRequirements,isSideTask,specialTasks};
})();
if(typeof module!=="undefined")module.exports=ContactTasks;
