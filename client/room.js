/* 房间准备、队伍与观战席位的展示。操作意图仍交给服务端校验。 */
const RoomPanel = (() => {
  function render(snapshot) {
    const roster = snapshot.members || [];
    const self = snapshot.you || {};
    const own = roster.find((member) => member.id === self.id);
    const busy = !!Net.awaiting;
    byId("roomFormation").disabled = snapshot.started || !!own?.ready || busy;
    byId("roomFormationSummary").textContent = "出战编组：" + Formation.name();
    byId("roomTitle").textContent = `房间 ${snapshot.room}`;
    byId("roomStatus").textContent = snapshot.started
      ? snapshot.connected.every(Boolean)
        ? "游戏进行中，可切换席位或返回战斗。"
        : "等待空队伍补位或离线玩家恢复，战局已暂停。"
      : "两队玩家均点击准备后开始游戏。";
    const teams = byId("teamSlots");
    teams.replaceChildren();
    for (let seat = 0; seat < 2; seat++) {
      const member = roster.find((player) => player.seat === seat);
      const slot = element("section", "team-slot");
      slot.append(element("h3", "", `队伍${seat + 1}`));
      slot.append(
        element(
          "strong",
          "",
          member ? member.name + (member.id === self.id ? "（你）" : "") : "空位",
        ),
      );
      slot.append(
        element(
          "p",
          "muted",
          member
            ? !member.connected
              ? "离线 · 保留席位"
              : snapshot.started
                ? "游戏中"
                : member.ready
                  ? "已准备"
                  : "未准备"
            : "观战玩家可加入",
        ),
      );
      teams.append(slot);
      byId("joinTeam" + (seat + 1)).disabled = busy || !!member;
    }
    const spectators = byId("spectatorSlots");
    spectators.replaceChildren();
    const watching = roster.filter((member) => member.seat === null);
    for (const member of watching)
      spectators.append(
        element(
          "div",
          "spectator-slot",
          member.name +
            (member.id === self.id ? "（你）" : "") +
            (member.connected ? "" : " · 离线"),
        ),
      );
    if (!watching.length) spectators.append(element("p", "muted", "暂无观战玩家"));
    byId("becomeSpectator").disabled = busy || self.seat === null;
    byId("toggleReady").hidden = snapshot.started || self.seat === null;
    byId("toggleReady").disabled = busy;
    byId("toggleReady").textContent = own?.ready ? "取消准备" : "准备";
    byId("roomReturn").hidden = !snapshot.started;
  }
  byId("joinTeam1").onclick = () => Net.request("switch_seat", { seat: 0 });
  byId("joinTeam2").onclick = () => Net.request("switch_seat", { seat: 1 });
  byId("becomeSpectator").onclick = () => Net.request("switch_seat", { seat: null });
  byId("toggleReady").onclick = () => {
    const self = Net.snapshot?.members.find((member) => member.id === Net.memberId);
    Net.request("set_ready", { ready: !self?.ready, formation: Formation.current() });
  };
  byId("roomSettings").onclick = () => {
    setPageView("room");
    render(Net.snapshot);
  };
  byId("roomReturn").onclick = () => {
    setPageView("game");
    Net.applySnapshot(Net.snapshot);
  };
  byId("roomMainMenu").onclick = requestMenu;
  return { render };
})();
