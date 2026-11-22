(() => {
  "use strict";
  const $ = (id) => document.getElementById(id),
    M = TaskTreeModel,
    key = "projectgreed.task-tree-editor.v1";
  const categories = {
    plan: "任务设计",
    contract: "合约事件",
    condition: "剧本触发条件",
    action: "剧本动作",
    victory: "胜利条件",
    contact: "联络任务",
  };
  let doc = M.blank(),
    selected = null,
    scale = 1,
    history = [],
    future = [],
    saveTimer;
  const typeOf = (n) => EDITOR_DATA.types.find((t) => t.id === n.kind),
    selectedNode = () => doc.nodes.find((n) => n.id === selected);
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const tell = (text) => {
    $("status").textContent = text;
  };
  function persist() {
    try {
      localStorage.setItem(key, JSON.stringify(doc));
      tell("草稿已自动保存 · " + new Date().toLocaleTimeString());
    } catch {
      tell("浏览器无法保存草稿，请及时导出JSON。");
    }
  }
  function checkpoint() {
    history.push(JSON.stringify(doc));
    if (history.length > 60) history.shift();
    future = [];
  }
  function changed() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 250);
    $("undo").disabled = !history.length;
    $("redo").disabled = !future.length;
    draw();
  }
  function edit(fn, refresh = true) {
    checkpoint();
    fn();
    changed();
    if (refresh) renderInspector();
  }
  function load(value) {
    const errors = M.validate(value, EDITOR_DATA.types);
    if (errors.length) throw Error(errors.join("\n"));
    doc = M.clone(value);
    selected = doc.nodes[0]?.id || null;
    history = [];
    future = [];
    render();
    persist();
  }
  function add(type) {
    edit(() => {
      const n = M.add(doc, type, selected);
      selected = n.id;
    });
    center();
  }
  function library() {
    const q = $("search").value.trim().toLowerCase();
    $("library").replaceChildren();
    for (const [category, name] of Object.entries(categories)) {
      const matches = EDITOR_DATA.types.filter(
        (t) =>
          t.category === category &&
          [t.name, t.id, t.description].some((v) => v.toLowerCase().includes(q)),
      );
      if (!matches.length) continue;
      const details = el("details"),
        summary = el("summary", name + " · " + matches.length);
      details.open = category === "plan" || category === "contract" || !!q;
      details.append(summary);
      for (const type of matches) {
        const button = el("button", type.name);
        button.title = type.description;
        button.append(el("small", type.type));
        button.onclick = () => add(type);
        details.append(button);
      }
      $("library").append(details);
    }
  }
  function draw() {
    const { positions, width, height } = M.layout(doc),
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
    for (const n of doc.nodes) {
      const p = positions.get(n.id),
        t = typeOf(n);
      if (!p) continue;
      if (n.parent) {
        const a = positions.get(n.parent);
        if (a) {
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
          const label = make("text", {
            x: (sx + tx) / 2 + 7,
            y: (sy + ty) / 2,
            fill: "#9fbfd1",
            "font-size": 11,
          });
          label.textContent = n.edgeLabel;
          svg.append(label);
        }
      }
      const button = el("button", undefined, "node" + (selected === n.id ? " selected" : ""));
      button.dataset.id = n.id;
      button.dataset.category = t.category;
      button.style.left = p.x + "px";
      button.style.top = p.y + "px";
      button.append(
        el("small", categories[t.category] + " · " + t.type),
        el("strong", n.title),
        el("p", n.description || t.description),
      );
      button.onclick = () => {
        selected = n.id;
        draw();
        renderInspector();
      };
      $("nodes").append(button);
    }
    if (!doc.nodes.length)
      $("nodes").append(el("p", "从左侧选择一种事件，开始编写任务树。", "empty"));
    $("count").textContent = doc.nodes.length + " 个节点";
    $("zoom").textContent = Math.round(scale * 100) + "%";
    $("undo").disabled = !history.length;
    $("redo").disabled = !future.length;
  }
  function field(label, input, hint) {
    const wrap = el("label", label);
    wrap.append(input);
    if (hint) wrap.append(el("small", hint));
    return wrap;
  }
  function input(value, change, tag = "input") {
    const node = el(tag);
    node.value = value;
    node.onchange = () => change(node.value, node);
    return node;
  }
  function renderInspector() {
    const panel = $("inspector"),
      n = selectedNode();
    panel.replaceChildren();
    if (!n) {
      panel.append(el("p", "选择节点后编辑参数。", "hint"));
      return;
    }
    const t = typeOf(n);
    panel.append(
      el("div", t.description, "description"),
      el("p", n.id + " · " + n.kind, "node-code"),
    );
    panel.append(
      field(
        "节点名称",
        input(n.title, (v) => edit(() => (n.title = v), false)),
      ),
      field(
        "设计描述 / AI补充说明",
        input(n.description, (v) => edit(() => (n.description = v), false), "textarea"),
      ),
    );
    const type = el("select");
    for (const item of EDITOR_DATA.types) {
      const option = el("option", categories[item.category] + " / " + item.name);
      option.value = item.id;
      type.append(option);
    }
    type.value = n.kind;
    type.onchange = () => {
      if (!confirm("切换类型将重置该节点的参数，是否继续？")) {
        type.value = n.kind;
        return;
      }
      edit(() => {
        const next = EDITOR_DATA.types.find((t) => t.id === type.value);
        n.kind = next.id;
        n.parameters = Object.fromEntries(next.fields.map((f) => [f.key, M.clone(f.value)]));
      });
    };
    panel.append(field("事件类型", type));
    const parents = el("select"),
      none = el("option", "无（根节点）");
    none.value = "";
    parents.append(none);
    const excluded = M.descendants(doc, n.id);
    for (const p of doc.nodes.filter((p) => !excluded.has(p.id))) {
      const option = el("option", p.title + " · " + p.id);
      option.value = p.id;
      parents.append(option);
    }
    parents.value = n.parent || "";
    parents.onchange = () => edit(() => (n.parent = parents.value || null));
    panel.append(
      field("前置节点", parents),
      field(
        "连线文字 / 分支选项",
        input(n.edgeLabel, (v) => edit(() => (n.edgeLabel = v), false)),
      ),
    );
    const fields = el("section", undefined, "fields");
    fields.append(el("h2", "事件参数"));
    for (const f of t.fields) {
      const value = n.parameters[f.key] ?? M.clone(f.value);
      if (f.type === "dialogue") {
        const lines = el("div");
        lines.append(
          el("p", "对话按从上到下播放。声音为资源路径；头像为assets/pilots/下的图片。", "hint"),
        );
        for (const [index, line] of (Array.isArray(value) ? value : []).entries()) {
          const box = el("div", undefined, "dialogue-line");
          box.append(el("b", "第 " + (index + 1) + " 句"));
          for (const [k, label] of Object.entries({
            actor: "镜头聚焦的脚本单位ID",
            name: "角色名称",
            text: "对话文本",
            portrait: "头像路径（可选）",
            sound: "声音路径（可选）",
          }))
            box.append(
              field(
                label,
                input(
                  line[k] || "",
                  (v) =>
                    edit(() => {
                      n.parameters[f.key] = value;
                      value[index][k] = v;
                    }, false),
                  k === "text" ? "textarea" : "input",
                ),
              ),
            );
          const remove = el("button", "移除本句");
          remove.onclick = () =>
            edit(() => {
              n.parameters[f.key] = value.filter((_, i) => i !== index);
            });
          box.append(remove);
          lines.append(box);
        }
        const plus = el("button", "＋ 添加对话");
        plus.disabled = value.length >= 50;
        plus.onclick = () =>
          edit(() => {
            n.parameters[f.key] = [
              ...value,
              { actor: "", name: "", text: "", portrait: "", sound: "" },
            ];
          });
        lines.append(plus);
        fields.append(field(f.label, lines));
        continue;
      }
      const text =
        f.type === "json"
          ? JSON.stringify(value, null, 2)
          : f.type === "list"
            ? value.join(", ")
            : value;
      const node = input(
        text,
        (v, control) => {
          try {
            let parsed =
              f.type === "number"
                ? Number(v)
                : f.type === "json"
                  ? JSON.parse(v)
                  : f.type === "list"
                    ? v
                        .split(/[,，\n]/)
                        .map((s) => s.trim())
                        .filter(Boolean)
                    : v;
            if (f.type === "number" && (!v.trim() || !Number.isFinite(parsed)))
              throw Error("请填写有效数字。");
            if (f.type === "json" && (parsed === null || typeof parsed !== "object"))
              throw Error("此参数需要JSON对象或列表。");
            edit(() => (n.parameters[f.key] = parsed), false);
          } catch (error) {
            control.classList.add("invalid");
            control.setCustomValidity(error.message);
            control.reportValidity();
            tell("参数未保存：" + error.message);
          }
        },
        f.type === "json" ? "textarea" : "input",
      );
      if (f.type === "number") node.type = "number";
      node.oninput = () => {
        node.setCustomValidity("");
        node.classList.remove("invalid");
      };
      fields.append(field(f.label, node, f.hint));
    }
    if (!t.fields.length) fields.append(el("p", "此类型不需要额外参数。", "hint"));
    panel.append(fields);
    const row = el("div", undefined, "row"),
      child = el("button", "＋ 子任务"),
      copy = el("button", "复制节点"),
      remove = el("button", "删除分支", "danger");
    child.onclick = () => add(EDITOR_DATA.types[0]);
    copy.onclick = () =>
      edit(() => {
        const x = M.add(doc, t, n.parent);
        Object.assign(x, {
          title: n.title + "（副本）",
          description: n.description,
          edgeLabel: n.edgeLabel,
          parameters: M.clone(n.parameters),
        });
        selected = x.id;
      });
    remove.onclick = () => {
      const ids = M.descendants(doc, n.id);
      if (confirm(`删除此节点及其 ${ids.size - 1} 个后续节点？`))
        edit(() => {
          doc.nodes = doc.nodes.filter((x) => !ids.has(x.id));
          selected = n.parent;
        });
    };
    row.append(child, copy, remove);
    panel.append(row);
    if (doc.sourceMap)
      panel.append(
        el(
          "p",
          "已保留导入的原地图。节点编辑不会自动改写原地图；请导出设计稿交由AI生成新剧本。",
          "reference",
        ),
      );
  }
  function render() {
    for (const [id, k] of [
      ["title", "name"],
      ["era", "era"],
      ["environment", "environment"],
      ["cost", "costLimit"],
      ["fleet", "fleetLimit"],
    ])
      $(id).value = doc.project[k];
    library();
    draw();
    renderInspector();
  }
  function center() {
    const node = $("nodes").querySelector(`[data-id="${selected}"]`);
    if (node) node.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }
  function exportValue() {
    const errors = M.validate(doc, EDITOR_DATA.types);
    if (errors.length) throw Error(errors.join("\n"));
    return M.bundle(doc, EDITOR_DATA.types, EDITOR_DATA.version);
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
  function safeName() {
    return doc.project.name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "task-tree";
  }
  function aiText() {
    const value = exportValue();
    return (
      "请根据以下ProjectGreed任务设计树制作任务。先阅读reference中的现有事件语义与注意事项，列出待补全的内容，再修改工程并验证。\n\n" +
      JSON.stringify(value, null, 2)
    );
  }
  for (const era of EDITOR_DATA.eras) {
    const o = el("option", era);
    o.value = era;
    $("era").append(o);
  }
  for (const [id, k] of [
    ["title", "name"],
    ["era", "era"],
    ["environment", "environment"],
    ["cost", "costLimit"],
    ["fleet", "fleetLimit"],
  ])
    $(id).onchange = () => {
      checkpoint();
      doc.project[k] = ["cost", "fleet"].includes(id) ? Number($(id).value) : $(id).value;
      changed();
    };
  $("search").oninput = library;
  $("new").onclick = () => {
    if (confirm("新建任务？当前草稿将替换，请先导出需要保留的内容。")) load(M.blank());
  };
  $("sample").onclick = () => {
    if (confirm("载入示例并替换当前草稿？")) load(EDITOR_DATA.sample);
  };
  $("import").onclick = () => $("file").click();
  $("file").onchange = async () => {
    const file = $("file").files[0];
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw Error("文件不得超过20MB。");
      const value = JSON.parse(await file.text());
      const next =
        value.format === "projectgreed-task-tree" ? value : M.fromMap(value, EDITOR_DATA.types);
      if (confirm("导入并替换当前草稿？")) load(next);
    } catch (error) {
      tell("导入失败：" + error.message);
      alert(error.message);
    } finally {
      $("file").value = "";
    }
  };
  $("export").onclick = () => {
    try {
      download(
        safeName() + ".task-tree.json",
        JSON.stringify(exportValue(), null, 2),
        "application/json",
      );
      tell("已导出设计JSON。");
    } catch (e) {
      alert(e.message);
    }
  };
  $("ai").onclick = () => {
    try {
      download(safeName() + ".ai-task.txt", aiText(), "text/plain;charset=utf-8");
      tell("已导出AI制作说明，含结构化任务树和全部事件参考。");
    } catch (e) {
      alert(e.message);
    }
  };
  $("preview").onclick = () => {
    const errors = M.validate(doc, EDITOR_DATA.types),
      todo = doc.nodes.filter((n) => !n.description.trim()).length;
    $("validation").textContent = errors.length
      ? "校验失败：\n" + errors.join("\n")
      : `设计结构有效。${todo}个节点尚无补充描述。此校验不代表地图坐标、单位引用或游戏逻辑已经可运行。`;
    $("json").value = JSON.stringify(
      M.bundle(doc, EDITOR_DATA.types, EDITOR_DATA.version),
      null,
      2,
    );
    $("output").showModal();
  };
  $("copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("json").value);
      $("copy").textContent = "已复制";
    } catch {
      $("json").select();
      tell("浏览器限制剪贴板，请按Ctrl+C复制选中的内容。");
    }
  };
  $("close").onclick = () => $("output").close();
  $("undo").onclick = () => {
    if (history.length) {
      future.push(JSON.stringify(doc));
      doc = JSON.parse(history.pop());
      selected = doc.nodes.some((n) => n.id === selected) ? selected : doc.nodes[0]?.id;
      render();
      persist();
    }
  };
  $("redo").onclick = () => {
    if (future.length) {
      history.push(JSON.stringify(doc));
      doc = JSON.parse(future.pop());
      selected = doc.nodes[0]?.id;
      render();
      persist();
    }
  };
  $("zoomIn").onclick = () => {
    scale = Math.min(1.5, scale + 0.1);
    draw();
  };
  $("zoomOut").onclick = () => {
    scale = Math.max(0.4, scale - 0.1);
    draw();
  };
  $("center").onclick = center;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    if (saved && !M.validate(saved, EDITOR_DATA.types).length) doc = saved;
  } catch {
    tell("无法读取草稿，将使用空白任务。");
  }
  selected = doc.nodes[0]?.id || null;
  render();
  // Read-only inspection hook for automated verification and AI-assisted review.
  window.TaskTreeEditor = { snapshot: () => M.clone(doc), exportValue };
})();
