# ProjectGreed V13 IP 联机工程

- `shared/rules.js` 是回合、移动、武器、命中与伤害的共用规则。服务端是唯一裁定者；客户端只提交动作意图，不提交HP、伤害或随机结果。
- `server.js` 提供 HTTP 和 `/ws`，默认绑定 `0.0.0.0:1313`，启动端口读取同目录 `cfg.json`，CLI和PORT环境变量可临时覆盖。房间状态只保存在内存。不要将席位 token、随机 seed 放入公开战局快照。
- `client/app.js` 管理界面和演出；`client/network.js` 管理连接、重连、服务器快照和动作确认；`client/renderer.js` 使用MOD原贴图和关键帧。
- 改源码后默认执行 `npm run build`，仅重建可独立打开的 `public/client.html`。用户明确要求构建服务端时才执行 `npm run package:server`；明确要求开发者版时才执行 `npm run build:developer`，生成 `public/developer.html`。默认不构建开发者版、服务端或 br/gz。不要只改生成的HTML。
- `npm test` 通过真实 WebSocket 连接验证权限、非法操作、版本冲突、重复请求、攻击计划队列、按玩家并行应战与独立演出、重连和完整对局。
- 日常验证按本次改动范围运行相关 Node/WebSocket 与浏览器回归，再执行构建。V22（`7da9838`）已复现的166项基线失败不再作为日常重复运行的全量检查；修改到对应功能或用户明确要求全量验收时，先核对现行需求与旧断言后再复查。基线失败一致只代表本次未增加同名失败，不能据此宣称全部无影响，也不要为消除旧断言失败擅自改动现行数值与规则。
- 操作请求必须有唯一ID和战局revision；以服务端校验为准。各玩家同时处理自己的应战请求，同一玩家逐个处理单位；全部应战选择完成后统一按顺序裁定，双方同步整批结果；客户端使用 map-combat.js 在大地图独立播放，不弹出战斗窗口；整批地图交战并行播放，所有等待名单中的人类玩家（含观战者）确认 playback_ready 后才交接回合或进入胜利倒计时。重复发送不得重复扣血或扣资源。
- 新玩法保持可逐步试玩，不要擅自更换框架或加入账号、数据库。原型素材来自用户的RW_GW项目。

- 维护同一套源码的客户端与开发者版。`public/developer.html` 仅额外包含单位与科技树属性编辑器；客户端 `public/client.html` 必须排除开发者工具。服务器首页直接提供客户端，不再生成重复的 index.html。
- `client/ui-layout.json` 是构建时布局源，`ui-layout.js` 应用共用白名单布局。UI 布局修改功能暂时停用。`source-editor.js/css` 仅注入开发者版，通过本机开发接口保存到对应 JSON；设置中的重载先校验和构建，再更新服务端规则和刷新网页。已有联机房间时禁止重载。不要复制两套游戏逻辑。

- 原 MOD 单位移植、左右武器或衍生形态工作，请使用项目技能 `.agents/skills/projectgreed-mod-unit-import/SKILL.md`；状态报告由对应脚本生成，旧版本号本身不是删除脚本的依据。
