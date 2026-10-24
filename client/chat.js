/* 房间与战局共用频道、历史与发送状态。频道权限由共用规则描述、服务端最终校验。 */
const Chat = (() => {
  let messages = [],
    pending = null,
    retry = null,
    timer = null;
  let selectedChannel = "all",
    notice = "";
  const views = [
    {
      lines: "chatLines",
      form: "chatForm",
      input: "chatInput",
      status: "chatStatus",
      send: "chatSend",
      channel: "chatChannel",
    },
    {
      lines: "roomChatLines",
      form: "roomChatForm",
      input: "roomChatInput",
      status: "roomChatStatus",
      send: "roomChatSend",
      channel: "roomChatChannel",
    },
  ];
  const connected = () => Net.active && Net.socket?.readyState === WebSocket.OPEN && !!Net.memberId;
  function seat() {
    return Net.snapshot?.you?.seat !== undefined ? Net.snapshot.you.seat : Net.seat;
  }
  function availableChannels() {
    return connected()
      ? ChatChannels.ids.filter((channel) => ChatChannels.canSend(seat(), channel))
      : ["all"];
  }
  function status(text = "") {
    notice = text;
    renderStatus();
  }
  function renderStatus() {
    const text = !connected()
      ? "聊天仅在房间内可用。"
      : !ChatChannels.canSend(seat(), selectedChannel)
        ? "观战玩家只能查看队伍频道，请在全部或观战频道发送。"
        : notice;
    for (const view of views) byId(view.status).textContent = text;
  }
  function refreshChannels() {
    const allowed = availableChannels();
    if (!allowed.includes(selectedChannel)) selectedChannel = "all";
    for (const view of views) {
      const select = byId(view.channel);
      if (
        Array.from(select.options)
          .map((option) => option.value)
          .join("|") !== allowed.join("|")
      ) {
        select.replaceChildren();
        for (const channel of allowed) select.add(new Option(ChatChannels.label(channel), channel));
      }
      select.value = selectedChannel;
    }
  }
  function refreshStatus() {
    refreshChannels();
    const writable = connected() && ChatChannels.canSend(seat(), selectedChannel);
    for (const view of views) {
      byId(view.send).disabled = !writable || !!pending;
      byId(view.input).disabled = !writable;
      byId(view.channel).disabled = !connected();
    }
    renderStatus();
  }
  function render() {
    refreshChannels();
    // 服务端已按身份过滤权限；发送频道不再筛选聊天历史。
    const visible = messages;
    for (const view of views) {
      const list = byId(view.lines);
      const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
      const nodes = visible.map((message) => {
        const row = element("div", "chat-line");
        row.dataset.channel = message.channel || "all";
        const name = element("strong", playerNameClass(message.memberId), message.name);
        const body = element("span", "", message.text);
        name.setAttribute("data-i18n-ignore", "");
        name.dataset.memberId = message.memberId;
        body.setAttribute("data-i18n-ignore", "");
        const channel = element(
          "span",
          "chat-channel-label",
          "[" + ChatChannels.label(message.channel || "all") + "]",
        );
        row.title = new Date(message.at).toLocaleTimeString();
        row.append(channel, name, document.createTextNode(":"), body);
        return row;
      });
      if (!nodes.length) nodes.push(element("p", "muted", "暂无聊天消息"));
      list.replaceChildren(...nodes);
      if (nearBottom) list.scrollTop = list.scrollHeight;
    }
    refreshStatus();
  }
  function refreshNames(snapshot) {
    for (const view of views)
      for (const name of byId(view.lines).querySelectorAll("[data-member-id]"))
        name.className = playerNameClass(name.dataset.memberId, snapshot.hostId, snapshot.you?.id);
  }
  function setLog(entries) {
    for (const id of ["log", "roomCombatLog"]) {
      const list = byId(id),
        scrollTop = list.scrollTop;
      list.replaceChildren(...entries.map((text) => element("div", "log-line", text)));
      list.scrollTop = scrollTop;
    }
  }
  let matchId = null;
  function setSnapshot(snapshot) {
    if (snapshot.started && snapshot.matchId !== matchId) {
      matchId = snapshot.matchId;
      if (!Net.local) selectTab("chat");
    }
    setLog(snapshot.log || []);
    // A seat change can remove access to the previous team's history.
    messages = (snapshot.chat || []).slice(-100);
    render();
    refreshNames(snapshot);
    if (connected() && !pending) status("");
  }
  function receive(message, ack) {
    if (!messages.some((old) => old.id === message.id)) {
      if (message.memberId !== Net.memberId) GameAudio.play("infoSound");
      messages.push(message);
      messages = messages.slice(-100);
      render();
    }
    if (pending?.id === ack) {
      clearTimeout(timer);
      const input = byId(pending.view.input);
      if (input.value.trim() === pending.text) input.value = "";
      pending = retry = null;
      status("");
      refreshStatus();
    }
  }
  function reject(id, text) {
    if (pending?.id !== id) return;
    clearTimeout(timer);
    pending = null;
    status(text);
    refreshStatus();
  }
  function reset() {
    clearTimeout(timer);
    setLog([]);
    selectRoomTab("chat");
    selectTab("log");
    matchId = null;
    messages = [];
    pending = retry = null;
    selectedChannel = "all";
    for (const view of views) byId(view.input).value = "";
    status("");
    render();
  }
  function selectChannel(channel) {
    if (!availableChannels().includes(channel)) return;
    selectedChannel = channel;
    notice = "";
    render();
    for (const view of views) {
      const list = byId(view.lines);
      list.scrollTop = list.scrollHeight;
    }
  }
  for (const view of views) {
    byId(view.channel).onchange = () => selectChannel(byId(view.channel).value);
    byId(view.form).onsubmit = (event) => {
      event.preventDefault();
      const text = byId(view.input).value.trim();
      if (!text || pending) return;
      if (!connected() || !ChatChannels.canSend(seat(), selectedChannel)) return refreshStatus();
      const id = Net.sendChat(
        text,
        retry?.text === text && retry.channel === selectedChannel ? retry.id : null,
        selectedChannel,
      );
      if (!id) return;
      pending = { id, text, view, channel: selectedChannel };
      retry = { id, text, channel: selectedChannel };
      status("正在发送…");
      refreshStatus();
      timer = setTimeout(() => {
        if (pending?.id !== id) return;
        pending = null;
        status("发送超时，请重试。");
        refreshStatus();
      }, 8000);
    };
  }
  function selectTab(tab) {
    const chat = tab === "chat";
    byId("log").hidden = chat;
    byId("chatPanel").hidden = !chat;
    byId("showLog").setAttribute("aria-selected", String(!chat));
    byId("showChat").setAttribute("aria-selected", String(chat));
    if (chat) {
      const list = byId("chatLines");
      list.scrollTop = list.scrollHeight;
      refreshStatus();
    }
  }
  function selectRoomTab(tab) {
    const chat = tab === "chat";
    byId("roomChatContent").hidden = !chat;
    byId("roomCombatLog").hidden = chat;
    byId("roomShowChat").setAttribute("aria-selected", String(chat));
    byId("roomShowLog").setAttribute("aria-selected", String(!chat));
    if (chat) refreshStatus();
  }
  byId("roomShowChat").onclick = () => selectRoomTab("chat");
  byId("roomShowLog").onclick = () => selectRoomTab("log");
  byId("showLog").onclick = () => selectTab("log");
  byId("showChat").onclick = () => selectTab("chat");
  window.addEventListener("language-change", () => {
    for (const view of views)
      for (const option of byId(view.channel).options)
        option.textContent = ChatChannels.label(option.value);
    refreshStatus();
  });
  render();
  return {
    setSnapshot,
    setLog,
    selectRoomTab,
    receive,
    reject,
    reset,
    refreshStatus,
    selectTab,
    refreshNames,
    selectChannel,
  };
})();
