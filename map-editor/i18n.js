/* Display-only localization. Map fields and exported document data stay untouched. */
const MapEditorI18n = (() => {
  const supported = ["zh", "en", "ja"];
  const storageKey = "projectgreed.mapEditor.language";
  let preference = "auto";
  try {
    const saved = localStorage.getItem(storageKey);
    if (["auto", ...supported].includes(saved)) preference = saved;
  } catch {}
  function detect() {
    for (const locale of navigator.languages?.length ? navigator.languages : [navigator.language]) {
      const code = String(locale).toLowerCase().split(/[-_]/)[0];
      if (supported.includes(code)) return code;
    }
    return "en";
  }
  let language = preference === "auto" ? detect() : preference;
  const normalize = (text) => text.trim().replace(/\s+/g, " ");
  const patterns = Object.keys(MAP_EDITOR_LOCALES.en)
    .filter((key) => key.includes("{n}"))
    .map((key) => ({
      key,
      regex: new RegExp(
        "^" +
          key
            .split("{n}")
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("(.*?)") +
          "$",
      ),
    }));
  function text(value) {
    if (language === "zh" || typeof value !== "string") return value;
    const key = normalize(value),
      dictionary = MAP_EDITOR_LOCALES[language];
    if (Object.hasOwn(dictionary, key)) return dictionary[key];
    for (const pattern of patterns) {
      const match = pattern.regex.exec(key);
      if (match) {
        let index = 0;
        return dictionary[pattern.key].replace(/\{n\}/g, () => {
          const value = match[++index];
          // Localize the reason in a line-specific parser error, preserving user data elsewhere.
          return pattern.key === "第{n}行：{n}" && index === 2 ? text(value) : value;
        });
      }
    }
    // Validation can return several independent messages in one dialog.
    return value.includes("\n") ? value.split("\n").map(text).join("\n") : value;
  }
  const bindings = [];
  function bind(element, source) {
    element.textContent = text(source);
    // Only long-lived status/validation nodes use this; dynamic lists refresh explicitly.
    const existing = bindings.find((binding) => binding.element === element);
    if (existing) existing.source = source;
    else bindings.push({ element, source });
  }
  function captureStatic() {
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.parentElement.closest("script, style") && /[\u3400-\u9fff]/.test(node.data))
        nodes.push({ node, source: node.data });
    }
    const attributes = [...document.querySelectorAll("[aria-label], [title]")].flatMap((element) =>
      ["aria-label", "title"]
        .filter((name) => element.hasAttribute(name))
        .map((name) => ({ element, name, source: element.getAttribute(name) })),
    );
    return () => {
      for (const { node, source } of nodes) node.data = text(source);
      for (const { element, name, source } of attributes) element.setAttribute(name, text(source));
      document.documentElement.lang = { zh: "zh-CN", en: "en", ja: "ja" }[language];
    };
  }
  function init(refresh) {
    const applyStatic = captureStatic(),
      select = document.getElementById("editorLanguage");
    select.value = preference;
    function apply() {
      language = preference === "auto" ? detect() : preference;
      applyStatic();
      for (const { element, source } of bindings)
        if (element.isConnected) element.textContent = text(source);
      refresh();
    }
    select.addEventListener("change", () => {
      preference = select.value;
      try {
        localStorage.setItem(storageKey, preference);
      } catch {}
      apply();
    });
    window.addEventListener("languagechange", () => {
      if (preference === "auto") apply();
    });
    apply();
  }
  return { text, bind, init };
})();
