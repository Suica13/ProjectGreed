# 单位移植遗漏审计

> 由 `node tools/audit-unit-migration.cjs` 从当前单位目录生成。`review` 表示原 MOD 来源已经保留，但对应回合制规则尚未接通；`adapted`、`implemented` 与 `not_applicable` 不列为遗漏。

- 单位预制体：459
- 武器配置：2581
- 实际待接机制：200 条来源记录，共 37 类
- 已由新实现替代但仍保留的旧来源标记：12 条（不计入遗漏）

## 尚未移植的机制

| 机制 | 显示名 | 单位数 | 涉及单位 |
| --- | --- | ---: | --- |
| ABC | ABC | 6 | MSN_100、MSR_00100S、MSZ_010S、FA_010S、MSR_00100S_M、MSN_001 |
| ALICE_Off | ALICE_Off | 2 | MSA_0011、MSA_0011_Ext |
| ChangeStyle | 姿态切换 | 4 | U_Type_Submarine、M_Type_Submarine、U_Type_Submarine_ZEON、M_Type_Submarine_ZEON |
| CustomUnit | 换装／改修 | 15 | MS_07B、FA_78_1、FF_X_II_FB、RX_78_4_Bst、RX_78_5_Bst、RX_78SP、FA_78_3、FA_78_2、FA_78_G、MS_06F_Sniper、Medea_DeployState、RX_178_AEUG_FlyingArmor、MSA_007、RX_178、RX_178_Unit4 |
| DogFight_A | 空中缠斗 | 25 | FF_4、FF_B2、FF_6、FF_S3、Dash、DEPP_ROG、DonEscargot、FF_X7Bst、FFB_7Bst、Dopp、DodaiYS、Gattle、JiccoClass、Luggun、GawClass、PublicClass、FF_X_II、FF_X_II_FB、Dodai2、FF_X7Bst_II、G_Fighter、DodaiKai、RX_178_AEUG_FlyingArmor、BaseJabber、Gator |
| DogFight_MA_Fighter | MA空战机动 | 7 | RX_78GP03D、MA_05、MAN_03、MAN_08、MA_06、MAM_07、MA_04X |
| energy_capacity_EF_RX_78GP02A_Bombing_Nuke | 待适配：航空炸弹（原生EN消费超过减半后的机体容量） | 1 | RX_78GP02A |
| FlyHover | 悬浮飞行 | 4 | MAX_03、ApsarasII、Apsaras、ApsarasIII |
| FlyMS | FlyMS | 2 | RX_78_2_BPart、RX_178_AEUG_FlyingArmor |
| FlyUnit | 飞行模式 | 6 | MAX_03、ApsarasII、Apsaras、ApsarasIII、RX_78_2_BPart、RX_178_AEUG_FlyingArmor |
| FuseUnit_A | FuseUnit_A | 1 | G_Fighter |
| FuseUnit_B | 合体 | 1 | RX_78_2 |
| remote_review_AEUG_MSA_0011_Ext_AntiBeamIncom | Unsupported remote payload (reflector or indirect control): MSA_0011_Ext_AntiBeamIncom_L | 1 | MSA_0011_Ext |
| remote_review_TITANS_MRX_010_Funnel | Unsupported remote payload (reflector or indirect control): MRX_010_Funnel | 1 | MRX_010 |
| remote_weapon_AEUG_MSA_0011_Ext_AntiBeamIncom | 浮游兵器：部署、远程操控与回收待适配 | 1 | MSA_0011_Ext |
| remote_weapon_TITANS_MRX_010_Funnel | 浮游兵器：部署、远程操控与回收待适配 | 1 | MRX_010 |
| SFS_2X | SFS_2X | 3 | DodaiKai、BaseJabber、Gator |
| special_Common_DemolitionChain_Back_Space_GP_03D | 爆导索 | 1 | RX_78GP03D |
| special_Common_DetectArea_Lv2 | special_Common_DetectArea_Lv2 | 1 | PMX_002 |
| special_Common_EMP_M | special_Common_EMP_M | 2 | Apsaras、ApsarasIII |
| special_Common_Fuse_A | special_Common_Fuse_A | 1 | G_Fighter |
| special_Common_MineLauncher_Continuous_Back_Ground_RTX_440 | special_Common_MineLauncher_Continuous_Back_Ground_RTX_440 | 1 | RTX_440 |
| special_Common_MineLauncher_Continuous_Back_Space | special_Common_MineLauncher_Continuous_Back_Space | 3 | MS_06F_MineLayer、MS_09R_Stutzer、MS_14A_Stutzer |
| special_Common_MineLauncher_Continuous_Back_Space_Lv2 | special_Common_MineLauncher_Continuous_Back_Space_Lv2 | 2 | MS_09R_Stutzer、MS_14A_Stutzer |
| special_Common_MineLauncher_Continuous_Back_Space_RB_79M | special_Common_MineLauncher_Continuous_Back_Space_RB_79M | 1 | RB_79M |
| special_Common_MineLauncher_Continuous_Front_Space_YMS_15 | 连续布雷 | 4 | YMS_15、YMS_15E、MS_17R、YMS_15_MQVCustom |
| special_Common_ReEntry | 大气层突入 | 8 | PegasusClass、GrayPhantomClass、AlbionClass、BlancRival、Thoroughbred、WhiteBase、GrayPhantomClass_0087、ArgamaClass |
| special_Common_ReEntry_Both | 大气层突入 | 8 | PegasusClass、GrayPhantomClass、AlbionClass、BlancRival、Thoroughbred、WhiteBase、GrayPhantomClass_0087、ArgamaClass |
| special_Common_ReEntry_FromSpace | 大气层突入 | 15 | PegasusClass、ZanzibarClass、ApsarasII、GrayPhantomClass、AlbionClass、ZanzibarClassKai、ZanzibarClassKai_0083、Apsaras、ApsarasIII、BlancRival、Thoroughbred、WhiteBase、GrayPhantomClass_0087、ArgamaClass、ZanzibarClassKai_0087 |
| special_Common_ReEntry_MS_FromSpace | special_Common_ReEntry_MS_FromSpace | 3 | RX_78_2、RX_78_3、RX_178_AEUG_FlyingArmor |
| special_Common_ReEntry_NeedBooster | 大气层突入 | 30 | ColumbusClass、MagellanClass、MagellanClass_Green、MusaiClass、PapuaClass、ChivvayClass、ZanzibarClass、GwazineClass、SalamisClassLateType、ColumbusClassKai、MagellanClassLateType、BirminghamClass、MagellanClassKai、SalamisClassKai、MusaiClassLateType、PazockClass、ChivvayClassKai、ZanzibarClassKai、GwanzanClass、ZanzibarClassKai_0083、MusaiClassLateType_0083、SalamisClassKai_0087_AEUG、IrishClass、SalamisClassKai_0087_TITANS、AlexandriaClass、DogosseGiarClass、ZanzibarClassKai_0087、MusaiClassFinalType、GwanbanClass、GwadanClass |
| special_Common_ReEntry_NeedBooster_Both | 大气层突入 | 4 | ZanzibarClass、ZanzibarClassKai、ZanzibarClassKai_0083、ZanzibarClassKai_0087 |
| special_Common_ThunderStrike | special_Common_ThunderStrike | 1 | RX_78XX |
| Transform_LandFly | Transform_LandFly | 23 | MSZ_010、MSA_0011_Ext、NRX_044_TR_3、NRX_044、RX_110、MRX_009、RX_139、ORX_005、PMX_000、RX_124、ORX_005_TR_5、ORX_005_TR_5_FF_X39A、RX_124_Kehaar2、RX_124_Kehaar2_M、MRX_010、NRX_055、AMX_003、AMX_006、AMX_102、AMX_008、AMA_01X、AMX_107、AMX_107M |
| Transform_LandFly_SFS_OFF | Transform_LandFly_SFS_OFF | 7 | MSA_005、MSZ_006、MSZ_006A1、MSZ_006C1、MSZ_008、MSA_005S、MSN_001 |
| Transform_LandLand_Tank | MS／坦克变形 | 1 | RTX_440 |
| UnloadEquipment | 装备分离 | 3 | RX_79_G_WithBackpack、RGM_79_G_WithBackpack、RX_79_G_Ez8_WithBackpack |

## 已接通但仍保留的旧来源标记

这些标记用于追溯原 MOD，不代表功能缺失：米诺夫斯基散布已经由 `minovsky` 技能接管；EXAM/HADES 的强化形态自身不再重复提供启动技能。

| 来源标记 | 单位数 | 涉及单位 |
| --- | ---: | --- |
| Exam_On | 5 | RX_79_BD_1_EXAM、RX_79_BD_2_EXAM、MS_08TX_Kai_EXAM、RX_79_BD_2_NMBS_EXAM、RX_79_BD_3_EXAM |
| HADES_On | 3 | RX_80PR_HADES、RX_80PR_GroundType_HADES、RX_80PR_SpaceType_HADES |
| HADES_PR2_On | 1 | RX_80PR_2_HADES |
| special_Common_MinovskyParticle_S | 3 | Dash、Gunperry、Luggun |

## 缺失或待确认文本

- 中文：0 个单位名、0 个单位介绍缺失。
- 英文：0 个单位名、0 个单位介绍缺失。
- 日文：441 个单位名、456 个单位介绍缺失；缺失单位名见下方列表。
- 武器本地化：2581 / 2581 / 2581 条配置分别缺少中/日/英本地化名称；运行时仍有非空的通用显示名作为回退。
- 武器命名：384 个唯一武器 ID 仍使用泛称或占位名，详见《docs/imports/weapon-names.md》。

### 缺少日文单位名

Army_Squad_EFSF_0079_N_G_A、Type61、Type74、AntiZakuTank、FanFan、EF_Heli、FF_4、FF_B2、FF_6、FF_S3、RFF_06、Medea、EF_TorpedoBoat、BurkeClass、U_Type_Submarine、HimalayaClass、ColumbusClass、RGM_79_E、Type61A5、Type74Kai、Type61_SPG、MissileCar、EF_MinigunAPC、Dash、DEPP_ROG、DonEscargot、RB_79K、RB_79、M_Type_Submarine、MiniTrayClass、RX_79_G_WithBackpack、RGM_79_G_WithBackpack、RGM_79_G_SPACE、RGM_79_G_SP、RX_75R、RB_79N、RB_79M、BigTrayClass、MagellanClass、RX_78_2、RX_77_2、RX_75、FF_X7Bst、FFB_7Bst、Gunperry、PegasusClass、MagellanClass_Green、RGM_79_Commander、MedeaKai、RX_79_BD_1、RX_80PR、HeavyForkClass、RX_80PR_GroundType、RX_80PR_2、RX_79_BD_2、RGM_79DO、RX_77_3、RX_77_3D、RX_78XX、RTX_440、RMV_1、Army_Squad_ZEON_0079_N_G_A、MTank、SamsonGroundTransportTruck、ZN_APC、Wappa、ZN_Heli、FatUncle、Dopp、DodaiYS、MS_05、MS_06C、MS_06S、Gattle、JiccoClass、U_Type_Submarine_ZEON、MusaiClass、PapuaClass、MS_07B、MS_06M、MS_06R_1、MS_06F_MineLayer、MSM_03、Cui、Luggun、ZN_APC_WithMS、M_Type_Submarine_ZEON、FalmerClass、MS_07B3、MS_06G、MS_06E、MS_06R_1A、MS_06D、MS_06V、MTank_Eins、MSM_04、DabudeClass、ChivvayClass、MS_07A、MAX_03、GawClass、GallopClass、ZanzibarClass、GwazineClass、MS_06F2_Commander、MS_05SP、MS_06JK、MS_09D、FatUncleKai、EMS_10、EMS_10_1、MP_02A、YMT_05、JotunheimClass、MS_10、MS_11、MS_11S、MS_12、MS_08TX、MS_07H、MS_08TX_Kai、ApsarasII、MS_07H8、RX_79_BD_1_EXAM、RX_80PR_HADES、RX_80PR_GroundType_HADES、RX_80PR_2_HADES、RX_79_BD_2_EXAM、MS_08TX_Kai_EXAM、MTank_Top、MTank_Chassis、YMT_05_ModeB、RX_78NT_1、RX_78NT_1_FA、FA_78_1、FA_78_1_NA、RGC_80S、RGM_79SC、RGM_79HC、RAG_79、RGM_79V、RX_78_3、PublicClass、SalamisClassLateType、ColumbusClassKai、RGM_79G、RGM_79G_Space、RGM_79D、RAG_79_G1、MagellanClassLateType、RGM_79SP2、RX_77D、RGM_79LV、GrayPhantomClass、RB_79_LateType、RX_77_4、RX_81ST、RX_81LA、RX_81AS、RX_81、RX_78GP01、RX_78GP01_FB、RX_78GP02A、RX_78GP03S、RGM_79N、RGC_83、RX_81FC、RX_78GP03D、AlbionClass、BirminghamClass、MagellanClassKai、SalamisClassKai、FF_X_II、FF_X_II_FB、RX_78_4_Bst、RX_78_5_Bst、RX_80PR_SpaceType、RGM_79GL、RGM_79FP、RGM_79FD、RGM_79S、RX_78SP、RX_78_6、RGM_79_D、Burstliner、RX_78_7、FA_78_3、FA_78_2、FA_78_G、MSM_07、MSM_07S、MS_06R_2、MS_06F_Sniper、MS_09_K_1、MA_05、YMS_09J、MusaiClassLateType、PazockClass、MS_14S、MS_15A、YMS_15、MAN_03、ChivvayClassKai、MS_06FZ、MS_06FZ_Commander、MS_09R2、MS_18E、ZanzibarClassKai、MA_08、MAN_08、MS_09F、MSN_02、MS_14B、MS_14C、MS_14JG、MS_21C、MS_09F_TROP_0083、MS_09S、MS_14F、MS_14FS、MS_15F、MS_15FS、MA_06、AMX_002、GwanzanClass、ZanzibarClassKai_0083、MusaiClassLateType_0083、MS_09G、MS_09F_TROP、MS_09_K_2、MS_17、Skiure、YMS_15E、MS_15Kg、MS_15B、MS_15C、MSM_10、MAM_07、MSM_04G、MSM_04N、MSM_08、MSM_03C、MSM_07E、YMS_18、EMS_10F、RX_80PR_SpaceType_HADES、MSN_02_Head、MS_06Z、MSN_01、AMS_Squad、Apsaras、ApsarasIII、Dodai2、EMS_05M、FF_X7Bst_II、G_Bull_Easy、G_Fighter、MA_04X、MA_08_DZL、MS_05S、MS_06E3、MS_06F_EFSF、MS_06R_2_JonCustom、MS_06R_2_MsgCustom、MS_06R_3S、MS_06RD_4、MS_06S_CharCustom、MS_06S_DozleCustom、MS_09R_CharCustom、MS_14B_JonCustom、MS_14G、MS_14JG_MsgCustom、MS_14S_CharCustom、MS_17R、MSM_07_CharCustom、BlancRival、Thoroughbred、WhiteBase、RGM_79F、RGM_79G_EarlyDeployment、RGM_79U、RX_78_2_ACE、RX_78_2_BPart、RX_78_4、RX_78_5、RX_78_6_WIP、RX_79_BD_2_NMBS、RX_79_BD_3、RX_79_G_Ez8、RX_79_G_Ez8_WithBackpack、RX_81LA_IMBA、SFU_X79、YMS_09、YMS_15_MQVCustom、RX_79_BD_2_NMBS_EXAM、RX_79_BD_3_EXAM、AMS_Squad_Deploy、FatUncle_DeployState、FatUncleKai_DeployState、Gunperry_DeployState、Medea_DeployState、MedeaKai_DeployState、MS_06V_DeployState、RX_75R_DeployState、Type61_SPG_DeployState、RMS_179_AEUG、RGC_83_AEUG、RGM_79N_AEUG、RGM_79C_KS、MS_06M_0087、MS_07H_0087、GrayPhantomClass_0087、SalamisClassKai_0087_AEUG、RX_098、DodaiKai、RX_77D_4、RGM_79N_FB_AEUG、RMS_099、RX_178_AEUG、MSA_003、RMS_179_Nemo、IrishClass、MSN_100、MSK_008、RX_178_AEUG_FlyingArmor、RX_178_AEUG_FXA_05D、GarudaClass_AEUG、MSA_005、MSA_004、ArgamaClass、MSZ_000、MSA_003_FXA_05D、MSA_003_FXA_05D_EWAC、MSA_003_Cannon、MSR_00100S、MSA_003_HM、MSZ_006、MSF_007、MSA_004K、RMS_099B_Red、MSZ_006A1、MSZ_006C1、MSZ_010、MSZ_008、MSA_099_2、RGM_86R、RGM_86R_FXA_05D、RGM_86R_Nouvel、MSZ_010S、FA_010S、FA_010A、FA_00100S、MSR_00100S_M、MSA_005S、MSA_005K、MSN_001、MSA_0011、MSA_007、MSA_007T、MSA_0011_Ext、MSA_007E、RMS_106、RMS_179_TITANS、RGC_83_TITANS、RGM_79Q、SalamisClassKai_0087_TITANS、RX_178、RMS_117、RGM_79Q_ChobamArmor、BaseJabber、Gator、RMS_108、RMS_179_FedayeenRifle、AlexandriaClass、RX_160、NRX_044_TR_3、RX_178_Unit4、GarudaClass_TITANS、NRX_044、RX_110、RMS_154、DogosseGiarClass、RX_121、RX_121_1、RX_121_HighMobilityForm、RX_121_TripleBooster、RMS_106CS、RMS_119、RX_121_1_FF_X29A、MRX_009、RX_121_2A、RX_121_2A_M、RX_139、ORX_005、PMX_000、PMX_003、PMX_002、PMX_001、RMS_154_Kai、RX_124、RX_121_3C、ORX_005_TR_5、RGM_86R_EFSF、RX_124_FF_X39A、ORX_005_TR_5_FF_X39A、RX_124_Kehaar2、RX_124_Kehaar2_M、MRX_010、NRX_055、MS_09R_Stutzer、MS_06F_Stutzer、ZanzibarClassKai_0087、MusaiClassFinalType、MS_14A_Stutzer、MS_09SS、MS_15K、AGX_04A1、GwanbanClass、RMS_099_NEO_ZEON、RMS_106_NEO_ZEON、GarudaClass_NEO_ZEON、AMX_003、RMS_119_NEO_ZEON、GwadanClass、MS_14J、AMX_004_1、AMX_006、AMX_009、RMS_099B_NEO_ZEON、AMX_101、AMX_101K、AMX_102、AMX_103、AMX_109、AMX_008、AMX_004G、AMA_01X、AMX_011、AMX_014、AMX_107、AMX_107M

## 全局战斗载荷仍待实现

这些项目来自仓库 `docs/maintenance/roadmap.md`，部分原 MOD 武器已经保存对应载荷数据，但规则层尚未结算：

- 火焰持续伤害。
- 硬直导致 AP 减半。
- 压制导致移动力减半。
- 射击、格斗和指定属性伤害下降。
- 指定防御属性下降。
- 武器穿甲效率。

## 审计边界

本报告核对 JSON 状态、技能类型和文本字段。贴图层级、炮口、动画、声音与多人演出仍需在浏览器中逐单位目视验证；自动化通过不能替代全部单位的人工演出检查。
