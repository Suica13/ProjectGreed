# ProjectGreed 文档索引

游戏规则以共享服务端代码和结构化配置为准；旧版速报不作为当前行为说明。新文档及生成报告统一放在本目录。运行npm run docs:check校验位置与本地链接。

| 分类 | 内容 |
| --- | --- |
| rules | 现行战斗、驾驶员、小队、战略、经济与部署许可规则 |
| guides | 使用与源码导读、房间、图鉴、本地化和活动管理 |
| tools | 服务端打包、地图编辑器和单位工坊 |
| maps / data | 地图结构、地理数据和本地化数据维护 |
| imports | 原MOD移植来源、清单和未实现机制；reports/保存生成清单及历史时间线，不是当前平衡规则 |
| maintenance / editor-changes | 例外配置、审计日志、性能证据和维护待办 |
| design | 驾驶员特性、天赋与合约任务类型的策划记录；草案不代表已实现 |

## 常用入口

- [特性与合约任务策划](design/README.md)
- [驾驶员天赋：45项](design/pilot-talents.md)
- [合约模式任务类型记录](design/contract-task-types.md)
- [0079T1吉翁陆地部队池](design/contract-force-pools-zeon-0079t1.md)
- [0079T1联邦陆地部队池](design/contract-force-pools-efsf-0079t1.md)
- [战斗行动2天人4级机体移植](imports/gbo2-gn-level4.md)
- [Thunderbolt移植与舰船价格调整](imports/thunderbolt-duel.md)
- [补给扭蛋机奖池与代币](rules/supply.md)
- [合约事件HTML策划编辑器](tools/contract-event-editor.md)
- [现行武器与技能规则](rules/combat.md)
- [驾驶员与指挥](rules/pilots.md)
- [小队](rules/squads.md)
- [舰队与搭载编组](rules/formation.md)
- [基地仓储](rules/storage.md)
- [联络与商人](rules/contact.md)
- [吉翁联络人任务链与策划JSON](design/zeon-contact.md)
- [阿纳海姆委托与零件购买解锁](design/anaheim-contact.md)
- [零件图标与生成提示](imports/unit-plugin-icons.md)
- [基地设施](rules/base-facilities.md)
- [收益](rules/economy.md)
- [合约模式](rules/contracts.md)
- [合约模式难度评估](maintenance/contract-difficulty.md)
- [合作模式：任务模式](rules/missions.md)
- [部署许可与库存](rules/licenses.md)
- [服务器打包与运行](tools/server-package.md)
- [Windows / Android 软件客户端](tools/native-clients.md)
- [Android 内置 Gecko 客户端](tools/android-gecko.md)
- [本地对局记录](tools/local-records.md)
- [遭遇战生态图集](maps/encounter-biomes.md)
- [源码导读](guides/code-tour.md)
- [人工例外表](maintenance/unit-exceptions.md)
- [编辑记录](editor-changes/README.md)
- [本轮文档清理记录](maintenance/document-cleanup.md)
- [构建体积与工作区清理](tools/workspace-cleanup.md)
- [独立HTML客户端](tools/client-package.md)
- [任务树编辑器与AI制作说明](tools/task-tree-editor.md)

## 全部文档

- [data/localization.md](data/localization.md)
- [guides/code-tour.md](guides/code-tour.md)
- [guides/localization-units.md](guides/localization-units.md)
- [guides/rooms-maps.md](guides/rooms-maps.md)
- [guides/server-activities.md](guides/server-activities.md)
- [guides/weapons-catalog.md](guides/weapons-catalog.md)
- [imports/0079-additional.md](imports/0079-additional.md)
- [imports/0079-early.md](imports/0079-early.md)
- [imports/0079-late.md](imports/0079-late.md)
- [imports/0087-gaps.md](imports/0087-gaps.md)
- [imports/0087-units.md](imports/0087-units.md)
- [imports/0087-selected.md](imports/0087-selected.md)
- [imports/ace-pilots.md](imports/ace-pilots.md)
- [imports/migration-audit.md](imports/migration-audit.md)
- [imports/other-beam-weapons.md](imports/other-beam-weapons.md)
- [imports/remote-weapons.md](imports/remote-weapons.md)
- [imports/salamis.md](imports/salamis.md)
- [imports/ship-turrets.md](imports/ship-turrets.md)
- [imports/skill-conversion.md](imports/skill-conversion.md)
- [imports/skill-mechanics.md](imports/skill-mechanics.md)
- [imports/skill-pipeline.md](imports/skill-pipeline.md)
- [imports/0093-selected.md](imports/0093-selected.md)
- [imports/seed.md](imports/seed.md)
- [imports/seed-corrections.md](imports/seed-corrections.md)
- [imports/weapon-names.md](imports/weapon-names.md)
- [imports/weapon-icons.md](imports/weapon-icons.md)
- [maintenance/v86-release.md](maintenance/v86-release.md)
- [maintenance/editor-save-and-armor-piercing.md](maintenance/editor-save-and-armor-piercing.md)
- [maintenance/performance-unit-ai.md](maintenance/performance-unit-ai.md)
- [maintenance/cooperative-ai-performance.md](maintenance/cooperative-ai-performance.md)
- [maintenance/performance-v98.md](maintenance/performance-v98.md)
- [maintenance/rendering-v100.md](maintenance/rendering-v100.md)
- [maintenance/roadmap.md](maintenance/roadmap.md)
- [maintenance/unit-exceptions.md](maintenance/unit-exceptions.md)
- [maps/campaign-regional-geography.md](maps/campaign-regional-geography.md)
- [maps/geography-source.md](maps/geography-source.md)
- [maps/map-layout.md](maps/map-layout.md)
- [rules/campaign.md](rules/campaign.md)
- [rules/battlefield.md](rules/battlefield.md)
- [rules/combat.md](rules/combat.md)
- [rules/economy.md](rules/economy.md)
- [rules/escape.md](rules/escape.md)
- [rules/hangars.md](rules/hangars.md)
- [rules/licenses.md](rules/licenses.md)
- [rules/parts-terrain.md](rules/parts-terrain.md)
- [rules/pilot-weapons.md](rules/pilot-weapons.md)
- [rules/pilots.md](rules/pilots.md)
- [rules/squads.md](rules/squads.md)
- [tools/save-editor.md](tools/save-editor.md)
- [tools/map-editor.md](tools/map-editor.md)
- [tools/server-package.md](tools/server-package.md)
- [tools/unit-editor.md](tools/unit-editor.md)

- [maintenance/v87-release.md](maintenance/v87-release.md)

- [maintenance/v88-release.md](maintenance/v88-release.md)

- [V123 地图与合作任务](maintenance/v123-content.md)

- [CE0071T1地球联合军地面部队池](design/contract-force-pools-omni-ce0071t1.md)
- [CE0071T1扎夫特地面部队池](design/contract-force-pools-zaft-ce0071t1.md)
- [CE0071T1联络任务链](design/ce-contact.md)
