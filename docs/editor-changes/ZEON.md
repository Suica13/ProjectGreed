# ZEON 修改记录

由开发者编辑服务按成功保存的修改自动追加。详细字段前后值与来源IP记录在服务端 JSON 日志中。


## 开发者编辑例外（自动登记）

成功保存后自动登记，最新修改在前。详细字段前后值保存在服务器日志中；本节不改写上方人工维护的规则。

<!-- catalog-editor-exceptions:start -->

| 时间（日本时间） | 来源IP | 单位 | 修改对象 | 修改内容 | 详细日志 |
|---|---|---|---|---|---|
| 2026-11-03 21:04:07 | 192.168.0.234 | 扎梅尔（YMS_16M） | 单位特例 | /weapons/Common_Mortar_YMS_16M/hit：60.775000000000006 → 60 | [JSON](../../server-data/editor-changes/2026-11-03/2026-11-03T12-04-07-108Z-1987db29-01de-4190-a9fb-693d9a0d38bc.json) |
| 2026-11-03 21:02:04 | 192.168.0.234 | 扎梅尔（YMS_16M） | 单位特例 | /displayLocalization/en：（无） → {"name":"Xamel","description":"A long-range attack prototype MS developed by the Zeon forces at the …<br>/localization/ja/description：（无） → "一年戦争末期にジオン軍が開発した長距離攻撃用試作MS。操縦手と砲手の2名で運用する。"<br>/localization/ja/name：（无） → "ザメル"<br>/weapons/ZN_YMS_16M_Cannon_AP/attackRounds：2 → 1<br>/weapons/ZN_YMS_16M_Cannon_AP/hit：80.75 → 70<br>/weapons/ZN_YMS_16M_Cannon_AP/min：2 → 3<br>/weapons/ZN_YMS_16M_Cannon_HE/hit：71.25 → 70<br>/weapons/ZN_YMS_16M_Cannon_HE/min：2 → 3 | [JSON](../../server-data/editor-changes/2026-11-03/2026-11-03T12-02-04-461Z-a6d0ae25-cbd5-4de6-a928-df6c8bd85b79.json) |

<!-- catalog-editor-exceptions:end -->
