/* Small form-based trigger editor; shares the runtime schema, no executable JS. */
window.MissionEditor = (() => {
  const panel = document.getElementById("missionEditorFields");
  let eventId = null;
  let selectedActorId = null;
  function references(value, id) {
    if (!value || typeof value !== "object") return false;
    return Object.entries(value).some(([key, item]) =>
      key === "actor" ? item === id : key === "actors" || key === "protect"
        ? Array.isArray(item) && item.includes(id) : references(item, id));
  }
  function renameActor(id, next) {
    next = next.trim();
    const mission = MapEditor.document.mission;
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(next)) throw Error("脚本单位 ID 须以小写字母开头，限64位小写字母、数字、下划线或连字符。");
    if (mission.actors.some(a => a.id === next && a.id !== id)) throw Error("脚本单位 ID 已存在。");
    if (!mission.actors.some(a => a.id === id)) throw Error("脚本单位不存在。");
    const replace = value => {
      if (!value || typeof value !== "object") return;
      for (const [key, item] of Object.entries(value)) {
        if (key === "actor" && item === id) value[key] = next;
        else if (["actors", "protect"].includes(key) && Array.isArray(item) && item.every(v => typeof v === "string"))
          value[key] = item.map(v => v === id ? next : v);
        else replace(item);
      }
    };
    selectedActorId = next;
    change(m => {
      m.actors.find(a => a.id === id).id = next;
      replace(m);
    });
  }
  function focusActor(id) {
    if (!MapEditor.document.mission?.actors.some(a => a.id === id)) return;
    selectedActorId = id;
    MapEditor.tab("mission");
    refresh();
    const card = [...panel.querySelectorAll("[data-actor-id]")].find(e => e.dataset.actorId === id);
    if (!card) return;
    for (let p = card; p && p !== panel; p = p.parentElement) if (p.tagName === "DETAILS") p.open = true;
    const scroll = panel.closest(".sidebar-scroll");
    scroll.scrollTop += card.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 8;
    MapEditor.draw();
  }
  const node = (tag, text) => {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const change = (fn) => MapEditor.editMission((d) => fn(d.mission, d));
  const button = (label, fn) => {
    const b = node("button", label);
    b.type = "button";
    b.onclick = fn;
    return b;
  };
  function input(parent, label, value, fn, type = "text") {
    const wrap = node("label", label),
      e = node("input");
    e.type = type;
    e.setAttribute("aria-label", label);
    if (type === "checkbox") e.checked = !!value;
    else e.value = value ?? "";
    e.onchange = () =>
      fn(type === "checkbox" ? e.checked : type === "number" ? Number(e.value) : e.value);
    wrap.append(e);
    parent.append(wrap);
    return e;
  }
  function select(parent, label, value, values, fn) {
    const wrap = node("label", label),
      e = node("select");
    e.setAttribute("aria-label", label);
    for (const v of values) {
      const [id, name] = Array.isArray(v) ? v : [v, v];
      e.add(new Option(name, id));
    }
    e.value = value ?? "";
    e.onchange = () => fn(e.value);
    wrap.append(e);
    parent.append(wrap);
    return e;
  }
  const unitName = (a) => MapEditorUnits.find((u) => u.id === a.unitId)?.name || a.unitId;
  const actionNames = {
    spawn: "出现部队",
    protect: "追加保护目标",
    unprotect: "解除保护目标",
    recover: "恢复耐久与EN",
    message: "任务提示",
    dialogue: "剧情对话",
    victory: "任务胜利",
    defeat: "任务失败",
  };
  const conditionNames = [
    ["start", "部署完成后"],
    ["round", "到达指定回合"],
    ["defeated_group", "指定回合内击破分组数量"],
    ["actor_hp", "单位耐久低于百分比"],
    ["actor_destroyed", "指定单位被击坠"],
    ["group_destroyed", "指定部队全部被击坠"],
    ["enter_region", "单位进入地图区域"],
    ["event_completed", "另一事件完成后"],
    ["all", "同时满足以下条件"],
    ["any", "满足其中任一条件"],
  ];
  const defaults = (type, m, event) => ({
    type,
    round: 3,
    byRound: 10,
    count: 1,
    group: m.actors.find((a) => a.team === 1)?.group || m.actors[0]?.group || "enemies",
    actor: m.actors[0]?.id,
    percent: 50,
    x: 0,
    y: 0,
    width: 3,
    height: 3,
    event: m.events.find((e) => e.id !== event.id)?.id,
    ...(["all", "any"].includes(type) ? { conditions: [{ type: "round", round: 3 }] } : {}),
  });
  function describe(w, m) {
    const who = m.actors.find((a) => a.id === w.actor);
    const name = who ? unitName(who) + "（" + who.id + "）" : "未选择单位";
    if (["all", "any"].includes(w.type))
      return (w.conditions || [])
        .map((c) => describe(c, m))
        .join(w.type === "all" ? " 且 " : " 或 ");
    return (
      {
        start: "部署完成",
        round: `第 ${w.round} 回合`,
        defeated_group: `${w.byRound} 回合内击破 ${w.group} 部队 ${w.count} 台`,
        actor_hp: `${name} 耐久 ≤ ${w.percent}%`,
        actor_destroyed: `${name} 被击坠`,
        group_destroyed: `${w.group} 部队全灭`,
        enter_region: `${name} 进入区域 (${w.x},${w.y}) ${w.width}×${w.height}`,
        event_completed: `「${m.events.find((e) => e.id === w.event)?.name || "未选择事件"}」完成`,
      }[w.type] || "未设置条件"
    );
  }
  const actors = (m) => m.actors.map((a) => [a.id, unitName(a) + " · " + a.id]);
  function issues() {
    const d = MapEditor.document,
      m = d.mission;
    if (!m) return [];
    try {
      const models = Object.fromEntries(
        MapEditorUnits.flatMap((u) => (u.kits || []).map((k) => [u.id + "__" + k.id, true])),
      );
      MissionMode.validate(m, d, {
        models,
        pilots: { aceProfile: (id) => MissionEditorData.pilots.some((p) => p.id === id) },
      });
      return [];
    } catch (error) {
      return [error.message];
    }
  }
  function refresh() {
    const open = new Set(
      [...panel.querySelectorAll("details[open]")].map(
        (e) => e.dataset.missionDetail || e.querySelector("summary")?.textContent,
      ),
    );
    const doc = MapEditor.document,
      m = doc.mission;
    panel.replaceChildren();
    document.getElementById("missionCreate").hidden = !!m;
    if (!m) return;
    const guide = node(
      "p",
      "① 点击地图单位编辑部队 → ② 选择事件模板 → ③ 调整条件与动作。事件只触发一次；动作从上到下执行。地图可框选触发区域；重叠单位可在下方选择。",
    );
    guide.className = "mission-guide";
    panel.append(guide);
    const basics = node("details");
    basics.dataset.missionDetail = "mission-basics";
    basics.append(node("summary", "关卡限制与胜败条件"));
    panel.append(basics);
    select(
      basics,
      "关卡年代",
      m.era,
      TechnologyEras.eras,
      (v) => change((m) => (m.era = v)),
    );
    input(
      basics,
      "科技点上限",
      m.technologyLimit,
      (v) => change((m) => (m.technologyLimit = v)),
      "number",
    );
    input(basics, "编组COST上限", m.costLimit, (v) => change((m) => (m.costLimit = v)), "number");
    input(basics, "单位容量点", m.unitLimit, (v) => change((m) => (m.unitLimit = v)), "number");
    input(
      basics,
      "每多一名玩家敌军耐久/EN加成（%）",
      (m.enemyResourcePerPlayer || 0) * 100,
      (v) => change((m) => (m.enemyResourcePerPlayer = v / 100)),
      "number",
    );
    const rewards = node("details");
    rewards.dataset.missionDetail = "mission-rewards";
    rewards.append(node("summary", "通关奖励与事件额外奖励"));
    basics.append(rewards);
    if (!m.rewards)
      rewards.append(
        button("启用固定通关奖励", () =>
          change((m) => (m.rewards = { money: 0, supplies: 0, inventory: {}, bonuses: [] })),
        ),
      );
    else {
      renderReward(rewards, m.rewards, (fn) => change((m) => fn(m.rewards)));
      (m.rewards.bonuses || []).forEach((r, i) => {
        const box = node("fieldset");
        box.append(node("legend", "事件额外奖励 " + (i + 1)));
        rewards.append(box);
        const edit = (fn) => change((m) => fn(m.rewards.bonuses[i]));
        select(
          box,
          "触发奖励的事件",
          r.event,
          m.events.map((e) => [e.id, e.name]),
          (v) => edit((r) => (r.event = v)),
        );
        renderReward(box, r, edit);
        box.append(button("删除额外奖励", () => change((m) => m.rewards.bonuses.splice(i, 1))));
      });
      rewards.append(
        button("＋事件额外奖励", () =>
          change((m) => {
            m.rewards.bonuses ||= [];
            m.rewards.bonuses.push({
              event: m.events[0]?.id,
              money: 0,
              supplies: 0,
              inventory: {},
            });
          }),
        ),
      );
    }
    select(
      basics,
      "胜利条件",
      m.victory.type,
      [
        ["all_enemies", "消灭全部敌人"],
        ["survive", "坚持指定回合"],
        ["defeat_actor", "击破指定单位"],
      ],
      (v) => change((m) => (m.victory = { type: v, round: 10, actor: m.actors[0]?.id })),
    );
    if (m.victory.type === "survive")
      input(
        basics,
        "坚持到第几回合",
        m.victory.round,
        (v) => change((m) => (m.victory.round = v)),
        "number",
      );
    if (m.victory.type === "defeat_actor")
      select(basics, "目标单位", m.victory.actor, actors(m), (v) =>
        change((m) => (m.victory.actor = v)),
      );
    basics.append(node("p", "失败条件：玩家PMC单位全灭，或任意受保护单位被击坠。"));
    const roster = node("details");
    roster.dataset.missionDetail = "actors";
    roster.append(node("summary", "剧情部队与增援（" + m.actors.length + "）"));
    panel.append(roster);
    m.actors.forEach((a, index) => {
      const card = node("details");
      card.dataset.missionDetail = a.id;
      card.dataset.actorId = a.id;
      card.classList.toggle("selected-actor", a.id === selectedActorId);
      card.append(
        node("summary", unitName(a) + " · " + a.id + (a.initial ? " · 开场" : " · 事件增援")),
      );
      roster.append(card);
      const edit = (k, v) => change((m) => (m.actors[index][k] = v));
      input(card, "脚本单位 ID", a.id, v => {
        try { renameActor(a.id, v); }
        catch (error) { alert(error.message); refresh(); }
      });
      card.append(node("p", "独立于机体类型；改名会同步更新事件、镜头和保护目标的引用。"));
      card.append(button("定位地图单位", () => { selectedActorId = a.id; MapEditor.focusCell(a.x, a.y); }));
      for (const event of m.events.filter(e => references(e, a.id)))
        card.append(button("关联事件：" + event.name, () => {
          eventId = event.id; refresh();
          panel.querySelector(".mission-trigger")?.scrollIntoView({block: "nearest"});
        }));
      const search = input(card, "搜索单位编号", a.unitId, (v) =>
        change((m) => {
          const u = MapEditorUnits.find((u) => u.id === v);
          m.actors[index].unitId = v;
          if (u?.kits?.[0]) m.actors[index].kitId = u.kits[0].id;
        }),
      );
      search.setAttribute("list", "missionUnitChoices");
      const unit = MapEditorUnits.find((u) => u.id === a.unitId);
      select(
        card,
        "武器套件",
        a.kitId,
        (unit?.kits || []).map((k) => [k.id, k.name || k.id]),
        (v) => edit("kitId", v),
      );
      select(
        card,
        "队伍",
        a.team,
        [
          [0, "我方：房主控制"],
          [1, "敌军：AI控制"],
        ],
        (v) => edit("team", Number(v)),
      );
      input(card, "分组标记", a.group, (v) => edit("group", v));
      input(card, "X", a.x, (v) => edit("x", v), "number");
      input(card, "Y", a.y, (v) => edit("y", v), "number");
      select(
        card,
        "初始朝向",
        a.angle ?? (a.team ? 180 : 0),
        [
          [0, "向上"],
          [90, "向右"],
          [180, "向下"],
          [270, "向左"],
        ],
        (v) => edit("angle", Number(v)),
      );
      input(card, "小队编号（同编号单位须同格登场）", a.squad || "", (v) =>
        edit("squad", v || undefined),
      );
      card.append(
        button("使用地图选区位置", () => {
          const r = MapEditor.selection;
          if (r) change((m) => Object.assign(m.actors[index], { x: r.x, y: r.y }));
        }),
      );
      input(card, "开场登场", a.initial, (v) => edit("initial", v), "checkbox");
      input(
        card,
        "被击坠则失败",
        m.protect.includes(a.id),
        (v) =>
          change(
            (m) =>
              (m.protect = v
                ? [...new Set([...m.protect, a.id])]
                : m.protect.filter((id) => id !== a.id)),
          ),
        "checkbox",
      );
      select(
        card,
        "ACE驾驶员",
        a.pilotId || "",
        [["", "无"], ...MissionEditorData.pilots.map((p) => [p.id, p.name])],
        (v) => edit("pilotId", v || null),
      );
      input(card, "驾驶员等级（0～5）", a.level || 0, (v) => edit("level", v), "number");
      card.append(
        button("删除单位", () =>
          change((m) => {
            m.actors.splice(index, 1);
            m.protect = m.protect.filter((id) => id !== a.id);
          }),
        ),
      );
    });
    roster.append(
      button("＋添加剧情单位", () =>
        change((m) =>
          m.actors.push({
            id: MapDocument.uid("actor"),
            unitId: "RX_78_2",
            kitId: "kit_0",
            team: 1,
            x: 0,
            y: 0,
            group: "enemies",
            initial: true,
          }),
        ),
      ),
    );
    const list = node("datalist");
    list.id = "missionUnitChoices";
    for (const u of MapEditorUnits) {
      const o = node("option");
      o.value = u.id;
      o.label = u.name;
      list.append(o);
    }
    panel.append(list);
    panel.append(node("h3", "关卡事件"));
    const templates = node("div");
    templates.className = "mission-templates";
    for (const [kind, label] of [
      ["opening", "开场对话"],
      ["reinforcement", "定时增援"],
      ["rescue", "危急支援"],
      ["region", "到达目标区域"],
      ["kill", "击破触发增援"],
      ["chain", "后续事件"],
    ])
      templates.append(button("＋" + label, () => addTemplate(kind, m)));
    panel.append(templates);
    if (!m.events.some((e) => e.id === eventId)) eventId = m.events[0]?.id;
    const cards = node("div");
    cards.className = "mission-events";
    m.events.forEach((e, i) => {
      const b = button("", () => {
        eventId = e.id;
        refresh();
      });
      b.className = "mission-event-card" + (eventId === e.id ? " active" : "");
      b.append(
        node("strong", `${i + 1}. ${e.name}`),
        node("small", describe(e.when, m)),
        node("small", "→ " + (e.actions.map((a) => actionNames[a.type]).join(" → ") || "尚无动作")),
      );
      cards.append(b);
    });
    panel.append(cards);
    select(
      panel,
      "选择事件",
      eventId,
      m.events.map((e) => [e.id, e.name]),
      (v) => {
        eventId = v;
        refresh();
      },
    );
    panel.append(
      button("＋添加事件", () => {
        const id = MapDocument.uid("event");
        eventId = id;
        change((m) =>
          m.events.push({ id, name: "新事件", when: { type: "round", round: 3 }, actions: [] }),
        );
      }),
    );
    const e = m.events.find((e) => e.id === eventId);
    if (e) renderEvent(e, m);
    const report = node("p");
    report.id = "missionScriptValidation";
    try {
      MissionMode.validate(m, doc);
      if (issues().length) throw Error(issues()[0]);
      report.textContent = "✓ 脚本结构检查通过";
    } catch (error) {
      report.textContent = error.message;
      report.style.color = "#ff9696";
    }
    panel.append(report);
    for (const detail of panel.querySelectorAll("details"))
      if (open.has(detail.dataset.missionDetail || detail.querySelector("summary")?.textContent))
        detail.open = true;
  }
  function renderReward(parent, reward, edit) {
    input(parent, "资金奖励", reward.money, (v) => edit((r) => (r.money = v)), "number");
    input(parent, "物资奖励", reward.supplies, (v) => edit((r) => (r.supplies = v)), "number");
    for (const [id, count] of Object.entries(reward.inventory)) {
      input(
        parent,
        (MapEditorUnits.find((u) => u.id === id)?.name || id) + " 库存数量",
        count,
        (v) =>
          edit((r) => {
            if (v > 0) r.inventory[id] = v;
            else delete r.inventory[id];
          }),
        "number",
      );
    }
    const choice = input(parent, "添加奖励单位（输入编号或搜索名称）", "", (v) => {
      const unit = MapEditorUnits.find((u) => u.id === v || u.name === v);
      if (!unit) return alert("请选择有效单位。");
      edit((r) => (r.inventory[unit.id] = (r.inventory[unit.id] || 0) + 1));
    });
    choice.setAttribute("list", "missionUnitChoices");
    parent.append(
      node("small", "单位数量填0可移除；奖励只在胜利结算时发放，每位参战玩家分别获得。"),
    );
  }
  function addTemplate(kind, m) {
    if (!m.actors.length) {
      alert("请先在「剧情部队与增援」添加至少一个单位。");
      return;
    }
    const id = MapDocument.uid("event"),
      actor = m.actors[0];
    const pending = m.actors.filter((a) => !a.initial).map((a) => a.id);
    const dialogue = {
      type: "dialogue",
      lines: [
        {
          actor: actor.id,
          name: MissionEditorData.pilots.find((p) => p.id === actor.pilotId)?.name || "指挥官",
          text: "作战开始。",
        },
      ],
    };
    const presets = {
      opening: { name: "开场对话", when: { type: "start" }, actions: [dialogue] },
      reinforcement: {
        name: "定时增援",
        when: { type: "round", round: 3 },
        actions: [
          { type: "spawn", actors: pending },
          { type: "message", text: "增援部队已抵达。" },
        ],
      },
      rescue: {
        name: "危急支援",
        when: { type: "actor_hp", actor: actor.id, percent: 30 },
        actions: [dialogue, { type: "recover", actors: [actor.id], hpPercent: 50, enPercent: 50 }],
      },
      region: {
        name: "到达目标区域",
        when: { type: "enter_region", actor: actor.id, x: 0, y: 0, width: 3, height: 3 },
        actions: [{ type: "victory" }],
      },
      kill: {
        name: "击破触发增援",
        when: defaults("defeated_group", m, { id }),
        actions: [{ type: "spawn", actors: pending }, dialogue],
      },
      chain: {
        name: "后续事件",
        when: { type: "event_completed", event: m.events[0]?.id },
        actions: [{ type: "message", text: "任务目标已更新。" }],
      },
    };
    if (kind === "chain" && !m.events.length) {
      alert("请先添加一个前置事件。");
      return;
    }
    eventId = id;
    change((m) => m.events.push({ id, ...presets[kind] }));
  }
  function renderCondition(parent, w, m, event, put, depth = 0) {
    select(
      parent,
      depth ? "子条件" : "触发条件",
      w.type,
      conditionNames.filter(([type]) => depth < 2 || !["all", "any"].includes(type)),
      (type) => put(() => defaults(type, m, event)),
    );
    const set = (k, v) => put((c) => ({ ...c, [k]: v }));
    if (["all", "any"].includes(w.type)) {
      (w.conditions || []).forEach((c, i) => {
        const box = node("fieldset");
        box.append(node("legend", "条件 " + (i + 1)));
        parent.append(box);
        renderCondition(
          box,
          c,
          m,
          event,
          (fn) =>
            put((w) => ({ ...w, conditions: w.conditions.map((c, j) => (j === i ? fn(c) : c)) })),
          depth + 1,
        );
        if (w.conditions.length > 1)
          box.append(
            button("删除条件", () =>
              put((w) => ({ ...w, conditions: w.conditions.filter((_, j) => j !== i) })),
            ),
          );
      });
      if (w.conditions.length < 8)
        parent.append(
          button("＋添加条件", () =>
            put((w) => ({ ...w, conditions: [...w.conditions, { type: "round", round: 3 }] })),
          ),
        );
      return;
    }
    if (["actor_hp", "actor_destroyed", "enter_region"].includes(w.type))
      select(parent, "条件单位", w.actor, actors(m), (v) => set("actor", v));
    if (["defeated_group", "group_destroyed"].includes(w.type))
      select(
        parent,
        "敌军分组",
        w.group,
        [...new Set(m.actors.map((a) => a.group))].map((group) => [
          group,
          group + " · " + m.actors.filter((a) => a.group === group).length + " 台",
        ]),
        (v) => set("group", v),
      );
    if (w.type === "event_completed")
      select(
        parent,
        "前置事件",
        w.event,
        m.events.filter((e) => e.id !== event.id).map((e) => [e.id, e.name]),
        (v) => set("event", v),
      );
    for (const [k, label] of w.type === "round"
      ? [["round", "第几回合"]]
      : w.type === "defeated_group"
        ? [
            ["count", "击破数量"],
            ["byRound", "最晚触发回合（包含）"],
          ]
        : w.type === "actor_hp"
          ? [["percent", "耐久百分比"]]
          : w.type === "enter_region"
            ? [
                ["x", "区域X"],
                ["y", "区域Y"],
                ["width", "宽度"],
                ["height", "高度"],
              ]
            : [])
      input(parent, label, w[k], (v) => set(k, v), "number");
    if (w.type === "enter_region") {
      parent.append(button("在地图框选区域", () => MapEditor.chooseTool("select")));
      parent.append(
        button("使用地图选区作为触发区域", () => {
          const r = MapEditor.selection;
          if (!r) return alert("请先在中间地图拖拽框选一个区域。");
          put((w) => ({ ...w, ...r }));
        }),
      );
    }
  }
  function renderEvent(event, m) {
    const edit = (fn) => change((m) => fn(m.events.find((e) => e.id === event.id)));
    const index = m.events.findIndex((e) => e.id === event.id);
    if (index > 0)
      panel.append(
        button("事件上移", () =>
          change((m) => {
            [m.events[index - 1], m.events[index]] = [m.events[index], m.events[index - 1]];
          }),
        ),
      );
    input(panel, "事件名称", event.name, (v) => edit((e) => (e.name = v)));
    panel.append(button("预览事件流程", () => previewFlow(event, m)));
    const triggerBox = node("fieldset");
    triggerBox.className = "mission-trigger";
    triggerBox.append(node("legend", "1. \u4ec0\u4e48\u65f6\u5019\u53d1\u751f"));
    panel.append(triggerBox);
    renderCondition(triggerBox, event.when, m, event, (fn) => edit((e) => (e.when = fn(e.when))));
    panel.append(node("h3", "2. \u6309\u987a\u5e8f\u6267\u884c\u52a8\u4f5c"));
    const flow = node(
      "p",
      describe(event.when, m) +
        " \u2192 " +
        (event.actions.map((a) => actionNames[a.type]).join(" \u2192 ") ||
          "\u8bf7\u6dfb\u52a0\u52a8\u4f5c"),
    );
    flow.className = "mission-guide";
    panel.append(flow);
    event.actions.forEach((action, index) => {
      const box = node("fieldset");
      box.append(node("legend", index + 1 + ". " + actionNames[action.type]));
      panel.append(box);
      const update = (fn) => edit((e) => fn(e.actions[index]));
      if (["spawn", "protect", "unprotect", "recover"].includes(action.type)) {
        const choices = node("div");
        choices.className = "mission-actor-choices";
        input(
          box,
          "筛选动作单位",
          "",
          (v) => {
            for (const label of choices.querySelectorAll("label"))
              label.hidden = !label.textContent.toLowerCase().includes(v.toLowerCase());
          },
          "search",
        );
        box.append(choices);
        for (const a of m.actors)
          input(
            choices,
            unitName(a) + " · " + a.id + (a.initial ? "（开场）" : "（增援）"),
            action.actors.includes(a.id),
            (v) =>
              update(
                (a2) =>
                  (a2.actors = v
                    ? [...new Set([...a2.actors, a.id])]
                    : a2.actors.filter((id) => id !== a.id)),
              ),
            "checkbox",
          );
      }
      if (action.type === "recover") {
        input(
          box,
          "恢复耐久百分比",
          action.hpPercent,
          (v) => update((a) => (a.hpPercent = v)),
          "number",
        );
        input(
          box,
          "恢复EN百分比",
          action.enPercent,
          (v) => update((a) => (a.enPercent = v)),
          "number",
        );
        box.append(node("p", "按最大值恢复，不复活已被击坠的单位。"));
      }
      if (action.type === "message")
        input(box, "任务提示文本", action.text, (v) => update((a) => (a.text = v)));
      if (action.type === "dialogue") {
        action.lines.forEach((line, i) => {
          const row = node("details");
          row.open = true;
          row.append(node("summary", "台词 " + (i + 1)));
          box.append(row);
          const put = (k, v) => update((a) => (a.lines[i][k] = v));
          select(row, "镜头聚焦单位", line.actor, actors(m), (v) => put("actor", v));
          input(row, "显示姓名", line.name, (v) => put("name", v));
          select(
            row,
            "人物头像",
            line.portrait || "",
            [["", "沿用驾驶员头像"], ...MissionEditorData.pilots.map((p) => [p.icon, p.name])],
            (v) => put("portrait", v),
          );
          const image = node("img");
          image.width = image.height = 64;
          image.src = MissionEditorData.portraits[line.portrait] || "";
          image.hidden = !line.portrait;
          row.append(image);
          const label = node("label", "台词"),
            area = node("textarea");
          area.rows = 3;
          area.value = line.text;
          area.onchange = () => put("text", area.value);
          label.append(area);
          row.append(label);
          input(
            row,
            "声音资源路径（可选）",
            line.sound?.startsWith("data:") ? "已导入声音" : line.sound || "",
            (v) => put("sound", v),
          );
          const file = node("input");
          file.type = "file";
          file.accept = "audio/ogg,audio/mpeg,audio/wav";
          file.onchange = () => {
            const f = file.files[0];
            if (!f) return;
            if (f.size > 3 * 1024 * 1024) {
              alert("声音文件最大3MB");
              return;
            }
            const r = new FileReader();
            r.onload = () => put("sound", r.result);
            r.readAsDataURL(f);
          };
          row.append(file);
          row.append(
            button("试听声音", () => {
              if (line.sound) new Audio(line.sound).play().catch(() => {});
            }),
          );
          row.append(button("预览对话", () => preview(line)));
          row.append(button("删除台词", () => update((a) => a.lines.splice(i, 1))));
        });
        box.append(
          button("＋添加台词", () =>
            update((a) =>
              a.lines.push({ actor: m.actors[0]?.id, name: "角色", text: "请输入台词" }),
            ),
          ),
        );
      }
      if (index > 0)
        box.append(
          button("上移", () =>
            edit((e) => {
              [e.actions[index - 1], e.actions[index]] = [e.actions[index], e.actions[index - 1]];
            }),
          ),
        );
      box.append(button("删除动作", () => edit((e) => e.actions.splice(index, 1))));
    });
    const actions = node("div");
    panel.append(actions);
    for (const [type, label] of [
      ["spawn", "＋出现部队"],
      ["dialogue", "＋对话"],
      ["protect", "＋保护目标"],
      ["unprotect", "＋解除保护"],
      ["recover", "＋恢复状态"],
      ["message", "＋任务提示"],
      ["victory", "＋胜利"],
      ["defeat", "＋失败"],
    ])
      actions.append(
        button(label, () =>
          edit((e) =>
            e.actions.push(
              type === "dialogue"
                ? { type, lines: [{ actor: m.actors[0]?.id, name: "角色", text: "请输入台词" }] }
                : type === "recover"
                  ? { type, actors: [], hpPercent: 50, enPercent: 50 }
                  : type === "message"
                    ? { type, text: "任务目标已更新。" }
                    : ["spawn", "protect", "unprotect"].includes(type)
                      ? { type, actors: [] }
                      : { type },
            ),
          ),
        ),
      );
    panel.append(
      button("复制事件", () =>
        change((m) => {
          const copy = structuredClone(event);
          copy.id = MapDocument.uid("event");
          copy.name += "（副本）";
          eventId = copy.id;
          m.events.splice(index + 1, 0, copy);
        }),
      ),
      button("删除事件", () =>
        change((m) => (m.events = m.events.filter((e) => e.id !== event.id))),
      ),
    );
  }
  function previewFlow(event, m) {
    const d = node("dialog"),
      title = node("h3", event.name),
      body = node("div"),
      count = node("p");
    d.className = "mission-flow-preview";
    const steps = [{ text: "触发条件：" + describe(event.when, m) }];
    for (const a of event.actions) {
      if (a.type === "dialogue")
        for (const l of a.lines) {
          const actor = m.actors.find((a) => a.id === l.actor);
          const portrait =
            l.portrait || MissionEditorData.pilots.find((p) => p.id === actor?.pilotId)?.icon;
          steps.push({
            text: l.name + ": " + l.text,
            portrait,
            focus: actor ? `${unitName(actor)} (${actor.x},${actor.y})` : "尚未指定镜头单位",
          });
        }
      else
        steps.push({
          text:
            actionNames[a.type] +
            (a.actors
              ? "：" +
                a.actors
                  .map((id) => {
                    const actor = m.actors.find((a) => a.id === id);
                    return actor ? unitName(actor) + "（" + id + "）" : id;
                  })
                  .join("、")
              : a.text
                ? "：" + a.text
                : "") +
            (a.type === "recover" ? ` · 耐久+${a.hpPercent}% / EN+${a.enPercent}%` : ""),
        });
    }
    let index = 0;
    const back = button("上一步", () => {
      index--;
      draw();
    });
    const next = button("下一步", () => {
      index++;
      draw();
    });
    function draw() {
      const step = steps[index];
      body.replaceChildren();
      if (step.portrait && MissionEditorData.portraits[step.portrait]) {
        const img = node("img");
        img.width = img.height = 96;
        img.src = MissionEditorData.portraits[step.portrait];
        body.append(img);
      }
      body.append(node("p", step.text));
      if (step.focus) body.append(node("small", "镜头：" + step.focus));
      count.textContent = `${index + 1} / ${steps.length} · 仅预览，不执行对局操作`;
      back.disabled = index === 0;
      next.disabled = index === steps.length - 1;
    }
    d.append(
      title,
      body,
      count,
      back,
      next,
      button("关闭", () => {
        d.close();
        d.remove();
      }),
    );
    document.body.append(d);
    draw();
    d.showModal();
  }
  function preview(line) {
    const d = node("dialog"),
      image = node("img"),
      name = node("h3", line.name),
      p = node("p", line.text);
    image.width = image.height = 96;
    image.src = MissionEditorData.portraits[line.portrait] || "";
    image.hidden = !line.portrait;
    d.append(
      image,
      name,
      p,
      button("关闭", () => {
        d.close();
        d.remove();
      }),
    );
    document.body.append(d);
    d.showModal();
  }
  document.getElementById("missionCreate").onclick = () =>
    MapEditor.editMission((d) => {
      d.supportedModes = ["mission"];
      d.mission = {
        version: 1,
        era: "UC_0079_T1",
        technologyLimit: 5000,
        costLimit: 5000,
        unitLimit: 18,
        actors: [],
        events: [],
        protect: [],
        victory: { type: "all_enemies" },
      };
    });
  document.getElementById("missionLoadSample").onclick = () => {
    if (confirm("载入示例将替换当前地图，是否继续？")) {
      MapEditor.importMap(structuredClone(MissionEditorData.sample));
      refresh();
      MapEditor.tab("mission");
    }
  };
  refresh();
  return { refresh, issues, focusActor, renameActor, get selectedActorId() { return selectedActorId; } };
})();
