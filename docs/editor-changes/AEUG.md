# AEUG 修改记录

由开发者编辑服务按成功保存的修改自动追加。详细字段前后值与来源IP记录在服务端 JSON 日志中。


## 开发者编辑例外（自动登记）

成功保存后自动登记，最新修改在前。详细字段前后值保存在服务器日志中；本节不改写上方人工维护的规则。

<!-- catalog-editor-exceptions:start -->

| 时间（日本时间） | 来源IP | 单位 | 修改对象 | 修改内容 | 详细日志 |
|---|---|---|---|---|---|
| 2026-11-08 01:57:50 | local | 加农炮炮塔（Facility_Cannon） | 单位特例 | /displayLocalization：null → {"en":{},"ja":{}}<br>/faction：（无） → "EFSF"<br>/stats/hp：10000 → 20000 | [JSON](../../server-data/editor-changes/2026-11-08/2026-11-07T16-57-50-746Z-65624efa-5a35-4026-8c82-d7073faa858b.json) |
| 2026-11-08 01:57:49 | local | 导弹炮塔（Facility_Missile） | 单位特例 | /displayLocalization：null → {"en":{},"ja":{}}<br>/faction：（无） → "EFSF"<br>/stats/hp：7500 → 20000 | [JSON](../../server-data/editor-changes/2026-11-08/2026-11-07T16-57-49-817Z-40d7ca91-afc7-4175-9065-77bdce6d763d.json) |
| 2026-11-08 01:57:48 | local | 光束炮塔（Facility_Beam） | 单位特例 | /displayLocalization：null → {"en":{},"ja":{}}<br>/faction：（无） → "EFSF"<br>/stats/hp：10000 → 20000 | [JSON](../../server-data/editor-changes/2026-11-08/2026-11-07T16-57-48-920Z-8691afa7-9e32-4ea1-b5cb-9d39bd678afd.json) |
| 2026-11-08 01:57:48 | local | 机枪炮塔（Facility_MG） | 单位特例 | /displayLocalization：null → {"en":{},"ja":{}}<br>/faction：（无） → "EFSF"<br>/stats/hp：6250 → 20000 | [JSON](../../server-data/editor-changes/2026-11-08/2026-11-07T16-57-48-021Z-2d4aa933-804d-4e2e-bfad-fd46c8a8bc21.json) |
| 2026-11-08 01:57:44 | local | 主基地（Facility_HQ） | 单位特例 | /displayLocalization：null → {"en":{},"ja":{}}<br>/faction：（无） → "EFSF"<br>/stats/hp：375000 → 300000 | [JSON](../../server-data/editor-changes/2026-11-08/2026-11-07T16-57-44-415Z-4a4041d5-5d03-4175-a8c6-91db9000d9c8.json) |
| 2026-11-07 19:48:31 | 36.161.160.31 | 试作型力克迪亚斯（RX_098） | 共用武器 AEUG_RMS_099_BeamGun__lv1 | /weapons/AEUG_RMS_099_BeamGun/damageComponents/beam：2625 → 2000<br>/weapons/AEUG_RMS_099_BeamGun/damagePerShot：2625 → 2000 | [JSON](../../server-data/editor-changes/2026-11-07/2026-11-07T10-48-31-730Z-c22471ca-04e8-45a8-9b77-319f8921c289.json) |
| 2026-11-07 19:48:31 | 36.161.160.31 | 力克迪亚斯（RMS_099） | 共用武器 AEUG_RMS_099_BeamGun__lv1 | /weapons/AEUG_RMS_099_BeamGun/damageComponents/beam：2625 → 2000<br>/weapons/AEUG_RMS_099_BeamGun/damagePerShot：2625 → 2000 | [JSON](../../server-data/editor-changes/2026-11-07/2026-11-07T10-48-31-730Z-c22471ca-04e8-45a8-9b77-319f8921c289.json) |
| 2026-11-07 19:48:31 | 36.161.160.31 | 疾风迪亚斯（RMS_099B_Red） | 共用武器 AEUG_RMS_099_BeamGun__lv1 | /weapons/AEUG_RMS_099_BeamGun/damageComponents/beam：2625 → 2000<br>/weapons/AEUG_RMS_099_BeamGun/damagePerShot：2625 → 2000 | [JSON](../../server-data/editor-changes/2026-11-07/2026-11-07T10-48-31-730Z-c22471ca-04e8-45a8-9b77-319f8921c289.json) |
| 2026-11-07 19:48:16 | 36.161.160.31 | 试作型力克迪亚斯（RX_098） | 共用武器 AEUG_PrototypeClayBazooka__lv1 | /weapons/AEUG_PrototypeClayBazooka/damageComponents/shell：18750 → 16750<br>/weapons/AEUG_PrototypeClayBazooka/damagePerShot：18750 → 16750 | [JSON](../../server-data/editor-changes/2026-11-07/2026-11-07T10-48-16-669Z-c9f93ba9-cacc-48b4-9f3f-1d0beecf7d85.json) |
| 2026-11-07 19:07:13 | 36.161.160.31 | 吉姆加农II&#91;奥古式样&#93;（RGC_83_AEUG） | 共用武器 EF_RGC_83_DoubleBeamCannon__lv1 | /weapons/EF_RGC_83_DoubleBeamCannon/hit：70 → 80 | [JSON](../../server-data/editor-changes/2026-11-07/2026-11-07T10-07-13-571Z-952db561-c38d-4ab8-a887-c9561558d635.json) |
| 2026-11-05 15:39:35 | 126.105.69.222 | 吉姆改&#91;宇宙配色&#93;（RGM_79C_Space） | 单位特例 | /stats/cost：300 → 325 | [JSON](../../server-data/editor-changes/2026-11-05/2026-11-05T06-39-35-062Z-bfa8db89-41e4-4f20-9e19-f7c9ae0dbc0f.json) |
| 2026-11-05 15:38:25 | 126.105.69.222 | 吉姆改&#91;宇宙配色&#93;（RGM_79C_Space） | 单位特例 | /displayLocalization/en：（无） → {"name":"GM Kai&#91;SpaceColor&#93;","description":"A unit developed after standardizing the production spec…<br>/localization/ja/description：（无） → "ジムの生産規格を統一して開発された機体。信頼性が向上している。"<br>/localization/ja/name：（无） → "ジム改［宇宙配色］"<br>/stats/cost：325 → 300 | [JSON](../../server-data/editor-changes/2026-11-05/2026-11-05T06-38-25-975Z-42def1af-f59d-496f-90b5-11a6ca070b81.json) |
| 2026-11-05 15:36:47 | 126.105.69.222 | 吉姆加农II&#91;奥古式样&#93;（RGC_83_AEUG） | 共用武器 EF_GMRifle__lv1 | /weapons/EF_GMRifle/attackRounds：2 → 3 | [JSON](../../server-data/editor-changes/2026-11-05/2026-11-05T06-36-47-469Z-cbe7d941-39f5-4084-9333-a39553684193.json) |
| 2026-11-05 15:36:47 | 126.105.69.222 | 吉姆特装型&#91;奥古式样&#93;（RGM_79N_AEUG） | 共用武器 EF_GMRifle__lv1 | /weapons/EF_GMRifle/attackRounds：2 → 3 | [JSON](../../server-data/editor-changes/2026-11-05/2026-11-05T06-36-47-469Z-cbe7d941-39f5-4084-9333-a39553684193.json) |
| 2026-11-05 15:36:47 | 126.105.69.222 | 吉姆特装型&#91;FB&#93;（RGM_79N_FB_AEUG） | 共用武器 EF_GMRifle__lv1 | /weapons/EF_GMRifle/attackRounds：2 → 3 | [JSON](../../server-data/editor-changes/2026-11-05/2026-11-05T06-36-47-469Z-cbe7d941-39f5-4084-9333-a39553684193.json) |
| 2026-11-05 15:36:47 | 126.105.69.222 | 尼莫（MSA_003） | 共用武器 EF_GMRifle__lv1 | /weapons/EF_GMRifle/attackRounds：2 → 3 | [JSON](../../server-data/editor-changes/2026-11-05/2026-11-05T06-36-47-469Z-cbe7d941-39f5-4084-9333-a39553684193.json) |
| 2026-11-05 15:36:47 | 126.105.69.222 | 尼莫加农（MSA_003_Cannon） | 共用武器 EF_GMRifle__lv1 | /weapons/EF_GMRifle/attackRounds：2 → 3 | [JSON](../../server-data/editor-changes/2026-11-05/2026-11-05T06-36-47-469Z-cbe7d941-39f5-4084-9333-a39553684193.json) |
| 2026-11-05 15:35:56 | 126.105.69.222 | 吉姆加农II&#91;奥古式样&#93;（RGC_83_AEUG） | 共用武器 EF_RGC_83_DoubleBeamCannon__lv1 | /weapons/EF_RGC_83_DoubleBeamCannon/damageComponents/beam：4000 → 3750<br>/weapons/EF_RGC_83_DoubleBeamCannon/damageComponents/beamAP：2000 → 1875<br>/weapons/EF_RGC_83_DoubleBeamCannon/damagePerShot：6000 → 5625 | [JSON](../../server-data/editor-changes/2026-11-05/2026-11-05T06-35-56-218Z-6b441bac-5127-4e80-a732-66bff2177416.json) |
| 2026-11-05 15:35:11 | 126.105.69.222 | 吉姆加农II&#91;奥古式样&#93;（RGC_83_AEUG） | 共用武器 EF_RGC_83_DoubleBeamCannon__lv1 | /weapons/EF_RGC_83_DoubleBeamCannon/attackRounds：1 → 2<br>/weapons/EF_RGC_83_DoubleBeamCannon/damageComponents/beam：3750 → 4000<br>/weapons/EF_RGC_83_DoubleBeamCannon/damageComponents/beamAP：1875 → 2000<br>/weapons/EF_RGC_83_DoubleBeamCannon/damagePerShot：5625 → 6000<br>/weapons/EF_RGC_83_DoubleBeamCannon/max：3 → 4 | [JSON](../../server-data/editor-changes/2026-11-05/2026-11-05T06-35-11-197Z-df60a295-7f22-41aa-9d9d-0543d32530e6.json) |

<!-- catalog-editor-exceptions:end -->
