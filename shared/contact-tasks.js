/* Persistent liaison commissions; separate from scripted battle missions. */
const ContactTasks = (() => {
  const tasks = [
    { id:"efsf-1", number:1, name:"首秀", difficulty:1, kind:"kills", required:6,
      description:"你好啊，佣兵头子。\n这个活对正规部队来说太小菜一碟了，但是挺适合你们这些新来的。\n嘿，别在那不爽，你至少得混个熟脸，我才能安排正经的差事给你！\n\n现在到处都是那些吉翁的杂碎，简直把这里当自己家了！\n有队吉翁的混蛋在一个很麻烦的地方安了家，把他们宰了再回来。",
      objective:"合约模式 · N1以上 · 敌人吉翁军：歼灭6架吉翁军MS。", money:3000, inventory:{RGM_79_E:3},
      ending:"那么，这就干完啦？\n虽然我并不觉得意外，但还是得确认一下才保险！" },
    { id:"efsf-2", number:2, name:"搜索任务", difficulty:1, kind:"salvage", ground:true, required:1,
      description:"嘿，佣兵头子！\n长话短说，有架运输机失去联系已经有一段时间了。\n上面派他们去前线附近转移一件挺重要的货物。\n恐怕他们是遇到了什么埋伏，我和他们最后一次通话的时候，他们报告说有一伙吉翁巡逻队从附近的山丘方向接近了他们。\n\n去前线调查一下，看看现场有没有幸存者。\n从最后通报的情况来看，吉翁肯定在附近安顿了下来，说不定是搭了个营地，所以小心些。\n找到我们的运输机，取回里面的数据。现在解散！",
      objective:"合约模式 · 地面 · N1以上 · 敌人吉翁军：取回坠落米迪亚残骸中的数据后撤离。", eventName:"坠落米迪亚的数据", money:5000, inventory:{Medea:1,ColumbusClass:1},
      ending:"噢...你们活着回来了。\n把数据传过来吧，我这边有些装备不好处理。\n便宜卖给你们吧。" },
    { id:"efsf-3", number:3, name:"罪证", difficulty:1, kind:"command", ground:true, required:1,
      description:"别来无恙，我亲爱的朋友，来借一步说话。\n如果你有兴趣的话，我这有个活儿给你整。\n你得想办法帮我们找个东西，这会儿我已经没招了——\n长话短说，有个在他妈的前线的军官搞到了一批非常重要的文件。\n你也知道，外头有多少人为了能搞到联邦高层和帮凶的罪证在疯狂火拼。\n之后的展开你也猜到了，但是那些试图把东西搞到手的人又蠢又猴急，那军官还没来得及开口就被他们弄死了。\n你能想象吗？太不专业太没水平了！跟这些智障真是没法做生意……\n\n好了，让我们回到正题吧。\n虽然我们不知道为什么一个在前线的军官为什么能搞到这东西，但我要你把那玩意带回来。\n这玩意多半在那军官的部下那里，我要你以吉翁人的身份入场，把他们干掉，把东西拿回来。\n\n别这么看我，这只是生意。",
      objective:"合约模式 · 地面 · N1以上 · 敌人吉翁军：击败记名联邦MS小队。",eventName:"记名联邦MS小队", money:6000, inventory:{RGM_79_G:1,RGM_79_E:2},
      ending:"你们成功了对吧？\n太好了，我现在让我的人去你们营地取文件。\n对了，这几台MS原本是那个小队的补给。\n现在他们肯定用不上了......放心，不会有问题的。\n他们会在纸面上活得好好的。" },
    { id:"efsf-4", number:4, name:"硝烟野餐", difficulty:2, kind:"command", ground:true, required:1,
      description:"活得还滋润吧，佣兵头子？好小子！\n说明你脑子里还算有点货，不会把自己给蠢死。\n那我就再交待个差事给你吧。\n\n几个挺有身份的大人物在你们附件的某些地方有点事情要处理。\n但问题是，吉翁的人渣总是跳出来碍事——那帮家伙可能是缺根筋，真当这儿是他们自个的地盘了，你能想象这种事情吗？\n\n根据我的消息，这些白痴也就十来个MS，但说不好会不会更多。\n我需要你帮我们办挺那群混蛋。\n对于你们这些专业人士来说，肯定不费功夫就能办完了。",
      objective:"合约模式 · 地面 · N2以上 · 敌人吉翁军：击毁指定区域的12台吉翁MS。",eventName:"硝烟野餐：吉翁驻军", money:7500, inventory:{RGM_79_G:2},
      ending:"办得怎么样了？\n啊，别说了，我早就知道结果不错。\n你不是好端端的站在这嘛，身上也没少零件，对吧？\n那些大佬也传话过来，说他们那边也很顺利。\n给，这是你的报酬，有我的小小心意，还有大人物们的酬谢。" },
    { id:"efsf-5", number:5, name:"武力说服", difficulty:2, kind:"factory", ground:true, required:1,
      description:"你好，佣兵头子！\n有个挺特别的任务要交给你。\n我需要对一款MS来上一场真正的实战测试，必须是最真实的交战情况，不能靠猎杀那些杂鱼充数。\n我想你大概知道上哪儿去测试了，对吧？\n\n有些大人物不相信这玩意儿的效果……你能让他们改变想法吗？\n\n哦对了，还有一点：如果你不小心把MS弄坏了，我可以给你搞来一架新的，但这可不是免费的。\n＊获得苍白骑士＊",
      objective:"合约模式 · 地面 · N2以上 · 敌人吉翁军：使用苍白骑士摧毁吉翁方前线营地。",eventName:"苍白骑士实战测试", money:7500, inventory:{RX_79_G:1}, grant:{RX_80PR:1}, licensePlan:"Tech_EFSF_0079_EarlyTypeMSDevelopmentPlan",
      ending:"你居然没死在外面？\n另一个负责实验这MS的部队把自己基地都玩没了。\n好啦好啦，我会把他们的装备弄到你这里的。\n当然，不是免费的。" },
    { id:"efsf-6", number:6, name:"绿色通道", difficulty:3, kind:"salvage", ground:true, required:1,
      description:"这些杀千刀的吉翁佬！\n他们就是想要屠杀一切！\n我们明明谈判过了，还付了钱让他们放我们通行！\n但是，他们还是想吸掉我们的血！\n总之，佣兵头子，过来听好了。\n战区里会有一支车队经过，他们护送着非常重要的货物。\n非 常 重 要。就连我都不知道具体是什么。\n吉翁佬收钱之后给车队开了安全通道，然后车队就不见了，太混蛋了！\n去看看到底发生了什么，找一找有没有什么还在的东西。\n然后调查清楚，袭击是从那边来的...",
      objective:"合约模式 · 地面 · N3以上 · 敌人吉翁军：调查运输车队残骸后成功撤离。",eventName:"运输车队残骸", money:12500, inventory:{RX_77_2:1}, facilityUnlock:true,
      ending:"车队都被抢干净了，哈？\n所以这都是从一开始就有预谋的...\n袭击是从联邦那边来的？\n那就是【雷纳斯】了...\n不好意思，我只是在自言自语，上面的人会好好想明白的。\n谢谢你，之后再来一趟吧。" },
  ];
  const byId = new Map(tasks.map(t=>[t.id,t]));
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
      return entry?[{id:task.id,status:entry.status,progress:Math.max(0,Math.min(task.required,Math.floor(Number(entry.progress)||0)))}]:[];
    });
  }
  const active = value => normalize(value).filter(e=>e.status==="accepted").map(e=>e.id);
  function eligible(task, settings) {
    return task && settings.mode==="sweep" && settings.sweepFaction==="ZEON" &&
      Number(settings.sweepDifficulty)>=task.difficulty && (!task.ground || settings.sweepEnvironment==="ground");
  }
  function specialTasks(room) {
    const ids=new Set(room.seats.filter(p=>p&&!p.bot&&p.seat%2===0).flatMap(p=>active(p.contactTasks)));
    return tasks.filter(t=>t.kind!=="kills" && ids.has(t.id) && eligible(t,room.settings));
  }
  return {tasks,byId,intro,normalize,active,eligible,specialTasks};
})();
if(typeof module!=="undefined")module.exports=ContactTasks;
