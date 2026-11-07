# 原生客户端（V100）

原生客户端最初在 AppTest2 试验分支开发，V93 已纳入主分支；对外名称统一为 ProjectGreed；应用 ID、签名密钥及 Windows 存档目录沿用旧版，方便覆盖更新。Windows 使用 .NET Framework 4.8 WinForms / WebView2，Android 使用系统 WebView；两个外壳使用同一份游戏源码、同一套原生存档适配器和同一份构建资源。不启动本地游戏服务器，不引入账号或数据库，不修改现有 WebSocket 协议。

## 客户端与运行要求

- Windows：`build/ProjectGreed-V100-windows-x64/ProjectGreed.exe`，完整复制文件夹后启动，不要只复制 EXE。要求 Windows 10/11 x64、.NET Framework 4.8、Microsoft Edge WebView2 Evergreen Runtime 120 或更新。F11 切换全屏。
- Android：`build/ProjectGreed-V100-android/ProjectGreed.apk`。要求 Android 8.0 / API 26 或更新，以及具备所需功能的 Android System WebView / Chrome（启动时检测实际能力，不强制120版）。APK 沿用原有 Android Debug 签名密钥，支持覆盖旧客户端；对外应用名和文件名不含 Test。应用 ID 为 `io.projectgreed.apptest2`。
- 两个平台均包含本地游戏资源，支持现有离线房间和同版本服务端联机。继续支持现有 HTTP / WS 地址，沿用现有网络协议，联机需使用同版本服务端。手机离开前台会暂停音乐，回到前台触发现有连接同步逻辑。
- 同签名、同应用 ID 覆盖安装可以保留应用数据；更换 Android 签名或卸载之前，先在设置中导出个人存档。原网页版与软件版之间使用原有 JSON 存档导入导出迁移，不自动读取个人浏览器目录。

## WebView 80 兼容

自 V93 / 安装版本码93004起，以 WebView80 为最低脚本语法目标。安卓系统最低要求仍为8.0；WebView80之前版本不在支持范围。先加载兼容层，再检测实际功能，通过后才读取个人存档和加载游戏。原先120版本限制已移除。

客户端打包使用 esbuild 把所有可执行脚本转换到Chrome80语法；core-js补齐structuredClone、Array.at、Object.hasOwn等接口，补齐replaceChildren，并使用WICG inert补丁保留对话框的背景输入保护。兼容层在存档适配器之前加载，继续保持同步保存／失败不扣资源的契约。普通网页、服务端协议和共用游戏源码不作兼容分叉。

构建同时生成原始样式表与旧内核样式表。现代内核使用原样式；旧内核使用PostCSS展开的:is/:where选择器及css-has-pseudo的动态关系选择器补丁。80～82内核还有按钮内部grid/flex布局缺陷，通过保留原按钮、增加内部布局容器修正，不改点击和键盘操作。旧版样式在小屏下优先保证卡片内容可读，生产卡片至少78px并允许滚动；不承诺与现代内核逐像素相同。兼容脚本和许可文本随包离线交付，不依赖在线CDN，不内置另一套浏览器。

真实旧内核检查：使用Chromium官方Windows历史快照`722234`（80.0.3987.0），通过原生版本CDP运行。覆盖功能预检、循环引用及Map/Set/日期/TypedArray复制、动态:has更新、驾驶员招募、机体及套件生产、存档重载、编组卡片、连接原服务端、战斗移动及射击计划、横竖屏视口，并保存截图。该检查是实际80浏览器引擎运行，不是修改user-agent模拟；仍不能代替Android WebView及该vivo设备的真机验收。

```text
npm run app:test:chrome80
```

默认读取`build/toolchains/chromium80/chrome-win/chrome.exe`，也可用`PROJECTGREED_CHROMIUM80`指定已安装的Chromium80。测试浏览器仅访问本机测试资源，使用`tmp/`内的独立数据，不打开玩家浏览器资料。源码仓库不包含旧浏览器二进制。旧内核来源与补丁说明：[Puppeteer2.1固定快照](https://github.com/puppeteer/puppeteer/blob/v2.1.0/package.json)、[esbuild目标语法](https://esbuild.github.io/api/#target)、[关系选择器补丁](https://github.com/csstools/postcss-plugins/tree/main/plugins/css-has-pseudo)。

## 安卓横竖屏与存档文件夹

安卓显示版本为 `V100`，安装版本码为 `100000`，应用 ID 和签名沿用之前的版本，支持覆盖安装。主菜单、房间准备、编组、生产、驾驶员、图鉴和历史战役战略地图固定竖屏；进入战斗场景（包括战斗回放）后允许随设备传感器切换横竖屏，退出战斗恢复竖屏。WebView 启用 viewport meta 支持，横屏沿用现有完整 1600×900 虚拟布局并缩放适配，不裁切中央区域。

第一次进入主菜单时弹出“将存档保存在其他文件夹可以避免意外丢失存档,要指定外置文件夹保存存档吗?”，提供“选择文件夹”和“关闭”。关闭后继续使用内部存档，不反复提示；设置里的“选择存档文件夹”按钮允许以后重新选择。战斗中该按钮不可用，以免切换位置重新加载中断对局。

选择本机文档中的专用子文件夹（例如 `Documents/ProjectGreed`）。使用 Android 系统文件夹选择器和持久化目录授权，不申请整盘管理权限。Android 11 及以上不允许直接选中存储根目录或 Download 根目录，可使用其允许的子文件夹。以 [Android 官方目录授权说明](https://developer.android.com/training/data-storage/shared/documents-files) 为准。

选择空文件夹时会复制当前完整存档并回读校验，成功保存目录授权设置后才切换；原内部文件保留，但以后只读写所选文件夹。若文件夹已经有有效软件版存档，则读取已有存档，不用内部存档覆盖它。重新安装后再次选择原文件夹即可读取其中的存档。取消选择、授权失败或写入校验失败时，原位置保持不变。需要提供可同步落盘的本机文件夹；无法同步保存的云盘提供器会被拒绝。

## 存档与失败处理

Windows 个人应用文件位于 `%LOCALAPPDATA%/ProjectGreed/AppTest2/profile.json`，上次有效版本为 `profile.json.bak`。Android 默认位于应用私有目录 `files/profile/profile.json`，上次有效版本为 `profile.previous.json`；选择外置文件夹后，这两个文件改存到所选文件夹。数据与程序资源分离，替换 Windows 程序目录不会覆盖存档。

原生启动时加载文件，向现有同步存档调用提供内存视图。每次更新必须收到原生文件落盘确认后，才更新内存；安卓还会回读校验写入结果。钱包与驾驶员、个人档案导入等多键操作由一次原生提交完成。内部文件使用平台原子替换；外置目录保存上一份完整快照再写入新快照，不假定所有文档提供器支持原子重命名。写入失败不更新内存钱包。递增版本拒绝旧视图覆盖新存档，目录切换令牌还会拒绝切换前页面对新目录的迟到写入。

单个原生存档文件限制为64 MiB，避免异常数据导致失控内存占用；这不是浏览器 localStorage 配额。原有个人 JSON 导入文件仍受32 MiB校验。设置的“检查存储”会标明原生文件后端。

主文件损坏时尝试上次有效备份，保留损坏原件，并提示恢复。主文件与备份都无法读取时停止加载，不静默创建空档覆盖数据。外置目录被移走、文件被删除或授权失效时也不会回退到旧内部存档；错误页可以“重新选择存档文件夹”，重新授权原文件夹恢复。Windows 可在关闭程序后备份整个数据目录，再人工恢复有效文件。

导出使用系统保存文件对话框，Android 导入使用系统文档选择器。外置文件夹存档属于软件版完整键值快照，不能直接拿来当网页的个人 JSON 导入文件；跨网页迁移继续使用游戏设置中的“导出存档”。软件不自动读取浏览器个人目录。普通启动不开放调试端口。

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

安卓命令显式使用 Windows 用户目录（`USERPROFILE`）下的 `.android/debug.keystore`，其他系统回退到用户主目录，避免受限构建环境的 Java `user.home` 改变签名。需要保留该密钥；它不随源码或客户端包分发。V99 已核对与旧 V95 的签名一致。

两个命令默认先执行普通客户端构建，再构建共用软件资源。已准备好资源时可以加 `-- --prepared`。`npm run app:prepare` 仅准备资源。发行目录包含 SHA-256 文件清单；不包含测试存档、开发工具或服务端数据。

`public/client.html` 仍是普通网页的独立单文件。软件版由 `tools/build-app-client.cjs` 从它生成：提取去重图片和音频、外置脚本与目录数据，只在软件版加入原生桥接及内容策略，不维护另一份游戏逻辑。

## 验证命令

```text
npm run app:test:storage
npm run app:test:windows
npm run app:android -- --with-tests
```

Windows 检查启动实际 EXE，使用 `tmp/` 内的隔离数据目录。覆盖真实文件锁失败不扣钱、6 MiB存档与完整进程重启、驾驶员创建、机体和套件购买、原生导出和导入、连接原样服务端的独立测试端口及离线房间。测试-only 命令行参数 `--app-test-port`、`--app-test-data`、`--app-test-export` 仅由该检查显式启用，正常启动不启用。

Android 的 JVM 回归测试通过模拟目录读写验证迁移、重启、已有外置存档优先、权限丢失、部分写入、备份恢复和缺失文件保护；`--with-tests` 会执行这些测试并编译独立 instrumentation APK。后者用于实际 Android 文件 API 验证，设备连接后执行：

```text
adb install -r build/ProjectGreed-V100-android/ProjectGreed.apk
adb install -r apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am instrument -w io.projectgreed.apptest2.test/io.projectgreed.apptest2.StoreInstrumentation
```

设备检查使用专用测试子目录，不改个人 `files/profile` 存档。覆盖6 MiB、Unicode、重启、备份恢复、版本冲突、原子替换失败以及双损坏文件保护。

首轮验证边界：Windows 实际程序端到端检查通过；Android APK和设备测试APK编译通过、签名与清单已核对，但本机没有连接 Android 设备，因此不将窄屏键盘、安全区、前后台、系统文件选择器及完整联机战斗声明为真机通过。完整退出后的离线房间状态与原网页版一样，不自动持久化为可恢复战局；个人进度单独保存。
