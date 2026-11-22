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
  const objectives = document.createElement("button");
  objectives.id = "missionObjectives";
  objectives.type = "button";
  objectives.hidden = true;
  objectives.style.cssText =
    "position:absolute;left:50%;transform:translateX(-50%);top:8px;z-index:80;width:max-content;max-width:min(520px,calc(100% - 240px));box-sizing:border-box;background:#172936eb;border:1px solid #64b9e5;padding:8px;color:#eef6fa;font-size:13px";
  objectives.textContent = "任务目标";
  objectives.setAttribute("aria-haspopup", "dialog");
  objectives.setAttribute("aria-controls", "missionObjectivesPanel");
  byId("mapWrap").append(objectives);
  const objectivePanel = document.createElement("dialog");
  objectivePanel.id = "missionObjectivesPanel";
  objectivePanel.className = "game-dialog";
  objectivePanel.setAttribute("aria-labelledby", "missionObjectivesTitle");
  objectivePanel.innerHTML = '<header><h2 id="missionObjectivesTitle"></h2><button type="button"></button></header><section><h3></h3><ul data-objectives="victory"></ul></section><section><h3></h3><ul data-objectives="failure"></ul></section><p class="muted"></p>';
  document.body.append(objectivePanel);
  const briefingButton=document.createElement("button");
  briefingButton.type="button";briefingButton.textContent="作战简报";
  briefingButton.onclick=()=>{objectivePanel.close();BriefingUI.open(Net.snapshot);};
  objectivePanel.append(briefingButton);
  objectives.onclick = () => { if (!objectivePanel.open) objectivePanel.showModal(); };
  objectivePanel.querySelector("button").onclick = () => objectivePanel.close();
  objectivePanel.addEventListener("keydown", event=>event.stopPropagation());
  objectivePanel.addEventListener("click", event=>{
    if (event.target !== objectivePanel) return;
    const r=objectivePanel.getBoundingClientRect();
    if (event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom)
      objectivePanel.close();
  });
  objectivePanel.addEventListener("close",()=>{ if(!objectives.hidden) objectives.focus(); });
  const choicePanel=document.createElement("dialog");
  choicePanel.id="missionChoicePanel";
  choicePanel.className="game-dialog";
  choicePanel.setAttribute("aria-labelledby","missionChoiceTitle");
  choicePanel.innerHTML='<h2 id="missionChoiceTitle"></h2><p></p><div class="mission-choice-options"></div><small></small>';
  document.body.append(choicePanel);
  choicePanel.addEventListener("cancel",e=>e.preventDefault());
  choicePanel.addEventListener("keydown",e=>e.stopPropagation());
  style.textContent+='#missionChoicePanel{position:fixed;inset:0;margin:auto;width:min(600px,calc(100vw - 24px));max-height:85dvh}#missionChoicePanel p{line-height:1.7}#missionChoicePanel .mission-choice-options{display:grid;gap:12px;margin:20px 0}#missionChoicePanel button{white-space:normal;text-align:left;padding:12px;line-height:1.5}';
  let choiceStamp=null;
  style.textContent +=
    "#missionObjectivesPanel{position:fixed;inset:0;margin:auto;width:min(580px,calc(100vw - 24px));max-height:85dvh}#missionObjectivesPanel header{display:flex;align-items:center;justify-content:space-between;gap:12px}#missionObjectivesPanel h2{margin:0}#missionObjectivesPanel h3{margin:20px 0 10px;color:#8dd4ff}#missionObjectivesPanel ul{list-style:none;padding:0;margin:0}#missionObjectivesPanel li{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:9px 0;border-bottom:1px solid #435d6c66;line-height:1.5}#missionObjectivesPanel .objective-count{white-space:nowrap;font-variant-numeric:tabular-nums;color:#a7d8ed}#missionObjectivesPanel p{white-space:pre-line} @media(max-width:700px){#missionObjectives{top:52px!important;max-width:calc(100% - 130px)!important;font-size:11px!important;padding:5px!important}}";
  let token = null,
    objectiveKey = null,
    audio = null,
    cinematicToken = null;
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
    const choice=m?.choice;
    if (choice && s.started) {
      const stamp=s.matchId+":"+choice.id+":"+I18n.language;
      const host=s.you?.id===(m.commanderId || s.hostId) && s.you?.seat!==null;
      if (choiceStamp!==stamp) {
        choiceStamp=stamp;
        choicePanel.querySelector("h2").textContent=I18n.text(choice.name);
        choicePanel.querySelector("p").textContent=I18n.text(choice.text);
        choicePanel.querySelector("div").replaceChildren(...choice.options.map(option=>{
          const b=document.createElement("button");b.type="button";b.textContent=I18n.text(option.text);
          b.onclick=()=>{
            for(const button of choicePanel.querySelectorAll("button"))button.disabled=true;
            Net.request("mission_choose",{choiceId:choice.id,optionId:option.id});
          };return b;
        }));
      }
      for(const b of choicePanel.querySelectorAll("button"))b.disabled=!host || Net.awaiting;
      choicePanel.querySelector("small").textContent=I18n.text(host?"请选择行动":"等待指挥玩家选择");
      if(objectivePanel.open)objectivePanel.close();
      if(pageView!=="game")setPageView("game");
      if(!choicePanel.open)choicePanel.showModal();
    } else {
      choiceStamp=null;
      if(choicePanel.open)choicePanel.close();
    }
    const cinematic = m?.cinematic;
    if (cinematic && cinematicToken !== s.matchId + ":" + cinematic.id) {
      cinematicToken = s.matchId + ":" + cinematic.id;
      cinematic.targets.forEach((target, index) =>
        SkillEffects.start({
          ...cinematic,
          id: cinematicToken + ":" + index,
          scripted: true,
          to: target,
          actors: index === 0 ? cinematic.actors : [],
          hits: index === 0 ? cinematic.hits : [],
          sound: index === 0 ? cinematic.sound : null,
        }),
      );
    }
    objectives.hidden =
      s.settings.mode !== "mission" || !s.started || ["assembly", "waiting"].includes(s.phase);
    if ((objectives.hidden || line || choice) && objectivePanel.open) objectivePanel.close();
    const progress = m?.protect ? m.objectives || MissionMode.objectives(s.game, Rules) : null;
    const nextObjectiveKey =
      m && JSON.stringify([s.settings.mapId, progress, m.error, I18n.language]);
    if (progress && objectiveKey !== nextObjectiveKey) {
      objectiveKey = nextObjectiveKey;
      objectives.textContent = I18n.text("任务目标");
      objectivePanel.querySelector("h2").textContent = I18n.text("任务目标");
      objectivePanel.querySelector("button").textContent = I18n.text("关闭");
      const headings=objectivePanel.querySelectorAll("h3");
      headings[0].textContent=I18n.text("胜利条件");
      headings[1].textContent=I18n.text("失败条件");
      const labels={main_force:"消灭敌军主力",all_enemies:"消灭所有敌人",escort:"护送目标抵达指定地点",hold:"抵达后存活回合",
        survive:"坚持至指定回合",defeat_actor:"击破目标单位",pmc_destroyed:"玩家PMC部队全灭",protected_destroyed:"保护目标被击坠"};
      for (const kind of ["victory","failure"]) {
        const list=objectivePanel.querySelector('[data-objectives="'+kind+'"]');
        list.replaceChildren(...progress[kind].map(item=>{
          const row=document.createElement("li"),label=document.createElement("span"),count=document.createElement("span");
          const model=item.unitId && Object.entries(Rules.models).find(([key])=>key.startsWith(item.unitId+"__"))?.[1];
          const name=item.unitId && (model?.name || item.unitId);
          label.textContent=I18n.text(item.label || labels[item.kind])+(name?" · "+I18n.text(name):"");
          count.className="objective-count";
          count.textContent="("+item.current+"/"+item.total+")";
          row.append(label,count);return row;
        }));
      }
      const notice=objectivePanel.querySelector("p");
      notice.textContent=m.error ? I18n.text(m.error) : "";
      notice.hidden=!notice.textContent;
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
      if (objectivePanel.open) objectivePanel.close();
      if (choicePanel.open) choicePanel.close();
      choiceStamp=null;
      token = null;
      objectiveKey = null;
      cinematicToken = null;
      audio?.pause();
      audio = null;
    },
  };
})();
