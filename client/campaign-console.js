/* Strategic messages reuse the room chat transport, channels and retry state. */
window.createCampaignConsole = ({ panel, state, node, button }) => {
  const root = node("section", "", "campaign-console");
  root.id = "campaignConsole";
  const tabs = node("nav", "", "campaign-console-tabs");
  tabs.setAttribute("aria-label", "战略消息");
  const navigation = node("div", "", "campaign-console-navigation");
  navigation.setAttribute("role", "tablist");
  navigation.setAttribute("aria-label", "聊天和战略记录");
  const chatTab = button("聊天", () => select("chat"));
  chatTab.id = "campaignShowChat";
  const logTab = button("战略LOG", () => select("log"));
  logTab.id = "campaignShowLog";
  const fold = button("收起", () => {
    collapsed = !collapsed;
    if (collapsed) expanded = false;
    apply();
  });
  fold.id = "campaignConsoleFold";
  const expand = button("↕", () => {
    expanded = !expanded;
    collapsed = false;
    apply();
  });
  expand.id = "campaignConsoleExpand";
  expand.setAttribute("aria-label", "展开信息栏");
  expand.title = I18n.text("展开信息栏");
  const musicSlot = node("span", "", "campaign-music-slot");
  musicSlot.id = "campaignMusicSlot";
  for (const [tab, pane] of [
    [chatTab, "campaignChatPanel"],
    [logTab, "campaignStrategicLog"],
  ]) {
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", pane);
  }
  navigation.append(chatTab, logTab);
  tabs.append(navigation, expand, musicSlot, fold);
  const log = node("div", "", "campaign-console-log campaign-console-pane");
  log.id = "campaignStrategicLog";
  log.setAttribute("role", "log");
  log.setAttribute("aria-label", "战略LOG");
  log.setAttribute("aria-live", "polite");
  const chat = node("div", "", "campaign-console-chat campaign-console-pane");
  chat.id = "campaignChatPanel";
  chat.setAttribute("role", "tabpanel");
  chat.setAttribute("aria-labelledby", chatTab.id);
  const lines = node("div", "", "chat-lines");
  lines.id = "campaignChatLines";
  lines.setAttribute("role", "log");
  lines.setAttribute("aria-label", "聊天消息");
  const form = node("form", "", "chat-form");
  form.id = "campaignChatForm";
  const channel = node("select", "", "chat-channel-select");
  channel.id = "campaignChatChannel";
  channel.setAttribute("aria-label", "聊天频道");
  const input = node("input");
  input.id = "campaignChatInput";
  input.maxLength = 300;
  input.autocomplete = "off";
  input.placeholder = I18n.text("输入聊天内容");
  input.setAttribute("aria-label", "聊天内容");
  const send = node("button", "发送");
  send.id = "campaignChatSend";
  send.type = "submit";
  form.append(channel, input, send);
  const status = node("p", "", "chat-status");
  status.id = "campaignChatStatus";
  status.setAttribute("role", "status");
  chat.append(lines, form, status);
  root.append(tabs, chat, log);
  panel.append(root);
  Chat.registerView({
    lines: lines.id,
    form: form.id,
    input: input.id,
    status: status.id,
    send: send.id,
    channel: channel.id,
  });
  let selected = "log",
    collapsed = false,
    expanded = false,
    context = null,
    historyKey = "";
  function apply() {
    root.dataset.collapsed = String(collapsed);
    root.dataset.tab = selected;
    root.dataset.expanded = String(expanded);
    expand.setAttribute("aria-pressed", String(expanded));
    log.hidden = collapsed || selected !== "log";
    chat.hidden = collapsed || selected !== "chat";
    for (const [tab, id] of [
      [chatTab, "chat"],
      [logTab, "log"],
    ]) {
      tab.setAttribute("aria-selected", String(selected === id));
      tab.tabIndex = selected === id ? 0 : -1;
    }
    fold.textContent = I18n.text(collapsed ? "展开" : "收起");
    fold.setAttribute("aria-expanded", String(!collapsed));
  }
  function select(tab) {
    selected = tab;
    collapsed = false;
    apply();
    if (tab === "chat") Chat.refreshStatus();
    const list = tab === "chat" ? lines : log;
    list.scrollTop = list.scrollHeight;
  }
  function refresh() {
    const nextContext = Net.snapshot?.room + ":" + Net.memberId + ":" + Net.local;
    if (context !== nextContext) {
      context = nextContext;
      selected = Net.local ? "log" : "chat";
      collapsed = expanded = false;
      historyKey = "";
    }
    const history = state()?.history || [],
      key = JSON.stringify(history);
    if (key !== historyKey) {
      const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
      const previous = log.scrollTop;
      log.replaceChildren(...history.map((text) => node("div", text, "campaign-log-line")));
      if (!history.length) log.append(node("p", "暂无战略记录", "muted"));
      log.scrollTop = nearBottom ? log.scrollHeight : previous;
      historyKey = key;
    }
    apply();
  }
  for (const tab of [chatTab, logTab])
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const next = tab === chatTab ? logTab : chatTab;
      select(next === chatTab ? "chat" : "log");
      next.focus();
    });
  apply();
  return { root, refresh };
};
