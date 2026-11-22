const ContractEventEditor = (() => {
  const M = ContractEventModel,
    $ = (id) => document.getElementById(id);
  let doc = M.create(EDITOR_DATA.catalog, EDITOR_DATA.version),
    selected = doc.events[0]?.id,
    dirty = false,
    tab = 0;
  const sections = [
    ["概述与条件", ["summary", "conditions"]],
    ["触发与判定", ["trigger", "completion", "failure"]],
    ["兵力与增援", ["forces", "reinforcements", "multiplayer"]],
    ["演出与奖励", ["presentation", "rewards"]],
    ["改动与参考", ["notes", "source"]],
  ];
  const current = () => doc.events.find((e) => e.id === selected);
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function message(text, error = false) {
    $("message").textContent = text;
    $("message").classList.toggle("error", error);
  }
  function changed() {
    dirty = true;
    $("saveState").textContent = "有改动 · 请导出JSON保存";
  }
  function filters() {
    const q = $("search").value.toLowerCase().trim();
    return doc.events.filter(
      (e) =>
        (!q || [e.name, e.id, e.type].some((s) => s.toLowerCase().includes(q))) &&
        (!$("group").value || e.group === $("group").value) &&
        (!$("filterStatus").value || e.status === $("filterStatus").value),
    );
  }
  function renderList() {
    const events = filters();
    $("count").textContent = `显示 ${events.length} / ${doc.events.length} 项`;
    $("eventList").replaceChildren();
    for (const e of events) {
      const button = element(
        "button",
        undefined,
        "event-item" + (selected === e.id ? " selected" : ""),
      );
      button.dataset.id = e.id;
      button.dataset.status = e.status;
      button.setAttribute("aria-pressed", String(selected === e.id));
      button.append(
        element("strong", e.name),
        element("small", `${e.id} · ${e.type}`),
        element("small", e.group),
        element("span", e.status, "marker"),
      );
      button.onclick = () => {
        selected = e.id;
        renderList();
        renderEvent();
      };
      $("eventList").append(button);
    }
    if (!events.length) $("eventList").append(element("p", "没有符合筛选的事件。", "hint"));
  }
  function updateHint() {
    const e = current(),
      kind = EDITOR_DATA.kinds.find((k) => k.type === e.type);
    $("customTypeLabel").hidden = !!kind;
    $("typeHint").textContent = kind
      ? "现行类型参考：" + kind.hint
      : "新增类型目前未实现；请在策划文本写清行为，并标记“需要调整”。";
  }
  function renderEvent() {
    const e = current();
    $("eventPanel").hidden = !e;
    $("empty").hidden = !!e;
    $("exportCurrent").disabled = !e;
    if (!e) return;
    $("eventTitle").textContent = e.name;
    for (const [id, key] of [
      ["name", "name"],
      ["eventId", "id"],
      ["eventGroup", "group"],
      ["status", "status"],
    ])
      $(id).value = e[key];
    $("type").value = EDITOR_DATA.kinds.some((k) => k.type === e.type) ? e.type : "custom";
    $("customType").value = e.type;
    $("up").disabled = doc.events.indexOf(e) === 0;
    $("down").disabled = doc.events.indexOf(e) === doc.events.length - 1;
    updateHint();
    $("tabs").replaceChildren(
      ...sections.map(([title], i) => {
        const button = element("button", title);
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(i === tab));
        button.onclick = () => {
          tab = i;
          renderEvent();
        };
        return button;
      }),
    );
    $("fields").replaceChildren(
      ...sections[tab][1].map((key) => {
        const title = M.fields.find((f) => f[0] === key)[1],
          label = element("label", title);
        if (["notes", "source", "reinforcements"].includes(key)) label.className = "wide";
        const input = element("textarea");
        input.id = "field_" + key;
        input.value = e[key];
        input.maxLength = 50000;
        input.oninput = () => {
          e[key] = input.value;
          changed();
        };
        label.append(input);
        return label;
      }),
    );
  }
  function render() {
    $("systemVersion").value = doc.systemVersion;
    $("sourceVersion").textContent = "规则快照 · " + doc.sourceVersion;
    $("commonRules").value = doc.commonRules;
    $("notes").value = doc.notes;
    renderList();
    renderEvent();
  }
  function check() {
    const errors = M.validate(doc);
    if (errors.length) {
      message(errors.join(" "), true);
      return false;
    }
    return true;
  }
  function download(value, filename, mime) {
    const url = URL.createObjectURL(new Blob([value], { type: mime })),
      a = element("a");
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const safeName = (value) => value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "planning";
  function exportJSON(single = false) {
    if (!check()) return;
    const value = M.clone(doc);
    if (single) {
      if (!current()) return;
      value.events = [M.clone(current())];
    }
    download(
      JSON.stringify(value, null, 2) + "\n",
      `contract-events-${single ? current().id + "-" : ""}${safeName(doc.systemVersion)}.json`,
      "application/json",
    );
    if (!single) {
      dirty = false;
      $("saveState").textContent = "已导出全部JSON";
    }
    message(
      single
        ? "已导出当前事件，共用规则一并包含；其余事件尚未保存。"
        : "已导出全部事件。下次通过导入JSON继续编辑。",
    );
  }
  for (const id of ["status", "filterStatus"])
    for (const status of M.statuses) $(id).append(new Option(status, status));
  for (const kind of EDITOR_DATA.kinds)
    $("type").append(new Option(kind.name + " · " + kind.type, kind.type));
  $("type").append(new Option("新增自定义类型", "custom"));
  $("template").append(new Option("空白事件", ""));
  for (const e of EDITOR_DATA.catalog.events)
    $("template").append(new Option(e.name + " · " + e.id, e.id));
  for (const id of ["search", "group", "filterStatus"])
    $(id).addEventListener(id === "search" ? "input" : "change", renderList);
  for (const [id, key] of [
    ["name", "name"],
    ["eventGroup", "group"],
    ["status", "status"],
  ])
    $(id).addEventListener(id === "name" ? "input" : "change", () => {
      if (!current()) return;
      current()[key] = $(id).value;
      changed();
      $("eventTitle").textContent = current().name;
      renderList();
    });
  $("eventId").onchange = () => {
    const e = current(),
      id = $("eventId").value.trim();
    if (!e) return;
    if (
      !/^[a-z][a-z0-9_-]{0,79}$/.test(id) ||
      doc.events.some((other) => other !== e && other.id === id)
    ) {
      message("编号无效或重复，已保留原编号。", true);
      $("eventId").value = e.id;
      return;
    }
    e.id = selected = id;
    changed();
    renderList();
  };
  $("type").onchange = () => {
    if (!current()) return;
    current().type = $("type").value;
    $("customType").value = current().type;
    changed();
    updateHint();
    renderList();
  };
  $("customType").onchange = () => {
    const value = $("customType").value.trim();
    if (!/^[a-z][a-z0-9_-]{0,79}$/.test(value)) {
      message("类型ID无效。", true);
      $("customType").value = current().type;
      return;
    }
    current().type = value;
    changed();
    renderEvent();
    renderList();
  };
  $("systemVersion").oninput = () => {
    doc.systemVersion = $("systemVersion").value;
    changed();
  };
  for (const id of ["commonRules", "notes"])
    $(id).oninput = () => {
      doc[id] = $(id).value;
      changed();
    };
  for (const [button, dialog] of [
    ["common", "commonDialog"],
    ["add", "addDialog"],
  ])
    $(button).onclick = () => $(dialog).showModal();
  document
    .querySelectorAll("[data-close]")
    .forEach((button) => (button.onclick = () => button.closest("dialog").close()));
  $("preview").onclick = () => {
    if (!check()) return;
    $("previewText").textContent = M.markdown(doc);
    $("previewDialog").showModal();
  };
  function added(e) {
    selected = e.id;
    tab = 0;
    changed();
    for (const id of ["search", "group", "filterStatus"]) $(id).value = "";
    render();
  }
  $("confirmAdd").onclick = () => {
    try {
      added(
        M.add(
          doc,
          EDITOR_DATA.catalog.events.find((e) => e.id === $("template").value),
        ),
      );
      $("addDialog").close();
    } catch (error) {
      message(error.message, true);
    }
  };
  $("duplicate").onclick = () => {
    try {
      added(M.add(doc, current()));
    } catch (error) {
      message(error.message, true);
    }
  };
  $("remove").onclick = () => {
    const e = current();
    if (
      !e ||
      !confirm("确定删除“" + e.name + "”？要交代停用已有事件，建议改用“废弃”标记保留记录。")
    )
      return;
    const index = doc.events.indexOf(e);
    doc.events.splice(index, 1);
    selected = doc.events[Math.min(index, doc.events.length - 1)]?.id;
    changed();
    render();
  };
  for (const [id, offset] of [
    ["up", -1],
    ["down", 1],
  ])
    $(id).onclick = () => {
      const i = doc.events.indexOf(current()),
        next = i + offset;
      if (i < 0 || next < 0 || next >= doc.events.length) return;
      [doc.events[i], doc.events[next]] = [doc.events[next], doc.events[i]];
      changed();
      renderList();
      renderEvent();
    };
  $("restore").onclick = () => {
    if (!confirm("用构建时携带的现有事件替换整份策划？请先导出需要保留的内容。")) return;
    doc = M.create(EDITOR_DATA.catalog, EDITOR_DATA.version);
    selected = doc.events[0]?.id;
    added(doc.events[0]);
    message("已恢复当前构建的规则快照。请另行导出保存。");
  };
  $("import").onclick = () => $("file").click();
  $("file").onchange = async () => {
    const file = $("file").files[0];
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw Error("文件不得超过5MB。");
      const imported = M.parse(await file.text());
      if (dirty && !confirm("导入将替换整份当前策划，包括共用规则。是否继续？")) return;
      doc = imported;
      selected = doc.events[0]?.id;
      tab = 0;
      dirty = false;
      for (const id of ["search", "group", "filterStatus"]) $(id).value = "";
      $("saveState").textContent = "已导入 · " + file.name;
      render();
      message(`已导入${doc.events.length}项事件。不会修改游戏。`);
    } catch (error) {
      message(error.message, true);
    } finally {
      $("file").value = "";
    }
  };
  $("export").onclick = () => exportJSON();
  $("exportCurrent").onclick = () => exportJSON(true);
  $("exportMarkdown").onclick = () => {
    if (!check()) return;
    download(
      M.markdown(doc),
      `contract-events-${safeName(doc.systemVersion)}.md`,
      "text/markdown;charset=utf-8",
    );
    message("已导出AI交接Markdown；继续编辑请同时保留JSON。");
  };
  window.addEventListener("beforeunload", (event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  render();
  return { snapshot: () => M.clone(doc) };
})();
