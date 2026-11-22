/* Pure design-document operations, shared by standalone UI and Node checks. */
const TaskTreeModel = (() => {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  function blank() {
    return {
      format: "projectgreed-task-tree",
      version: 1,
      project: {
        name: "新任务",
        era: "UC_0079_T1",
        environment: "ground",
        costLimit: 2000,
        fleetLimit: 2,
        briefing: "",
      },
      nodes: [],
    };
  }
  function validate(doc, catalog) {
    const errors = [];
    if (
      !doc ||
      doc.format !== "projectgreed-task-tree" ||
      doc.version !== 1 ||
      !doc.project ||
      !Array.isArray(doc.nodes)
    )
      return ["不是受支持的任务树设计JSON。"];
    if (doc.nodes.length > 500) return ["节点最多500个。"];
    if (typeof doc.project.name !== "string" || !doc.project.name.trim())
      errors.push("请填写任务名称。");
    if (
      !Number.isInteger(doc.project.costLimit) ||
      doc.project.costLimit < 500 ||
      doc.project.costLimit > 1e6
    )
      errors.push("编组COST应为500至1000000的整数。");
    if (
      !Number.isInteger(doc.project.fleetLimit) ||
      doc.project.fleetLimit < 1 ||
      doc.project.fleetLimit > 6
    )
      errors.push("舰船上限应为1至6。");
    if (!["ground", "space"].includes(doc.project.environment)) errors.push("作战环境无效。");
    const ids = new Set(),
      types = new Set(catalog.map((t) => t.id));
    for (const n of doc.nodes) {
      if (!n || typeof n.id !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(n.id)) {
        errors.push("节点ID格式无效。");
        continue;
      }
      if (ids.has(n.id)) errors.push("节点ID重复：" + n.id);
      ids.add(n.id);
      if (!types.has(n.kind)) errors.push("未知事件类型：" + n.kind);
      if (typeof n.title !== "string" || !n.title.trim()) errors.push(n.id + "：缺少节点名称。");
      if (
        typeof n.description !== "string" ||
        typeof n.edgeLabel !== "string" ||
        !n.parameters ||
        typeof n.parameters !== "object" ||
        Array.isArray(n.parameters)
      )
        errors.push(n.id + "：节点字段无效。");
      const type = catalog.find((t) => t.id === n.kind);
      for (const field of type?.fields || []) {
        const value = n.parameters?.[field.key];
        if (value === undefined) continue;
        if (field.type === "number" && (!Number.isFinite(value) || typeof value !== "number"))
          errors.push(n.id + "：" + field.label + "需要数字。");
        if (
          field.type === "list" &&
          (!Array.isArray(value) || value.some((v) => typeof v !== "string"))
        )
          errors.push(n.id + "：" + field.label + "需要文本列表。");
        if (
          field.type === "dialogue" &&
          (!Array.isArray(value) ||
            value.length > 50 ||
            value.some(
              (v) =>
                !v ||
                typeof v !== "object" ||
                ["actor", "name", "text", "portrait", "sound"].some(
                  (k) => v[k] !== undefined && typeof v[k] !== "string",
                ),
            ))
        )
          errors.push(n.id + "：对话列表无效。");
        if (field.type === "text" && typeof value !== "string")
          errors.push(n.id + "：" + field.label + "需要文本。");
        if (field.type === "json" && (value === null || typeof value !== "object"))
          errors.push(n.id + "：" + field.label + "需要JSON对象或列表。");
      }
    }
    const byId = new Map(doc.nodes.filter(Boolean).map((n) => [n.id, n]));
    for (const n of doc.nodes.filter(Boolean)) {
      if (n.parent !== null && !byId.has(n.parent)) errors.push(n.id + "：前置节点不存在。");
      const seen = new Set([n.id]);
      let p = n.parent;
      while (byId.has(p)) {
        if (seen.has(p)) {
          errors.push(n.id + "：连线存在循环。");
          break;
        }
        seen.add(p);
        p = byId.get(p).parent;
      }
    }
    return [...new Set(errors)];
  }
  function add(doc, type, parent = null) {
    if (doc.nodes.length >= 500) throw Error("节点最多500个。");
    let n = 1;
    while (doc.nodes.some((v) => v.id === "node_" + n)) n++;
    const node = {
      id: "node_" + n,
      parent,
      edgeLabel: "完成后",
      kind: type.id,
      title: type.name,
      description: "",
      parameters: Object.fromEntries(type.fields.map((f) => [f.key, clone(f.value)])),
    };
    doc.nodes.push(node);
    return node;
  }
  function descendants(doc, id) {
    const found = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of doc.nodes)
        if (found.has(n.parent) && !found.has(n.id)) {
          found.add(n.id);
          changed = true;
        }
    }
    return found;
  }
  function layout(doc) {
    const positions = new Map(),
      children = new Map([[null, []]]);
    for (const n of doc.nodes) {
      if (!children.has(n.parent)) children.set(n.parent, []);
      children.get(n.parent).push(n);
    }
    // Iterative postorder keeps long imported chains within browser stack limits.
    let leaf = 0,
      maxDepth = 0;
    const stack = (children.get(null) || [])
      .slice()
      .reverse()
      .map((n) => ({ n, depth: 0, done: false }));
    while (stack.length) {
      const { n, depth, done } = stack.pop(),
        kids = children.get(n.id) || [];
      maxDepth = Math.max(maxDepth, depth);
      if (!done && kids.length) {
        stack.push({ n, depth, done: true });
        for (const kid of kids.slice().reverse())
          stack.push({ n: kid, depth: depth + 1, done: false });
      } else {
        const x = kids.length
          ? (positions.get(kids[0].id).x + positions.get(kids.at(-1).id).x) / 2
          : 40 + leaf++ * 260;
        positions.set(n.id, { x, y: 40 + depth * 180 });
      }
    }
    return {
      positions,
      width: Math.max(700, leaf * 260 + 80),
      height: Math.max(500, maxDepth * 180 + 230),
    };
  }
  function fromMap(map, catalog) {
    const mission = map?.mission;
    if (!mission || !Array.isArray(mission.events)) throw Error("该地图不含任务脚本。");
    const doc = blank();
    Object.assign(doc.project, {
      name: map.name || map.id || "导入剧本",
      era: mission.era,
      environment: map.environment || "ground",
      costLimit: mission.costLimit,
      fleetLimit: mission.fleetLimit || 2,
    });
    doc.sourceMap = clone(map);
    const root = add(
      doc,
      catalog.find((t) => t.id === "plan.task"),
    );
    root.title = doc.project.name;
    root.description = map.description || "";
    const victory = catalog.find((t) => t.id === "victory." + mission.victory?.type);
    if (victory) {
      const v = add(doc, victory, root.id);
      v.parameters = clone(mission.victory);
      delete v.parameters.type;
    }
    const eventNodes = new Map();
    for (const event of mission.events) {
      const e = add(
        doc,
        catalog.find((t) => t.id === "plan.task"),
        root.id,
      );
      e.title = event.name;
      e.parameters = { runtimeEventId: event.id };
      e.description = "原生剧本事件；条件与动作见子节点，动作按原列表顺序执行。";
      eventNodes.set(event.id, e);
      for (const [category, values] of [
        ["condition", [event.when]],
        ["action", event.actions],
      ])
        for (const [index, value] of values.entries()) {
          const type = catalog.find((t) => t.id === category + "." + value.type);
          if (!type) throw Error("尚未支持的原生事件类型：" + value.type);
          const child = add(doc, type, e.id);
          child.edgeLabel = category === "condition" ? "触发条件" : "动作 " + (index + 1);
          child.parameters = clone(value);
          delete child.parameters.type;
        }
    }
    for (const event of mission.events) {
      const condition = event.when,
        e = eventNodes.get(event.id);
      if (
        ["event_completed", "choice_selected"].includes(condition.type) &&
        eventNodes.has(condition.event)
      ) {
        e.parent = eventNodes.get(condition.event).id;
        e.edgeLabel =
          condition.type === "choice_selected" ? "选项：" + condition.option : "前置事件完成";
      } else e.edgeLabel = "独立触发";
    }
    return doc;
  }
  function bundle(doc, catalog, version) {
    return {
      ...clone(doc),
      reference: {
        gameVersion: version,
        createdAt: new Date().toISOString(),
        purpose: "AI任务制作设计稿，不可直接当作可运行地图导入游戏。",
        categories: {
          plan: "设计阶段，需AI映射为实际任务配置",
          condition: "shared/mission-mode.js中的触发条件when",
          action: "shared/mission-mode.js中的动作actions，按列表顺序执行",
          victory: "shared/mission-mode.js中的mission.victory",
          contract: "shared/contract-mode.js中的合约目标类型",
          contact: "shared/contact-tasks.js中的联络委托要求",
        },
        instructions: [
          "以project与nodes为设计要求，parent/edgeLabel表示前置关系与分支文字；不要将树的父子关系直接当成运行时事件依赖。",
          "先列明仍需确认的地图坐标、单位ID、套件、部队构成、对话角色与奖励；不凭空发明不存在的事件类型。",
          "剧本需生成完整地图与mission结构，配置actors、events、protect、victory，并通过MissionMode.validate；条件使用when，动作使用actions。",
          "需要等待前一事件完成时使用event_completed；选项分支用choice与choice_selected；all/any支持多前置条件。",
          "spawn、dialogue、protect等引用脚本单位ID，unitId与kitId必须来自机体目录；先配置actors再生成增援。",
          "合约目标与联络任务是两套不同系统，不要将contract节点当作剧本动作。连线顺序不是现有合约模式的强制顺序。",
          "当前解锁科技指直接获取部署许可；奖励满仓进入保管库。收入、损失与奖励沿用游戏现行结算机制。",
          "sourceMap若存在仅作为原始参考；树的编辑不会自动修改sourceMap。请按节点意图生成并校验新地图，勿直接使用旧副本宣称已更新。",
        ],
        availableTypes: clone(catalog),
      },
    };
  }
  return { blank, validate, add, descendants, layout, fromMap, bundle, clone };
})();
if (typeof module !== "undefined") module.exports = TaskTreeModel;
