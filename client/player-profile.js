/* Room identity and formation save group are separate choices. */
const PlayerProfile = (() => {
  const input = byId("playerId");
  const nameKey = "projectgreed.playerId";
  const factionKey = "projectgreed.combatFaction";
  let character = "EFSF";
  let formationGroup = "PMC";
  try {
    const savedFaction = localStorage.getItem(factionKey);
    if (["PMC", "EFSF", "ZEON"].includes(savedFaction)) character = savedFaction;
  } catch {}

  function displayFaction(faction) {
    if (faction === "PMC") return "PMC";
    return faction === "EFSF" ? "地球联邦军[0079]" : "吉翁公国军[0079]";
  }
  function showFaction() {
    const select = byId("menuFactionSelect");
    select.dataset.faction = character;
    select.value = character;
  }

  function updateProgress() {
    const factions = character === "PMC" ? ["EFSF", "ZEON"] : [character];
    const unlocked = factions.reduce((sum, faction) => sum + Development.unlockedTech(faction).length, 0);
    const total = factions.reduce((sum, faction) => sum + Development.nodes(faction).length, 0);
    const bar = byId("menuTechProgressBar");
    bar.setAttribute("aria-valuenow", String(unlocked));
    bar.setAttribute("aria-valuemax", String(total));
    byId("menuTechProgressFill").style.width = (total ? unlocked / total * 100 : 0) + "%";
    byId("menuTechProgressText").textContent = `${unlocked}/${total} 已解锁`;
  }

  let saved = "";
  try {
    saved = localStorage.getItem(nameKey) ||
      localStorage.getItem(nameKey + "." + character) || "";
  } catch {}
  const generated = "Player-" + Math.random().toString(36).slice(2, 6).toUpperCase();
  const clean = (value) =>
    Array.from(value.trim().replace(/[\u0000-\u001f\u007f]/g, ""))
      .slice(0, 24).join("");
  input.value = clean(saved) || generated;
  function name() {
    const value = clean(input.value) || generated;
    input.value = value;
    try { localStorage.setItem(nameKey, value); } catch {}
    return value;
  }
  input.addEventListener("change", name);
  updateProgress();
  showFaction();
  window.addEventListener("development-changed", updateProgress);
  window.addEventListener("page-changing", updateProgress);
  window.addEventListener("language-change", updateProgress);

  function setFaction(faction) {
    if (!["PMC", "EFSF", "ZEON"].includes(faction) || faction === character) return;
    character = faction;
    try { localStorage.setItem(factionKey, faction); } catch {}
    showFaction();
    updateProgress();
    window.dispatchEvent(new CustomEvent("character-selected", {
      detail: { character: faction, initial: false },
    }));
  }
  byId("menuFactionSelect").onchange = (event) => {
    const next = event.target.value;
    Formation.setGroup(next);
    setFaction(next);
  };
  function restriction(model) {
    if (model?.wip) return "wip";
    const group = formationGroup;
    if (group !== "PMC" && model?.faction !== group) return "faction_mismatch";
    return Development.allows(group, model?.prefabId || model?.id)
      ? null : "not_developed";
  }
  return {
    name,
    faction: () => character,
    setFaction,
    setFormationGroup: (group) => { formationGroup = group; },
    displayFaction,
    updateProgress,
    selected: () => true,
    restriction,
    allows: (model) => restriction(model) === null,
    badge: (member, mode) => {
      const faction = member?.characterFaction;
      if (!["EFSF", "PMC", "ZEON"].includes(faction)) return null;
      const label = displayFaction(faction);
      const badge = element("span", "faction-badge faction-" + faction.toLowerCase(), label);
      return badge;
    },
  };
})();
