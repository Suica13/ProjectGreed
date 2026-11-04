"use strict";
// Report runtime data; this file does not define a second set of balance rules.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Classes = require("../shared/weapon-classes.js");
const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "docs/rules/combat.md");
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const code = value => "`" + String(value).replaceAll("`", "") + "`";
const cell = value => String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", "<br>");
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.keys(value).sort(compare).map(key => [key, stable(value[key])]));
  return value;
}
function table(headers, rows) {
  return [headers, headers.map(() => "---"), ...rows]
    .map(row => "| " + row.map(cell).join(" | ") + " |\n").join("") + "\n";
}
const explanations = {
  pilot_buff: "强化驾驶员指定属性或经验倍率，不是直接将最终伤害/命中率乘同一倍率。持续结束后开始冷却。机动影响移动及攻击轮数，不产生AP预算。",
  resupply: "消耗自身10%最大EN（原2 AP仅保留配置），为相邻目标格内全部友军恢复各自50%最大EN，不超过上限；每己方回合一次。",
  irradiation: "按方向直线攻击，沿途每台单位含友军判定一次；判定射程与固定长度原版演出解绑。有requiresSfsMS时须搭载MS。",
  beam_diffusion: "指定地格生成区域，攻击射线经过区域时光束伤害×0.5，同类区域不重复叠加。",
  smoke: "当前位置产生烟雾，区域内所有单位受到远程攻击时来袭命中×0.75，不叠加，格斗不受影响。",
  minovsky: "范围内防守单位回避系数×1.25、反侦测距离+5格。额外命中×0.75当前仅匹配导弹或旧special.type=mortar；现行普通迫击炮为blast，不匹配这项额外惩罚。",
  recon: "扫描/声呐标记敌人；摄像枪在选定地格生成临时视野/雷达。waterOnly、范围、持续和冷却按各条参数执行。",
  flight: "切换起飞/降落，不消耗AP；检查必需部位和合法降落位置，宇宙中不能切换。",
  fullboost: "增加移动力和反应系数，持续结束后进入冷却；搭载中继续计时。",
  overboost: "增加移动力和反应系数；从下一己方回合起按配置扣最大耐久百分比，搭载中生效且可能致死。",
  overdrive: "EXAM/HEADS切换强化形态，按配置持续并扣HP/EN；耐久最低保留1后强制结束，头部等条件损坏也可强制退出。强化形态属性见对应单位。",
  escape: "按source.mode处理原机并按spawn生成脱出机；保留身份/控制关系，资源继承、恢复和部位修复由source/spawn分别决定。",
  transform: "按source变形/部署、映射套件和继承资源；部署形态不能移动，已有载员或部位损坏会限制变形。",
  armor_purge: "按source切换爆甲形态，继承资源比例后加算配置恢复，不默认补满；AP仅保留数值，是否结束本次行动仍看consumeAction。",
  repair: "按配置恢复目标友军HP、EN和护盾，不自动修复破损部位。",
};
const typeNames = {
  pilot_buff: "驾驶员强化", resupply: "主动EN补给", irradiation: "光束照射", beam_diffusion: "光束扰乱膜",
  smoke: "烟雾", emp: "EMP", minovsky: "米诺夫斯基粒子", recon: "侦察/摄像枪/声呐", flight: "飞行切换",
  fullboost: "全力推进", overboost: "超限喷射", overdrive: "EXAM/HEADS", escape: "脱出",
  transform: "变形/部署", armor_purge: "爆甲", repair: "主动维修",
};
const parameterLabels = {
  minRange: "最小施放范围", range: "施放范围", radius: "影响半径", actionCost: "AP参考值",
  enCost: "固定EN费用", enCostPercent: "最大EN费用%", enPercent: "系统启动EN%",
  duration: "持续己方回合", durationTurns: "持续己方回合", durationRounds: "持续队伍阶段",
  cooldownTurns: "冷却己方回合", moveBonus: "移动加值", mobilityMultiplier: "反应系数倍率",
  hpDrainPercent: "每己方回合扣最大HP%", enDrainPercent: "每己方回合扣最大EN%",
  airAdaptability: "空中适应性%", areaSight: "临时视野半径", areaRadar: "临时雷达半径", baseHit: "基础命中%",
};
const pilotLabels = {shooting:"射击",melee:"格斗",defense:"防御",accuracy:"命中",reaction:"反应",speed:"机动",leadership:"指挥",awakening:"觉醒"};
function render(catalog) {
  const config = catalog.conversionRules;
  const sourceFiles = ["shared/rules.js", "shared/automatic-fire.js", "shared/unit-skills.js", "shared/weapon-classes.js",
    "shared/pilots.js", "shared/hangars.js", "shared/conversion-rules.cjs", "tools/weapon_policy.py", "tools/export-combat-rules.cjs"];
  const ruleSources = sourceFiles.map(file => [file, fs.readFileSync(path.join(ROOT, file), "utf8")]);
  const pilots = JSON.parse(fs.readFileSync(path.join(ROOT, "shared/pilots.json"), "utf8"));
  const pilotSkills = new Map();
  for (const skill of [...(pilots.customSkills || []), ...(pilots.aces || []).flatMap(ace => ace.skills || [])])
    if (skill.type === "pilot_buff") pilotSkills.set(skill.id, skill);
  const skills = [...Object.values(catalog.models).flatMap(model => model.skills || []), ...pilotSkills.values()];
  const commonRules = {};
  for (const [type] of Object.entries(explanations)) {
    commonRules[type] = {};
    for (const key of Object.keys(parameterLabels)) {
      const values = [...new Set(skills.filter(skill => skill.type === type && skill[key] !== undefined).map(skill => skill[key]))];
      if (values.length) commonRules[type][key] = values.sort((a, b) => a - b);
    }
  }
  const commonParameters = type => Object.entries(commonRules[type]).map(([key, values]) =>
    parameterLabels[key] + "：" + values.join(" / ")).join("；") || "按对应机制配置";
  const policy = fs.readFileSync(path.join(ROOT, "tools/weapon_policy.py"), "utf8");
  const rangeBlock = policy.match(/RANGES = \{([\s\S]*?)\}/)[1];
  const baseRanges = [...rangeBlock.matchAll(/"(\w+)": \((\d+), (\d+)\)/g)]
    .map(([, kind, min, max]) => [kind, Number(min), Number(max)]);
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify(stable([
    ruleSources, config.weapons, config.weaponClasses, commonRules, [...pilotSkills.values()],
  ]))).digest("hex");
  const out = ["# 现行武器与技能规则", "",
    "> 按武器类型和技能机制整理的现行规则，由 tools/export-combat-rules.cjs 维护和生成。", "",
    "规则指纹：" + code(fingerprint) + "。", "",
    "## 数值取整", "",
    "驾驶员成长及强化后的八项属性四舍五入为整数，兼容旧存档精确的小数成长值。机体属性、AP、移动格数、武器命中/范围/EN及最终命中率取整，伤害仍按25点取整。倍率、概率、动画时间和坐标保留精度。", "",
    "## 命中统一规则", "",
    "已指定类型以分类baseHit覆盖原MOD命中，分类accuracy=1，旧类型命中惩罚不重复叠加；单发及分段命中同步覆盖。其他光束及其他类型暂保留源值，照射技能保留60%。", "",
    "舰炮特性：战舰的加农炮、光束炮、迫击炮额外乘weapons.shipCannonAccuracy（当前0.85）；不包含对空炮、机枪、导弹、航空炸弹。机体命中系数、目标倍率、驾驶员及人工差值独立计算。", "",
    "## 维护方式", "",
    "- 刷新：`npm run docs:combat-rules`；核对是否过时：`npm run docs:combat-rules -- --check`。普通客户端构建自动刷新。",
    "- 通用倍率/范围改 shared/conversion-rules.json；分类改 shared/weapon-classes.js；轮数/交替流程改 shared/automatic-fire.js。",
    "- 单位与武器源数据改 assets/units/*/unit.json、assets/weapons.json；人工相对差值保存在 shared/editor-adjustments.json，在全局换算之后应用。导入器的政策也需同步维护。",
    "- 技能执行改 shared/unit-skills.js、shared/rules.js；驾驶员技能数据改 shared/pilots.json。执行逻辑改变时同时维护本生成器中的文字说明；改动后刷新MD、审阅差异、执行相关检查并构建客户端。",
    "- MD是查询与管理清单，不是第二份可执行配置。旧description可能保留旧AP/射程，本文的配置表始终以现行结构化规则为准。", "",
    "## 射程与自动交火规则", "",
    "1. 射程按单位占地间曼哈顿格距判断，包含最小/最大端点；炮塔射界、目标类型、部位、EN、驾驶员门槛、视野与索敌独立检查。",
    "2. 分类基础范围-1时继承源值；分类range不是1时先乘该倍率并四舍五入。最大射程再追加分类rangeBonus与通用额外射程，狙击用sniperRangeBonus替代普通rangeBonus。最后统一乘weapons.range，向上取整且至少1格，再应用人工差值及校验。最小射程不追加最大射程奖励。",
    "3. 攻击与反击自动使用所有符合射程且当前可用的武器，按既有类型轮数执行完整原MOD发射链：光束枪、光束喷枪3轮；光束步枪、实弹步枪、机枪、火箭筒、光束火箭筒、加农炮2轮；导弹及其他1轮。腕部武器、头部火神炮、铁拳、驾驶员门槛武装和格斗默认1轮；单件武器的attackRounds可在开发者页覆盖为0～20整数，驾驶员门槛武装仍受每回合次数上限限制、不按AP筛选或扣AP，也不允许手动选武器。EN、部位、弹药、冷却、驾驶员要求仍校验。按武器槽顺序在射击/格斗阶段内执行，EN不足时跳过该武器并继续检查后续武器。",
    "4. 进攻本轮→反击本轮→进攻下一轮→反击下一轮；同侧单位可以并行。一方结束后另一方继续剩余轮次。",
    "5. 全部射击结束后才开始格斗。进攻单位靠近一次，使用首个格斗后由防守方以其首个格斗武器回击一次，再执行进攻方剩余格斗；完成自身格斗且接受回击后才返回。防守方对每名实际进行格斗的进攻者分别回击一次，不会主动格斗只射击的敌人；仍检查存活、EN、部位、射程及驾驶员要求。实际网格位置不变。",
    "6. 冲撞仅在格斗距离内且没有其他可用格斗武器时兜底；有射击武器不影响兜底，正常格斗后不额外冲撞。",
    "7. 普通攻击、反击、格斗接近均不消耗AP。玩家只选择目标和应战方式，服务端重新生成武器序列，拒绝手动武器计划。实际发射时扣一次EN；取消计划不扣资源。死亡或目标失效取消未发起攻击，已发射弹丸继续判定。所有技能、出击、搭乘和占领不再校验或扣除AP；AP数值保留供配置和后续规则使用，玩家武装卡片隐藏AP。技能自身的结束行动、冷却、EN和次数限制保留。",
    "8. 驾驶员门槛武装每回合最多1次，须满足pilotRequirements；腕部射击武器和驾驶员门槛武装每回合限用1次；无门槛格斗取消每回合一次限制，每次交火按配置轮数执行。防守方首个格斗对每名实际格斗进攻者分别回击1次，是次数限制的例外，每次支付EN。具有复数非冲撞格斗的套件，保留一把基础格斗不追加门槛，其余无原门槛的追加格斗要求格斗≥125；原有门槛保留，冲撞不计数也不追加门槛。防守方选择首个实际可用的格斗武器，避免被无资格使用的前置招式阻断。队伍交接刷新每回合标记，maxUses继续限制总弹药。",
    "9. 小队同格最多6台、6容量点，采用自动三角形列队，不区分前后排，不提供手动站位调整。射击在存活合法目标中均匀选择。1至6台回避加成依次为12、10、7、5、2、0个百分点。攻击目标为整队，格斗优先对位；单机操作仅提交该成员。",
    "10. 攻击结束保留最后持武器和显隐索引，回避后保持战斗朝向；变形/换装时重置不适用的显示状态。", "",
    "- 穿甲分量（beamAP/shellAP/meleeAP/meleeBeamAP/meleeShellAP）默认忽略50%的对应百分比抗性：有效抗性=原抗性×(1-armorPiercingIgnore)。固定减伤、护盾覆盖和最终减伤照常计算；单武器值覆盖weapons.armorPiercingIgnore，全局与特例均可在开发者页面维护。",
    "- 原生衰减贯穿弹丸（ProjectileAttackTimes>1且ProjectileAttackTimesDamageModifier<1）：额外穿甲伤害=对应基础光束/实弹分量×原生次数×weapons.penetrationDamagePerCount（默认15%）；保留已有穿甲分量，最终按25取整。不执行穿透多目标判定。格斗多段次数不套此规则。",
    "- 格斗动画与斩击特效逐段沿原MOD动作链读取；B段不再轮流套用通用A段特效。",
    "- 强制脱出：父格纳库被击毁而弹出的单位，记录forcedExitRound；仅本回合实际攻击轮数=floor(可用轮数×0.5)，最低0，进攻与反击相同。已排队但未开始的轮次同样重新检查。主动出击不附带该轮数惩罚。单位变形／爆甲保留标记，下一回合自动失效。AP不再减半。", "",
    "- AP仅为配置参考值：不换算、不产生运行时余额或预算、不参与动作。AP专用EMP不进入运行目录，原武器AP减益不再编译；不替换成其他惩罚。", "",
    "### AP参考字段", "",
    "单位stats.actionPoints、武器/技能actionCost仅作为原始配置参考，不受机动、驾驶员、类型或全局倍率影响。开发者可编辑参考值；AP预算、扣费、返还、回合恢复和AP减益均已移除。", "",
    "- 移动控制区：进入敌军相邻格并停下按普通地形费用；从敌军相邻格继续移动，该步至少消耗3格移动力。不叠加多名敌军的惩罚，保留地形、适应性和补给线修正。", "",
    "### 全局武器配置", "", table(["参数", "当前值"], Object.entries(config.weapons).map(([key, value]) => [key, value])),
    "- 弹速：除照射与迫击炮外按原MOD ProjectileSpeed×projectileSpeed换算，当前为1/10；集束子弹独立换算。不再叠加旧演出弹速倍率；航空炸弹保留重力投放时序，牵引鞭保留伸缩动作。", "",
    "### 导入基础射程", "",
    "下表是移植政策的基础值，之后仍应用分类覆盖、额外射程、全局倍率与人工差值。它不是每件武器最终射程的统一承诺。",
    table(["基础类型", "最小射程", "最大射程"], baseRanges.map(([kind, min, max]) => [Classes.labels[kind] || kind, min, max])),
    "- 导入层狙击最大射程先加2；蓄力狙击由基础狙击范围按现行政策扩大。运行时再应用sniperRangeBonus，替代普通额外射程。",
    "- 战舰主炮导入最大射程在加农炮基础上+3、迫击炮基础上+1；防空用途不套这项主炮延伸。",
    "- 类型基础范围为继承时，沿用对应源武器的移植范围；不会把同类所有武器强制改成同一个范围。", "",
    "- 加农炮分类rangeBonus=2，在当前全局射程×0.5后相当于最终最大射程+1格；最小射程不变。",
    "### 类型规则", "",
    "基础值-1代表继承。倍率在人工差值之前执行；可用性由EN、冷却、弹药和驾驶员门槛共同决定，不再按武器分类设置固定轮数。", "",
    table(["分类/ID", "使用次数", "伤害/命中/EN倍率", "射程倍率/最大加值", "基础EN/命中", "基础最小/最大范围"],
      Object.entries(Classes.labels).map(([id, name]) => {
        const rule = config.weaponClasses[id];
        return [name + " " + code(id), String(Classes.rounds({weaponClass:id,type:["melee","ram"].includes(id)?"melee":"shell"}))+"轮，受EN与次数限制",
          [rule.damage, rule.accuracy, rule.en].join(" / "), rule.range + " / " + rule.rangeBonus,
          [rule.baseEN, rule.baseHit].join(" / "), rule.minRange + " / " + rule.maxRange];
      })),
    "## 技能共用条件与计时", "",
    "- 通常须在己方行动阶段，单位存活且在地图上、未搭载、无待确认移动或攻击计划，战局结束或部署阶段不能发动。一般技能要求尚未结束行动；驾驶员技能可对已行动单位使用，但仍受其余条件约束。passive不可主动发动。",
    "- actionCost仅保留AP数值，不校验或扣费；consumeAction=true仍独立结束本次行动。enCost优先作为固定消耗，无该字段时才用enCostPercent×最大EN；EXAM类使用enPercent。",
    "- game.round每次队伍交接+1；durationRounds=2相当于一次双方循环。durationTurns、cooldownTurns为己方回合；duration是推进/系统的己方回合计数。",
    "- 驾驶员强化与全力推进在效果结束后开始冷却；多数其他cooldownTurns从发动时起计。maxUses保留实际次数（99不写成无限）。", "",
    table(["技能类型", "效果/特殊规则", "现行公共参数"], Object.entries(explanations).map(([id, text]) => [typeNames[id] + " " + code(id), text, commonParameters(id)])),
    "参数列按技能类型汇总当前取值，同名字段的多个取值表示规则存在不同规格，不表示可以自由组合。省略具体单位、套件、形态目标和逐武器伤害。", "",
    "### 驾驶员技能规则", "",
    "自定义驾驶员6级可选择一项技能；ACE使用其预设技能。主动增益通常消耗100 EN，持续1己方回合，效果结束后冷却5己方回合。下表直接读取当前技能定义。",
    table(["技能", "属性/经验效果", "EN/AP", "持续/冷却"], [...pilotSkills.values()].map(skill => [
      skill.localization?.zh?.name || skill.name,
      [...Object.entries(skill.statMultipliers || {}).map(([key, value]) => (pilotLabels[key] || key) + "属性×" + value),
        ...(skill.experienceMultiplier && skill.experienceMultiplier !== 1 ? ["经验×" + skill.experienceMultiplier] : [])].join("；"),
      (skill.enCost ?? 0) + " EN / " + (skill.actionCost ?? 0) + " AP",
      (skill.durationTurns ?? 0) + "己方回合 / 结束后" + (skill.cooldownTurns ?? 0) + "己方回合",
    ])), "",
    "## 状态与被动能力", "",
    "- 燃烧命中后覆盖持续时间：现行为3个己方回合，每个受影响单位的己方回合开始只扣一次5%最大耐久，SP百分比防护减免该伤害；按25取整，不按秒扣。",
    "- 已移除电热鞭/硬直和EMP的AP减益，不记录下回合AP惩罚。",
    "- 迫击炮是独立攻击类技能，每回合一次，不能反击，爆炸半径0，仅命中目标格内敌军；一遍齐射中每发炮弹落地时同时判定该格所有敌军，选中目标先被击毁也不会取消剩余炮弹；照射、迫击炮和蓄力狙击发动后不能普通攻击或取消攻击类技能计划。所有主动技能每回合一次，变形与部署及解除操作共享一次标记。",
    "- 蓄力狙击先锁定，下次己方回合开始重新验证目标和射程后射击，跟踪目标单位而非仅旧格。瞄准标记单独绘制，发射弹丸沿用对应基础狙击武器的贴图及弹速换算，不将Sniper_Aim辅助弹用于飞行演出。狙击冷却计数2，每次己方回合开始减1，大于0时不可用。",
    "- 核弹一次发动只发射一枚、只演出一次爆炸，范围内敌军分别判定；半径、形状和使用次数依该武器配置执行。",
    "- 驾驶员射击、格斗、命中、反应每点修正0.3125个百分点，防御每点减少0.3125个百分点承伤倍率；以100为基准。机动移动每点修正0.625%，轮数系数每点修正0.25%（200点为125%）。觉醒达到100后命中、回避各加10个百分点，不再额外提高普通伤害。指挥范围保持每25点变化1格，效果每25点变化1.25个百分点。",
    "- 普通射击轮数=round(基础轮数×机体机动/100×驾驶员机动系数)，至少1轮；格斗、技能、腕部武器、头部火神炮和驾驶员门槛武器限1轮，武器每回合次数上限仍有效。舰毁强制脱出在此之后向下折半，允许0轮。",
    "- 浮游炮/有线炮门槛查pilotRequirements；除INCOM外，觉醒不足100时伤害×觉醒/100，100以上为×[1+(觉醒-100)×remote.awakeningScale]。INCOM不套此觉醒伤害成长；单元数/发数由浮游炮配置决定。",
    "- 指挥：steps=trunc((领导力-100)/25)，范围=max(1,3+steps)，效果=max(0,0.10+0.01×steps)。攻击加最终射击/格斗伤害，防御减最终伤害，通信提高命中/回避；同类取最大不叠加。",
    "- I立场拦截远程光束，光束格斗绕过；普通/贯穿光束分别按reduction/piercingReduction减伤，消耗场耐久，下限为capacity×minimumRatio，己方回合恢复recoveryPercent。",
    "- 被动补给光环、自动维修按各自参数在己方回合结算，重叠补给光环不叠加；主动补给不是补给光环。学习型电脑使用机体pilotExperienceMultiplier，与其他经验系数相乘。",
    "- 封闭格纳库载员己方回合恢复25%HP、50%EN、25%护盾并随机修复最多两个部位；SFS暴露载员不套此维修。符合占地与容量要求的SFS可组成小队，整队攻击包含同控制者的暴露乘客；新成员加入已下达普通攻击计划的小队时，自动追加自身可用攻击，不重置已行动成员。主动出击不扣AP；母舰死亡紧急退出仅本回合攻击轮数向下折半，允许0，AP数值不变。", "",
    "## 代码索引", "",
    "- [换算配置](shared/conversion-rules.json)、[换算实现](shared/conversion-rules.cjs)、[人工差值](shared/editor-adjustments.json)",
    "- [分类](shared/weapon-classes.js)、[轮数/交火](shared/automatic-fire.js)、[共享战斗规则](shared/rules.js)",
    "- [机体技能](shared/unit-skills.js)、[驾驶员技能](shared/pilots.json)、[驾驶员逻辑](shared/pilots.js)、[格纳库](shared/hangars.js)",
    "- [导入射程政策](tools/weapon_policy.py)、[文档生成器](tools/export-combat-rules.cjs)", ""];
  return {text: out.join("\n").replace(/\]\((shared|tools|client|assets)\//g, "](../../$1/"), stats: {weaponTypes: Object.keys(Classes.labels).length, skillTypes: Object.keys(explanations).length, pilotSkills: pilotSkills.size}};
}
function writeReport(catalog, {check = false} = {}) {
  const report = render(catalog);
  const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, "utf8") : null;
  if (check && current !== report.text) throw Error("docs/rules/combat.md 已过时，请运行 npm run docs:combat-rules");
  if (!check && current !== report.text) fs.writeFileSync(OUTPUT, report.text, "utf8");
  return report.stats;
}
module.exports = {render, writeReport};
if (require.main === module) {
  const catalog = require("./load-catalog.cjs").loadCatalog();
  console.log(JSON.stringify(writeReport(catalog, {check: process.argv.includes("--check")})));
}
