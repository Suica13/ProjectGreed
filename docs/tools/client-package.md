# 独立HTML客户端

将发行包解压到同一目录。client.html可直接打开，包含完整游戏画面、音效和现用BGM；联机时输入同版本游戏服务器地址。地图编辑器为admin/map-editor.html，单位工坊为admin/unit-editor.html，联络人任务树编辑器为admin/task-tree-editor.html。

Windows、Android与HTML的个人存档可在设置中导入或导出；覆盖文件前先备份个人存档。单位工坊导出的RW_GW模板覆盖包依赖原MOD及0079 DLC，具体限制见工坊内提示。

从源码构建：先安装依赖，再运行 `npm.cmd run package:client`。生成文件位于build/当前版本/，不提交到Git。需要所有平台时执行 `npm.cmd run release:all`。
