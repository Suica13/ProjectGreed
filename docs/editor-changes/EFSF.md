# EFSF 修改记录

由开发者编辑服务按成功保存的修改自动追加。详细字段前后值与来源IP记录在服务端 JSON 日志中。


## 开发者编辑例外（自动登记）

成功保存后自动登记，最新修改在前。详细字段前后值保存在服务器日志中；本节不改写上方人工维护的规则。

<!-- catalog-editor-exceptions:start -->

| 时间（日本时间） | 来源IP | 单位 | 修改对象 | 修改内容 | 详细日志 |
|---|---|---|---|---|---|
| 2026-11-07 19:07:13 | 36.161.160.31 | 吉姆加农II（RGC_83） | 共用武器 EF_RGC_83_DoubleBeamCannon__lv1 | /weapons/EF_RGC_83_DoubleBeamCannon/hit：70 → 80 | [JSON](../../server-data/editor-changes/2026-11-07/2026-11-07T10-07-13-571Z-952db561-c38d-4ab8-a887-c9561558d635.json) |
| 2026-11-07 19:07:13 | 36.161.160.31 | GLine 完全特装型（RX_81FC） | 共用武器 EF_RGC_83_DoubleBeamCannon__lv1 | /weapons/EF_RGC_83_DoubleBeamCannon/hit：70 → 80 | [JSON](../../server-data/editor-changes/2026-11-07/2026-11-07T10-07-13-571Z-952db561-c38d-4ab8-a887-c9561558d635.json) |
| 2026-11-05 15:39:35 | 126.105.69.222 | 吉姆改&#91;宇宙配色&#93;（RGM_79C_Space） | 单位特例 | /stats/cost：300 → 325 | [JSON](../../server-data/editor-changes/2026-11-05/2026-11-05T06-39-35-062Z-bfa8db89-41e4-4f20-9e19-f7c9ae0dbc0f.json) |
| 2026-11-05 15:39:22 | 126.105.69.222 | 吉姆改（RGM_79C） | 单位特例 | /stats/cost：300 → 325 | [JSON](../../server-data/editor-changes/2026-11-05/2026-11-05T06-39-22-717Z-2c3cf072-13d7-42c7-9a39-a639c56778c0.json) |
| 2026-11-05 15:39:10 | 126.105.69.222 | 吉姆改（RGM_79C） | 单位特例 | /stats/cost：325 → 300 | [JSON](../../server-data/editor-changes/2026-11-05/2026-11-05T06-39-10-922Z-631e5e7f-a869-4d6b-bfc1-30c30e5b7b26.json) |
| 2026-11-05 15:38:56 | 126.105.69.222 | 吉姆改（RGM_79C） | 单位特例 | /stats/cost：300 → 325 | [JSON](../../server-data/editor-changes/2026-11-05/2026-11-05T06-38-56-409Z-68654ef0-9361-4de0-8157-3ff30ca0f460.json) |
| 2026-11-05 15:38:25 | 126.105.69.222 | 吉姆改&#91;宇宙配色&#93;（RGM_79C_Space） | 单位特例 | /displayLocalization/en：（无） → {"name":"GM Kai&#91;SpaceColor&#93;","description":"A unit developed after standardizing the production spec…<br>/localization/ja/description：（无） → "ジムの生産規格を統一して開発された機体。信頼性が向上している。"<br>/localization/ja/name：（无） → "ジム改［宇宙配色］"<br>/stats/cost：325 → 300 | [JSON](../../server-data/editor-changes/2026-11-05/2026-11-05T06-38-25-975Z-42def1af-f59d-496f-90b5-11a6ca070b81.json) |
| 2026-11-05 15:38:04 | 126.105.69.222 | 吉姆改（RGM_79C） | 单位特例 | /displayLocalization/en：（无） → {"name":"GM Kai","description":"A unit developed after standardizing the production specifications o…<br>/localization/ja/description：（无） → "ジムの生産規格を統一して開発された機体。信頼性が向上している。"<br>/localization/ja/name：（无） → "ジム改"<br>/stats/cost：325 → 300 | [JSON](../../server-data/editor-changes/2026-11-05/2026-11-05T06-38-04-147Z-415851f7-ab92-4208-a99e-07376a823431.json) |
| 2026-11-05 15:36:47 | 126.105.69.222 | 吉姆特装型（RGM_79N） | 共用武器 EF_GMRifle__lv1 | /weapons/EF_GMRifle/attackRounds：2 → 3 | [JSON](../../server-data/editor-changes/2026-11-05/2026-11-05T06-36-47-469Z-cbe7d941-39f5-4084-9333-a39553684193.json) |
| 2026-11-05 15:36:47 | 126.105.69.222 | 吉姆加农II（RGC_83） | 共用武器 EF_GMRifle__lv1 | /weapons/EF_GMRifle/attackRounds：2 → 3 | [JSON](../../server-data/editor-changes/2026-11-05/2026-11-05T06-36-47-469Z-cbe7d941-39f5-4084-9333-a39553684193.json) |
| 2026-11-05 15:35:56 | 126.105.69.222 | 吉姆加农II（RGC_83） | 共用武器 EF_RGC_83_DoubleBeamCannon__lv1 | /weapons/EF_RGC_83_DoubleBeamCannon/damageComponents/beam：4000 → 3750<br>/weapons/EF_RGC_83_DoubleBeamCannon/damageComponents/beamAP：2000 → 1875<br>/weapons/EF_RGC_83_DoubleBeamCannon/damagePerShot：6000 → 5625 | [JSON](../../server-data/editor-changes/2026-11-05/2026-11-05T06-35-56-218Z-6b441bac-5127-4e80-a732-66bff2177416.json) |
| 2026-11-05 15:35:56 | 126.105.69.222 | GLine 完全特装型（RX_81FC） | 共用武器 EF_RGC_83_DoubleBeamCannon__lv1 | /weapons/EF_RGC_83_DoubleBeamCannon/damageComponents/beam：4000 → 3750<br>/weapons/EF_RGC_83_DoubleBeamCannon/damageComponents/beamAP：2000 → 1875<br>/weapons/EF_RGC_83_DoubleBeamCannon/damagePerShot：6000 → 5625 | [JSON](../../server-data/editor-changes/2026-11-05/2026-11-05T06-35-56-218Z-6b441bac-5127-4e80-a732-66bff2177416.json) |
| 2026-11-05 15:35:11 | 126.105.69.222 | 吉姆加农II（RGC_83） | 共用武器 EF_RGC_83_DoubleBeamCannon__lv1 | /weapons/EF_RGC_83_DoubleBeamCannon/attackRounds：1 → 2<br>/weapons/EF_RGC_83_DoubleBeamCannon/damageComponents/beam：3750 → 4000<br>/weapons/EF_RGC_83_DoubleBeamCannon/damageComponents/beamAP：1875 → 2000<br>/weapons/EF_RGC_83_DoubleBeamCannon/damagePerShot：5625 → 6000<br>/weapons/EF_RGC_83_DoubleBeamCannon/max：3 → 4 | [JSON](../../server-data/editor-changes/2026-11-05/2026-11-05T06-35-11-197Z-df60a295-7f22-41aa-9d9d-0543d32530e6.json) |
| 2026-11-05 15:35:11 | 126.105.69.222 | GLine 完全特装型（RX_81FC） | 共用武器 EF_RGC_83_DoubleBeamCannon__lv1 | /weapons/EF_RGC_83_DoubleBeamCannon/attackRounds：1 → 2<br>/weapons/EF_RGC_83_DoubleBeamCannon/damageComponents/beam：3750 → 4000<br>/weapons/EF_RGC_83_DoubleBeamCannon/damageComponents/beamAP：1875 → 2000<br>/weapons/EF_RGC_83_DoubleBeamCannon/damagePerShot：5625 → 6000<br>/weapons/EF_RGC_83_DoubleBeamCannon/max：3 → 4 | [JSON](../../server-data/editor-changes/2026-11-05/2026-11-05T06-35-11-197Z-df60a295-7f22-41aa-9d9d-0543d32530e6.json) |

<!-- catalog-editor-exceptions:end -->
