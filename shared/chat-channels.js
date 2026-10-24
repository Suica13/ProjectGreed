/* 阵营标签与聊天队伍不同：聊天权限只依据房间 seat（null 为观战）。 */
const ChatChannels = (() => {
  const ids = Object.freeze(["all", "team1", "team2", "spectators"]);
  const labels = { all: "全部", team1: "队伍1", team2: "队伍2", spectators: "观战" };
  const teamChannel = (seat) =>
    Number.isInteger(seat) && seat >= 0 ? "team" + ((seat % 2) + 1) : null;
  function canRead(seat, channel) {
    return (
      ids.includes(channel) && (channel === "all" || seat === null || channel === teamChannel(seat))
    );
  }
  function canSend(seat, channel) {
    return (
      ids.includes(channel) &&
      (channel === "all" ||
        (seat === null ? channel === "spectators" : channel === teamChannel(seat)))
    );
  }
  return { ids, canRead, canSend, teamChannel, label: (channel) => labels[channel] || channel };
})();
if (typeof module !== "undefined") module.exports = ChatChannels;
