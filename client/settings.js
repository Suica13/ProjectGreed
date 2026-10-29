/* Local preferences apply immediately; original asset volumes remain the mixing baseline. */
const ClientSettings = (() => {
  const key = "projectgreed.settings";
  const values = { master: 1, music: 1, sfx: 1 };
  let trueUnitNames = false,
    unitShadows = false;
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    for (const name of Object.keys(values))
      if (Number.isFinite(saved?.[name])) values[name] = Math.max(0, Math.min(1, saved[name]));
    trueUnitNames = saved?.trueUnitNames === true;
    unitShadows = saved?.unitShadows === true;
  } catch {}
  const dialog = document.getElementById("clientSettingsDialog");
  const language = document.getElementById("settingsLanguage"),
    trueNames = document.getElementById("settingsTrueUnitNames");
  function persist() {
    try {
      localStorage.setItem(key, JSON.stringify({ ...values, trueUnitNames, unitShadows }));
    } catch {}
  }
  function render() {
    language.value = I18n.language;
    trueNames.checked = trueUnitNames;
    document.getElementById("settingsUnitShadows").checked = unitShadows;
    for (const name of Object.keys(values)) {
      document.getElementById("volume-" + name).value = Math.round(values[name] * 100);
      document.getElementById("volume-" + name + "-value").textContent =
        Math.round(values[name] * 100) + "%";
    }
  }
  function set(name, value) {
    if (!Object.hasOwn(values, name) || !Number.isFinite(value)) return;
    values[name] = Math.max(0, Math.min(1, value));
    persist();
    render();
    window.dispatchEvent(new CustomEvent("audio-settings-change"));
  }
  for (const name of Object.keys(values))
    document
      .getElementById("volume-" + name)
      .addEventListener("input", (event) => set(name, Number(event.target.value) / 100));
  language.addEventListener("change", () => I18n.setLanguage(language.value));
  trueNames.addEventListener("change", () => {
    trueUnitNames = trueNames.checked;
    persist();
    window.dispatchEvent(new CustomEvent("unit-name-display-change"));
  });
  document.getElementById("settingsUnitShadows").addEventListener("change", (event) => {
    unitShadows = event.target.checked;
    persist();
  });
  window.addEventListener("language-change", render);
  document.getElementById("openClientSettings").onclick = () => {
    render();
    dialog.showModal();
  };
  document.getElementById("closeClientSettings").onclick = () => dialog.close();
  const editor = document.createElement("a");
  editor.id = "openMapEditor";
  editor.href = "map-editor.html";
  editor.target = "_blank";
  editor.rel = "noopener";
  editor.textContent = I18n.text("地图编辑器");
  editor.style.cssText = "display:inline-block;margin:12px 0;padding:8px 12px;border:1px solid #627f97;border-radius:3px;color:#a1d9ff";
  document.getElementById("closeClientSettings").before(editor);
  window.addEventListener("language-change", () => { editor.textContent = I18n.text("地图编辑器"); });
  render();
  return {
    volume: (name) => values.master * values[name],
    set,
    values,
    trueUnitNames: () => trueUnitNames,
    unitShadows: () => unitShadows,
  };
})();

/* Replay lifecycle adapter: the record player must call setActive on entry/exit.
   CombatPlayback is live match animation, and must never activate this mode. */
window.ReplayPresentation = (() => {
  let active = false,
    immersive = false;
  const control = document.createElement("label");
  control.className = "settings-toggle";
  control.hidden = true;
  const text = document.createElement("span");
  text.textContent = "沉浸模式";
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.title = "隐藏战斗界面，跳过回合交接；按 Esc 退出";
  control.append(text, toggle);
  document.getElementById("clientSettingsDialog").append(control);
  function setImmersive(value) {
    immersive = active && !!value;
    toggle.checked = immersive;
    document.body.classList.toggle("replay-immersive", immersive);
    if (immersive) {
      for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
      if (typeof TurnFlow !== "undefined") TurnFlow.reset();
    }
  }
  toggle.addEventListener("change", () => setImmersive(toggle.checked));
  window.addEventListener(
    "keydown",
    (event) => {
      if (!immersive) return;
      if (event.key === "Escape") setImmersive(false);
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
  return {
    setActive(value) {
      active = !!value;
      control.hidden = !active;
      if (!active) setImmersive(false);
    },
    setImmersive,
    get active() {
      return active;
    },
    get immersive() {
      return immersive;
    },
  };
})();
