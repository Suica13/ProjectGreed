"use strict";
const os = require("node:os");

// Resolve a concrete interface instead of listening on every network adapter.
function resolveEditorHost(host = "127.0.0.1", interfaces = os.networkInterfaces()) {
  if (host !== "lan") return host;
  const candidates = Object.values(interfaces).flat().filter((entry) =>
    entry && entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254."),
  );
  const privateAddresses = candidates.filter(({ address }) => {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  });
  const addresses = [...new Set((privateAddresses.length ? privateAddresses : candidates).map((entry) => entry.address))];
  if (addresses.length !== 1)
    throw Error("无法唯一确定编辑服务网卡，请在 developer-config.json 的 host 中填写服务器网卡IP。可选：" + (addresses.join("、") || "无"));
  return addresses[0];
}
module.exports = { resolveEditorHost };
