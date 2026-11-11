/* Deterministic, non-authoritative dialogue layer. Combat facts remain in the battle log. */
const BattleDialogue = (() => {
  const lines = {
    attack: {
      calm: ["目标确认，开始射击。", "保持阵形，按计划交战。"],
      aggressive: ["给我打下来！", "别想从这里逃走！"],
      cautious: ["注意敌方火力，谨慎推进。", "确认射界后开火。"],
      idealist: ["我会保护身后的人！", "这场战斗必须结束！"],
    },
    hit: {
      calm: ["机体受损，继续作战。", "损伤确认，调整姿态。"],
      aggressive: ["可恶！你会付出代价！", "这点攻击还不够！"],
      cautious: ["遭到攻击，立即规避！", "装甲受损，请求掩护！"],
      idealist: ["不能在这里倒下！", "大家还在等着我！"],
    },
    kill: {
      calm: ["目标停止活动，确认击破。", "敌机失去战斗能力。"],
      aggressive: ["下一台！", "这就是你们的下场！"],
      cautious: ["敌机击破，继续警戒。", "不要大意，还有敌人。"],
      idealist: ["已经够了，不要再有人牺牲。", "目标击破……愿战斗尽快结束。"],
    },
    miss: {
      calm: ["修正射击参数。"],
      aggressive: ["别躲！"],
      cautious: ["射击未命中，重新锁定。"],
      idealist: ["下一次一定要阻止他。"],
    },
  };
  Object.assign(lines, {
    defeat: {
      calm: ["机体失去战斗能力，执行紧急脱出！", "撑不住了……后面交给你们。"],
      aggressive: ["可恶，居然在这种地方……！"], cautious: ["致命损伤，立即脱出！"],
      idealist: ["大家……一定要平安回去。"],
    },
    allyKill: {
      calm: ["击破确认，继续保持警戒。", "干得好，我来掩护你。"],
      aggressive: ["漂亮！下一台交给我！"], cautious: ["别冒进，我会掩护你的侧翼。"],
      idealist: ["谢谢你的掩护，我们一起前进。"],
    },
    allyLoss: {
      calm: ["友机失去联络，掩护脱出人员！", "收到求救信号，附近单位提供掩护。"],
      aggressive: ["可恶！我会替你讨回来的！"], cautious: ["友机被击破，保持阵形，准备救援！"],
      idealist: ["回答我！千万不要放弃！"],
    },
  });
  const additional = {
    strategic: { attack: ["敌军阵形出现缺口，集中火力。", "按预定射界展开攻击。"], hit: ["重新部署，避免重复损失。"], kill: ["目标排除，推进下一阶段。"], miss: ["修正火控参数，重新计算。"] },
    sarcastic: { attack: ["这种差事还真是麻烦啊。", "喂，别怪我没提醒你。"], hit: ["哎呀，这可真够受的。"], kill: ["看来运气站在我这边。"], miss: ["好吧，当我没说。"] },
    strict: { attack: ["遵照命令，执行攻击！"], hit: ["保持纪律，不许后退！"], kill: ["肃清完成，继续执行任务。"], miss: ["不得浪费弹药！"] },
    zealous: { attack: ["为了我们的理想，前进！"], hit: ["信念绝不会被击溃！"], kill: ["胜利属于我们的事业！"], miss: ["下一次绝不会失手！"] },
    proud: { attack: ["见识一下真正的实力！"], hit: ["竟敢伤到我的机体！"], kill: ["你还差得远呢。"], miss: ["这不过是试探。"] },
    obsessive: { attack: ["计划已经开始，谁也无法阻止！"], hit: ["绝不能让研究付诸东流！"], kill: ["终于，结果得到了证明！"], miss: ["不可能……重新调整！"] },
    empathetic: { attack: ["请退开，我不想伤害你。"], hit: ["为什么一定要互相伤害？"], kill: ["又有一个生命消失了……"], miss: ["请不要再靠近了。"] },
  };
  for (const [trait, events] of Object.entries(additional))
    for (const [event, phrases] of Object.entries(events)) lines[event][trait] = phrases;
  const taunts = {
    calm: ["你的动作已经被看穿了。", "你确定还要继续吗？"],
    aggressive: ["就这点本事？", "来啊，让我看看你能撑多久！"],
    cautious: ["你的破绽太明显了。", "我不会落入你的圈套。"],
    idealist: ["现在撤退还来得及！", "不要再让战争夺走更多生命！"],
    strategic: ["你的下一步，我已经算到了。", "你的阵形正在崩溃。"],
    sarcastic: ["你是来打仗，还是来表演的？", "这种水平也敢冲上来？"],
    strict: ["立即投降，停止无谓抵抗！", "你们的抵抗毫无意义！"],
    zealous: ["你们阻挡不了我们的理想！", "准备见证我们的胜利吧！"],
    proud: ["记住击败你的人是谁！", "你还不配当我的对手！"],
    obsessive: ["谁也不能阻止我的计划！", "你不过是实验中的障碍！"],
    empathetic: ["请离开战场，我不愿伤害你。", "我们真的必须战斗吗？"],
  };
  const replies = {
    calm: ["少说废话，继续战斗。", "我会用行动回答你。"],
    aggressive: ["有本事就来试试！", "闭嘴！我要打倒你！"],
    cautious: ["别想用这种话动摇我。", "我不会轻易上当。"],
    idealist: ["我也有必须守护的东西！", "我不会放弃自己的信念！"],
    strategic: ["你的挑衅不会改变战局。", "看来你还没看清局势。"],
    sarcastic: ["这台词你练习了多久？", "说完了吗？轮到我了。"],
    strict: ["保持通讯纪律！", "敌方心理战无效。"],
    zealous: ["我们的意志绝不会屈服！", "胜负还没有决定！"],
    proud: ["你才该记住我的名字！", "别太得意了！"],
    obsessive: ["你根本不了解我的目标！", "绝不会让你得逞！"],
    empathetic: ["我也不愿如此，但我不能退。", "如果可以，我希望这场战斗停止。"],
  };
  const transportLines = {
    board: {
      calm: ["收到，机库已准备好。", "确认入库，保持待命。"],
      aggressive: ["赶紧进来，下一波还等着我们！"],
      cautious: ["减速接近，确认停泊锁定。"],
      idealist: ["欢迎回来，大家平安就好。"],
      strategic: ["已为你预留整备位置。"],
      sarcastic: ["终于想起来回来补给了？"],
      strict: ["按规程入库，不许抢道！"],
      zealous: ["整备完毕后继续为理想而战！"],
      proud: ["能搭乘本舰是你的荣幸。"],
      obsessive: ["不要碰我的设备，按指定位置停靠！"],
      empathetic: ["辛苦了，先回来休息吧。"],
    },
    launch: {
      calm: ["出击许可，祝你顺利。"],
      aggressive: ["去吧，狠狠教训他们！"],
      cautious: ["确认周边安全，允许出击。"],
      idealist: ["一定要平安回来。"],
      strategic: ["按预定路线出击，我方负责支援。"],
      sarcastic: ["别把机体弄坏了再回来啊。"],
      strict: ["出击许可，严格执行命令！"],
      zealous: ["带着我们的信念出击吧！"],
      proud: ["让敌人见识本舰的战力！"],
      obsessive: ["别偏离我指定的作战路线！"],
      empathetic: ["注意安全，我等你回来。"],
    },
    preload: {
      calm: ["编组确认，已安排专属机库。"],
      aggressive: ["终于等到你了，准备大干一场！"],
      cautious: ["预先搭载确认，请检查整备状态。"],
      idealist: ["这次也请大家互相照应。"],
      strategic: ["按照既定作战编组，待命。"],
      sarcastic: ["你的专用座位早就留好了。"],
      strict: ["编组人员按指定位置待命！"],
      zealous: ["全员集结，胜利就在前方！"],
      proud: ["这是精锐部队的集结。"],
      obsessive: ["各项准备必须完全符合计划。"],
      empathetic: ["欢迎加入本舰，彼此照顾吧。"],
    },
    passengerBoard: {
      calm: ["收到，准备入库。"], aggressive: ["我会很快再出击！"],
      cautious: ["了解，正在检查停泊程序。"], idealist: ["谢谢接应。"],
      strategic: ["明白，等待下一步指令。"], sarcastic: ["终于能歇口气了。"],
      strict: ["遵命，执行归舰程序。"], zealous: ["休整后继续战斗！"],
      proud: ["记得好好整备我的机体。"], obsessive: ["我的机体不许擅自改动！"],
      empathetic: ["谢谢，我回来了。"],
    },
    passengerLaunch: {
      calm: ["了解，开始出击。"], aggressive: ["交给我吧！"],
      cautious: ["确认，正在离舰。"], idealist: ["我会保护大家。"],
      strategic: ["按计划行动。"], sarcastic: ["好好看着我的表现吧。"],
      strict: ["收到，出击！"], zealous: ["为了胜利！"],
      proud: ["看好了！"], obsessive: ["终于轮到我了。"],
      empathetic: ["我会尽力平安回来。"],
    },
  };
  function transport({event, speaker, target, sequence=0, preloaded=false}={}) {
    if (!speaker || !target || !["board","launch","preload"].includes(event)) return null;
    const pilot=speaker.pilot || {};
    const trait=personality(pilot);
    const seed=hash([speaker.id,target.id,event,sequence].join(":"));
    if ((seed >>> 16) % 2) return null;
    const customPool=customLines(pilot,event);
    const pool=customPool || transportLines[event][trait];
    const text=pool[(customPool ? seed >>> 8 : seed) % pool.length];
    return { event, speakerId:speaker.id, targetId:target.id,
      pilotName:pilot.name || speaker.name || speaker.id,
      personality:trait, faction:pilot.originFaction || pilot.faction || speaker.faction || "PMC",
      text, sequence, preloaded, transport:true, ...(customPool ? {customText:true} : {}) };
  }
  function transportReply({event,speaker,target,sequence=0}={}) {
    if (!speaker || !target || !["board","launch","preload"].includes(event)) return null;
    const pilot=speaker.pilot || {};
    const trait=personality(pilot);
    const seed=hash([speaker.id,target.id,event,"reply",sequence].join(":"));
    if (seed % 3 !== 0) return null;
    const replyEvent=event === "launch" ? "passengerLaunch" : "passengerBoard";
    const customPool=customLines(pilot,replyEvent);
    const pool=customPool || transportLines[replyEvent][trait];
    return {event:"transportReply",speakerId:speaker.id,targetId:target.id,
      pilotName:pilot.name || speaker.name || speaker.id,
      personality:trait,faction:pilot.originFaction || pilot.faction || speaker.faction || "PMC",
      text:pool[(customPool ? seed >>> 8 : seed) % pool.length],sequence,transport:true,...(customPool ? {customText:true} : {})};
  }
  const factionLines = {
    EFSF: { attack: "联邦军各机，按命令开火！" },
    ZEON: { attack: "为了吉翁，进攻！" },
    TITANS: { attack: "提坦斯执行肃清任务。" },
    AEUG: { attack: "奥古各机，掩护同伴！" },
    NEO_ZEON: { attack: "新吉翁的意志不会动摇！" },
  };
  const personalities = ["calm", "aggressive", "cautious", "idealist", "strategic", "sarcastic", "strict", "zealous", "proud", "obsessive", "empathetic"];
  const backgrounds = { veteran: "老兵", rookie: "新兵", survivor: "幸存者", officer: "军官" };
  function hash(value) {
    let h = 2166136261;
    for (const c of String(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    return h >>> 0;
  }
  function personality(pilot) {
    const explicit = pilot?.personality || pilot?.personalityId;
    return personalities.includes(explicit) ? explicit
      : personalities[hash(pilot?.id || pilot?.name || "anonymous") % personalities.length];
  }
  function customLines(pilot,event) {
    const pool=pilot?.custom && pilot.personality === "custom" && !pilot.ace && !pilot.aceId ? pilot.dialogue?.[event] : null;
    return Array.isArray(pool) && pool.length ? pool : null;
  }
  function generate({ event, speaker, target, sequence = 0, faction } = {}) {
    if (!speaker || !event || !(lines[event] || event === "taunt" || event === "reply")) return null;
    const pilot = speaker.pilot || {};
    const trait = personality(pilot);
    const background = typeof pilot.background === "string" ? pilot.background.slice(0, 160) : "";
    const identity = pilot.id || pilot.name || speaker.id;
    const seed = hash([identity, target?.id, event, sequence].join(":"));
    if (event !== "reply" && (seed >>> 16) % 2) return null;
    // Suppress most routine remarks to avoid flooding the battlefield and transcript.
    if (event === "taunt" && seed % 5 !== 0) return null;
    if (event === "reply" && seed % 3 !== 0) return null;
    if (!["kill", "defeat", "allyKill", "allyLoss", "taunt", "reply"].includes(event) && seed % 4 !== 0) return null;
    const customPool = customLines(pilot,event);
    const pool = customPool || (event === "taunt" ? taunts[trait] : event === "reply" ? replies[trait] : (lines[event][trait] || lines[event].calm));
    const factionId = pilot.originFaction || faction || pilot.faction || speaker.faction;
    const text = !customPool && factionLines[factionId]?.[event] && seed % 5 === 0
      ? factionLines[factionId][event] : pool[(customPool ? seed >>> 8 : seed) % pool.length];
    return { event, speakerId: speaker.id, targetId: target?.id || null,
      pilotName: pilot.name || speaker.name || speaker.id,
      personality: trait, background, faction: factionId || "PMC", text, sequence,
      publicToOpponent: event === "taunt" || event === "reply", ...(customPool ? {customText:true} : {}) };
  }
  function format(record) {
    return `→ [战场对话][${record.faction}][${record.pilotName}]${record.unitName ? "[" + record.unitName + "]" : ""}「${record.text}」`;
  }
  return { generate, format, personality, personalities, backgrounds, taunts, replies, transport, transportReply };
})();
if (typeof module !== "undefined") module.exports = BattleDialogue;
