# Battle Universe SLG

基于 Gundam Wars MOD 素材制作的浏览器回合制战术游戏原型。包含 RX-78-2、RX-77-2、RX-75，支持双人IP联机、离线热座和AI对战。

## 从仓库启动

安装 Node.js 22 或更高版本，克隆仓库后在工程目录运行：

```sh
npm ci --omit=dev --ignore-scripts
npm start
```

发布版：<http://127.0.0.1:1313/>

开发者版：<http://127.0.0.1:1313/developer.html>

端口由根目录 `cfg.json` 配置。开发者版左下角可开启UI布局编辑；导出的布局保存到 `client/ui-layout.json`，再运行 `npm run build` 同步更新开发者版和发布版。

仓库保留已构建的 `public/*.html`，可直接用浏览器打开。联机时仍需运行服务端。仓库不提交 `node_modules`，首次运行需执行上面的依赖安装命令。

## 开发检查

```sh
npm run build
npm test
```

详细玩法、局域网连接、断线恢复和UI编辑说明见 [使用说明](使用说明.md)。原始美术素材来自 Gundam Wars MOD。

开发者版支持独立场景预览、界面元素选择与拖拽、战斗机体位置和倍率调整，以及桌面／平板／手机布局。无需实际打一场战斗即可预览命中、未命中、反击和击破。

源码职责、可视化编辑步骤、JS 常用写法和检查命令见 [代码导读](代码导读.md)。
