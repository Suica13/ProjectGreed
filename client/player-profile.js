/* Personal identity and hangar share the PMC profile; campaigns own separate factions. */
const PlayerProfile = (() => {
  const input = byId("playerId");
  const nameKey = "projectgreed.playerId";
  const factionKey = "projectgreed.combatFaction";
  const character = "PMC";
  let formationGroup = "PMC";
  try {
    localStorage.setItem(factionKey, "PMC");
  } catch {}

  function displayFaction(faction) {
    if (faction === "PMC") return "PMC";
    return (
      {
        EFSF: "地球联邦军[0079]",
        ZEON: "吉翁公国军[0079]",
        AEUG: "奥古[0087]",
        TITANS: "提坦斯[0087]",
        NEO_ZEON: "新吉翁[0087]",
      }[faction] || faction
    );
  }
  function showFaction() {
    const select = byId("menuFactionSelect");
    select.dataset.faction = character;
    select.value = character;
  }

  function updateProgress() {
    const factions =
      character === "PMC" ? ["EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON"] : [character];
    const unlocked = factions.reduce(
      (sum, faction) => sum + Development.unlockedTech(faction).length,
      0,
    );
    const total = factions.reduce((sum, faction) => sum + Development.nodes(faction).length, 0);
    const bar = byId("menuTechProgressBar");
    bar.setAttribute("aria-valuenow", String(unlocked));
    bar.setAttribute("aria-valuemax", String(total));
    byId("menuTechProgressFill").style.width = (total ? (unlocked / total) * 100 : 0) + "%";
    byId("menuTechProgressText").textContent = `${unlocked}/${total} 已解锁`;
  }

  let saved = "";
  try {
    saved = localStorage.getItem(nameKey) || localStorage.getItem(nameKey + "." + character) || "";
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
      localStorage.setItem(nameKey, value);
    } catch {}
    return value;
  }
  input.addEventListener("change", name);
  updateProgress();
  showFaction();
  window.addEventListener("development-changed", updateProgress);
  window.addEventListener("page-changing", updateProgress);
  window.addEventListener("language-change", updateProgress);

  function setFaction() {
    showFaction();
  }
  function restriction(model) {
    if (model?.wip) return "wip";
    const group = formationGroup;
    if (group !== "PMC" && !(model?.availableFactions || [model?.faction]).includes(group))
      return "faction_mismatch";
    return Development.allows(group, model?.prefabId || model?.id) ? null : "not_developed";
  }
  return {
    name,
    faction: () => character,
    setFaction,
    setFormationGroup: (group) => {
      formationGroup = "PMC";
    },
    displayFaction,
    updateProgress,
    selected: () => true,
    restriction,
    allows: (model) => restriction(model) === null,
    badge: (member, mode) => {
      if (mode !== "campaign") return null;
      const faction = member?.characterFaction;
      if (!["PMC", "EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON"].includes(faction)) return null;
      const label = displayFaction(faction);
      const badge = element("span", "faction-badge faction-" + faction.toLowerCase(), label);
      return badge;
    },
  };
})();
