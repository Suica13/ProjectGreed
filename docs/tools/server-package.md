# Windows 服务端打包

解压整个 ZIP 到可写目录，双击 `start_server.bat`。已附带 Windows Node.js 运行环境与 ws 依赖，无需安装 Node.js、npm 或 Python，也无需联网安装依赖。不要仅复制 BAT 或 node.exe。

默认打包纯服务端，不含客户端；显式加--with-client可附带客户端和独立工具页面。开发者编辑服务需单独启动，不随游戏服务开放。玩家使用同版本客户端连接；附带客户端时服务端首页直接提供网页。

- `cfg.json`：默认端口1313，监听所有网卡。修改后重启；`start_server.bat --port 端口` 与 PORT 环境变量可临时覆盖。公网访问需放行对应 TCP 端口并设置路由器端口转发。
- `open_activities.bat`：启动服务器后打开本机活动管理工具，也可访问 http://127.0.0.1:1313/admin/activities.html 。该管理工具保留，不是游戏客户端，沿用仅限本机管理的权限。
- `server-data/`：首次启动自动生成，保存活动、领取记录及累计进度。请备份整个目录；升级时保留它和自己的 cfg.json。发行包不会携带打包者的数据。
- `shared/server-catalog.json`：从完整单位目录校验并导出的规则数据，与同版本客户端数值一致。改规则后须从开发项目重新打包；纯服务端不提供开发者编辑与重建功能。
- `runtime/`：Node 运行环境及完整许可证；`node_modules/ws/LICENSE` 为 ws 许可证。
- `manifest.json` 与 ZIP 旁的 `.sha256`：文件及压缩包校验信息。

关闭窗口或按 Ctrl+C 停服。房间、对局只保存在内存中，停服后不会保留；个人存档仍在玩家浏览器中。

重新打包：项目开发目录执行 `npm run package:server`（打包机需 Windows、Node >=22、Python 3 和已安装的项目依赖）。不压缩且附带客户端可用npm run package:server -- --folder --with-client，输出新build子文件夹。输出到 `build/`。首次打包下载对应 Node 版本的完整许可证，此后复用缓存；运行服务端无需网络下载。默认不构建或打包游戏HTML，也不生成br/gz。运行说明放在发行目录docs/使用说明.md。
