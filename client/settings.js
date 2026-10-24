/* Local preferences apply immediately; original asset volumes remain the mixing baseline. */
const ClientSettings = (() => {
  const key = "projectgreed.settings";
  const values = { master: 1, music: 1, sfx: 1 };
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    for (const name of Object.keys(values))
      if (Number.isFinite(saved?.[name])) values[name] = Math.max(0, Math.min(1, saved[name]));
  } catch {}
  const dialog = document.getElementById("clientSettingsDialog");
  const language = document.getElementById("settingsLanguage");
  function render() {
    language.value = I18n.language;
    for (const name of Object.keys(values)) {
      document.getElementById("volume-" + name).value = Math.round(values[name] * 100);
      document.getElementById("volume-" + name + "-value").textContent =
        Math.round(values[name] * 100) + "%";
    }
  }
  function set(name, value) {
    if (!Object.hasOwn(values, name) || !Number.isFinite(value)) return;
    values[name] = Math.max(0, Math.min(1, value));
    try {
      localStorage.setItem(key, JSON.stringify(values));
    } catch {}
    render();
    window.dispatchEvent(new CustomEvent("audio-settings-change"));
  }
  for (const name of Object.keys(values))
    document
      .getElementById("volume-" + name)
      .addEventListener("input", (event) => set(name, Number(event.target.value) / 100));
  language.addEventListener("change", () => I18n.setLanguage(language.value));
  window.addEventListener("language-change", render);
  document.getElementById("openClientSettings").onclick = () => {
    render();
    dialog.showModal();
  };
  document.getElementById("closeClientSettings").onclick = () => dialog.close();
  render();
  return { volume: (name) => values.master * values[name], set, values };
})();
