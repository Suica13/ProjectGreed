/* Read-only liaison progress; battle objectives belong to the briefing. */
window.BattleTaskList = (() => {
  const access = element("button", "", "任务列表"),
    dialog = element("dialog", "battle-task-list"),
    header = element("header"),
    title = element("h2", "", "任务列表"),
    close = element("button", "", "关闭"),
    body = element("div", "battle-task-body");
  access.id = "battleTaskList";
  access.hidden = true;
  dialog.id = "battleTaskPanel";
  title.id = "battleTaskTitle";
  dialog.setAttribute("aria-labelledby", title.id);
  byId("openMatchRecords").before(access);
  header.append(title, close);
  dialog.append(header, body);
  document.body.append(dialog);
  let snapshot = null;
  function section(label, rows) {
    const group = element("section"),
      heading = element("h3", "", I18n.text(label));
    group.append(heading);
    for (const row of rows) {
      const card = element("article"),
        name = element("strong", "", row.label),
        count = element("span", "battle-task-progress", row.count || ""),
        text = element("p", "", I18n.text(row.text || ""));
      card.append(name, count);
      if (row.conditions) card.append(element("p", "contact-task-conditions", row.conditions));
      card.append(text);
      group.append(card);
    }
    if (!rows.length) group.append(element("p", "muted", I18n.text("暂无任务")));
    body.append(group);
  }
  function render() {
    const scroll = body.scrollTop;
    body.replaceChildren();
    const s = snapshot;
    if (!s?.game) return;
    const entries=(s.contactTaskStatus ?? Economy.snapshot().contactTasks).filter(entry=>entry.status!=="claimed");
    for(const id of ["efsf","zeon","anaheim"]) {
      const grouped=entries.filter(entry=>ContactTasks.contactId(ContactTasks.byId.get(entry.id))===id);
      if(!grouped.length && (entries.length || id!=="efsf"))continue;
      section(
      ContactTasks.contactName(id),
      grouped
        .flatMap((entry) => {
          const task = ContactTasks.byId.get(entry.id);
          if (!task) return [];
          const summary = ContactUI.taskSummary(task, entry.progress);
          return [
            {
              label: I18n.text(task.name),
              conditions: summary.conditions,
              text: summary.objective,
              count: entry.status === "ready" ? I18n.text("可交付") : "",
            },
          ];
        }),
    );
    }
    body.scrollTop = scroll;
  }
  access.onclick = () => {
    render();
    if (!dialog.open) dialog.showModal();
  };
  close.onclick = () => dialog.close();
  window.addEventListener("page-changing", () => dialog.close());
  return {
    receive(s) {
      snapshot = s;
      access.hidden = !s?.started || ["assembly", "waiting"].includes(s.phase);
      if (access.hidden) dialog.close();
      else if (dialog.open) render();
    },
  };
})();
