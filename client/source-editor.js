/* Included only in developer.html. Both versions continue to use the same game logic. */
(() => {
  "use strict";
  const make = (tag, text = "") => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  };
  function button(text, action, id) {
    const node = make("button", text);
    node.type = "button";
    node.onclick = action;
    if (id) node.id = id;
    return node;
  }
  let token;
  async function api(resource, body) {
    if (location.protocol !== "http:")
      throw Error(
        "请先启动项目服务器，通过 http://127.0.0.1:1313/developer.html 使用保存和重载功能。",
      );
    if (!token) {
      const response = await fetch("/api/developer/session");
      const session = await response.json();
      if (!response.ok) throw Error(session.error || "开发会话失败");
      token = session.token;
    }
    const response = await fetch("/api/developer/" + resource, {
      method: body === undefined ? "GET" : "POST",
      headers: { "X-Developer-Token": token, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 403) token = null;
      throw Error(result.error || "开发操作失败");
    }
    return result;
  }
  const labels = {
    name: "名称",
    code: "型号",
    stats: "单位属性",
    weapons: "武器性能",
    weaponKits: "武器套件",
    hp: "HP",
    en: "EN",
    move: "移动力",
    mobility: "机动",
    cost: "COST",
    accuracy: "命中",
    actionPoints: "行动点",
    counterLimit: "反击次数",
    sensors: "探测",
    sight: "视野",
    radar: "雷达",
    antiDetection: "反侦测",
    adaptability: "地形适应性",
    ground: "地面",
    space: "宇宙",
    water: "水中",
    air: "空中",
    forest: "森林",
    snow: "雪地",
    desert: "沙漠",
    rubble: "废墟",
    mountain: "山地",
    damage: "伤害",
    hit: "命中",
    min: "最小射程",
    max: "最大射程",
    actionCost: "行动消耗",
    steps: "攻击步骤",
    shots: "发数",
    burst: "连发数",
    description: "说明",
    points: "科技点",
    icon: "图标路径",
    row: "分支",
    column: "层数",
    requires: "前置科技 ID（逗号分隔）",
  };
  function field(parent, key, value, change, options) {
    const label = make("label");
    label.append(make("span", labels[key] || key));
    const input = make(
      options ? "select" : typeof value === "string" && value.length > 80 ? "textarea" : "input",
    );
    if (options) {
      for (const [id, title] of options) {
        const option = make("option", title);
        option.value = id;
        input.append(option);
      }
      input.value = value;
    } else if (typeof value === "boolean") {
      input.type = "checkbox";
      input.checked = value;
    } else if (typeof value === "number") {
      input.type = "number";
      input.step = "any";
      input.value = value;
    } else {
      input.value = value ?? "无";
      input.disabled = value === null;
    }
    input.setAttribute("aria-label", labels[key] || key);
    input.oninput = () =>
      change(
        typeof value === "boolean"
          ? input.checked
          : typeof value === "number"
            ? Number(input.value)
            : input.value,
      );
    label.append(input);
    parent.append(label);
    return input;
  }
  // Read and edit source fields, including Step payloads, rather than compiled weapon totals.
  function fields(parent, object, prefix = "") {
    for (const key of Object.keys(object)) {
      const value = object[key];
      if (value !== null && typeof value === "object") {
        const group = make("details");
        group.open = key === "stats";
        group.append(
          make("summary", (labels[key] || key) + (value.name ? " · " + value.name : "")),
        );
        fields(group, value, prefix + key + ".");
        parent.append(group);
      } else {
        const input = field(parent, key, value, (next) => {
          object[key] = next;
        });
        input.dataset.sourceField = prefix + key;
      }
    }
  }
  function message() {
    const node = make("p");
    node.className = "source-status";
    node.setAttribute("role", "status");
    node.setAttribute("data-i18n-ignore", "");
    return node;
  }
  let unitId,
    unitDraft = null,
    unitRevision,
    editingUnitId;
  const unitPanel = make("div");
  unitPanel.id = "developerUnitFields";
  unitPanel.className = "source-editor";
  unitPanel.hidden = true;
  const unitStatus = message();
  const unitEdit = button(
    "修改属性",
    async () => {
      if (!unitId) return;
      unitEdit.disabled = true;
      try {
        if (unitDraft) {
          await api("unit", { id: editingUnitId, revision: unitRevision, data: unitDraft });
          cancelUnit();
          unitStatus.textContent = "已覆盖对应单位 JSON。到设置中点击重载后使用新属性。";
        } else {
          const result = await api("unit?id=" + encodeURIComponent(unitId));
          editingUnitId = unitId;
          unitDraft = result.data;
          unitRevision = result.revision;
          unitPanel.replaceChildren(
            make("h3", "编辑单位 · " + unitDraft.name + "（" + editingUnitId + "）"),
          );
          fields(unitPanel, unitDraft);
          unitPanel.append(button("取消编辑", cancelUnit));
          unitPanel.hidden = false;
          unitEdit.textContent = "保存属性";
          unitStatus.textContent =
            "编辑单位属性、武器性能和套件。Step 中的单发伤害及发数共同决定实际伤害。";
        }
      } catch (error) {
        unitStatus.textContent = error.message;
      } finally {
        unitEdit.disabled = false;
      }
    },
    "developerUnitEdit",
  );
  function cancelUnit() {
    unitDraft = null;
    unitPanel.hidden = true;
    unitEdit.textContent = "修改属性";
    unitStatus.textContent = "";
  }
  const unitDialog = document.querySelector("#formationUnitDetail .formation-detail-dialog");
  const unitToolbar = make("div");
  unitToolbar.className = "source-toolbar";
  unitToolbar.append(unitEdit, unitStatus);
  unitDialog.querySelector("header").after(unitToolbar, unitPanel);
  window.addEventListener("unit-preview", (event) => {
    unitId = event.detail.id;
    if (unitDraft && editingUnitId !== unitId)
      unitStatus.textContent =
        "仍在编辑 " + unitDraft.name + "（" + editingUnitId + "），请保存或取消。";
  });

  let treeDraft = null,
    treeRevision,
    selectedNodeId;
  const treeHost = document.getElementById("developmentMain");
  const treePanel = make("div");
  treePanel.id = "developerTreeFields";
  treePanel.className = "source-editor";
  treePanel.hidden = true;
  const treeStatus = message();
  const treeEdit = button(
    "修改属性",
    async () => {
      treeEdit.disabled = true;
      try {
        if (treeDraft) {
          await api("tree", { revision: treeRevision, data: treeDraft });
          cancelTree();
          treeStatus.textContent = "科技树已保存。到设置中点击重载后使用新数据。";
        } else {
          const result = await api("tree");
          treeDraft = result.data;
          treeRevision = result.revision;
          selectedNodeId = null;
          treeEdit.textContent = "保存属性";
          treePanel.hidden = false;
          treeHost.classList.add("source-editing");
          treeStatus.textContent = "修改文本、点数、解锁单位、图标及前置关系，也可追加和删除科技。";
          renderTree();
        }
      } catch (error) {
        treeStatus.textContent = error.message;
      } finally {
        treeEdit.disabled = false;
      }
    },
    "developerTreeEdit",
  );
  function cancelTree() {
    treeDraft = null;
    treePanel.hidden = true;
    treeHost.classList.remove("source-editing");
    treeEdit.textContent = "修改属性";
    treeStatus.textContent = "";
  }
  function renderTree() {
    if (!treeDraft) return;
    treePanel.replaceChildren();
    const faction = document.getElementById("developmentFactionSelect").value;
    const nodes = treeDraft[faction];
    const node = nodes.find((item) => item.id === selectedNodeId) || nodes[0];
    selectedNodeId = node.id;
    const select = field(
      treePanel,
      "科技节点",
      node.id,
      (id) => {
        selectedNodeId = id;
        renderTree();
      },
      nodes.map((item) => [item.id, item.name + " · " + item.id]),
    );
    select.id = "developerTechSelect";
    const actions = make("div");
    actions.className = "source-toolbar";
    actions.append(
      button(
        "追加科技",
        () => {
          const id = "Tech_" + faction + "_Custom_" + Date.now();
          nodes.push({
            id,
            name: "新科技",
            description: "",
            points: 0,
            icon: nodes[0].icon,
            row: "mid",
            column: Math.max(...nodes.map((item) => item.column)) + 1,
            requires: [],
            unlocks: [],
          });
          selectedNodeId = id;
          renderTree();
        },
        "developerTechAdd",
      ),
    );
    const remove = button(
      "删除科技",
      () => {
        treeDraft[faction] = nodes.filter((other) => other !== node);
        for (const other of treeDraft[faction])
          other.requires = other.requires.filter((id) => id !== node.id);
        selectedNodeId = null;
        renderTree();
      },
      "developerTechDelete",
    );
    remove.disabled = node.id === "Tech_" + faction + "_0079_BaseTech";
    actions.append(remove, button("取消编辑", cancelTree));
    treePanel.append(actions);
    const idField = field(treePanel, "科技 ID", node.id, (value) => {
      const oldId = node.id;
      node.id = value;
      selectedNodeId = value;
      for (const other of nodes)
        other.requires = other.requires.map((id) => (id === oldId ? value : id));
      select.selectedOptions[0].value = value;
    });
    idField.disabled = remove.disabled;
    for (const key of ["name", "description", "points", "column", "icon"])
      field(treePanel, key, node[key], (value) => {
        node[key] = value;
      });
    field(
      treePanel,
      "row",
      node.row,
      (value) => {
        node.row = value;
      },
      [
        ["top", "左分支"],
        ["mid", "中分支"],
        ["bot", "右分支"],
      ],
    );
    const requires = field(treePanel, "requires", node.requires.join(","), (value) => {
      node.requires = value
        .split(/[,，]/)
        .map((id) => id.trim())
        .filter(Boolean);
    });
    requires.disabled = remove.disabled;
    const unlockLabel = make("label", "解锁单位（按 Ctrl 多选）");
    const unlocks = make("select");
    unlocks.multiple = true;
    unlocks.setAttribute("aria-label", "解锁单位");
    const choices = new Map(
      Rules.catalog.prefabs.map((unit) => [unit.id, unit.code + " " + unit.name]),
    );
    for (const id of node.unlocks) if (!choices.has(id)) choices.set(id, id + "（尚未接入）");
    for (const [id, name] of choices) {
      const option = make("option", name);
      option.value = id;
      option.selected = node.unlocks.includes(id);
      unlocks.append(option);
    }
    unlocks.onchange = () => {
      node.unlocks = Array.from(unlocks.selectedOptions, (option) => option.value);
    };
    unlockLabel.append(unlocks);
    treePanel.append(unlockLabel);
    const uploadLabel = make("label", "上传 PNG 图标（500KB以内）");
    const upload = make("input");
    upload.type = "file";
    upload.accept = "image/png";
    upload.setAttribute("aria-label", "上传科技图标");
    const preview = make("img");
    preview.alt = "科技图标预览";
    const currentIcon = DEVELOPMENT_TREE[faction].find((item) => item.id === node.id)?.icon;
    if (currentIcon) preview.src = currentIcon;
    upload.onchange = async () => {
      if (!upload.files[0]) return;
      upload.disabled = true;
      treeEdit.disabled = true;
      try {
        const png = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(upload.files[0]);
        });
        node.icon = (await api("icon", { png })).icon;
        treePanel.querySelector('[aria-label="图标路径"]').value = node.icon;
        preview.src = png;
        treeStatus.textContent = "图标已导入，请保存科技树。";
      } catch (error) {
        treeStatus.textContent = error.message;
      } finally {
        upload.disabled = false;
        treeEdit.disabled = false;
      }
    };
    uploadLabel.append(upload, preview);
    treePanel.append(uploadLabel);
  }
  document.getElementById("developmentFactionSelect").addEventListener("change", renderTree);
  const treeToolbar = make("div");
  treeToolbar.className = "source-toolbar";
  treeToolbar.append(treeEdit, treeStatus);
  treeHost.querySelector("header").after(treeToolbar, treePanel);

  const reloadStatus = message();
  const reload = button(
    "重载",
    async () => {
      reload.disabled = true;
      reloadStatus.textContent = "正在校验并重新构建单位与科技树…";
      try {
        if (unitDraft || treeDraft) throw Error("请先保存或取消当前属性编辑");
        if (Net.active || window.ReplayPlayer?.active || pageView === "game")
          throw Error("请先返回主菜单并退出房间，再重载属性");
        await api("reload", {});
        location.reload();
      } catch (error) {
        reloadStatus.textContent = error.message;
      } finally {
        reload.disabled = false;
      }
    },
    "developerReload",
  );
  document.getElementById("clientSettingsDialog").append(reload, reloadStatus);
  window.addEventListener("beforeunload", (event) => {
    if (unitDraft || treeDraft) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
})();
