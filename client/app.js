/* 客户端界面与输入入口。联机结果来自 network.js。
 * Rules 是共用规则；UnitModels 是机体配置；byId("名字") 查找 HTML 元素。
 * 阅读路线：update → renderPanel → drawMap → beginAttack → drawBattle。
 */
"use strict";
const byId = (id) => document.getElementById(id),
  Rules = Tactics,
  UnitModels = Rules.models;
// selected 是单位 ID；phase 是流程阶段；mode 区分选中单位与选择目标。
let game = Rules.create(),
  selected = null,
  weaponId = null,
  mode = "select",
  phase = "start",
  pending = null,
  response = "defend",
  counterId = null,
  counterTargetId = null,
  log = [],
  assetsReady = false,
  clock = 0,
  moving = null,
  hover = null,
  mapGeo = null,
  battleView = null,
  session = 0,
  toastTimer = null;
let pageView = "menu";
let animationFrameId = null;
// 页面生命周期：Menu 和房间准备只显示界面，不启动战斗 Canvas 绘制。
function setPageView(view) {
  if (view !== "game") TurnFlow.reset();
  if (view !== "game" && pageView === "game" && battleView) {
    if (battleView.mapBattle) MapCombat.suspend(battleView);
    else BattleWindow.suspend(battleView);
  }
  if (view !== "game") WeaponAudio.stop();
  pageView = view;
  byId("gameScene").hidden = view !== "game";
  byId("start").hidden = view !== "menu";
  byId("roomPreparation").hidden = view !== "room";
  byId("formationScreen").hidden = view !== "formation";
  byId("roomSettings").hidden = !Net.active;
  if (view !== "game")
    for (const id of ["reaction", "battle", "victory", "help"]) byId(id).hidden = true;
  if (view === "game") startRendering();
  else if (!window.isLayoutPreview) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}
function startRendering() {
  if (assetsReady && animationFrameId === null) animationFrameId = requestAnimationFrame(tick);
}
const teamName = (t) => (t ? "红方" : "蓝方"),
  other = (t) => 1 - t,
  getUnit = (id) => game.units.find((u) => u.id === id),
  battleUnit = (id) => battleView?.actors?.find((unit) => unit.id === id) || getUnit(id),
  getWeapon = (u, id) => Rules.modelOf(u).weapons.find((w) => w.id === id),
  unitIcon = (model) => ART.assets[SpriteRenderer.models[model].icon],
  unitName = (u) => Rules.unitName(u),
  formatNumber = (n) => Number(n).toLocaleString("en-US"),
  isAI = () => !Net.active && game.ai && game.team === 1,
  isBusy = () =>
    phase !== "idle" || !!Net.awaiting || (!Net.active && MapEffects.pending()) || TurnFlow.active;
function note(text) {
  setNamedText(byId("toast"), text);
  byId("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => byId("toast").classList.remove("show"), 2200);
}
function logUnit(unit) {
  return `[${teamName(unit.team)}][${UnitIdentity.owner(unit).name}]${unitName(unit)}`;
}
function addLog(text) {
  log.unshift(text);
  log = log.slice(0, 70);
  Chat.setLog(log);
}
function playerNameClass(memberId, hostId = Net.snapshot?.hostId, selfId = Net.memberId) {
  return (
    "player-name " +
    (memberId === hostId ? "player-host" : memberId === selfId ? "player-self" : "player-other")
  );
}
function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}
// Keep player-written unit names literal while surrounding UI text is translated.
function setNamedText(el, text, names = game.units.map((unit) => unit.customName).filter(Boolean)) {
  el.replaceChildren();
  let rest = String(text);
  const unique = [...new Set(names)].sort((a, b) => b.length - a.length);
  while (rest) {
    let next = null;
    for (const name of unique) {
      const at = rest.indexOf(name);
      if (at >= 0 && (!next || at < next.at)) next = { name, at };
    }
    if (!next) {
      el.append(document.createTextNode(rest));
      break;
    }
    if (next.at) el.append(document.createTextNode(rest.slice(0, next.at)));
    const literal = document.createElement("span");
    literal.setAttribute("data-i18n-ignore", "");
    literal.textContent = next.name;
    el.append(literal);
    rest = rest.slice(next.at + next.name.length);
  }
}
function element(tag, cls, text) {
  let el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) setNamedText(el, text);
  return el;
}
function htmlWeapon(w, u) {
  w = Rules.weaponStats(w, u);
  const liveStrikes = Rules.availableStrikes(u, w),
    liveShots = new Set(liveStrikes.map((step) => step.shotIndex)).size,
    damage =
      w.damagePerShot * liveStrikes.reduce((sum, step) => sum + (step.damageMultiplier ?? 1), 0);
  const damageLabel = w.attack.strikes.some((s) => s.damageMultiplier !== 1)
    ? "分段 " +
      w.attack.strikes.map((s) => formatNumber(w.damagePerShot * s.damageMultiplier)).join(" + ")
    : "单发 " +
      formatNumber(w.damagePerShot) +
      " × " +
      (liveShots < w.shotCount ? liveShots + "/" + w.shotCount : w.shotCount) +
      " 发" +
      (w.hitsPerShot > 1 ? " × " + w.hitsPerShot + " 段" : "");
  const broken = Rules.brokenWeaponParts(u, w);
  return /* HTML */ `<div class="weapon-title">
      <span class="weapon-name">${w.name}</span
      ><span class="type ${w.type}">${Rules.typeNames[w.type]}</span>
    </div>
    <div class="weapon-meta">
      射程 ${w.min}–${w.max}　${damageLabel} = ${formatNumber(damage)}　命中 ${w.hit}%<br />EN
      ${w.en} / 剩余 ${u.en}
      ${broken.length ? `<br /><span class="red">${broken.map((part) => I18n.text(Rules.partNames[part])).join(" / ")} · ${I18n.text("部位损坏，无法使用")}</span>` : ""}
    </div>`;
}
// 刷新顶栏、单位列表、提示和右侧指令，不推进回合。
function update() {
  if (pageView !== "game" && !window.isLayoutPreview) {
    if (pageView === "room" && Net.snapshot) RoomPanel.render(Net.snapshot);
    return;
  }
  const map = Rules.getMap(game.mapId),
    space = map.environment === "space";
  byId("mapEnvironment").className = "map-environment " + (space ? "is-space" : "is-ground");
  byId("mapEnvironment").textContent = space ? "宇宙" : "地面";
  byId("mapSectorLabel").textContent = map.name;
  Deployment.render();
  Chat.refreshStatus();
  const busy = isBusy(),
    u = getUnit(selected);
  byId("turnBadge").textContent = `第${game.round}回合 · ${teamName(game.team)}`;
  byId("turnBadge").style.color = game.team ? "var(--red)" : "var(--blue)";
  byId("phaseTitle").textContent = teamName(game.team) + (isAI() ? "AI行动阶段" : "行动阶段");
  if (phase === "deployment") byId("phaseTitle").textContent = "开局部署";
  byId("phaseEyebrow").textContent = game.team ? "RED PHASE" : "BLUE PHASE";
  byId("endTurn").textContent = Net.active
    ? "完成计划 · 结束行动"
    : "结束" + teamName(game.team) + "回合";
  byId("endTurn").disabled = busy || isAI() || (Net.active && !Net.canAct());
  byId("modeLabel").textContent = Net.active
    ? (Net.local ? "离线遭遇战" : "联机遭遇战") + " · " + Net.roleName()
    : "遭遇战";
  renderRoster(busy);
  let hint = busy
    ? phase === "moving"
      ? "单位移动中…"
      : phase === "reaction"
        ? "等待防守方选择应战方式。"
        : phase === "battle"
          ? "正在结算交战。"
          : "请选择游戏模式。"
    : isAI()
      ? "AI正在规划移动与攻击。"
      : mode === "target"
        ? "点击红色目标机体，或在右侧选择目标。"
        : u?.team === game.team && !u.acted
          ? "点击蓝色格子移动，或直接选择武器攻击。"
          : "选择己方尚未行动的单位。";
  if (Net.active) {
    if (phase === "reaction_wait") hint = "等待其他玩家选择反击、防御或回避。";
    else if (phase === "playback_wait") hint = "等待所有玩家完成演出。";
    else if (phase === "waiting") hint = "等待红方加入房间。";
    else if (phase === "disconnected") hint = "连接中断：战局已暂停，恢复连接后继续。";
    else if (phase === "connecting") hint = "正在连接服务器…";
    else if (!busy && Net.snapshot?.turnDone?.[Net.seat]) hint = "已结束个人行动，等待队友。";
    else if (!busy && game.team !== Net.team()) hint = "对手回合，可查看单位并等待行动。";
  }
  if (phase === "deployment") hint = "在高亮出生区内调整位置，两队确认后开始回合。";
  if (MapEffects.pending()) hint = "单位击破演出中…";
  if (TurnFlow.active) hint = "回合交接中…";
  byId("hint").textContent = hint;
  byId("hint").hidden = phase === "deployment";
  renderPanel();
  TurnFlow.refreshAutoEnd();
}
// 左侧只按当前视角显示我军；观战者可查看两队，每名所有者单独成组。
function renderRoster(busy) {
  const viewerTeam = Net.active
    ? Net.seat === null
      ? null
      : Rules.seatTeam(Net.seat)
    : game.ai
      ? 0
      : null;
  const roster = byId("unitRoster"),
    scrollTop = roster.scrollTop;
  const allies = byId("allies"),
    enemies = byId("enemies");
  allies.replaceChildren();
  enemies.replaceChildren();
  enemies.hidden = viewerTeam !== null;
  const visible = game.units.filter((unit) => viewerTeam === null || unit.team === viewerTeam);
  const owners = [...new Set(visible.map(Rules.ownerOf))].sort((a, b) =>
    a === Net.seat ? -1 : b === Net.seat ? 1 : a - b,
  );
  for (const seat of owners) {
    const units = visible.filter((unit) => Rules.ownerOf(unit) === seat),
      identity = UnitIdentity.owner(units[0]);
    const group = element("section", "roster-owner"),
      heading = element("div", "side-title roster-owner-heading");
    group.dataset.ownerSeat = seat;
    const name = element(
      "strong",
      identity.member ? playerNameClass(identity.member.id) : "",
      identity.name,
    );
    if (identity.member) name.setAttribute("data-i18n-ignore", "");
    heading.append(
      name,
      element(
        "span",
        "muted roster-owner-count",
        units.filter((unit) => unit.hp > 0).length + "/" + units.length,
      ),
    );
    group.append(heading);
    for (const unit of units) {
      const model = Rules.modelOf(unit),
        button = element(
          "button",
          "roster-unit" + (selected === unit.id ? " selected" : "") + (unit.hp <= 0 ? " dead" : ""),
        );
      const image = element("img");
      image.src = unitIcon(unit.model);
      image.alt = "";
      const info = element("span", "roster-unit-info");
      const name = element("strong", "roster-unit-name", unitName(unit));
      if (unit.customName) name.setAttribute("data-i18n-ignore", "");
      info.append(name);
      for (const [kind, current, maximum] of [
        ["hp", unit.hp, model.hp],
        ["en", unit.en, model.en],
      ]) {
        const track = element("div", kind === "hp" ? "hp-track" : "en-track");
        track.setAttribute("role", "progressbar");
        track.setAttribute("aria-label", kind.toUpperCase());
        track.setAttribute("aria-valuemin", "0");
        track.setAttribute("aria-valuemax", maximum);
        track.setAttribute("aria-valuenow", Math.max(0, current));
        track.title = `${kind.toUpperCase()} ${formatNumber(current)} / ${formatNumber(maximum)}`;
        const fill = element(
          "div",
          kind === "hp" ? "hp-fill" + (unit.team ? " red" : "") : "en-fill",
        );
        fill.style.width = Math.max(0, Math.min(100, (current / maximum) * 100)) + "%";
        track.append(fill);
        info.append(track);
      }
      info.append(
        element(
          "small",
          "roster-status",
          unit.hp <= 0
            ? "已击破"
            : unit.plan
              ? "已计划攻击"
              : unit.acted
                ? "行动结束"
                : unit.moved
                  ? "已移动 · 可攻击"
                  : "未行动",
        ),
      );
      button.dataset.unitId = unit.id;
      button.append(image, info);
      button.setAttribute("aria-label", unitName(unit) + " · " + I18n.text("定位单位"));
      button.disabled = unit.hp <= 0 || (busy && phase !== "deployment");
      button.onclick = () => {
        MapCamera.focus(unit.x, unit.y);
        if (phase === "deployment") {
          GameAudio.play("selectUnitSound");
          selected = unit.id;
          weaponId = null;
          mode = "select";
          update();
        } else select(unit.id);
      };
      group.append(button);
    }
    (viewerTeam === null && units[0].team === 1 ? enemies : allies).append(group);
  }
  roster.scrollTop = scrollTop;
}
// 右侧单位详情：属性、动作、武器和目标。选中单位后重新生成。
function renderPanel() {
  let panel = byId("unitPanel"),
    u = getUnit(selected);
  if (!u) {
    panel.innerHTML =
      '<div class="empty">选择地图上的机体，查看移动范围与可用武器。</div><div class="rule-box">各机体携带自己的主武器套件与固定武装。选择单位查看武器射程与防护。</div>';
    return;
  }
  let m = Rules.modelOf(u),
    own = u.team === game.team && (!Net.active || Net.owns(u)),
    canCommand =
      own && (!u.acted || !!u.plan) && !isBusy() && !isAI() && (!Net.active || Net.canAct());
  panel.replaceChildren();
  let head = element("div", "unit-card-head");
  head.innerHTML = /* HTML */ `<img src="${unitIcon(u.model)}" alt="" />
    <div>
      <strong class="${u.team ? "red" : "blue"}">${escapeHtml(unitName(u))}</strong
      ><small>${m.code} · ${m.kitName} · ${teamName(u.team)}</small>
    </div>`;
  if (u.customName) head.querySelector("strong").setAttribute("data-i18n-ignore", "");
  panel.append(head);
  const identity = UnitIdentity.owner(u),
    ownership = element("div", "unit-ownership"),
    ownerName = element(
      "strong",
      identity.member ? playerNameClass(identity.member.id) : "",
      identity.name,
    );
  ownerName.id = "unitOwner";
  if (Net.active && identity.member) ownerName.setAttribute("data-i18n-ignore", "");
  ownership.append(
    element("span", "", "所有者："),
    ownerName,
    element("span", "", " · "),
    element("strong", "", identity.team),
  );
  ownership.id = "unitOwnership";
  panel.append(ownership);
  let stats = element("div", "stats");
  stats.innerHTML = /* HTML */ `<div>
      <span>HP</span>${formatNumber(u.hp)} / ${formatNumber(m.hp)}
    </div>
    <div><span>EN</span>${u.en} / ${m.en}</div>
    <div><span>移动力</span>${m.move} 格</div>
    <div><span>反应系数</span>${m.mobility}</div>
    <div><span>命中系数</span>${m.accuracy}%</div>
    <div><span>地面适应性</span>${m.adaptability.ground}%</div>
    <div><span>宇宙适应性</span>${m.adaptability.space}%</div>
    <div><span>零件强度</span>${m.partStructuralStrength}</div>
    <div>
      <span>盾牌</span
      >${m.shield.hp > 0 ? formatNumber(u.shield ?? 0) + " / " + formatNumber(m.shield.hp) : "无独立盾牌"}
    </div>
    <div>
      <span>当前位置</span>${String.fromCharCode(65 + u.x)}${u.y + 1} ·
      ${Rules.terrainStyle(game.mapId, game.tiles[u.y][u.x]).name}
    </div>`;
  panel.append(stats);
  const partStatus = element("div", "rule-box");
  partStatus.id = "unitPartStatus";
  partStatus.append(element("strong", "", "部位状态"));
  for (const [part, name] of Object.entries(Rules.partNames)) {
    const broken = !!u.brokenParts?.[part];
    const label = element(
      "span",
      broken ? "red" : "muted",
      " · " + I18n.text(name) + ": " + I18n.text(broken ? "损坏" : "完好"),
    );
    label.dataset.part = part;
    partStatus.append(label);
  }
  const penalty = Rules.partPenalties(u),
    effects = [];
  if (penalty.attackMultiplier < 1) effects.push(I18n.text("头部损毁：攻击力-25%"));
  if (penalty.moveMultiplier < 1)
    effects.push(I18n.text("背包损毁：移动力-25%（向下取整，至少1格）"));
  if (penalty.resistancePenalty)
    effects.push(I18n.text("四肢损毁：抗性降低") + " " + penalty.resistancePenalty + "%");
  if (effects.length) partStatus.append(element("p", "red", effects.join(" · ")));
  panel.append(partStatus);
  const protection = element("details", "rule-box");
  protection.append(element("summary", "", "防护属性"));
  protection.append(element("p", "helper", m.description));
  for (const [key, label] of [
    ["beam", "光束"],
    ["shell", "实弹"],
    ["melee", "格斗"],
    ["dp", "失衡（预留）"],
    ["sp", "特殊（预留）"],
  ]) {
    const defense = m.defenses[key];
    protection.append(
      element("div", "helper", `${label}：${defense.percent}% / 固定 ${defense.flat}`),
    );
  }
  protection.append(
    element(
      "p",
      "helper",
      `盾牌格挡率 ${Math.round(m.shield.blockChance * 100)}% · 覆盖 ${Math.round(m.shield.coverage * 100)}%`,
    ),
  );
  panel.append(protection);
  const attacks = element("details", "rule-box");
  attacks.append(element("summary", "", "伤害加成"));
  for (const [key, label] of [
    ["melee", "格斗"],
    ["shooting", "射击"],
    ["beam", "光束"],
    ["shell", "实弹"],
  ])
    attacks.append(
      element(
        "div",
        "helper",
        `${label}：${m.attackBonuses[key] >= 0 ? "+" : ""}${m.attackBonuses[key]}%`,
      ),
    );
  panel.append(attacks);
  let actions = element("div", "actions");
  for (const [label, fn, disabled] of [
    [
      "待机",
      () => {
        if (Net.active) {
          Net.request("wait", { unitId: u.id });
          return;
        }
        Rules.wait(game, u);
        addLog(`${logUnit(u)} 待机。`);
        mode = "select";
        weaponId = null;
        update();
      },
      !canCommand,
    ],
    [
      u.moved ? "撤回移动" : "移动",
      () => {
        if (!u.moved) {
          mode = "select";
          weaponId = null;
          update();
          return;
        }
        if (Net.active) {
          Net.request("undo", { unitId: u.id });
          return;
        }
        Rules.undo(game, u);
        mode = "select";
        weaponId = null;
        update();
      },
      !canCommand || (u.moved ? !Rules.canUndo(game, u) : u.acted),
    ],
    [
      "取消选武器",
      () => {
        mode = "select";
        weaponId = null;
        update();
      },
      !canCommand || mode !== "target",
    ],
  ]) {
    let b = element("button", "", label);
    b.disabled = disabled;
    b.onclick = fn;
    actions.append(b);
  }
  panel.append(actions);
  panel.append(element("div", "section-title", "WEAPONS / 选择攻击武器"));
  for (const skills of [false, true]) {
    if (skills) panel.append(element("div", "section-title", "SKILLS / 技能"));
    let list = element("div", "weapon-list");
    for (const w of m.weapons.filter((w) => (w.slot === "skill") === skills)) {
      let b = element("button", "weapon" + (weaponId === w.id ? " active" : ""));
      b.innerHTML = htmlWeapon(w, u);
      b.disabled = !canCommand || !Rules.canUse(u, w);
      b.classList.toggle("part-disabled", Rules.brokenWeaponParts(u, w).length > 0);
      b.setAttribute("aria-label", (skills ? "技能 " : "攻击武器 ") + w.name);
      b.onclick = () => {
        GameAudio.play("selectWeaponSound");
        weaponId = w.id;
        mode = "target";
        if (w.changeHeldWeapon !== false) u.heldWeapon = w.id;
        update();
      };
      list.append(b);
    }
    panel.append(list);
  }
  if (mode === "target" && weaponId && own) {
    let w = getWeapon(u, weaponId),
      targets = game.units.filter((t) => Rules.canAttack(game, u, t, w));
    panel.append(element("div", "section-title", "TARGETS / 可选目标"));
    if (!targets.length)
      panel.append(
        element("p", "helper", "当前没有满足射程的敌机。可切换武器，或取消后继续移动。"),
      );
    for (const target of targets) {
      let e = Rules.estimate(game, u, target, w),
        button = element("button", "target-button");
      button.dataset.targetId = target.id;
      button.append(
        element("span", "", teamName(target.team) + " " + unitName(target)),
        element("span", "muted", `${Rules.dist(u, target)}格 · ${e.hit}%`),
      );
      button.disabled = !canCommand;
      button.onclick = () => beginAttack(u, target, w);
      panel.append(button);
    }
  }
  let info = u.plan
    ? "已计划攻击：本队结束规划后执行，可取消计划重新选择。"
    : u.acted
      ? "本单位行动已经结束。"
      : !own
        ? "当前是对手的单位，可查看其射程与资源。"
        : u.moved
          ? "已移动：仍可攻击或待机。攻击后不可再移动。"
          : "移动可选；原地攻击也会结束本单位行动。";
  panel.append(element("div", "rule-box", info));
  if (Net.active && u.plan && Net.owns(u) && phase === "idle") {
    const cancel = element("button", "", "取消攻击计划");
    cancel.id = "cancelAttackPlan";
    cancel.disabled = !Net.canAct();
    cancel.onclick = () => Net.request("cancel_attack", { unitId: u.id });
    panel.append(cancel);
  }
}
function select(id) {
  if (isBusy()) return;
  let u = getUnit(id);
  if (!u || u.hp <= 0) return;
  GameAudio.play("selectUnitSound");
  selected = id;
  weaponId = null;
  mode = "select";
  update();
}
function mapPosition(x, y) {
  return {
    x: mapGeo.ox + (x + 0.5) * mapGeo.tile,
    y: mapGeo.oy + (y + 0.5) * mapGeo.tile,
  };
}
// 地图画布：先画地形与范围，再画单位、血条和名称。now 是毫秒时间。
function drawMap(now) {
  let c = byId("map"),
    box = c.getBoundingClientRect(),
    dpr = window.devicePixelRatio || 1;
  if (box.width < 1 || box.height < 1) return;
  if (c.width !== Math.round(box.width * dpr) || c.height !== Math.round(box.height * dpr)) {
    c.width = Math.round(box.width * dpr);
    c.height = Math.round(box.height * dpr);
  }
  let ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = box.width,
    h = box.height,
    { tile, ox, oy } = MapCamera.geometry(w, h);
  mapGeo = { tile, ox, oy };
  ctx.fillStyle = "#111e27";
  ctx.fillRect(0, 0, w, h);
  let chosen = getUnit(selected),
    moveCells =
      chosen &&
      chosen.hp > 0 &&
      chosen.team === game.team &&
      (!Net.active || Net.owns(chosen)) &&
      !chosen.acted &&
      !chosen.moved &&
      phase === "idle" &&
      mode !== "target" &&
      !isAI() &&
      (!Net.active || Net.canAct())
        ? Rules.reachable(game, chosen)
        : new Map(),
    weapon = chosen && weaponId ? getWeapon(chosen, weaponId) : null;
  const deploymentArea = new Set(
    phase === "deployment" && Deployment.team() !== null
      ? Rules.deploymentCells(game, Deployment.team()).map((c) => Rules.key(c.x, c.y))
      : [],
  );
  for (let y = 0; y < Rules.mapHeight(game); y++)
    for (let x = 0; x < Rules.mapWidth(game); x++) {
      let kind = game.tiles[y][x],
        t = Rules.terrainStyle(game.mapId, kind),
        px = ox + x * tile,
        py = oy + y * tile;
      ctx.fillStyle = t.color;
      ctx.fillRect(px, py, tile, tile);
      ctx.fillStyle = "rgba(255,255,255,.018)";
      if ((x + y) % 2) ctx.fillRect(px, py, tile, tile);
      ctx.strokeStyle = "#49616b55";
      ctx.lineWidth = 0.7;
      ctx.strokeRect(px + 0.4, py + 0.4, tile - 0.8, tile - 0.8);
      if (
        phase === "deployment" &&
        Deployment.team() !== null &&
        deploymentArea.has(Rules.key(x, y))
      ) {
        ctx.fillStyle = "#5ee4b344";
        ctx.fillRect(px, py, tile, tile);
      }
      if (
        kind === "plain" &&
        Rules.getMap(game.mapId).environment === "space" &&
        (x * 17 + y * 31) % 7 === 0
      ) {
        ctx.fillStyle = "#b7b9df99";
        ctx.fillRect(
          px + tile * 0.37,
          py + tile * 0.62,
          Math.max(1, tile * 0.025),
          Math.max(1, tile * 0.025),
        );
      }
      if (kind === "forest" && Rules.getMap(game.mapId).appearance?.biome === "desert") {
        ctx.strokeStyle = "#d6bb83";
        ctx.lineWidth = Math.max(1, tile * 0.035);
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(px + tile * 0.1, py + tile * (0.4 + i * 0.18));
          ctx.quadraticCurveTo(
            px + tile * 0.5,
            py + tile * (0.1 + i * 0.18),
            px + tile * 0.9,
            py + tile * (0.4 + i * 0.18),
          );
          ctx.stroke();
        }
      } else if (kind === "forest") {
        for (let i = 0; i < 4; i++) {
          let tx = px + tile * (0.22 + (i % 2) * 0.48),
            ty = py + tile * (0.18 + Math.floor(i / 2) * 0.42);
          ctx.fillStyle = "#193629";
          ctx.fillRect(tx - 3, ty + 5, 8, 15);
          ctx.fillStyle = "#395d3d";
          ctx.beginPath();
          ctx.moveTo(tx + 1, ty - 2);
          ctx.lineTo(tx - 7, ty + 12);
          ctx.lineTo(tx + 9, ty + 12);
          ctx.fill();
        }
      } else if (kind === "highland") {
        ctx.strokeStyle = "#e8d9ad99";
        ctx.lineWidth = Math.max(1, tile * 0.04);
        ctx.beginPath();
        if (game.tiles[y - 1]?.[x] !== "highland") {
          ctx.moveTo(px + tile * 0.1, py + tile * 0.14);
          ctx.lineTo(px + tile * 0.9, py + tile * 0.14);
        }
        if (game.tiles[y + 1]?.[x] !== "highland") {
          ctx.moveTo(px + tile * 0.1, py + tile * 0.86);
          ctx.lineTo(px + tile * 0.9, py + tile * 0.86);
        }
        if (game.tiles[y]?.[x - 1] !== "highland") {
          ctx.moveTo(px + tile * 0.14, py + tile * 0.1);
          ctx.lineTo(px + tile * 0.14, py + tile * 0.9);
        }
        if (game.tiles[y]?.[x + 1] !== "highland") {
          ctx.moveTo(px + tile * 0.86, py + tile * 0.1);
          ctx.lineTo(px + tile * 0.86, py + tile * 0.9);
        }
        ctx.stroke();
      } else if (kind === "rock") {
        ctx.fillStyle = "#727978";
        ctx.beginPath();
        ctx.moveTo(px + tile * 0.15, py + tile * 0.7);
        ctx.lineTo(px + tile * 0.4, py + tile * 0.19);
        ctx.lineTo(px + tile * 0.75, py + tile * 0.35);
        ctx.lineTo(px + tile * 0.87, py + tile * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#424c50";
        ctx.beginPath();
        ctx.moveTo(px + tile * 0.4, py + tile * 0.19);
        ctx.lineTo(px + tile * 0.87, py + tile * 0.8);
        ctx.lineTo(px + tile * 0.5, py + tile * 0.76);
        ctx.closePath();
        ctx.fill();
      } else if (kind === "rubble") {
        ctx.fillStyle = "#6b7470";
        ctx.fillRect(px + tile * 0.2, py + tile * 0.2, tile * 0.25, tile * 0.45);
        ctx.fillStyle = "#303b3f";
        ctx.fillRect(px + tile * 0.45, py + tile * 0.35, tile * 0.33, tile * 0.37);
        ctx.strokeStyle = "#8d9180";
        ctx.strokeRect(px + tile * 0.2, py + tile * 0.2, tile * 0.25, tile * 0.45);
      } else if (kind === "water") {
        ctx.strokeStyle = "#628a9a55";
        for (let i = 1; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(px + 5, py + (i * tile) / 4);
          ctx.lineTo(px + tile - 5, py + (i * tile) / 4);
          ctx.stroke();
        }
      }
      if (moveCells.has(Rules.key(x, y)) && !(chosen.x === x && chosen.y === y)) {
        ctx.fillStyle = "#63caff2d";
        ctx.fillRect(px + 2, py + 2, tile - 4, tile - 4);
        ctx.strokeStyle = "#6ac6f05f";
        ctx.strokeRect(px + 2, py + 2, tile - 4, tile - 4);
      }
      if (mode === "target" && weapon && Rules.inRange(chosen, { x, y }, weapon)) {
        ctx.fillStyle = "#d19a552b";
        ctx.fillRect(px + 2, py + 2, tile - 4, tile - 4);
      }
    }
  ctx.font = "9px ui-monospace,monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#8ea5af";
  for (let x = 0; x < Rules.mapWidth(game); x++)
    ctx.fillText(String.fromCharCode(65 + x), ox + (x + 0.5) * tile, oy - 9);
  for (let y = 0; y < Rules.mapHeight(game); y++)
    ctx.fillText(String(y + 1), ox - 9, oy + (y + 0.5) * tile);
  for (const u of MapCombat.units()) {
    if ((u.hp <= 0 && !u.mapDying) || u.mapPose?.hidden) continue;
    const motion = PlanningUI.motion(u, now) || (moving?.id === u.id ? moving : null);
    let pos = mapPosition(u.x, u.y),
      angle = u.angle,
      anim = Rules.modelOf(u).presentation.idle,
      t = now / 1000;
    if (!!motion) {
      let part = Math.min(motion.path.length - 0.0001, (now - motion.start) / motion.step),
        index = Math.floor(Math.max(0, part)),
        frac = Math.max(0, part - index),
        from = index ? motion.path[index - 1] : motion.from,
        to = motion.path[index] || from;
      pos = mapPosition(from.x + (to.x - from.x) * frac, from.y + (to.y - from.y) * frac);
      angle = (Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI;
      anim = SpriteRenderer.movement(u.model);
      t = (now - motion.start) / 1000;
    }
    const combatPose = u.mapPose;
    if (combatPose) {
      pos = mapPosition(combatPose.x / 64 - 0.5, combatPose.y / 64 - 0.5);
      angle = combatPose.angle;
      anim = combatPose.clip;
      t = combatPose.time;
    }
    if (!combatPose) angle = PlanningUI.facing(u, angle);
    ctx.save();
    ctx.globalAlpha = 1;
    UnitIdentity.drawRing(ctx, u, pos, tile);
    if (u.id === selected || (phase === "reaction" && pending?.target === u.id)) {
      ctx.strokeStyle = "#e1edaa";
      ctx.lineWidth = 2;
      ctx.strokeRect(pos.x - tile * 0.43, pos.y - tile * 0.43, tile * 0.86, tile * 0.86);
    }
    SpriteRenderer.draw(
      ctx,
      u.model,
      pos.x,
      pos.y + (combatPose ? 0 : tile * 0.035),
      (tile / 64) *
        1.2 *
        (BattleScene.settings().mapScale / (ART.presentation.mapCellScale || 1)) *
        Rules.modelOf(u).presentation.mapScale,
      angle,
      anim,
      t,
      combatPose?.heldWeapon ?? u.heldWeapon,
      !combatPose,
      (u.shield ?? 1) > 0,
      !!motion || !!combatPose?.moving,
      u.brokenParts,
    );
    SpriteEffects.lowHp(
      ctx,
      u,
      pos.x,
      pos.y + (combatPose ? 0 : tile * 0.035),
      (tile / 64) *
        1.2 *
        (BattleScene.settings().mapScale / (ART.presentation.mapCellScale || 1)) *
        Rules.modelOf(u).presentation.mapScale,
      now / 1000,
    );
    ctx.restore();
    let hpw = tile * 0.72 * BattleScene.settings().mapBarScale,
      barx = pos.x - hpw / 2,
      bary = pos.y + tile * 0.36;
    ctx.fillStyle = "#07141c";
    ctx.fillRect(barx, bary, hpw, 4);
    ctx.fillStyle = u.team ? "#ed9685" : "#83d6ee";
    ctx.fillRect(barx, bary, hpw * Math.max(0, Math.min(1, u.hp / Rules.modelOf(u).hp)), 4);
    ctx.fillStyle = "#07141c";
    ctx.fillRect(barx, bary + 6, hpw, 3);
    ctx.fillStyle = "#efd568";
    const enRatio = Math.max(0, Math.min(1, u.en / Math.max(1, Rules.modelOf(u).en)));
    ctx.fillRect(barx, bary + 6, hpw * enRatio, 3);
    if (u.acted && u.team === game.team) {
      ctx.save();
      ctx.font = `bold ${Math.max(10, tile * 0.18)}px system-ui`;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#07141c";
      ctx.fillStyle = "#efd568";
      ctx.strokeText("E", barx + hpw + 3, bary - 1);
      ctx.fillText("E", barx + hpw + 3, bary - 1);
      ctx.restore();
    }
    if (MapCamera.zoom >= 3) {
      ctx.fillStyle = u.acted && u.team === game.team ? "#8fa0a5" : "#dfebed";
      const nameSize = Math.max(7, tile * 0.14) * BattleScene.settings().mapLabelSize;
      ctx.font = `${nameSize}px system-ui`;
      ctx.textAlign = "center";
      ctx.fillText(unitName(u), pos.x, bary + 12 + nameSize / 2);
    }
    if (mode === "target" && weapon && chosen && Rules.canAttack(game, chosen, u, weapon)) {
      let p = 0.7 + 0.3 * Math.sin(now / 200);
      ctx.strokeStyle = `rgba(255,140,115,${p})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(pos.x - tile * 0.45, pos.y - tile * 0.45, tile * 0.9, tile * 0.9);
    }
  }
  MapCombat.draw(ctx, mapGeo);
  PlanningUI.arrows(ctx);
  MovementEffects.draw(ctx, now, mapPosition, tile);
  MapEffects.draw(ctx, now, mapPosition, tile);
  if (hover) {
    let p = mapPosition(hover.x, hover.y);
    ctx.strokeStyle = "#f2f1c9aa";
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x - tile * 0.5 + 1, p.y - tile * 0.5 + 1, tile - 2, tile - 2);
  }
}
function cellAt(e) {
  if (!mapGeo) return null;
  let r = byId("map").getBoundingClientRect(),
    x = Math.floor((e.clientX - r.left - mapGeo.ox) / mapGeo.tile),
    y = Math.floor((e.clientY - r.top - mapGeo.oy) / mapGeo.tile);
  return x >= 0 && x < Rules.mapWidth(game) && y >= 0 && y < Rules.mapHeight(game)
    ? { x, y }
    : null;
}
byId("map").onpointermove = (e) => {
  hover = cellAt(e);
  if (hover) {
    let unit = Rules.at(game, hover.x, hover.y),
      t = Rules.terrainStyle(game.mapId, game.tiles[hover.y][hover.x]);
    byId("hoverInfo").textContent =
      String.fromCharCode(65 + hover.x) +
      (hover.y + 1) +
      " · " +
      t.name +
      (unit ? " · " + teamName(unit.team) + " " + unitName(unit) : "") +
      " · " +
      I18n.text("远战命中") +
      " -" +
      t.cover +
      "% / " +
      I18n.text("近战命中") +
      " -" +
      (t.meleeCover ?? 0) +
      "%";
  }
};
byId("map").onpointerleave = () => (hover = null);
byId("map").onclick = async (e) => {
  if (TurnFlow.active) return;
  if (phase === "deployment") {
    const cell = cellAt(e);
    if (cell) Deployment.click(cell);
    return;
  }
  if (phase === "reaction") {
    const cell = cellAt(e),
      target = cell && Rules.at(game, cell.x, cell.y);
    if (target) selectCounterTarget(target.id);
    return;
  }
  if (isBusy() || isAI()) return;
  let cell = cellAt(e);
  if (!cell) return;
  let target = Rules.at(game, cell.x, cell.y),
    u = getUnit(selected);
  // 查看单位资料不需要操作权限；移动与攻击仍检查所属玩家。
  if (Net.active && !Net.canAct()) {
    if (target) select(target.id);
    return;
  }
  if (mode === "target" && u && weaponId) {
    let w = getWeapon(u, weaponId);
    if (target && Rules.canAttack(game, u, target, w)) {
      beginAttack(u, target, w);
      return;
    }
    if (target?.team === game.team) {
      select(target.id);
      return;
    }
    note("请选择高亮的有效攻击目标。");
    return;
  }
  if (target) {
    select(target.id);
    return;
  }
  if (u && u.team === game.team && (!Net.active || Net.owns(u)) && !u.acted && !u.moved) {
    try {
      await performMove(u, cell.x, cell.y);
    } catch (err) {
      note(err.message);
    }
  }
};
async function performMove(u, x, y) {
  if (Net.active) {
    Net.request("move", { unitId: u.id, x, y });
    return;
  }
  let from = { x: u.x, y: u.y },
    path = Rules.move(game, u, x, y);
  if (Rules.modelOf(u).presentation.movement === "boost")
    WeaponAudio.play(ART.presentation.moveSound);
  MovementEffects.start(u, from, path[0], performance.now());
  phase = "moving";
  moving = {
    id: u.id,
    from,
    path,
    start: performance.now(),
    step: byId("quick").checked ? 50 : 120,
  };
  update();
  let stamp = session;
  await new Promise((resolve) => setTimeout(resolve, path.length * moving.step + 20));
  if (stamp !== session) return;
  moving = null;
  phase = "idle";
  addLog(`${logUnit(u)} 移动至${String.fromCharCode(65 + x)}${y + 1}。`);
  update();
}
// a = 攻击方，b = 防守方，w = 武器。联机只发请求，离线进入本地应战。
function beginAttack(a, b, w) {
  if (Net.active) {
    if (Net.canAct() && Net.owns(a) && phase === "idle")
      Net.request("attack", { unitId: a.id, targetId: b.id, weaponId: w.id });
    return;
  }
  if (phase !== "idle" || !Rules.canAttack(game, a, b, w) || a.acted) return;
  GameAudio.play("lockonSound");
  Rules.faceTarget(a, b);
  Rules.faceTarget(b, a);
  pending = { attacker: a.id, target: b.id, weapon: w.id };
  phase = "reaction";
  let legal = Rules.modelOf(b).weapons.filter((c) => Rules.canCounter(game, b, a, c));
  response = legal.length ? "counter" : "defend";
  counterId = legal[0]?.id || null;
  if (game.ai && b.team === 1) {
    let choice = Rules.bestResponse(game, a, b, w);
    response = choice.response;
    counterId = choice.weapon || null;
    addLog(
      `AI ${unitName(b)}选择${response === "counter" ? "反击" : response === "defend" ? "防御" : "回避"}。`,
    );
    commitAttack();
    return;
  }
  MapCamera.focus(b.x, b.y, { preserveZoom: true });
  renderReaction();
  byId("reaction").hidden = false;
  update();
}
// 应战弹窗展示预估值，不扣血或消耗资源。
function renderReaction() {
  const targets = pending.counterTargets || [
    { attacker: pending.attacker, weapon: pending.weapon, options: pending.counterOptions },
  ];
  const b = getUnit(pending.target);
  const available = (entry) =>
    Rules.modelOf(b).weapons.filter(
      (weapon) =>
        Rules.canCounter(game, b, getUnit(entry.attacker), weapon) &&
        (!entry.options || entry.options.includes(weapon.id)),
    );
  // 先选武器，再按武器射程与 EN 条件筛选本组来袭目标。
  const usableWeapons = Rules.modelOf(b).weapons.filter((weapon) =>
    targets.some((entry) => available(entry).some((candidate) => candidate.id === weapon.id)),
  );
  if (!usableWeapons.some((weapon) => weapon.id === counterId))
    counterId = usableWeapons[0]?.id || null;
  const legalTargets = targets.filter((entry) =>
    available(entry).some((weapon) => weapon.id === counterId),
  );
  if (!legalTargets.some((entry) => entry.attacker === counterTargetId))
    counterTargetId = (legalTargets[0] || targets[0]).attacker;
  const selectedTarget = targets.find((entry) => entry.attacker === counterTargetId) || targets[0];
  const incoming = response === "counter" ? selectedTarget : targets[0];
  const a = getUnit(incoming.attacker),
    w = getWeapon(a, incoming.weapon);
  const selectedEnemy = getUnit(selectedTarget.attacker);
  const legal = available(selectedTarget);
  byId("counterTargetWrap").hidden = response !== "counter";
  const select = byId("counterTarget");
  select.replaceChildren(
    ...targets.map((entry) => {
      const unit = getUnit(entry.attacker),
        owner = UnitIdentity.owner(unit);
      const option = new Option(
        unitName(unit) +
          " · " +
          owner.name +
          " · " +
          String.fromCharCode(65 + unit.x) +
          (unit.y + 1),
        unit.id,
      );
      if (unit.customName) option.setAttribute("data-i18n-ignore", "");
      option.disabled = !legalTargets.some((target) => target.attacker === entry.attacker);
      return option;
    }),
  );
  select.value = counterTargetId;
  byId("reactionTitle").textContent = teamName(b.team) + "选择应战方式";
  byId("reactionSub").replaceChildren(
    element(
      "span",
      "",
      `距离 ${Rules.dist(a, b)} 格 · ${teamName(a.team)} ${unitName(a)}使用${w.name}`,
    ),
  );
  byId("reactionSub").append(
    document.createTextNode(" · "),
    element("span", "", "来袭单位"),
    document.createTextNode(" " + targets.length),
  );
  function fighter(unit, weapon) {
    const card = element("div", "fighter");
    const image = element("img");
    image.src = unitIcon(unit.model);
    image.alt = "";
    const identity = UnitIdentity.owner(unit);
    const owner = element("small", "response-owner", identity.name + " · " + identity.team);
    owner.setAttribute("data-i18n-ignore", "");
    const title = element("strong", "", unitName(unit));
    if (unit.customName) title.setAttribute("data-i18n-ignore", "");
    const summary = element("div", "summary");
    summary.append(
      element("div", "", `HP ${formatNumber(unit.hp)} / ${formatNumber(Rules.modelOf(unit).hp)}`),
      element("div", "", `EN ${unit.en} / ${Rules.modelOf(unit).en}`),
      element(
        "div",
        "",
        weapon
          ? weapon.name + " · " + Rules.typeNames[weapon.type]
          : Rules.terrain[game.tiles[unit.y][unit.x]].name,
      ),
    );
    card.append(image, title, owner, summary);
    return card;
  }
  const incomingList = byId("engagement"),
    previousScroll = incomingList.scrollTop;
  incomingList.replaceChildren(
    ...targets.map((entry) => {
      const unit = getUnit(entry.attacker),
        weapon = getWeapon(unit, entry.weapon);
      const card = element(
        "button",
        "incoming-entry" +
          (response === "counter" && entry.attacker === counterTargetId ? " selected" : ""),
      );
      card.type = "button";
      card.dataset.unitId = unit.id;
      card.disabled =
        response !== "counter" || !legalTargets.some((target) => target.attacker === unit.id);
      card.append(fighter(unit, weapon));
      const forecast = Rules.estimate(game, unit, b, weapon, response);
      card.append(
        element("div", "incoming-forecast", `${forecast.hit}% · ${formatNumber(forecast.damage)}`),
      );
      card.onclick = () => selectCounterTarget(unit.id);
      return card;
    }),
  );
  incomingList.scrollTop = previousScroll;
  byId("defenderInfo").replaceChildren(fighter(b));
  for (const [id, value] of [
    ["responseCounter", "counter"],
    ["responseDefend", "defend"],
    ["responseEvade", "evade"],
  ])
    byId(id).classList.toggle("active", response === value);
  byId("responseCounter").disabled = !targets.some((entry) => available(entry).length);
  byId("counterList").replaceChildren();
  if (response === "counter") {
    for (const cw of Rules.modelOf(b).weapons) {
      let button = element("button", "weapon" + (cw.id === counterId ? " active" : ""));
      button.innerHTML = htmlWeapon(cw, b);
      button.disabled = !usableWeapons.some((weapon) => weapon.id === cw.id);
      button.setAttribute("aria-label", "反击武器 " + cw.name);
      button.onclick = () => {
        GameAudio.play("selectWeaponSound");
        counterId = cw.id;
        renderReaction();
      };
      byId("counterList").append(button);
    }
  }
  let counter =
    response === "counter" && counterId
      ? Rules.estimate(game, b, selectedEnemy, getWeapon(b, counterId), "counter", true)
      : null;
  byId("incomingEstimate").replaceChildren(
    element("span", "", "来袭单位"),
    document.createTextNode(" " + targets.length),
  );
  byId("estimate").innerHTML =
    `<span>${counter ? `反击：命中 <strong>${counter.hit}%</strong><br>命中后约 <strong class="blue">${formatNumber(counter.damage)}</strong> 伤害` : "本次不进行反击"}</span>`;
  byId("confirmResponse").disabled =
    response === "counter" && !legal.some((c) => c.id === counterId);
}
for (const [id, value] of [
  ["responseCounter", "counter"],
  ["responseDefend", "defend"],
  ["responseEvade", "evade"],
])
  byId(id).onclick = () => {
    response = value;
    renderReaction();
  };
// 地图、左侧列表、下拉框统一走同一条合法目标选择路径。
function legalCounterTargets() {
  if (phase !== "reaction" || !pending || response !== "counter" || !counterId) return [];
  const defender = getUnit(pending.target),
    weapon = defender && getWeapon(defender, counterId);
  if (!defender || !weapon) return [];
  const entries = pending.counterTargets || [
    { attacker: pending.attacker, options: pending.counterOptions },
  ];
  return entries.filter(
    (entry) =>
      (!entry.options || entry.options.includes(counterId)) &&
      Rules.canCounter(game, defender, getUnit(entry.attacker), weapon),
  );
}
function selectCounterTarget(id) {
  if (Net.awaiting || !legalCounterTargets().some((entry) => entry.attacker === id)) return false;
  if (Net.active && !Net.owns(getUnit(pending.target))) return false;
  counterTargetId = id;
  GameAudio.play("lockonSound");
  renderReaction();
  return true;
}
byId("counterTarget").onchange = () => selectCounterTarget(byId("counterTarget").value);
byId("confirmResponse").onclick = () => commitAttack();
// 确认应战：离线调用规则结算；联机等待服务端返回事件。
function commitAttack() {
  if (Net.active) {
    Net.request("respond", { response, counterId, counterTargetId });
    return;
  }
  if (phase !== "reaction" || !pending) return;
  let a = getUnit(pending.attacker),
    b = getUnit(pending.target),
    w = getWeapon(a, pending.weapon),
    before = Object.fromEntries(game.units.map((u) => [u.id, u.hp]));
  let events;
  try {
    events = Rules.fight(game, a, b, w, response, counterId);
  } catch (e) {
    note(e.message);
    return;
  }
  byId("reaction").hidden = true;
  phase = "battle";
  selected = a.id;
  mode = "select";
  weaponId = null;
  battleView = {
    a: a.id,
    b: b.id,
    events,
    index: 0,
    start: performance.now(),
    displayHp: before,
    completed: false,
  };
  setNamedText(byId("battleTitle"), unitName(a) + " vs " + unitName(b));
  BattleWindow.show(battleView);
  byId("continueBattle").disabled = true;
  byId("skipBattle").disabled = false;
  byId("battleSummary").textContent = "";
  update();
}
function battleEventDuration() {
  const event = battleView.events[Math.min(battleView.index, battleView.events.length - 1)];
  return (
    BattleScene.duration(
      event,
      battleUnit(battleView.a),
      battleUnit(battleView.b),
      byId("battleCanvas"),
    ) *
    1000 *
    (byId("quick").checked ? 0.35 : 1)
  );
}
function logEvent(event) {
  if (Net.active) return;
  let a = battleUnit(event.from),
    b = battleUnit(event.to),
    w = getWeapon(a, event.weapon);
  addLog(
    `${logUnit(a)} 使用${w.name} → ${logUnit(b)}：${event.hit ? formatNumber(event.damage) + "伤害" : "未命中"}${event.strikes ? `（命中 ${event.hitCount}/${event.strikeCount}）` : ""}${event.after <= 0 ? "，击破！" : ""}`,
  );
}
// 推进已经结算好的演出事件与显示血量，不再次计算伤害。
function progressBattle(now) {
  if (!battleView || battleView.completed) return;
  let b = battleView,
    event = b.events[b.index],
    elapsed = now - b.start;
  if (elapsed > battleEventDuration()) {
    b.displayHp[event.to] = event.after;
    logEvent(event);
    b.index++;
    b.start = now;
    if (b.index >= b.events.length) {
      b.completed = true;
      BattleWindow.complete(b, now);
      byId("continueBattle").disabled = false;
      byId("skipBattle").disabled = true;
      byId("battleCaption").textContent = b.events.some((e) => e.after <= 0)
        ? "目标击破"
        : "交战结束";
      byId("battleSummary").textContent =
        b.events
          .map(
            (e) =>
              `${unitName(battleUnit(e.from))}：${e.hit ? formatNumber(e.damage) + "伤害" : "未命中"}${e.strikes ? `（命中 ${e.hitCount}/${e.strikeCount}）` : ""}`,
          )
          .join(" ／ ") + " · 2秒后自动返回地图";
      return;
    }
  }
}
byId("quick").addEventListener("change", () => WeaponAudio.setBattleMuted(byId("quick").checked));
// 演出推进和状态栏留在界面层，画布统一交给 BattleScene。
function drawBattle(now) {
  if (battleView?.mapBattle) return;
  WeaponAudio.setBattleMuted(byId("quick").checked);
  if (byId("battle").hidden || !battleView) {
    WeaponAudio.stopBattle();
    return;
  }
  now = battleView.suspendedAt ?? now;
  progressBattle(now);
  const view = battleView;
  BattleWindow.update(view, now, finishBattle);
  if (view.returned || !battleView) return;
  const left = battleUnit(view.a),
    right = battleUnit(view.b);
  const event = view.events[Math.min(view.index, view.events.length - 1)];
  const ratio = view.completed
    ? 1
    : Math.max(0, Math.min(1, (now - view.start) / battleEventDuration()));
  if (view.completed) WeaponAudio.releaseBattle();
  else if (view.windowState === "opening") WeaponAudio.stopBattle();
  else {
    const weapon = getWeapon(battleUnit(event.from), event.weapon);
    const bounds = byId("battleCanvas").getBoundingClientRect();
    const plan = BattleScene.timeline(event, left, right, bounds.width, bounds.height).plan;
    if (
      !byId("quick").checked &&
      plan.deathSoundAt !== null &&
      ratio * plan.duration >= plan.deathSoundAt
    )
      (view.deathSoundHeard ||= new Set()).add(event.to);
    WeaponAudio.sync(view, view.index, weapon, ratio * plan.duration, 1, plan.cues);
  }
  BattleScene.draw(byId("battleCanvas"), {
    left,
    right,
    event,
    ratio,
    elapsed: (now - view.start) / 1000,
    time: clock,
    completed: view.completed,
    displayHp: view.displayHp,
    displayShield: Object.fromEntries(
      view.events.map((item, index) => [
        item.to,
        index < view.index ? item.shieldAfter : item.shieldBefore,
      ]),
    ),
  });
  if (!view.completed)
    byId("battleCaption").textContent =
      `${view.index ? "反击 · " : ""}${getWeapon(battleUnit(event.from), event.weapon).name}`;
  byId("battleInfo").innerHTML = [left, right]
    .map((unit) => {
      const hp =
        !view.completed && unit.id === event.to
          ? BattleScene.displayedHp(
              event,
              left,
              right,
              byId("battleCanvas"),
              ratio,
              view.displayHp[unit.id],
            )
          : view.displayHp[unit.id];
      return /* HTML */ `<div>
        <strong class="${unit.team ? "red" : "blue"}"
          >${teamName(unit.team)} ${escapeHtml(unitName(unit))}</strong
        >
        <div class="hp-track">
          <div
            class="hp-fill ${unit.team ? "red" : ""}"
            style="width:${(hp / Rules.modelOf(unit).hp) * 100}%"
          ></div>
        </div>
        <small
          >HP ${formatNumber(hp)} / ${formatNumber(Rules.modelOf(unit).hp)} ? EN ${unit.en}</small
        >
      </div>`;
    })
    .join("");
}
byId("skipBattle").onclick = () => {
  WeaponAudio.stop();
  if (!battleView || battleView.completed) return;
  for (let i = battleView.index; i < battleView.events.length; i++) {
    let e = battleView.events[i];
    battleView.displayHp[e.to] = e.after;
    logEvent(e);
  }
  battleView.index = battleView.events.length;
  battleView.completed = true;
  BattleWindow.complete(battleView);
  byId("continueBattle").disabled = false;
  byId("skipBattle").disabled = true;
  byId("battleCaption").textContent = "交战结束";
  byId("battleSummary").textContent = "演出已跳过，2秒后自动返回地图。";
};
byId("continueBattle").onclick = () => {
  BattleWindow.close(battleView);
};
function finishBattle() {
  WeaponAudio.releaseBattle();
  if (!battleView?.completed) return;
  MapEffects.capture(battleView);
  if (Net.active) {
    CombatPlayback.finish();
    return;
  }
  byId("battle").hidden = true;
  battleView = null;
  pending = null;
  phase = MapEffects.pending() ? "map_effects" : "idle";
  MapEffects.after(() => {
    if (game.winner !== null) {
      showVictory();
      return;
    }
    phase = "idle";
    update();
  });
  update();
}
function endTurn() {
  if (Net.active) {
    Net.request("end_turn");
    return;
  }
  if (isBusy()) return;
  const fromTeam = game.team;
  Rules.end(game);
  selected = null;
  weaponId = null;
  mode = "select";
  addLog(`第${game.round}回合 · ${teamName(game.team)}行动开始，存活单位恢复15 EN。`);
  TurnFlow.play(fromTeam, game.round, game.team);
}
byId("endTurn").onclick = () => {
  if (isBusy() || isAI() || (Net.active && !Net.canAct())) return;
  let remaining = game.units.filter(
    (u) => u.team === game.team && (!Net.active || Net.owns(u)) && u.hp > 0 && !u.acted,
  ).length;
  if (remaining && !byId("endTurn").dataset.confirm) {
    byId("endTurn").dataset.confirm = "1";
    note(`尚有${remaining}台未行动；再次点击结束回合以确认。`);
    setTimeout(() => delete byId("endTurn").dataset.confirm, 3000);
    return;
  }
  delete byId("endTurn").dataset.confirm;
  endTurn();
};
function showVictory() {
  if (MapEffects.pending()) {
    phase = "victory";
    MapEffects.after(showVictory);
    return;
  }
  phase = "victory";
  byId("victoryTitle").textContent = teamName(game.winner) + "胜利";
  byId("victoryNote").textContent =
    `第${game.round}回合，全歼敌方小队。存活单位 ${game.units.filter((u) => u.team === game.winner && u.hp > 0).length} 台。`;
  byId("victory").hidden = false;
  MatchResults.show();
  update();
}
// 主动回主菜单会退出当前房间；网络意外中断则由网络层自动恢复。
function openMenu() {
  session++;
  Net.leave();
  moving = pending = battleView = null;
  selected = weaponId = null;
  mode = "select";
  hover = mapGeo = null;
  log = [];
  game = Rules.create();
  phase = "start";
  for (const id of ["reaction", "battle", "victory", "help", "leaveConfirm"])
    byId(id).hidden = true;
  for (const id of ["map", "battleCanvas"]) {
    const canvas = byId(id),
      context = canvas.getContext("2d");
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
  }
  byId("skirmishSetup").hidden = true;
  setPageView("menu");
  update();
}
function requestMenu() {
  byId("leaveConfirm").hidden = false;
}
byId("netSettings").onclick = requestMenu;

byId("cancelLeave").onclick = () => {
  byId("leaveConfirm").hidden = true;
};
byId("confirmLeave").onclick = openMenu;
byId("helpBtn").onclick = () => {
  byId("help").hidden = false;
};
byId("closeHelp").onclick = () => {
  byId("help").hidden = true;
};
// 每帧入口：独立预览接管自己的绘制，实际游戏绘制正常地图与战斗。
function tick(now) {
  animationFrameId = null;
  clock = now / 1000;
  if (assetsReady) {
    if (window.GamePreview?.active) window.GamePreview.tick(now);
    else if (pageView === "game") {
      MapCombat.update(now);
      drawMap(now);
      drawBattle(now);
    }
  }
  if (pageView === "game" || window.isLayoutPreview) startRendering();
}
window.addEventListener("language-change", () => {
  update();
});
SpriteRenderer.load()
  .then(() => {
    assetsReady = true;
    byId("openSkirmish").disabled = false;
    byId("openRooms").disabled = false;
    byId("loading").textContent = "原始素材已就绪 · 选择模式开始";
    update();
    if (pageView === "game" || window.isLayoutPreview) startRendering();
    window.dispatchEvent(new Event("game-assets-ready"));
  })
  .catch((err) => {
    byId("loading").textContent = err.message;
  });
