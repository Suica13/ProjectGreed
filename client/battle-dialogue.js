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
    if (!speaker || !event || !lines[event]) return null;
    const pilot = speaker.pilot || {};
    const trait = personality(pilot);
    const background = typeof pilot.background === "string" ? pilot.background.slice(0, 160) : "";
    const identity = pilot.id || pilot.name || speaker.id;
    const seed = hash([identity, target?.id, event, sequence].join(":"));
    // Suppress most routine remarks to avoid flooding the battlefield and transcript.
    if (event !== "kill" && seed % 4 !== 0) return null;
    const pool = lines[event][trait];
    const factionId = pilot.originFaction || faction || pilot.faction || speaker.faction;
    const text = factionLines[factionId]?.[event] && seed % 5 === 0
      ? factionLines[factionId][event] : pool[seed % pool.length];
    return { event, speakerId: speaker.id, targetId: target?.id || null,
      pilotName: pilot.name || speaker.name || speaker.id,
      personality: trait, background, faction: factionId || "PMC", text, sequence };
  }
  function format(record) {
    return `[战场对话][${record.faction}][${record.pilotName}]「${record.text}」`;
  }
  return { generate, format, personality, personalities, backgrounds };
})();
if (typeof module !== "undefined") module.exports = BattleDialogue;
