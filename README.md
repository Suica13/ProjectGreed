# ProjectGreed V87

多人回合制战术游戏，支持遭遇战、小队自动交火和战略战役。服务端裁定动作，浏览器负责界面和演出。

- 安装依赖：`npm.cmd ci`
- 启动游戏服务端：`npm.cmd start`，默认端口1313，配置见cfg.json。
- 构建客户端：`npm.cmd run build`，输出public/client.html；也可独立打开客户端后连接服务器。
- 编辑服务端：`npm.cmd run developer`；管理员独立打开developer.html，手动输入地址和密钥。
- 服务端打包仅按需执行`npm.cmd run package:server`；默认构建不打包服务端、开发者版或br/gz。

[文档索引](docs/README.md) · [现行武器与技能](docs/rules/combat.md) · [运行及打包](docs/tools/server-package.md) · [源码导读](docs/guides/code-tour.md)

AP仅保留配置参考值，不参与战斗；当前战斗规则统一查询docs/rules/combat.md。人工配置例外和编辑审计继续保留。
