/* Synchronized story presentation. Only the participating host advances it. */
window.MissionUI = (() => {
  const cover = document.createElement("div");
  cover.id = "missionDialogue";
  cover.hidden = true;
  cover.innerHTML =
    '<section class="mission-dialogue-card"><img alt=""><div><strong></strong><p></p><small></small></div><button type="button">继续</button></section>';
  document.body.append(cover);
  const style = document.createElement("style");
  style.textContent = `#missionDialogue{position:fixed;inset:0;z-index:4500;background:#06101b22;display:flex;align-items:flex-end;justify-content:center;padding:24px;box-sizing:border-box}#missionDialogue[hidden]{display:none}.mission-dialogue-card{width:min(900px,100%);display:grid;grid-template-columns:100px minmax(0,1fr) auto;gap:18px;align-items:start;background:#172936f2;border:2px solid #64b9e5;padding:18px;color:#eef6fa;box-shadow:0 8px 32px #0008}.mission-dialogue-card img{width:100px;height:100px;object-fit:contain;image-rendering:pixelated}.mission-dialogue-card strong{font-size:20px;color:#8dd4ff}.mission-dialogue-card p{font-size:18px;line-height:1.6;white-space:pre-wrap;margin:10px 0}.mission-dialogue-card small{color:#b8cbd8}.mission-dialogue-card button{align-self:end}@media(max-width:600px){#missionDialogue{padding:10px}.mission-dialogue-card{grid-template-columns:64px minmax(0,1fr);gap:12px;padding:12px}.mission-dialogue-card img{width:64px;height:64px}.mission-dialogue-card p{font-size:16px}.mission-dialogue-card button{grid-column:2;justify-self:end}}`;
  document.head.append(style);
  const objectives = document.createElement("details");
  objectives.id = "missionObjectives";
  objectives.hidden = true;
  objectives.style.cssText =
    "position:fixed;right:12px;top:96px;z-index:80;max-width:min(330px,85vw);background:#172936eb;border:1px solid #64b9e5;padding:8px;color:#eef6fa;font-size:13px";
  objectives.innerHTML = "<summary>任务目标</summary><p></p>";
  document.body.append(objectives);
  let token = null,
    audio = null;
  const button = cover.querySelector("button");
  button.onclick = () => {
    const s = Net.snapshot,
      d = s?.game.mission?.dialogue;
    if (d && s.you?.id === (s.game.mission.commanderId || s.hostId) && s.you?.seat !== null)
      Net.request("mission_dialogue_next", { dialogueId: d.id, lineIndex: d.index });
  };
  function receive(s) {
    const m = s.game?.mission,
      d = m?.dialogue,
      line = d?.lines[d.index];
    objectives.hidden =
      s.settings.mode !== "mission" || !s.started || ["assembly", "waiting"].includes(s.phase);
    if (m) {
      const mission = Rules.getMap(s.settings.mapId).mission;
      const names = (m.protect || []).map((id) => {
        const a = mission.actors.find((a) => a.id === id);
        return a ? Rules.models[a.unitId + "__" + a.kitId].name : id;
      });
      const victory =
        mission.victory.type === "survive"
          ? I18n.text("胜利：坚持至指定回合") + " " + mission.victory.round
          : mission.victory.type === "defeat_actor"
            ? I18n.text("胜利：击破目标单位") + " " + mission.victory.actor
            : I18n.text("胜利：消灭所有敌人");
      objectives.querySelector("p").textContent =
        victory +
        "\n" +
        I18n.text("失败：PMC全灭或保护目标被击坠") +
        "\n" +
        names.join("、") +
        (m.notice ? "\n" + m.notice : "") +
        (m.error ? "\n" + m.error : "");
      objectives.querySelector("p").style.whiteSpace = "pre-line";
    }
    cover.hidden = !line;
    if (!line) {
      token = null;
      audio?.pause();
      audio = null;
      return;
    }
    const current = s.matchId + ":" + d.id + ":" + d.index;
    const host = s.you?.id === (m.commanderId || s.hostId) && s.you?.seat !== null;
    button.disabled = !host || Net.awaiting;
    button.textContent = I18n.text(host ? "继续" : "等待指挥");
    cover.querySelector("small").textContent = d.index + 1 + " / " + d.lines.length;
    if (current === token) return;
    token = current;
    if (pageView !== "game") setPageView("game");
    cover.querySelector("strong").textContent = I18n.text(line.name) + ":";
    cover.querySelector("p").textContent = I18n.text(line.text);
    const actor = s.game.units.find((u) => u.missionActor === line.actor);
    const portrait =
      PilotSystem.catalog.aces.find((p) => line.portrait === "assets/pilots/" + p.id + ".png")
        ?.icon ||
      line.portrait ||
      (actor?.pilot && PilotSystem.portrait(actor.pilot));
    const img = cover.querySelector("img");
    img.src = portrait ? ART.assets[portrait] || portrait : "";
    img.hidden = !portrait;
    audio?.pause();
    audio = null;
    if (line.sound) {
      audio = new Audio(ART.sounds[line.sound] || ART.assets[line.sound] || line.sound);
      audio.play().catch(() => {});
    }
    const focus = actor || line.focus;
    if (focus) MapCamera.focus(focus.x, focus.y);
  }
  // The scrim blocks map drags; camera focus is released when the dialogue ends.
  return {
    receive,
    clear() {
      cover.hidden = true;
      objectives.hidden = true;
      token = null;
      audio?.pause();
      audio = null;
    },
  };
})();
