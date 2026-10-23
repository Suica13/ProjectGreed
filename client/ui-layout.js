/* 开发者版与发布版共用的布局运行器。
 * targets 登记元素；validate 拒绝未知字段；apply 将安全参数转成 CSS。
 * $battle 是画布参数，不转成 CSS，由 BattleScene 读取。
 */
(() => {
  "use strict";
  const targets = [
    ["musicPlayer", "背景音乐播放器", "#musicPlayer"],
    ["header", "顶栏", "header"],
    ["brand", "标题标志", ".brand"],
    ["headerTitle", "主标题", "header h1"],
    ["headerButtons", "顶栏按钮组", ".header-buttons"],
    ["roster", "左侧机体面板", ".left"],
    ["center", "地图与战报区", "main.center"],
    ["command", "右侧指令面板", ".right"],
    ["phase", "回合提示栏", ".phase-row"],
    ["phaseTitle", "行动阶段标题", "#phaseTitle"],
    ["endTurn", "结束回合按钮", "#endTurn"],
    ["map", "战术地图", "#mapWrap"],
    ["legend", "地图图例", ".legend"],
    ["combatLog", "战斗记录面板", ".log"],
    ["logLines", "战报内容", "#log"],
    ["rosterRow", "机体列表项（全部）", ".roster-unit"],
    ["unitHead", "单位信息标题", ".unit-card-head"],
    ["stats", "单位属性区", ".stats"],
    ["actions", "单位动作按钮组", ".actions"],
    ["weapon", "武器按钮（全部）", ".weapon"],
    ["weaponName", "武器名称（全部）", ".weapon-name"],
    ["weaponMeta", "武器参数（全部）", ".weapon-meta"],
    ["target", "攻击目标按钮（全部）", ".target-button"],
    ["startModal", "连接／开始窗口", "#start>.modal"],
    ["serverModal", "服务器连接窗口", "#serverForm"],
    ["preparationModal", "房间准备窗口", "#roomPreparation>.modal"],
    ["leaveModal", "离开确认窗口", "#leaveConfirm>.modal"],
    ["formationModal", "编组窗口", "#formationScreen>.modal"],
    ["formationRow", "编组单位行", ".formation-row"],
    ["formationKit", "武器套件选单", ".formation-row select"],
    ["deploymentPanel", "部署面板", "#deploymentPanel"],
    ["roomList", "房间列表", "#lobby"],
    ["netForm", "连接表单", ".net-form"],
    ["netButtons", "连接按钮组", ".net-buttons"],
    ["startTitle", "开始窗口标题", "#startTitle"],
    ["reactionModal", "应战窗口", "#reaction>.modal"],
    ["engagement", "交战双方信息", "#engagement"],
    ["responses", "应战选项组", ".responses"],
    ["response", "应战选项（全部）", ".response"],
    ["counterList", "反击武器列表", "#counterList"],
    ["confirmResponse", "确认应战按钮", "#confirmResponse"],
    ["battleModal", "战斗演出窗口", "#battle>.modal"],
    ["battleStage", "战斗画面", ".battle-stage"],
    ["battleCaption", "战斗字幕", "#battleCaption"],
    ["battleInfo", "战斗状态栏", "#battleInfo"],
    ["continueBattle", "返回地图按钮", "#continueBattle"],
    ["helpModal", "说明窗口", "#help>.modal"],
    ["victoryModal", "胜利窗口", "#victory>.modal"],
  ].map(([id, name, selector]) => ({ id, name, selector }));
  // 保留已移除按钮的旧编号，使旧导出布局仍可读取；这些选择器不会匹配控件。
  for (const id of [11, 131, 132, 133, 136, 137])
    targets.push({
      id: "node-" + id,
      name: "已移除的旧入口",
      selector: `[data-ui-node="node-${id}"]`,
    });
  // 源模板中的每个静态元素都有稳定编号，新增元素时不要重新编号。
  const partNames = {
    img: "头像",
    strong: "名称",
    small: "说明",
    span: "文本",
    "> div": "信息项",
    ".unit-card-head img": "机体头像",
    ".unit-card-head strong": "机体名称",
    ".unit-card-head small": "机体型号",
    ".section-title": "分区标题",
    ".rule-box": "操作说明",
    ".helper": "提示",
    ".empty": "空状态提示",
    ".stats > div": "属性项",
    ".stats span": "属性名称",
    ".actions button": "动作按钮",
    ".weapon-list": "武器列表",
    ".weapon": "武器按钮",
    ".weapon-name": "武器名称",
    ".weapon-meta": "武器参数",
    ".weapon-title": "武器标题栏",
    ".type": "武器类型",
    ".target-button": "目标按钮",
    ".target-button span": "目标文字",
    ".fighter": "机体信息卡",
    ".fighter img": "机体头像",
    ".fighter small": "阵营说明",
    ".fighter strong": "机体名称",
    ".summary": "机体摘要",
    ".arrow": "交战箭头",
    ".hp-track": "血条底框",
    ".hp-fill": "血条填充",
    ".roster-unit": "单位列表项",
    ".roster-unit img": "列表头像",
    ".roster-unit strong": "列表名称",
    ".roster-unit small": "行动状态",
  };
  for (const element of document.querySelectorAll?.("[data-ui-node]") || []) {
    const id = element.dataset.uiNode;
    targets.push({
      id,
      name:
        targets.find((item) => element.matches(item.selector))?.name ||
        element.getAttribute("aria-label") ||
        element.textContent.trim().replace(/\s+/g, " ").slice(0, 24) ||
        element.id ||
        element.className ||
        element.tagName,
      selector: `[data-ui-node="${id}"]`,
    });
  }
  // 动态生成的列表不能依赖临时 DOM。提前登记可重建的选择器。
  const dynamicGroups = [
    [
      "#formationUnits",
      "编组单位",
      [
        ".formation-row img",
        ".formation-row span",
        ".formation-row select",
        ".formation-row button",
      ],
    ],
    [
      "#teamSlots",
      "队伍席位",
      [".team-slot", ".team-slot h3", ".team-slot strong", ".team-slot p"],
    ],
    ["#spectatorSlots", "观战席位", [".spectator-slot"]],
    [
      "#roomList",
      "房间列表",
      [
        ".room-card",
        ".room-card strong",
        ".room-card small",
        ".room-card button",
        ".room-card th",
        ".room-state",
        ".room-players",
        ".room-action",
      ],
    ],
    [
      "#unitPanel",
      "单位指令",
      [
        ".unit-card-head img",
        ".unit-card-head strong",
        ".unit-card-head small",
        ".section-title",
        ".rule-box",
        ".helper",
        ".empty",
        ".stats > div",
        ".stats span",
        ".actions button",
        ".weapon-list",
        ".weapon",
        ".weapon-name",
        ".weapon-meta",
        ".type",
        ".target-button",
        ".target-button span",
      ],
    ],
    [
      "#engagement",
      "应战双方",
      [".fighter", ".fighter img", ".fighter small", ".fighter strong", ".summary", ".arrow"],
    ],
    ["#counterList", "反击武器", [".weapon", ".weapon-name", ".weapon-meta", ".type"]],
    ["#battleInfo", "战斗状态", ["> div", "strong", "small", ".hp-track", ".hp-fill"]],
    [
      "#allies",
      "蓝方列表",
      [
        ".roster-unit",
        ".roster-unit img",
        ".roster-unit strong",
        ".roster-unit small",
        ".hp-track",
        ".hp-fill",
      ],
    ],
    [
      "#enemies",
      "红方列表",
      [
        ".roster-unit",
        ".roster-unit img",
        ".roster-unit strong",
        ".roster-unit small",
        ".hp-track",
        ".hp-fill",
      ],
    ],
  ];
  for (const [scope, label, selectors] of dynamicGroups) {
    selectors.forEach((selector, index) =>
      targets.push({
        id: `dynamic-${scope.slice(1)}-${index}`,
        name: `${label} / ${partNames[selector] || selector}（同类）`,
        selector: `${scope} ${selector}`,
      }),
    );
  }
  // 同类样式和独立行样式分开，独立样式排在后面以覆盖同类。
  for (const scope of [
    "allies",
    "enemies",
    "unitPanel .weapon-list",
    "counterList",
    "engagement",
    "battleInfo",
    "unitPanel .stats",
    "unitPanel .actions",
  ]) {
    const scopeName = {
      allies: "蓝方列表",
      enemies: "红方列表",
      "unitPanel .weapon-list": "指令武器",
      counterList: "反击武器",
      engagement: "应战双方",
      battleInfo: "战斗状态",
      "unitPanel .stats": "单位属性",
      "unitPanel .actions": "单位动作",
    }[scope];
    for (let index = 1; index <= 6; index++) {
      const selector = `#${scope} > :nth-child(${index})`;
      targets.push({
        id: `row-${scope.replace(/[^a-zA-Z]/g, "")}-${index}`,
        name: `${scopeName} / 第${index}项`,
        selector,
      });
      [
        "img",
        "strong",
        "small",
        ".weapon-name",
        ".weapon-meta",
        ".hp-track",
        ".hp-fill",
        ".summary",
        ".type",
        ".weapon-title",
        "span",
      ].forEach((child, part) =>
        targets.push({
          id: `row-${scope.replace(/[^a-zA-Z]/g, "")}-${index}-${part}`,
          name: `${scopeName} / 第${index}项 / ${partNames[child] || child}`,
          selector: `${selector} ${child}`,
        }),
      );
    }
  }
  const fields = {
    x: [-4096, 4096],
    y: [-4096, 4096],
    width: [1, 4096],
    height: [1, 4096],
    fontSize: [8, 96],
    padding: [0, 120],
    gap: [0, 120],
    opacity: [0, 1],
    borderRadius: [0, 200],
    borderWidth: [0, 20],
    zIndex: [0, 100],
    gridColumns: [1, 12],
  };
  const anchors = [
    "flow",
    "top-left",
    "top-right",
    "bottom-left",
    "bottom-right",
    "center",
    "parent-top-left",
    "parent-top-right",
    "parent-bottom-left",
    "parent-bottom-right",
    "parent-center",
  ];
  const battleFields = {
    leftX: [0, 1],
    leftY: [0, 1],
    rightX: [0, 1],
    rightY: [0, 1],
    scale: [0.1, 4],
    leftScale: [0.1, 4],
    rightScale: [0.1, 4],
    meleeTravel: [0, 0.5],
    shake: [0, 30],
    shadowScale: [0.1, 3],
    projectileScale: [0.1, 4],
    muzzleY: [-100, 100],
    impactScale: [0.1, 4],
    damageSize: [0.1, 4],
    damageX: [-1, 1],
    damageY: [-1, 1],
    mapScale: [0.1, 3],
    mapLabelSize: [0.3, 3],
    mapBarScale: [0.1, 2],
  };
  for (const id of Object.keys(typeof ART !== "undefined" ? ART.models : {}))
    battleFields[id] = [0.1, 4];
  const profiles = ["desktop", "tablet", "mobile"];
  function validate(raw) {
    if (
      !raw ||
      raw.version !== 1 ||
      !raw.profiles ||
      typeof raw.profiles !== "object" ||
      Array.isArray(raw.profiles)
    )
      throw Error("需要 version:1 和 profiles 的布局JSON");
    const out = {
      version: 1,
      profiles: { desktop: {}, tablet: {}, mobile: {} },
    };
    for (const profile of profiles) {
      const entries = raw.profiles[profile] || {};
      if (typeof entries !== "object" || Array.isArray(entries)) throw Error("布局分组格式错误");
      for (const [id, props] of Object.entries(entries)) {
        if (id === "$battle") {
          if (!props || typeof props !== "object" || Array.isArray(props))
            throw Error("演出参数格式错误");
          const safe = {};
          for (const [key, value] of Object.entries(props)) {
            const range = battleFields[key];
            if (
              !Object.hasOwn(battleFields, key) ||
              typeof value !== "number" ||
              !Number.isFinite(value) ||
              value < range[0] ||
              value > range[1]
            )
              throw Error("无效演出参数：" + key);
            safe[key] = value;
          }
          out.profiles[profile][id] = safe;
          continue;
        }
        if (!targets.some((t) => t.id === id)) throw Error("未知UI元素：" + id);
        if (!props || typeof props !== "object" || Array.isArray(props))
          throw Error("元素属性格式错误：" + id);
        const safe = {};
        for (const [key, value] of Object.entries(props)) {
          if (key === "anchor") {
            if (!anchors.includes(value)) throw Error("锚点无效");
            safe[key] = value;
          } else if (key === "hidden") {
            if (typeof value !== "boolean") throw Error("隐藏属性必须为布尔值");
            safe[key] = value;
          } else if (key === "color" || key === "background") {
            if (typeof value !== "string" || !/^#[\da-f]{6}$/i.test(value))
              throw Error("颜色需为#RRGGBB");
            safe[key] = value;
          } else if (Object.hasOwn(fields, key)) {
            const [min, max] = fields[key];
            if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
              throw Error(key + " 超出范围 " + min + "–" + max);
            safe[key] = value;
          } else throw Error("不支持的布局属性：" + key);
        }
        out.profiles[profile][id] = safe;
      }
    }
    return out;
  }
  const empty = () => ({
    version: 1,
    profiles: { desktop: {}, tablet: {}, mobile: {} },
  });
  let layout;
  try {
    layout = validate(JSON.parse(document.getElementById("ui-layout-data").textContent));
  } catch (e) {
    console.warn("布局未应用：", e.message);
    layout = empty();
  }
  const style = document.createElement("style");
  style.id = "ui-layout-style";
  document.head.append(style);
  function css(props) {
    let out = [];
    const a = (props.anchor || "flow").replace("parent-", ""),
      x = props.x || 0,
      y = props.y || 0;
    if (a === "flow") {
      if ("x" in props || "y" in props) out.push(`translate:${x}px ${y}px`);
    } else {
      out.push(
        props.anchor.startsWith("parent-") ? "position:absolute" : "position:fixed",
        "margin:0",
        "z-index:12",
        "max-width:none",
        "max-height:none",
        "translate:none",
        "right:auto",
        "bottom:auto",
        "left:auto",
        "top:auto",
      );
      if (a === "center")
        out.push("left:50%", "top:50%", `translate:calc(-50% + ${x}px) calc(-50% + ${y}px)`);
      else {
        out.push(
          a.endsWith("right") ? `right:${-x}px` : `left:${x}px`,
          a.startsWith("bottom") ? `bottom:${-y}px` : `top:${y}px`,
        );
      }
    }
    for (const key of [
      "width",
      "height",
      "fontSize",
      "padding",
      "gap",
      "borderRadius",
      "borderWidth",
    ])
      if (key in props) {
        out.push(`${key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}:${props[key]}px`);
        if (key === "width") out.push("max-width:none", "min-width:0");
        if (key === "height") out.push("min-height:0", "max-height:none", "overflow:auto");
      }
    if ("zIndex" in props) out.push(`z-index:${props.zIndex}`);
    if ("gridColumns" in props)
      out.push(
        `display:grid`,
        `grid-template-columns:repeat(${Math.round(props.gridColumns)},minmax(0,1fr))`,
      );
    if (props.hidden) out.push("visibility:hidden");
    for (const key of ["color", "background", "opacity"])
      if (key in props) out.push(`${key}:${props[key]}`);
    return out.map((s) => s + " !important").join(";");
  }
  function apply(raw) {
    layout = validate(raw);
    style.textContent = profiles
      .map((p, i) => {
        const query = [
          "(min-width:1101px)",
          "(min-width:601px) and (max-width:1100px)",
          "(max-width:600px)",
        ][i];
        return (
          `@media ${query}{` +
          Object.entries(layout.profiles[p])
            .filter(([id]) => id !== "$battle")
            .map(([id, props]) => {
              const selector = targets.find((t) => t.id === id).selector;
              const parent = props.anchor?.startsWith("parent-")
                ? `:where(*):has(> :is(${selector})){position:relative;}`
                : "";
              return `${parent}${selector}{${css(props)}}`;
            })
            .join("\n") +
          "}"
        );
      })
      .join("\n");
    window.dispatchEvent(new Event("ui-layout-change"));
  }
  const profile = () => (innerWidth > 1100 ? "desktop" : innerWidth > 600 ? "tablet" : "mobile");
  window.UILayout = {
    targets,
    fields,
    anchors,
    battleFields,
    empty,
    validate,
    apply,
    get: () => structuredClone(layout),
    profile,
    battle: () => structuredClone(layout.profiles[profile()].$battle || {}),
  };
  apply(layout);
})();
