# ProjectGreed V13 IP 联机工程

- `shared/rules.js` 是回合、移动、武器、命中与伤害的共用规则。服务端是唯一裁定者；客户端只提交动作意图，不提交HP、伤害或随机结果。
- `server.js` 提供 HTTP 和 `/ws`，默认绑定 `0.0.0.0:1313`，启动端口读取同目录 `cfg.json`，CLI和PORT环境变量可临时覆盖。房间状态只保存在内存。不要将席位 token、随机 seed 放入公开战局快照。
- `client/app.js` 管理界面和演出；`client/network.js` 管理连接、重连、服务器快照和动作确认；`client/renderer.js` 使用MOD原贴图和关键帧。
- 改源码后默认执行 `npm run build`，重建可独立打开的 `public/client.html`。用户明确要求构建服务端时才执行 `npm run package:server`。用户于2026-10-31明确要求重新制作精简开发者版：仅图鉴、单位预览及单位／通用武器属性编辑。仅在明确要求时执行build:developer；独立编辑服务要求密钥认证（默认13450），HTML手动输入IP后加载后台数据，不读取个人存档或播放BGM。默认本机监听；远程监听与访问范围由developer-config.json配置。保存只写源JSON，不自动构建或重载游戏。游戏服务器与普通客户端不开放编辑接口。默认不构建服务端或 br/gz。不要只改生成的HTML。
- `npm test` 通过真实 WebSocket 连接验证权限、非法操作、版本冲突、重复请求、攻击计划队列、按玩家并行应战与独立演出、重连和完整对局。
- 日常验证按本次改动范围运行相关 Node/WebSocket 与浏览器回归，再执行构建。V22（`7da9838`）已复现的166项基线失败不再作为日常重复运行的全量检查；修改到对应功能或用户明确要求全量验收时，先核对现行需求与旧断言后再复查。基线失败一致只代表本次未增加同名失败，不能据此宣称全部无影响，也不要为消除旧断言失败擅自改动现行数值与规则。
- 操作请求必须有唯一ID和战局revision；以服务端校验为准。各玩家同时处理自己的应战请求，同一玩家逐个处理单位；全部应战选择完成后统一按顺序裁定，双方同步整批结果；客户端使用 map-combat.js 在大地图独立播放，不弹出战斗窗口；整批地图交战并行播放，所有等待名单中的人类玩家（含观战者）确认 playback_ready 后才交接回合或进入胜利倒计时。重复发送不得重复扣血或扣资源。
- 新玩法保持可逐步试玩，不要擅自更换框架或加入账号、数据库。原型素材来自用户的RW_GW项目。

- 维护单一客户端源码；服务器首页直接提供 `public/client.html`，不再生成重复的 index.html。活动管理与地图编辑器是独立工具。
- `client/ui-layout.json` 是构建时布局源，`ui-layout.js` 应用共用白名单布局。UI布局修改功能已移除；单位及武器可通过精简开发者版维护源码配置，科技树通过源码配置维护。修改后校验和构建客户端，重启服务端加载新规则。不要复制游戏逻辑。

- 原 MOD 单位移植、左右武器或衍生形态工作，请使用项目技能 `.agents/skills/projectgreed-mod-unit-import/SKILL.md`；状态报告由对应脚本生成，旧版本号本身不是删除脚本的依据。

- 人工数值编辑使用 `shared/editor-adjustments.json` 保存相对基准的加减值，在全局规则之后应用，再执行既有取整与校验；导入器不得将已叠加的差值烘焙回基础数值。数值保存与日志及例外表格共用事务。

- 运行时全局换算倍率由 `shared/conversion-rules.json` 维护，先于人工差值执行；开发者编辑器可维护此文件及 `assets/unit-wip.json`，均要求版本校验、审计与失败回滚，不自动构建或重启游戏。

- `docs/rules/combat.md` 是现行战斗规则统一查询入口，由 `tools/export-combat-rules.cjs` 生成。修改武器、技能、状态、格纳库或驾驶员技能后执行 `npm run docs:combat-rules`；执行逻辑变化时同步维护生成器中的文字说明。普通客户端构建自动刷新报告，`npm run docs:combat-rules -- --check` 校验是否过时，不直接手改生成表格。


## 临时文件与验证产物

- 临时文件统一放在根目录 `tmp/`，不得在根目录、`.openai/` 或 `build/` 留下验证产物。截图写入 `tmp/verification/screenshots/`，测试日志写入 `tmp/verification/logs/`，性能报告写入 `tmp/verification/reports/`，Playwright 输出写入 `tmp/verification/browser-results/`，原生客户端验证隔离数据放在 `tmp/verification/native/`。一次性脚本放在 `tmp/scripts/`，验证完成后删除；长期可复用的测试保留在 `tests/`，工具保留在 `tools/`。`build/` 仅存放构建、打包产物及必要的构建缓存；不要用 `--output build/...` 覆盖测试输出目录。历史验证材料统一归档在 `tmp/verification/archive/`，清理时不得删除正式发行包、玩家存档或服务端运行日志。

## 文档维护

- 新地图按地形和共享部署区安排出生位，优先紧凑的二维簇；不要为增加玩家席位而单向拉长出生位、部署区或地图。雇佣兵战争每队6个可选玩家席位，阵营友军独立于这些席位；同队部署区允许重叠，敌队部署区仍须分离。

- 项目说明与生成的Markdown统一放入docs/，按docs/README.md分类。根README.md只作入口；根AGENTS.md与.agents/skills/*/SKILL.md因工具发现约定保留原位。不要在源码或素材目录新建说明MD。
- 现行武器与技能规则只维护docs/rules/combat.md，由tools/export-combat-rules.cjs生成；AP仅保留stats.actionPoints与actionCost参考值，禁止新增AP倍率、预算、扣费、返还或减AP状态。穿甲beamAP等伤害分量与行动点无关，保持正常结算。
- 移动文档须同步生成器、审计事务、打包输入与链接；已完成的临时速报不作为现行规则保留。维护记录及例外差值按原事务保留。


- 发行产物按 `project.json` 的版本统一归档到 `build/<版本号>/`（例如 `build/V103/`）。Windows、Android、服务端和HTML产物均放在该版本目录内；APK命名为 `ProjectGreed-<版本号>.apk`。`public/client.html`仍保留为服务端读取的生成文件，通用构建缓存与验证目录不作为发行包交付。

- 用户明确说“build／构建／打包”且未限定目标时，默认同时构建 Windows 客户端、新 Android GeckoView 客户端、独立 HTML 和含 HTML 的服务端文件夹，执行 `npm run release:all`，统一归档 `build/<版本号>/`。日常修改后的 `npm run build` 仍只用于网页生成与验证；不因例行验证自动打包原生客户端或服务端。
