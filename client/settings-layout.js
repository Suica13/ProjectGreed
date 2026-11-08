/* Move existing controls into explicit sections without replacing their event handlers. */
window.ClientSettingsLayout = (() => {
  const dialog = byId("clientSettingsDialog"),
    heading = dialog.querySelector(".settings-heading");
  const tabs = element("nav", "settings-tabs"),
    body = element("div", "settings-pages"),
    sections = new Map();
  tabs.setAttribute("aria-label", "设置分类");
  const names = { general: "显示", audio: "声音", storage: "存档", records: "记录", tools: "工具" };
  function select(id) {
    for (const [key, section] of sections) {
      section.hidden = key !== id;
      tabs
        .querySelector('[data-settings-tab="' + key + '"]')
        .setAttribute("aria-selected", String(key === id));
    }
  }
  for (const [id, name] of Object.entries(names)) {
    const button = element("button", "", name),
      section = element("section", "settings-page");
    button.type = "button";
    button.dataset.settingsTab = id;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", "settings-page-" + id);
    button.onclick = () => select(id);
    tabs.append(button);
    section.id = "settings-page-" + id;
    section.setAttribute("role", "tabpanel");
    section.append(element("h3", "", name));
    body.append(section);
    sections.set(id, section);
  }
  function row(id, target) {
    const input = byId(id);
    if (!input) return;
    const label = dialog.querySelector('label[for="' + id + '"]');
    if (label) {
      const row = element("div", "settings-field");
      row.append(label, input);
      target.append(row);
    } else {
      const label = input.closest("label");
      if (label) target.append(label);
    }
  }
  const general = sections.get("general");
  row("settingsLanguage", general);
  row("settingsUnitShadows", general);
  row("settingsHidePilotDialogue", general);
  for (const name of ["master", "music", "sfx"]) row("volume-" + name, sections.get("audio"));
  const storage = sections.get("storage"),
    profile = dialog.querySelector(".profile-save-controls");
  if (profile) storage.append(profile);
  const records = dialog.querySelector(".local-record-settings");
  if (records) {
    records.querySelector("legend")?.remove();
    sections.get("records").append(records);
  }
  const editor = byId("openMapEditor");
  if (editor) sections.get("tools").append(editor);
  for (const child of [...dialog.children])
    if (child !== heading && child !== tabs && child !== body) general.append(child);
  dialog.replaceChildren(heading, tabs, body);
  dialog.classList.add("settings-redesigned");
  function refreshNative() {
    if (!window.AppRuntime?.native) return;
    const button = byId("exportProfileSave");
    if (button) {
      button.id = "openNativeSaveFolder";
      button.textContent = "打开存档文件夹";
      button.onclick = () =>
        Promise.resolve(AppRuntime.openSaveFolder()).catch((e) => note(e.message));
    }
    byId("importProfileSave").textContent = "导入存档";
    const hint = byId("profileSaveStatus");
    if (hint && !Economy.storageIssue())
      hint.textContent =
        "存档自动保存在本地文件夹。可打开文件夹备份 profile.json，或导入原生／跨平台 JSON 存档。";
    if (AppRuntime.saveDirectory) {
      const path = element("p", "settings-save-path", AppRuntime.saveDirectory);
      path.setAttribute("data-i18n-ignore", "");
      storage.prepend(path);
    }
  }
  refreshNative();
  select("general");
  return { select, refreshNative };
})();
