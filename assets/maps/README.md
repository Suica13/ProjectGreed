# 地图目录与战略剧本

- `encounter/`：常规战、快速战使用的独立遭遇战地图，仍由 `assets/unit-catalog.json` 的 `maps` 注册。
- `strategy/index.json`：战略剧本入口，由单位目录的 `scenarioIndex` 引用。
- `strategy/<剧本ID>/scenario.json`：剧本名称、人数、世界地图路径、各区块局地战引用。
- `strategy/<剧本ID>/world.json`：大地图区域、多边形、控制方、相邻关系及经济设定。
- `strategy/<剧本ID>/geography-source.json`：可重新生成地理轮廓的源设定。
- `strategy/<剧本ID>/local-battles/`：各区块的5v5局地战地图。当前43张为可直接编辑的基础地图，不是原作地图复刻。

## 区块引用与复用

所有路径相对于剧本目录。区块默认引用自己的局地战地图：

```json
"alaska": { "map": "local-battles/alaska_5v5.json" }
```

可以复用遭遇战地形，同时沿用阿拉斯加的据点/入口布局：

```json
"alaska": {
  "map": "@encounter/military_base_5v5",
  "layout": "local-battles/alaska_5v5.json"
}
```

`layout` 可以引用含 `strategic` 的完整地图，也可以引用独立的据点布局JSON。复用地图必须支持5v5，布局坐标必须位于地图内；入口的 `region` 必须与世界地图的相邻区块一致。加载时会校验据点数量、坐标、引用及补给图连通性。

## 据点布局

`strategic.nodes` 中有1个 `kind: "base"` 的中心基地及4～8个 `kind: "outpost"` 小据点。`radius` 是占领/维修半径；`deploymentRadius` 是部署半径，基地较大，据点较小。

`strategic.gates` 为边缘出口，`region` 指向相邻战略区块。当前生成器按大地图相对方位摆放，并正确处理日期变更线。`strategic.links` 用端点ID `a`、`b` 连接基地、据点和出口。

白线表示未联通；从己方中心基地或己方相邻区块入口出发，沿己方据点连续连接的线路显示队伍颜色。敌方占领中间据点会切断连接。联通线上移动消耗除以1.25，对应移动力提高25%。

地面单位进入敌方据点范围后可在行动栏最左侧占领，花费5AP；飞行中或搭载中的单位不能占领。联通据点每个己方回合恢复15%耐久/30%EN，基地恢复20%/40%，均不超过上限。

防守方可从各己方据点及基地部署；进攻方每支部队只能从其 `entryFrom` 对应入口部署。新参战部队需确认部署；AI及委任部队自动确认。原战场存活单位再次进入时锁定并保留位置，不能借增援重新部署；放不下的增援留作区域预备队。

单位到达出口附近后可转移，离开当前战场，下一战略回合抵达对应区块；运输载员随舰同行。转移不是击毁，不结算损失。占领敌方中心基地或消灭敌军可结束本阶段；基地失守后双方存活部队留在原地，下一大回合继续交战。

`python tools/generate-campaign-maps.py` 只补齐缺失地图与区块索引，不覆盖已编辑地图或已修改的复用引用。
