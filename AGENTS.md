# ProjectGreed V05 IP 联机工程

- `shared/rules.js` 是回合、移动、武器、命中与伤害的共用规则。服务端是唯一裁定者；客户端只提交动作意图，不提交HP、伤害或随机结果。
- `server.js` 提供 HTTP 和 `/ws`，默认绑定 `0.0.0.0:1313`，启动端口读取同目录 `cfg.json`，CLI和PORT环境变量可临时覆盖。房间状态只保存在内存。不要将席位 token、随机 seed 放入公开战局快照。
- `client/app.js` 管理界面和演出；`client/network.js` 管理连接、重连、服务器快照和动作确认；`client/renderer.js` 使用MOD原贴图和关键帧。
- 改源码后执行 `npm run build`，重建 `public/index.html` 和可独立打开的 `public/client.html`。不要只改生成的HTML。
- `npm test` 通过真实 WebSocket 连接验证权限、非法操作、版本冲突、重复请求、攻击计划队列、按玩家并行应战与独立演出、重连和完整对局。
- 操作请求必须有唯一ID和战局revision；以服务端校验为准。各玩家同时处理自己的应战请求，同一玩家逐个处理单位；全部应战选择完成后统一按顺序裁定，双方同步整批结果；客户端使用 map-combat.js 在大地图独立播放，不弹出战斗窗口；整批地图交战并行播放，所有等待名单中的人类玩家（含观战者）确认 playback_ready 后才交接回合或进入胜利倒计时。重复发送不得重复扣血或扣资源。
- 新玩法保持可逐步试玩，不要擅自更换框架或加入账号、数据库。原型素材来自用户的RW_GW项目。

- 维护同一套源码的开发者版与发布版。`public/developer.html` 含UI布局编辑器，发布版 `public/index.html` / `client.html` 必须排除编辑器代码、工具和本地开发布局缓存。
- `client/ui-layout.json` 是构建时布局源；`ui-layout.js` 为共用白名单布局应用，`ui-editor.js` 仅注入开发者版。开发者版可导出带当前布局的发布HTML。不要复制两套游戏逻辑。
