# 0087单位与科技树移植清单

> 本页保留来源和移植核对信息；统计为生成时快照。现行游戏数值与已实现规则以[共享规则报告](../rules/combat.md)及执行代码为准。

科技目录引用162种战斗单位，其中136种使用0087来源，其余沿用已有0079／0083机体与人工配置。

## 固定规则

- 联邦或吉翁任一阵营的全部0079早期、0079后期和0083科技完成后，免费获得AEUG、TITANS、NEO_ZEON三个0087 BASE科技。
- 未达门槛时，三个0087科技树及右侧单位详情均显示黑色遮罩：请先完成任何0079科技树。
- 第二页首项暂为999999科技点，原值保留在sourceCosts.points与temporaryPointOverride.nativePoints中；其余资金、物资沿用原MOD的两倍。
- 单位套件沿用原生EquipmentIndex 0；部署许可及原生工厂整批／单机／换装费用独立归档，不恢复个人套件库存。
- 不支持的机制显式标记review；原MOD只读，正常构建无需原MOD。

## 第二页临时限制

| 阵营 | 科技 | 原科技点 | 暂定科技点 |
|---|---|---:|---:|
| AEUG | Tech_AEUG_0087_T2_ZetaGundamDevelopmentPlan · Z高达开发计划 | 10800 | 999999 |
| TITANS | Tech_TITANS_0087_T2_SpaceTypeTMSDevelopmentPlan · 宇宙用TMS开发计划 | 10800 | 999999 |
| NEO_ZEON | Tech_NEO_ZEON_0087_T2_QubeleyDevelopmentPlan · 卡碧尼开发计划 | 10800 | 999999 |

## 单位索引

| ID | 中文名称 | 可用阵营 | 年代 | 套件数 | 部署许可：资金／物资 |
|---|---|---|---|---:|---|
| RMS_179_AEUG | 吉姆II[奥古式样] | AEUG | 0087 | 3 | 700 / 750 |
| RGC_83_AEUG | 吉姆加农II[奥古式样] | AEUG | 0087 | 2 | 1400 / 1750 |
| RGM_79N_AEUG | 吉姆特装型[奥古式样] | AEUG | 0087 | 3 | 1050 / 1150 |
| RGM_79C_KS | 吉姆改[KS] | AEUG | 0087 | 3 | 600 / 750 |
| RGM_79SP2 | 吉姆狙击型II | EFSF, AEUG, TITANS | 0079L | 3 | 1050 / 1550 |
| RGM_79C_Space | 吉姆改[宇宙配色] | EFSF, AEUG, TITANS | 0079L | 4 | 550 / 850 |
| RX_77D | 量产型钢加农 | EFSF, AEUG, TITANS | 0079L | 1 | 900 / 1500 |
| RX_77_4 | 钢加农II | EFSF, AEUG, TITANS | 0079L | 2 | 2700 / 4000 |
| RX_77_3 | 钢加农重装型 | EFSF, AEUG, TITANS | 0079E | 2 | 2200 / 3200 |
| RGM_79SC | 吉姆狙击特装型 | EFSF, AEUG, TITANS | 0079L | 2 | 850 / 950 |
| RGC_80 | 吉姆加农 | EFSF, AEUG, TITANS | 0079L | 2 | 750 / 1100 |
| RGC_80S | 吉姆加农[空间战式样] | EFSF, AEUG, TITANS | 0079L | 2 | 750 / 1050 |
| MS_06M_0087 | 水中型扎古[0087] | AEUG, TITANS, NEO_ZEON | 0087 | 1 | 250 / 500 |
| MS_07H_0087 | 老虎飞行实验型[0087] | AEUG, TITANS, NEO_ZEON | 0087 | 2 | 600 / 750 |
| MS_06E3 | 扎古强行侦查型E3 | ZEON, AEUG, TITANS, NEO_ZEON | 0079E | 1 | 450 / 900 |
| MS_11 | 机动扎古 | ZEON, AEUG, TITANS, NEO_ZEON | 0079E | 2 | 850 / 1000 |
| FF_S3 | 剑鱼 | EFSF, AEUG, TITANS | 0079E | 1 | 200 / 500 |
| MedeaKai | 米迪亚改 | EFSF, AEUG, TITANS | 0079E | 1 | 500 / 1000 |
| GrayPhantomClass_0087 | 灰色幽灵级[0087] | AEUG, TITANS | 0087 | 1 | 7000 / 14500 |
| ColumbusClassKai | 哥伦布级改 | EFSF, AEUG, TITANS | 0079L | 1 | 1000 / 2000 |
| SalamisClassKai_0087_AEUG | 萨拉米斯级改[0087][AEUG] | AEUG | 0087 | 1 | 4000 / 5250 |
| RX_098 | 试作型力克迪亚斯 | AEUG | 0087 | 1 | 3250 / 3500 |
| DodaiKai | 德戴改 | AEUG | 0087 | 1 | 750 / 1500 |
| RX_77D_4 | 量产型钢加农II | AEUG | 0087 | 1 | 1400 / 1750 |
| RGM_79N_FB_AEUG | 吉姆特装型[FB] | AEUG | 0087 | 3 | 1250 / 1550 |
| RMS_099 | 力克迪亚斯 | AEUG | 0087 | 2 | 2150 / 2500 |
| RX_178_AEUG | 高达MK-II[AEUG] | AEUG | 0087 | 3 | 2700 / 3200 |
| MSA_003 | 尼莫 | AEUG | 0087 | 4 | 900 / 1050 |
| RMS_179_Nemo | 吉姆II[尼莫] | AEUG | 0087 | 3 | 700 / 750 |
| IrishClass | 爱尔兰级 | AEUG | 0087 | 1 | 7000 / 12000 |
| MSN_100 | 百式 | AEUG | 0087 | 3 | 5000 / 6300 |
| MSK_008 | 迪杰 | AEUG | 0087 | 3 | 3200 / 4800 |
| RX_178_AEUG_FlyingArmor | 高达MK-II[AEUG][SFS] | AEUG | 0087 | 3 | 3200 / 3950 |
| RX_178_AEUG_FXA_05D | 超级高达 | AEUG | 0087 | 1 | 3500 / 5000 |
| GarudaClass_AEUG | 迦楼罗级[AEUG] | AEUG | 0087 | 1 | 6000 / 12000 |
| MSA_005 | 麦塔斯 | AEUG | 0087 | 1 | 2350 / 2850 |
| MSA_004 | 尼莫II | AEUG | 0087 | 4 | 1300 / 1350 |
| ArgamaClass | 阿伽玛级 | AEUG | 0087 | 1 | 14500 / 25000 |
| MSZ_000 | 零式 | AEUG | 0087 | 3 | 4000 / 4500 |
| MSA_003_FXA_05D | 尼莫[G-D] | AEUG | 0087 | 1 | 2200 / 3000 |
| MSA_003_FXA_05D_EWAC | 尼莫[G-D][EWAC] | AEUG | 0087 | 1 | 2500 / 4000 |
| MSA_003_Cannon | 尼莫加农 | AEUG | 0087 | 4 | 2700 / 3300 |
| MSR_00100S | 百式改 | AEUG | 0087 | 3 | 5500 / 6800 |
| MSA_003_HM | 尼莫高机动型 | AEUG | 0087 | 3 | 3200 / 3300 |
| MSZ_006 | Z高达 | AEUG | 0087 | 2 | 8500 / 9000 |
| MSF_007 | 高达MK-III | AEUG | 0087 | 3 | 3700 / 5700 |
| MSA_004K | 尼莫III | AEUG | 0087 | 3 | 1650 / 1950 |
| RMS_099B_Red | 疾风迪亚斯 | AEUG | 0087 | 2 | 2500 / 3000 |
| MSZ_006A1 | ZetaPlus A1 | AEUG | 0087 | 2 | 5350 / 5350 |
| MSZ_006C1 | ZetaPlus C1 | AEUG | 0087 | 1 | 5850 / 6650 |
| MSZ_010 | ZZ高达 | AEUG | 0087 | 1 | 14500 / 17500 |
| MSZ_008 | Z II | AEUG | 0087 | 1 | 6500 / 7500 |
| MSA_099_2 | 力克迪亚斯II | AEUG | 0087 | 1 | 4000 / 4000 |
| RGM_86R | 吉姆III | AEUG | 0087 | 3 | 1000 / 1250 |
| RGM_86R_FXA_05D | 吉姆III | AEUG | 0087 | 1 | 2250 / 3050 |
| RGM_86R_Nouvel | 新式吉姆III | AEUG | 0087 | 1 | 2000 / 2650 |
| MSZ_010S | 强化型ZZ高达 | AEUG | 0087 | 1 | 17500 / 20000 |
| FA_010S | 全装甲ZZ高达 | AEUG | 0087 | 1 | 20500 / 23000 |
| FA_010A | FAZZ | AEUG | 0087 | 1 | 12500 / 12500 |
| FA_00100S | 全装甲百式改 | AEUG | 0087 | 1 | 6700 / 8500 |
| MSR_00100S_M | 量产型百式改 | AEUG | 0087 | 3 | 3800 / 4450 |
| MSA_005S | 麦塔斯改 | AEUG | 0087 | 1 | 2650 / 3350 |
| MSA_005K | 钢加农探测者 | AEUG | 0087 | 1 | 2000 / 2500 |
| MSN_001 | 德尔塔高达 | AEUG | 0087 | 1 | 10000 / 10000 |
| MSA_0011 | S高达 | AEUG | 0087 | 2 | 14500 / 16500 |
| MSA_007 | 尼洛 | AEUG | 0087 | 1 | 3000 / 3000 |
| MSA_007T | 尼洛训练型 | AEUG | 0087 | 1 | 3500 / 3500 |
| MSA_0011_Ext | EX-S高达 | AEUG | 0087 | 1 | 17500 / 20000 |
| MSA_007E | 尼洛[EWAC] | AEUG | 0087 | 1 | 3500 / 4500 |
| RMS_106 | 高扎古 | TITANS | 0087 | 3 | 750 / 950 |
| RMS_179_TITANS | 吉姆II[提坦斯式样] | TITANS | 0087 | 3 | 700 / 750 |
| RGC_83_TITANS | 吉姆加农II[提坦斯式样] | TITANS | 0087 | 2 | 1400 / 1750 |
| RGM_79Q | 吉姆镇暴型 | TITANS | 0087 | 3 | 1050 / 1150 |
| SalamisClassKai_0087_TITANS | 萨拉米斯级改[0087][TITANS] | TITANS | 0087 | 1 | 4000 / 5250 |
| RX_178 | 高达MK-II | TITANS | 0087 | 3 | 2700 / 3200 |
| RMS_117 | 加里波第β | TITANS | 0087 | 1 | 1500 / 1900 |
| RGM_79Q_ChobamArmor | 吉姆镇暴型[乔巴姆] | TITANS | 0087 | 3 | 1050 / 1350 |
| BaseJabber | 航空踏板 | TITANS | 0087 | 1 | 750 / 1750 |
| Gator | 加托尔 | TITANS, NEO_ZEON | 0087 | 1 | 750 / 1500 |
| RMS_108 | 玛拉塞 | TITANS | 0087 | 2 | 1250 / 1600 |
| RMS_179_FedayeenRifle | 吉姆II[斗士步枪] | TITANS | 0087 | 1 | 1150 / 1350 |
| AlexandriaClass | 亚历山大级 | TITANS | 0087 | 1 | 7500 / 14500 |
| RX_160 | 拜亚兰 | TITANS | 0087 | 1 | 4500 / 5500 |
| NRX_044_TR_3 | 试作型阿西玛TR-3[基哈尔] | TITANS | 0087 | 1 | 3500 / 3750 |
| RX_178_Unit4 | 高达MK-II[Unit4] | TITANS | 0087 | 3 | 2900 / 3500 |
| GarudaClass_TITANS | 迦楼罗级[TITANS] | TITANS | 0087 | 1 | 6000 / 12000 |
| NRX_044 | 阿西玛 | TITANS | 0087 | 1 | 2150 / 2850 |
| RX_110 | 卡普斯利 | TITANS | 0087 | 1 | 2500 / 2850 |
| RMS_154 | 巴扎姆 | TITANS | 0087 | 3 | 1550 / 1650 |
| DogosseGiarClass | 多戈斯·基亚级 | TITANS | 0087 | 1 | 16500 / 28000 |
| RX_121 | 高达TR-1[海兹尔] | TITANS | 0087 | 3 | 1700 / 1700 |
| RX_121_1 | 高达TR-1[海兹尔改] | TITANS | 0087 | 3 | 1700 / 2000 |
| RX_121_HighMobilityForm | 高达TR-1[海兹尔改][高机动型] | TITANS | 0087 | 1 | 3000 / 3000 |
| RX_121_TripleBooster | 高达TR-1[海兹尔][三重推进器] | TITANS | 0087 | 3 | 1400 / 1650 |
| RMS_106CS | 高扎古特装型 | TITANS | 0087 | 1 | 1400 / 1850 |
| RMS_119 | EWAC扎古 | TITANS | 0087 | 1 | 900 / 1500 |
| RX_121_1_FF_X29A | 高达TR-1[海兹尔拉] | TITANS | 0087 | 1 | 3500 / 3750 |
| MRX_009 | 精神感应高达 | TITANS | 0087 | 1 | 15000 / 15000 |
| RX_121_2A | 高达TR-1[进阶型海兹尔] | TITANS | 0087 | 3 | 2700 / 3000 |
| RX_121_2A_M | 高达TR-1[进阶型海兹尔][M] | TITANS | 0087 | 3 | 2050 / 2350 |
| RX_139 | 汉布拉比 | TITANS | 0087 | 1 | 6000 / 8000 |
| ORX_005 | 加布兰 | TITANS | 0087 | 1 | 4000 / 5000 |
| PMX_000 | 梅萨拉 | TITANS | 0087 | 1 | 6500 / 7500 |
| PMX_003 | 铁奥 | TITANS | 0087 | 1 | 8500 / 10000 |
| PMX_002 | 波里诺克·萨曼 | TITANS | 0087 | 1 | 3500 / 5000 |
| PMX_001 | 帕拉斯 雅典娜 | TITANS | 0087 | 1 | 6000 / 7500 |
| RMS_154_Kai | 巴扎姆改 | TITANS | 0087 | 3 | 2900 / 2900 |
| RX_124 | 高达TR-6[伍德渥特] | TITANS | 0087 | 1 | 4750 / 4750 |
| RX_121_3C | 高达TR-1[海瑟斯雷] | TITANS | 0087 | 1 | 3750 / 4250 |
| ORX_005_TR_5 | 加布兰 TR-5 | TITANS | 0087 | 1 | 4500 / 6250 |
| RGM_86R_EFSF | 吉姆III[EFSF] | TITANS | 0087 | 3 | 1000 / 1250 |
| RX_124_FF_X39A | 高达TR-6[伍德渥特·拉II] | TITANS | 0087 | 1 | 6500 / 8250 |
| ORX_005_TR_5_FF_X39A | 弗莱尔·拉II | TITANS | 0087 | 1 | 5500 / 6750 |
| RX_124_Kehaar2 | 高达TR-6[基哈尔II] | TITANS | 0087 | 1 | 6250 / 6750 |
| RX_124_Kehaar2_M | 高达TR-6[基哈尔II][M] | TITANS | 0087 | 1 | 4150 / 4500 |
| MRX_010 | 精神感应高达MK-II | TITANS, NEO_ZEON | 0087 | 1 | 20000 / 20000 |
| NRX_055 | 猎犬 | TITANS | 0087 | 1 | 5500 / 5500 |
| MS_09R_Stutzer | 力克大魔复合装备 | NEO_ZEON | 0087 | 2 | 850 / 1050 |
| MS_06F_Stutzer | 扎古II复合装备 | NEO_ZEON | 0087 | 2 | 700 / 850 |
| MS_09S | 多瓦兹 | ZEON, NEO_ZEON | 0083 | 2 | 900 / 1150 |
| YMS_18 | 斗士原型机 | ZEON, NEO_ZEON | 0079L | 1 | 2000 / 2250 |
| MS_15FS | 强人海军陆战队型[指挥官] | ZEON, NEO_ZEON | 0083 | 1 | 1950 / 2750 |
| MS_15F | 强人海军陆战队型 | ZEON, NEO_ZEON | 0083 | 1 | 1200 / 1550 |
| MS_14FS | 勇士海军陆战队型[指挥官型] | ZEON, NEO_ZEON | 0083 | 3 | 1550 / 2350 |
| MS_14F | 勇士海军陆战队型 | ZEON, NEO_ZEON | 0083 | 3 | 950 / 1150 |
| MS_06F2_Commander | 扎古II后期型[指挥官机] | ZEON, NEO_ZEON | 0079E | 3 | 650 / 750 |
| MS_06F2 | 扎古II F2后期型 | ZEON, NEO_ZEON | 0079E | 3 | 450 / 550 |
| Dopp | 多普 | ZEON, NEO_ZEON | 0079E | 1 | 200 / 350 |
| FatUncleKai | 胖叔叔改 | ZEON, NEO_ZEON | 0079E | 1 | 500 / 1000 |
| ZanzibarClassKai_0087 | 桑吉巴尔级改[0087] | NEO_ZEON | 0087 | 1 | 7000 / 14500 |
| PazockClass | 帕佐克级 | ZEON, NEO_ZEON | 0079L | 1 | 1000 / 2000 |
| MusaiClassFinalType | 姆塞级最终生产型 | NEO_ZEON | 0087 | 1 | 3750 / 4750 |
| ChivvayClassKai | 契贝级改 | ZEON, NEO_ZEON | 0079L | 1 | 5000 / 11000 |
| MS_14A_Stutzer | 勇士复合装备 | NEO_ZEON | 0087 | 2 | 1400 / 1450 |
| MS_09SS | 多瓦兹改 | NEO_ZEON | 0087 | 2 | 1400 / 1750 |
| MS_15K | 强人改 | NEO_ZEON | 0087 | 1 | 1550 / 1650 |
| AGX_04A1 | 大丁草-4改 | NEO_ZEON | 0087 | 1 | 4500 / 5500 |
| GwanbanClass | 格万班级 | NEO_ZEON | 0087 | 1 | 7500 / 12500 |
| RMS_099_NEO_ZEON | 力克迪亚斯[NEO ZEON] | NEO_ZEON | 0087 | 2 | 1850 / 2650 |
| RMS_106_NEO_ZEON | 高扎古[NEO ZEON] | NEO_ZEON | 0087 | 3 | 750 / 1000 |
| GarudaClass_NEO_ZEON | 迦楼罗级[NEO ZEON] | NEO_ZEON | 0087 | 1 | 6000 / 12000 |
| AMX_003 | 加撒C | NEO_ZEON | 0087 | 1 | 1000 / 1350 |
| RMS_119_NEO_ZEON | EWAC扎古[NEO ZEON] | NEO_ZEON | 0087 | 1 | 900 / 1150 |
| GwadanClass | 格瓦丹级 | NEO_ZEON | 0087 | 1 | 16500 / 30000 |
| MS_14J | 改修型勇士 | NEO_ZEON | 0087 | 2 | 1650 / 2050 |
| AMX_002 | 路维·捷露 | ZEON, NEO_ZEON | 0083 | 1 | 17500 / 17500 |
| AMX_004_1 | 卡碧尼 | NEO_ZEON | 0087 | 1 | 8500 / 10000 |
| AMX_006 | 加撒D | NEO_ZEON | 0087 | 1 | 1350 / 1650 |
| AMX_009 | 德莱森 | NEO_ZEON | 0087 | 2 | 2150 / 2850 |
| RMS_099B_NEO_ZEON | 疾风迪亚斯[NEO ZEON] | NEO_ZEON | 0087 | 2 | 2500 / 3350 |
| AMX_101 | 卡尔斯J | NEO_ZEON | 0087 | 1 | 3150 / 3150 |
| AMX_101K | 卡尔斯K | NEO_ZEON | 0087 | 1 | 3200 / 3500 |
| AMX_102 | 兹萨 | NEO_ZEON | 0087 | 1 | 1500 / 1750 |
| AMX_103 | 悍马·悍马 | NEO_ZEON | 0087 | 1 | 6500 / 8000 |
| AMX_109 | 卡普尔 | NEO_ZEON | 0087 | 1 | 1500 / 2000 |
| AMX_008 | 加佐姆 | NEO_ZEON | 0087 | 1 | 2150 / 2500 |
| AMX_004G | 量产型卡碧尼 | NEO_ZEON | 0087 | 1 | 5850 / 6650 |
| AMA_01X | 杰姆鲁芬 | NEO_ZEON | 0087 | 1 | 5000 / 6500 |
| AMX_011 | 扎古III | NEO_ZEON | 0087 | 1 | 3000 / 4000 |
| AMX_014 | 飙狼 | NEO_ZEON | 0087 | 1 | 8500 / 9500 |
| AMX_107 | 龙飞 | NEO_ZEON | 0087 | 1 | 7500 / 9000 |
| AMX_107M | 龙飞量产型 | NEO_ZEON | 0087 | 1 | 5000 / 6000 |
