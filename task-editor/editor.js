(() => {
  "use strict";
  const $ = (id) => document.getElementById(id),
    M = TaskTreeModel,
    statuses = EDITOR_DATA.statuses,
    key = "projectgreed.contact-planning.v1";
  let doc = M.blank(),
    contactId = doc.contacts[0].id,
    selected = null,
    scale = 1,
    history = [],
    future = [],
    timer,
    contactMode = false;
  const contact = () => doc.contacts.find((c) => c.id === contactId) || doc.contacts[0],
    task = () => contact().tasks.find((t) => t.id === selected),
    statusOf = (t) => statuses.find((s) => s.id === t.status);
  const el = (tag, text, cls) => {
      const n = document.createElement(tag);
      if (text !== undefined) n.textContent = text;
      if (cls) n.className = cls;
      return n;
    },
    tell = (text) => {
      $("status").textContent = text;
    };
  function persist() {
    if (M.validate(doc, statuses).length) {
      tell("请补全版本号或委托名称，当前修改尚未保存。");
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(doc));
      tell("策划草稿已保存 · 系统版本 " + doc.systemVersion);
    } catch {
      tell("无法保存草稿，请导出JSON。");
    }
  }
  function checkpoint() {
    history.push(JSON.stringify(doc));
    if (history.length > 60) history.shift();
    future = [];
  }
  function edit(fn, refresh = true) {
    checkpoint();
    fn();
    clearTimeout(timer);
    timer = setTimeout(persist, 250);
    draw();
    list();
    if (refresh) inspect();
  }
  function load(value) {
    const errors = M.validate(value, statuses);
    if (errors.length) throw Error(errors.join("\n"));
    doc = M.clone(value);
    delete doc.aiGuide;
    contactId = doc.contacts[0].id;
    selected = contact().tasks[0]?.id || null;
    history = [];
    future = [];
    contactMode = false;
    render();
    persist();
  }
  function list() {
    const q = $("search").value.trim().toLowerCase(),
      filter = $("statusFilter").value;
    $("taskList").replaceChildren();
    for (const t of contact().tasks.filter(
      (t) =>
        (!filter || filter === t.status) &&
        [t.name, t.text, t.id].some((v) => v.toLowerCase().includes(q)),
    )) {
      const b = el("button", t.name);
      b.append(el("small", t.status + " · " + t.id));
      b.style.borderLeft = "3px solid " + statusOf(t).color;
      b.onclick = () => {
        selected = t.id;
        contactMode = false;
        draw();
        inspect();
        center();
      };
      $("taskList").append(b);
    }
  }
  function draw() {
    const c = contact(),
      { positions, width, height } = M.layout(c),
      scene = $("scene");
    scene.style.width = width + "px";
    scene.style.height = height + "px";
    scene.style.transform = `scale(${scale})`;
    $("nodes").replaceChildren();
    const svg = $("edges");
    svg.replaceChildren();
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    const ns = "http://www.w3.org/2000/svg",
      make = (tag, attrs) => {
        const e = document.createElementNS(ns, tag);
        for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
        return e;
      };
    const defs = make("defs", {}),
      marker = make("marker", {
        id: "arrow",
        viewBox: "0 0 10 10",
        refX: 9,
        refY: 5,
        markerWidth: 7,
        markerHeight: 7,
        orient: "auto",
      });
    marker.append(make("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#598aa7" }));
    defs.append(marker);
    svg.append(defs);
    for (const t of c.tasks) {
      const p = positions.get(t.id);
      if (!p) continue;
      for (const id of t.requires) {
        const a = positions.get(id);
        if (!a) continue;
        const sx = a.x + 108,
          sy = a.y + 112,
          tx = p.x + 108,
          ty = p.y;
        svg.append(
          make("path", {
            d: `M${sx} ${sy} C${sx} ${sy + 35},${tx} ${ty - 35},${tx} ${ty - 8}`,
            fill: "none",
            stroke: "#598aa7",
            "stroke-width": 2,
            "marker-end": "url(#arrow)",
          }),
        );
      }
      const s = statusOf(t),
        b = el(
          "button",
          undefined,
          "node" + (selected === t.id && !contactMode ? " selected" : ""),
        );
      b.dataset.id = t.id;
      b.style.left = p.x + "px";
      b.style.top = p.y + "px";
      b.style.borderLeftColor = s.color;
      b.append(el("small", t.status), el("strong", t.name), el("p", t.text || "填写委托策划文本"));
      b.onclick = () => {
        selected = t.id;
        contactMode = false;
        draw();
        inspect();
      };
      $("nodes").append(b);
    }
    if (!c.tasks.length)
      $("nodes").append(el("p", "点击“新增委托”，填写标记和策划文本。", "empty"));
    $("count").textContent = c.tasks.length + " 项委托";
    $("zoom").textContent = Math.round(scale * 100) + "%";
    $("undo").disabled = !history.length;
    $("redo").disabled = !future.length;
  }
  function field(label, input, hint) {
    const wrap = el("label", label);
    input.setAttribute("aria-label", label);
    wrap.append(input);
    if (hint) wrap.append(el("small", hint));
    return wrap;
  }
  function textField(parent, obj, k, label, multiline = false) {
    const input = el(multiline ? "textarea" : "input");
    input.value = obj[k];
    input.onchange = () => edit(() => (obj[k] = input.value), false);
    if (multiline) input.className = "planning-text";
    parent.append(field(label, input));
  }
  function inspect() {
    const panel = $("inspector"),
      c = contact(),
      t = task();
    panel.replaceChildren();
    $("panelTitle").textContent = contactMode ? "联络人策划文本" : "委托策划";
    if (contactMode) {
      if (c.portrait) {
        const image = el("img", undefined, "contact-portrait");
        image.src = c.portrait.dataUrl;
        image.alt = c.name + "头像";
        panel.append(image);
      }
      const upload = el("input");
      upload.type = "file";
      upload.accept = "image/png,image/jpeg,image/webp";
      upload.onchange = async () => {
        const file = upload.files[0];
        if (!file) return;
        try {
          if (file.size > 1024 * 1024) throw Error("头像不得超过1MB。");
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(Error("头像读取失败。"));
            reader.readAsDataURL(file);
          });
          const candidate = M.clone(doc),
            portrait = { id: "", source: file.name, dataUrl };
          candidate.contacts.find((item) => item.id === c.id).portrait = portrait;
          const errors = M.validate(candidate, statuses);
          if (errors.length) throw Error(errors.join("\n"));
          const image = new Image();
          image.src = dataUrl;
          await image.decode();
          edit(() => (c.portrait = portrait));
        } catch (error) {
          tell(error.message);
          alert(error.message);
        }
      };
      panel.append(field("联络人头像", upload, "PNG、JPEG或WebP，最多1MB；图片随联络人JSON保存。"));
      if (c.portrait) {
        const remove = el("button", "移除头像");
        remove.onclick = () => edit(() => delete c.portrait);
        panel.append(remove);
      }
      textField(panel, c, "text", "联络人文本（初见对话、背景或共通要求）", true);
      return;
    }
    if (!t) {
      panel.append(el("p", "选中委托后填写名称、改动标记和策划文本。", "hint"));
      return;
    }
    panel.append(el("p", "稳定编号：" + t.id, "node-code"));
    textField(panel, t, "name", "委托名称");
    const select = el("select");
    for (const s of statuses) {
      const o = el("option", s.id);
      o.value = s.id;
      select.append(o);
    }
    select.value = t.status;
    select.onchange = () => edit(() => (t.status = select.value));
    panel.append(field("委托改动标记", select), el("div", statusOf(t).description, "description"));
    textField(panel, t, "text", "策划文本", true);
    panel.append(
      el("p", "自由填写任务内容、目标、对话、初始装备、奖励及特殊条件。无需填写程序字段。", "hint"),
    );
    const box = el("details", undefined, "prerequisites");
    box.append(el("summary", "前置委托（可选）"));
    const excluded = M.descendants(c, t.id);
    for (const other of c.tasks.filter((x) => !excluded.has(x.id))) {
      const check = el("input");
      check.type = "checkbox";
      check.checked = t.requires.includes(other.id);
      check.onchange = () =>
        edit(
          () =>
            (t.requires = check.checked
              ? [...t.requires, other.id]
              : t.requires.filter((id) => id !== other.id)),
        );
      box.append(field(other.name + " · " + other.id, check));
    }
    panel.append(box);
    const row = el("div", undefined, "row"),
      copy = el("button", "复制委托"),
      remove = el("button", "删除卡片", "danger");
    copy.onclick = () =>
      edit(() => {
        const n = M.add(doc, c, null);
        n.name = t.name + "（副本）";
        n.text = t.text;
        n.requires = [...t.requires];
        selected = n.id;
      });
    remove.onclick = () => {
      if (confirm("删除策划卡片？若希望通知AI停用委托，请保留卡片并标为“废弃”。"))
        edit(() => {
          c.tasks = c.tasks.filter((x) => x !== t);
          for (const x of c.tasks) x.requires = x.requires.filter((id) => id !== t.id);
          selected = null;
        });
    };
    row.append(copy, remove);
    panel.append(row);
  }
  function render() {
    const s = $("contact");
    s.replaceChildren();
    for (const c of doc.contacts) {
      const o = el("option", c.name);
      o.value = c.id;
      s.append(o);
    }
    s.value = contact().id;
    $("contactName").value = contact().name;
    $("systemVersion").value = doc.systemVersion;
    $("notes").value = doc.notes;
    $("addContact").disabled = doc.contacts.length >= 30;
    list();
    draw();
    inspect();
  }
  function center() {
    const n = $("nodes").querySelector(`[data-id="${selected}"]`);
    n?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }
  function exported() {
    const errors = M.validate(doc, statuses);
    if (errors.length) throw Error(errors.join("\n"));
    return M.bundle(doc, statuses, contact().id);
  }
  function download(name, text, mime) {
    const a = el("a");
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const filename = () =>
    (contact().id + "-" + contact().name + "-" + doc.systemVersion).replace(/[\\/:*?"<>|]/g, "_").slice(0, 100);
  $("contact").onchange = () => {
    contactId = $("contact").value;
    selected = null;
    contactMode = false;
    render();
  };
  $("contactName").onchange = () => {
    if (!$("contactName").value.trim()) return;
    edit(() => (contact().name = $("contactName").value));
    render();
  };
  $("systemVersion").onchange = () =>
    edit(() => (doc.systemVersion = $("systemVersion").value), false);
  $("notes").onchange = () => edit(() => (doc.notes = $("notes").value), false);
  $("addContact").onclick = () => {
    edit(() => {
      if (doc.contacts.length >= 30) throw Error("最多30个联络人。");
      let n = 1;
      while (doc.contacts.some((c) => c.id === "contact_" + n)) n++;
      const c = { id: "contact_" + n, name: "新联络人", text: "", tasks: [] };
      doc.contacts.push(c);
      contactId = c.id;
      selected = null;
    });
    render();
  };
  function add(root) {
    contactMode = false;
    try {
      edit(() => (selected = M.add(doc, contact(), root ? null : selected).id));
      center();
    } catch (e) {
      tell(e.message);
    }
  }
  $("addTask").onclick = () => add(false);
  $("addRoot").onclick = () => add(true);
  $("contactText").onclick = () => {
    contactMode = !contactMode;
    inspect();
    draw();
  };
  $("search").oninput = list;
  $("statusFilter").onchange = list;
  $("new").onclick = () => {
    if (confirm("新建并替换草稿？请先导出需要保留的内容。")) load(M.blank());
  };
  $("import").onclick = () => $("file").click();
  $("file").onchange = async () => {
    const f = $("file").files[0];
    if (!f) return;
    try {
      if (f.size > 5 * 1024 * 1024) throw Error("文件不得超过5MB。");
      const next = JSON.parse(await f.text()),
        errors = M.validate(next, statuses);
      if (errors.length) throw Error(errors.join("\n"));
      if (confirm("导入并替换草稿？")) load(next);
    } catch (e) {
      tell("导入失败：" + e.message);
      alert(e.message);
    } finally {
      $("file").value = "";
    }
  };
  $("export").onclick = () => {
    try {
      download(filename() + ".json", JSON.stringify(exported(), null, 2), "application/json");
      tell("已导出当前联络人JSON（含头像及全部委托）。");
    } catch (e) {
      alert(e.message);
    }
  };
  $("ai").onclick = () => {
    try {
      download(
        filename() + ".txt",
        "请先核对委托系统版本号，然后严格按委托改动标记和策划文本确定实现范围。\n\n" +
          JSON.stringify(exported(), null, 2),
        "text/plain;charset=utf-8",
      );
      tell("已导出AI制作说明。");
    } catch (e) {
      alert(e.message);
    }
  };
  $("preview").onclick = () => {
    const errors = M.validate(doc, statuses);
    $("validation").textContent = errors.length
      ? errors.join("\n")
      : "文档结构有效。系统版本：" + doc.systemVersion + "；仅校验策划文档，不校验程序实现。";
    $("json").value = JSON.stringify(M.bundle(doc, statuses, contact().id), null, 2);
    $("output").showModal();
  };
  $("close").onclick = () => $("output").close();
  $("copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("json").value);
      tell("已复制。");
    } catch {
      $("json").select();
      tell("请按Ctrl+C复制。");
    }
  };
  function restore(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(doc));
    doc = JSON.parse(from.pop());
    contactId = contact().id;
    selected = null;
    render();
    persist();
  }
  $("undo").onclick = () => restore(history, future);
  $("redo").onclick = () => restore(future, history);
  $("zoomIn").onclick = () => {
    scale = Math.min(1.5, scale + 0.1);
    draw();
  };
  $("zoomOut").onclick = () => {
    scale = Math.max(0.4, scale - 0.1);
    draw();
  };
  $("center").onclick = center;
  for (const s of statuses) {
    const o = el("option", s.id);
    o.value = s.id;
    $("statusFilter").append(o);
    const p = el("p", s.id + "：" + s.description, "hint");
    p.style.borderLeft = "3px solid " + s.color;
    p.style.paddingLeft = "7px";
    $("legend").append(p);
  }
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    if (saved && !M.validate(saved, statuses).length) doc = saved;
  } catch {
    tell("无法读取草稿。");
  }
  contactId = doc.contacts[0].id;
  selected = contact().tasks[0]?.id || null;
  render();
  window.TaskTreeEditor = { snapshot: () => M.clone(doc), exportValue: exported };
})();
