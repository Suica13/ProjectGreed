/* Shared controls for paged base inventories. */
const BasePageControls = (() => {
  let cancelDrag = null, suppressClickUntil = 0;
  document.addEventListener("click", event => {
    if (performance.now() < suppressClickUntil && event.target.closest("[data-swap-group]")) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  window.addEventListener("page-changing", () => cancelDrag?.());
  function dragSwap(preview, card, { group, id, canDrag, onSwap }) {
    card.dataset.swapGroup = group;
    card.dataset.swapId = id;
    if (!preview) return;
    preview.classList.add("base-swap-handle");
    preview.draggable = false;
    preview.addEventListener("pointerdown", event => {
      if (event.button !== 0 || !event.isPrimary || !canDrag()) return;
      cancelDrag?.();
      const startX = event.clientX, startY = event.clientY, pointerId = event.pointerId;
      let active = false, target = null, ghost = null;
      function cleanup() {
        document.removeEventListener("pointermove", move, true);
        document.removeEventListener("pointerup", up, true);
        document.removeEventListener("pointercancel", cancel, true);
        document.removeEventListener("keydown", keydown, true);
        card.classList.remove("base-swap-source");
        target?.classList.remove("base-swap-target"); ghost?.remove();
        if (active) suppressClickUntil = performance.now() + 600;
        cancelDrag = null;
      }
      function cancel() { cleanup(); }
      function keydown(event) { if (event.key === "Escape") { event.preventDefault(); cancel(); } }
      function move(event) {
        if (event.pointerId !== pointerId) return;
        if (!active && Math.hypot(event.clientX - startX, event.clientY - startY) < 8) return;
        if (!canDrag() || !card.isConnected) return cancel();
        event.preventDefault();
        if (!active) {
          active = true; card.classList.add("base-swap-source");
          ghost = preview.cloneNode(false); ghost.removeAttribute("id");
          ghost.className = "base-swap-ghost"; ghost.draggable = false;
          if (preview instanceof HTMLCanvasElement) ghost.getContext("2d").drawImage(preview, 0, 0);
          document.body.append(ghost);
        }
        ghost.style.left = event.clientX + "px"; ghost.style.top = event.clientY + "px";
        const candidate = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-swap-group]");
        const next = candidate?.dataset.swapGroup === group && candidate.dataset.swapId !== id ? candidate : null;
        if (next !== target) { target?.classList.remove("base-swap-target"); target = next; target?.classList.add("base-swap-target"); }
      }
      function up(event) {
        if (event.pointerId !== pointerId) return;
        const targetId = active && target?.isConnected && canDrag() ? target.dataset.swapId : null;
        cleanup();
        if (targetId !== null) { try { onSwap(targetId); } catch (error) { note(error.message); } }
      }
      cancelDrag = cancel;
      document.addEventListener("pointermove", move, { capture: true, passive: false });
      document.addEventListener("pointerup", up, true);
      document.addEventListener("pointercancel", cancel, true);
      document.addEventListener("keydown", keydown, true);
    });
  }
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
  return { sortMenu, fitPagedCards, dragSwap };
})();
