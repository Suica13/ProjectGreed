# 源码导读

共享规则由服务端裁定，客户端只提交动作意图。路径均相对仓库根目录。

| 入口 | 职责 |
| --- | --- |
| shared/rules.js | 地图、移动、命中、伤害、轮次与AI共用规则 |
| shared/automatic-fire.js / attack-plans.js | 自动武器轮数、EN预估、小队计划、应战和交替时间轴 |
| shared/unit-skills.js / hangars.js / pilots.js | 主动技能、载员和驾驶员 |
| shared/room-engine.js | 房间权限、动作去重、AI调度、回合与结算 |
| client/app.js / network.js | 交互、连接、快照、重试与重连 |
| client/map-combat.js / renderer.js | 大地图战斗演出和原MOD贴图 |
| shared/conversion-rules.json | 统一数值换算；不含AP规则 |
| shared/editor-adjustments.json | 人工数值相对差值，最后应用 |
| tools/load-catalog.cjs | 组合模板、单位覆盖、换算、人工差值与完整校验 |
| tools/developer-server.cjs / catalog-editor-store.cjs | 管理员认证、编辑、版本校验和原子事务 |

攻击时选择敌方小队和交战方式，服务端自动生成合法武器序列；所有防守玩家确认应战后统一裁定。射击按双方轮数交替，射击结束后格斗。客户端独立播放权威事件，所有等待名单玩家及观战者确认完成后才交接。

AP仅保留单位stats.actionPoints、武器及技能actionCost参考字段；没有余额、倍率、预算、扣费、恢复或AP减益。EN、冷却、弹药、部位、驾驶员门槛及每回合使用次数仍有效。

修改源码后执行npm run build重建public/client.html。服务端规则修改需重启游戏服务；编辑保存只写源配置，不自动构建。默认不构建开发者版、不打包服务端、不生成br/gz。

现行规则见[武器与技能](../rules/combat.md)，文档总入口见[索引](../README.md)。
