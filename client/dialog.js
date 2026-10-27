/* Shared asynchronous game dialogs. Callers must await a choice before changing data. */
const GameDialog = (() => {
  const dialog = document.createElement("dialog");
  dialog.id = "gameDialog";
  dialog.className = "game-dialog";
  dialog.setAttribute("aria-labelledby", "gameDialogTitle");
  dialog.setAttribute("aria-describedby", "gameDialogMessage");
  document.body.append(dialog);
  const queue = [];
  let active = null;
  const node = (tag, className, text) => {
    const result = document.createElement(tag);
    result.className = className;
    if (text !== undefined) result.textContent = I18n.text(String(text));
    return result;
  };
  function finish(value) {
    if (!active) return;
    const request = active;
    active = null;
    dialog.close();
    if (request.focus?.isConnected && !request.focus.closest("[hidden],[inert]"))
      request.focus.focus({ preventScroll: true });
    request.resolve(value);
    showNext();
  }
  function showNext() {
    if (active || !queue.length) return;
    active = queue.shift();
    const options = active.options;
    const title = node("h3", "", options.title || "提示");
    title.id = "gameDialogTitle";
    const close = node("button", "game-dialog-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", I18n.text("关闭"));
    close.onclick = () => finish(null);
    const header = node("header", "game-dialog-heading");
    header.append(title, close);
    const message = node("p", "game-dialog-message", options.message || "");
    message.id = "gameDialogMessage";
    const form = node("form", "game-dialog-form");
    form.append(header, message);
    if (options.items?.length) {
      const list = node("ul", "game-dialog-list");
      for (const item of options.items) list.append(node("li", "", item));
      form.append(list);
    }
    let input = null;
    if (options.input) {
      const label = node(
        "label",
        "game-dialog-input",
        options.input.label || options.title || "请输入",
      );
      input = node("input", "");
      input.id = "gameDialogInput";
      input.type = "text";
      input.value = options.input.value || "";
      input.placeholder = I18n.text(options.input.placeholder || "");
      if (options.input.maxLength) input.maxLength = options.input.maxLength;
      input.required = !!options.input.required;
      label.append(input);
      form.append(label);
    }
    const actions = node("div", "game-dialog-actions");
    const choices = options.actions || [{ label: "确认", value: true, primary: true }];
    for (const choice of choices) {
      const button = node(
        "button",
        choice.danger ? "danger" : choice.primary ? "primary" : "",
        choice.label,
      );
      button.type = choice.primary ? "submit" : "button";
      if (choice.id) button.id = choice.id;
      if (!choice.primary) button.onclick = () => finish(choice.value);
      actions.append(button);
    }
    const primary = choices.find((choice) => choice.primary);
    form.onsubmit = (event) => {
      event.preventDefault();
      if (primary && form.reportValidity()) finish(input ? input.value : primary.value);
    };
    form.append(actions);
    dialog.replaceChildren(form);
    dialog.showModal();
    // A destructive confirmation starts on Cancel. Text entry starts in the field.
    (input || actions.querySelector("button")).focus();
    input?.select();
  }
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    finish(null);
  });
  for (const type of ["keydown", "keyup"])
    dialog.addEventListener(type, (event) => event.stopPropagation());
  window.addEventListener("page-changing", () => {
    for (const request of queue.splice(0)) request.resolve(null);
    finish(null);
  });
  function choose(options) {
    return new Promise((resolve) => {
      queue.push({ options, resolve, focus: document.activeElement });
      showNext();
    });
  }
  return {
    choose,
    alert: (message, options = {}) => choose({ ...options, message }),
    confirm: async (message, options = {}) =>
      (await choose({
        ...options,
        title: options.title || "确认操作",
        message,
        actions: [
          { label: "取消", value: false },
          {
            label: options.confirmText || "确认",
            value: true,
            primary: true,
            danger: options.danger,
          },
        ],
      })) === true,
    prompt: (message, options = {}) =>
      choose({
        ...options,
        title: options.title || "请输入",
        message,
        input: {
          value: options.value || "",
          placeholder: options.placeholder,
          maxLength: options.maxLength,
          required: options.required,
        },
        actions: [
          { label: "取消", value: null },
          { label: "确认", primary: true },
        ],
      }),
  };
})();
