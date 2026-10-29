# 显示文本与本地化

`units.json` 按单位 ID 补充名称和简介；`pilots.json` 按原作驾驶员 ID 补充姓名和介绍。修改中文原始数据、数值或存档结构不属于本地化职责。

`tools/display-localization.cjs` 在目录加载和 HTML 构建时应用补充数据，并从 `client/locales/en.json`、`ja.json` 补齐武器、套件、技能等通用文本。原 MOD 再导入不会删除本目录。游戏 ID、资源路径、武器发射链及数值保持不变。玩家自定义名称、聊天和存档中的可编辑名称不作为系统词条改写。

当前覆盖 267 个单位（日文名称和介绍）、40 名 ACE（日文姓名、完整介绍和技能说明），以及全部目录武器、套件、单位技能。原创装备和假想型号沿用 MOD 的含义翻译，不将其描述冒充官方设定。英文原介绍原则上保留，修正部分明显的显示名拼写和漏掉的形态后缀。

核对名称时使用的资料：

- [万代南梦宫《战斗行动2》MS目录](https://adm-bo2.ggame.jp/jp/ms_stage/ms.php)：一年战争、MSV及外传机体的日文名称。
- [《战场之绊》MS列表](https://gundam-kizuna.jp/4/game/ms/list/)：例如 MSM-03 ゴッグ，区分ゴッグ、ズゴック和ハイゴッグ。
- [《0083》官网](https://www.gundam0083.net/story/)：试作高达、アルビオン等名称。
- [GUNDAM.INFO：ハーマン・ヤンデル](https://www.gundam.info/special-series/gundam-power-word/83.html)。
- [漫画百科：宇宙、閃光の果てに…](https://mangapedia.com/機動戦士ガンダム外伝宇宙、閃光の果てに…-b3qtum0p8)：キルスティン・ロンバート等外传角色。

检查命令：

```sh
node tools/audit-localization.cjs
node --test tests/localization.test.cjs
npm run build
npx playwright test tests/localization.spec.cjs tests/localization-network.spec.cjs
```

审计检查目录缺项、英文中的中文残留、中英日词条键与占位符一致性，以及简单引号包围的 UI/报错文本。动态拼接文案还需依靠技能说明测试和浏览器检查；这些检查不代表每个罕见战报组合都已人工校对。
