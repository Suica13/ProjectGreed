/* 显示文字本地化。单位和武器 ID、战斗结果始终保持原值。 */
const I18n = (() => {
  const supported = ["zh", "ja", "en"],
    storageKey = "projectgreed.language";
  function detect(languages) {
    for (const value of languages || []) {
      const language = String(value).toLowerCase().split(/[-_]/)[0];
      if (supported.includes(language)) return language;
    }
    return "en";
  }
  let language = detect(navigator.languages?.length ? navigator.languages : [navigator.language]);
  try {
    const saved = localStorage.getItem(storageKey);
    if (supported.includes(saved)) language = saved;
  } catch {}
  const textSources = new WeakMap(),
    attributeSources = new WeakMap(),
    cache = new Map();
  const escape = (value) => value.replace(/[.$*+?^{}()|[\]\\]/g, "\\$&");
  const patterns = Object.keys(UI_LOCALES.en)
    .filter((key) => key.includes("{"))
    .sort((a, b) => b.replace(/\{\w+\}/g, "").length - a.replace(/\{\w+\}/g, "").length)
    .map((key) => {
      const names = [];
      const source = key
        .split(/(\{\w+\})/)
        .map((part) => {
          if (!/^\{\w+\}$/.test(part)) return escape(part);
          names.push(part.slice(1, -1));
          return "(.+?)";
        })
        .join("");
      return { key, names, regex: new RegExp("^" + source + "$") };
    });
  const fragments = Object.keys(UI_LOCALES.en)
    .filter((key) => !key.includes("{"))
    .sort((a, b) => b.length - a.length);
  let fragmentRegex = new RegExp(fragments.map(escape).join("|"), "g");
  function text(value) {
    if (
      typeof value !== "string" ||
      language === "zh" ||
      (!/[\u3400-\u9fff]/.test(value) && !Object.hasOwn(UI_LOCALES.en, value.trim()))
    )
      return value;
    const key = value.trim().replace(/\s+/g, " ");
    if (cache.has(key)) return cache.get(key);
    const dictionary = UI_LOCALES[language] || UI_LOCALES.en;
    let translated = dictionary[key] ?? UI_LOCALES.en[key];
    if (translated === undefined) {
      for (const pattern of patterns) {
        const match = pattern.regex.exec(key);
        if (!match) continue;
        const values = Object.fromEntries(
          pattern.names.map((name, index) => [name, text(match[index + 1])]),
        );
        translated = (dictionary[pattern.key] || UI_LOCALES.en[pattern.key]).replace(
          /\{(\w+)\}/g,
          (_, name) => values[name],
        );
        break;
      }
    }
    translated ??= key.replace(fragmentRegex, (key) => dictionary[key] ?? UI_LOCALES.en[key]);
    if (cache.size > 4096) cache.clear();
    cache.set(key, translated);
    return translated;
  }
  function localized(record, field = "name") {
    if (language === "zh") return record.localization?.zh?.[field] ?? record[field] ?? "";
    return (
      record.localization?.[language]?.[field] ??
      UI_LOCALES[language]?.[record[field]] ??
      record.localization?.en?.[field] ??
      record[field] ??
      ""
    );
  }
  function pilotName(pilot) {
    const profile = typeof PilotSystem !== "undefined" ? PilotSystem.aceProfile(pilot) : null;
    return profile ? localized(profile) : pilot?.custom ? pilot.name : text(pilot?.name || "");
  }
  function bind(record, field = "name", localization = record.localization) {
    const original = record[field],
      key = field === "kitName" ? "name" : field;
    if (["标准套件", "复合发射器套件"].includes(original)) localization = undefined;
    if (typeof original === "string" && localization) {
      for (const locale of ["en", "ja"])
        if (localization[locale]?.[key]) UI_LOCALES[locale][original] = localization[locale][key];
    }
    Object.defineProperty(record, field, {
      enumerable: true,
      configurable: true,
      get() {
        return localization?.[language]?.[key] ?? localization?.en?.[key] ?? text(original);
      },
    });
  }
  function bindCatalog(catalog) {
    for (const map of Object.values(catalog.maps || {})) {
      bind(map);
      bind(map, "description");
    }
    for (const prefab of catalog.prefabs) {
      bind(prefab);
      bind(prefab, "description");
      for (const kit of prefab.weaponKits) bind(kit);
      for (const weapon of Object.values(prefab.weapons)) bind(weapon);
      for (const skill of prefab.skills || []) {
        bind(skill);
        bind(skill, "description");
      }
    }
    for (const model of Object.values(catalog.models)) {
      bind(model);
      bind(model, "description");
      bind(model, "kitName", model.kitLocalization);
      for (const weapon of model.weapons) bind(weapon);
      for (const skill of model.skills || []) {
        bind(skill);
        bind(skill, "description");
      }
    }
    rebuildFragments();
    cache.clear();
  }
  function rebuildFragments() {
    fragmentRegex = new RegExp(
      Object.keys(UI_LOCALES.en)
        .filter((key) => !key.includes("{"))
        .sort((a, b) => b.length - a.length)
        .map(escape)
        .join("|"),
      "g",
    );
  }
  const ignored = (element) =>
    element?.closest('script,style,[contenteditable="true"],[data-i18n-ignore]');
  function translateNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (ignored(node.parentElement) || node.parentElement?.closest("input,textarea")) return;
      let source = textSources.get(node);
      if (!source || node.nodeValue !== source.rendered) source = { original: node.nodeValue };
      source.rendered = text(source.original);
      textSources.set(node, source);
      if (node.nodeValue !== source.rendered) node.nodeValue = source.rendered;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || ignored(node)) return;
    for (const key of ["title", "aria-label", "placeholder"]) {
      if (!node.hasAttribute(key)) continue;
      const entries = attributeSources.get(node) || {};
      let source = entries[key];
      if (!source || node.getAttribute(key) !== source.rendered)
        source = { original: node.getAttribute(key) };
      source.rendered = text(source.original);
      entries[key] = source;
      attributeSources.set(node, entries);
      if (node.getAttribute(key) !== source.rendered) node.setAttribute(key, source.rendered);
    }
    // Translate form hints, never player-entered values or textarea contents.
    if (["INPUT", "TEXTAREA"].includes(node.tagName)) return;
    for (const child of node.childNodes) translateNode(child);
  }
  let observer;
  const observe = () =>
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-label", "title", "placeholder"],
    });
  function refresh() {
    observer?.disconnect();
    translateNode(document.body);
    document.documentElement.lang = language === "zh" ? "zh-CN" : language;
    for (const button of document.querySelectorAll("[data-language]")) {
      const selected = button.dataset.language === language;
      button.setAttribute("aria-pressed", String(selected));
      button.classList.toggle("active", selected);
    }
    if (observer) observe();
  }
  function setLanguage(value) {
    if (!supported.includes(value)) return;
    language = value;
    cache.clear();
    try {
      localStorage.setItem(storageKey, language);
    } catch {}
    window.dispatchEvent(new CustomEvent("language-change", { detail: language }));
    refresh();
  }
  function start() {
    observer = new MutationObserver((records) => {
      observer.disconnect();
      for (const record of records) {
        if (record.type === "childList") for (const node of record.addedNodes) translateNode(node);
        else translateNode(record.target);
      }
      observe();
    });
    for (const button of document.querySelectorAll("[data-language]"))
      button.onclick = () => setLanguage(button.dataset.language);
    refresh();
  }
  return {
    detect,
    text,
    localized,
    pilotName,
    bindCatalog,
    start,
    setLanguage,
    refresh,
    get language() {
      return language;
    },
  };
})();
