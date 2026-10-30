# Android 本地客户端测试版

使用系统 Android WebView，最低 Android 8.0（API 26）。跟随系统旋转设置，支持横竖屏，包含现有客户端素材，不需要本机服务器。触屏操作沿用原客户端。支持系统文件选择器导入存档、保存对话框导出存档（最多 16 MiB）。存档位于应用私有 WebView 数据目录；卸载/清除应用数据会删除存档，请先导出。

使用虚拟 HTTP 本地来源加载 APK 内唯一 client.html，所有同域其他资源请求返回 404，不会请求远程同名服务器。这样可以兼容现有 ws:// 局域网服务器；manifest 有明确的明文网络许可。页面外跳和子框架被禁止，导出桥仅允许弹出用户确认的文件保存界面，不授予任意文件路径写权限。没有提供 MOD 加载或自动更新功能。

## 构建

需要 JDK 17+、Android SDK platform 35 和 build-tools 35.0.0。设置 ANDROID_HOME。在仓库根目录执行：

```
npm ci
npm run build
python3 tools/package-android.py
```

生成 `dist/android/ProjectGreed-0.50.0-android-test2.apk`。脚本仅使用 javac、D8、aapt2、zipalign 和 apksigner，无 Gradle 依赖下载；会校验签名并打印 APK manifest 信息。安装包包含压缩的客户端 HTML 和 DEX，没有原生 ABI 库，可由系统 WebView 适配 ARM/ARM64/x86。

另提供 Android Studio/Gradle 项目；先将构建后的 public/client.html 复制到 android/app/src/main/assets/client.html，再执行 Gradle assembleDebug。

首次直接构建会生成 `dist/android/projectgreed-test.jks`，仅测试签名，密码 android。妥善保留这个文件，后续通过 PROJECTGREED_ANDROID_KEYSTORE 指定同一密钥，增加 versionCode 后才能持续覆盖升级。不要提交密钥到公开 Git。不同签名的 Gradle debug 包不能直接覆盖本包；不要以卸载作为默认升级方式，以免丢失存档。

本轮只完成编译、APK 内容和签名校验，没有 Android 真机/模拟器启动验证。需真机验证触屏布局、音频、导入导出、离线对局、联机和后台恢复。建议更新系统 Android System WebView。切到后台后系统可能暂停或回收应用，不能保证联机持续在线。
