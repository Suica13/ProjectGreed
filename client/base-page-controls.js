/* Shared controls for paged base inventories. */
const BasePageControls = (() => {
  function sortMenu(id, choices, apply) {
    const host = byId(id), button = element("button", "", "排序"), menu = element("div", "base-sort-options");
    host.classList.add("base-sort-control");
    button.id = id + "Button";
    button.type = "button";
    button.setAttribute("aria-expanded", "false");
    menu.id = id + "Options";
    menu.hidden = true;
    button.setAttribute("aria-controls", menu.id);
    const close = () => { menu.hidden = true; button.setAttribute("aria-expanded", "false"); };
    button.onclick = () => { menu.hidden = !menu.hidden; button.setAttribute("aria-expanded", String(!menu.hidden)); };
    for (const [key, label] of choices) {
      const option = element("button", "", label);
      option.type = "button";
      option.dataset.sortRule = key;
      option.onclick = () => {
        try {
          if (apply(key) === false) return;
          button.textContent = I18n.text(label);
          close();
          button.focus();
        } catch (error) { note(error.message); }
      };
      menu.append(option);
    }
    document.addEventListener("click", event => { if (!host.contains(event.target)) close(); });
    host.addEventListener("keydown", event => { if (event.key === "Escape") { close(); button.focus(); } });
    window.addEventListener("page-changing", close);
    host.append(button, menu);
  }
  function fitPagedCards(list) {
    if (!list.clientHeight || list.closest("[hidden]")) return;
    const style = getComputedStyle(list), columns = style.gridTemplateColumns.split(" ").length;
    const rows = Math.ceil((Number(list.dataset.pageSize)||8) / columns), gapX = parseFloat(style.columnGap) || 0, gapY = parseFloat(style.rowGap) || 0;
    const width = (list.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - gapX * (columns - 1)) / columns;
    const height = (list.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - gapY * (rows - 1)) / rows;
    const scale = Math.max(.1, Math.floor(Math.min(1, width / 180, height / 224) * 1000) / 1000);
    if (list.style.getPropertyValue("--dorm-card-scale") !== String(scale)) list.style.setProperty("--dorm-card-scale", scale);
  }
  return { sortMenu, fitPagedCards };
})();
