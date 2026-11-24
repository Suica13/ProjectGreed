# CE0071T1 地球联合军地面部队池

驾驶员按合约全局规则独立抽取：N2～N4一般；N5一般约72.29%、老兵约22.17%、精英约5.54%；N6一般约56.60%、老兵约32.55%、精英约10.85%。初始部队、巡逻、驻军、事件增援、运输机及载员均适用；剧情指定等级优先，不随机生成ACE。

已接入CE_0071_T1地面合约，仅开放N2～N6。驻军和增援预算参考0079T1对应阵营上调约10%，取整至25；驾驶员等级按上方N级概率抽取。主力8、部分4、少数1、极少数0.25，编队预算与频率独立。所有AI候选套件过滤核弹。

联合军N2～N3大量常规兵器、部分长刃；N4～N6转向大量强袭短剑、决斗短剑及G系列。扎夫特N2～N3金恩、迪恩与常规兵器混编；N4～N6以巴库、高机动金恩为主，加入水陆两用MS、部分盖茨和少量高达。水陆两用单位使用地面适应达到100的佐诺和水中用型金恩，不强行投放地面适应不足的格恩。

单位使用稳定ID；中文名在图鉴及联络计划中查询。运输机使用本阵营垂直起降运输机，预算不足不拆分三机编队。


N3、N4、N5、N6的实际敌军预算分别在下表基础上乘1.10、1.15、1.15、1.15，最终按25取整；下表编队成本不变。N5起少数和极少数编队权重再乘1.15，主力、部分编队不变；老兵、精英相对一般驾驶员的权重再乘1.15。N5一般／老兵／精英约72.29%／22.17%／5.54%，N6约56.60%／32.55%／10.85%。奖励N3至N6分别在现行奖励上增加20%／30%／60%／90%，武装介入及活动倍率继续叠加。

单人普通合约N1～N6初始机动敌军（含普通事件驻军、不含设施及联络任务指定兵力）统一为9／12／18／24／30／36。保留三机小队，优先从人数最多的普通驻军调整，不清空歼灭事件目标，缺额由巡逻队补齐。多人沿用每多一人+25%，武装介入额外+25%，初始人数取最近的3的倍数。排除事件驻军、事件增援、联络任务单位与设施后，存活机动敌军上限为本局初始兵力的1.5倍向下取整，达到上限暂停巡逻刷新，损失后恢复。N4～N6后续普通巡逻和事件增援仍按累计75%保留完整编队；机体与驾驶员质量权重不变。

## 巡逻队

### N2

主力
LinearGunTankx3 75
VTOLFighterx3 75
F_7Dx3 100

部分
GAT_01Dx3 125
LinearArtilleryx1 LinearGunTankx2 100

### N3

主力
LinearGunTankx3 75
F_7Dx3 100

部分
GAT_01Dx3 125
LinearArtilleryx1 LinearGunTankx2 100
GAT_01D_ASx1 GAT_01Dx2 150

### N4

主力
GAT_01x3 125
GAT_01Dx3 125

部分
GAT_X102x1 GAT_01x2 200
GAT_X103x1 GAT_01x2 200
F_7Dx3 100
LinearArtilleryx1 LinearGunTankx2 100

少数
GAT_X105x1 GAT_01x2 225
GAT_X207x1 GAT_01x2 200

### N5

精锐编队权重倍率 1.15

主力
GAT_01x3 125
GAT_01D1x3 150
GAT_X102x1 GAT_01x2 200
GAT_X103x1 GAT_01x2 200

部分
GAT_X105x1 GAT_01x2 225
GAT_X207x1 GAT_01x2 200
FX_550x3 150
LinearArtilleryx1 LinearGunTankx2 100

少数
GAT_X303x1 GAT_01D1x2 250

### N6

精锐编队权重倍率 1.15

主力
GAT_01x3 125
GAT_01D1_ASx1 GAT_01D1x2 175
GAT_X105x1 GAT_01x2 225
GAT_X103x1 GAT_01x2 200
GAT_X102x1 GAT_01x2 200

部分
GAT_X207x1 GAT_01x2 200
GAT_X303x1 GAT_01D1x2 250
FX_550x3 150

少数
GAT_X105x1 GAT_X102x1 GAT_X103x1 350

## 驻军

### N2

salvage
合计175

command
合计300

factory
合计200

capture
合计175

upload
合计200

radar
合计175

### N3

salvage
合计225

command
合计450

factory
合计250

capture
合计225

upload
合计250

radar
合计225

### N4

salvage
合计325

command
合计625

factory
合计350

capture
合计325

upload
合计350

radar
合计325

### N5

salvage
合计425

command
合计850

factory
合计500

capture
合计425

upload
合计500

radar
合计425

### N6

salvage
合计575

command
合计1150

factory
合计650

capture
合计575

upload
合计650

radar
合计575

## 特殊事件

### N2

salvage
回收完成后的追击运输部队:
VTOLTransportx1 100

factory
首次增援:
合计100

capture
事件空降波:
合计225

capture
周期性边缘追击波:
合计100

defend
首次增援:
合计350

defend
后续攻击波:
合计100

upload
事件空降波:
合计225

radar
首次增援:
合计350

### N3

salvage
回收完成后的追击运输部队:
VTOLTransportx2 100/100

factory
首次增援:
合计100

capture
事件空降波:
合计300

capture
周期性边缘追击波:
合计100

defend
首次增援:
合计500

defend
后续攻击波:
合计100

upload
事件空降波:
合计300

radar
首次增援:
合计500

### N4

salvage
回收完成后的追击运输部队:
VTOLTransportx1 175

factory
首次增援:
合计175

capture
事件空降波:
合计375

capture
周期性边缘追击波:
合计175

defend
首次增援:
合计725

defend
后续攻击波:
合计175

upload
事件空降波:
合计375

radar
首次增援:
合计725

### N5

salvage
回收完成后的追击运输部队:
VTOLTransportx2 175/175

factory
首次增援:
合计225

capture
事件空降波:
合计550

capture
周期性边缘追击波:
合计225

defend
首次增援:
合计975

defend
后续攻击波:
合计225

upload
事件空降波:
合计550

radar
首次增援:
合计975

### N6

salvage
回收完成后的追击运输部队:
VTOLTransportx2 200/200

factory
首次增援:
合计325

capture
事件空降波:
合计750

capture
周期性边缘追击波:
合计325

defend
首次增援:
合计1250

defend
后续攻击波:
合计325

upload
事件空降波:
合计750

radar
首次增援:
合计1250
