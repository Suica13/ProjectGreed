# AppTest2 原生客户端

AppTest2 是 V93 的独立试验分支。Windows 使用 .NET Framework 4.8 WinForms / WebView2，Android 使用系统 WebView；两个外壳使用同一份游戏源码、同一套原生存档适配器和同一份构建资源。不启动本地游戏服务器，不引入账号或数据库，不修改现有 WebSocket 协议。

## 客户端与运行要求

- Windows：`build/ProjectGreed-V93-AppTest2-windows-x64/ProjectGreed.exe`，完整复制文件夹后启动，不要只复制 EXE。要求 Windows 10/11 x64、.NET Framework 4.8、Microsoft Edge WebView2 Evergreen Runtime 120 或更新。F11 切换全屏。
- Android：`build/ProjectGreed-V93-AppTest2-android/ProjectGreed-V93-AppTest2-test.apk`。要求 Android 8.0 / API 26 或更新，以及 Android System WebView / Chrome 120 或更新。APK 是 AppTest2 测试签名版本，不是正式商店发行包。应用 ID 为 `io.projectgreed.apptest2`。
- 两个平台均包含本地游戏资源，支持现有离线房间和同版本服务端联机。继续支持现有 HTTP / WS 地址，网络包保持 V93 格式。手机离开前台会暂停音乐，回到前台触发现有连接同步逻辑。
- 同签名、同应用 ID 覆盖安装可以保留应用数据；更换 Android 签名或卸载之前，先在设置中导出个人存档。原网页版与软件版之间使用原有 JSON 存档导入导出迁移，不自动读取个人浏览器目录。

## 存档与失败处理

Windows 个人应用文件位于 `%LOCALAPPDATA%/ProjectGreed/AppTest2/profile.json`，上次有效版本为 `profile.json.bak`。Android 位于应用私有目录 `files/profile/profile.json`，上次有效版本为 `profile.previous.json`。数据目录与安装包资源分离，替换 Windows 程序目录不会覆盖存档。

原生启动时载入文件，向现有同步存档调用提供内存视图。每次更新必须收到原生文件落盘确认后，才更新内存。钱包与驾驶员、个人档案导入等多键操作由一次原生提交完成；原生提交失败不会先修改钱包。使用递增版本拒绝旧视图覆盖新存档，不将异步写盘当作购买成功。

单个原生存档文件限制为64 MiB，避免异常数据导致失控内存占用；这不是浏览器 localStorage 配额。原有个人 JSON 导入文件仍受32 MiB校验。设置的“检查存储”会标明原生文件后端。

主文件损坏时尝试上次有效备份，保留损坏原件，并提示恢复。主文件与备份都无法读取时停止加载，不静默创建空档覆盖数据。Windows 可在关闭程序后备份整个数据目录，再人工恢复有效文件；Android 应优先使用事先导出的 JSON 存档并保留应用数据用于排查。

导出使用系统保存文件对话框，Android 导入使用系统文档选择器。原生接口只管理应用存档和经用户选择的导出文件；外部网页不在带原生接口的窗口内加载。生产启动默认不开放调试端口。

## 构建

安装 Node.js（沿用项目要求）和 .NET SDK。Windows SDK 项目通过 NuGet 获取固定版本 WebView2 和 .NET Framework 引用，不把 Node.js、Chromium 或 .NET SDK 随客户端打包。

```text
npm ci
npm run app:windows
```

Android 需要 JDK 17/21、Gradle 8.13、Android SDK platform 36 与 build-tools 36.0.0。可以复用已安装的 Unity Android 工具链，不修改它。将 `apps/toolchain.example.json` 复制为被 Git 忽略的 `apps/toolchain.local.json` 并填入路径，或设置 `ANDROID_HOME`、`JAVA_HOME`、`GRADLE_HOME`。

```text
npm run app:android
```

两个命令默认先执行普通客户端构建，再构建共用软件资源。已准备好资源时可以加 `-- --prepared`。`npm run app:prepare` 仅准备资源。发行目录包含 SHA-256 文件清单；不包含测试存档、开发工具或服务端数据。

`public/client.html` 仍是普通网页的独立单文件。软件版由 `tools/build-app-client.cjs` 从它生成：提取去重图片和音频、外置脚本与目录数据，只在软件版加入原生桥接及内容策略，不维护另一份游戏逻辑。

## 验证命令

```text
npm run app:test:storage
npm run app:test:windows
npm run app:android -- --with-tests
```

Windows 检查启动实际 EXE，使用 `tmp/` 内的隔离数据目录。覆盖真实文件锁失败不扣钱、6 MiB存档与完整进程重启、驾驶员创建、机体和套件购买、原生导出和导入、连接原样服务端的独立测试端口及离线房间。测试-only 命令行参数 `--app-test-port`、`--app-test-data`、`--app-test-export` 仅由该检查显式启用，正常启动不启用。

Android 原生存档检查程序不依赖额外测试框架，编译为独立 instrumentation APK。设备连接后执行：

```text
adb install -r build/ProjectGreed-V93-AppTest2-android/ProjectGreed-V93-AppTest2-test.apk
adb install -r apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am instrument -w io.projectgreed.apptest2.test/io.projectgreed.apptest2.StoreInstrumentation
```

设备检查使用专用测试子目录，不改个人 `files/profile` 存档。覆盖6 MiB、Unicode、重启、备份恢复、版本冲突、原子替换失败以及双损坏文件保护。

首轮验证边界：Windows 实际程序端到端检查通过；Android APK和设备测试APK编译通过、签名与清单已核对，但本机没有连接 Android 设备，因此不将窄屏键盘、安全区、前后台、系统文件选择器及完整联机战斗声明为真机通过。完整退出后的离线房间状态与原网页版一样，不自动持久化为可恢复战局；个人进度单独保存。
