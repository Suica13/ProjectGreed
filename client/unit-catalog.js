/* Shared formation/production catalog order and search semantics. */
const UnitCatalog = (() => {
  function select(query, filters, allows, includeForms = false) {
    query = query.trim().toLocaleLowerCase();
    const [kind, value] = (filters.type || "").split(":", 2);
    const matches = (values, predicate) => !values?.length || values.some(predicate);
    const compareNames = new Intl.Collator(I18n.language, { numeric: true, sensitivity: "base" })
      .compare;
    const availability = new Map();
    const available = (prefab) => {
      if (!availability.has(prefab.id)) availability.set(prefab.id, allows(prefab));
      return availability.get(prefab.id);
    };
    return Rules.catalog.prefabs
      .filter(
        (p) =>
          (includeForms || !p.formOnly) &&
          (!query ||
            [p.id, p.name, p.code, ...Object.values(p.localization || {}).map((l) => l.name)]
              .join(" ")
              .toLocaleLowerCase()
              .includes(query)) &&
          (!filters.faction || (p.availableFactions || [p.faction]).includes(filters.faction)) &&
          (!filters.era || p.tags.includes(filters.era)) &&
          matches(filters.types, (tag) => (p.unitTags || []).includes(tag)) &&
          matches(
            filters.environments,
            (environment) => (p.stats.adaptability?.[environment] ?? 0) >= 90,
          ) &&
          matches(filters.roles, (role) => (p.combatRole || "normal") === role) &&
          (!filters.type ||
            (kind === "type" && (p.unitTags || []).includes(value)) ||
            (kind === "environment" && (p.stats.adaptability?.[value] ?? 0) >= 90)),
      )
      .sort(
        (a, b) =>
          Number(available(b)) - Number(available(a)) ||
          a.faction.localeCompare(b.faction, "en") ||
          compareNames(a.name, b.name) ||
          a.id.localeCompare(b.id, "en"),
      );
  }
  const widgets = new WeakMap();
  function checkboxFilters(source, filters, changed) {
    if (widgets.has(source)) {
      const widget = widgets.get(source);
      widget.refresh();
      return widget;
    }
    const button = element("button", "catalog-filter-button"),
      panel = element("div", "catalog-filter-panel"),
      host = element("div", "catalog-filter-control");
    button.type = "button";
    button.id = source.id + "Checks";
    button.setAttribute("aria-expanded", "false");
    panel.id = source.id + "CheckPanel";
    panel.hidden = true;
    button.setAttribute("aria-controls", panel.id);
    const parent = source.parentElement;
    if (parent.tagName === "LABEL") {
      parent.replaceWith(host);
      host.append(source, button);
    } else {
      source.after(host);
      host.append(button);
    }
    document.body.append(panel);
    let enabled = true;
    function close() {
      panel.hidden = true;
      button.setAttribute("aria-expanded", "false");
    }
    function summary() {
      const count = ["types", "environments", "roles"].reduce(
        (n, key) => n + (filters[key]?.length || 0),
        0,
      );
      button.replaceChildren(
        element("span","catalog-filter-title","类型／环境／属性"),
        element("span","catalog-filter-short","筛选"),
        element("span","",count ? " ("+count+")" : ""),
      );
    }
    function refresh() {
      summary();
      panel.replaceChildren();
      const clear = element("button", "catalog-filter-clear", "清除筛选");
      clear.type = "button";
      clear.onclick = () => {
        clearFilters();
        changed();
      };
      panel.append(clear);
      const groups = [
        [
          "types",
          "单位类型",
          [
            ...new Set(
              Rules.catalog.prefabs.filter((p) => !p.formOnly).flatMap((p) => p.unitTags || []),
            ),
          ]
            .sort()
            .map((tag) => [tag, Rules.unitTagName(tag)]),
        ],
        [
          "environments",
          "环境筛选",
          [
            ["ground", "地面"],
            ["space", "宇宙"],
          ],
        ],
        [
          "roles",
          "属性筛选",
          [
            ["raid", "突击"],
            ["general", "泛用"],
            ["support", "支援"],
            ["normal", "一般"],
          ],
        ],
      ];
      for (const [key, title, choices] of groups) {
        const group = element("fieldset"),
          options = element("div", "catalog-filter-options");
        group.append(element("legend", "", title), options);
        for (const [value, name] of choices) {
          const label = element("label"),
            input = element("input");
          input.type = "checkbox";
          input.value = value;
          input.dataset.filterGroup = key;
          input.checked = filters[key]?.includes(value) || false;
          input.onchange = () => {
            filters.type = "";
            filters[key] = input.checked
              ? [...new Set([...(filters[key] || []), value])]
              : (filters[key] || []).filter((v) => v !== value);
            summary();
            changed();
          };
          label.append(input, element("span", "", name));
          options.append(label);
        }
        panel.append(group);
      }
    }
    function clearFilters() {
      filters.type = "";
      for (const key of ["types", "environments", "roles"]) filters[key] = [];
      refresh();
    }
    button.onclick = () => {
      if (!panel.hidden) return close();
      refresh();
      panel.hidden = false;
      button.setAttribute("aria-expanded", "true");
      const box = button.getBoundingClientRect(),
        width = Math.min(390, innerWidth - 24),
        height = Math.min(460, innerHeight - 24);
      panel.style.width = width + "px";
      panel.style.maxHeight = height + "px";
      panel.style.left = Math.max(12, Math.min(box.left, innerWidth - width - 12)) + "px";
      panel.style.top =
        Math.max(12, Math.min(box.bottom + 6, innerHeight - panel.offsetHeight - 12)) + "px";
    };
    document.addEventListener("pointerdown", (event) => {
      if (!panel.contains(event.target) && !button.contains(event.target)) close();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !panel.hidden) {
        event.preventDefault();
        close();
        button.focus();
      }
    });
    window.addEventListener("page-changing", close);
    window.addEventListener("resize", close);
    const widget = {
      refresh,
      clear: clearFilters,
      setEnabled(value) {
        enabled = value;
        host.hidden = !enabled;
        source.classList.toggle("catalog-filter-source", enabled);
        if (enabled) source.hidden = true;
        else close();
      },
    };
    widgets.set(source, widget);
    widget.setEnabled(true);
    refresh();
    return widget;
  }
  // Formation and encyclopedia share labels, groups, and available type filters.
  function populateTypeFilter(select, value = "") {
    const unitTypes = [
      ...new Set(
        Rules.catalog.prefabs
          .filter((prefab) => !prefab.formOnly)
          .flatMap((prefab) => prefab.unitTags || []),
      ),
    ].sort();
    const types = document.createElement("optgroup");
    types.label = I18n.text("\u5355\u4f4d\u7c7b\u578b");
    for (const tag of unitTypes)
      types.append(new Option(I18n.text(Rules.unitTagName(tag)), "type:" + tag));
    const environments = document.createElement("optgroup");
    environments.label = I18n.text("\u73af\u5883\u7b5b\u9009");
    for (const environment of ["ground", "space"])
      environments.append(
        new Option(
          I18n.text(environment === "ground" ? "\u5730\u9762" : "\u5b87\u5b99"),
          "environment:" + environment,
        ),
      );
    select.replaceChildren(new Option(I18n.text("\u4e0d\u9650"), ""), types, environments);
    if ([...select.options].some((option) => option.value === value)) select.value = value;
  }
  // Developed units first, then ascending minimum kit COST in both catalogs.
  function compareDevelopedCost(
    faction = PlayerProfile.faction(),
    allows = (prefab) => Development.allows(faction, prefab.id),
  ) {
    // Each sort gets its own cache so later research and editor changes stay fresh.
    const compareNames = new Intl.Collator(I18n.language, { numeric: true, sensitivity: "base" })
      .compare;
    const costs = new Map(),
      unlocked = new Map();
    const minimumCost = (prefab) => {
      if (!costs.has(prefab.id))
        costs.set(
          prefab.id,
          Math.min(...prefab.weaponKits.map((kit) => prefab.stats.cost + kit.cost)),
        );
      return costs.get(prefab.id);
    };
    const developed = (prefab) => {
      if (!unlocked.has(prefab.id)) unlocked.set(prefab.id, allows(prefab));
      return unlocked.get(prefab.id);
    };
    return (a, b) =>
      Number(developed(b)) - Number(developed(a)) ||
      minimumCost(a) - minimumCost(b) ||
      compareNames(a.name, b.name) ||
      a.id.localeCompare(b.id, "en");
  }
  return { select, compareDevelopedCost, populateTypeFilter, checkboxFilters };
})();
