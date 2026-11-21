# 武器类型图标

图标来自 `GundamWars_BattleOperation2_V5/Resource/Image/Units/Button/Weapon`，原 MOD 只读。
运行 `node tools/import-weapon-icons.cjs [源目录]` 可重新提取；映射及来源保存在
`assets/ui/weapon-icons.json`，29 类武器均有图标。无完全对应图标的类型使用最接近的原素材。

资源加载器将 PNG 内嵌到客户端，离线 HTML 不依赖原 MOD 路径。
`WeaponInfo.summary` 统一生成类型图标，右侧显示名称、属性与 EN，下方显示伤害公式、命中率和攻击轮数。
查看图鉴入口位于使用单位按钮上方。
头部火神炮使用 Ciws_1，光束枪使用 BeamGun_1；腕部武器使用 ArmGun_2，
按磁轨炮实际炮口／弹丸特效识别的武器使用 Railgun_1，INCOM 使用 Incom_1。
这些图标变体只影响显示，不改变武器的伤害分类与结算规则。
实弹狙击步枪使用 ShellSniperRifle_1，实弹霰弹枪使用 ShellShotGun_1；实弹霰弹火箭筒（扩散火箭筒）使用 ShellShotGun_2。
实弹狙击优先使用狙击图标，不因共用 RailShell 弹丸贴图而显示为磁轨炮。
公式按编译后的攻击分项合并为次数乘单发伤害；混合伤害保留加号，攻击轮数单独显示。

霰弹分类根据原 MOD 实际伤害弹丸 `Projectile_BeamShotGun*`／`Projectile_ShellShotGun*` 识别，
不依赖武器名包含 Shotgun。E2／FD 光束喷枪及腕部、盾牌 BSG 因此归入光束霰弹枪；
扩散火箭筒的母弹与子弹机制保留火箭筒分类，普通光束喷枪也不受影响。
`python tools/repair-shotgun-types.py` 只核对，追加 `--apply` 定向修正共用定义及相关单位覆盖，
同时更新中英日名称和自动生成的套件名称，不重导伤害、发数、EN或素材。
