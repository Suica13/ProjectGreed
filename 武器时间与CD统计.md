# 武器发射流程与CD统计

共1386条单位—武器配置，按ID、来源、流程、发数、消耗等去重后703组；包含隐藏武器与强化形态，hidden字段可筛选。不是只统计武器名称。

- 流程时间包含原MOD准备、射击、收招，不包含本项目弹道飞行、命中、死亡动画或每单位0～1秒随机延迟。
- CD单独记录：普通动作在开火开始设置CD；自动炮塔通常在弹仓耗尽后进入CD。参考循环取普通动作max(流程,CD)、自动炮塔流程+CD，未计移位、瞄准、驾驶员或特定条件加成。
- emissions是发射动作/炮口次数，projectiles是含霰弹的弹体数；舰炮含全部完好模块。连射中每弹的数值保存在JSON时间线中，不把副炮、左右炮位或不同弹丸重复叠加。
- 原ProjectileAttackTimes是弹体可命中目标容量，不是对同一单位重复伤害；本次不将其改成多段连击。DP、烧灼等原生载荷另存nativePayload，未声称已实现原RTS全部异常状态。
- 声明的_EN宏不等于实际扣费：例如部分战舰迫击炮只用宏做AI门槛，没有price/addResources/UseEN扣费。本表按实际执行的资源操作统计，同时保留declaredEnergy供核对；不擅自补上原MOD未执行的消费。
- 当前已接入AP限制的单目标多武器顺序攻击；本报告记录原始流程，多目标攻击尚未接入。

## 当前AP攻击流程

每单位默认5 AP，先选一个敌人再按顺序添加武器，可重复同一武器；每次分别消耗其AP和EN。流程秒数与CD仅作原生演出参考，不作为本回合次数限制。
光束步枪/火箭筒2 AP，机枪扫射3，头部火神炮1，手臂/内藏武装2，加农炮/舰炮3。格斗、光束喷枪、导弹2，航空炸弹3。零EN武器也必须支付AP。
狙击蓄力与迫击炮作为技能武器独占行动。普通航空投弹可进入AP序列；舰炮按一类完好模块齐射消费一次武器AP。同一单位依次演出，不同单位并行；防守统一选择一次，目标死亡后取消剩余武器。

## 按CD分类

| 分类 | 单位—武器条目数 |
| --- | ---: |
| 慢循环（5～10秒） | 232 |
| 长冷却（>10秒） | 169 |
| 快循环（≤2秒） | 244 |
| 中循环（2～5秒） | 741 |

## 按流程时间分类

| 分类 | 单位—武器条目数 |
| --- | ---: |
| 极短流程（≤0.5秒） | 195 |
| 短流程（0.5～2秒） | 993 |
| 长流程（>5秒） | 39 |
| 中流程（2～5秒） | 159 |

## bazooka

| 武器ID | 首发/末发(s) | 收招/流程(s) | CD(s) | 发数 | EN | 使用单位 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| ZN_270mmBazooka | 0.35/0.35 | 0.3/0.65 | 4.5 | 1 | 55.0 | EMS_10, EMS_10_1, MS_06F, MS_06F_MineLayer, MS_06J, MS_06R_1, MS_06R_1A, MS_06S, MS_07A, MS_07H |
| ZN_Panzerfaust_Orange | 0.25/0.25 | 0.25/0.5 | 12.0 | 1 | 40.0 | EMS_10, EMS_10_1 |
| ZN_360mmBazooka | 0.35/0.35 | 0.3/0.65 | 4.0 | 1 | 55.0 | EMS_10F, MS_09F, MS_14S, MS_17 |
| ZN_Panzerfaust | 0.25/0.25 | 0.25/0.5 | 12.0 | 1 | 40.0 | EMS_10F, MS_09G, MS_14F, MS_14FS, MSM_08 |
| ZN_270mmBazooka | 0.35/0.35 | 0.3/0.65 | 4.5 | 1 | 55.0 | MP_02A |
| ZN_270mmBazookaEarly | 0.35/0.35 | 0.3/0.65 | 4.5 | 1 | 55.0 | MS_05 |
| ZN_Panzerfaust | 0.25/0.25 | 0.25/0.5 | 12.0 | 1 | 40.0 | MS_06F2, MS_06F2_Commander, MS_09D, MS_09F_TROP, MS_09F_TROP_0083, MS_21C |
| ZN_360mmBazooka | 0.35/0.35 | 0.3/0.65 | 4.0 | 1 | 55.0 | MS_06F2, MS_06F2_Commander, MS_06G, MS_06R_2, MS_08TX, MS_09D, MS_10 |
| ZN_270mmBazooka | 0.35/0.35 | 0.3/0.65 | 4.5 | 1 | 55.0 | MS_06FZ, MS_06FZ_Commander |
| ZN_380mmBazooka | 0.35/0.35 | 0.3/0.65 | 4.0 | 1 | 55.0 | MS_09, MS_09R |
| ZN_880mmBazooka | 0.35/0.35 | 0.3/0.65 | 6.5 | 1 | 90.0 | MS_09F_TROP, MS_09F_TROP_0083 |
| ZN_360mmBazooka_D | 0.35/0.35 | 0.3/0.65 | 4.0 | 1 | 55.0 | MS_09G, YMS_09J |
| ZN_360mmBazookaKai | 0.35/0.35 | 0.3/0.65 | 4.0 | 1 | 55.0 | MS_09R2, MS_09S, MS_14F, MS_14FS |
| ZN_Panzerfaust_Orange | 0.25/0.25 | 0.25/0.5 | 12.0 | 1 | 40.0 | MS_09R2, MS_09S |
| ZN_BeamBazooka | 0.45/0.45 | 0.45/0.9 | 10.0 | 1 | 120.0 | MS_10 |
| ZN_360mmBazooka | 0.35/0.35 | 0.3/0.65 | 4.0 | 1 | 55.0 | MS_14A |
| ZN_360mmBazookaShortVer | 0.35/0.35 | 0.3/0.65 | 3.0 | 1 | 45.0 | MS_14B, MS_14C |
| ZN_360mmBazookaKai_Double | 0.35/0.5 | 0.45/0.95 | 7.0 | 2 | 90.0 | MS_18E, YMS_18 |
| ZN_360mmBazookaKai_Double_L | 0.35/0.5 | 0.45/0.95 | 7.0 | 2 | 90.0 | MS_18E, YMS_18 |
| ZN_Panzerfaust_Double | 0.25/0.35 | 0.25/0.6 | 15.0 | 2 | 40.0 | MS_18E |
| ZN_Panzerfaust_Double_L | 0.25/0.35 | 0.25/0.6 | 15.0 | 2 | 40.0 | MS_18E |
| EF_BalzacBazooka | 0.35/0.35 | 0.3/0.65 | 3.0 | 1 | 35.0 | RGC_80S, RX_77_3D |
| EF_HypeBazooka | 0.35/0.35 | 0.3/0.65 | 4.0 | 1 | 55.0 | RGM_79, RGM_79_Commander, RGM_79_E, RGM_79HC, RGM_79SC |
| EF_GroundTypeBazooka | 0.35/0.35 | 0.3/0.65 | 4.5 | 1 | 55.0 | RGM_79_G, RGM_79_G_SPACE, RGM_79_G_WithBackpack |
| EF_HypeBazookaKai | 0.35/0.35 | 0.3/0.65 | 3.5 | 1 | 50.0 | RGM_79C, RGM_79C_Space, RGM_79N, RX_78GP01, RX_78GP01_FB |
| EF_HypeBazooka | 0.35/0.35 | 0.3/0.65 | 4.0 | 1 | 55.0 | RGM_79D, RGM_79DO, RGM_79FD, RGM_79FP, RGM_79G, RGM_79G_Space, RGM_79GL, RGM_79LV, RGM_79SP2, RX_78_2, RX_78_4_Bst, RX_78_5_Bst, RX_81 |
| EF_HypeBazooka | 0.35/0.35 | 0.3/0.65 | 4.0 | 1 | 55.0 | RX_78_1 |
| EF_HypeBazooka_Double | 0.35/0.5 | 0.45/0.95 | 5.0 | 2 | 90.0 | RX_78_3 |
| EF_HypeBazooka_Double_L | 0.35/0.5 | 0.45/0.95 | 5.0 | 2 | 90.0 | RX_78_3 |
| EF_RX_78GP02A_BeamBazooka | 0.45/0.45 | 0.45/0.9 | 6.0 | 1 | 120.0 | RX_78GP02A |
| EF_HypeBazooka_GP03S_Double | 0.35/0.95 | 0.5/1.45 | 10.0 | 4 | 80.0 | RX_78GP03D, RX_78GP03S |
| EF_HypeBazooka_GP03S_Double_L | 0.35/0.95 | 0.5/1.45 | 10.0 | 4 | 80.0 | RX_78GP03D, RX_78GP03S |
| EF_HypeBazooka_NT_1 | 0.35/0.35 | 0.3/0.65 | 2.5 | 1 | 55.0 | RX_78NT_1, RX_78NT_1_FA |
| EF_GroundTypeBazooka | 0.35/0.35 | 0.3/0.65 | 4.5 | 1 | 55.0 | RX_79_G |
| EF_GroundTypeBazooka | 0.35/0.35 | 0.3/0.65 | 4.5 | 1 | 55.0 | RX_79_G_WithBackpack, RX_80PR, RX_80PR_GroundType, RX_80PR_GroundType_HADES, RX_80PR_HADES, RX_80PR_SpaceType, RX_80PR_SpaceType_HADES |

## beam_gun

| 武器ID | 首发/末发(s) | 收招/流程(s) | CD(s) | 发数 | EN | 使用单位 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| ZN_MS_15Kg_ShieldBeamGun | 0.25/0.5 | 0.5/1.0 | 2.0 | 2 | 25.0 | MS_15Kg |
| EF_BeamSprayGun | 0.25/0.25 | 0.25/0.5 | 2.0 | 1 | 25.0 | RGC_80, RGC_80S, RGM_79, RGM_79SC |
| EF_BeamGun | 0.25/0.25 | 0.25/0.5 | 1.25 | 1 | 25.0 | RGM_79_Commander |
| EF_BeamSprayGunFD | 0.25/0.25 | 0.5/0.75 | 2.0 | 6 | 40.0 | RGM_79_D, RGM_79FD |
| EF_BeamSprayGunB2 | 0.25/0.5 | 0.5/1.0 | 2.0 | 2 | 25.0 | RGM_79C, RGM_79C_Space |
| EF_BeamGun | 0.25/0.25 | 0.25/0.5 | 1.25 | 1 | 25.0 | RGM_79G, RGM_79G_Space, RGM_79GL |
| EF_BeamSprayGunE2 | 0.25/0.25 | 0.25/0.5 | 2.0 | 8 | 40.0 | RGM_79HC |
| EF_BOWA_BeamGun | 0.15/0.15 | 0.15/0.3 | 1.25 | 1 | 25.0 | RGM_79L, RGM_79V |
| EF_BOWA_BeamGun | 0.15/0.15 | 0.15/0.3 | 1.25 | 1 | 25.0 | RGM_79LV |

## beam_rifle

| 武器ID | 首发/末发(s) | 收招/流程(s) | CD(s) | 发数 | EN | 使用单位 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| EF_FA_78_1_BR | 0.25/0.25 | 0.25/0.5 | 2.0 | 2 | 60.0 | FA_78_1, FA_78_1_NA |
| EF_FA_78_1_BR_R | 0.25/0.25 | 0.25/0.5 | 2.0 | 2 | 60.0 | FA_78_1, FA_78_1_NA |
| EF_RX_78_7_BR | 0.25/0.25 | 0.25/0.5 | 1.5 | 1 | 40.0 | FA_78_3, RX_78_7 |
| Common_ArmBR_Pink | 0.1/0.3 | 0.3/0.6 | 3.0 | 3 | 25.0 | FA_78_3, RX_78_4_Bst, RX_78_5_Bst, RX_78_7 |
| EF_FA_78_G_BR | 0.25/0.62 | 0.25/0.87 | 3.0 | 4 | 60.0 | FA_78_G |
| EF_FA_78_G_BR_R | 0.25/0.62 | 0.25/0.87 | 3.0 | 4 | 60.0 | FA_78_G |
| EF_FF_X7Bst_BR | 0.0/0.1 | 0.3/0.4 | 5.0 | 2 | 50.0 | FF_X7Bst |
| EF_FF_X7Bst_BR_R | 0.0/0.1 | 0.3/0.4 | 5.0 | 2 | 50.0 | FF_X7Bst |
| EF_FF_X_II_BR | 0.0/0.1 | 0.3/0.4 | 4.0 | 2 | 50.0 | FF_X_II, FF_X_II_FB |
| EF_FF_X_II_BR_R | 0.0/0.1 | 0.3/0.4 | 4.0 | 2 | 50.0 | FF_X_II, FF_X_II_FB |
| EF_FFB_7Bst_BR | 0.0/0.0 | 0.3/0.3 | 5.0 | 1 | 40.0 | FFB_7Bst |
| ZN_MA_06_BR | 0.0/0.1 | 0.1/0.2 | 6.0 | 2 | 50.0 | MA_06 |
| ZN_MA_06_BR_R | 0.0/0.1 | 0.1/0.2 | 6.0 | 2 | 50.0 | MA_06 |
| ZN_ACT_Zaku_BR | 0.25/0.25 | 0.25/0.5 | 1.5 | 1 | 25.0 | MS_11, MS_11S |
| ZN_MS_14_BR | 0.25/0.25 | 0.25/0.5 | 2.0 | 1 | 40.0 | MS_14A, MS_14B, MS_14C, MS_14F, MS_14FS, MS_14S |
| ZN_MS_17_BR | 0.25/0.25 | 0.25/0.5 | 2.0 | 1 | 40.0 | MS_17 |
| ZN_MSM_10_HighBeamRifle | 0.85/1.95 | 1.5/3.45 | 90.0 | 22 | 150.0 | MSM_10 |
| ZN_MSN_02_Head_BR | 0.25/0.25 | 0.25/0.5 | 2.0 | 1 | 35.0 | MSN_02_Head |
| EF_BeamRifleAuqa | 0.25/0.25 | 0.25/0.5 | 2.0 | 1 | 25.0 | RAG_79_G1 |
| EF_RMS_179_BR | 0.25/0.25 | 0.25/0.5 | 2.0 | 1 | 40.0 | RGC_83, RGM_79N |
| EF_GMRifle | 0.3/0.9 | 0.3/1.2 | 2.0 | 7 | 35.0 | RGC_83, RGM_79N |
| EF_GroundTypeBeamRifle | 0.25/0.25 | 0.25/0.5 | 3.5 | 1 | 40.0 | RGM_79_G, RGM_79_G_SPACE, RGM_79_G_WithBackpack, RX_79_G, RX_79_G_WithBackpack, RX_80PR, RX_80PR_GroundType, RX_80PR_GroundType_HADES, RX_80PR_HADES |
| EF_LongRifle | 0.3/2.275 | 0.3/2.575 | 3.5 | 12 | 45.0 | RGM_79C, RGM_79C_Space |
| EF_RGM_79DO_BR | 0.25/0.25 | 0.25/0.5 | 3.0 | 2 | 60.0 | RGM_79DO |
| EF_RGM_79DO_BR_R | 0.25/0.25 | 0.25/0.5 | 3.0 | 2 | 60.0 | RGM_79DO |
| EF_RX_77_2_BR | 0.35/0.35 | 0.55/0.9 | 5.0 | 1 | 40.0 | RX_77_2, RX_77_3, RX_77_3D, RX_77_4 |
| EF_RX_78_1_BR | 0.25/0.25 | 0.25/0.5 | 2.5 | 1 | 40.0 | RX_78_1 |
| EF_RX_78_2_BR | 0.25/0.25 | 0.25/0.5 | 2.0 | 1 | 40.0 | RX_78_2 |
| EF_RX_78_3_BR | 0.25/0.25 | 0.25/0.5 | 1.0 | 1 | 25.0 | RX_78_3 |
| EF_HyperBeamRifle | 0.25/0.25 | 0.25/0.5 | 2.0 | 1 | 45.0 | RX_78_4_Bst, RX_78_5_Bst, RX_80PR_2, RX_80PR_2_HADES, RX_80PR_SpaceType, RX_80PR_SpaceType_HADES |
| Common_ArmBR_Pink_L | 0.1/0.3 | 0.3/0.6 | 3.0 | 3 | 25.0 | RX_78_4_Bst, RX_78_5_Bst |
| EF_RX_78_6_BR | 0.25/0.65 | 0.25/0.9 | 2.0 | 3 | 40.0 | RX_78_6 |
| EF_RX_78GP01_BR | 0.25/0.5 | 0.25/0.75 | 1.5 | 2 | 40.0 | RX_78GP01, RX_78GP01_FB, RX_78GP03D, RX_78GP03S |
| EF_RX_78NT_1_BR | 0.25/0.5 | 0.25/0.75 | 1.5 | 2 | 50.0 | RX_78NT_1, RX_78NT_1_FA |
| EF_RX_78SP_BR | 0.35/0.5 | 1.0/1.5 | 4.0 | 2 | 40.0 | RX_78SP |
| EF_GroundTypeBeamRifle_Blue | 0.25/0.25 | 0.25/0.5 | 2.0 | 1 | 35.0 | RX_79_BD_1, RX_79_BD_1_EXAM, RX_79_BD_2, RX_79_BD_2_EXAM |
| Common_ArmBR_Pink | 0.1/0.3 | 0.3/0.6 | 3.0 | 3 | 25.0 | RX_80PR, RX_80PR_GroundType, RX_80PR_GroundType_HADES, RX_80PR_HADES, RX_80PR_SpaceType, RX_80PR_SpaceType_HADES |
| Common_ArmBR_Pink_L | 0.1/0.3 | 0.3/0.6 | 3.0 | 3 | 25.0 | RX_80PR, RX_80PR_GroundType, RX_80PR_GroundType_HADES, RX_80PR_HADES, RX_80PR_SpaceType, RX_80PR_SpaceType_HADES |
| EF_RX_80_PR_2_FrameLauncher_BR | 0.35/0.35 | 1.0/1.35 | 6.0 | 1 | 40.0 | RX_80PR_2, RX_80PR_2_HADES |
| ZN_YMS_15E_Lance_BR | 0.25/0.55 | 0.25/0.8 | 3.0 | 3 | 25.0 | YMS_15E |

## bomb

| 武器ID | 首发/末发(s) | 收招/流程(s) | CD(s) | 发数 | EN | 使用单位 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Common_Bomb_DEPP_ROG | 0.0/1.4 | 0.3/1.7 | 6.0 | 8 | 90.0 | DEPP_ROG |
| Common_Bomb_DEPP_ROG_L | 0.0/1.4 | 0.3/1.7 | 6.0 | 8 | 90.0 | DEPP_ROG |
| Common_Bomb_DonEscargot | 0.0/0.3 | 0.3/0.6 | 5.0 | 2 | 30.0 | DonEscargot |
| Common_Bomb_DonEscargot_L | 0.0/0.3 | 0.3/0.6 | 5.0 | 2 | 30.0 | DonEscargot |
| Common_Bomb_FF_B2 | 0.0/0.3 | 0.3/0.6 | 5.0 | 2 | 45.0 | FF_B2 |
| Common_Bomb_FF_B2_L | 0.0/0.3 | 0.3/0.6 | 5.0 | 2 | 45.0 | FF_B2 |
| Common_Bomb_FFB_7Bst | 0.0/0.0 | 0.3/0.3 | 5.0 | 1 | 30.0 | FFB_7Bst |
| Common_Bomb_FFB_7Bst_L | 0.0/0.0 | 0.3/0.3 | 5.0 | 1 | 30.0 | FFB_7Bst |
| GawClass_Turret_Bomb | 0.0/1.8 | 0.0/1.8 | 12.0 | 20 | 240.0 | GawClass |
| Common_Bomb_Luggun | 0.0/0.0 | 0.3/0.3 | 5.0 | 1 | 30.0 | Luggun |
| Common_Bomb_Luggun_L | 0.0/0.0 | 0.3/0.3 | 5.0 | 1 | 30.0 | Luggun |
| EF_RX_78GP02A_Bombing_Nuke | 3.0/3.0 | 1.5/4.5 | 10000.0 | 1 | 600.0 | RX_78GP02A |

## cannon

| 武器ID | 首发/末发(s) | 收招/流程(s) | CD(s) | 发数 | EN | 使用单位 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| AlbionClass_Turret_BeamCannon | 0.0/0.2 | 0.0/0.2 | 6.0 | 4 | 160.0 | AlbionClass |
| AlbionClass_Turret_MegaBeamCannon | 0.0/2.0 | 0.0/2.0 | 8.0 | 8 | 480.0 | AlbionClass |
| AlbionClass_Turret_MegaBeamCannon_L | 0.0/2.0 | 0.0/2.0 | 8.0 | 8 | 0.0 | AlbionClass |
| AlbionClass_Turret_MegaBeamCannon_R | 0.0/2.0 | 0.0/2.0 | 8.0 | 8 | 0.0 | AlbionClass |
| ZN_AMX_002_MegaBeamCannon | 2.1/7.4 | 3.0/10.4 | 180.0 | 108 | 150.0 | AMX_002 |
| ZN_AMX_002_BeamCannon | 0.45/0.45 | 0.45/0.9 | 7.0 | 1 | 75.0 | AMX_002 |
| ZN_ApsarasII_MegaBeamCannon | 2.6/7.3 | 3.0/10.3 | 240.0 | 96 | 400.0 | ApsarasII |
| EF_BigTrayClass_MainCannon | 3.2/3.2 | 1.5/4.7 | 120.0 | 2 | 0 | BigTrayClass |
| EF_BigTrayClass_MainCannon_L | 3.2/3.2 | 1.5/4.7 | 120.0 | 2 | 0 | BigTrayClass |
| BigTrayClass_Turret_Cannon | 0.0/0.2 | 0.0/0.2 | 9.0 | 9 | 450.0 | BigTrayClass |
| BirminghamClass_Turret_BeamCannon | 0.0/0.2 | 0.0/0.2 | 6.0 | 18 | 720.0 | BirminghamClass |
| BurkeClass_Turret_CN | 0.0/0.0 | 0.0/0 | 3.0 | 1 | 40.0 | BurkeClass |
| EF_Burstliner_BeamCannon | 2.1/7.4 | 3.0/10.4 | 180.0 | 108 | 150.0 | Burstliner |
| ChivvayClass_Turret_BeamCannon | 0.0/0.0 | 0.0/0 | 4.0 | 6 | 360.0 | ChivvayClass |
| ChivvayClassKai_Turret_BeamCannon | 0.0/0.0 | 0.0/0 | 4.0 | 6 | 360.0 | ChivvayClassKai |
| DabudeClass_Turret_Cannon | 0.0/0.1 | 0.0/0.1 | 8.0 | 4 | 240.0 | DabudeClass |
| EF_TorpedoBoat_Cannon | 0.0/0.0 | 0.0/0 | 3.0 | 1 | 5.0 | EF_TorpedoBoat |
| Common_Cannon | 0.6/0.6 | 1.25/1.85 | 9.0 | 1 | 55.0 | FA_78_1, FA_78_G, RX_81AS |
| EF_FA_78_2_BeamCannon | 0.6/0.6 | 1.25/1.85 | 5.5 | 1 | 80.0 | FA_78_2 |
| EF_RX_77_4_BeamCannon | 0.6/0.6 | 1.25/1.85 | 8.0 | 1 | 80.0 | FA_78_3 |
| FalmerClass_Turret_BeamCannon | 0.0/0.0 | 0.0/0 | 7.0 | 6 | 180.0 | FalmerClass |
| GallopClass_Turret_Cannon | 0.0/0.1 | 0.0/0.1 | 9.0 | 2 | 100.0 | GallopClass |
| GawClass_Turret_BeamCannon | 0.0/0.0 | 0.0/0 | 7.0 | 4 | 120.0 | GawClass |
| GrayPhantomClass_Turret_Cannon | 0.0/3.0 | 0.0/3.0 | 8.0 | 6 | 240.0 | GrayPhantomClass |
| GrayPhantomClass_Turret_Cannon_L | 0.0/3.0 | 0.0/3.0 | 8.0 | 6 | 240.0 | GrayPhantomClass |
| GrayPhantomClass_Turret_Cannon_R | 0.0/3.0 | 0.0/3.0 | 8.0 | 6 | 240.0 | GrayPhantomClass |
| GrayPhantomClass_Turret_MegaBeamCannon | 0.0/2.0 | 0.0/2.0 | 8.0 | 12 | 720.0 | GrayPhantomClass |
| GrayPhantomClass_Turret_MegaBeamCannon_L | 0.0/2.0 | 0.0/2.0 | 8.0 | 12 | 720.0 | GrayPhantomClass |
| GrayPhantomClass_Turret_MegaBeamCannon_R | 0.0/2.0 | 0.0/2.0 | 8.0 | 12 | 720.0 | GrayPhantomClass |
| GwanzanClass_Turret_BeamCannon | 0.0/0.0 | 0.0/0 | 5.0 | 6 | 240.0 | GwanzanClass |
| GwazineClass_Turret_MegaBeamCannon | 0.0/2.0 | 0.0/2.0 | 8.0 | 18 | 1080.0 | GwazineClass |
| GwazineClass_Turret_MegaBeamCannon_L | 0.0/2.0 | 0.0/2.0 | 8.0 | 18 | 1080.0 | GwazineClass |
| GwazineClass_Turret_MegaBeamCannon_R | 0.0/2.0 | 0.0/2.0 | 8.0 | 18 | 1080.0 | GwazineClass |
| HeavyForkClass_Turret_Cannon | 0.0/0.2 | 0.0/0.2 | 8.0 | 9 | 450.0 | HeavyForkClass |
| HimalayaClass_Turret_CN | 0.0/0.3 | 0.0/0.3 | 4.0 | 4 | 160.0 | HimalayaClass |
| JotunheimClass_Turret_BeamCannon | 0.0/0.0 | 0.0/0 | 7.0 | 1 | 40.0 | JotunheimClass |
| ZN_MA_05_BeamCannon | 0.45/0.45 | 0.45/0.9 | 9.0 | 1 | 120.0 | MA_05 |
| ZN_MA_06_BeamCannon | 0.35/0.35 | 0.35/0.7 | 9.0 | 1 | 120.0 | MA_06 |
| ZN_MA_08_MegaBeamCannon | 2.6/7.3 | 3.0/10.3 | 240.0 | 96 | 400.0 | MA_08 |
| ZN_MA_08_AA_BeamCannon | 0.0/0.0 | 0.0/0 | 180.0 | 14 | 2520.0 | MA_08 |
| ZN_MA_08_AA_BeamCannon_L | 0.0/0.0 | 0.0/0 | 180.0 | 14 | 2520.0 | MA_08 |
| ZN_MA_08_AA_BeamCannon_R2 | 0.0/0.0 | 0.0/0 | 180.0 | 14 | 2520.0 | MA_08 |
| ZN_MA_08_AA_BeamCannon_L2 | 0.0/0.0 | 0.0/0 | 180.0 | 14 | 2520.0 | MA_08 |
| ZN_MA_08_AA_BeamCannon_R3 | 0.0/0.0 | 0.0/0 | 180.0 | 14 | 2520.0 | MA_08 |
| ZN_MA_08_AA_BeamCannon_L3 | 0.0/0.0 | 0.0/0 | 180.0 | 14 | 2520.0 | MA_08 |
| ZN_MA_08_AA_BeamCannon_R4 | 0.0/0.0 | 0.0/0 | 180.0 | 14 | 2520.0 | MA_08 |
| ZN_MA_08_AA_BeamCannon_L4 | 0.0/0.0 | 0.0/0 | 180.0 | 14 | 2520.0 | MA_08 |
| ZN_MA_08_AA_BeamCannon_R5 | 0.0/0.0 | 0.0/0 | 180.0 | 14 | 2520.0 | MA_08 |
| ZN_MA_08_AA_BeamCannon_L5 | 0.0/0.0 | 0.0/0 | 180.0 | 14 | 2520.0 | MA_08 |
| ZN_MA_08_AA_BeamCannon_R6 | 0.0/0.0 | 0.0/0 | 180.0 | 14 | 2520.0 | MA_08 |
| ZN_MA_08_AA_BeamCannon_L6 | 0.0/0.0 | 0.0/0 | 180.0 | 14 | 2520.0 | MA_08 |
| ZN_MA_08_AA_BeamCannon_R7 | 0.0/0.0 | 0.0/0 | 180.0 | 14 | 2520.0 | MA_08 |
| ZN_MA_08_AA_BeamCannon_L7 | 0.0/0.0 | 0.0/0 | 180.0 | 14 | 2520.0 | MA_08 |
| ZN_MA_08_BeamCannon | 0.65/0.65 | 0.65/1.3 | 10.0 | 1 | 120.0 | MA_08 |
| MagellanClass_Turret_BeamCannon | 0.0/0.2 | 0.0/0.2 | 7.0 | 14 | 560.0 | MagellanClass |
| MagellanClass_Turret_BeamCannon | 0.0/0.2 | 0.0/0.2 | 7.0 | 14 | 560.0 | MagellanClass_Green |
| MagellanClassKai_Turret_BeamCannon | 0.0/0.2 | 0.0/0.2 | 6.0 | 14 | 560.0 | MagellanClassKai |
| MagellanClassLateType_Turret_BeamCannon | 0.0/0.2 | 0.0/0.2 | 6.0 | 10 | 400.0 | MagellanClassLateType |
| ZN_MAN_08_BeamCannon | 0.35/0.4 | 1.25/1.65 | 3.5 | 2 | 35.0 | MAN_08 |
| ZN_MAN_08_BeamCannon_L | 0.35/0.4 | 1.25/1.65 | 3.5 | 2 | 35.0 | MAN_08 |
| MiniTrayClass_Turret_Cannon | 0.0/0.0 | 0.0/0 | 7.0 | 6 | 300.0 | MiniTrayClass |
| ZN_MagellaCannon | 0.35/0.35 | 0.3/0.65 | 6.0 | 1 | 45.0 | MS_06J |
| Common_Cannon_AntiAir | 0.6/0.6 | 1.25/1.85 | 9.0 | 1 | 55.0 | MS_06K |
| ZN_MS_06V_Cannon | 0.0/0.0 | 0.0/0 | 7.0 | 2 | 60.0 | MS_06V |
| ZN_MS_06V_Cannon_Fake | 0.0/0.0 | 0.0/0 | 7.0 | 2 | 60.0 | MS_06V |
| Common_Cannon | 0.6/0.6 | 1.25/1.85 | 9.0 | 1 | 55.0 | MS_09_K_1, RGC_80, RGC_80S |
| Common_DoubleCannon | 0.6/0.6 | 1.25/1.85 | 9.0 | 2 | 55.0 | MS_09_K_2, MS_15C, RX_77_2, RX_77_3D, RX_77D |
| Common_DoubleCannon_L | 0.6/0.6 | 1.25/1.85 | 9.0 | 2 | 55.0 | MS_09_K_2, MS_15C, RX_77_2, RX_77_3D, RX_77D |
| ZN_MS_12_Cannon | 0.0/0.0 | 0.0/0 | 6.0 | 1 | 35.0 | MS_12 |
| ZN_MS_14C_BeamCannon | 0.6/0.6 | 1.25/1.85 | 6.0 | 1 | 75.0 | MS_14C |
| ZN_MSN_02_BeamCannon | 0.45/0.46 | 0.45/0.91 | 7.0 | 2 | 120.0 | MSN_02 |
| ZN_MSN_02_BeamCannon_L | 0.45/0.46 | 0.45/0.91 | 7.0 | 2 | 120.0 | MSN_02 |
| ZN_MTank_Cannon | 0.0/0.0 | 0.0/0 | 6.0 | 1 | 35.0 | MTank, MTank_Top |
| ZN_MTank_Eins_Cannon | 0.0/0.0 | 0.0/0 | 3.0 | 1 | 20.0 | MTank_Eins |
| MusaiClass_Turret_BeamCannon | 0.0/0.0 | 0.0/0 | 7.0 | 6 | 180.0 | MusaiClass |
| MusaiClassLateType_Turret_BeamCannon | 0.0/0.0 | 0.0/0 | 7.0 | 10 | 300.0 | MusaiClassLateType |
| MusaiClassLateType_0083_Turret_BeamCannon | 0.0/0.0 | 0.0/0 | 7.0 | 10 | 300.0 | MusaiClassLateType_0083 |
| PegasusClass_Turret_Cannon | 0.0/3.0 | 0.0/3.0 | 8.0 | 6 | 240.0 | PegasusClass |
| PegasusClass_Turret_Cannon_L | 0.0/3.0 | 0.0/3.0 | 8.0 | 6 | 240.0 | PegasusClass |
| PegasusClass_Turret_Cannon_R | 0.0/3.0 | 0.0/3.0 | 8.0 | 6 | 240.0 | PegasusClass |
| PegasusClass_Turret_MegaBeamCannon | 0.0/2.0 | 0.0/2.0 | 8.0 | 12 | 720.0 | PegasusClass |
| PegasusClass_Turret_MegaBeamCannon_L | 0.0/2.0 | 0.0/2.0 | 8.0 | 12 | 720.0 | PegasusClass |
| PegasusClass_Turret_MegaBeamCannon_R | 0.0/2.0 | 0.0/2.0 | 8.0 | 12 | 720.0 | PegasusClass |
| EF_RB_79_Cannon | 0.35/0.35 | 0.3/0.65 | 2.5 | 1 | 40.0 | RB_79 |
| EF_RB_79_LateType_Cannon | 0.35/0.35 | 0.3/0.65 | 2.5 | 1 | 40.0 | RB_79_LateType |
| EF_RB_79K_Cannon | 0.35/0.45 | 0.3/0.75 | 3.0 | 2 | 50.0 | RB_79K |
| EF_RB_79K_Cannon_R | 0.35/0.45 | 0.3/0.75 | 3.0 | 2 | 50.0 | RB_79K |
| EF_RB_79N_Cannon | 0.35/0.35 | 0.3/0.65 | 4.0 | 1 | 40.0 | RB_79N |
| EF_RFF_06_Cannon | 0.35/0.35 | 0.3/0.65 | 5.0 | 1 | 35.0 | RFF_06 |
| EF_RGC_83_DoubleBeamCannon | 0.6/0.6 | 1.25/1.85 | 8.0 | 2 | 80.0 | RGC_83, RX_81FC |
| EF_RGC_83_DoubleBeamCannon_L | 0.6/0.6 | 1.25/1.85 | 8.0 | 2 | 80.0 | RGC_83, RX_81FC |
| EF_180mmCannon | 0.35/0.35 | 0.3/0.65 | 4.0 | 1 | 35.0 | RGM_79_G, RGM_79_G_SPACE, RGM_79_G_WithBackpack |
| EF_RMV_1_Cannon | 0.0/0.1 | 0.0/0.1 | 6.0 | 2 | 60.0 | RMV_1 |
| Common_Cannon_NoStop | 0.6/0.6 | 1.25/1.85 | 9.0 | 1 | 55.0 | RTX_440 |
| EF_RX_75_Cannon | 0.35/0.45 | 0.3/0.75 | 4.0 | 2 | 40.0 | RX_75 |
| EF_RX_75_Cannon_R | 0.35/0.45 | 0.3/0.75 | 4.0 | 2 | 40.0 | RX_75 |
| EF_RX_75R_Cannon | 0/0 | 0/0 | 7 | 2 | 70 | RX_75R |
| EF_RX_75R_Cannon_Fake | 0/0 | 0/0 | 7 | 2 | 70 | RX_75R |
| Common_DoubleCannon_B2 | 0.6/1.2 | 1.25/2.45 | 9.0 | 4 | 55.0 | RX_77_3 |
| Common_DoubleCannon_B2_L | 0.6/1.2 | 1.25/2.45 | 9.0 | 4 | 55.0 | RX_77_3 |
| EF_RX_77_4_BeamCannon | 0.6/0.6 | 1.25/1.85 | 4.0 | 1 | 60.0 | RX_77_3, RX_77_4 |
| Common_DoubleCannon_NoStop | 0.6/0.6 | 1.25/1.85 | 9.0 | 2 | 55.0 | RX_78_6 |
| Common_DoubleCannon_NoStop_L | 0.6/0.6 | 1.25/1.85 | 9.0 | 2 | 55.0 | RX_78_6 |
| EF_RX_78GP03D_BeamCannon | 0.35/0.35 | 0.35/0.7 | 9.0 | 1 | 100.0 | RX_78GP03D |
| EF_180mmCannon | 0.35/0.35 | 0.3/0.65 | 4.0 | 1 | 35.0 | RX_79_G |
| EF_180mmCannon | 0.35/0.35 | 0.3/0.65 | 4.0 | 1 | 35.0 | RX_79_G_WithBackpack |
| EF_180mmCannon_PR | 0.35/0.35 | 0.3/0.65 | 5.0 | 1 | 35.0 | RX_80PR_GroundType, RX_80PR_GroundType_HADES |
| SalamisClass_Turret_BeamCannon | 0.0/0.0 | 0.0/0 | 7.0 | 6 | 240.0 | SalamisClass |
| SalamisClassKai_Turret_BeamCannon | 0.0/0.0 | 0.0/0 | 7.0 | 7 | 280.0 | SalamisClassKai |
| SalamisClassLateType_Turret_BeamCannon | 0.0/0.0 | 0.0/0 | 6.0 | 3 | 120.0 | SalamisClassLateType |
| ZN_Skiure_BeamCannon | 0.65/0.65 | 0.65/1.3 | 12.0 | 1 | 100.0 | Skiure |
| EF_Type61_Cannon | 0.0/0.0 | 0.0/0 | 4.0 | 2 | 16.0 | Type61 |
| EF_Type61A5_Cannon | 0.0/0.05 | 0.0/0.05 | 4.0 | 2 | 16.0 | Type61A5 |
| ZN_YMS_16M_Cannon_AP | 0.35/0.35 | 0.3/0.65 | 9.0 | 1 | 75.0 | YMS_16M |
| ZN_YMS_16M_Cannon_HE | 0.35/0.35 | 0.3/0.65 | 4.0 | 1 | 50.0 | YMS_16M |
| ZN_YMT_05_MainCannon_AP | 0.35/0.35 | 0.3/0.65 | 9.0 | 1 | 75.0 | YMT_05, YMT_05_ModeB |
| ZN_YMT_05_MainCannon_HE | 0.35/0.35 | 0.3/0.65 | 4.0 | 1 | 60.0 | YMT_05, YMT_05_ModeB |
| ZanzibarClass_Turret_Cannon | 0.0/3.0 | 0.0/3.0 | 9.0 | 6 | 240.0 | ZanzibarClass |
| ZanzibarClass_Turret_Cannon_L | 0.0/3.0 | 0.0/3.0 | 9.0 | 6 | 240.0 | ZanzibarClass |
| ZanzibarClass_Turret_Cannon_R | 0.0/3.0 | 0.0/3.0 | 9.0 | 6 | 240.0 | ZanzibarClass |
| ZanzibarClass_Turret_MegaBeamCannon | 0.0/2.0 | 0.0/2.0 | 8.0 | 12 | 720.0 | ZanzibarClass |
| ZanzibarClass_Turret_MegaBeamCannon_L | 0.0/2.0 | 0.0/2.0 | 8.0 | 12 | 720.0 | ZanzibarClass |
| ZanzibarClass_Turret_MegaBeamCannon_R | 0.0/2.0 | 0.0/2.0 | 8.0 | 12 | 720.0 | ZanzibarClass |
| ZanzibarClassKai_Turret_Cannon | 0.0/3.0 | 0.0/3.0 | 9.0 | 6 | 240.0 | ZanzibarClassKai |
| ZanzibarClassKai_Turret_Cannon_L | 0.0/3.0 | 0.0/3.0 | 9.0 | 6 | 240.0 | ZanzibarClassKai |
| ZanzibarClassKai_Turret_Cannon_R | 0.0/3.0 | 0.0/3.0 | 9.0 | 6 | 240.0 | ZanzibarClassKai |
| ZanzibarClassKai_Turret_MegaBeamCannon | 0.0/2.0 | 0.0/2.0 | 8.0 | 12 | 720.0 | ZanzibarClassKai |
| ZanzibarClassKai_Turret_MegaBeamCannon_L | 0.0/2.0 | 0.0/2.0 | 8.0 | 12 | 720.0 | ZanzibarClassKai |
| ZanzibarClassKai_Turret_MegaBeamCannon_R | 0.0/2.0 | 0.0/2.0 | 8.0 | 12 | 720.0 | ZanzibarClassKai |
| ZanzibarClassKai_0083_Turret_MegaBeamCannon | 0.0/2.0 | 0.0/2.0 | 8.0 | 12 | 720.0 | ZanzibarClassKai_0083 |
| ZanzibarClassKai_0083_Turret_MegaBeamCannon_L | 0.0/2.0 | 0.0/2.0 | 8.0 | 12 | 720.0 | ZanzibarClassKai_0083 |
| ZanzibarClassKai_0083_Turret_MegaBeamCannon_R | 0.0/2.0 | 0.0/2.0 | 8.0 | 12 | 720.0 | ZanzibarClassKai_0083 |

## machine_gun

| 武器ID | 首发/末发(s) | 收招/流程(s) | CD(s) | 发数 | EN | 使用单位 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| AlbionClass_Turret_AA | 0.0/0.9 | 0.0/0.9 | 2.0 | 120 | 60.0 | AlbionClass |
| AlbionClass_Turret_AA_2 | 0.0/0.75 | 0.0/0.75 | 2.0 | 12 | 60.0 | AlbionClass |
| EF_AntiZakuTank_MG | 0.0/1.1 | 0.0/1.1 | 2.0 | 12 | 6.0 | AntiZakuTank |
| BigTrayClass_Turret_AA | 0.0/1.35 | 0.0/1.35 | 2.0 | 60 | 30.0 | BigTrayClass |
| BirminghamClass_Turret_AA | 0.0/1.8 | 0.0/1.8 | 2.0 | 100 | 50.0 | BirminghamClass |
| BurkeClass_Turret_MG | 0.0/1.35 | 0.0/1.35 | 1.0 | 20 | 10.0 | BurkeClass |
| ChivvayClass_Turret_MG | 0.0/1.8 | 0.0/1.8 | 1.0 | 60 | 30.0 | ChivvayClass |
| ChivvayClass_Turret_AA | 0.0/1.8 | 0.0/1.8 | 2.0 | 120 | 60.0 | ChivvayClass |
| ChivvayClassKai_Turret_MG | 0.0/1.8 | 0.0/1.8 | 1.0 | 60 | 30.0 | ChivvayClassKai |
| ChivvayClassKai_Turret_AA | 0.0/1.8 | 0.0/1.8 | 2.0 | 120 | 60.0 | ChivvayClassKai |
| ColumbusClass_Turret_AA | 0.0/1.35 | 0.0/1.35 | 2.0 | 40 | 20.0 | ColumbusClass |
| ColumbusClassKai_Turret_AA | 0.0/1.35 | 0.0/1.35 | 2.0 | 40 | 20.0 | ColumbusClassKai |
| ZN_Cui_AA | 0.0/1.9 | 0.0/1.9 | 3.0 | 20 | 10.0 | Cui |
| DabudeClass_Turret_AA | 0.0/1.35 | 0.0/1.35 | 2.0 | 60 | 30.0 | DabudeClass |
| Common_DoubleVulcan_Dash | 0.0/0.525 | 0.1/0.625 | 1.5 | 8 | 10.0 | Dash |
| Common_DoubleVulcan_Dash_L | 0.0/0.525 | 0.1/0.625 | 1.5 | 8 | 10.0 | Dash |
| Common_DoubleVulcan_DonEscargot | 0.0/0.525 | 0.1/0.625 | 1.5 | 15 | 15.0 | DonEscargot |
| Common_DoubleVulcan_DonEscargot_L | 0.0/0.525 | 0.1/0.625 | 1.5 | 15 | 15.0 | DonEscargot |
| Common_DoubleVulcan_DonEscargot_R2 | 0.0/0.525 | 0.1/0.625 | 1.5 | 15 | 15.0 | DonEscargot |
| Common_DoubleVulcan_DonEscargot_L2 | 0.0/0.525 | 0.1/0.625 | 1.5 | 15 | 15.0 | DonEscargot |
| Common_DoubleVulcan_Dopp | 0.0/0.525 | 0.1/0.625 | 1.5 | 8 | 10.0 | Dopp |
| Common_DoubleVulcan_Dopp_L | 0.0/0.525 | 0.1/0.625 | 1.5 | 8 | 10.0 | Dopp |
| Common_Vulcan_EF_Heli | 0.0/1.1 | 0.0/1.1 | 2.0 | 12 | 6.0 | EF_Heli |
| EF_MinigunAPC_MG | 0.0/0.825 | 0.0/0.825 | 3.0 | 12 | 0.0 | EF_MinigunAPC |
| ZN_120mmMG | 0.3/1.175 | 0.3/1.475 | 2.0 | 8 | 20.0 | EMS_10, EMS_10_1, EMS_10F |
| Common_DoubleVulcan_MS | 0.0/1.5 | 0.0/1.5 | 4.0 | 16 | 0.0 | FA_78_1, FA_78_1_NA, FA_78_2, FA_78_3, FA_78_G, MS_09G, MS_14JG, MS_18E, RGM_79G, RGM_79G_Space, RGM_79GL, RX_77_2, RX_77_3, RX_77_3D, RX_77_4, RX_77D, RX_78_2, RX_78_3, RX_78_4_Bst, RX_78_5_Bst, RX_78_6, RX_78_7, RX_78GP01, RX_78GP01_FB, RX_78GP03S, RX_78NT_1, RX_78NT_1_FA, RX_78SP, RX_78XX, RX_79_BD_1, RX_79_BD_1_EXAM, RX_79_BD_2, RX_79_BD_2_EXAM, RX_80PR, RX_80PR_2, RX_80PR_2_HADES, RX_80PR_GroundType, RX_80PR_GroundType_HADES, RX_80PR_HADES, RX_80PR_SpaceType, RX_80PR_SpaceType_HADES, RX_81, RX_81AS, RX_81FC, RX_81LA, RX_81ST, YMS_16M, YMS_18 |
| EF_FA_78_2_FrameLauncher_MG | 0.25/1.3 | 0.25/1.55 | 6.0 | 15 | 25.0 | FA_78_2 |
| Common_ArmGL_L | 0.1/0.3 | 0.3/0.6 | 4.0 | 2 | 25.0 | FA_78_3, MS_15C, RX_78_6, RX_78_7 |
| FatUncle_Turret_MG | 0.0/0.9 | 0.0/0.9 | 1.0 | 10 | 5.0 | FatUncle |
| Common_DoubleVulcan_FF_4 | 0.0/0.525 | 0.1/0.625 | 1.5 | 8 | 10.0 | FF_4 |
| Common_DoubleVulcan_FF_4_L | 0.0/0.525 | 0.1/0.625 | 1.5 | 8 | 10.0 | FF_4 |
| Common_DoubleVulcan_FF_6 | 0.0/0.525 | 0.1/0.625 | 1.5 | 8 | 10.0 | FF_6 |
| Common_DoubleVulcan_FF_6_L | 0.0/0.525 | 0.1/0.625 | 1.5 | 8 | 10.0 | FF_6 |
| Common_DoubleVulcan_FF_B2 | 0.0/0.625 | 0.1/0.725 | 2.5 | 6 | 5.0 | FF_B2 |
| Common_DoubleVulcan_FF_B2_L | 0.0/0.625 | 0.1/0.725 | 2.5 | 6 | 5.0 | FF_B2 |
| Common_DoubleVulcan_FF_S3 | 0.0/0.525 | 0.1/0.625 | 1.5 | 8 | 10.0 | FF_S3 |
| Common_DoubleVulcan_FF_S3_L | 0.0/0.525 | 0.1/0.625 | 1.5 | 8 | 10.0 | FF_S3 |
| Common_DoubleVulcan_FF_X7 | 0.0/0.525 | 0.1/0.625 | 1.5 | 8 | 10.0 | FF_X7 |
| Common_DoubleVulcan_FF_X7Bst | 0.0/0.525 | 0.1/0.625 | 1.5 | 8 | 10.0 | FF_X7Bst |
| Common_DoubleVulcan_FF_X7Bst_L | 0.0/0.525 | 0.1/0.625 | 1.5 | 8 | 10.0 | FF_X7Bst |
| Common_DoubleVulcan_FFB_7Bst | 0.0/0.525 | 0.1/0.625 | 1.5 | 8 | 10.0 | FFB_7Bst |
| Common_DoubleVulcan_FFB_7Bst_L | 0.0/0.525 | 0.1/0.625 | 1.5 | 8 | 10.0 | FFB_7Bst |
| GallopClass_Turret_AA | 0.0/1.35 | 0.0/1.35 | 2.0 | 20 | 10.0 | GallopClass |
| Common_DoubleVulcan_Gattle | 0.0/0.525 | 0.1/0.625 | 1.5 | 8 | 10.0 | Gattle |
| Common_DoubleVulcan_Gattle_L | 0.0/0.525 | 0.1/0.625 | 1.5 | 8 | 10.0 | Gattle |
| GawClass_Turret_AA | 0.0/0.9 | 0.0/0.9 | 2.0 | 80 | 40.0 | GawClass |
| GrayPhantomClass_Turret_AA | 0.0/0.9 | 0.0/0.9 | 2.0 | 160 | 80.0 | GrayPhantomClass |
| GwazineClass_Turret_AA | 0.0/1.8 | 0.0/1.8 | 2.0 | 100 | 50.0 | GwazineClass |
| HeavyForkClass_Turret_AA | 0.0/1.35 | 0.0/1.35 | 2.0 | 60 | 30.0 | HeavyForkClass |
| HeavyForkClass_Turret_MG | 0.0/1.8 | 0.0/1.8 | 1.0 | 60 | 30.0 | HeavyForkClass |
| HimalayaClass_Turret_AA | 0.0/1.35 | 0.0/1.35 | 2.0 | 40 | 20.0 | HimalayaClass |
| JotunheimClass_Turret_AA | 0.0/1.35 | 0.0/1.35 | 2.0 | 40 | 20.0 | JotunheimClass |
| ZN_Luggun_AA_L | 0.0/1.9 | 0.0/1.9 | 3.0 | 40 | 20.0 | Luggun |
| ZN_Luggun_AA_R | 0.0/1.9 | 0.0/1.9 | 3.0 | 40 | 20.0 | Luggun |
| Common_DoubleVulcan_MA_08 | 0.0/1.5 | 0.0/1.5 | 3.0 | 16 | 0.0 | MA_08 |
| MagellanClass_Turret_AA | 0.0/1.8 | 0.0/1.8 | 2.0 | 140 | 70.0 | MagellanClass |
| MagellanClass_Turret_AA | 0.0/1.8 | 0.0/1.8 | 2.0 | 140 | 70.0 | MagellanClass_Green |
| MagellanClassKai_Turret_AA | 0.0/1.8 | 0.0/1.8 | 2.0 | 140 | 70.0 | MagellanClassKai |
| MagellanClassLateType_Turret_AA | 0.0/1.8 | 0.0/1.8 | 2.0 | 180 | 90.0 | MagellanClassLateType |
| Medea_Turret_MG | 0/1.35 | 0.0/1.35 | 1 | 20 | 10 | Medea |
| ZN_120mmMG | 0.3/1.175 | 0.3/1.475 | 2.0 | 8 | 20.0 | MP_02A |
| ZN_105mmMG | 0.3/0.825 | 0.3/1.125 | 1.5 | 8 | 20.0 | MS_05, MS_05SP, MS_06E |
| ZN_120mmMGShortVer | 0.3/1.125 | 0.3/1.425 | 2.0 | 12 | 20.0 | MS_06D |
| ZN_MS_06K_BigGun | 0.4/0.7 | 0.3/1.0 | 4.0 | 4 | 25.0 | MS_06D, MS_06JK, MS_06K |
| ZN_MS_06K_BigGun_L | 0.4/0.7 | 0.3/1.0 | 4.0 | 4 | 25.0 | MS_06D, MS_06JK |
| Common_DoubleVulcan_MS | 0.0/1.5 | 0.0/1.5 | 4.0 | 16 | 0.0 | MS_06D, MS_08TX, MSM_04, RGC_83, RGM_79, RGM_79_Commander, RGM_79_E, RGM_79C, RGM_79C_Space, RGM_79D, RGM_79L, RGM_79N |
| ZN_120mmMG | 0.3/1.175 | 0.3/1.475 | 2.0 | 8 | 20.0 | MS_06F |
| ZN_120mmMG | 0.3/1.175 | 0.3/1.475 | 2.0 | 8 | 20.0 | MS_06F2 |
| ZN_120mmMG_AntiAir | 0.3/1.05 | 0.3/1.35 | 2.0 | 6 | 20.0 | MS_06F2, MS_06F2_Commander, MS_06JK, MS_07A, MS_09_K_1 |
| ZN_MMP80MG_Kai | 0.3/1.2 | 0.3/1.5 | 2.0 | 10 | 30.0 | MS_06F2_Commander, MS_06FZ_Commander, MS_09R2, MS_09S, MS_14B, MS_14C, MS_17 |
| ZN_120mmMG | 0.3/1.175 | 0.3/1.475 | 2.0 | 8 | 20.0 | MS_06F_MineLayer, MS_06G, MS_06J, MS_06K, MS_06R_1, MS_06R_1A, MS_06S, MS_07A, MS_07H, MS_09, MS_09R |
| ZN_MMP80MG | 0.3/1.1 | 0.3/1.4 | 2.0 | 9 | 20.0 | MS_06FZ, MS_09_K_2, MS_09F, MS_09F_TROP, MS_09F_TROP_0083, MS_14F, MS_14S, YMS_09J |
| ZN_MS_06JK_Gatling | 0.3/1.35 | 0.3/1.65 | 5.0 | 30 | 20.0 | MS_06JK |
| ZN_120mmMGWithGrenadeLauncher | 0.3/1.3 | 0.3/1.6 | 2.0 | 9 | 30.0 | MS_06R_2 |
| Common_DoubleVulcan_MTank | 0.0/1.1 | 0.0/1.1 | 2.0 | 12 | 6.0 | MS_06V, MTank, MTank_Chassis |
| ZN_MS_06V_MG | 0.0/1.1 | 0.0/1.1 | 2.0 | 12 | 12.0 | MS_06V |
| ZN_MS_07B_HandMG | 0.3/0.825 | 0.3/1.125 | 2.0 | 8 | 20.0 | MS_07B, MS_07H |
| ZN_MS_07B3_HandMG | 0.3/0.825 | 0.3/1.125 | 2.0 | 8 | 20.0 | MS_07B3, MS_07H8 |
| ZN_MS_07B3_Minigun | 0.3/1.7 | 0.3/2.0 | 3.0 | 30 | 40.0 | MS_07B3, MS_07H8 |
| ZN_MMP80MG | 0.3/1.1 | 0.3/1.4 | 2.0 | 9 | 20.0 | MS_08TX, MS_09D |
| Common_ArmGL | 0.1/0.3 | 0.3/0.6 | 4.0 | 2 | 25.0 | MS_08TX_Kai, MS_08TX_Kai_EXAM, MS_15C, RX_78_6 |
| ZN_105mmMG | 0.3/0.825 | 0.3/1.125 | 1.5 | 8 | 20.0 | MS_09_K_1 |
| ZN_120mmMG_AntiAir | 0.3/1.05 | 0.3/1.35 | 2.0 | 6 | 20.0 | MS_09_K_2 |
| ZN_120mmMGWithGrenadeLauncher | 0.3/1.3 | 0.3/1.6 | 2.0 | 9 | 30.0 | MS_09G |
| ZN_ACT_Zaku_MG | 0.3/0.925 | 0.3/1.225 | 2.0 | 8 | 20.0 | MS_11, MS_11S |
| ZN_MS_12_MG | 0.0/1.1 | 0.0/1.1 | 3.0 | 24 | 12.0 | MS_12 |
| ZN_MMP80MG | 0.3/1.1 | 0.3/1.4 | 2.0 | 9 | 20.0 | MS_14A |
| Common_ArmMG | 0.1/0.7 | 0.3/1.0 | 3.0 | 9 | 20.0 | MS_14F, MS_14FS, MS_14JG, MS_15B, MS_15F, MS_15FS, RX_78NT_1_FA |
| Common_ArmMG_L | 0.1/0.7 | 0.3/1.0 | 3.0 | 9 | 20.0 | MS_14F, MS_14FS, MS_14JG, MS_15B, MS_15F, MS_15FS, RX_78NT_1_FA |
| ZN_MS_14FS_BMG | 0.25/0.95 | 0.25/1.2 | 3.5 | 8 | 75.0 | MS_14FS |
| ZN_MS_14JG_BMG | 0.25/0.95 | 0.25/1.2 | 3.5 | 8 | 75.0 | MS_14JG |
| ZN_MS_21C_MG | 0.3/1.2 | 0.3/1.5 | 2.0 | 10 | 20.0 | MS_21C |
| ZN_MSM_03C_MG | 0.2/0.85 | 0.2/1.05 | 4.0 | 14 | 40.0 | MSM_03C |
| ZN_MSM_03C_MG_L | 0.2/0.85 | 0.2/1.05 | 4.0 | 14 | 40.0 | MSM_03C |
| Common_DoubleVulcan_MS_MSM_04N | 0.0/1.9 | 0.0/1.9 | 3.0 | 20 | 0.0 | MSM_04N |
| MusaiClassLateType_Turret_AA | 0.0/1.35 | 0.0/1.35 | 2.0 | 100 | 50.0 | MusaiClassLateType |
| MusaiClassLateType_0083_Turret_AA | 0.0/1.35 | 0.0/1.35 | 2.0 | 100 | 50.0 | MusaiClassLateType_0083 |
| PapuaClass_Turret_AA | 0.0/1.35 | 0.0/1.35 | 2.0 | 40 | 20.0 | PapuaClass |
| PazockClass_Turret_AA | 0.0/1.35 | 0.0/1.35 | 2.0 | 40 | 20.0 | PazockClass |
| PegasusClass_Turret_AA | 0.0/0.9 | 0.0/0.9 | 2.0 | 160 | 80.0 | PegasusClass |
| EF_100mmMG | 0.3/1.175 | 0.3/1.475 | 2.0 | 8 | 20.0 | RFF_06, RGM_79_G, RGM_79_G_SP, RGM_79_G_SPACE, RGM_79_G_WithBackpack |
| EF_90mmMG | 0.3/1.1 | 0.3/1.4 | 2.0 | 9 | 20.0 | RGC_80, RGM_79, RGM_79_Commander, RGM_79_E, RGM_79HC, RGM_79L, RGM_79V |
| EF_90mmMG | 0.3/1.1 | 0.3/1.4 | 2.0 | 9 | 20.0 | RGM_79C, RGM_79C_Space, RGM_79DO, RGM_79G, RGM_79G_Space, RGM_79GL, RGM_79LV, RGM_79SP2, RX_77_3D, RX_77D, RX_78XX, RX_80PR, RX_80PR_GroundType, RX_80PR_GroundType_HADES, RX_80PR_HADES, RX_80PR_SpaceType, RX_80PR_SpaceType_HADES |
| EF_90mmMG_79D | 0.3/1.2 | 0.3/1.5 | 3.0 | 13 | 20.0 | RGM_79D |
| EF_100mmMG | 0.3/1.175 | 0.3/1.475 | 2.0 | 8 | 20.0 | RGM_79FD, RGM_79FP, RX_77_4, RX_79_G_WithBackpack |
| EF_RGM_79HC_ShieldMG | 0.3/1.05 | 0.3/1.35 | 6.0 | 14 | 35.0 | RGM_79HC |
| EF_RGM_79HC_ShieldMG_L | 0.3/1.05 | 0.3/1.35 | 6.0 | 14 | 35.0 | RGM_79HC |
| Common_DoubleVulcan_RGM_79HC | 0.0/1.3 | 0.0/1.3 | 3.0 | 14 | 0.0 | RGM_79HC |
| EF_RGM_79S_MG | 0.3/1.35 | 0.3/1.65 | 3.0 | 15 | 35.0 | RGM_79S |
| EF_RTX_440_HandGun | 0.3/0.9 | 0.3/1.2 | 5.0 | 10 | 35.0 | RTX_440 |
| EF_RTX_440_HandGun_L | 0.3/0.9 | 0.3/1.2 | 5.0 | 10 | 35.0 | RTX_440 |
| EF_RX_75R_DoubleMG | 0/1.375 | 0.0/1.375 | 3 | 12 | 0 | RX_75R |
| EF_100mmMG | 0.3/1.175 | 0.3/1.475 | 2.0 | 8 | 20.0 | RX_78_1, RX_79_G |
| Common_DoubleVulcan_MS | 0.0/1.9 | 0.0/1.9 | 4.0 | 20 | 0.0 | RX_78_1 |
| EF_Minigun | 0.3/1.75 | 0.3/2.05 | 5.0 | 30 | 60.0 | RX_78_5_Bst, RX_80PR_SpaceType, RX_80PR_SpaceType_HADES |
| EF_Minigun_L | 0.3/1.75 | 0.3/2.05 | 5.0 | 30 | 60.0 | RX_78_5_Bst, RX_80PR_SpaceType, RX_80PR_SpaceType_HADES |
| EF_90mmMG_L | 0.3/1.1 | 0.3/1.4 | 2.0 | 9 | 20.0 | RX_78GP01 |
| Common_DoubleVulcan_MS | 0.0/1.125 | 0.0/1.125 | 4.0 | 16 | 0.0 | RX_78GP02A |
| Common_ArmMG | 0.1/0.5 | 0.3/0.8 | 3.0 | 9 | 20.0 | RX_78NT_1 |
| Common_ArmMG_L | 0.1/0.5 | 0.3/0.8 | 3.0 | 9 | 20.0 | RX_78NT_1 |
| EF_75mmMG_Double | 0.2/0.655 | 0.2/0.855 | 3.5 | 14 | 45.0 | RX_78XX |
| EF_75mmMG_Double_L | 0.2/0.655 | 0.2/0.855 | 3.5 | 14 | 45.0 | RX_78XX |
| EF_100mmMG_Blue | 0.3/1.1 | 0.3/1.4 | 3.0 | 9 | 20.0 | RX_79_BD_1, RX_79_BD_1_EXAM |
| EF_RX_79_BD_ChestMG | 0.25/0.9 | 0.25/1.15 | 10.0 | 14 | 35.0 | RX_79_BD_1, RX_79_BD_1_EXAM, RX_79_BD_2, RX_79_BD_2_EXAM |
| EF_RX_79_BD_ChestMG_L | 0.25/0.9 | 0.25/1.15 | 10.0 | 14 | 35.0 | RX_79_BD_1, RX_79_BD_1_EXAM, RX_79_BD_2, RX_79_BD_2_EXAM |
| Common_SingleVulcan_RX_79_G | 0.0/1.3 | 0.0/1.3 | 3.0 | 14 | 0.0 | RX_79_G, RX_79_G_WithBackpack |
| EF_RX_80_PR_2_FrameLauncher_MG | 0.25/1.3 | 0.25/1.55 | 6.0 | 15 | 25.0 | RX_80PR_2, RX_80PR_2_HADES |
| SalamisClass_Turret_AA | 0.0/1.8 | 0.0/1.8 | 2.0 | 40 | 20.0 | SalamisClass |
| SalamisClass_Turret_MG | 0.0/1.8 | 0.0/1.8 | 1.0 | 20 | 10.0 | SalamisClass |
| SalamisClassKai_Turret_AA | 0.0/1.8 | 0.0/1.8 | 2.0 | 30 | 15.0 | SalamisClassKai |
| SalamisClassKai_Turret_MG | 0.0/1.8 | 0.0/1.8 | 1.0 | 20 | 10.0 | SalamisClassKai |
| SalamisClassLateType_Turret_AA | 0.0/1.8 | 0.0/1.8 | 2.0 | 40 | 20.0 | SalamisClassLateType |
| SalamisClassLateType_Turret_MG | 0.0/1.8 | 0.0/1.8 | 1.0 | 20 | 10.0 | SalamisClassLateType |
| ZN_SamsonGroundTransportTruck_AA_L | 0.0/1.9 | 0.0/1.9 | 3.0 | 40 | 20.0 | SamsonGroundTransportTruck |
| ZN_SamsonGroundTransportTruck_AA_R | 0.0/1.9 | 0.0/1.9 | 3.0 | 40 | 20.0 | SamsonGroundTransportTruck |
| EF_Type61A5_MG | 0.0/1.1 | 0.0/1.1 | 2.0 | 12 | 0.0 | Type61A5 |
| EF_Type74_MG | 0.0/1.1 | 0.0/1.1 | 2.0 | 12 | 6.0 | Type74, Type74Kai |
| ZN_Wappa_MG | 0.0/0.9 | 0.0/0.9 | 2.0 | 10 | 5.0 | Wappa |
| ZN_YMS_18_LMG | 0.3/1.35 | 0.45/1.8 | 2.5 | 30 | 40.0 | YMS_18 |
| ZN_105mmMG_L | 0.3/0.825 | 0.3/1.125 | 1.5 | 8 | 20.0 | YMT_05 |
| ZanzibarClass_Turret_AA | 0.0/0.9 | 0.0/0.9 | 2.0 | 110 | 55.0 | ZanzibarClass |
| ZanzibarClassKai_Turret_AA | 0.0/0.9 | 0.0/0.9 | 2.0 | 110 | 55.0 | ZanzibarClassKai |
| ZanzibarClassKai_0083_Turret_AA | 0.0/0.9 | 0.0/0.9 | 2.0 | 80 | 40.0 | ZanzibarClassKai_0083 |
| ZanzibarClassKai_0083_Turret_MG | 0.0/0.9 | 0.0/0.9 | 2.0 | 40 | 20.0 | ZanzibarClassKai_0083 |
| ZN_APC_MG | 0.0/1.1 | 0.0/1.1 | 2.0 | 12 | 6.0 | ZN_APC, ZN_APC_WithMS |
| Common_Vulcan_ZN_Heli | 0.0/1.1 | 0.0/1.1 | 2.0 | 12 | 6.0 | ZN_Heli |

## melee

| 武器ID | 首发/末发(s) | 收招/流程(s) | CD(s) | 发数 | EN | 使用单位 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| EF_BeamSaber_Double_L_A_Fixed_AMX_002 | 0.6/0.6 | 1.4/2.0 | 3.0 | 2 | 0 | AMX_002 |
| Common_Push_L_A | 0.45/0.45 | 1.0/1.45 | 3.0 | 1 | 0 | ApsarasII, MAN_03, MAN_08 |
| Common_Push_A | 0.45/0.45 | 1.0/1.45 | 3.0 | 1 | 0 | EMS_10, EMS_10_1, MAM_07, MS_05, MS_05SP, MS_06C, MS_06D, MS_06E, MS_06F, MS_06F2, MS_06F2_Commander, MS_06F_MineLayer, MS_06F_Sniper, MS_06FZ, MS_06FZ_Commander, MS_06G, MS_06J, MS_06JK, MS_06K, MS_06M, MS_06R_1, MS_06R_1A, MS_06R_2, MS_06S, MS_06V, MS_07A, MS_07B, MS_07B3, MS_07H, MS_07H8, MS_09, MS_09_K_1, MS_09D, MS_09R, MS_10, MS_11, MS_11S, MS_12, MS_21C, MSM_03, MSM_04, MSM_04G, MSM_04N, MSM_07, MSM_07S, MSM_08, MSM_10, RAG_79, RFF_06, RGC_80, RGC_80S, RGM_79, RGM_79_Commander, RGM_79_E, RGM_79_G, RGM_79_G_SP, RGM_79_G_SPACE, RGM_79_G_WithBackpack, RGM_79C, RGM_79C_Space, RGM_79HC, RGM_79L, RGM_79SC, RGM_79V, RMV_1, RX_75R |
| ZN_HeatHawk_F | 0.3/0.3 | 1.4/1.7 | 3.0 | 1 | 0 | EMS_10, EMS_10_1, MS_06F2_Commander, MS_06F_Sniper, MS_06R_2 |
| Common_Cqb_A_L | 0.6/0.6 | 1.4/2.0 | 3.0 | 1 | 0 | EMS_10_1 |
| Common_Push_A | 0.45/0.45 | 1.0/1.45 | 3.0 | 1 | 0 | EMS_10F, FA_78_1, FA_78_1_NA, FA_78_2, FA_78_3, FA_78_G, MS_08TX, MS_08TX_Kai, MS_08TX_Kai_EXAM, MS_09_K_2, MS_09F, MS_09F_TROP, MS_09F_TROP_0083, MS_09G, MS_09R2, MS_09S, MS_14A, MS_14B, MS_14C, MS_14F, MS_14FS, MS_14JG, MS_14S, MS_15A, MS_15B, MS_15C, MS_15F, MS_15FS, MS_15Kg, MS_17, MS_18E, MSM_03C, MSM_07E, MSN_02, MSN_02_Head, RAG_79_G1, RGC_83, RGM_79_D, RGM_79D, RGM_79DO, RGM_79FD, RGM_79FP, RGM_79G, RGM_79G_Space, RGM_79GL, RGM_79LV, RGM_79N, RGM_79S, RGM_79SP2, RTX_440, RX_75, RX_77_2, RX_77_3, RX_77_3D, RX_77_4, RX_77D, RX_78_1, RX_78_2, RX_78_3, RX_78_4_Bst, RX_78_5_Bst, RX_78_6, RX_78_7, RX_78GP01, RX_78GP01_FB, RX_78GP02A, RX_78GP03S, RX_78NT_1, RX_78NT_1_FA, RX_78SP, RX_78XX, RX_79_BD_1, RX_79_BD_1_EXAM, RX_79_BD_2, RX_79_BD_2_EXAM, RX_79_G, RX_79_G_WithBackpack, RX_80PR, RX_80PR_2, RX_80PR_2_HADES, RX_80PR_GroundType, RX_80PR_GroundType_HADES, RX_80PR_HADES, RX_80PR_SpaceType, RX_80PR_SpaceType_HADES, RX_81, RX_81AS, RX_81FC, RX_81LA, RX_81ST, YMS_09J, YMS_15, YMS_15E, YMS_16M, YMS_18, YMT_05, YMT_05_ModeB |
| ZN_HeatHawk_F | 0.3/0.3 | 1.4/1.7 | 3.0 | 1 | 0 | EMS_10F, MS_06FZ_Commander |
| EF_BeamSaber_A | 0.6/0.6 | 1.4/2.0 | 3.0 | 1 | 0 | FA_78_1, RGM_79_D, RGM_79C, RGM_79C_Space, RGM_79D, RX_79_G, RX_79_G_WithBackpack |
| EF_BeamSaber_AF_Fast_A | 0.51/1.27 | 1.4/2.67 | 3.0 | 2 | 0 | FA_78_1_NA, FA_78_3, RX_78_2, RX_78_3, RX_78_4_Bst, RX_78_5_Bst, RX_78_7, RX_79_BD_1_EXAM, RX_80PR, RX_80PR_2_HADES, RX_80PR_GroundType, RX_80PR_HADES, RX_80PR_SpaceType, RX_81 |
| EF_BeamSaber_AF_A | 0.6/1.5 | 1.4/2.9 | 3.5 | 2 | 0 | FA_78_2, FA_78_G, RGC_83, RGM_79DO, RGM_79FD, RGM_79G, RGM_79G_Space, RGM_79SP2, RX_78NT_1_FA, RX_79_BD_1, RX_79_BD_2, RX_79_BD_2_EXAM, RX_80PR_2, RX_81ST |
| EF_BeamSaber_Double_AALDF | 0.6/2.1 | 1.0/3.1 | 3.5 | 4 | 0 | FA_78_3, RX_78_2, RX_78_3, RX_78_4_Bst, RX_78_5_Bst, RX_78_6, RX_78_7, RX_78NT_1, RX_80PR_GroundType_HADES, RX_80PR_HADES, RX_80PR_SpaceType_HADES |
| Common_Push_L_A | 0.45/0.45 | 1.0/1.45 | 3.0 | 1 | 0 | MA_05, MA_06 |
| Common_Cqb_Double_L_A_Fixed_MA_05 | 0.42/0.42 | 1.4/1.82 | 3.0 | 1 | 0 | MA_05 |
| Common_Cqb_Double_L_A_Fixed_MA_06 | 0.4/0.4 | 1.2/1.6 | 3.0 | 1 | 0 | MA_06 |
| ZN_MA_08_Shock_A | 0.65/0.65 | 2.5/3.15 | 5.0 | 1 | 0 | MA_08 |
| Common_Cqb_Double_L_A_Fixed_MAM_07 | 0.42/0.42 | 1.4/1.82 | 3.0 | 1 | 0 | MAM_07 |
| Common_Cqb_A | 0.6/0.6 | 1.4/2.0 | 3.0 | 1 | 0 | MP_02A, MS_06K, MS_06M, MS_07H, MS_09_K_1, MSM_04G, MSM_10, RB_79, RB_79_LateType, RB_79M, RFF_06, RGC_80, RGC_80S |
| ZN_HeatHawk_A | 0.6/0.6 | 1.4/2.0 | 3.0 | 1 | 0 | MS_05, MS_05SP, MS_06C, MS_06D, MS_06E, MS_06F, MS_06F2, MS_06F_MineLayer, MS_06G, MS_06J, MS_06JK, MS_06R_1, MS_06R_1A, MS_06S, MS_07A |
| ZN_HeatHawk_A | 0.6/0.6 | 1.4/2.0 | 3.0 | 1 | 0 | MS_06FZ |
| ZN_MS_07B_HeatRod | 0.5/0.5 | 0.5/1.0 | 5.0 | 1 | 0 | MS_07B, MS_07B3 |
| ZN_HeatSword_A | 0.6/0.6 | 1.4/2.0 | 3.0 | 1 | 0 | MS_07B |
| ZN_HeatSword_MS_07B3_BF_B | 0.4/1.3 | 1.4/2.7 | 3.5 | 2 | 0 | MS_07B3 |
| ZN_HeatSword_MS_07H8_A | 0.6/0.6 | 1.4/2.0 | 3.0 | 1 | 0 | MS_07H8 |
| ZN_HeatSword_AF_A | 0.6/1.5 | 1.4/2.9 | 3.5 | 2 | 0 | MS_08TX |
| ZN_HeatSword_BF_B | 0.4/1.3 | 1.4/2.7 | 3.5 | 2 | 0 | MS_08TX |
| ZN_HeatSword_Double_DBDF | 0.6/1.3 | 1.0/2.3 | 3.5 | 4 | 0 | MS_08TX_Kai, MS_08TX_Kai_EXAM |
| ZN_HeatSword_Double_DE | 0.52/0.76 | 1.0/1.76 | 3.0 | 6 | 0 | MS_08TX_Kai_EXAM |
| ZN_HeatSaber_A | 0.6/0.6 | 1.4/2.0 | 3.0 | 1 | 0 | MS_09, MS_09R |
| Common_Cqb_A | 0.6/0.6 | 1.4/2.0 | 3.0 | 1 | 0 | MS_09_K_2, MSN_02, RX_77_3, RX_77D, YMT_05 |
| ZN_HeatSaber_AF_A | 0.6/1.5 | 1.4/2.9 | 3.5 | 2 | 0 | MS_09D |
| ZN_HeatSaber_AF_A | 0.6/1.5 | 1.4/2.9 | 3.5 | 2 | 0 | MS_09F, MS_09F_TROP, MS_09F_TROP_0083, MS_09R2, MS_09S |
| ZN_HeatSaber_BF_B | 0.4/1.3 | 1.4/2.7 | 3.5 | 2 | 0 | MS_09G |
| ZN_TwinHeatHawk_AF_A | 0.6/1.5 | 1.4/2.9 | 3.5 | 2 | 0 | MS_09G |
| ZN_HeatSaber_F | 0.3/0.3 | 1.4/1.7 | 3.5 | 1 | 0 | MS_10 |
| ZN_HeatHawk_ACT_A_Fast | 0.51/0.51 | 1.4/1.91 | 3.0 | 1 | 0 | MS_11, MS_11S |
| EF_BeamSaber_F_Yellow | 0.3/0.3 | 1.4/1.7 | 3.0 | 1 | 0 | MS_11S, MS_14FS |
| ZN_TwinBeamSword_A | 0.6/0.6 | 1.4/2.0 | 3.0 | 1 | 0 | MS_14A |
| ZN_TwinBeamSword_AF_A | 0.6/1.5 | 1.4/2.9 | 3.5 | 2 | 0 | MS_14B, MS_14S |
| ZN_TwinBeamSword_A | 0.6/0.6 | 1.4/2.0 | 3.0 | 1 | 0 | MS_14C |
| EF_BeamSaber_BF_Yellow_B | 0.4/1.3 | 1.4/2.7 | 3.5 | 2 | 0 | MS_14F, MS_14FS, MS_14JG, MS_18E, YMS_18 |
| ZN_YMS_15_BeamSaber_B2 | 0.35/0.7 | 1.5/2.2 | 3.5 | 2 | 0 | MS_15A, MS_15C |
| ZN_MS_15B_BeamLance_BF_B | 0.4/1.3 | 1.4/2.7 | 4.0 | 2 | 0 | MS_15B, MS_15F, MS_15FS, MS_15Kg |
| ZN_MS_15B_BeamLance_B2 | 0.35/0.7 | 1.5/2.2 | 3.5 | 2 | 0 | MS_15Kg |
| ZN_YMS_15_BeamSaber_BF_B | 0.4/1.3 | 1.4/2.7 | 3.5 | 2 | 0 | MS_17 |
| EF_BeamSaber_FL_Yellow | 0.3/0.3 | 1.4/1.7 | 3.0 | 1 | 0 | MS_21C |
| Common_Cqb_Double_A | 0.6/0.6 | 1.4/2.0 | 3.0 | 2 | 0 | MSM_03 |
| Common_Cqb_Double_A | 0.6/0.6 | 1.4/2.0 | 3.0 | 2 | 0 | MSM_03C, YMT_05 |
| Common_Cqb_B | 0.4/0.4 | 1.0/1.4 | 3.0 | 1 | 0 | MSM_04, RB_79N |
| Common_Cqb_F_MSM_04N | 0.5/0.5 | 1.5/2.0 | 3.0 | 1 | 0 | MSM_04N |
| Common_Cqb_G_MSM_04N | 0.75/0.75 | 1.5/2.25 | 5.0 | 1 | 0 | MSM_04N |
| Common_Cqb_B | 0.4/0.4 | 1.0/1.4 | 3.0 | 1 | 0 | MSM_07, MSM_07S |
| Common_Cqb_BF_B | 0.4/1.3 | 1.4/2.7 | 3.5 | 2 | 0 | MSM_07E, RX_77_3D, RX_77_4, RX_78NT_1_FA |
| Common_Cqb_B_L_MSM_08 | 0.4/0.4 | 1.0/1.4 | 6.0 | 1 | 0 | MSM_08 |
| ZN_HeatSword_BF_B | 0.4/1.3 | 1.4/2.7 | 3.5 | 2 | 0 | MSM_08 |
| EF_RAG_79_Anchor_L | 0.5/0.5 | 0.5/1.0 | 5.0 | 1 | 0 | RAG_79 |
| EF_BeamPickaxe_B | 0.4/0.4 | 1.0/1.4 | 3.0 | 1 | 0 | RAG_79 |
| EF_RAG_79_Anchor | 0.5/0.5 | 0.5/1.0 | 5.0 | 1 | 0 | RAG_79_G1 |
| EF_BeamPickaxe_BF_B | 0.4/1.3 | 1.4/2.7 | 3.5 | 2 | 0 | RAG_79_G1 |
| EF_RB_79K_Anchor | 0.5/0.5 | 0.5/1.0 | 6.0 | 1 | 0 | RB_79K |
| Common_Cqb_BF_B | 0.4/1.3 | 1.4/2.7 | 3.5 | 2 | 0 | RB_79K, RX_77_2 |
| EF_BeamSaber_A | 0.6/0.6 | 1.4/2.0 | 3.0 | 1 | 0 | RGM_79, RGM_79_Commander, RGM_79_E, RGM_79_G, RGM_79_G_SP, RGM_79_G_SPACE, RGM_79_G_WithBackpack |
| EF_BeamSaber_Double_AALDF | 0.6/2.1 | 1.0/3.1 | 3.5 | 4 | 0 | RGM_79_Commander, RX_81ST |
| Common_Cqb_A_L | 0.6/0.6 | 1.4/2.0 | 3.0 | 1 | 0 | RGM_79_D, RGM_79FP, RX_81AS |
| Common_ArmBeamSaber_F | 0.3/0.3 | 1.4/1.7 | 3.5 | 1 | 0 | RGM_79DO |
| EF_BeamLancer_BF_B | 0.4/1.3 | 1.4/2.7 | 3.5 | 2 | 0 | RGM_79FP |
| EF_BeamSaber_F | 0.3/0.3 | 1.4/1.7 | 3.0 | 1 | 0 | RGM_79FP, RX_79_BD_2_EXAM, RX_81AS |
| EF_BeamSaber_BF_B | 0.4/1.3 | 1.4/2.7 | 3.5 | 2 | 0 | RGM_79GL, RGM_79LV, RGM_79N, RX_78_6, RX_78GP01, RX_78GP01_FB, RX_78GP03S, RX_78NT_1, RX_78SP, RX_81LA |
| EF_BeamDagger_BF_B | 0.4/1.3 | 1.4/2.7 | 3.5 | 2 | 0 | RGM_79HC |
| EF_BeamSaber_BF | 0.4/1.3 | 1.4/2.7 | 3.5 | 2 | 0 | RGM_79L |
| EF_HeatDagger_E | 0.35/0.7 | 1.4/2.1 | 3.5 | 2 | 0 | RGM_79S |
| Common_ArmBeamSaber_B | 0.4/0.4 | 1.0/1.4 | 3.0 | 1 | 0 | RGM_79SC |
| EF_BeamSaber_BF_B | 0.4/1.3 | 1.4/2.7 | 3.5 | 2 | 0 | RGM_79V |
| EF_BeamSaber_AF_Fast_A | 0.51/1.27 | 1.4/2.67 | 3.0 | 2 | 0 | RX_78_1 |
| EF_BeamSaber_Double_AALDF | 0.6/2.1 | 1.0/3.1 | 3.5 | 4 | 0 | RX_78_1 |
| EF_BeamJavelin_BF_B | 0.4/1.3 | 1.4/2.7 | 4.0 | 2 | 0 | RX_78_1 |
| EF_SHM | 0.5/0.5 | 0.5/1.0 | 5.0 | 1 | 0 | RX_78_2 |
| EF_BeamJavelin_BF_B | 0.4/1.3 | 1.4/2.7 | 4.0 | 2 | 0 | RX_78_2, RX_78_3, RX_80PR_2_HADES |
| EF_BeamSaber_AF_Large_Green_A | 0.6/1.5 | 1.4/2.9 | 3.5 | 2 | 0 | RX_78GP02A |
| Common_ArmBeamSaber_XL_F_GP_03D | 0.5/0.5 | 1.5/2.0 | 3.5 | 1 | 0 | RX_78GP03D |
| EF_BeamDagger_Double_AALDF | 0.2/1.0 | 1.0/2.0 | 3.0 | 4 | 0 | RX_78XX |
| EF_BeamDagger_Double_AALDE | 0.2/1.31 | 1.0/2.31 | 3.0 | 9 | 0 | RX_78XX |
| Common_Cqb_B_L | 0.4/0.4 | 1.0/1.4 | 3.0 | 1 | 0 | RX_79_BD_1_EXAM, RX_80PR |
| EF_BeamSaber_Double_DE | 0.52/0.76 | 1.0/1.76 | 3.0 | 6 | 0 | RX_80PR_GroundType_HADES, RX_80PR_SpaceType_HADES |
| EF_HSP_BF_B | 0.4/1.3 | 1.4/2.7 | 4.0 | 2 | 0 | RX_81AS |
| EF_BeamLancer_Double_DF | 0.3/0.3 | 1.0/1.3 | 4.0 | 2 | 0 | RX_81FC |
| EF_BeamSaber_Double_BBLDF | 0.4/2.0 | 1.0/3.0 | 3.5 | 4 | 0 | RX_81LA |
| ZN_LargeHeatHawk_A_A | 0.6/0.6 | 1.5/2.1 | 3.5 | 1 | 0 | YMS_09J |
| ZN_LargeHeatHawk_Half_F | 0.3/0.3 | 1.4/1.7 | 3.0 | 1 | 0 | YMS_09J |
| ZN_YMS_15_BeamSaber_B3 | 0.3/0.9 | 1.25/2.15 | 3.5 | 3 | 0 | YMS_15 |
| ZN_YMS_15_BeamSaber_F | 0.3/0.3 | 1.4/1.7 | 3.0 | 1 | 0 | YMS_15 |
| ZN_YMS_15E_Lance_BF_B | 0.4/1.3 | 1.4/2.7 | 4.0 | 2 | 0 | YMS_15E |

## missile

| 武器ID | 首发/末发(s) | 收招/流程(s) | CD(s) | 发数 | EN | 使用单位 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| AlbionClass_Turret_AMS | 0.0/7.0 | 0.0/7.0 | 12.0 | 16 | 192.0 | AlbionClass |
| ZN_AMX_002_MS | 0.25/1.325 | 0.25/1.575 | 15.0 | 24 | 100.0 | AMX_002 |
| ZN_AMX_002_MS_L | 0.25/1.325 | 0.25/1.575 | 15.0 | 24 | 100.0 | AMX_002 |
| BirminghamClass_Turret_AMS | 0.0/1.5 | 0.0/1.5 | 12.0 | 8 | 320.0 | BirminghamClass |
| BirminghamClass_Turret_MS | 0.0/3.5 | 0.0/3.5 | 12.0 | 30 | 360.0 | BirminghamClass |
| BurkeClass_Turret_AMS | 0.0/1.5 | 0.0/1.5 | 5.0 | 2 | 80.0 | BurkeClass |
| BurkeClass_Turret_MS | 0.0/3.75 | 0.0/3.75 | 7.0 | 6 | 72.0 | BurkeClass |
| ChivvayClass_Turret_AMS | 0.0/1.0 | 0.0/1.0 | 12.0 | 8 | 320.0 | ChivvayClass |
| ChivvayClass_Turret_MS | 0.0/2.25 | 0.0/2.25 | 12.0 | 12 | 144.0 | ChivvayClass |
| ChivvayClassKai_Turret_AMS | 0.0/1.0 | 0.0/1.0 | 12.0 | 8 | 320.0 | ChivvayClassKai |
| ChivvayClassKai_Turret_MS | 0.0/2.25 | 0.0/2.25 | 12.0 | 12 | 144.0 | ChivvayClassKai |
| Common_DoubleMS_DEPP_ROG | 0.0/0.1 | 0.0/0.1 | 4.0 | 2 | 0.0 | DEPP_ROG |
| Common_DoubleMS_DodaiYS | 0.0/0.7 | 0.3/1.0 | 3.0 | 8 | 20.0 | DodaiYS |
| Common_DoubleMS_DodaiYS_L | 0.0/0.7 | 0.3/1.0 | 3.0 | 8 | 20.0 | DodaiYS |
| Common_DoubleMS_Dopp | 0.0/0.1 | 0.3/0.4 | 3.0 | 2 | 20.0 | Dopp |
| Common_DoubleMS_Dopp_L | 0.0/0.1 | 0.3/0.4 | 3.0 | 2 | 20.0 | Dopp |
| Common_DoubleMS_EF_Heli | 0.0/1.0 | 0.0/1.0 | 6.0 | 6 | 30.0 | EF_Heli |
| EF_TorpedoBoat_AMS | 0.0/0.0 | 0.0/0 | 3.0 | 2 | 90.0 | EF_TorpedoBoat |
| EF_FA_78_1_MS | 0.3/1.025 | 0.3/1.325 | 15.0 | 12 | 50.0 | FA_78_1 |
| EF_FA_78_1_MS_L | 0.3/1.025 | 0.3/1.325 | 15.0 | 12 | 50.0 | FA_78_1 |
| EF_FA_78_3_MS | 0.3/1.025 | 0.3/1.325 | 15.0 | 12 | 50.0 | FA_78_3 |
| EF_FA_78_3_MS_L | 0.3/1.025 | 0.3/1.325 | 15.0 | 12 | 50.0 | FA_78_3 |
| EF_FA_78_G_MS | 0.3/1.65 | 0.3/1.95 | 6.0 | 10 | 40.0 | FA_78_G |
| FalmerClass_Turret_AMS | 0.0/1.0 | 0.0/1.0 | 12.0 | 4 | 160.0 | FalmerClass |
| FalmerClass_Turret_MS | 0.0/2.25 | 0.0/2.25 | 12.0 | 12 | 144.0 | FalmerClass |
| Common_DoubleMS_FanFan | 0.0/0.6 | 0.0/0.6 | 4.0 | 4 | 20.0 | FanFan |
| Common_DoubleMS_FF_6 | 0.0/0.1 | 0.3/0.4 | 2.5 | 2 | 20.0 | FF_6 |
| Common_DoubleMS_FF_6_L | 0.0/0.1 | 0.3/0.4 | 2.5 | 2 | 20.0 | FF_6 |
| Common_DoubleMS_FF_B2 | 0.0/0.5 | 0.3/0.8 | 3.0 | 6 | 20.0 | FF_B2 |
| Common_DoubleMS_FF_B2_L | 0.0/0.5 | 0.3/0.8 | 3.0 | 6 | 20.0 | FF_B2 |
| Common_DoubleMS_FF_S3 | 0.0/0.3 | 0.0/0.3 | 2.5 | 4 | 25.0 | FF_S3 |
| Common_DoubleMS_FF_S3_L | 0.0/0.3 | 0.0/0.3 | 2.5 | 4 | 25.0 | FF_S3 |
| Common_DoubleMS_FF_X7 | 0.0/0.1 | 0.3/0.4 | 3.0 | 2 | 20.0 | FF_X7 |
| Common_DoubleMS_FF_X7Bst | 0.0/0.3 | 0.3/0.6 | 3.0 | 4 | 20.0 | FF_X7Bst |
| Common_DoubleMS_FF_X7Bst_L | 0.0/0.3 | 0.3/0.6 | 3.0 | 4 | 20.0 | FF_X7Bst |
| Common_DoubleMS_FFB_7Bst | 0.0/0.3 | 0.3/0.6 | 3.0 | 4 | 20.0 | FFB_7Bst |
| Common_DoubleMS_FFB_7Bst_L | 0.0/0.3 | 0.3/0.6 | 3.0 | 4 | 20.0 | FFB_7Bst |
| Common_DoubleMS_Gattle | 0.0/0.3 | 0.3/0.6 | 3.0 | 4 | 20.0 | Gattle |
| Common_DoubleMS_Gattle_L | 0.0/0.3 | 0.3/0.6 | 3.0 | 4 | 20.0 | Gattle |
| GawClass_Turret_MS | 0.0/5.25 | 0.0/5.25 | 12.0 | 16 | 192.0 | GawClass |
| GrayPhantomClass_Turret_AMS | 0.0/7.0 | 0.0/7.0 | 12.0 | 16 | 192.0 | GrayPhantomClass |
| Common_DoubleMS_Gunperry | 0.0/1.75 | 0.0/1.75 | 9.0 | 6 | 72.0 | Gunperry |
| HeavyForkClass_Turret_MS | 0.0/2.0 | 0.0/2.0 | 12.0 | 10 | 120.0 | HeavyForkClass |
| HimalayaClass_Turret_MS | 0.0/5.25 | 0.0/5.25 | 7.0 | 16 | 192.0 | HimalayaClass |
| Common_DoubleMS_JiccoClass | 0.0/0.6 | 0.3/0.9 | 3.0 | 7 | 20.0 | JiccoClass |
| Common_DoubleMS_JiccoClass_L | 0.0/0.6 | 0.3/0.9 | 3.0 | 7 | 20.0 | JiccoClass |
| M_Type_Submarine_Turret_AMS | 0.0/1.5 | 0.0/1.5 | 4.0 | 8 | 320.0 | M_Type_Submarine, M_Type_Submarine_ZEON |
| M_Type_Submarine_Turret_MS | 0.0/2.25 | 0.0/2.25 | 6.0 | 32 | 96.0 | M_Type_Submarine, M_Type_Submarine_ZEON |
| ZN_MA_05_MS | 0.3/0.45 | 0.25/0.7 | 7.0 | 8 | 20.0 | MA_05 |
| ZN_MA_05_MS_L | 0.3/0.45 | 0.25/0.7 | 7.0 | 8 | 20.0 | MA_05 |
| ZN_MA_06_MS | 0.2/0.35 | 0.15/0.5 | 7.0 | 8 | 20.0 | MA_06 |
| ZN_MA_06_MS_L | 0.2/0.35 | 0.15/0.5 | 7.0 | 8 | 20.0 | MA_06 |
| MagellanClass_Turret_AMS | 0.0/1.5 | 0.0/1.5 | 12.0 | 8 | 320.0 | MagellanClass |
| MagellanClass_Turret_AMS | 0.0/1.5 | 0.0/1.5 | 12.0 | 8 | 320.0 | MagellanClass_Green |
| MagellanClassKai_Turret_AMS | 0.0/1.5 | 0.0/1.5 | 12.0 | 8 | 320.0 | MagellanClassKai |
| MagellanClassLateType_Turret_AMS | 0.0/1.5 | 0.0/1.5 | 12.0 | 8 | 320.0 | MagellanClassLateType |
| ZN_MAM_07_MS | 0.3/0.45 | 0.25/0.7 | 7.0 | 8 | 35.0 | MAM_07 |
| ZN_MAM_07_MS_L | 0.3/0.45 | 0.25/0.7 | 7.0 | 8 | 35.0 | MAM_07 |
| ZN_MAM_07_AMS | 0.3/0.45 | 0.25/0.7 | 12.0 | 8 | 35.0 | MAM_07 |
| ZN_MAM_07_AMS_L | 0.3/0.45 | 0.25/0.7 | 12.0 | 8 | 35.0 | MAM_07 |
| MiniTrayClass_Turret_MS | 0.0/2.25 | 0.0/2.25 | 6.0 | 8 | 48.0 | MiniTrayClass |
| Common_DoubleMS_MissileCar | 0.0/0.6 | 0.0/0.6 | 3.0 | 5 | 25.0 | MissileCar |
| ZN_MP_02A_MS | 0.4/0.7 | 0.3/1.0 | 12.0 | 4 | 100.0 | MP_02A |
| ZN_MP_02A_MS_L | 0.4/0.7 | 0.3/1.0 | 12.0 | 4 | 100.0 | MP_02A |
| ZN_MS_06D_HandMS | 0.3/0.6 | 0.3/0.9 | 6.0 | 3 | 20.0 | MS_06D, MS_09_K_1 |
| ZN_4XMSL | 0.35/0.85 | 0.3/1.15 | 12.0 | 2 | 120.0 | MS_06G, MS_06R_2 |
| ZN_MS_06J_LegMS | 0.3/0.3 | 0.3/0.6 | 8.0 | 2 | 20.0 | MS_06J |
| ZN_MS_06M_MSL | 0.3/1.2 | 0.3/1.5 | 5.0 | 4 | 45.0 | MS_06M |
| ZN_MS_06M_SMS | 0.4/0.7 | 0.3/1.0 | 9.0 | 4 | 35.0 | MS_06M |
| ZN_MS_06M_SMS_L | 0.4/0.7 | 0.3/1.0 | 9.0 | 4 | 35.0 | MS_06M |
| ZN_MS_08TX_Kai_LegMS | 0.3/0.5 | 0.3/0.8 | 8.0 | 6 | 20.0 | MS_08TX_Kai, MS_08TX_Kai_EXAM |
| ZN_MS_08TX_Kai_LegMS_L | 0.3/0.5 | 0.3/0.8 | 8.0 | 6 | 20.0 | MS_08TX_Kai, MS_08TX_Kai_EXAM |
| ZN_MS_10_MS_AMS | 0.35/0.85 | 0.35/1.2 | 12.0 | 2 | 120.0 | MS_10 |
| ZN_MS_10_MS_AMS_R | 0.35/0.85 | 0.35/1.2 | 12.0 | 2 | 120.0 | MS_10 |
| ZN_MS_10_MS_MS | 0.35/0.95 | 0.35/1.3 | 7.0 | 8 | 40.0 | MS_10 |
| ZN_MS_10_MS_MS_R | 0.35/0.95 | 0.35/1.3 | 7.0 | 8 | 40.0 | MS_10 |
| ZN_MS_15B_ShieldRocket | 0.3/0.525 | 0.3/0.825 | 6.0 | 4 | 45.0 | MS_15B, MS_15F, MS_15FS, MS_15Kg |
| ZN_MS_15B_ShieldRocket_L | 0.3/0.525 | 0.3/0.825 | 6.0 | 4 | 45.0 | MS_15B, MS_15F, MS_15FS, MS_15Kg |
| ZN_MSM_03_SMS | 0.4/0.9 | 0.3/1.2 | 9.0 | 6 | 35.0 | MSM_03 |
| ZN_MSM_03_SMS_L | 0.4/0.9 | 0.3/1.2 | 9.0 | 6 | 35.0 | MSM_03 |
| ZN_MSM_03C_AMS | 0.35/0.35 | 0.3/0.65 | 60.0 | 1 | 120.0 | MSM_03C |
| ZN_MSM_03C_BG | 0.25/0.65 | 0.25/0.9 | 3.0 | 3 | 25.0 | MSM_03C |
| ZN_MSM_03C_MS | 0.3/0.75 | 0.3/1.05 | 9.0 | 4 | 35.0 | MSM_03C |
| ZN_MSM_04_BG | 0.25/0.25 | 0.25/0.5 | 2.0 | 1 | 15.0 | MSM_04 |
| ZN_MSM_04_MS | 0.3/0.6 | 0.3/0.9 | 6.0 | 3 | 25.0 | MSM_04 |
| ZN_MSM_04G_HG | 0.45/1.2 | 0.3/1.5 | 5.0 | 6 | 45.0 | MSM_04G |
| ZN_MSM_04G_HG_L | 0.45/1.2 | 0.3/1.5 | 5.0 | 6 | 45.0 | MSM_04G |
| ZN_MSM_07_BG | 0.25/0.25 | 0.25/0.5 | 2.0 | 1 | 15.0 | MSM_07, MSM_07S |
| ZN_MSM_07_MS | 0.3/1.05 | 0.3/1.35 | 9.0 | 6 | 35.0 | MSM_07, MSM_07S |
| ZN_MSM_07E_BG | 0.25/0.65 | 0.25/0.9 | 2.0 | 3 | 25.0 | MSM_07E |
| ZN_MSM_07E_MS | 0.3/1.05 | 0.3/1.35 | 9.0 | 6 | 35.0 | MSM_07E |
| ZN_MSM_08_MS | 0.3/1.2 | 0.3/1.5 | 12.0 | 10 | 65.0 | MSM_08 |
| ZN_MSM_08_MS_L | 0.3/1.2 | 0.3/1.5 | 12.0 | 10 | 65.0 | MSM_08 |
| ZN_MSN_02_BG | 0.25/0.33 | 0.0/0.33 | 2.0 | 5 | 40.0 | MSN_02 |
| ZN_MSN_02_BG_2 | 0.25/0.33 | 0.0/0.33 | 2.0 | 5 | 40.0 | MSN_02 |
| ZN_MSN_02_BG_3 | 0.25/0.33 | 0.0/0.33 | 2.0 | 5 | 40.0 | MSN_02 |
| ZN_MSN_02_BG_4 | 0.25/0.33 | 0.0/0.33 | 2.0 | 5 | 40.0 | MSN_02 |
| ZN_MSN_02_BG_5 | 0.25/0.33 | 0.0/0.33 | 2.0 | 5 | 40.0 | MSN_02 |
| ZN_MSN_02_BG_L | 0.25/0.33 | 0.0/0.33 | 2.0 | 5 | 40.0 | MSN_02 |
| ZN_MSN_02_BG_L_2 | 0.25/0.33 | 0.0/0.33 | 2.0 | 5 | 40.0 | MSN_02 |
| ZN_MSN_02_BG_L_3 | 0.25/0.33 | 0.0/0.33 | 2.0 | 5 | 40.0 | MSN_02 |
| ZN_MSN_02_BG_L_4 | 0.25/0.33 | 0.0/0.33 | 2.0 | 5 | 40.0 | MSN_02 |
| ZN_MSN_02_BG_L_5 | 0.25/0.33 | 0.0/0.33 | 2.0 | 5 | 40.0 | MSN_02 |
| MusaiClass_Turret_AMS | 0.0/1.0 | 0.0/1.0 | 12.0 | 4 | 160.0 | MusaiClass |
| MusaiClass_Turret_MS | 0.0/2.25 | 0.0/2.25 | 12.0 | 12 | 144.0 | MusaiClass |
| MusaiClassLateType_Turret_MS | 0.0/2.25 | 0.0/2.25 | 12.0 | 12 | 144.0 | MusaiClassLateType |
| MusaiClassLateType_0083_Turret_MS | 0.0/2.25 | 0.0/2.25 | 12.0 | 12 | 144.0 | MusaiClassLateType_0083 |
| PegasusClass_Turret_AMS | 0.0/7.0 | 0.0/7.0 | 12.0 | 16 | 640.0 | PegasusClass |
| Common_DoubleMS_PublicClass | 0.0/0.6 | 0.3/0.9 | 3.0 | 7 | 20.0 | PublicClass |
| Common_DoubleMS_PublicClass_L | 0.0/0.6 | 0.3/0.9 | 3.0 | 7 | 20.0 | PublicClass |
| EF_AquaMissileLauncher | 0.3/1.2 | 0.3/1.5 | 4.5 | 4 | 90.0 | RAG_79, RAG_79_G1 |
| EF_RAG_79_MS | 0.4/0.7 | 0.3/1.0 | 7.0 | 4 | 35.0 | RAG_79 |
| EF_RAG_79_MS_L | 0.4/0.7 | 0.3/1.0 | 7.0 | 4 | 35.0 | RAG_79 |
| EF_RAG_79_G1_MS | 0.3/0.3 | 0.3/0.6 | 6.0 | 2 | 35.0 | RAG_79_G1 |
| EF_RAG_79_G1_MS_L | 0.3/0.3 | 0.3/0.6 | 6.0 | 2 | 35.0 | RAG_79_G1 |
| EF_Railgun_79_D_MS | 0.3/0.675 | 0.3/0.975 | 5.0 | 4 | 25.0 | RGM_79_D |
| EF_GroundTypeMissileLauncher | 0.3/0.9 | 0.3/1.2 | 5.0 | 3 | 45.0 | RGM_79_G, RGM_79_G_SPACE, RGM_79_G_WithBackpack |
| EF_RGM_79S_MS_Line | 0.3/0.3 | 0.3/0.6 | 12.0 | 2 | 35.0 | RGM_79S |
| EF_RGM_79S_MS_Line_R | 0.3/0.3 | 0.3/0.6 | 12.0 | 2 | 35.0 | RGM_79S |
| EF_RMV_1_DoubleMS | 0.0/0.875 | 0.0/0.875 | 6.0 | 8 | 80.0 | RMV_1 |
| EF_RTX_440_Rocket | 0.3/1.65 | 0.3/1.95 | 18.0 | 10 | 35.0 | RTX_440 |
| EF_RTX_440_Rocket_L | 0.3/1.65 | 0.3/1.95 | 18.0 | 10 | 35.0 | RTX_440 |
| EF_RX_75_MS | 0.3/0.9 | 0.3/1.2 | 7.0 | 10 | 35.0 | RX_75 |
| EF_RX_75_MS_L | 0.3/0.9 | 0.3/1.2 | 7.0 | 10 | 35.0 | RX_75 |
| EF_RX_77_2_MS | 0.3/0.9 | 0.3/1.2 | 6.0 | 10 | 35.0 | RX_77_2 |
| EF_RX_77_2_MS_L | 0.3/0.9 | 0.3/1.2 | 6.0 | 10 | 35.0 | RX_77_2 |
| EF_RX_79_BD_ChestMS_Line | 0.3/0.3 | 0.3/0.6 | 12.0 | 2 | 55.0 | RX_79_BD_1, RX_79_BD_1_EXAM, RX_79_BD_2, RX_79_BD_2_EXAM |
| EF_RX_79_BD_ChestMS_Line_R | 0.3/0.3 | 0.3/0.6 | 12.0 | 2 | 55.0 | RX_79_BD_1, RX_79_BD_1_EXAM, RX_79_BD_2, RX_79_BD_2_EXAM |
| EF_GroundTypeMissileLauncher | 0.3/0.9 | 0.3/1.2 | 5.0 | 3 | 45.0 | RX_79_G |
| EF_GroundTypeMissileLauncher | 0.3/0.9 | 0.3/1.2 | 5.0 | 3 | 45.0 | RX_79_G_WithBackpack |
| EF_RX_80PR_LegMS | 0.3/0.5 | 0.3/0.8 | 9.0 | 6 | 25.0 | RX_80PR, RX_80PR_GroundType, RX_80PR_GroundType_HADES, RX_80PR_HADES |
| EF_RX_80PR_LegMS_L | 0.3/0.5 | 0.3/0.8 | 9.0 | 6 | 25.0 | RX_80PR, RX_80PR_GroundType, RX_80PR_GroundType_HADES, RX_80PR_HADES |
| EF_RX_80_PR_2_FrameLauncher_MS | 0.25/0.85 | 0.25/1.1 | 12.0 | 4 | 50.0 | RX_80PR_2, RX_80PR_2_HADES |
| EF_RX_81_MS | 0.3/0.75 | 0.3/1.05 | 6.5 | 8 | 65.0 | RX_81AS, RX_81LA, RX_81ST |
| EF_RX_81_MS_L | 0.3/0.75 | 0.3/1.05 | 6.5 | 8 | 65.0 | RX_81AS, RX_81LA, RX_81ST |
| SalamisClass_Turret_MS | 0.0/5.25 | 0.0/5.25 | 12.0 | 16 | 192.0 | SalamisClass |
| SalamisClass_Turret_AMS | 0.0/1.0 | 0.0/1.0 | 12.0 | 4 | 160.0 | SalamisClass |
| SalamisClassKai_Turret_MS | 0.0/5.25 | 0.0/5.25 | 12.0 | 16 | 192.0 | SalamisClassKai |
| SalamisClassKai_Turret_AMS | 0.0/1.0 | 0.0/1.0 | 12.0 | 4 | 160.0 | SalamisClassKai |
| SalamisClassLateType_Turret_MS | 0.0/3.5 | 0.0/3.5 | 12.0 | 30 | 360.0 | SalamisClassLateType |
| SalamisClassLateType_Turret_AMS | 0.0/1.0 | 0.0/1.0 | 12.0 | 4 | 160.0 | SalamisClassLateType |
| U_Type_Submarine_Turret_AMS | 0.0/1.5 | 0.0/1.5 | 4.0 | 4 | 160.0 | U_Type_Submarine, U_Type_Submarine_ZEON |
| U_Type_Submarine_Turret_MS | 0.0/2.25 | 0.0/2.25 | 6.0 | 12 | 72.0 | U_Type_Submarine, U_Type_Submarine_ZEON |
| ZN_YMS_16M_MS | 0.3/1.65 | 0.3/1.95 | 6.0 | 10 | 35.0 | YMS_16M |
| ZanzibarClass_Turret_AMS | 0.0/3.0 | 0.0/3.0 | 12.0 | 8 | 320.0 | ZanzibarClass |
| ZanzibarClassKai_Turret_AMS | 0.0/3.0 | 0.0/3.0 | 12.0 | 8 | 320.0 | ZanzibarClassKai |
| ZanzibarClassKai_0083_Turret_AMS | 0.0/3.0 | 0.0/3.0 | 12.0 | 8 | 320.0 | ZanzibarClassKai_0083 |
| Common_DoubleMS_ZN_APC | 0.0/0.15 | 0.0/0.15 | 3.0 | 2 | 20.0 | ZN_APC_WithMS |
| Common_DoubleMS_ZN_Heli | 0.0/1.0 | 0.0/1.0 | 6.0 | 6 | 30.0 | ZN_Heli |

## mortar

| 武器ID | 首发/末发(s) | 收招/流程(s) | CD(s) | 发数 | EN | 使用单位 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Common_Turret_Mortar_BigTrayClass | 1.1/2.9 | 1.5/4.4 | 180.0 | 27 | 0 | BigTrayClass |
| Common_Turret_Mortar_DabudeClass | 1.1/2.9 | 1.5/4.4 | 180.0 | 18 | 0 | DabudeClass |
| Common_Turret_Mortar_DabudeClass | 1.1/2.9 | 1.5/4.4 | 180.0 | 9 | 0 | GallopClass |
| Common_Turret_Mortar_HeavyForkClass | 1.1/2.9 | 1.5/4.4 | 180.0 | 27 | 0 | HeavyForkClass |
| Common_Mortar | 2.25/4.75 | 2.0/6.75 | 120.0 | 3 | 150.0 | MS_09_K_1, MS_12, RGC_80 |
| Common_MortarDouble | 2.25/4.75 | 2.0/6.75 | 120.0 | 6 | 200.0 | MS_09_K_2, MS_15C, RX_77_2, RX_77_3D |
| Common_MortarDouble_L | 2.25/4.75 | 2.0/6.75 | 120.0 | 6 | 200.0 | MS_09_K_2, MS_15C, RX_77_2, RX_77_3D |
| Common_MortarDouble_Bombing_Shell | 2.5/4.8 | 2.5/7.3 | 120.0 | 6 | 200.0 | MSM_04G |
| Common_MortarDouble_Bombing_Shell_R | 2.5/4.8 | 2.5/7.3 | 120.0 | 6 | 200.0 | MSM_04G |
| Common_Mortar_Bombing_Shell | 2.5/4.5 | 2.5/7.0 | 120.0 | 3 | 150.0 | RGC_80S |
| Common_MortarDouble | 2.25/4.75 | 2.0/6.75 | 120.0 | 6 | 200.0 | RMV_1 |
| Common_MortarDouble_L | 2.25/4.75 | 2.0/6.75 | 120.0 | 6 | 200.0 | RMV_1 |
| Common_Mortar_Bombing_MS | 2.0/4.5 | 2.5/7.0 | 120.0 | 6 | 150.0 | RTX_440 |
| Common_MortarDouble_RX_75 | 2.25/6.04 | 2.0/8.04 | 120.0 | 8 | 200.0 | RX_75 |
| Common_MortarDouble_RX_75_L | 2.25/6.04 | 2.0/8.04 | 120.0 | 8 | 200.0 | RX_75 |
| Common_MortarDouble_RX_75R | 2.25/6.04 | 2.0/8.04 | 120 | 8 | 200 | RX_75R |
| Common_MortarDouble_B4 | 2.25/6.0 | 2.0/8.0 | 120.0 | 8 | 200.0 | RX_77_3 |
| Common_MortarDouble_B4_L | 2.25/6.0 | 2.0/8.0 | 120.0 | 8 | 200.0 | RX_77_3 |
| Common_MortarDouble_Bombing_Shell | 2.5/4.8 | 2.5/7.3 | 120.0 | 6 | 200.0 | RX_77D |
| Common_MortarDouble_Bombing_Shell_R | 2.5/4.8 | 2.5/7.3 | 120.0 | 6 | 200.0 | RX_77D |
| Common_Mortar_Type61_SPG | 2.25/4.75 | 2.0/6.75 | 120.0 | 3 | 150.0 | Type61_SPG |
| Common_Mortar_YMS_16M | 2.25/7.25 | 2.0/9.25 | 120.0 | 5 | 150.0 | YMS_16M |
| Common_Mortar_Bombing_Shell_Napalm | 2.5/4.5 | 2.5/7.0 | 90.0 | 3 | 100.0 | YMT_05 |

## nuke

| 武器ID | 首发/末发(s) | 收招/流程(s) | CD(s) | 发数 | EN | 使用单位 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| ZN_MS_06C_Bombing_Nuke | 3.0/3.0 | 1.5/4.5 | 10000.0 | 1 | 350.0 | MS_06C |

## other

| 武器ID | 首发/末发(s) | 收招/流程(s) | CD(s) | 发数 | EN | 使用单位 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| ZN_AMX_002_AntiShipMS | 0.1/0.4 | 0.3/0.7 | 180.0 | 4 | 0 | AMX_002 |
| ZN_AMX_002_AntiShipMS_L | 0.1/0.4 | 0.3/0.7 | 180.0 | 4 | 0 | AMX_002 |
| ZN_ApsarasII_ChestBeam | 0.25/0.25 | 0.5/0.75 | 5.0 | 9 | 50.0 | ApsarasII |
| Squad_Combined_Weapons | 0.0/0.6 | 0.0/0.6 | 2.0 | 3 | 11.4 | Army_Squad_EFSF_0079_N_G_A |
| Squad_Combined_Weapons | 0.0/0.6 | 0.0/0.6 | 2.0 | 3 | 11.4 | Army_Squad_ZEON_0079_N_G_A |
| EF_FA_78_2_FrameLauncher_GL | 0.25/0.85 | 0.25/1.1 | 12.0 | 4 | 50.0 | FA_78_2 |
| ZN_MA_06_Leader | 1.25/1.25 | 2.5/3.75 | 90.0 | 1 | 150.0 | MA_06 |
| ZN_MAN_03_BG_1 | 0.25/0.27 | 0.0/0.27 | 5.0 | 2 | 35.0 | MAN_03 |
| ZN_MAN_03_BG_1_L | 0.25/0.27 | 0.0/0.27 | 5.0 | 2 | 35.0 | MAN_03 |
| ZN_MAN_03_BG_2 | 0.25/0.27 | 0.0/0.27 | 5.0 | 2 | 35.0 | MAN_03 |
| ZN_MAN_03_BG_2_L | 0.25/0.27 | 0.0/0.27 | 5.0 | 2 | 35.0 | MAN_03 |
| ZN_MAN_03_BG_3 | 0.25/0.27 | 0.0/0.27 | 5.0 | 2 | 35.0 | MAN_03 |
| ZN_MAN_03_BG_3_L | 0.25/0.27 | 0.0/0.27 | 5.0 | 2 | 35.0 | MAN_03 |
| ZN_MAX_03_Leader | 1.25/1.25 | 2.0/3.25 | 90.0 | 1 | 150.0 | MAX_03 |
| Common_Grenade_A | 0.35/0.35 | 0.35/0.7 | 12.0 | 1 | 40.0 | MS_06F2_Commander, MS_06S |
| ZN_Shotgun | 0.25/0.25 | 0.5/0.75 | 3.0 | 8 | 25.0 | MS_06F_Sniper, MS_08TX, MS_08TX_Kai, MS_08TX_Kai_EXAM |
| Common_Grenade_D | 0.35/0.35 | 0.35/0.7 | 12.0 | 1 | 40.0 | MS_06FZ, MS_06FZ_Commander |
| ZN_MS_09_ChestBeam | 0.1/0.1 | 0.1/0.2 | 10.0 | 8 | 20.0 | MS_09, MS_09D, MS_09R, MS_10 |
| Common_HandMS_L | 0.3/0.6 | 0.3/0.9 | 5.0 | 3 | 25.0 | MS_09_K_2 |
| ZN_MS_09_ChestBeam | 0.1/0.1 | 0.1/0.2 | 10.0 | 8 | 20.0 | MS_09F, MS_09F_TROP, MS_09F_TROP_0083, MS_09G, MS_09R2, YMS_09J |
| ZN_MS_09_ChestBeam | 0.1/0.1 | 0.1/0.2 | 10.0 | 8 | 20.0 | MS_09S |
| Common_HandMS | 0.3/0.6 | 0.3/0.9 | 5.0 | 3 | 25.0 | MS_14C |
| ZN_YMS_15_ShieldMS | 0.3/0.9 | 0.3/1.2 | 6.0 | 10 | 45.0 | MS_15A, YMS_15, YMS_15E |
| ZN_YMS_15_ShieldMS_L | 0.3/0.9 | 0.3/1.2 | 6.0 | 10 | 45.0 | MS_15A, YMS_15, YMS_15E |
| ZN_ShotgunKai | 0.25/0.25 | 0.5/0.75 | 3.0 | 8 | 25.0 | MS_18E |
| ZN_MSM_03_ChestBeam | 0.25/0.25 | 0.5/0.75 | 7.0 | 12 | 15.0 | MSM_03 |
| ZN_MSM_03_ChestBeam_L | 0.25/0.25 | 0.5/0.75 | 7.0 | 12 | 15.0 | MSM_03 |
| Common_EyeFlash | 0.6/0.6 | 1.25/1.85 | 10.0 | 1 | 30.0 | MSM_04N |
| ZN_MSM_10_ChestBeam | 0.5/1.25 | 0.5/1.75 | 3.0 | 4 | 0 | MSM_10 |
| ZN_MSM_10_ChestBeam_L | 0.5/1.25 | 0.5/1.75 | 3.0 | 4 | 0 | MSM_10 |
| EF_PublicClass_AntiShipMS | 0.0/0.2 | 0.3/0.5 | 180.0 | 2 | 0 | PublicClass |
| EF_PublicClass_BeamDiffusionMS | 0.0/0.2 | 0.3/0.5 | 180.0 | 2 | 0 | PublicClass |
| EF_HarpoonGun | 0.35/0.45 | 0.3/0.75 | 5.0 | 2 | 25.0 | RAG_79 |
| EF_RAG_79_G1_HG | 0.3/0.6 | 0.3/0.9 | 5.0 | 2 | 40.0 | RAG_79_G1 |
| EF_Railgun_79_D_RG | 0.3/0.3 | 0.3/0.6 | 9.0 | 1 | 45.0 | RGM_79_D |
| Common_Grenade_B | 0.35/0.35 | 0.35/0.7 | 12.0 | 1 | 40.0 | RGM_79G, RGM_79G_Space, RGM_79GL, RGM_79LV, RGM_79S, RGM_79SP2, RX_77_3, RX_77_3D, RX_78XX |
| Common_Grenade_B | 0.35/0.35 | 0.35/0.7 | 12.0 | 1 | 40.0 | RGM_79V |
| EF_RTX_440_Flamethrower | 0.0/0.0 | 0.0/0 | 9.0 | 1 | 45.0 | RTX_440 |
| Common_Grenade_B_Burned | 0.35/0.35 | 0.35/0.7 | 12.0 | 1 | 40.0 | RX_77_4 |
| EF_RX_78_4_HighMegaLauncher | 2.1/7.4 | 3.0/10.4 | 180.0 | 108 | 150.0 | RX_78_4_Bst |
| EF_RX_78GP01_LBR | 0.25/0.25 | 0.25/0.5 | 10.0 | 1 | 75.0 | RX_78GP01_FB |
| EF_RX_78GP02A_MRLS_S | 0.3/0.75 | 0.3/1.05 | 10.0 | 8 | 30.0 | RX_78GP02A |
| EF_RX_78GP02A_MRLS_S_L | 0.3/0.75 | 0.3/1.05 | 10.0 | 8 | 30.0 | RX_78GP02A |
| EF_RX_78GP02A_MRLS_L | 0.3/0.3 | 0.3/0.6 | 15.0 | 2 | 55.0 | RX_78GP02A |
| EF_RX_78GP02A_MRLS_L_L | 0.3/0.3 | 0.3/0.6 | 15.0 | 2 | 55.0 | RX_78GP02A |
| EF_GLine_SBR | 0.25/0.25 | 0.25/0.5 | 1.0 | 1 | 35.0 | RX_81, RX_81ST |
| EF_RX_81_GG | 0.3/0.85 | 0.3/1.15 | 4.0 | 12 | 35.0 | RX_81AS, RX_81LA, RX_81ST |
| EF_RX_81_GG_L | 0.3/0.85 | 0.3/1.15 | 4.0 | 12 | 35.0 | RX_81AS, RX_81LA, RX_81ST |
| EF_RX_81AS_Shotgun | 0.25/0.45 | 0.25/0.7 | 3.5 | 12 | 40.0 | RX_81AS |
| EF_GLine_HBR | 0.25/0.25 | 0.25/0.5 | 1.5 | 1 | 40.0 | RX_81FC, RX_81LA |
| ZN_Wappa_C4 | 0.0/0.0 | 0.0/0 | 8.0 | 1 | 40.0 | Wappa |

## sniper

| 武器ID | 首发/末发(s) | 收招/流程(s) | CD(s) | 发数 | EN | 使用单位 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| ZN_135mmAntiShipSniper | 0.35/0.35 | 1.0/1.35 | 7.5 | 1 | 45.0 | EMS_10_1 |
| ZN_135mmAntiShipSniper_Sniper_Aim | 0.25/0.25 | 0.0/0.25 | 60.0 | 1 | 75.0 | EMS_10_1 |
| ZN_135mmAntiShipSniper | 0.35/0.35 | 1.0/1.35 | 7.5 | 1 | 45.0 | EMS_10F |
| ZN_135mmAntiShipSniper_Sniper_Aim | 0.25/0.25 | 0.0/0.25 | 60.0 | 1 | 75.0 | EMS_10F |
| ZN_LongRangeBeamSniperRifle | 0.35/0.35 | 1.0/1.35 | 7.5 | 1 | 50.0 | MS_05SP, MS_06F_Sniper |
| ZN_LongRangeBeamSniperRifle_Sniper_Aim | 0.25/0.25 | 0.0/0.25 | 60.0 | 1 | 100.0 | MS_05SP, MS_06F_Sniper |
| ZN_MS_14JG_BMG_Sniper_Aim | 0.25/0.25 | 0.0/0.25 | 45.0 | 1 | 75.0 | MS_14JG |
| EF_LongRangeBeamSniperRifle | 0.35/0.35 | 1.0/1.35 | 7.5 | 1 | 45.0 | RGM_79_G_SP |
| EF_LongRangeBeamSniperRifle_Sniper_Aim | 0.25/0.25 | 0.0/0.25 | 60.0 | 1 | 100.0 | RGM_79_G_SP |
| EF_R4_BeamSniperRifle | 0.35/0.35 | 1.0/1.35 | 3.0 | 1 | 35.0 | RGM_79SC, RGM_79SP2 |
| EF_R4_BeamSniperRifle_Sniper_Aim | 0.25/0.25 | 0.0/0.25 | 45.0 | 1 | 75.0 | RGM_79SC, RGM_79SP2 |
| EF_75mmSniperRifle | 0.35/0.35 | 1.0/1.35 | 4.0 | 1 | 25.0 | RGM_79SP2 |
| EF_75mmSniperRifle_Sniper_Aim | 0.25/0.25 | 0.0/0.25 | 45.0 | 1 | 55.0 | RGM_79SP2 |
| EF_RX_78SP_BR_Sniper_Aim | 0.25/0.25 | 0.0/0.25 | 45.0 | 1 | 75.0 | RX_78SP |
