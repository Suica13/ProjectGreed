# Android GeckoView 客户端

安卓版内置 Mozilla GeckoView `159.0.20261102144711` 稳定版，不依赖系统 Android System WebView、Chrome 或 Firefox 的安装与版本。最低 Android 8.0（API 26），需要设备支持 OpenGL ES 2.0。Windows 客户端和游戏服务端没有迁移引擎。

## 安装与存档

- 通用包：`ProjectGreed-V105.apk`，包含 ARM64 和 ARMv7，优先用于不确定设备架构时。
- 精简 ARM64 包：`ProjectGreed-V105-arm64.apk`。
- 精简 ARMv7 包：`ProjectGreed-V105-armv7.apk`，供 32 位 Android 使用。
- 产物放在 `build/V105/ProjectGreed-V105-android-gecko/`，不覆盖之前的系统 WebView 版发行目录。
- 显示版本为 V105，安装版本码为 105001，可覆盖之前的 V104 客户端。沿用应用 ID `io.projectgreed.apptest2` 和原签名，支持覆盖安装。不要卸载旧版后再安装，卸载会清除应用私有数据和外置目录授权。
- 存档格式、默认 `files/profile/profile.json`、备份 `profile.previous.json` 和已选择的 SAF 外置文件夹均沿用旧版。第一次主菜单文件夹提示和设置里的“选择存档文件夹”保留。
- 主菜单及非战斗界面保持竖屏，战斗场景可随传感器旋转。退到后台暂停音乐，返回时恢复原有重连检查。

## 原生通信

`MainActivity` 创建 GeckoRuntime、GeckoSession 和 GeckoView。`GeckoPrompts` 负责 HTML 下拉框、提示框和系统文件选择器。

`NativeAssetServer` 仅绑定 `127.0.0.1` 随机端口，每次启动生成 256 位随机路径令牌。静态游戏资源只从 APK 读取；原生调用要求该路径、精确 Host、额外令牌请求头和匹配的 Origin，不开放 CORS、不接受外部页面导航，也不对局域网监听。该服务不是游戏服务器。

`gecko-bridge.js` 在游戏脚本前注入原生接口。读取与提交使用同步本机 HTTP 请求，继续等待 `NativeStore` 完成原子写入及校验后才返回；失败不更新 JS 钱包或库存。revision 和存档目录 epoch 校验保留。生命周期与界面冻结通过单条 SSE 推送连接传递，没有逐帧轮询。

同步保存仍可能短暂占用页面线程；此改造用于消除系统 WebView 依赖，不宣称自动改善战斗帧率。应比较相同地图、单位数和镜头操作的实际表现。

## 构建与维护

需要 JDK 17/21、Gradle 9.3.1、Android SDK platform 37.0、build-tools 36.0.0；Android Gradle Plugin 固定 9.1.1。`apps/toolchain.local.json` 可配置独立工具目录，避免修改 Unity 的构建工具安装。

```text
npm run app:android -- --with-tests
```

测试截图、日志、桌面 Gecko 桥接验证和隔离存档都放在 `tmp/verification/`。发行目录不包含验证文件或测试 APK。原生 Java 单元测试和桌面 Firefox 集成测试不能替代 Android 真机上的 GPU、键盘、SAF 授权、声音与旋转验收。

升级 GeckoView 时修改 `apps/android/engine.json` 的固定版本（Gradle 依赖与发行清单共用），同时更新原生桥回归和随包许可，不把系统 WebView 检测重新加入启动流程。

## 开源许可

GeckoView 使用 Mozilla Public License 2.0，另有内核第三方组件许可。未修改 Gecko 引擎本身；引擎许可见 [Gecko 许可全文](../legal/gecko-licenses.html)，发行包也包含该文件。

- [GeckoView 官方文档](https://mozilla.github.io/geckoview/)
- [固定版本二进制与源码归档](https://maven.mozilla.org/maven2/org/mozilla/geckoview/geckoview/159.0.20261102144711/)
- [Mozilla Public License 2.0](https://www.mozilla.org/MPL/2.0/)
