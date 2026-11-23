/* Original procurement commissions: every flag is a market and every favour an invoice. */
const AnaheimContact = (() => {
  const intro = [
    ["阿纳海姆联络人", "【玩家公司名】？坐吧。别碰展示柜，碰坏按全新价赔，折旧是我们自己的事。"],
    ["玩家", "你们替哪边做生意？"],
    ["阿纳海姆联络人", "替按时付款的那边。今天是你，明天也可以是你，取决于你的信用。"],
    ["阿纳海姆联络人", "我这里的好货不摆在橱窗里。替我拿几批货、几份资料，让我看看你能不能做长久生意。"],
    [
      "阿纳海姆联络人",
      "有些活要在没有友军的战区做。两边都别挂靠，免得有人问你为什么搬走自己人的东西。",
    ],
    ["阿纳海姆联络人", "别叫偷。物资在仓库里积灰，我们帮它重新进入流通。商业文明，懂吗？"],
    ["阿纳海姆联络人", "报酬按交付算，商品按件收费。你命硬是你的本事，不能抵货款。"],
  ];
  const tasks = [
    {
      id: "anaheim-1",
      name: "不问来路",
      difficulty: 2,
      kind: "salvage",
      enemyFaction: "ZEON",
      eventFaction: "ZEON",
      money: 4000,
      pluginUnlocks: ["frame", "armor"],
      wreckUnit: "SamsonGroundTransportTruck",
      eventName: "失踪的结构材料货柜",
      objectiveText: "回收吉翁运输货柜中的结构材料清单并撤离",
      description:
        "朋友，先让我看看你的工作质量。\n吉翁有一批结构材料躺在前线货柜里。原买家尾款拖了三个月，他们却说战争期间不接受退货。\n把货柜里的清单带出来。我们的回收组会照单提货，你不用替我搬钢板。那地方现在归吉翁的人看着，别让他们给你也开张收据。\n别拿烧焦的纸交差。我做的是材料生意，不是爱国主义灰烬。",
      ending:
        "清单没少，印章也在。很好，我会告诉仓库，这批货是客户自愿退回的。\n你比那些穿制服的客户守信用。保持下去，我喜欢不需要催的生意。",
    },
    {
      id: "anaheim-2",
      name: "两头报价",
      difficulty: 2,
      kind: "salvage",
      enemyFaction: "EFSF",
      eventFaction: "EFSF",
      money: 5000,
      pluginUnlocks: ["antenna", "shield", "water", "ground", "space"],
      wreckUnit: "Type74",
      eventName: "联邦环境试验资料",
      objectiveText: "取回联邦环境试验资料并撤离",
      description:
        "联邦送来了一份需求书，要我们保证设备在水里、沙里和真空里都能工作。他们自己的试验报告却锁在前线，真他妈周到。\n去他们的试验车里把资料取回来。警卫不认识你，也不需要认识你，别留下公司的名片。\n报告归我们，报告里的建议会变成产品，再卖回给他们。知识总要流动，现金也一样。",
      ending:
        "非常好。他们付钱做试验，我们付钱取报告，最后他们再付钱买改进件。\n这才叫一条完整的产业链。下次有人问你替谁干活，就说替技术进步。",
    },
    {
      id: "anaheim-3",
      name: "售后免责",
      difficulty: 2,
      kind: "kills",
      required: 12,
      requiredAttackerPlugin: "frame",
      money: 6000,
      pluginUnlocks: ["chobham", "generator"],
      objectiveText: "武装介入入场，使用装有强化骨架的单位击毁12台敌军MS",
      description:
        "工程师说骨架强度没有问题，法务说工程师说的话不构成任何形式的保证。你看，大家都很专业。\n给你的机器装上强化骨架，到交火最热闹的地方试试。我要看到它在真正交战时的表现，不是试验场里站着挨打的漂亮曲线。\n别挂任何一方的旗，两边的机器都可以拿来作比较。把你们自己的交战记录带回来，路边捡的残骸证明不了产品可靠。\n至于试装的费用，当然走你自己的账。花自己的钱，人就会认真得多。",
      ending:
        "记录很完整。法务很满意，工程师也终于闭嘴了。\n你问保修？战区损坏属于使用不当，这条一直在合同背面。别这么看我，纸又不是不许翻。",
    },
    {
      id: "anaheim-4",
      name: "样机不记名",
      difficulty: 3,
      kind: "salvage",
      eventFaction: "ZEON",
      money: 7500,
      pluginUnlocks: ["long_sight", "radar"],
      wreckUnit: "RGM_79_G",
      eventName: "被扣押的陆战型吉姆样机",
      objectiveText: "武装介入入场，取得被扣押样机的回收定位资料并撤离",
      description:
        "吉翁扣了一批联邦样机，说要研究敌方技术。巧了，其中一台的贷款还没还清，按合同它算我们的。\n找到封存的陆战型吉姆，读取运输箱里的定位资料后离开。回收组会接手整机。两边都别挂靠，我不想处理军方之间的产权争议。\n别开着它到处跑，我要的是能卖的样品，不是你改出来的战场艺术。\n要是双方都问起来，就说你是来调查违章停车的。",
      ending:
        "样机到了，编号也磨掉了……我是说，重新登记了。\n消息灵通的人活得久，替他们保管消息的人活得更舒服。今天这笔，咱们都没白忙。",
    },
    {
      id: "anaheim-5",
      name: "商标朝外",
      difficulty: 3,
      kind: "kills",
      required: 15,
      requiredAttackerPlugin: "chobham",
      money: 9000,
      pluginUnlocks: ["thruster", "light_armor"],
      objectiveText: "武装介入入场，使用装有额外装甲的单位击毁15台敌军MS",
      description:
        "客户嫌额外装甲太笨重。客户也嫌被打穿驾驶舱太疼，真难伺候。\n把额外装甲装上，带到双方争夺的地方去打一场。不要接受哪边的指挥，我需要能独立核实的战斗记录。\n我们要证明的是披着这层铁皮也能把对手打趴下，不是它能在原地挨多久。别只拍挨打的部分，也别把对面的商标拍得比我们清楚。\n宣传部门等着用，别让他们自己编。编得太离谱，最后还得我出面解释。",
      ending:
        "数据能用，照片也能用。我让美术把弹孔修掉了，客户看的是信心。\n嫌重的那批人已经开始问有没有更轻的方案。生意就是这样，解决一个问题，总能发现下一个问题。",
    },
    {
      id: "anaheim-6",
      name: "空白提单",
      difficulty: 4,
      kind: "salvage",
      eventFaction: "EFSF",
      money: 11000,
      pluginUnlocks: ["long_barrel"],
      wreckUnit: "Medea",
      eventName: "联邦军需运输机的技术货单",
      objectiveText: "武装介入入场，取回联邦运输机技术货单并撤离",
      description:
        "联邦一架运输机带着一批枪管试制图纸出了事。赔款我们已经申请了，图纸最好也别浪费。\n把运输机货舱的数据带回来。别替任何一边站岗，拿到就走。那些警戒部队可不会因为你穿得像承包商就少开几枪。\n如果有人说那是军方机密，提醒他我们的会计也把发票叫机密。他们只是还没谈妥价格。",
      ending:
        "提单是空白的，数据却很完整。完美。\n保险公司出的赔款，军方出的研究费，忙着核对的人还以为这里只有一笔生意。你说他们是不是太辛苦了？",
    },
    {
      id: "anaheim-7",
      name: "竞争性报价",
      difficulty: 4,
      kind: "command",
      eventFaction: "EFSF",
      requiresExtraction: true,
      money: 12500,
      pluginUnlocks: ["ambac"],
      eventName: "军方采购保管小队",
      targetUnit: "RX_79_G",
      targetUnits: [
        { unitId: "RX_79_G", kitId: "beam_rifle" },
        { unitId: "RGM_79_G", kitId: "cannon" },
        { unitId: "RGM_79_G", kitId: "bazooka" },
      ],
      targetPilotGrade: "elite",
      objectiveText: "武装介入入场，歼灭采购资料保管小队并撤离",
      description:
        "有个军官打算把我们的报价交给竞争对手。他还说这是为了降低军费，我差点感动得把账本摔他脸上。\n携带采购资料的护卫队正在转移，陆战型高达带队，旁边跟着陆战型吉姆。那些驾驶员很有经验，别把他们当仓库门卫。\n截住他们，把这条消息渠道彻底掐断，再撤出来。两边都不要挂靠，也别在无线电里承认替谁干活。\n我尊重竞争，尤其尊重竞争对手按自己的本事做生意。拿我的报价去，算什么本事？",
      ending:
        "现在竞争对手只能靠自己做设计了。真遗憾。\n我们从不阻止竞争，只是替市场清理一点不规范的信息渠道。你今天维护了商业秩序，朋友。",
    },
    {
      id: "anaheim-8",
      name: "实测数据",
      difficulty: 4,
      kind: "kills",
      required: 20,
      requiredAttackerUnit: "RX_79_G",
      grant: { RX_79_G: 1 },
      reclaim: { RX_79_G: 1 },
      money: 15000,
      pluginUnlocks: ["aiming_system"],
      objectiveText: "武装介入入场，使用借用陆战型高达击毁20台敌军MS",
      description:
        "我们借给你一台陆战型高达。别激动，所有权、试验数据和机体上的划痕都写在合同里。\n带它去双方混战的地方，主动找那些MS交手。别给任何一边打旗号，我要能对照双方机型的实战记录，不是战后抄来的统计表。\n驾驶员你安排，但别动我们的试验配置。瞄准、开火、交战反馈，整套原始记录都要保留，回来连机器一起交给工程师。\n为什么找你？军方的报告总是先写胜利，再挑数据。我想先看看数据。",
      ending:
        "数据齐了，机器也收回来了。你的驾驶员可以走了，工程师还得加班。\n别替他们难过，项目预算里有加班费。有没有发到他们手里，那是人事部门的问题。",
    },
    {
      id: "anaheim-9",
      name: "商业机密",
      difficulty: 5,
      kind: "upload",
      eventFaction: "ZEON",
      money: 17500,
      pluginUnlocks: ["minovsky", "concealment"],
      eventName: "吉翁隐蔽通信试验终端",
      objectiveText: "武装介入入场，守住终端完成三回合技术数据上传并撤离",
      requiresExtraction: true,
      description:
        "吉翁的试验终端里有一套很有意思的通信和隐蔽数据。他们说不出口，我觉得只是报价没到位。\n接通终端，把资料传到我们这里。线路老得要命，你得守住现场，等传输结束才能撤。\n别借任何一边的旗号进去。对面不会安安静静看着你下载，附近的部队和赶来的援军都得由你处理。\n别问我们会不会卖给联邦。我们尊重商业机密，客户名单也属于商业机密。",
      ending:
        "数据传完了，律师已经准备好新的专利说明。\n他们还在讨论这技术应不应该出口，我们已经开始讨论该在哪儿注册。你看，这就是效率。",
    },
    {
      id: "anaheim-10",
      name: "独家代理",
      difficulty: 6,
      kind: "enemybase",
      eventFaction: "EFSF",
      money: 20000,
      pluginUnlocks: ["ms_database"],
      guardCount: 15,
      turrets: 4,
      eventName: "联邦战区技术资料库",
      objectiveText: "武装介入入场，摧毁技术资料库HQ后成功撤离",
      description:
        "朋友，又有一笔生意。联邦战区资料库里有一套MS识别记录，能帮我们分清哪些技术真的有用，哪些只是采购部门写得好看。\n打掉存放资料的指挥设施，再撤出来。我们的接收组会从备用链路取走数据。那地方驻军不少，还有炮塔，别嫌我没提醒。\n两边都别挂靠。为什么非要毁掉原件？独家代理得有点独家的样子，东西还在别人手里，合同就不好谈。\n这仗离打完还早，后面不知道还会冒出多少新玩意儿。咱们先把眼前这批生意做稳，别人的下一张订单，或许已经在路上了。",
      ending:
        "备份收到了，原资料库也没了。独家二字，现在总算站得住脚。\n这批账可以结了，后面的货路我还在谈。先让你的人歇口气，等有了准信，我会再联络你。\n当然，希望到时候你还记得老客户的交情。我这里可一直记着你的账。",
    },
  ].map((task, index) => ({
    required: 1,
    inventory: {},
    enemyFaction: "NONE",
    ground: true,
    era: "UC_0079_T1",
    affinity: 100,
    ...task,
    contactId: "anaheim",
    number: index + 1,
    requires: index ? [`anaheim-${index}`] : [],
  }));
  return { intro, tasks, planningVersion: "1.0" };
})();
if (typeof module !== "undefined") module.exports = AnaheimContact;
