/* 战斗界面的视图控制。复用原指令按钮，不参与战局裁定。 */
const BattleHUD = (() => {
  const scene = byId("gameScene"),
    roster = byId("hudRosterPanel"),
    panel = byId("hudUnitPanel"),
    commands = byId("hudUnitCommands"),
    legend = scene.querySelector(".legend"),
    settings = byId("openClientSettings"),
    settingsHome = document.createComment("settings-button-home");
  settings.before(settingsHome);
  const terrainInfo = element("div", "hud-terrain-strip");
  terrainInfo.id = "hudTerrainInfo";
  terrainInfo.append(byId("mapEnvironment"), byId("hoverInfo"), byId("mapClimateStatus"));
  byId("mapWrap").append(terrainInfo, byId("hudActionBand"));
  // Zoom sits immediately to the right of the fixed-width phase badge.
  const phaseControls = element("div", "hud-phase-controls");
  phaseControls.append(
    scene.querySelector(".phase-row"),
    scene.querySelector(".map-camera-controls"),
  );
  // Keep presentation controls immediately after the log filter, including restored layouts.
  const combatControls = byId("mapCombatControls");
  if (combatControls) byId("battleLogView").after(combatControls);
  const topControls = element("div", "hud-top-controls");
  topControls.append(byId("hudTurnActions"));
  const topLine = element("div", "hud-top-line");
  topLine.append(phaseControls, topControls, terrainInfo);
  byId("mapWrap").append(topLine);
  const capturePoint = element("button", "primary", "占领");
  capturePoint.id = "hudCapturePoint";
  capturePoint.title = "占领据点：不消耗AP，空中单位不可占领，据点内有敌军时不可占领";
  const transferRegion = element("button", "", "转移");
  transferRegion.id = "hudTransferRegion";
  const transferControl = element("button", "", "转交控制权");
  transferControl.id = "hudTransferControl";
  const attackPlanSummary = element("section", "attack-plan-summary");
  attackPlanSummary.id = "hudAttackPlanSummary";
  attackPlanSummary.hidden = true;
  scene.append(attackPlanSummary);
  const cancelTargetSwitch = element("button", "primary", "取消更换目标");
  cancelTargetSwitch.id = "cancelTargetSwitch";
  cancelTargetSwitch.hidden = true;
  scene.append(cancelTargetSwitch);
  cancelTargetSwitch.onclick = () => {
    if (phase === "reaction" && pending) {
      counterDraft(getUnit(pending.target)).pickingTarget = false;
      renderReaction();
      update();
    } else AttackControls.resumeTarget();
  };
  const confirmMove = element("button", "primary", "确认移动");
  const squadStrip = element("div", "battle-squad-strip");
  squadStrip.id = "hudSquad";
  squadStrip.hidden = true;
  byId("mapWrap").append(squadStrip);
  confirmMove.id = "hudConfirmMove";
  confirmMove.hidden = true;
  confirmMove.onclick = () => finishMovement(true);
  byId("hudCancelAction").after(confirmMove);
  let rotationDraft=null;
  const rotationDialog=element("section","ship-rotation-overlay");
  rotationDialog.id="shipRotationDialog";
  rotationDialog.hidden=true;
  rotationDialog.setAttribute("role","group");
  rotationDialog.setAttribute("aria-labelledby","shipRotationTitle");
  rotationDialog.close=()=>{rotationDialog.hidden=true;rotationDraft=null;};
  byId("mapWrap").append(rotationDialog);
  function positionRotation(){
    if(!rotationDraft)return;
    const unit=getUnit(rotationDraft.id),canvas=rotationDialog.querySelector("canvas");
    if(!unit || !canvas)return;
    const c=Rules.center(unit),p=mapPosition(c.x,c.y),map=byId("map").getBoundingClientRect(),wrap=byId("mapWrap").getBoundingClientRect();
    canvas.style.left=(p.x+map.x-wrap.x)+"px";canvas.style.top=(p.y+map.y-wrap.y)+"px";
  }
  function drawRotationCoverage(ctx,geometry){
    if(!rotationDraft)return;
    const unit=getUnit(rotationDraft.id);if(!unit)return;
    positionRotation();
    if(!rotationDraft.weapon)return;
    const preview={...unit,angle:rotationDraft.angle},weapon=rotationDraft.weapon,c=Rules.center(unit),max=weapon.max;
    if(!rotationDraft.coverage){rotationDraft.coverage=[];
      for(let y=Math.max(0,Math.floor(c.y-max));y<=Math.min(Rules.mapHeight(game)-1,Math.ceil(c.y+max));y++)
      for(let x=Math.max(0,Math.floor(c.x-max));x<=Math.min(Rules.mapWidth(game)-1,Math.ceil(c.x+max));x++){
        const target={x,y,visualOnly:true},distance=Rules.dist(preview,target);
        if(distance<weapon.min || distance>weapon.max || !Rules.availableStrikes(preview,weapon,target).length)continue;
        rotationDraft.coverage.push({x,y});
      }
    }
    ctx.save();ctx.fillStyle=rotationDraft.color+"28";ctx.strokeStyle=rotationDraft.color+"88";ctx.lineWidth=1;
    for(const {x,y} of rotationDraft.coverage){const px=geometry.ox+x*geometry.tile,py=geometry.oy+y*geometry.tile;
      ctx.fillRect(px,py,geometry.tile,geometry.tile);ctx.strokeRect(px,py,geometry.tile,geometry.tile);}
    ctx.restore();
  }
  function openRotation(unit){
    const model=Rules.modelOf(unit),deploying=phase==="deployment";
    if(!(model.ship || (deploying&&model.fixedWeaponFacing)) || !["idle","deployment"].includes(phase) || !Rules.canRotate(game,unit,1))return;
    const id=unit.id,form=element("form","ship-rotation-tools"),
      title=element("h3","","旋转 · "+unitName(unit)),canvas=element("canvas","ship-rotation-preview"),
      label=element("label","ship-rotation-angle","朝向 "),slider=element("input"),value=element("output"),
      directionControl=element("div","ship-rotation-direction"),
      groups=element("div","ship-arc-groups"),details=element("div","ship-arc-details"),
      hint=element("p","ship-rotation-warning",deploying?"部署旋转不消耗首回合移动机会":"旋转后无法移动"),actions=element("div","game-dialog-actions"),
      cancel=element("button","","取消"),confirm=element("button","primary","确定旋转");
    title.id="shipRotationTitle";canvas.width=canvas.height=220;
    canvas.setAttribute("aria-label",I18n.text("拖动预览调整朝向"));
    slider.type="range";slider.min="0";slider.max="359";slider.step="1";slider.value=String((Math.round(unit.angle||0)%360+360)%360);
    slider.id="shipRotationAngle";label.htmlFor=slider.id;label.append(value);
    const colors=["#63d5ff","#f4b45c","#ad9cff","#71dfad","#ef8fab","#c8dc73"],arcGroups=[];
    for(const weapon of model.weapons.filter(w=>w.type!=="melee")){
      const arcs=new Map();
      for(const step of weapon.attack?.strikes||[]){
        const module=step.moduleId && model.modules?.find(m=>m.id===step.moduleId);
        const arc=module || step.firingArc || {idleDir:0,arc:180};
        const key=module?.id || JSON.stringify([arc.idleDir,arc.arc]);
        if(!arcs.has(key))arcs.set(key,{id:key,name:module?.bone||weapon.name,idleDir:arc.idleDir??0,arc:arc.arc??180,active:!module || (unit.moduleHp?.[module.id]??module.hp)>0});
      }
      if(arcs.size)arcGroups.push({id:weapon.id,name:weapon.name,weapon,arcs:[...arcs.values()],color:colors[arcGroups.length%colors.length]});
    }
    let chosen=arcGroups[0];
    groups.setAttribute("aria-label",I18n.text("炮塔组射界"));
    for(const group of arcGroups){
      const button=element("button","ship-arc-group",group.name+" · "+group.arcs.filter(arc=>arc.active).length+"/"+group.arcs.length);
      button.type="button";button.dataset.arcGroup=group.id;button.style.setProperty("--arc-color",group.color);
      button.onclick=()=>{chosen=group;draw();};groups.append(button);
    }
    const draw=()=>{
      const angle=Number(slider.value),ctx=canvas.getContext("2d");value.value=angle+"°";
      rotationDraft={id,model:unit.model,phase,angle,weapon:chosen?.weapon,color:chosen?.color};
      ctx.clearRect(0,0,220,220);ctx.strokeStyle="#416277";ctx.lineWidth=1;ctx.beginPath();ctx.arc(110,110,99,0,Math.PI*2);ctx.stroke();
      for(const arc of chosen?.arcs||[]){
        const middle=angle+arc.idleDir,start=(middle-arc.arc-90)*Math.PI/180,end=(middle+arc.arc-90)*Math.PI/180;
        ctx.save();ctx.strokeStyle=arc.active?chosen.color:"#84909a";ctx.fillStyle=chosen.color+"18";ctx.lineWidth=1;
        if(!arc.active)ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(110,110);ctx.arc(110,110,96,start,end);ctx.closePath();if(arc.active)ctx.fill();ctx.stroke();ctx.restore();
      }
      const radians=angle*Math.PI/180;ctx.strokeStyle="#e7c75f";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(110,110);ctx.lineTo(110+Math.sin(radians)*94,110-Math.cos(radians)*94);ctx.stroke();
      for(const button of groups.children)button.setAttribute("aria-pressed",String(button.dataset.arcGroup===chosen?.id));
      details.replaceChildren();
      if(chosen)details.append(element("strong","","射程 "+chosen.weapon.min+"–"+chosen.weapon.max));
      if(!chosen)details.append(element("p","muted","无炮塔组"));
      for(const arc of chosen?.arcs||[]){
        const row=element("div",arc.active?"":"muted",arc.name+" · 中轴 "+((angle+arc.idleDir)%360+360)%360+"° · "+(arc.arc>=180?"全向":"±"+arc.arc+"°")+(arc.active?"":" · 已损坏"));
        row.dataset.arcModule=arc.id;row.dataset.arcHeading=String(((angle+arc.idleDir)%360+360)%360);row.dataset.arcHalfAngle=String(arc.arc);row.dataset.arcActive=String(arc.active);details.append(row);
      }
    };
    const point=event=>{const box=canvas.getBoundingClientRect();slider.value=String(Math.round((Math.atan2(event.clientX-box.x-box.width/2,-(event.clientY-box.y-box.height/2))*180/Math.PI+360)%360)%360);draw();};
    canvas.onpointerdown=event=>{canvas.setPointerCapture(event.pointerId);point(event);};
    canvas.onpointermove=event=>{if(canvas.hasPointerCapture(event.pointerId))point(event);};
    canvas.onpointerup=event=>{if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);};
    slider.oninput=draw;cancel.type="button";cancel.onclick=()=>{rotationDialog.close();update();};confirm.type="submit";
    form.onsubmit=event=>{
      event.preventDefault();const current=getUnit(id),angle=Number(slider.value);
      if(!current || !Rules.canRotate(game,current,0,angle)){rotationDialog.close();update();return;}
      rotationDialog.close();
      if(Net.active)return Net.request("rotate",{unitId:id,angle});
      if(deploying)Rules.rotate(game,current,0,angle);
      else {Rules.previewRotate(game,current,0,Rules.ownerOf(current),angle);Rules.confirmMove(game,current);}
      update();
    };
    actions.append(cancel,confirm);directionControl.append(label,slider);form.append(title,directionControl,groups,details,hint,actions);rotationDialog.replaceChildren(canvas,form);
    rotationDialog.hidden=false;draw();const center=Rules.center(unit);MapCamera.focus(center.x,center.y,{preserveZoom:true});positionRotation();slider.focus();update();
  }
  for(const type of ["keydown","keyup"])rotationDialog.addEventListener(type,event=>{event.stopPropagation();if(type==="keydown"&&event.key==="Escape"){rotationDialog.close();update();}});
  window.addEventListener("page-changing",()=>rotationDialog.close());
  const confirmSkill = element("button", "primary", "确认技能"),
    skillTarget = element("span", "helper");
  confirmSkill.id="hudConfirmSkill";
  confirmSkill.hidden=skillTarget.hidden=true;
  skillTarget.id="hudSkillTarget";
  confirmSkill.onclick=()=>SkillControls.confirm();
  confirmMove.after(confirmSkill,skillTarget);
  const pickingAction = () =>
    [
      "move",
      "move-confirm",
      "attack-target",
      "attack-weapons",
      "target",
      "target",
      "hangar-launch",
      "hangar-board",
    ].includes(mode) || mode.startsWith("skill:");
  scene.append(byId("reaction"));
  const defender = byId("reaction").querySelector(".response-defender"),
    responseBody = element("div", "hud-response-body"),
    confirm = byId("confirmResponse");
  responseBody.append(...[...defender.childNodes].filter((node) => node !== confirm));
  defender.append(responseBody, confirm);
  byId("deploymentControls").prepend(byId("deploymentAuto"), byId("confirmDeployment"));
  byId("hudTurnActions").append(byId("endTurn"));
  // 查看资料是玩家主动打开的开关，不随单位选择重置。
  let infoEnabled = false;
  const infoButton = element("button", "", "信息");
  infoButton.dataset.unitCommand = "info";
  infoButton.setAttribute("aria-controls", "hudUnitPanel");
  infoButton.onclick = () => {
    infoEnabled = !infoEnabled;
    refresh();
  };
  let tab = "overview",
    lastSelection = null,
    lastMode = "select",
    rosterOpen = false,
    consoleSize = "normal";
  const tabs = [...scene.querySelectorAll("[data-hud-tab]")];
  legend.hidden = true;
  function applyTab() {
    for (const button of tabs) {
      const active = button.dataset.hudTab === tab;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    }
    for (const pane of byId("unitPanel").querySelectorAll("[data-hud-pane]")) {
      pane.hidden = pane.dataset.hudPane !== tab;
      pane.id = "hudPane-" + pane.dataset.hudPane;
      pane.setAttribute("role", "tabpanel");
      pane.setAttribute(
        "aria-labelledby",
        tabs.find((b) => b.dataset.hudTab === pane.dataset.hudPane).id,
      );
    }
    for (const button of tabs)
      button.setAttribute("aria-controls", "hudPane-" + button.dataset.hudTab);
  }
  function setTab(value) {
    tab = value;
    infoEnabled = true;
    refresh();
    byId("unitPanel").scrollTop = 0;
  }
  for (const button of tabs) {
    button.onclick = () => setTab(button.dataset.hudTab);
    button.onkeydown = (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const next =
        tabs[(tabs.indexOf(button) + (event.key === "ArrowRight" ? 1 : 2)) % tabs.length];
      setTab(next.dataset.hudTab);
      next.focus();
    };
  }
  function toggleRoster(value = !rosterOpen) {
    rosterOpen = value;
    roster.hidden = !value;
    byId("hudToggleRoster").setAttribute("aria-expanded", String(value));
  }
  byId("hudToggleRoster").onclick = () => toggleRoster();
  byId("hudCloseRoster").onclick = () => toggleRoster(false);
  byId("hudToggleLegend").onclick = () => {
    legend.hidden = !legend.hidden;
    byId("hudToggleLegend").setAttribute("aria-expanded", String(!legend.hidden));
  };
  function resizeConsole(size) {
    consoleSize = size;
    scene.dataset.consoleSize = size;
    const open = size !== "collapsed";
    byId("hudCollapseConsole").textContent = open ? "−" : "+";
    byId("hudCollapseConsole").setAttribute("aria-expanded", String(open));
    byId("hudCollapseConsole").setAttribute(
      "aria-label",
      I18n.text(open ? "收起信息栏" : "展开信息栏"),
    );
    byId("hudExpandConsole").setAttribute("aria-pressed", String(size === "expanded"));
    MapCamera.refresh();
  }
  byId("hudCollapseConsole").onclick = () =>
    resizeConsole(consoleSize === "collapsed" ? "normal" : "collapsed");
  byId("hudExpandConsole").onclick = () =>
    resizeConsole(consoleSize === "expanded" ? "normal" : "expanded");
  for (const id of ["showLog", "showChat"])
    byId(id).addEventListener("click", () => {
      if (consoleSize === "collapsed") resizeConsole("normal");
    });
  function clearSelection() {
    if (pendingMovement()) return;
    if (pageView !== "game" || !["idle", "deployment"].includes(phase)) return;
    selected = weaponId = null;
    mode = "select";
    AttackControls.reset();
    update();
  }
  function cancelAction() {
    if (AttackControls.changing()) return AttackControls.resumeTarget();
    if (pageView !== "game" || !["idle", "deployment"].includes(phase) || !pickingAction()) return;
    if (pendingMovement()) return finishMovement(false);
    window.HangarUI?.cancel();
    SkillControls.reset();
    AttackControls.reset();
    weaponId = null;
    mode = "select";
    update();
  }
  byId("hudCancelAction").onclick = cancelAction;
  byId("hudCloseUnit").onclick = () => {
    infoEnabled = false;
    refresh();
  };
  byId("hudSelectionSummary").onclick = () => {
    infoEnabled = true;
    refresh();
  };
  document.addEventListener("keydown", (event) => {
    if (
      event.repeat ||
      event.defaultPrevented ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      pageView !== "game" ||
      !["idle", "deployment"].includes(phase) ||
      event.target.closest("input,textarea,select,[contenteditable=true]") ||
      document.querySelector("dialog[open], .overlay:not([hidden])")
    )
      return;
    const key = event.key.toLowerCase();
    if (key === "b") {
      const button = phase === "deployment" ? byId("confirmDeployment") : byId("endTurn");
      if (!button.hidden && !button.disabled && button.getClientRects().length) {
        event.preventDefault();
        button.click();
      }
      return;
    }
    if (phase !== "idle") return;
    if (pendingMovement()) {
      const button = key === "q" ? confirmMove : key === "w" ? byId("hudCancelAction") : null;
      if (button) {
        event.preventDefault();
        if (!button.disabled && button.getClientRects().length) button.click();
      }
      return;
    }
    const command = { q: "move", w: "attack", e: "skills", h: "hangar", v: "wait" }[key];
    if (!command) return;
    const button = [...document.querySelectorAll(`[data-unit-command="${command}"]`)].find(
      (b) => !b.disabled && b.getClientRects().length,
    );
    if (button) {
      event.preventDefault();
      button.click();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key !== "Escape" ||
      event.defaultPrevented ||
      pageView !== "game" ||
      event.target.closest("input,textarea,select") ||
      document.querySelector("dialog[open], .overlay:not([hidden])")
    )
      return;
    if (pickingAction()) cancelAction();
    else if (rosterOpen) toggleRoster(false);
    else clearSelection();
  });
  let fps = null,
    fpsWindowStart = null,
    fpsFrames = 0;
  function refreshPing() {
    const text =
      "PING " +
      (Net.local ? I18n.text("离线") : Net.pingMs === null ? "—" : Net.pingMs + " ms") +
      " / FPS " +
      (fps ?? "—");
    const label = byId("hudPing");
    if (label.textContent !== text) label.textContent = text;
  }
  function resetFps() {
    fps = fpsWindowStart = null;
    fpsFrames = 0;
    refreshPing();
  }
  function recordFrame(realTime) {
    // Use the original RAF timestamp, independent of replay speed or game time.
    if (fpsWindowStart === null || realTime < fpsWindowStart) {
      fpsWindowStart = realTime;
      fpsFrames = 0;
      return;
    }
    fpsFrames++;
    const elapsed = realTime - fpsWindowStart;
    if (elapsed < 500) return;
    fps = Math.round((fpsFrames * 1000) / elapsed);
    fpsWindowStart = realTime;
    fpsFrames = 0;
    refreshPing();
  }
  document.addEventListener("visibilitychange", resetFps);
  function refreshRoomStatus() {
    const snapshot = Net.active ? Net.snapshot : null;
    MatchIncome.render(byId("hudMatchIncome"), snapshot);
    const roomName = Net.local
      ? "离线" +
        ({ dominion: "占山为王模式", mission: "任务模式", sweep: "合约模式", battlefield: "雇佣兵战争模式", quick: "快速战" }[
          snapshot?.settings?.mode
        ] || "常规战")
      : snapshot?.room || Net.room || "—";
    const roomLabel = byId("hudRoomName");
    roomLabel.textContent = I18n.text("房间名") + ": " + roomName;
    roomLabel.title = roomName;
    refreshPing();
    const members = (snapshot?.members || []).filter(
      (member) =>
        member.connected &&
        !(["mission", "sweep"].includes(snapshot?.settings?.mode) && member.bot) &&
        !(snapshot?.settings?.mode === "battlefield" && member.seat !== null && member.seat < 2),
    );
    const players = members.filter((member) => member.seat !== null).length;
    const spectators = members.length - players;
    byId("hudPlayerCount").textContent =
      I18n.text("玩家人数") +
      ": " +
      players +
      "/" +
      (["mission", "sweep"].includes(snapshot?.settings?.mode) ? Rules.getMap(snapshot.settings.mapId).playersPerTeam : (snapshot?.connected?.length || 0) - (snapshot?.settings?.mode === "battlefield" ? 2 : 0)) +
      (spectators ? " · " + I18n.text("观战玩家") + ": " + spectators : "");
    byId("hudPlayerCount").title = byId("hudPlayerCount").textContent;
  }
  byId("spectatorView").onchange = () => {
    const value = byId("spectatorView").value;
    Net.request("spectate", { team: value === "global" ? null : Number(value) });
  };
  function updateSquadClearance() {
    const bounds = squadStrip.hidden ? null : squadStrip.getBoundingClientRect();
    const clearance = bounds ? Math.ceil(scene.getBoundingClientRect().bottom - bounds.top + 8) : 0;
    scene.style.setProperty("--squad-strip-clearance", clearance + "px");
    scene.style.setProperty(
      "--squad-strip-height",
      bounds ? Math.ceil(bounds.height + 8) + "px" : "0px",
    );
  }
  if (window.ResizeObserver) new ResizeObserver(updateSquadClearance).observe(squadStrip);
  window.addEventListener("resize", updateSquadClearance);
  function refreshMovement() {
    const unit = mode === "move-confirm" ? pendingMovement() : null;
    const animating = unit && PlanningUI.motion(unit, performance.now());
    confirmMove.disabled = !!animating || isBusy(true);
    byId("hudCancelAction").disabled = !!unit && (!!animating || isBusy(true));
  }
  let swapFrom=null;
  function refresh() {
    const active = pageView === "game",
      unit = getUnit(selected),
      inCombat = ["battle", "reaction", "reaction_wait", "playback_wait", "moving"].includes(phase);
    if(rotationDraft && (!active || unit?.id!==rotationDraft.id || unit?.model!==rotationDraft.model || phase!==rotationDraft.phase || !Rules.canRotate(game,unit,0,rotationDraft.angle)))rotationDialog.close();
    const reacting = phase === "reaction" && pending,
      squadUnit = reacting ? getUnit(pending.target) : unit,
      squadRoot=squadUnit?.embarked?.exposed ? getUnit(squadUnit.embarked.carrierId) || squadUnit : squadUnit,
      squad = squadRoot ? Rules.squadMembers(game, squadRoot) : [],
      responseMember = reacting ? counterDraft(squadUnit).memberId : null;
    const showSquad =
      active &&
      squad.length &&
      squad.every(Rules.squadEligible) &&
      !pendingMovement() &&
      (!inCombat || reacting);
    const deploymentCarrier =
      active && phase === "deployment" && unit && Rules.hangars.of(unit).length > 0;
    squadStrip.hidden = !showSquad && !deploymentCarrier;
    squadStrip.replaceChildren();
    if(swapFrom && (!showSquad || !["idle","deployment"].includes(phase) || (phase!=="deployment" && mode!=="select") || !Rules.canSwapSquad(game,getUnit(swapFrom))))swapFrom=null;
    if (showSquad) {
      const actors=Rules.squadAttackMembers(game,squadUnit),slots=Rules.formationSlots(game,squadUnit);
      if(swapFrom && (!actors.some(u=>u.id===swapFrom) || !["idle","deployment"].includes(phase)))swapFrom=null;
      const heading = element(
        "strong",
        "",
        I18n.text("小队") +
          ` ${actors.length}/6 · ${squad.reduce((sum, u) => sum + Rules.squadCapacity(u, game), 0)}/12`,
      );
      const members = element("div", "squad-members");
      const all = element("button", "", I18n.text("全队"));
      all.id = "squadSelectAll";
      all.setAttribute("aria-pressed", String(reacting ? !responseMember : !squadSingleMove));
      all.onclick = () => (reacting ? selectCounterMember(null) : select(unit.id));
      const left = element("div", "squad-left");
      const formation = element("div", "squad-portraits");
      for (const member of actors) {
        const button = element("button", "", "");
        button.dataset.squadMember = member.id;
        button.setAttribute(
          "aria-pressed",
          String(
            reacting ? responseMember === member.id : squadSingleMove && member.id === selected,
          ),
        );
        const slot=slots.get(member.id) ?? 0;
        button.style.gridColumn=String(slot%3+1);button.style.gridRow=slot>=3 ? "2" : "1";
        button.title = unitName(member);
        const image = document.createElement("img");
        image.src = unitIcon(member.model, member.pilot);
        image.alt = unitName(member);
        button.append(image);
        const row=element("small","squad-row-label",Rules.squadRow(game,member) === "front" ? "前" : "后");
        button.dataset.row=Rules.squadRow(game,member);button.append(row);
        button.title += " · "+(button.dataset.row === "front" ? "前排" : "后排（命中×0.9，不参与格斗）");
        button.onclick = () => {
          if(swapFrom){
            const source=swapFrom;swapFrom=null;
            if(source===member.id){update();return;}
            if(Net.active)Net.request("swap_squad",{unitId:source,otherUnitId:member.id});
            else {try{Rules.swapSquad(game,getUnit(source),member);update();}catch(error){note(error.message);}}
          } else reacting ? selectCounterMember(member.id) : select(member.id,{single:true});
        };
        formation.append(button);
      }
      for(let slot=0;slot<6;slot++)if(!actors.some(member=>slots.get(member.id)===slot)){
        const empty=element("button","squad-empty","");empty.type="button";empty.disabled=true;
        empty.dataset.squadEmpty=String(slot);empty.style.gridColumn=String(slot%3+1);empty.style.gridRow=slot>=3?"2":"1";
        empty.setAttribute("aria-label",I18n.text("空位")+" "+(slot+1));empty.title=I18n.text("空位");
        const image=document.createElement("img");image.alt="";
        image.src="data:image/svg+xml,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="13" r="7" fill="#667380"/><path d="M7 36v-5a13 13 0 0 1 26 0v5" fill="#667380"/></svg>');
        empty.append(image);formation.append(empty);
      }
      members.append(all, formation);
      if(["idle","deployment"].includes(phase) && (!Net.active || Net.canControl(unit))){
        const swap=element("button","",swapFrom ? "取消" : "交换");swap.id="squadSwap";
        swap.setAttribute("aria-label",swapFrom ? "取消交换" : "交换站位");
        swap.disabled=isBusy() || !Rules.canSwapSquad(game,unit) || (Net.active && Net.awaiting);
        swap.setAttribute("aria-pressed",String(!!swapFrom));
        swap.title=swapFrom ? "点击另一单位头像交换站位" : "选择单位头像，点击交换，再点击另一单位头像";
        swap.onclick=()=>{swapFrom=swapFrom ? null : unit.id;update();};members.append(swap);
      }
      left.append(heading, members);
      squadStrip.append(left);
      heading.title = I18n.text("回避加成") + " +" + Rules.squadEvasion(game, squadUnit) + "%";
      if (phase === "idle" && unit.team === game.team && (!Net.active || Net.canControl(unit))) {
        const fight = element(
          "button",
          "",
          I18n.text(AttackControls.combatModeLabel()),
        );
        fight.id = "squadCombatMode";
        fight.disabled =
          isBusy() || !AttackControls.editable(unit) || (Net.active && !Net.canAct());
        fight.onclick = () => AttackControls.cycleCombatMode();
        members.append(fight);
      }
    }
    if (deploymentCarrier) {
      const hangar = element("button", "", "格纳库");
      hangar.id = "hudDeploymentHangar";
      hangar.disabled =
        !Deployment.canEditUnit(unit) &&
        !Rules.hangars.cargo(game, unit).some(Deployment.canEditUnit);
      hangar.onclick = () => HangarUI.open(unit);
      squadStrip.append(hangar);
    }
    const regionId = Net.snapshot?.campaign?.activeRegion;
    const region =
      active && regionId && CAMPAIGN_WORLD.regions.find((item) => item.id === regionId);
    const regionLabel = byId("hudCampaignRegion");
    regionLabel.hidden = !region;
    regionLabel.textContent = region
      ? (CAMPAIGN_WORLD.settings.headquarters?.some((base) => base.region === region.id)
          ? "★ "
          : "") + I18n.text(region.name)
      : "";
    document.body.classList.toggle("battle-hud-active", active);
    if (active) refreshRoomStatus();
    const headerButtons = scene.querySelector(".header-buttons");
    if (active && settings.parentElement !== headerButtons) headerButtons.append(settings);
    else if (!active && settings.previousSibling !== settingsHome) settingsHome.after(settings);
    if (lastSelection !== selected) {
      tab = "overview";
      byId("unitPanel").scrollTop = 0;
      if (selected) toggleRoster(false);
    }
    if (lastMode !== mode) {
      if (mode === "target" || mode.startsWith("skill:")) tab = "skills";
    }
    lastMode = mode;
    lastSelection = selected;
    const counterPicking =
      phase === "reaction" && pending && counterDraft(getUnit(pending.target)).pickingTarget;
    const pickingTarget = AttackControls.changing() || !!counterPicking;
    scene.dataset.targetSwitch = String(pickingTarget);
    scene.dataset.counterTargetSwitch = String(!!counterPicking);
    attackPlanSummary.hidden = !(
      active &&
      ((AttackControls.changing() && AttackControls.renderSummary(attackPlanSummary, unit)) ||
        (counterPicking && renderCounterSummary(attackPlanSummary, getUnit(pending.target))))
    );
    cancelTargetSwitch.hidden = !active || !pickingTarget;
    cancelTargetSwitch.textContent = I18n.text("取消更换目标");
    const actionActive =
      active && !!unit && ["idle", "deployment"].includes(phase) && pickingAction();
    scene.dataset.actionStage = actionActive ? mode : "none";
    const spectating = active && Net.active && Net.seat === null && Net.started;
    const pendingMove = pendingMovement();
    const confirmingMove = !!pendingMove && mode === "move-confirm";
    confirmMove.textContent =
      I18n.text(
        pendingMove?.pendingMove?.rotation
          ? "确认旋转"
          : pendingMove?.pendingMove?.boarding
            ? "确认搭载"
            : "确认移动",
      ) + " (Q)";
    confirmMove.setAttribute("aria-keyshortcuts", "Q");
    if (confirmingMove) byId("hudCancelAction").setAttribute("aria-keyshortcuts", "W");
    else byId("hudCancelAction").removeAttribute("aria-keyshortcuts");
    confirmMove.hidden = !actionActive || !confirmingMove;
    const skillSelection=SkillControls.confirmation(unit);
    confirmSkill.hidden=!actionActive || !skillSelection.active;
    confirmSkill.disabled=!skillSelection.ready;
    confirmSkill.textContent=I18n.text("确认技能");
    skillTarget.hidden=confirmSkill.hidden;
    skillTarget.textContent=skillSelection.draft
      ? I18n.text("目标：") + (skillSelection.target && !skillSelection.target.groundTarget
        ? unitName(skillSelection.target)
        : Rules.columnLabel(skillSelection.draft.x)+(skillSelection.draft.y+1))
      : I18n.text("请选择技能目标");
    refreshMovement();
    byId("hudActionBand").hidden = !actionActive && !spectating;
    byId("hudCancelAction").hidden = spectating;
    byId("spectatorViewControl").hidden = !spectating;
    if (spectating) {
      const select = byId("spectatorView"),
        values = ["global", ...(Net.snapshot?.viewTeams || []).map(String)];
      if (
        Array.from(select.options)
          .map((option) => option.value)
          .join("|") !== values.join("|")
      ) {
        select.replaceChildren();
        for (const value of values) select.add(new Option("", value));
      }
      for (const option of select.options)
        option.textContent =
          option.value === "global"
            ? I18n.text("上帝视角")
            : I18n.text("队伍") + (Number(option.value) + 1);
      select.value = Net.snapshot?.viewTeam === null ? "global" : String(Net.snapshot?.viewTeam);
      select.disabled = !!Net.awaiting || Net.socket?.readyState !== WebSocket.OPEN;
    }
    const attackPlanner = byId("hudAttackPlanner"),
      editor = byId("attackEditor");
    attackPlanner.replaceChildren();
    attackPlanner.hidden =
      !actionActive || !["attack-weapons", "attack-target"].includes(mode) || !editor;
    if (!attackPlanner.hidden) attackPlanner.append(editor);
    // 攻击编排临时使用同一个右侧栏，不改变信息开关。
    panel.hidden =
      !active || !unit || inCombat || (attackPlanner.hidden && (!infoEnabled || actionActive));
    panel.dataset.planning = String(!attackPlanner.hidden);
    panel.querySelector(".hud-panel-heading span").textContent = I18n.text(
      attackPlanner.hidden ? "单位信息" : "武器与攻击计划",
    );
    byId("unitPanel").hidden = !attackPlanner.hidden;
    scene.querySelector(".hud-unit-tabs").hidden = !attackPlanner.hidden;
    byId("hudCloseUnit").hidden = !attackPlanner.hidden;
    infoButton.setAttribute("aria-pressed", String(infoEnabled));
    if (actionActive) {
      const moving = mode === "move" || mode === "move-confirm",
        attacking = mode.startsWith("attack");
      byId("hudCancelAction").textContent = I18n.text(
        moving
          ? "取消移动"
          : attacking
            ? "取消攻击"
            : mode === "hangar-launch"
              ? "取消出击"
              : mode === "hangar-board"
                ? "取消搭载"
                : "取消技能",
      );
      if (confirmingMove) byId("hudCancelAction").textContent += " (W)";
    }
    roster.hidden = !active || !rosterOpen || inCombat;
    const actions = byId("unitActions");
    commands.replaceChildren();
    const own = unit && unit.team === game.team && (!Net.active || Net.canControl(unit));
    commands.hidden =
      !active || !unit || inCombat || actionActive || !!rotationDraft || !["idle", "deployment"].includes(phase);
    scene.dataset.unitCommands = String(!commands.hidden);
    if (!commands.hidden) {
      const row = actions || element("div", "actions");
      const canCommand =
        own &&
        phase === "idle" &&
        !(unit.acted && !unit.plan && !unit.squadOrder) &&
        !isAI() &&
        (!Net.active || Net.canAct()) &&
        !isBusy();
      for (const button of row.children)
        button.hidden =
          button.dataset.shipTurn && phase === "deployment"
            ? true
            : button.dataset.unitCommand === "hangar"
            ? phase !== "idle"
            : !canCommand;
      row.prepend(infoButton);
      infoButton.hidden = false;
      row.prepend(capturePoint);
      row.append(transferRegion, transferControl);
      const extractionButton=ContractUI.actionButton(unit);
      if(extractionButton)row.append(extractionButton);
      transferControl.hidden = !own || !game.campaignBattlefield || phase !== "idle";
      transferControl.disabled = !canCommand || !!unit.plan || !!unit.pendingMove;
      transferControl.onclick = async () => {
        const recipients = (Net.snapshot?.members || []).filter(
          (member) =>
            Number.isInteger(member.seat) &&
            Rules.seatTeam(member.seat) === unit.team &&
            member.seat !== Rules.ownerOf(unit),
        );
        const to = await GameDialog.choose({
          title: "转交控制权",
          message: "选择接收玩家，搭载单位会随运输单位一并转交。",
          actions: [
            { label: "取消", value: null },
            ...recipients.map((member) => ({ label: member.name, value: member.seat })),
          ],
        });
        if (Number.isInteger(to)) Net.request("unit_control_transfer", { unitId: unit.id, to });
      };
      const point = unit && Rules.campaignBattlefield?.nodeAt(Rules, game, unit);
      capturePoint.hidden =
        !own ||
        !point ||
        phase !== "idle" ||
        game.campaignBattlefield?.owners[point.id] === unit.team ||
        !!unit.flying ||
        Rules.modelOf(unit).movementType === "air" ||
        !!unit.embarked;
      capturePoint.disabled =
        !canCommand || !Rules.campaignBattlefield?.canCapture(Rules, game, unit);
      capturePoint.onclick = () => Net.request("capture_point", { unitId: unit.id });
      capturePoint.textContent = I18n.text("占领");
      const recovery = ContractUI.recoveryObjective(unit);
      if (recovery && own && phase === "idle") {
        capturePoint.hidden = false;
        capturePoint.textContent = I18n.text("回收");
        capturePoint.disabled = !canCommand || unit.acted || !!unit.plan || !!unit.pendingMove;
        capturePoint.onclick = () => Net.request("contract_interact", {unitId:unit.id,objectiveId:recovery.id});
      }
      const exits = unit ? Rules.campaignBattlefield?.exits(Rules, game, unit) || [] : [];
      transferRegion.hidden = !own || phase !== "idle" || !exits.length;
      transferRegion.disabled = isBusy() || !Net.canAct() || isAI();
      transferRegion.onclick = async () => {
        const destination = await GameDialog.choose({
          title: "转移部队",
          message: "离开当前战场，下一战略回合抵达目标区块。",
          actions: [
            { label: "取消", value: null },
            ...exits.map((gate) => ({
              label:
                CAMPAIGN_WORLD.regions.find((region) => region.id === gate.region)?.name ||
                gate.region,
              value: gate.region,
              primary: exits.length === 1,
            })),
          ],
        });
        if (destination) Net.request("region_transfer", { unitId: unit.id, region: destination });
      };

      if (pendingMove) for (const button of row.querySelectorAll("button")) button.disabled = true;
      row.hidden = false;
      commands.append(row);
    } else if (actions) actions.hidden = true;
    byId("hudSelectionSummary").textContent = unit ? unitName(unit) : "";
    byId("hudSelectionSummary").setAttribute("data-i18n-ignore", "");
    if (!active) {
      toggleRoster(false);
      legend.hidden = true;
      byId("hudToggleLegend").setAttribute("aria-expanded", "false");
    }
    applyTab();
    updateSquadClearance();
  }
  window.BattleHUD = {
    openRotation,
    drawRotationCoverage,
    rotationAngle: id=>rotationDraft?.id===id?rotationDraft.angle:null,
    refresh,
    refreshMovement,
    refreshRoomStatus,
    recordFrame,
    resetFps,
    setTab,
    clearSelection,
  };
  refresh();
  return window.BattleHUD;
})();
