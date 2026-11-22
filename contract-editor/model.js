/* Planning documents only; never interpreted as executable game scripts. */
const ContractEventModel = (() => {
  const format = "projectgreed-contract-event-planning";
  const statuses = ["无需调整", "需要调整", "有变动", "废弃"];
  const fields = [
    ["summary", "事件说明"],
    ["conditions", "适用条件"],
    ["trigger", "发现与触发"],
    ["completion", "完成条件"],
    ["failure", "失败／暂停条件"],
    ["forces", "目标与驻守兵力"],
    ["reinforcements", "巡逻与增援"],
    ["multiplayer", "多人判定"],
    ["presentation", "地图标记与演出"],
    ["rewards", "奖励与撤离"],
    ["notes", "策划补充与改动要求"],
    ["source", "实现参考"],
  ];
  const clone = (value) => JSON.parse(JSON.stringify(value));
  function validate(doc) {
    const errors = [];
    if (
      !doc ||
      doc.format !== format ||
      doc.version !== 1 ||
      typeof doc.systemVersion !== "string" ||
      !doc.systemVersion.trim() ||
      doc.systemVersion.length > 100 ||
      typeof doc.sourceVersion !== "string" ||
      doc.sourceVersion.length > 100 ||
      typeof doc.notes !== "string" ||
      doc.notes.length > 50000 ||
      typeof doc.commonRules !== "string" ||
      doc.commonRules.length > 50000 ||
      !Array.isArray(doc.events) ||
      doc.events.length > 200
    )
      return ["请导入合约事件策划JSON（格式版本1），并填写事件系统版本号。"];
    const ids = new Set();
    for (const e of doc.events) {
      if (
        !e ||
        typeof e.id !== "string" ||
        !/^[a-z][a-z0-9_-]{0,79}$/.test(e.id) ||
        ids.has(e.id)
      ) {
        errors.push("事件编号必须以小写字母开头，只含字母、数字、下划线或连字符，且不可重复。");
        continue;
      }
      ids.add(e.id);
      if (
        typeof e.name !== "string" ||
        !e.name.trim() ||
        e.name.length > 200 ||
        typeof e.type !== "string" ||
        !/^[a-z][a-z0-9_-]{0,79}$/.test(e.type) ||
        !["基础事件", "联络委托变体", "新增方案"].includes(e.group) ||
        !statuses.includes(e.status) ||
        fields.some(([key]) => typeof e[key] !== "string" || e[key].length > 50000)
      )
        errors.push(e.id + "：名称、类型、分类、改动标记或策划文本无效。");
    }
    return errors;
  }
  function parse(text) {
    if (typeof text !== "string" || text.length > 5 * 1024 * 1024) throw Error("文件不得超过5MB。");
    let doc;
    try {
      doc = JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch {
      throw Error("无法解析JSON，请检查文件内容。");
    }
    const errors = validate(doc);
    if (errors.length) throw Error(errors.join("\n"));
    return clone(doc);
  }
  function create(catalog, sourceVersion) {
    return {
      format,
      version: 1,
      systemVersion: "1.0",
      sourceVersion,
      notes:
        "策划标记用于告知AI哪些事件需要实现或调整，不是游戏中的事件进度状态。导入本工具不会修改游戏。",
      commonRules: catalog.commonRules,
      events: clone(catalog.events),
    };
  }
  function add(doc, template = null) {
    if (doc.events.length >= 200) throw Error("最多200项事件。");
    let n = 1;
    while (doc.events.some((e) => e.id === "event_" + n)) n++;
    const e = template ? clone(template) : Object.fromEntries(fields.map(([key]) => [key, ""]));
    Object.assign(e, {
      id: "event_" + n,
      name: template ? template.name + "（副本）" : "新事件",
      type: template?.type || "custom",
      group: "新增方案",
      status: "需要调整",
    });
    doc.events.push(e);
    return e;
  }
  function markdown(doc) {
    const lines = [
      "# 合约模式事件策划",
      "",
      "事件系统版本：" + doc.systemVersion,
      "参考游戏版本：" + doc.sourceVersion,
      "",
      doc.notes,
      "",
      "## 共用规则",
      "",
      doc.commonRules,
    ];
    for (const e of doc.events) {
      lines.push(
        "",
        "## " + e.name,
        "",
        `编号：${e.id} · 类型：${e.type} · 分类：${e.group} · 改动标记：${e.status}`,
      );
      for (const [key, title] of fields) lines.push("", "### " + title, "", e[key] || "（未填写）");
    }
    return lines.join("\n") + "\n";
  }
  return { format, statuses, fields, clone, validate, parse, create, add, markdown };
})();
if (typeof module !== "undefined") module.exports = ContractEventModel;
