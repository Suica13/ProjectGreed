# 容易误判的机制

## 左右枪口与独立手臂射击

- 保留 `weapons` 原始武器供源码审计。双臂物理分组声明 `fireMode: independent`，加载器按 leftArm/rightArm 生成两个 UI 武器，各自按实际载荷扣 EN；AP只保留参考值，分别播放本侧动画。
- NT-1 每手9发、20 EN；RX-78XX 原流程已有双手14发，拆为每手7发、22.5 EN，不能给两手各复制完整流程。
- 原始仅声明而未实际发射的枪口不增加弹体。坏一手只禁用该手武器；同侧双管仍为同一只手的武器。胸炮、腿炮、肩炮不套用双臂拆分。
- L/R 名字不能确定是哪只手，需核对原炮口位置、贴图挂点和动作条件；多管 R2/L2 可能属于同一总流程，需去重。
- 同步本侧枪口采样与可见动画；保留原生持握和显示状态。钢加农迫击炮依赖 backpack，不能依赖 rightArm。
- 非手臂分组仍合成对应通道齐射；舰船保留各模块 HP、射界、位置和独立禁用状态。
- G-3／GP03S等原有双持发射器保留单个齐射槽位。用实际炮口挂点骨骼（优先）及原生逐发肢体条件区分左右手；任一手臂损毁只停用本侧发射通道，并按存活通道扣EN，不能把首发右臂条件复制给左手。双手都损毁才整体禁用。
- 左右交替的近战序列若误继承单只手臂的全局依赖，改为任一手臂可用，并继续逐击校验本侧肢体；保留明确要求双臂同时完好的动作。规则由paired_weapons.py维护，不单凭L/R名称或炮口x坐标把身体/肩部/同臂多管武器拆成双持。

## 形态、脱出、爆甲

`source.mode` 明确 remove/transform，`spawn` 表示另生成一个实体；转换目标/套件映射、是否继承资源、HP/EN/盾牌恢复百分比、是否修复部位都显式配置，不能暗中一律恢复全满。

- 普通脱出 minRange=range=1，目标为一个合法相邻格；不能原地或斜角。MTank 本体变底盘并独立生成顶部飞机。
- 原地变形/爆甲保留单位身份、所有者和自定义名字。爆甲与脱出统一消耗1 AP，保留剩余AP与原移动状态；AP不足禁止发动，普通变形仍消费行动。形态不能因 maxHp 改变而免费恢复资源；参考当前转换测试中的继承/恢复契约。
- EXAM/HADES 持续三个己方回合，每个己方回合结束扣除10%最大耐久及5%最大EN；苍白骑兵RX_80PR_2的HADES改为扣除7.5%最大耐久；保留红色演出和头部损毁强制解除；不以普通转换替换这套状态机。

## 演出与平台

- 气垫只在地面移动时循环；普通单位后退推进器在飞行和宇宙中常开，原前向推进器只在推进移动或回避时开启；战舰保留原生引擎配置，不再播放 Boost_Start。
- 普通单位首个死亡爆炸时隐藏；大型舰船在多轮爆炸结束前保留贴图。按地面/宇宙/水域选择死亡特效。
- 友军、敌军指挥范围是脚本绘制的地面层，选择有关单位才显示；范围显示不是指挥增益已生效的证据。
- 飞行图层/移动特效不代表已实现 FlyStyle/SFS。搭载、辅助飞行、飞行形态仍需单独设计；普通单目标多武器已按AP实现，允许重复，费用由weapon_policy.action_cost生成，不能因源文件存在就标为 implemented。

## 战舰附件显示核对

- `tools/native_ship_presentation.py` 重建原生物理炮塔及舰桥贴图；不能以名称是否含Turret判断是否需要导入。Marker/Ring不是物理部件，没有独立贴图的发射点不补画炮塔。
- 以舰体Body/Hull层级为基准，普通模块在其上方；原生setDrawLayerOnBottom保持下方。保留图片镜像、dirOffset和附件idleDir。
- 待机、规划、受击时保持默认方向；只在发射演出中瞄准当前武器可用炮塔。射界只用舰体方向、原生idleDir和arc，不能取显示瞄准角。
- 运行 `python tools/audit-ship-turrets.py` 验证全部舰船；`--write` 更新 `docs/imports/ship-turrets.md`。浏览器检查 `tests/ship-turrets.spec.cjs`。

- 持握武器显示只按实际开火动作链是否写入 `nowWeaponIndex` 决定 `changeHeldWeapon`，不能按肩部、头部或手臂位置推断；未写入时保留当前持握状态，也不能触发持握狙击枪的射击姿态。

- `setWeaponIndex` 需要保留写入时刻和数值：原动作链中的 `nowWeaponIndex` 写入转换为 Step 的 `weaponDisplayIndex`，由 `WeaponSequence.pose` 采样并传给渲染层。图层按原始索引条件判断，不把普通／Step2 图层合并成同一个 heldWeapon 条件，也不沿用固定动画时间窗。原生无索引条件的固定附件不得凭空添加 heldWeapon 限制。

- 直升机（EF_Heli、ZN_Heli 等旋翼机）的 `presentation.thrusters=false`，不得套用飞行单位的常驻后退推进器或移动／回避喷焰。导入器和渲染器同时遵守这一显式开关。

## 学习型电脑（LPC）

原 `Template/Unit/Skill/LPC.gw` 设置 `baseExpSpeed=1.1`，名称为学习型电脑。由 `native_passives.apply_learning_computer` 读取完整继承链（包括缺少 nativeSkills 的旧单位），写入 `stats.pilotExperienceMultiplier`。驾驶员击杀和存活助攻经验按当前机体倍率计算，与现有快速战、强度、服务器活动倍率相乘后统一向下取整；存档对局仍无经验。驾驶员个人存档只接收已计算的奖励，禁止再次乘算。

## 库存改装及原生脱出扩展

`native_refits.py` 保留原生动作的 UnitID、Money、Resource、CustomRule 与来源；原生路线只作为费用与条件档案，付费改装操作已移除；普通改装限定机型直接按原改装费购买部署许可。预览面板“特殊变换”仅展示ACE配属与专用机，保留自动转换、取消配属还原及形态兼容；缺失目标不得自动放开。`import-ejection-forms.py` 仅补齐原生单机脱出目标；`native_conversions.py` 把明确 spawnUnits + deleteSelf 或 convertTo 转为已有脱出／爆甲配置，不把诱饵当成新机体。狙击蓄力伤害统一为原生技能的50%，包括步骤独立伤害分量，使用基值记录防止重复减半。

武器显示名由`tools/native_weapon_names.py`按用户确认的Common、DoubleMS/BR/GL、LegMS、Arm武器及战舰AMS等规则最后覆盖；不能把单位编号中的MS当成导弹。


## ACE驾驶员

`tools/import-ace-pilots.py`读取0079的40名ACE资料及原生信标报价；仅35名有独立报价可招募。招募只消费资金/物资，不产生原信标附送单位。普通头像候选不混入ACE头像。`shared/pilots.js`以`aceId`固定身份，复用共享驾驶员存档、配属、战绩及服务端奖励路径；ACE不能手动强化或重置。原MOD成长数据作为来源保留，运行时0至5级、初始250 COST且每级+25，属性为整数，技能已接入；具体规则见docs/rules/pilots.md。重新导入普通驾驶员会同步重建ACE目录。

ACE招募复用科技节点的`unlocks`；客户端招募与开发页预览共用开发校验，无节点报价不能直接放开。`needsRecruitment`保存在共享驾驶员档案；普通战损毁由服务端私有驾驶员奖励标记，保留等级、经验与战绩，解除编组配属，重新扣招募价格后恢复。快速战暂沿用无损规则，存档对局不改变驾驶员档案。ACE名称、头像及手动属性强化均锁定。


## 子母弹与霰弹（0087修复）

Bazooka_SG、BZ_SG和Bazooka_ShotgunMode为扩散火箭筒。沿母弹Projectile_Bazooka_ShotgunMode（含Lv2）的hiddenAction_SpawnHitEffect读取12枚子弹及其独立载荷、命中、部位系数和目标修正，保留母弹伤害。原生发射数保存在nativeTiming.projectiles，衍生弹数另存secondaryProjectiles；不能用13枚同时出枪口冒充子母弹。演出splitFraction默认为0.65，可单独配置；子弹不重复播放发射声和枪口特效。普通ShellShotGun/BeamShotGun从枪口直接按原offsetRandomDir扩散，必须支持任意射击方向。断言见tests/scatter-projectiles.test.cjs。

0087的AEUG、TITANS战舰按联邦系处理，NEO_ZEON按非联邦系处理。统一native HP×0.70、伤害×0.75、机体命中系数×0.65；联邦系额外HP×1.10、命中×1.10、回避×1.15，耐久按500取整。舰炮爆炸命中×0.8、普通舰炮对中型目标命中×0.75和对空炮减半发数继续保留。顺序须先apply_anti_air，再apply_damage，避免重建对空炮步骤后丢失伤害减免。


## 左手连续射击动画修正（2026-11-03）

原MOD的Common_ArmMG_L、NZN_AMX_101_ArmMG等左手发射链，第一发Common_Shoot_A_L之后误调用右手Common_Shoot_A_FA。native_presentation.correct_left_firing只对明确依赖单左臂且已使用左手起始动作的射击链，将后续Common_Shoot_A_FA改为已有Common_Shoot_A_L；保留逐发延迟、载荷、EN、弹数、显示索引与炮口，不修改右手、双臂齐射或格斗。双臂拆分后的PairedFire动画和枪口采样由同一修正流程生成。

## 蓄力狙击辅助弹

原MOD的Sniper_Aim辅助单位承载锁定标记与延迟触发，不是飞行伤害弹。保留其nativePayload供审计，锁定标记使用SniperLock逐帧绘制；实际发射使用special.baseWeapon对应的弹丸贴图和原生弹速，再应用全局弹速规则。不能把LockTarget整张序列图画成弹丸，也不能使用辅助单位的1～1.35弹速，否则会使全员演出屏障长时间无法结束。


## 大型光束序列帧

`native_beam_projectiles.py` 沿真实伤害弹和挂载特效识别 HighBeamCannon / HighBeamRifle / HighBeamRifle_Fast，导入原始两段或三段图片、帧数、颜色、偏移与缩放。`python tools/refresh-native-beam-projectiles.py --write` 只刷新相关表现配置和误读弹速，生成[来源清单](beam-projectiles.json)，不重新生成伤害、命中、EN、发数或套件。

HighBeamCannon 的伤害弹和动画辅助单位分别携带资源。辅助单位的0.75／1.0是动画参数，不能覆盖判定弹的55／75弹速。运行时仍按判定弹速应用全局换算；分段动画锚定炮口，沿弹道按目标距离适配长度，按同一弹丸飞行进度采样，不再叠加普通光束贴图。贴图由战斗资源列表预载并共用，不在逐帧绘制中创建图片或计时器。连续照射仍走原有照射技能，不按名称将其转成这类弹丸。


## GP计划货柜与核弹

`python tools/native_gp_containers.py` 定向刷新GP03D货柜与GP02A核弹，生成[原生来源清单](gp-containers.json)。AMS原流程为两个货柜，每柜36次双发，合计144枚。ASP原本为反舰货柜，现按用户规则转为3枚核弹技能；nativeTiming保留原发数，tacticalPattern保存适配发数。货柜独立使用原生尺寸与推进器帧，不继承大型MA的图片缩小倍率。

权威结算保留逐弹随机选敌和独立核爆标识，同一齐射只扣一次EN与每回合次数。客户端按服务端提供的后方格位置、发射和命中时刻播放，用曲线连接导弹出口与目标，同一货柜只绘制一组。GP02A移除旧的能量容量待核查隐藏标记，恢复核弹分类、核爆特效、核弹射程和套件入口，每条命一次。
