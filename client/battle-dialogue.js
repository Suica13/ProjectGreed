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
  function generate({ event, speaker, target, sequence = 0, faction } = {}) {
    if (!speaker || !event || !(lines[event] || event === "taunt" || event === "reply")) return null;
    const pilot = speaker.pilot || {};
    const trait = personality(pilot);
    const background = typeof pilot.background === "string" ? pilot.background.slice(0, 160) : "";
    const identity = pilot.id || pilot.name || speaker.id;
    const seed = hash([identity, target?.id, event, sequence].join(":"));
    // Suppress most routine remarks to avoid flooding the battlefield and transcript.
    if (event === "taunt" && seed % 5 !== 0) return null;
    if (event === "reply" && seed % 3 !== 0) return null;
    if (!["kill", "taunt", "reply"].includes(event) && seed % 4 !== 0) return null;
    const pool = event === "taunt" ? taunts[trait] : event === "reply" ? replies[trait] : lines[event][trait];
    const factionId = pilot.originFaction || faction || pilot.faction || speaker.faction;
    const text = factionLines[factionId]?.[event] && seed % 5 === 0
      ? factionLines[factionId][event] : pool[seed % pool.length];
    return { event, speakerId: speaker.id, targetId: target?.id || null,
      pilotName: pilot.name || speaker.name || speaker.id,
      personality: trait, background, faction: factionId || "PMC", text, sequence,
      publicToOpponent: event === "taunt" || event === "reply" };
  }
  function format(record) {
    return `[战场对话][${record.faction}][${record.pilotName}]「${record.text}」`;
  }
  return { generate, format, personality, personalities, backgrounds, taunts, replies };
})();
if (typeof module !== "undefined") module.exports = BattleDialogue;
