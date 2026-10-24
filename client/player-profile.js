/* 玩家 ID 是房间和聊天中的显示名；席位身份仍由服务端凭据确定。 */
const PlayerProfile = (() => {
  const input = byId("playerId"),
    key = "projectgreed.playerId";
  let saved = "";
  try {
    saved = localStorage.getItem(key) || "";
  } catch {}
  const generated = "Player-" + Math.random().toString(36).slice(2, 6).toUpperCase();
  const clean = (value) =>
    Array.from(value.trim().replace(/[\u0000-\u001f\u007f]/g, ""))
      .slice(0, 24)
      .join("");
  input.value = clean(saved) || generated;
  function name() {
    const value = clean(input.value) || generated;
    input.value = value;
    try {
      localStorage.setItem(key, value);
    } catch {}
    return value;
  }
  input.addEventListener("change", name);
  return { name };
})();
