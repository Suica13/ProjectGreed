/* Authoring metadata only; IDs match the authoritative runtime schemas. */
const field = (key, label, type = "text", value = "", hint = "") => ({
  key,
  label,
  type,
  value,
  hint,
});
const actors = () =>
  field(
    "actors",
    "脚本单位ID列表",
    "list",
    [],
    "以逗号分隔；引用地图中已配置的脚本单位，不是机体型号ID。",
  );
const actor = () => field("actor", "脚本单位ID");
const group = () => field("group", "单位组ID");
const round = () => field("round", "回合", "number", 3);
const entries = [];
function add(category, type, name, description, fields = []) {
  entries.push({ id: category + "." + type, category, type, name, description, fields });
}
add(
  "plan",
  "task",
  "任务 / 阶段",
  "设计节点，可描述联络委托或关卡阶段；连线代表前置依赖，不会自动生成游戏逻辑。",
  [
    field("objective", "任务目标"),
    field("money", "资金奖励", "number", 0),
    field("supplies", "物资奖励", "number", 0),
    field("technology", "科技点奖励", "number", 0),
    field("inventory", "单位奖励", "json", {}, "机体ID对应数量；解锁科技按现行规则视为部署许可。"),
  ],
);
add(
  "plan",
  "branch",
  "剧情分支",
  "设计节点；给子节点的连线填写选项文字。运行时需要choice动作与choice_selected条件。",
);
add("condition", "start", "战斗开始", "只在任务开始时满足。");
add("condition", "round", "到达指定回合", "任务回合达到或超过指定值时满足。", [round()]);
add("condition", "defeated_group", "限时击坠指定组", "在截止回合内击坠指定组至少若干台。", [
  group(),
  field("count", "击坠数量", "number", 6),
  field("byRound", "截止回合", "number", 10),
]);
add("condition", "actor_hp", "单位耐久低于比例", "指定脚本单位耐久比例达到阈值时满足。", [
  actor(),
  field("percent", "耐久百分比阈值", "number", 50),
]);
add("condition", "enter_region", "单位进入区域", "指定脚本单位进入矩形区域。坐标从0开始。", [
  actor(),
  ...["x", "y", "width", "height"].map((k) =>
    field(
      k,
      { x: "区域X", y: "区域Y", width: "区域宽", height: "区域高" }[k],
      "number",
      k === "width" || k === "height" ? 3 : 0,
    ),
  ),
]);
add("condition", "actor_destroyed", "指定单位被击毁", "单位已登场并被击毁。", [actor()]);
add(
  "condition",
  "group_destroyed",
  "指定单位组全灭",
  "指定组已登场的单位全部被击毁；应检查尚未登场增援的设计。",
  [group()],
);
add("condition", "group_escaped", "指定组有单位撤离", "指定组至少有一台通过脚本撤退离场。", [
  group(),
]);
add("condition", "group_alive", "指定组存活数量", "指定组存活单位达到数量。", [
  group(),
  field("count", "存活数量", "number", 1),
]);
add("condition", "event_completed", "前置事件完成", "引用的剧本事件已经执行完毕。", [
  field("event", "前置事件ID"),
]);
add("condition", "choice_selected", "选择剧情选项", "引用choice动作所属事件ID及其选项ID。", [
  field("event", "选项所在事件ID"),
  field("option", "选项ID"),
]);
add("condition", "all_enemies_destroyed", "全部敌人被击毁", "当前场景无存活且未撤离的敌人。");
for (const [type, name] of [
  ["all", "全部条件满足"],
  ["any", "任一条件满足"],
])
  add("condition", type, name, "组合条件，最多8项，最多两层嵌套。", [
    field("conditions", "子条件", "json", [{ type: "round", round: 3 }]),
  ]);
add(
  "action",
  "spawn",
  "生成增援",
  "让actors中initial=false的脚本单位登场；搭载关系、位置、武器套件在单位配置中指定。",
  [actors()],
);
add(
  "action",
  "dialogue",
  "对话演出",
  "逐条播放角色头像、名称、文本及可选声音，并聚焦actor所在位置。",
  [
    field("lines", "对话列表", "dialogue", [
      { actor: "", name: "通信员", text: "任务开始。", portrait: "", sound: "" },
    ]),
  ],
);
add(
  "action",
  "choice",
  "剧情选项",
  "暂停任务等待房主选择；分支事件用choice_selected监听。支持2至4个选项。",
  [
    field("name", "选项标题"),
    field("text", "说明"),
    field("options", "选项", "json", [
      { id: "accept", text: "接受" },
      { id: "refuse", text: "拒绝" },
    ]),
  ],
);
add("action", "protect", "追加保护目标", "指定单位被击毁将导致任务失败。", [actors()]);
add("action", "unprotect", "解除保护目标", "取消指定单位的保护要求。", [actors()]);
add("action", "recover", "恢复耐久与EN", "只对存活单位按最大值百分比恢复，不复活已击毁单位。", [
  actors(),
  field("hpPercent", "耐久恢复百分比", "number", 50),
  field("enPercent", "EN恢复百分比", "number", 50),
]);
add("action", "withdraw", "敌军撤退", "指定敌军尝试移动至地图右边缘，抵达后下一回合离场。", [
  actors(),
  field("edge", "撤退边缘", "text", "right"),
]);
add("action", "extend_time", "延长撤离期限", "仅适用于extract胜利条件；增加可用回合数。", [
  field("rounds", "延长回合", "number", 20),
]);
add("action", "open_extraction", "开启撤离", "仅适用于extract胜利条件；开放剧本配置的撤离区域。");
add(
  "action",
  "scripted_attack",
  "剧情攻击并击毁目标",
  "指定已登场的攻击者播放武器演出，直接击毁列出的敌军单位。",
  [actor(), actors()],
);
add("action", "message", "任务消息", "显示任务提示并写入记录。", [field("text", "消息文本")]);
add("action", "victory", "任务胜利", "请求结束任务并按胜利结算。");
add("action", "defeat", "任务失败", "请求结束任务并按失败结算。");
add("victory", "all_enemies", "消灭所有敌人", "消灭剧本要求的敌军；编写增援时需避免提前触发。");
add("victory", "survive", "坚持指定回合", "到达指定回合并满足保护要求。", [round()]);
add("victory", "defeat_actor", "击毁指定目标", "击毁指定脚本单位。", [actor()]);
add("victory", "eliminate_group", "全灭目标组", "消灭指定敌军组。", [
  group(),
  field("label", "目标名称"),
]);
add("victory", "defend_group", "守住友军组", "坚持到指定回合，并保留该友军组的存活单位。", [
  group(),
  round(),
]);
add("victory", "escort", "护送并守候", "保护目标沿路线到达区域并存活若干回合。", [
  actor(),
  field("holdRounds", "守候回合", "number", 2),
  field("region", "目标区域（导入时拆为x/y/width/height）", "json", {
    x: 0,
    y: 0,
    width: 3,
    height: 3,
  }),
  field("route", "路线坐标", "json", [{ x: 0, y: 0 }]),
]);
add(
  "victory",
  "extract",
  "限时撤离",
  "摧毁目标组后开启撤离；完整关卡还需配置撤离区域和保护对象。",
  [
    group(),
    field("deadlineRound", "截止回合", "number", 30),
    field("region", "撤离区域", "json", { x: 0, y: 0, width: 3, height: 3 }),
  ],
);
add("victory", "scripted", "分支剧本", "根据choice事件选择和平或继续战斗结局。", [
  group(),
  field("choiceEvent", "分支事件ID"),
  field("continueOption", "继续战斗选项ID"),
]);
for (const k of require("../shared/contract-mode.js").kinds)
  add("contract", k.type, k.name, k.hint, [
    field("difficulty", "最低难度N", "number", 1),
    field("environment", "环境", "text", "ground"),
    field("enemyFaction", "敌军阵营", "text", "ZEON"),
    field("details", "驻军、增援、区域与额外要求"),
  ]);
add(
  "contact",
  "kills",
  "联络任务：累计击坠",
  "在符合模式、难度、阵营等限制的合约中累计击坠；结算后记录进度。",
  [
    field("required", "目标数量", "number", 6),
    field("difficulty", "最低难度N", "number", 1),
    field("enemyFaction", "敌军阵营", "text", "ZEON"),
    field("unitType", "单位类型", "text", "MS"),
  ],
);
module.exports = entries;
