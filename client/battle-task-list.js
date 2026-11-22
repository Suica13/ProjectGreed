/* Read-only overlay: keep the battlefield active while inspecting objectives and commissions. */
window.BattleTaskList = (() => {
  const access = element("button", "", "任务列表"),
    dialog = element("dialog", "battle-task-list"),
    header = element("header"), title = element("h2", "", "任务列表"),
    close = element("button", "", "关闭"), body = element("div", "battle-task-body");
  access.id = "battleTaskList";
  access.hidden = true;
  dialog.id = "battleTaskPanel";
  title.id = "battleTaskTitle";
  dialog.setAttribute("aria-labelledby", title.id);
  byId("openMatchRecords").before(access);
  header.append(title, close);dialog.append(header, body);document.body.append(dialog);
  let snapshot = null;
  function section(label, rows) {
    const group = element("section"), heading = element("h3", "", I18n.text(label));
    group.append(heading);
    for (const row of rows) {
      const card = element("article"), name = element("strong", "", row.label),
        count = element("span", "battle-task-progress", row.count || ""),
        text = element("p", "", I18n.text(row.text || ""));
      card.append(name,count,text);group.append(card);
    }
    if (!rows.length) group.append(element("p", "muted", I18n.text("暂无任务")));
    body.append(group);
  }
  function render() {
    body.replaceChildren();
    const s = snapshot;
    if (!s?.game) return;
    const scenario = s.contract || s.game.mission;
    if (scenario) {
      const goals = BriefingUI.goals(s);
      section("胜利条件", goals.filter(row => row.kind === "victory"));
      if (s.game.mission) section("失败条件", goals.filter(row => row.kind === "failure"));
      else section("撤离", goals.filter(row => row.kind === "extraction"));
    } else section("胜利条件", [{label:I18n.text(s.game.campaignBattlefield ? "摧毁敌方HQ" : "消灭所有敌人")}]);
    section("已接取的任务", Economy.snapshot().contactTasks.filter(entry => entry.status !== "claimed").flatMap(entry => {
      const task = ContactTasks.byId.get(entry.id);
      return task ? [{label:I18n.text(task.name),text:task.objective,
        count:entry.progress+" / "+task.required+(entry.status === "ready" ? " · "+I18n.text("可交付") : "")}] : [];
    }));
  }
  access.onclick = () => { render();if (!dialog.open) dialog.showModal(); };
  close.onclick = () => dialog.close();
  window.addEventListener("page-changing", () => dialog.close());
  return {receive(s) {
    snapshot = s;
    access.hidden = !s?.started || ["assembly","waiting"].includes(s.phase);
    if (access.hidden) dialog.close();
    else if (dialog.open) render();
  }};
})();
