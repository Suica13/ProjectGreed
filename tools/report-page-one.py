"""Refresh provenance and the human-readable Page_00 implementation audit from actual prefabs."""
import json
from pathlib import Path
from mod_source import ASSETS
from page_one_adaptations import LABELS
read=lambda path:json.loads(path.read_text(encoding='utf-8'))
manifest=read(Path('tools/0079-page-one-manifest.json'));catalog=read(ASSETS/'unit-catalog.json');prefabs={p['id']:p for p in [read(ASSETS/ref) for ref in catalog['units']]}
rows=[]
for row in manifest:
 if 'Pilot' in row['tags'].split(','):continue
 p=prefabs[row['id']];rows.append({'id':p['id'],'faction':p.get('faction',row['faction']),'name':p['name'],'source':row['source'],'status':'imported' if p.get('mechanics') else 'existing','weapons':len(p['weapons']),'skills':[{'id':s['id'],'name':s['name'],'type':s['type']} for s in p.get('skills',[])],'mechanics':p.get('mechanics',[])})
Path('tools/0079-import-report.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
pending={}
for row in rows:
 for m in row['mechanics']:
  if m['status']=='review':pending.setdefault(m['id'],[]).append(row['id'])
lines=['# 0079第一页单位移植核对','',
'范围以两阵营科技树 `TechTree_UI_Page_*_0079_00.ini` 的解锁条目为准，沿 `copyFrom` 继承链读取单位、武器和技能。不是按素材文件夹名字推测。',
'',f'Page_00清单共{len(rows)}个作战单位条目（含装备／货柜等衍生形态）。当前完整目录共{len(prefabs)}个预制体，其中{sum(not p.get("formOnly") for p in prefabs.values())}个可直接编组、{sum(bool(p.get("formOnly")) for p in prefabs.values())}个仅供形态转换使用；这些总数包含非Page_00单位及必要衍生形态。独立ACE驾驶员、建筑、雷达、炮台暂未加入。',
'','## 实现状态','',
'这里的“基础移植”包括原生图标、主体贴图、可读取的部件动作、武器步骤、枪口、弹体、攻击与命中特效、音效、反应／命中系数、防护、机体介绍及普通JSON预制体。它不等于原RTS所有系统的完整复刻。编组详情会显示每项机制的实际状态。',
'',
'- 已接入：地面／空中／气垫／两栖／海军通行区别；坦克等非MS不套用六肢损毁；MS读取原结构强度和武器依赖；舰船完整矩形占地、独立炮塔耐久、同类完好炮塔齐射；直升机原旋翼循环；扎古热能斧中途换贴图。',
'- 补给（回合制改编）：具有SupplyPoint的单位提供被动范围补给，每个己方回合开始时为范围内存活友军（包括自身）恢复5%最大HP、10%最大EN；不消耗EN或行动，多个补给光环不叠加，不恢复护盾、不修复部位、不复活。补给单位的原自动修复并入这套规则。普通单位不再每回合自然恢复EN。',
'- 学习型电脑（LPC）：按原MOD经验成长1.1倍接入搭乘驾驶员；击杀与存活助攻经验均乘1.1，与快速战、强度和服务器活动经验倍率相乘，最终统一向下取整。存档对局不获得经验。',
'- 核心战斗机脱出：RX-78-2、RX-77-2与RX-75沿用RX-78-1的明确配置；原机体移除，仅在相邻1格选择合法位置生成满HP、满EN、修复部位的FF-X7（不含原地及斜角），保留所有者和自定义名字，消耗一次行动，每场一次。',
'- 自动修复（回合制改编）：来源具有AutoRepair的单位，在己方行动开始时，若受损且至少有10 EN，消耗10 EN恢复10%HP，没有普通回合EN恢复；补给单位的自动修复已并入补给光环。不复活。',
'- 侦察／声呐／隐蔽（回合制改编）：本项目尚无战争迷雾，使用战术标记代替直接照搬探测半径。侦察消耗15 EN和一次行动，标记范围6内敌军；声呐仅标记水域敌军。标记在下次己方行动开始前有效，友军对标记目标命中+10%，并解除该目标的隐蔽命中惩罚。隐蔽使一格以外的敌人命中-10%，水下隐蔽只在水域生效。来源侦察单位及声呐单位会显示对应技能。',
'- AI同时检查适应性、预算和完整部署占地；先摆大舰再摆小单位，并为剩余槽位保留空间。在海陆混合部署带保留跨水小单位预算，避免最后只剩水格却无法买到可部署单位。支持200%编组数量的24台AI编组。',
'- 纯运输机保留无武装，不凭空添加机枪。搭载系统尚未完成前，AI不随机选择没有武器、整备或侦察能力的纯运输机。玩家仍可查看和编入它们。',
'- 海军只能在水域移动与部署，普通无海军部署带的地图会禁用。新增“海陆补给线 · 2v2”用于混合类型测试，两个沿岸战区由水域分隔；飞机与两栖／气垫单位可跨水调动。',
'- 全部平台基础COST=原MOD unitLevel÷4，按25取整（最低25）；套件沿用统一类别附加费。旧的折半与人工档位定价不再使用。每个单位的sourceStats.unitLevel和costBalance记录来源值与换算结果。',
'',
'## 爆炸与战舰尺寸','',
'- 普通单位分别使用原MOD的 `Explosion_Ground_1`、`Explosion_Space_1`、`Explosion_Water_1`。根据战场环境和死亡格地形选择，宇宙不会再使用地面贴图。',
'- 大型舰船先按原生0.2秒节奏播放10次分散小爆炸，再于第2秒触发 `Common_Explosion_MA_Ground_1` 或 `Common_Explosion_MA_Space_1`；完整保留最后主爆炸的播放时间。原MOD LargeUnitDie_1的次级爆炸固定为地面图，本项目在宇宙用相同参数切换宇宙贴图。10次／2秒是本项目演出取值，原MOD的连续次数由其死亡流程持续时间决定。',
'- 普通单位从首次死亡爆炸开始隐藏；大型舰船在完整多轮爆炸结束前保留贴图，最后才隐藏。死亡前仍沿用电流音效与特效。炮塔损坏后保留贴图并禁用开火，只在对应挂点循环显示缩小的原Stun_1电流，不再播放炮塔小爆炸。',
'- 萨拉米斯改为2×3，转向后3×2。飞马级、桑吉巴尔级保持3×6，其余战舰使用2×3，盖洛普级和小托盘使用1×2。贴图比例不随占地缩小。转向检查旧、新占地合并的扫过区域，各席位部署区至少14×18格，舰体默认横向朝向战场，可在未占用的合法范围旋转。原战场完整保留，必要时补齐上下部署高度；先摆放大舰体再摆MS，避免碎片化空位。',
'',
'## 尚待实现的新机制／技能','',
'以下明确没有伪装成可用按钮。它们保留来源和界面“待接入”标记；基础单位可用，但这些能力尚不生效。复杂技能需要进一步定义回合制效果与交互，不能将原MOD条件表达式直接塞回游戏执行。',
'', '| 原机制 | 涉及单位 |','| --- | --- |']
for key,units in sorted(pending.items()):lines.append('| '+LABELS.get(key,key)+' (`'+key+'`) | '+', '.join(units)+' |')
lines+=['','说明：CustomUnit／驾驶员专属改修、解析等与未接入的科技、经济或驾驶员系统有关；武器套件选装已存在，科技改修转换没有因此自动生效。运输搭载／放出、MS/坦克变形、飞行姿态切换、合体、辅助飞行平台、复杂装备分离等仍需专门规则。间接火力的无形标记弹改用其原生最终落弹贴图进行表现，不模拟原RTS炮击单位的完整弹道和区域伤害。布雷等Sp特殊武器没有假装为普通直射武器。',
'','## 每单位核对表','', '| 阵营 | 单位ID | 名称 | 移动类型 | 原Level | 基础COST | 实装主动技能 | 待接入原机制 |','| --- | --- | --- | --- | ---: | ---: | --- | --- |']
for row in rows:
 p=prefabs[row['id']];waiting=[LABELS.get(m['id'],m['id']) for m in row['mechanics'] if m['status']=='review'];lines.append('| '+' | '.join([row['faction'],row['id'],row['name'],p['stats'].get('movementType','ground'),str(int(p['sourceStats']['unitLevel'])),str(p['stats']['cost']),', '.join(s['name'] for s in row['skills']) or '—',', '.join(waiting) or '—'])+' |')
lines+=['','## 维护','', '- `tools/0079-page-one-manifest.json`：科技树来源清单。','- `tools/0079-import-report.json`：当前JSON实现状态报告。','- `python tools/import-0079-page-one.py`：从原MOD重新生成本次新增预制体，不覆盖原先15种已平衡单位；Node.js需在PATH中，更新目录前执行完整资源校验。','- `python tools/import-death-effects.py`：重新提取死亡特效。','- `python tools/add-coastal-map.py`：重建海陆测试图。','- `npm run units:reload`：扫描项目内普通JSON并重建网页，不读取原MOD。','- 修改源码或JSON后运行 `npm run build`，服务端重启、客户端刷新。没有生成ZIP或部署服务器。','', '已发现原MOD GallopClass 与 JotunheimClass 的阵营tag误写EFSF，按ZEON第一页的解锁归属校正；Wappa缺失阵营／年代tag，补为ZEON、0079。']
lines += ['', '## 武器与显示修正', '',
'- 坦克读取basePositionFromTurret，使用独立命名炮塔骨骼，炮口随同一挂点旋转。',
'- 战舰附件贴图、镜像与层级逐模块读取原MOD，舰桥也导入；默认在舰体上方，原生setDrawLayerOnBottom保持下层。待机、规划和受击不追踪敌人，仅开火演出中当前武器的完好、射界合法炮塔瞄准；射界按舰体方向和原始idleDir判定。详见《战舰炮塔核对.md》。',
'- 主武器套件按原单位的主装备槽判定；固定炮、火神炮和通用近战归入各主武器套件。同一槽位的左右武器合为一个套件。',
'- 驾驶员技能限制与非默认副武器选装写入availability/requirements/secondarySlots，保留原配置但从所有可出击套件排除。详情面板可查看隐藏原因，隐藏装备贴图也不显示。原有默认副武器保留。未作为普通武器导入的对应触发器列入deferredWeapons。',
'- 双臂同类远程武器以pairedWeapons声明物理通道和independent模式，加载成左右臂独立选项，各自扣AP与对应EN并播放本侧动画；每手仅保留自身实际载荷，不复制双手完整流程。同侧双管、非手臂武器及舰船模块保留原有齐射。钢加农迫击炮依赖背包。',
'- 舰船所有权Ring改为核心位置小圆；全部地面Ring先于所有单位贴图绘制。原导入炮塔中的Ring范围提示贴图全部移除。指挥范围用脚本圆形绘制，仅选中该战舰或同队、范围内单位时显示；可以查看选中敌舰的指挥范围。指挥增益本身仍在待接入机制列表中。',
'- 删除或合并的套件通过kitAliases兼容旧编组，保留单位自定义名称。',
'- python tools/native_weapon_layout.py：修正现有预制体并生成tools/0079-layout-audit.json。批量导入末尾调用同一套修正规则。',
'', '## 行动点与多武器攻击（已接入）', '',
'每单位默认5 AP（stats.actionPoints可覆盖），每个己方回合重置；移动不耗AP。普通攻击先选一个敌人，再按顺序添加武器，允许重复。光束步枪/火箭筒2，机枪扫射3，头部火神炮1，手臂/内藏武装2，加农炮/舰炮3；未列出的格斗、光束喷枪、导弹2，航空炸弹3。',
'服务器校验整个序列的总AP、总EN、各武器射程/部位/炮塔射界后原子保存，预留AP但不提前扣EN或造成伤害。取消/替换会退还原预留AP，真正结算只为实际执行的武器扣EN。目标死亡后不继续消耗后续武器EN。',
'防守方按单位作一次应战决策；对同一进攻单位的反击仅在其最后一件武器后执行一次。同一进攻单位的演出按序等待，不同单位保持并行。AI使用相同的AP/EN队列校验。',
'自用技能点击立即执行；指向他人或落点的技能先选技能再选目标。狙击蓄力、迫击炮等技能武器独占本次行动，不混入普通武器序列。多目标攻击尚未接入。']
lines += ['', '## EXAM / HADES与中心移动', '',
'- EXAM：RX-79 BD-1、BD-2、伊芙利特改；HADES：RX_80PR、RX_80PR_GroundType、RX_80PR_2。以实际单位ID及技能配置为准。',
'- 启动消耗25%最大EN，不消耗当前攻击行动；切换到原MOD对应形态，保留ID、所有者、自定义名字、当前HP/EN和已坏部位。强化期间至少反应×1.35、命中系数×1.20、移动+1，武器载荷取原MOD强化形态，不叠加手工威力倍率；不改变最大HP/EN来免费回血。',
'- 持续3个己方行动回合，在每个己方回合结束时扣10%最大HP、5%最大EN，第三次结算后强制还原原机体与套件。可重复使用，但必须再次支付启动费用；不能在强化期间重复启动。耐久扣除可以导致死亡。',
'- 强化形态仅由技能进入，不能直接编组或由AI购买；AI会在敌军接近且资源足够时使用技能。',
'- 战舰点击移动/部署的位置代表整个舰体中心，支持半格中心；内部仍保存整数占地锚点以校验碰撞。转向围绕中心基准换算，连续四次转向不会累积漂移。部署移动和撤回会清理旧旋转基准。',
'- tools/v05_balance.py维护定价、射程、占地和补给规则；python tools/special_systems.py重新生成六种强化形态及技能。批量从MOD导入时自动执行这一步。']

lines += ['', '## 原MOD资源与武器数据', '',
'- 当前以原MOD的maxHp、maxShield为预制体资源基准，EN上限为enMax的50%；武器伤害分量、基础命中、发数、动作队列和EN消费也读取原值，不再使用旧的多发数增伤/减伤、固定100EN或25%EN涨价。',
'- 格子射程仍用战术类别转换；头部火神炮、腕部机枪/榴弹/光束枪统一1～2格。航空炸弹不能选择空军；迫击炮保留完整九宫格抽取、空格落空与只能防御/回避的回合制规则。',
'- 狙击技能保留跨己方回合蓄力及命中率×2；技能自身伤害和EN沿用原MOD。首回合锁定使用原LockTarget_1白色帧（0～2），次个己方回合目标有效才转红（19帧）并立即进入应战/开火流程；演出后继续当前己方行动。弹速沿用对应普通狙击弹，不使用锁定标记速度。',
'- 原生AP伤害独立保留：不减固定防御，只按相应防御百分比的四分之一计算，并穿透护盾；DP及其他异常载荷在面板/源数据中保留，未假装已完整实现原RTS全部异常状态。',
'- 时间明细、CD分组与多武器排队建议见《武器时间与CD统计.md》及同名CSV；全部单位—武器时间线见tools/weapon-timing-report.json。现已用AP启用单目标多武器顺序攻击，原生时间/CD只影响演出，不作为AP费用。',
'- 显示名不明确的武器见《武器命名待确认.md》，等待用户命名逻辑后统一修改，不改武器ID。',
'- 战舰命中系数直接采用原MOD baseAccuracyLevel，与sourceStats.accuracy一致，不再附加1.10倍率。',
'- tools/native_combat.py负责原生数值和流程；tools/native_presentation.py负责狙击持握/射击显示、钢坦克炮管图层、钢加农套件与主手优先。tools/weapon_policy.py负责格子射程与回合制特殊规则。',
'- python tools/refresh_weapon_skills.py刷新预制体；python tools/report-weapon-timing.py重建统计。批量导入末尾执行相同政策，避免回到手工平衡值。']

lines += ['', '## 下一步机制讨论（尚未接入）', '',
'| 主题 | 已有基础 | 需要确定的回合制规则 |',
'| --- | --- | --- |',
'| 攻击流程时间（已统计） | 已实现基于AP的单目标重复武器序列；演出使用原生准备、发射和收招 | 原生秒数/CD不直接决定本回合次数；未来若要引入额外时间预算，需另行设计。 |',
'| 辅助飞行SFS（已接入） | 五种原生平台以可见MS格纳库槽维护；平台与乘员各自HP/EN，随平台移动，独立攻击和受击 | 头像面板选择乘员；移动到平台确认搭载，移动离机；平台损毁复用紧急退出。SFS不提供舰内维修。 |',
'| 飞行形态FlyStyle | 原MOD有地面/飞行形态切换，部位破损会锁定；现有转换基础可复用 | 确定切换是否消费行动、EN、可停留地形、损毁后强制落地和水上无合法落点的处理。源3秒CD需回合化，不能直接沿用秒数。 |',
'| 飞行属性FlyUnit / FlyHover | FlyUnit源文件设置AIR移动与高度，FlyHover含高度相关演出；当前有静态平台通行和推进器显示 | 区分永久空军、可切换飞行形态与视觉悬浮；再定义对空/对地武器限制、掩体适用及落地条件。推进器特效本身不算飞行模式完成。 |',
'| 运输/展开/指挥 | 已有矩形占地、转换、补给、侦察与范围显示 | 搭载容量/装卸行动、部署前后状态与指挥增益仍需单独约定。优先处理SFS依赖的最小搭载关系。 |',
'', '来源入口：原MOD Template/Unit/Skill/{SFS,FlyStyle,FlyUnit,FlyHover}.gw，以及Template/Unit/Transport_SFS.ini。以上是分析及建议，不代表功能已接入。',
'', '移植流程模板见 `.agents/skills/projectgreed-mod-unit-import/SKILL.md`。']

Path('0079第一页移植核对.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
