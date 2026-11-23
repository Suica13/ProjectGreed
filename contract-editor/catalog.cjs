"use strict";
const Contract = require("../shared/contract-mode.js");
const Contacts = require("../shared/contact-tasks.js");
const Model = require("./model.js");
const commonRules = `【开放范围】当前开放N1～N6和0079T1／0079T2，N7～N9已删除，其余年代暂不开放。每局普通事件数等于N级，七种基础类型不重复抽取。地形和目标位置每局随机。
【编组额度】0079T2各难度在0079T1基础上乘1.5，N1从3000C起步；后续0087T1／0087T2／0093T1依次再乘1.25，仅最终结果按500四舍五入。舰船上限不随年代变化。
【环境与阶段】随机敌人必须可由科技树解锁，并适应当前地面／宇宙环境；事件指定单位除外。N1～N3仅抽前期，N4～N6仅抽后期，不混用年代。T1以基础科技之后第3项主线科技为后期起点（联邦V计划数据回收），T2以第4项主线科技为后期起点（联邦吉姆改）；单位按含前置的解锁门槛归类。运输机、固定设施、委托指定目标有各自特例。
【驻军】基础驻军为3＋floor((N−1)/3)台，初始在所属事件附近5格内巡逻。只响应自身事件、受袭或本队发现敌人，不因其他事件激活而被引走。
【多人】最多5名玩家；机动敌人数乘1.1×(1＋0.25×(参战玩家数−1))，观战者不计入。进度由服务端全队共享，任意有权行动的PMC单位可触发；友军AI不能代替玩家启动交互事件。
【增援】每4个完整己方回合刷新边缘巡逻，基准每队3台；所有后续增援再乘75%，累计取整分配。每队最多3台，按本队传感器发现玩家后追踪，失去接触先调查再巡逻。
【存活上限】N1～N6后续增援上限24／27／30／33／36／39台；运输机及乘员分别计数。满额跳过当次刷新，不补发；初始单位和驻军不占增援额度。
【事件增援队数】N1～N3一队、N4～N6两队；除明确固定的数量外，共用多人缩放、减量与上限。
【流程与演出】部署时显示含两个入场区、两个撤离区的雷达扫频简报；事件开始、完成、失败发送CUTIN，最后一项全部完成后追加“已完成所有目标”。本地演出与观战者不阻塞全员进度。
【结算】普通事件每完成一项，原始1250资金／1875物资／125科技点，另乘年代、难度及现行结算／活动倍率并按25取整；科技点遵循当前全局开关。委托特殊事件不增加普通事件结算收入。
【撤离】单位到任意撤离区可逐个撤离，运输机携乘员一起撤走；等待所有存活PMC撤离才统一结算。敌人全灭或事件全做完不自动结束，周期巡逻仍继续。奖励和战损仅最终结算入档。`;
const details = {
  salvage: {
    trigger: "进入白色3×3区域；己方可行动单位选择行动栏的“回收”。",
    completion: "主动回收成功，消耗本次行动，立即完成。不是站入区域自动完成。",
    failure: "未进入区域、无操作权限或单位不可行动时拒绝回收；不设独立超时失败。",
    reinforcements:
      "完成后从边缘运输追击；减量前基准1运输机＋3乘员。地面米迪亚／胖叔叔，宇宙哥伦布／巴布亚；实际套用共用缩放、75%与增援上限。",
    presentation: "资料几何图标；白色3×3覆盖，完成后变绿；连续播放开始和完成CUTIN。",
  },
  command: {
    trigger: "PMC靠近中心6格内或该驻守编队受击时开始。目标被发现后显示目标标记。",
    completion: "所有登记为targets的驻守目标被击毁；不要求清除其他巡逻队。",
    failure: "无独立计时或失败判定。未消灭全部目标时保持未完成。",
    reinforcements: "没有此类型专属增援波；附近巡逻队可按受袭信号调查支援。",
    presentation: "歼灭图标；已揭露目标头顶红色倒三角“目标／Target”，标记宽度随本地化文本适配。",
  },
  factory: {
    trigger: "PMC靠近中心3格内、设施或所属驻军受击时开始；攻击引来附近巡逻队。",
    completion: "全部指定工厂被击毁。",
    failure: "无独立超时。每座工厂的摧毁增援只触发一次。",
    forces:
      "工厂数量2＋floor((N−1)/4)：N1～N4两座，N5～N6三座。每座耐久20000＋5000×(N−1)。另有共用事件驻军。",
    reinforcements: "每座工厂被毁后从边缘增援1队，减量前基准3台；周边巡逻队响应受袭。",
    presentation: "工厂图标；可攻击的工厂设施为实际目标，完成时CUTIN。",
  },
  capture: {
    trigger: "任意PMC进入红色5×5覆盖区启动；中心据点格不可站立。",
    completion:
      "启动后五个完整己方回合，每回合满足己方PMC在区内且敌军不在区内时推进1格；累计5格完成。启动当回合不计数。",
    failure: "PMC离开或敌军进入时暂停，保留已有进度；没有区域一失守即失败的判定。",
    reinforcements:
      "启动后召集附近巡逻队调查；经过3个己方回合空降一波，之后每4个己方回合从边缘增援。队数按难度档位。",
    presentation: "据点图标，5×5红色覆盖；五个进度方块由红逐一变蓝，完成后范围变绿。",
  },
  defend: {
    trigger: "PMC进入以据点为中心的5×5覆盖范围启动，包含四角；启动前友军原地待命。",
    completion:
      "核心保持存活，经过五个完整己方回合；启动当回合不推进。启动后不要求PMC一直留在范围内。",
    failure: "核心被毁则该事件失败；其余合约目标和撤离仍可继续。",
    forces:
      "友军核心1座、机枪炮塔2座、自动防守MS3台；核心耐久40000＋5000×(N−1)。友军阵营取房间组合括号内的阵营；初始不生成敌方驻军，覆盖范围内不放置初始敌军。",
    reinforcements:
      "启动时、经过2和4个己方回合时产生攻击波，队数按难度档位；以目标附近空降方式入场。",
    presentation: "盾形标记；保护核心进度、开始／完成／失败CUTIN。友军不可直接操控。",
  },
  upload: {
    trigger: "PMC进入蓝色3×3区域启动。",
    completion: "有PMC且没有敌军处于3×3范围的完整己方回合累计达到3；启动当回合不计入。",
    failure: "PMC离开或敌军进入时暂停并保留进度，没有独立超时失败。",
    reinforcements: "启动时产生一批目标附近空降增援，并通知附近巡逻队调查；队数按难度档位。",
    presentation: "箭头上传图标，蓝色3×3范围、上传进度和CUTIN。",
  },
  radar: {
    trigger: "PMC靠近中心3格内、设施或所属驻军受击时开始。",
    completion: "摧毁指定雷达设施。",
    failure: "无独立超时或失败判定。",
    forces: "一座雷达设施，耐久20000＋5000×(N−1)；另有共用事件驻军。",
    reinforcements: "激活后仅触发一次目标附近空降响应，并通知附近巡逻队调查；队数按难度档位。",
    presentation: "雷达站图标，目标设施、开始和完成CUTIN。",
  },
};
const base = Contract.kinds.map((kind) => ({
  ...Object.fromEntries(Model.fields.map(([key]) => [key, ""])),
  id: kind.type,
  type: kind.type,
  name: kind.name,
  group: "基础事件",
  status: "无需调整",
  summary: kind.hint,
  conditions:
    "普通事件池；N1起可抽取，地面和宇宙均适用，目标位置每局随机。当前开放范围见共用规则。",
  forces: "共用事件驻军：3＋floor((N−1)/3)台，按多人缩放；只响应所属事件。",
  multiplayer: "全房间共享一个事件进度，服务端裁定；友军AI不代替PMC触发交互。",
  rewards: "完成后普通事件计数＋1；收益随最终撤离结算，共用收益公式。提前撤离保留已完成项收入。",
  notes: "",
  source: "shared/contract-mode.js：kinds / initialize / poll / action；docs/rules/contracts.md。",
  ...details[kind.type],
}));
const extra = {
  "efsf-11": {forces:"六台光束步枪型机动扎古，全部配属精英驾驶员，组成两个三机小队；队长记名小丑特丽娜。",completion:"N4以上、0079T1、地面、敌军吉翁，击毁全部六台目标。"},
  "efsf-12": {forces:"一台记名PIXY的精灵高达，配属老兵驾驶员。",completion:"N5以上、0079T1、地面、敌军联邦，击毁指定精灵高达。"},
  "zeon-11": {forces:"六台光束步枪型陆战型高达，全部配属精英驾驶员，组成两个三机小队；队长记名铁壁沃尔克。",completion:"N4以上、0079T1、地面、敌军联邦，击毁全部六台目标。"},
  "zeon-2": {forces:"坠毁胖叔叔残骸＋事件驻军。",completion:"回收运输记录，且接取者至少一台存活单位成功撤离。"},
  "zeon-3": {forces:"三台叛变扎古ⅡF型，机枪／火箭筒／机枪套件，配属老兵驾驶员。",completion:"击毁全部三台账外护卫。"},
  "zeon-4": {forces:"六台初期型吉姆，组成两个三机警卫小队。",completion:"击毁两个小队的全部六台MS。"},
  "zeon-5": {forces:"四座工厂、十二台驻军和四座炮塔。",completion:"委托只统计机动扎古指挥官机最后击毁的工厂，累计0/4。",notes:"接取时发放临时机动扎古指挥官机，不可装备零件；完成目标结算后自动回收并卸下零件与驾驶员。"},
  "zeon-6": {forces:"萨姆森运输车队残骸＋事件驻军。",completion:"回收通行记录，且接取者至少一台存活单位成功撤离。",notes:"交付后与联邦绿色通道任选其一，开放四项设施2级升级权限。"},
  "zeon-7": {forces:"一台格鲁古古ACE队长机与两台扎古ⅡF后期型老兵僚机，组成收税官私人卫队；队长有专属战斗台词。",completion:"击毁全部三台叛变MS。"},
  "zeon-8": {forces:"一台机动扎古指挥官机与五台机动扎古；队长ACE且有专属战斗台词，五名僚机驾驶员全部为精英。",completion:"N5以上以联邦军一侧入场、敌军吉翁，击毁全部六台目标MS。"},
  "zeon-9": {forces:"一座联邦HQ、十二台驻军和四座炮塔。",completion:"摧毁HQ，且接取者至少一台存活单位成功撤离。"},
  "efsf-2": {
    forces: "坠落米迪亚残骸＋共用事件驻军。",
    completion: "回收米迪亚数据，并由接取该委托的玩家成功撤离后记录委托完成。",
  },
  "efsf-3": { forces: "三台记名陆战型吉姆，配属联邦老兵驾驶员；替代普通驻军并登记为歼灭目标。" },
  "efsf-4": { forces: "两个三机小队，每队扎古ⅡF型两台、扎古ⅡS型一台，共六台指定目标，替代普通驻军。" },
  "efsf-5": {
    forces: "四座工厂、十二台驻军和四座机枪炮塔。",
    completion:
      "四座工厂都被击毁；委托另计苍白骑士击破的工厂数量0/4。当前实现采用全队苍白骑士击破记录，不区分击破者与委托接取者。",
    notes: "接取委托时赠送苍白骑士属于联络委托初始装备，不是此事件本身发放。",
  },
  "efsf-6": {
    forces: "运输车队残骸（Type74）＋共用事件驻军。",
    completion: "调查残骸回收资料，并由接取玩家成功撤离后记录委托完成。",
  },
  "efsf-7": {
    forces: "不死的雷纳斯小队：一台陆战型高达光束步枪ACE队长机，两台陆战型吉姆分别使用机枪与火箭筒、配属老兵驾驶员；队长有专属战斗台词。",
    completion: "击毁全部三台记名机体。",
  },
  "efsf-9": {
    forces: "一座敌方HQ、十二台驻守MS和四座机枪炮塔；驻军数量沿用多人缩放。",
    completion: "摧毁HQ，并由接取委托的玩家至少一台存活单位成功撤离。",
    notes: "enemybase为联络委托专属变体，不加入普通随机事件池。",
  },
};
const variants = Contacts.tasks
  .filter((t) => t.eventName)
  .map((t) => ({
    ...Model.clone(base.find((e) => e.type === (t.kind === "enemybase" ? "factory" : t.kind))),
    type: t.kind,
    id: t.id,
    name: t.eventName,
    group: "联络委托变体",
    status: "无需调整",
    summary: `${Contacts.contactName(Contacts.contactId(t))}委托「${t.name}」追加的特殊地图事件。`,
    conditions: `全房间任意玩家已接取${t.id}；地面、N${t.difficulty}以上、${t.enemyFaction === "NONE" ? "武装介入" : "敌军"+({EFSF:"联邦",ZEON:"吉翁",OMNI:"地球联合军",ZAFT:"扎夫特"}[t.enemyFaction] || t.enemyFaction)}时固定追加。同一委托全房间只生成一项，不占普通事件数量。`,
    rewards: "不增加普通合约事件收益；委托完成条件和交付奖励由联络委托单独判定，不能重复计算。",
    source: `${["omni","zaft"].includes(t.contactId) ? "shared/contact-ce.js" : t.contactId === "zeon" ? "shared/contact-zeon.js" : t.contactId === "anaheim" ? "shared/contact-anaheim.js" : "shared/contact-tasks.js"}：${t.id}；shared/contract-mode.js：initialize / recordDefeat / commissionProgress。`,
    ...extra[t.id],
  }));
module.exports = { commonRules, events: [...base, ...variants] };
