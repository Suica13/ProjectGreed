# NEO_ZEON 修改记录

由开发者编辑服务按成功保存的修改自动追加。详细字段前后值与来源IP记录在服务端 JSON 日志中。


## 开发者编辑例外（自动登记）

成功保存后自动登记，最新修改在前。详细字段前后值保存在服务器日志中；本节不改写上方人工维护的规则。

<!-- catalog-editor-exceptions:start -->

| 时间（日本时间） | 来源IP | 单位 | 修改对象 | 修改内容 | 详细日志 |
|---|---|---|---|---|---|
| 2026-11-08 20:01:02 | local | 雷达（Facility_Radar） | 单位特例 | /displayLocalization：null → {"en":{},"ja":{}}<br>/faction：（无） → "EFSF"<br>/stats/hp：3750 → 7500 | [JSON](../../server-data/editor-changes/2026-11-08/2026-11-08T11-01-02-880Z-26e8b135-ac8d-4a88-897f-95276b8005a2.json) |
| 2026-11-08 01:57:50 | local | 加农炮炮塔（Facility_Cannon） | 单位特例 | /displayLocalization：null → {"en":{},"ja":{}}<br>/faction：（无） → "EFSF"<br>/stats/hp：10000 → 20000 | [JSON](../../server-data/editor-changes/2026-11-08/2026-11-07T16-57-50-746Z-65624efa-5a35-4026-8c82-d7073faa858b.json) |
| 2026-11-08 01:57:49 | local | 导弹炮塔（Facility_Missile） | 单位特例 | /displayLocalization：null → {"en":{},"ja":{}}<br>/faction：（无） → "EFSF"<br>/stats/hp：7500 → 20000 | [JSON](../../server-data/editor-changes/2026-11-08/2026-11-07T16-57-49-817Z-40d7ca91-afc7-4175-9065-77bdce6d763d.json) |
| 2026-11-08 01:57:48 | local | 光束炮塔（Facility_Beam） | 单位特例 | /displayLocalization：null → {"en":{},"ja":{}}<br>/faction：（无） → "EFSF"<br>/stats/hp：10000 → 20000 | [JSON](../../server-data/editor-changes/2026-11-08/2026-11-07T16-57-48-920Z-8691afa7-9e32-4ea1-b5cb-9d39bd678afd.json) |
| 2026-11-08 01:57:48 | local | 机枪炮塔（Facility_MG） | 单位特例 | /displayLocalization：null → {"en":{},"ja":{}}<br>/faction：（无） → "EFSF"<br>/stats/hp：6250 → 20000 | [JSON](../../server-data/editor-changes/2026-11-08/2026-11-07T16-57-48-021Z-2d4aa933-804d-4e2e-bfad-fd46c8a8bc21.json) |
| 2026-11-08 01:57:44 | local | 主基地（Facility_HQ） | 单位特例 | /displayLocalization：null → {"en":{},"ja":{}}<br>/faction：（无） → "EFSF"<br>/stats/hp：375000 → 300000 | [JSON](../../server-data/editor-changes/2026-11-08/2026-11-07T16-57-44-415Z-4a4041d5-5d03-4175-a8c6-91db9000d9c8.json) |
| 2026-11-07 19:48:31 | 36.161.160.31 | 力克迪亚斯&#91;NEO ZEON&#93;（RMS_099_NEO_ZEON） | 共用武器 AEUG_RMS_099_BeamGun__lv1 | /weapons/AEUG_RMS_099_BeamGun/damageComponents/beam：2625 → 2000<br>/weapons/AEUG_RMS_099_BeamGun/damagePerShot：2625 → 2000 | [JSON](../../server-data/editor-changes/2026-11-07/2026-11-07T10-48-31-730Z-c22471ca-04e8-45a8-9b77-319f8921c289.json) |
| 2026-11-07 19:48:31 | 36.161.160.31 | 疾风迪亚斯&#91;NEO ZEON&#93;（RMS_099B_NEO_ZEON） | 共用武器 AEUG_RMS_099_BeamGun__lv1 | /weapons/AEUG_RMS_099_BeamGun/damageComponents/beam：2625 → 2000<br>/weapons/AEUG_RMS_099_BeamGun/damagePerShot：2625 → 2000 | [JSON](../../server-data/editor-changes/2026-11-07/2026-11-07T10-48-31-730Z-c22471ca-04e8-45a8-9b77-319f8921c289.json) |

<!-- catalog-editor-exceptions:end -->
