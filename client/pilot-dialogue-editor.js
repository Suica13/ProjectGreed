/* Dialogue-only drafts; imported files never contain pilot stats or account progress. */
const PilotDialogueEditor = (() => {
  const panel = document.createElement("dialog");
  panel.id = "pilotDialogueEditor";
  panel.setAttribute("aria-labelledby", "pilotDialogueTitle");
  panel.innerHTML = '<header><h3 id="pilotDialogueTitle">互动文本</h3><button type="button" id="cancelPilotDialogue">取消</button></header><p>每个文本框填写一句，留空使用默认台词。每个事件最多10句，每句最多120字。</p><label for="pilotDialogueEvent">互动事件</label><select id="pilotDialogueEvent"></select><label>随机台词</label><div id="pilotDialogueLines"></div><button id="addPilotDialogueLine" type="button" aria-label="增加台词">＋</button><p id="pilotDialogueStatus" role="status"></p><footer><button type="button" id="importPilotDialogue">导入JSON</button><button type="button" id="exportPilotDialogue">导出JSON</button><button type="button" id="savePilotDialogue" class="primary">保存</button></footer><input id="pilotDialogueFile" type="file" accept=".json,application/json" hidden>';
  document.body.append(panel);
  const event = panel.querySelector("select"), lines = byId("pilotDialogueLines"),
    status = panel.querySelector('[role="status"]'), file = panel.querySelector('input[type="file"]');
  let draft, selected, commit, focus, pilotName, generation = 0;
  function flush() {
    const phrases = [...lines.querySelectorAll("input")].map(input => input.value.trim()).filter(Boolean);
    if (phrases.length) draft[selected] = phrases;
    else delete draft[selected];
  }
  function showLines() {
    lines.replaceChildren();
    for (const text of draft[selected]?.length ? draft[selected] : [""]) addLine(text);
  }
  function addLine(text = "") {
    if (lines.children.length >= PilotSystem.dialogueLimits.lines) return;
    const row = document.createElement("div"), input = document.createElement("input"), remove = document.createElement("button");
    input.type = "text";
    input.maxLength = PilotSystem.dialogueLimits.length;
    input.value = text;
    input.setAttribute("aria-label", I18n.text("随机台词") + " " + (lines.children.length + 1));
    remove.type = "button";
    remove.textContent = "−";
    remove.setAttribute("aria-label", I18n.text("删除台词"));
    remove.onclick = () => {
      row.remove();
      if (!lines.children.length) addLine();
      byId("addPilotDialogueLine").disabled = false;
    };
    row.append(input, remove);
    lines.append(row);
    byId("addPilotDialogueLine").disabled = lines.children.length >= PilotSystem.dialogueLimits.lines;
    return input;
  }
  byId("addPilotDialogueLine").onclick = () => addLine()?.focus();
  function close() {
    if (panel.open) panel.close();
  }
  panel.addEventListener("close", () => {
    generation++;
    draft = commit = null;
    file.value = "";
    focus?.focus();
  });
  byId("cancelPilotDialogue").onclick = close;
  event.onchange = () => {
    flush();
    selected = event.value;
    status.textContent = "";
    showLines();
  };
  byId("savePilotDialogue").onclick = () => {
    try {
      flush();
      commit(PilotSystem.normalizeDialogue(draft));
      close();
    } catch (error) { status.textContent = I18n.text(error.message); }
  };
  byId("exportPilotDialogue").onclick = () => {
    try {
      flush();
      const data = PilotSystem.exportDialogue(draft);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "ProjectGreed-" + pilotName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_") + "-dialogue.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = I18n.text("互动文本已导出");
    } catch (error) { status.textContent = I18n.text(error.message); }
  };
  byId("importPilotDialogue").onclick = () => file.click();
  file.onchange = async () => {
    const upload = file.files[0], token = ++generation;
    try {
      if (!upload) return;
      if (upload.size > 65536) throw Error("互动文本文件不能超过64KB");
      const imported = PilotSystem.importDialogue(JSON.parse((await upload.text()).replace(/^\uFEFF/, "")));
      if (!panel.open || token !== generation) return;
      draft = imported;
      showLines();
      status.textContent = I18n.text("已导入互动文本，点击保存后生效");
    } catch (error) {
      if (panel.open && token === generation)
        status.textContent = I18n.text(error instanceof SyntaxError ? "互动文本JSON格式或版本无效" : error.message);
    } finally { file.value = ""; }
  };
  function open(pilot, onSave) {
    if (!pilot?.custom || pilot.ace || pilot.aceId) return;
    if (panel.open) return;
    generation++;
    draft = PilotSystem.normalizeDialogue(pilot.dialogue);
    commit = onSave;
    pilotName = pilot.name;
    focus = document.activeElement;
    event.replaceChildren(...PilotSystem.dialogueEvents.map(([id, label]) => new Option(I18n.text(label), id)));
    selected = event.value;
    status.textContent = "";
    showLines();
    panel.showModal();
    lines.querySelector("input").focus();
  }
  return { open, close };
})();
