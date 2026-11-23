/* Original Zeon liaison writing: fanatical loyalty, purges and holy-war rhetoric. */
const ZeonContact = (() => {
  const intro = [
    ["吉翁联络人", "【玩家公司名】。记住，你现在接通的是公国军，不是讨价还价的黑市。"],
    ["玩家", "我们来谈委托。"],
    ["吉翁联络人", "你们把战争叫委托，把牺牲叫损耗。我知道佣兵是什么东西。"],
    ["吉翁联络人", "但枪不需要理解信仰，只需要朝正确的方向开火。你们暂时可以成为那支枪。"],
    [
      "吉翁联络人",
      "地球的枷锁必须被砸断，联邦的统治必须被连根拔起。谁劝我们适可而止，谁就在替他们说话。",
    ],
    ["玩家", "包括你们自己人？"],
    [
      "吉翁联络人",
      "制服不能证明忠诚。迟疑、软弱、私藏物资，都会让前线的牺牲失去意义。叛徒比敌人更应该先被处理。",
    ],
    [
      "吉翁联络人",
      "你需要的调拨手续由军需处处理。钱是让工具继续运转的润滑油，不是我们战斗的理由。",
    ],
    ["吉翁联络人", "别在我面前谈停火。死去的人不能回来，但活着的人可以替他们完成净化。"],
    ["吉翁联络人", "去做事。让那些以为公国会疲倦的人，亲眼看见我们的意志。吉翁万岁。"],
  ];
  const tasks = [
    {
      id: "zeon-1",
      name: "友好姿态",
      difficulty: 1,
      kind: "kills",
      required: 6,
      money: 3000,
      inventory: { MS_06F: 3 },
      requires: [],
      objectiveText: "歼灭地球联邦军MS",
      description:
        "联邦的MS正在我们的土地上巡逻。他们以为只要每天走同一条路，侵略就能变成秩序。\n去打断他们的巡逻线。我要让每一个幸存者都明白，这片土地拒绝他们。\n不要替敌人找借口，不要告诉我他们也只是奉命行事。枪口朝向公国的那一刻，他们已经作出了选择。\n佣兵，把你的价值证明给我。",
      ending:
        "战报收到了。这只是开始。\n记住你今天把枪口朝向了哪里。我们不会因为一次小小的胜利就允许自己停下。\n继续执行，别让前线死去的人等得太久。",
    },
    {
      id: "zeon-2",
      name: "鹰眼账本",
      difficulty: 1,
      kind: "salvage",
      ground: true,
      required: 1,
      money: 5000,
      inventory: { FatUncle: 1, PapuaClass: 1 },
      requires: ["zeon-1"],
      wreckUnit: "FatUncle",
      eventName: "坠毁胖叔叔的运输记录",
      objectiveText: "回收坠毁胖叔叔的运输记录后撤离",
      description:
        "运输机失联，机上有前线物资调拨记录。联邦正在坠机点附近活动。\n找到那架胖叔叔，把运输记录带回来，不要在现场逗留。\n我不接受用混乱解释失联。记录会告诉我们是谁耽误了运输，是谁让前线的人等不到补给。\n如果里面有自己人的名字，也照样带回来。公国需要的是忠诚，不是替懦夫遮丑的情面。",
      ending:
        "记录完整。很好。\n有人会因此接受审查，有人会因此不再需要接受审查。你不必关心程序。\n别替这些人惋惜。前线饿着肚子的人，可没机会坐在这里解释。",
    },
    {
      id: "zeon-3",
      name: "账外资产",
      difficulty: 1,
      kind: "command",
      ground: true,
      required: 1,
      money: 6000,
      inventory: { MS_06J: 1, MS_06F: 2 },
      requires: ["zeon-2"],
      targetUnit: "MS_06F",
      targetCount: 3,
      targetKits: ["machine_gun", "bazooka", "machine_gun"],
      targetPilotGrade: "veteran",
      targetName: "账外护卫",
      eventName: "失控的吉翁护卫小队",
      objectiveText: "击败携带账本的老兵吉翁护卫小队",
      description:
        "三台扎古带着账本脱离了部队。他们说只是想活下去。\n前线所有人都想活，但并不是所有人都因此放下祖国。\n借联邦战区的掩护，把那支老兵护卫小队全数消灭，拿回文件。\n背叛一旦被允许，明天就会有人把整个殖民地的未来拿去换自己的一张船票。\n我宁可清理十次，也不会留下一个先例。",
      ending:
        "叛逃记录封存，部队番号保留。\n他们会被记作战死，而不是让更多软弱的人模仿他们。\n你做得对。记住，清除腐烂的部分，也是忠于公国。",
    },
    {
      id: "zeon-4",
      name: "人道主义货物",
      difficulty: 2,
      kind: "command",
      ground: true,
      required: 1,
      money: 7500,
      inventory: { MS_06J: 2 },
      requires: ["zeon-3"],
      targetUnit: "RGM_79_E",
      targetCount: 6,
      targetName: "仓库警卫",
      eventName: "援助仓库外围的联邦守军",
      objectiveText: "消灭两个三机联邦仓库警卫小队",
      description:
        "联邦把仓库和补给线称作人道主义设施。他们的军队就站在门外，却还要拿这个词挡我们的枪。\n清除仓库外的吉姆部队，把接收通道打开。\n仓库保持完整，物资交给我们的接收部队。公国的战士比侵略者更有资格得到它们。\n别听敌人的辩解。真正的仁慈，是让这场必须获胜的战争尽快结束。",
      ending:
        "道路清理完毕。\n物资会送往继续战斗的人，战报会送往继续迟疑的人。\n让他们知道，坚定的人已经替他们做出了决定。",
    },
    {
      id: "zeon-5",
      name: "实地说服",
      difficulty: 2,
      kind: "factory",
      ground: true,
      required: 4,
      money: 7500,
      inventory: { MS_07B: 1 },
      grant: { MS_11S: 1 },
      reclaim: { MS_11S: 1 },
      requires: ["zeon-4"],
      requiredAttackerUnit: "MS_11S",
      targetCount: 4,
      guardCount: 12,
      turrets: 4,
      licensePlan: "Tech_ZEON_0079_GroundTypeMSDevelopmentPlan",
      eventName: "机动扎古指挥官机实战采购测试",
      objectiveText: "使用机动扎古指挥官机摧毁工厂",
      description:
        "军需委员会还在争论新MS是否值得投入。他们数着成本，前线却在用血付账。\n试验部队会借给你一台机动扎古指挥官机。带它去摧毁联邦的军用工厂，我要一份让委员会再也无法装瞎的实战报告。\n现场有驻军和炮塔，正好让那群只会看表格的人闭嘴。\n你安排驾驶员，保持原定试验配置，回来后让整备班接手机器和交战记录。\n我要证明的不是一台机器有多好，而是公国没有后退的理由。",
      ending:
        "工厂已成废墟，试验记录也收到了。\n我会把报告送到每一个声称应该节省战争开支的人面前。\n只有胜利才是节省。其他说法，不过是软弱披上的制服。",
    },
    {
      id: "zeon-6",
      name: "通行税",
      difficulty: 3,
      kind: "salvage",
      ground: true,
      required: 1,
      money: 12500,
      inventory: { MS_06K: 1 },
      requires: ["zeon-5"],
      facilityUnlock: true,
      wreckUnit: "SamsonGroundTransportTruck",
      eventName: "失踪物资车队的通行记录",
      objectiveText: "调查物资车队残骸后成功撤离",
      description:
        "车队失踪了。负责放行的人保证过通道安全，结果前线等来的只有沉默。\n调查运输车队残骸，把行车记录带回来。查清楚之前，不要向当地驻军透露你在找什么。\n查清袭击从哪边来。是联邦，就让他们偿还；是公国的人，就让他们为背叛偿还。\n祖国不是一张能拿来给私欲擦嘴的旗帜。有人忘了，我会让他们重新记住。",
      ending:
        "袭击来自我们这边。\n很好，至少现在我们知道腐烂藏在哪里了。\n记录交给我。你准备好继续执行，我准备好把这件事处理到底。\n谁也别想用自己人三个字求得宽恕。",
    },
    {
      id: "zeon-7",
      name: "忠诚的回扣",
      difficulty: 3,
      kind: "command",
      ground: true,
      required: 1,
      money: 22500,
      inventory: { MS_07B3: 1 },
      requires: ["zeon-6"],
      targetUnit: "MS_14A",
      targetUnits: [
        { unitId: "MS_14A", kitId: "beam_rifle" },
        { unitId: "MS_06F2", kitId: "machine_gun" },
        { unitId: "MS_06F2", kitId: "bazooka" },
      ],
      targetCount: 3,
      targetPilotGrade: "veteran",
      targetName: "收税官卫队",
      targetLeaderPilot: {
        name: "收税官卫队长",
        grade: "ace",
        dialogue: {
          attack: ["敢动这批货？先问问我的光束步枪！", "公国的财产，由我来保管！"],
          hit: ["该死，这台机器的维修费可不便宜！"],
          miss: ["别躲了，拿了钱就该把命留下！"],
          kill: ["把残骸记进战利品清单。"],
          defeat: ["混蛋……他连自己人的账也要抹掉吗！"],
          allyLoss: ["守住仓库！谁也不许后退！"],
          taunt: ["佣兵，你知道自己在跟谁作对吗？"],
          reply: ["少废话，公国不需要你教我们纪律！"],
        },
      },
      eventName: "收税官的私人卫队",
      objectiveText: "消灭私吞车队货物的格鲁古古与扎古ⅡF后期型小队",
      licensePlans: ["Tech_ZEON_0079_603TestTeam", "Tech_ZEON_0079_GoufFlightTypeDevelopmentPlan"],
      description:
        "扣车的人已经找到了。他把前线物资扣在私人仓库，还说这是战时审查。\n他的卫队长开格鲁古古，是个难缠的家伙。护卫的扎古驾驶员也都上过前线，别指望他们自己逃走。\n借联邦战线的混乱接近他们，把整支卫队除掉。不要留一个能继续替他收税的人。\n他们每多留一箱货，前线就可能多死一名真正的战士。\n我不会容忍寄生在旗帜上的东西。你也不要指望我容忍。",
      ending:
        "卫队已经确认覆灭。\n他或许会觉得我太极端，但前线死去的人再也没有机会觉得什么了。\n继续证明，你是刀，而不是我们必须切除的另一块腐肉。",
    },
    {
      id: "zeon-8",
      name: "和平统计学",
      progressVersion: 2,
      difficulty: 5,
      kind: "command",
      enemyFaction: "ZEON",
      ground: true,
      required: 1,
      money: 30000,
      inventory: {},
      requires: ["zeon-6"],
      licensePlan: "Tech_ZEON_0079_ApsarasDevelopmentPlan",
      targetUnit: "MS_11S",
      targetUnits: [
        { unitId: "MS_11S", kitId: "kit_1" },
        { unitId: "MS_11", kitId: "kit_0" },
        { unitId: "MS_11", kitId: "kit_1" },
        { unitId: "MS_11", kitId: "kit_0" },
        { unitId: "MS_11", kitId: "kit_1" },
        { unitId: "MS_11", kitId: "kit_0" },
      ],
      targetPilotGrade: "elite",
      targetName: "机动扎古中队",
      targetLeaderPilot: {
        name: "机动扎古中队长",
        grade: "ace",
        dialogue: {
          attack: ["全机保持队形，集中攻击联邦先头部队！", "机动扎古中队，开始突击！"],
          hit: ["还能继续作战，不要停下！"],
          miss: ["目标正在变向，修正射击！"],
          kill: ["确认击破，下一个目标！"],
          allyLoss: ["收拢队形，别让他们各个击破！"],
          defeat: ["撤退……这份作战命令，有问题……"],
          taunt: ["联邦的部队，就由我们来拦住！"],
          reply: ["公国的战士不会向你们低头！"],
        },
      },
      eventName: "机动扎古精锐中队",
      objectiveText: "以联邦军一侧入场，歼灭机动扎古指挥官机与五台机动扎古",
      description:
        "机动扎古中队掌握了一份调拨清单。可他们拒绝服从保密命令，还在讨论把它交给停火派。\n停火派。多么体面的名字，好像把牺牲换成谈判筹码就能让死人闭嘴。\n这次你要借联邦军的识别掩护接近他们，把中队彻底消灭。带队的指挥官和部下都是百战余生的好手，别让他们有机会重整队形。\n敌人的外衣只是手段。忠诚由目的决定，不由识别码决定。\n我不需要你认同，只需要你执行。",
      ending:
        "中队已经确认覆灭。\n他们是优秀的战士，却以为优秀就有资格怀疑祖国的道路。\n这份统计会被封存，清单也会。我们没有失去未来，只是清除了通往未来的障碍。",
    },
    {
      id: "zeon-9",
      name: "特殊货运",
      difficulty: 3,
      kind: "enemybase",
      ground: true,
      required: 1,
      money: 22500,
      inventory: { MS_09: 1 },
      requires: ["zeon-8"],
      guardCount: 12,
      turrets: 4,
      requiresExtraction: true,
      licensePlan: "Tech_ZEON_0079_NewGroundTypeMSDevelopmentPlan",
      eventName: "封存采购档案的联邦基地",
      objectiveText: "摧毁联邦基地后成功撤离",
      description:
        "联邦基地里保存着一批战区档案，记录了他们如何把我们的同胞当作可以管理的数字。\n摧毁那里的指挥设施，随后撤出战区。驻军和炮塔都不会主动让路。\n备份链路会替我们取回资料，剩下的建筑不应继续存在。\n我要让他们的统治在地面留下一个能被看见的缺口，而不是一份可以压进抽屉的抗议。",
      ending:
        "基地确认摧毁。\n档案会成为证据，废墟会成为警告。我们不会求他们承认错误，我们会夺走他们继续犯错的能力。\n你已经看到了敌人统治下的真相。下次扣动扳机的时候，别忘了它。",
    },
    {
      id: "zeon-10",
      name: "和平的口径",
      difficulty: 4,
      kind: "kills",
      ground: true,
      required: 50,
      money: 25000,
      inventory: {},
      requires: ["zeon-9"],
      killMethod: "melee",
      licensePlan: "Tech_ZEON_0079_PezunProject",
      objectiveText: "使用格斗武器消灭联邦军MS",
      description:
        "他们总说公国只会躲在炮火后面。我要一份让这种傲慢闭嘴的近战报告。\n带上你的格斗武器，迎着联邦的MS打过去。我要他们亲眼看清是谁破开了他们的防线，不是在烟散以后再去争论炮弹来自哪边。\n别把勇气解释成愚蠢，保持队形，执行军令。公国需要胜利者，不需要没有意义的尸体。\n战争不会因为敌人觉得痛苦就自动结束，它会在他们再也不能阻挡我们时结束。",
      ending:
        "前线的报告已经送到了。\n你终于让他们看见了退让不会发生。\n我们还会走得更远，直到联邦的枷锁被彻底砸断。\n吉翁万岁。",
    },
    {
  "id": "zeon-11",
  "name": "不可退让",
  "difficulty": 4,
  "kind": "command",
  "ground": true,
  "required": 1,
  "money": 20000,
  "inventory": {},
  "requires": [
    "zeon-9"
  ],
  "licensePlan": "Tech_ZEON_0079_ZakuIILateTypeDevelopmentPlan",
  "eventName": "【铁壁沃尔克】",
  "targetUnit": "RX_79_G",
  "targetUnits": [
    {
      "unitId": "RX_79_G",
      "kitId": "beam_rifle"
    },
    {
      "unitId": "RX_79_G",
      "kitId": "beam_rifle"
    },
    {
      "unitId": "RX_79_G",
      "kitId": "beam_rifle"
    },
    {
      "unitId": "RX_79_G",
      "kitId": "beam_rifle"
    },
    {
      "unitId": "RX_79_G",
      "kitId": "beam_rifle"
    },
    {
      "unitId": "RX_79_G",
      "kitId": "beam_rifle"
    }
  ],
  "targetPilotGrade": "elite",
  "targetName": "沃尔克中队",
  "targetLeaderPilot": {
    "name": "铁壁沃尔克",
    "grade": "elite",
    "dialogue": {
      "attack": [
        "守住这条线，不能再让他们前进！"
      ],
      "hit": [
        "还能战斗，稳住！"
      ],
      "miss": [
        "不要追，保持交叉火力！"
      ],
      "kill": [
        "目标停止，继续警戒！"
      ],
      "defeat": [
        "防线……交给你们了……"
      ],
      "allyLoss": [
        "收拢队形，不要各自为战！"
      ],
      "taunt": [
        "这里不会再让你们过去！"
      ],
      "reply": [
        "我们不会撤退！"
      ]
    }
  },
  "objectiveText": "歼灭【铁壁沃尔克】中队全部陆战型高达",
  "description": "联邦在我们的进军路线上钉下了一支精锐部队，领头的自称铁壁沃尔克。\n他把占领区叫防线，把拒绝撤走叫守土。他们踩在谁的土地上，难道已经忘了吗？\n那支中队装备陆战型高达，驾驶员都是打过硬仗的人。摧毁他们，不要让这块所谓的铁壁继续挡在公国面前。\n有人劝我绕开，说正面强攻的损失不值得。今天绕开一条线，明天就会有人提议放弃一座城。\n我要这条路打开，也要那些劝退的人亲眼看着它被打开。",
  "ending": "铁壁倒了。那些拿它当借口的人，现在还有什么可说？\n不是我们走得太远，是他们忘了我们为什么出发。\n前线会继续向前，你也一样。别把今天的战果当成可以停下的理由。吉翁万岁。"
},
  ].map((task, index) => ({
    ...task,
    contactId: "zeon",
    number: index + 1,
    enemyFaction: task.enemyFaction || "EFSF",
    era: "UC_0079_T1",
    affinity: 100,
  }));
  return {
    intro,
    tasks,
    planningVersion: "1.0",
    introPlan: "Tech_ZEON_0079_GroundTypeZakuDevelopmentPlan",
  };
})();
if (typeof module !== "undefined") module.exports = ZeonContact;
