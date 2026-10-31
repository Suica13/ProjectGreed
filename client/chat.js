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
    const text = window.ReplayPlayer?.active
      ? "回放聊天记录（只读）"
      : !connected()
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
    refreshExports();
    refreshChannels();
    const writable =
      connected() && !window.ReplayPlayer?.active && ChatChannels.canSend(seat(), selectedChannel);
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
        if (message.system) {
          const label = element("span", "chat-channel-label", "[" + I18n.text("系统") + "]");
          const name = element("strong", playerNameClass(message.memberId), message.name);
          const badge = PlayerProfile.badge(message, Net.snapshot?.settings?.mode);
          if (badge) name.prepend(badge);
          name.setAttribute("data-i18n-ignore", "");
          name.dataset.memberId = message.memberId;
          row.append(label, name, element("span", "", I18n.text(message.event)));
          row.title = new Date(message.at).toLocaleTimeString();
          return row;
        }
        const name = element("strong", playerNameClass(message.memberId), message.name);
        const badge = PlayerProfile.badge(message, Net.snapshot?.settings?.mode);
        if (badge) name.prepend(badge);
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
  let battleLog = [],
    logExport = null,
    exportChoice = null;
  const exportSelectors = ["battleLogPerspective", "roomLogPerspective"];
  const perspectiveLabel = (value) =>
    value === "global" ? I18n.text("上帝视角") : I18n.text("队伍") + (Number(value.slice(5)) + 1);
  function refreshExports() {
    const replayOptions = window.ReplayPlayer?.logOptions();
    const available = replayOptions || logExport?.options || [];
    const teams = new Set(
      Rules.getMap(Net.snapshot?.settings?.mapId).spawns.map((_, seat) => Rules.seatTeam(seat)),
    );
    const options = [...new Set([...teams].map((team) => "team:" + team).concat(available))]
      .filter((value) => value !== "global")
      .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
    options.push("global");
    if (!available.includes(exportChoice)) exportChoice = available[0] || options[0];
    for (const id of ["showLog", "roomShowLog"])
      byId(id).textContent = logExport ? "LOG · " + perspectiveLabel(logExport.perspective) : "LOG";
    for (const id of exportSelectors) {
      const select = byId(id);
      if (!select) continue;
      if (
        Array.from(select.options)
          .map((option) => option.value)
          .join("|") !== options.join("|")
      ) {
        select.replaceChildren();
        for (const value of options) select.add(new Option(perspectiveLabel(value), value));
      }
      select.value = exportChoice || "";
      for (const option of select.options) option.disabled = !available.includes(option.value);
      select.hidden = false;
      select.disabled = !!Net.awaiting;
    }
    for (const id of ["downloadBattleLog", "roomDownloadBattleLog"]) {
      byId(id).disabled =
        Net.active || replayOptions
          ? !available.includes(exportChoice) || !!Net.awaiting
          : !battleLog.length;
      byId(id).title =
        Net.active && !available.length
          ? "全局战报在对局结束或全员返回房间时开放下载。"
          : "下载战斗LOG";
    }
  }
  function downloadLog() {
    if (window.ReplayPlayer?.active) {
      ReplayPlayer.downloadLog(exportChoice).catch((error) => note(error.message));
      return;
    }
    if (Net.active) {
      if (!logExport?.options.includes(exportChoice) || Net.awaiting) return;
      Net.request("download_log", { perspective: exportChoice });
      return;
    }
    if (battleLog.length) saveLog(battleLog, "global");
  }
  function saveLog(entries, perspective) {
    const contents = "\uFEFF" + entries.slice().reverse().join("\r\n") + "\r\n";
    const url = URL.createObjectURL(new Blob([contents], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download =
      "ProjectGreed-battle-log-" +
      (perspective === "global" ? "global" : "team-" + (Number(perspective.slice(5)) + 1)) +
      "-" +
      new Date().toISOString().replace(/[:.]/g, "-") +
      ".txt";
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  for (const id of ["downloadBattleLog", "roomDownloadBattleLog"]) {
    byId(id).onclick = downloadLog;
    byId(id).disabled = true;
  }
  function setLog(
    entries,
    names = game.units.map((unit) => Rules.unitLogName(unit)).filter(Boolean),
  ) {
    battleLog = entries.slice();
    refreshExports();
    for (const id of ["log", "roomCombatLog"]) {
      const list = byId(id),
        scrollTop = list.scrollTop;
      list.replaceChildren(
        ...battleLog.slice(0, 80).map((text) => {
          const line = element(
            "div",
            "log-line" + (text.includes("\n") ? " deployment-roster" : ""),
          );
          setNamedText(line, text, names);
          return line;
        }),
      );
      list.scrollTop = scrollTop;
    }
  }
  for (const id of exportSelectors) {
    if (byId(id))
      byId(id).onchange = () => {
        exportChoice = byId(id).value;
        refreshExports();
      };
  }
  let matchId = null,
    exportMatchId = null;
  function setSnapshot(snapshot) {
    const next = snapshot.logExport || { options: [], perspective: "global", unlocked: false };
    if (
      snapshot.matchId !== exportMatchId ||
      next.perspective !== logExport?.perspective ||
      !next.options.includes(exportChoice)
    )
      exportChoice = next.options.includes(next.perspective)
        ? next.perspective
        : next.options[0] || null;
    exportMatchId = snapshot.matchId;
    logExport = next;
    if (snapshot.started && snapshot.matchId !== matchId) {
      matchId = snapshot.matchId;
      selectTab(Net.local ? "log" : "chat");
    }
    setLog(snapshot.log || [], [
      ...(snapshot.logNames || []),
      ...snapshot.game.units.map((unit) => Rules.unitLogName(unit)).filter(Boolean),
    ]);
    // A seat change can remove access to the previous team's history.
    messages = (snapshot.chat || []).slice(-100);
    render();
    refreshNames(snapshot);
    if (connected() && !pending) status("");
  }
  function receive(message, ack) {
    if (window.ReplayPlayer?.active) return;
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
    logExport = exportChoice = exportMatchId = null;
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
    for (const id of exportSelectors)
      if (byId(id))
        for (const option of byId(id).options) option.textContent = perspectiveLabel(option.value);
    refreshStatus();
  });
  render();
  return {
    setSnapshot,
    setLog,
    saveLog,
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
