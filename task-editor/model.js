const TaskTreeModel = (() => {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  function blank() {
    return {
      format: "projectgreed-contact-planning",
      version: 1,
      systemVersion: "1.0",
      notes: "",
      contacts: [{ id: "contact_1", name: "新联络人", text: "", tasks: [] }],
    };
  }
  function validate(doc, statuses) {
    const errors = [];
    if (
      !doc ||
      doc.format !== "projectgreed-contact-planning" ||
      doc.version !== 1 ||
      typeof doc.systemVersion !== "string" ||
      !doc.systemVersion.trim() ||
      typeof doc.notes !== "string" ||
      !Array.isArray(doc.contacts) ||
      !doc.contacts.length ||
      doc.contacts.length > 30
    )
      return ["请导入联络人委托策划JSON，并填写委托系统版本号。"];
    const ids = new Set(),
      names = new Set(),
      validId = (id) => typeof id === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(id);
    for (const c of doc.contacts) {
      if (
        !c ||
        !validId(c.id) ||
        names.has(c.id) ||
        typeof c.name !== "string" ||
        !c.name.trim() ||
        typeof c.text !== "string" ||
        !Array.isArray(c.tasks)
      ) {
        errors.push("联络人名称、编号或文本无效。");
        continue;
      }
      names.add(c.id);
      if (c.portrait !== undefined && (
        !c.portrait || typeof c.portrait !== "object" ||
        typeof c.portrait.id !== "string" || typeof c.portrait.source !== "string" ||
        typeof c.portrait.dataUrl !== "string" ||
        c.portrait.dataUrl.length > 1400000 ||
        !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(c.portrait.dataUrl)
      )) errors.push(c.id + "：头像须为内嵌PNG、JPEG或WebP图片（不超过1MB）。");
      if (c.tasks.length > 200) {
        errors.push("每个联络人最多200项委托。");
        continue;
      }
      for (const t of c.tasks) {
        if (!t || !validId(t.id) || ids.has(t.id)) {
          errors.push("委托编号无效或重复。");
          continue;
        }
        ids.add(t.id);
        if (
          typeof t.name !== "string" ||
          !t.name.trim() ||
          typeof t.text !== "string" ||
          !statuses.some((s) => s.id === t.status)
        )
          errors.push(t.id + "：名称、策划文本或改动标记无效。");
        if (
          !Array.isArray(t.requires) ||
          t.requires.some((id) => typeof id !== "string") ||
          new Set(t.requires).size !== t.requires.length
        )
          errors.push(t.id + "：前置委托格式无效。");
      }
      const map = new Map(
        c.tasks.filter((t) => t && typeof t.id === "string").map((t) => [t.id, t]),
      );
      for (const t of c.tasks.filter((t) => t && Array.isArray(t.requires))) {
        if (t.requires.some((id) => !map.has(id)))
          errors.push(t.id + "：前置委托不存在或属于其他联络人。");
        const visiting = new Set(),
          done = new Set();
        const walk = (id) => {
          if (visiting.has(id)) return true;
          if (done.has(id) || !map.has(id)) return false;
          visiting.add(id);
          const deps = map.get(id).requires,
            cycle = (Array.isArray(deps) ? deps : []).some(walk);
          visiting.delete(id);
          done.add(id);
          return cycle;
        };
        if (walk(t.id)) errors.push(t.id + "：前置关系存在循环。");
      }
    }
    return [...new Set(errors)];
  }
  function add(doc, c, parent) {
    if (c.tasks.length >= 200) throw Error("每个联络人最多200项委托。");
    let index = 1;
    while (doc.contacts.some((c) => c.tasks.some((t) => t.id === "task_" + index))) index++;
    const t = {
      id: "task_" + index,
      name: "新委托",
      status: "需要调整",
      text: "",
      requires: parent ? [parent] : [],
    };
    c.tasks.push(t);
    return t;
  }
  function descendants(c, id) {
    const set = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of c.tasks)
        if (t.requires.some((p) => set.has(p)) && !set.has(t.id)) {
          set.add(t.id);
          changed = true;
        }
    }
    return set;
  }
  function layout(c) {
    const positions = new Map(),
      depths = new Map(),
      levels = new Map();
    let rest = [...c.tasks];
    for (let pass = 0; rest.length && pass <= c.tasks.length; pass++) {
      const next = [];
      for (const t of rest) {
        if (t.requires.every((id) => depths.has(id))) {
          const d = t.requires.length ? Math.max(...t.requires.map((id) => depths.get(id))) + 1 : 0;
          depths.set(t.id, d);
          if (!levels.has(d)) levels.set(d, []);
          levels.get(d).push(t);
        } else next.push(t);
      }
      rest = next;
    }
    let width = 700,
      height = 500;
    for (const [depth, tasks] of levels) {
      tasks.forEach((t, i) => positions.set(t.id, { x: 40 + i * 260, y: 40 + depth * 180 }));
      width = Math.max(width, tasks.length * 260 + 80);
      height = Math.max(height, depth * 180 + 220);
    }
    return { positions, width, height };
  }
  function bundle(doc, statuses, contactId) {
    const output = clone(doc);
    if (contactId !== undefined) {
      output.contacts = output.contacts.filter((c) => c.id === contactId);
      if (!output.contacts.length) throw Error("联络人不存在。");
    }
    return {
      ...output,
      aiGuide: {
        purpose: "联络人委托策划文档；不是游戏运行配置，标记不是接取或完成进度。",
        versionField:
          "systemVersion由策划填写，表示本套委托策划的版本；不得把它当作游戏客户端版本或JSON格式版本。",
        statusMeanings: clone(statuses),
        instructions: [
          "先报告收到的委托系统版本号，再按每个委托的改动标记确定实现范围。不要擅自修改版本号或标记。",
          "无需调整：仅作为背景与前置参考，保持现有实现。",
          "需要调整：根据策划文本实现；新增委托默认使用此标记。",
          "有变动：结合版本号与已有实现核对变化，按最新策划文本同步。没有旧版资料时不得虚构历史差异。",
          "废弃：保留策划记录，处理停用与前置引用。不得未经授权删除玩家存档或回收已领取奖励。",
          "requires只表达策划的前置关系；具体解锁条件、奖励、事件、对话等以text和联络人text、全局notes为准。",
          "策划文本可自由描述目标、条件、初始装备、奖励、对话和特殊要求；缺失必要信息时先列出待确认项。",
          "本HTML不连接游戏、不修改源码、不读取存档、不验证实际任务能否运行。请在实现阶段自行核对现行程序规则。",
        ],
      },
    };
  }
  return { clone, blank, validate, add, descendants, layout, bundle };
})();
if (typeof module !== "undefined") module.exports = TaskTreeModel;
