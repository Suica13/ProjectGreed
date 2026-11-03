# 驾驶员属性解锁武器

来源：原 MOD 单位继承后的 `hiddenAction_*_Trigger`。由 `tools/native_pilot_weapons.py` 定向刷新；攻击、反击、AI统一检查实际配属驾驶员，属性不足时仍可在武器栏查看门槛。

- 格斗 `>145` 表示最低146，`>165` 表示最低166。不会把严格大于改为大于等于。
- 原 RTS 的随机选招交由玩家选择连段，不作为额外随机解锁概率。部位、护盾、EN、AP、射程与连段步骤仍有效。
- 武器加入单位原有套件，不新增收费套件；其他隐藏换装保持原限制。
- 八项属性的原生 SkillFinal 有明确映射；未知属性、等级或复合 OR 条件保留隐藏，需另行核对。

| 单位 | 武器 ID | 原生显示名 | 驾驶员门槛 | 额外护盾要求 |
| --- | --- | --- | --- | --- |
| RX_78_1 | `EF_BeamSaber_Double_AALDF` | 双光束军刀 | 格斗 >145 | — |
| RX_78_2 | `EF_BeamSaber_Double_AALDF` | 双光束军刀 | 格斗 >145 | — |
| RGM_79_Commander | `EF_BeamSaber_Double_AALDF` | 双光束军刀 | 格斗 >145 | — |
| RX_80PR | `Common_Cqb_B_L` | 近身格斗 | 格斗 >145 | 护盾 >0 |
| RGM_79DO | `Common_ArmBeamSaber_F` | 光束军刀 | 格斗 >145 | — |
| RX_78XX | `EF_BeamDagger_Double_AALDE` | 近身格斗 | 格斗 >145 | — |
| YMT_05 | `Common_Cqb_A` | 格斗 | 格斗 >145 | — |
| MS_11S | `EF_BeamSaber_F_Yellow` | 光束军刀 | 格斗 >145 | — |
| MS_08TX | `ZN_HeatSword_BF_B` | 近身格斗 | 格斗 >145 | — |
| RX_79_BD_1_EXAM | `Common_Cqb_B_L` | 近身格斗 | 格斗 >145 | 护盾 >0 |
| RX_80PR_HADES | `EF_BeamSaber_Double_AALDF` | 双光束军刀 | 格斗 >145 | — |
| RX_80PR_GroundType_HADES | `EF_BeamSaber_Double_DE` | 光束军刀 | 格斗 >145 | — |
| RX_79_BD_2_EXAM | `EF_BeamSaber_F` | 光束军刀 | 格斗 >145 | — |
| RX_78NT_1 | `EF_BeamSaber_Double_AALDF` | 双光束军刀 | 格斗 >145 | — |
| RX_78_3 | `EF_BeamSaber_Double_AALDF` | 双光束军刀 | 格斗 >145 | — |
| RX_81ST | `EF_BeamSaber_Double_AALDF` | 双光束军刀 | 格斗 >145 | — |
| RX_81LA | `EF_BeamSaber_Double_BBLDF` | 光束军刀 | 格斗 >145 | — |
| RX_81AS | `EF_BeamSaber_F` | 光束军刀 | 格斗 >165 | — |
| RX_78_4_Bst | `EF_BeamSaber_Double_AALDF` | 双光束军刀 | 格斗 >145 | — |
| RX_78_5_Bst | `EF_BeamSaber_Double_AALDF` | 双光束军刀 | 格斗 >145 | — |
| RGM_79FP | `EF_BeamSaber_F` | 光束军刀 | 格斗 >145 | — |
| RGM_79FP | `Common_Cqb_A_L` | 近身格斗 | 格斗 >145 | 护盾 >0 |
| RX_78_6 | `EF_BeamSaber_Double_AALDF` | 双光束军刀 | 格斗 >145 | — |
| RGM_79_D | `Common_Cqb_A_L` | 近身格斗 | 格斗 >145 | 护盾 >0 |
| RX_78_7 | `EF_BeamSaber_Double_AALDF` | 双光束军刀 | 格斗 >145 | — |
| FA_78_3 | `EF_BeamSaber_Double_AALDF` | 双光束军刀 | 格斗 >145 | — |
| YMS_15 | `ZN_YMS_15_BeamSaber_F` | 光束军刀 | 格斗 >145 | — |
| MS_14FS | `EF_BeamSaber_F_Yellow` | 光束军刀 | 格斗 >145 | — |
| MS_15Kg | `ZN_MS_15B_BeamLance_B2` | 近身格斗 | 格斗 >145 | — |
| RX_80PR_SpaceType_HADES | `EF_BeamSaber_Double_DE` | 光束军刀 | 格斗 >145 | — |

共 29 个单位／形态、30 项武器。

## 原 MOD 缺失流程例外

`RX_81AS / Common_Cqb_B_L` 仅有触发器，完整继承链无对应发射／排队流程和左侧攻击动画引用，仍保留隐藏并标记 `source_missing`。不能用其他单位的同名攻击替代。
