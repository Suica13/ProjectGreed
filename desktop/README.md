# ProjectGreed 桌面客户端（clientTest 实验分支）

复用现有 `public/client.html` 和同一套游戏逻辑，通过 Electron 运行，包含本地素材、现有单机与联机功能。联机仍连接原有独立服务器；本包不包含服务端或开发者工具。不承诺相比浏览器提高帧率。

## 使用与构建

使用 Node.js 24，执行 `npm ci`。`npm run desktop` 构建并启动；`npm run package:desktop` 构建当前平台安装包，输出到 `dist/desktop/`。

| 平台 | 默认产物 | 使用方法 |
| --- | --- | --- |
| Windows x64 | NSIS exe / zip | 安装，或解压后运行 ProjectGreed.exe |
| macOS x64/arm64 | dmg / zip | 在 Mac 上构建并安装 |
| Linux x64 | AppImage / tar.gz | AppImage 添加执行权限，或解压 tar.gz 后运行 projectgreed |

AppImage 可能需要系统提供 FUSE。优先在目标系统构建。`.github/workflows/desktop.yml` 在 clientTest 推送或手动触发时，在三平台执行启动测试并打包，保存 Actions artifacts，不自动发布 Release。

本次 Windows 便携包在 Linux 交叉打包，关闭 exe 资源编辑，故可执行文件可能显示 Electron 默认元数据。各目标系统常规构建使用标准配置。尚未进行代码签名或 macOS 公证；系统可能显示未知开发者提示。

Electron 不支持 Android/iOS；本轮没有制作手机安装包。

## 存档

存档保存在各系统 appData 下的 ProjectGreed 目录，安装目录改变不影响存档位置，卸载安装器默认保留用户数据。浏览器与软件不会自动共享存档：在原浏览器设置中导出，再在软件设置中导入。现有 Blob 下载使用系统保存对话框。摄像头等权限默认拒绝，普通游戏音频播放不需要这些权限。

## 验证

`npm run test:desktop` 启动真实 Electron，验证页面初始化、Node 隔离、沙箱和 localStorage 重启持久化。Linux CI 使用 `xvfb-run -a npm run test:desktop`。测试使用临时独立存档目录。可通过 DESKTOP_EXECUTABLE 指向已解包程序验证成品。

本轮构建环境禁止 Electron 单实例机制需要的本地 socket，实际启动测试被环境阻断，不能将打包成功视作启动验证通过。目标系统仍需实测存档导入导出、音频、单机对局、WebSocket 联机和升级后存档；macOS 目前仅配置构建流程。
