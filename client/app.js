/* 客户端界面与输入入口。联机结果来自 network.js。
 * Rules 是共用规则；UnitModels 是机体配置；byId("名字") 查找 HTML 元素。
 * 阅读路线：update → renderPanel → drawMap → beginAttack → drawBattle。
 */
"use strict";
const byId = (id) => document.getElementById(id),
  Rules = Tactics,
  UnitModels = Rules.models;
// selected 是单位 ID；phase 是流程阶段；mode 区分选中单位与选择目标。
const menuGame = () =>
  Rules.create(
    false,
    7319,
    Rules.getMap().spawns.map(() => null),
  );
let game = menuGame(),
  selected = null,
  weaponId = null,
  mode = "select",
  phase = "start",
  pending = null,
  response = "defend",
  counterId = null,
  counterTargetId = null,
  log = [],
  dialogueHistory = [],
  dialogueBubbles = new Map(),
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
  if (view !== pageView) {
    Chat.captureScroll();
    window.dispatchEvent(new Event("page-changing"));
  }
  if (view !== "game") TurnFlow.reset();
  if (view !== "game" && pageView === "game" && battleView) {
    if (battleView.mapBattle) MapCombat.suspend(battleView);
    else BattleWindow.suspend(battleView);
  }
  if (view !== "game") WeaponAudio.stop();
  pageView = view;
  MusicPlayer.sync();
  byId("gameScene").hidden = view !== "game";
  byId("start").hidden = view !== "menu";
  byId("roomPreparation").hidden = view !== "room";
  byId("formationScreen").hidden = view !== "formation";
  byId("developmentScreen").hidden = view !== "development";
  byId("productionScreen").hidden = view !== "production";
  byId("encyclopediaScreen").hidden = view !== "encyclopedia";
  byId("roomSettings").hidden = !Net.active;
  window.MenuShell?.refresh();
  Chat.restoreScroll();
  if (view !== "game")
    for (const id of ["reaction", "battle", "victory", "help"]) byId(id).hidden = true;
  window.HangarUI?.refresh();
  window.SFSUI?.refresh();
  window.BattleHUD?.refresh();
  window.BattlefieldUI?.refresh();
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
  getUnit = (id) =>
    id === null || id === undefined ? undefined :
      game.units.find((u) => u.id === id) || Net.snapshot?.combatActors?.find((u) => u.id === id),
  battleUnit = (id) => battleView?.actors?.find((unit) => unit.id === id) || getUnit(id),
  getWeapon = (u, id) => Rules.modelOf(u).weapons.find((w) => w.id === id),
  unitIcon = (() => {
    const cache = new Map();
    let serial = 0;
    return (model, pilot = null) => {
      const base = ART.assets[SpriteRenderer.models[model].icon];
      if (!pilot?.custom) return base;
      const portrait = PilotSystem.portrait(pilot),
        key = model + "|" + portrait;
      if (!cache.has(key)) {
        if (cache.size >= 256) cache.delete(cache.keys().next().value);
        if (!base.startsWith("data:")) {
          // SVG images cannot embed external images. Compose the portrait once,
          // then replace only matching img sources, preserving list scroll and focus.
          const placeholder = base + "#pilot-icon-" + ++serial;
          cache.set(key, placeholder);
          const face = new Image();
          const portraitReady = new Promise((resolve, reject) => {
            face.onload = resolve;
            face.onerror = reject;
            face.src = portrait;
          });
          Promise.all([
            SpriteRenderer.ensureAssets([SpriteRenderer.models[model].icon]),
            portraitReady,
          ])
            .then(() => {
              if (cache.get(key) !== placeholder) return;
              const canvas = document.createElement("canvas");
              canvas.width = canvas.height = 64;
              const ctx = canvas.getContext("2d"),
                image = SpriteRenderer.images[SpriteRenderer.models[model].icon];
              const scale = Math.min(64 / image.naturalWidth, 64 / image.naturalHeight);
              ctx.drawImage(
                image,
                (64 - image.naturalWidth * scale) / 2,
                (64 - image.naturalHeight * scale) / 2,
                image.naturalWidth * scale,
                image.naturalHeight * scale,
              );
              ctx.fillStyle = "#152430";
              ctx.strokeStyle = "#c7e2f2";
              ctx.fillRect(39, 39, 25, 25);
              ctx.strokeRect(39.5, 39.5, 24, 24);
              const crop = Math.min(face.naturalWidth, face.naturalHeight);
              ctx.drawImage(
                face,
                (face.naturalWidth - crop) / 2,
                (face.naturalHeight - crop) / 2,
                crop,
                crop,
                41,
                41,
                22,
                22,
              );
              const result = canvas.toDataURL("image/png");
              cache.set(key, result);
              const absolute = new URL(placeholder, location.href).href;
              for (const element of document.querySelectorAll("img"))
                if (element.src === absolute) element.src = result;
            })
            .catch(() => {
              /* Keep the base unit icon when a custom portrait is invalid. */
            });
          return placeholder;
        }
        const xml = (value) =>
          value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><image href="${xml(base)}" width="64" height="64"/><rect x="39" y="39" width="25" height="25" rx="3" fill="#152430" stroke="#c7e2f2"/><image href="${xml(portrait)}" x="41" y="41" width="22" height="22" preserveAspectRatio="xMidYMid slice"/></svg>`;
        cache.set(key, "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg));
      }
      return cache.get(key);
    };
  })(),
  unitName = (u) => Rules.unitName(u),
  formatNumber = (n) => Math.round(Number(n)).toLocaleString("en-US"),
  formatDistance = (n) =>
    Math.round(Number(n)).toLocaleString("en-US") + " " + I18n.text("格"),
  isAI = () => !Net.active && game.ai && game.team === 1,
  isBusy = (allowDeployment = false) =>
    !!window.ReplayPlayer?.active ||
    (phase !== "idle" && !(allowDeployment && phase === "deployment")) ||
    !!Net.awaiting ||
    !!Net.snapshot?.returnCountdown ||
    (!Net.active && MapEffects.pending()) ||
    TurnFlow.active;
function note(text) {
  setNamedText(byId("toast"), text);
  byId("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => byId("toast").classList.remove("show"), 2200);
}
async function copyQqGroup() {
  const value = "783420192";
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      copied = true;
    }
  } catch {}
  if (!copied) {
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    try {
      copied = document.execCommand("copy");
    } catch {}
    input.remove();
  }
  note(copied ? "已复制" : "复制失败，请手动复制：783420192");
}
byId("copyQqGroup").onclick = copyQqGroup;
function logUnit(unit) {
  const model = Rules.modelOf(unit);
  return `[队伍${unit.team + 1}][${UnitIdentity.owner(unit).name}]${Rules.pilotUnitName(unit)}(${model.code} ${model.name})`;
}
function addLog(text) {
  log.unshift(text);
  Chat.setLog(log);
}
function recordBattleDialogue(event, speaker, target) {
  if (typeof BattleDialogue === "undefined" || Net.active) return;
  if (!["kill", "defeat"].includes(event) && typeof DialogueRange !== "undefined" && !DialogueRange.eligible(speaker, target, getUnit)) return;
  const record = BattleDialogue.generate({
    event, speaker, target, sequence: log.length,
    faction: speaker?.pilot?.faction || Rules.modelOf(speaker)?.faction,
  });
  if (!record) return;
  record.unitName = Rules.unitLogName(speaker);
  record.position = DialogueRange.position(speaker, getUnit);
  const line = BattleDialogue.format(record);
  dialogueHistory.push({ ...record, line, logIndex: log.length, round: game.round });
  if (!ClientSettings.hidePilotDialogue()) {
    dialogueBubbles.set(record.speakerId, { text: record.text, pilotName: record.pilotName, position: record.position, defeatUnitId: record.defeatUnitId, voiceRecord: record.defeatUnitId ? record : null, until: 0 });
    if (!record.defeatUnitId && typeof DialogueAudio !== "undefined") DialogueAudio.play(record);
  }
  addLog(line);
}
let lastNetworkDialogueId = null, lastNetworkDialogueMatch = null;
globalThis.receiveBattleDialogue = function (events = [], matchId = "") {
  if (lastNetworkDialogueMatch !== matchId) { dialogueBubbles.clear(); lastNetworkDialogueMatch = matchId; }
  const recent = events.at(-1);
  if (!recent) { lastNetworkDialogueId = matchId + ":empty"; return; }
  const identity = matchId + ":" + recent.id;
  if (lastNetworkDialogueId === null) {
    lastNetworkDialogueId = identity;
    return;
  }
  if (lastNetworkDialogueId === identity) return;
  const previousIndex = events.findIndex((entry) => matchId + ":" + entry.id === lastNetworkDialogueId);
  const added = previousIndex < 0 ? events : events.slice(previousIndex + 1);
  lastNetworkDialogueId = identity;
  for (const record of added) {
    if (ClientSettings.hidePilotDialogue()) continue;
    dialogueBubbles.set(record.speakerId, { text: record.text, pilotName: record.pilotName, position: record.position, defeatUnitId: record.defeatUnitId, voiceRecord: record.defeatUnitId ? record : null, until: 0 });
    if (!record.defeatUnitId && typeof DialogueAudio !== "undefined") DialogueAudio.play(record);
  }
};
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
// Keep log identifiers and player-written pilot names literal during translation.
let namedTextNames = null,
  namedTextGame = null,
  namedTextSorted = [];
function currentUnitNames() {
  if (namedTextGame !== game || !namedTextNames) {
    namedTextGame = game;
    namedTextNames = game.units
      .flatMap((unit) => [
        Rules.unitLogName(unit),
        unit.pilot?.custom ? unit.pilot.name : null,
      ])
      .filter(Boolean);
    namedTextSorted = [...new Set(namedTextNames)].sort((a, b) => b.length - a.length);
  }
  return namedTextNames;
}
function pilotState(pilot) {
  if (!pilot) return null;
  // Portraits are immutable presentation assets, not gameplay cache inputs.
  const { icon, portrait, avatar, ...state } = pilot;
  return state;
}
function setNamedText(el, text, names = currentUnitNames()) {
  el.replaceChildren();
  let rest = String(text);
  const unique = names === namedTextNames ? namedTextSorted : [...new Set(names)].sort((a, b) => b.length - a.length);
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
// 与实际交战一样逐发预估：护甲按每发扣除，命中率按有效弹丸平均。
function attackForecast(attacker, target, weapons, response = "counter", isCounter = false) {
  let damage = 0,
    hit = 0,
    strikes = 0;
  for (const source of Array.isArray(weapons) ? weapons : [weapons]) {
    const weapon = Rules.weaponStats(source, attacker);
    for (const step of Rules.availableStrikes(attacker, weapon, target)) {
      const forecast = Rules.estimate(
        game,
        attacker,
        target,
        { ...weapon, attack: { ...weapon.attack, strikes: [step] } },
        response,
        isCounter,
      );
      damage += forecast.damage;
      hit += forecast.hit;
      strikes++;
    }
  }
  return { damage, hit: strikes ? Math.round(hit / strikes) : 0 };
}
function attackForecastText(forecast) {
  return (
    I18n.text("预计合计伤害") +
    " " +
    formatNumber(forecast.damage) +
    " · " +
    I18n.text("综合命中率") +
    " " +
    formatNumber(forecast.hit) +
    "%"
  );
}
function htmlWeapon(w, u, target = null, response = "counter", isCounter = false) {
  return WeaponInfo.summary(w, { unit: u, target, response, isCounter }).outerHTML;
}
// Rebuilt panel contents retain their local view state without affecting game state.
function capturePanelView(root) {
  if (!root) return null;
  const entries = [];
  function visit(node, path) {
    if (node === root || node.scrollTop || node.scrollLeft || node.tagName === "DETAILS")
      entries.push({
        id: node.id,
        path,
        top: node.scrollTop,
        left: node.scrollLeft,
        open: node.tagName === "DETAILS" ? node.open : undefined,
      });
    [...node.children].forEach((child, index) => visit(child, [...path, index]));
  }
  visit(root, []);
  return { root, entries };
}
function restorePanelView(state) {
  if (!state) return;
  const resolve = (entry) =>
    entry.id
      ? document.getElementById(entry.id)
      : entry.path.reduce((parent, index) => parent?.children[index], state.root);
  for (const entry of state.entries) {
    const node = resolve(entry);
    if (node?.tagName === "DETAILS" && entry.open !== undefined) node.open = entry.open;
  }
  for (const entry of state.entries) {
    const node = resolve(entry);
    if (node) {
      node.scrollTop = entry.top;
      node.scrollLeft = entry.left;
    }
  }
}
let renderedPanelSelection = null;
// 刷新顶栏、单位列表、提示和右侧指令，不推进回合。
function update() {
  const key = session + ":" + selected;
  const views =
    renderedPanelSelection === key
      ? ["hudUnitPanel", "unitPanel", "hudAttackPlanner"].map(byId).filter(Boolean)
          .filter((root, i, roots) => !roots.some(other => other !== root && other.contains(root)))
          .map(capturePanelView)
      : [];
  try {
    Rules.withModelQuery(() => AttackControls.withTargetQuery(updateContents));
  } finally {
    if (key === session + ":" + selected) views.forEach(restorePanelView);
    renderedPanelSelection = session + ":" + selected;
  }
}
let actionAvailabilityCache = null;
function playerHasActions() {
  const seat = Net.active ? Net.seat : null;
  const key = JSON.stringify([
    session,
    seat,
    Net.snapshot?.revision,
    game.round,
    game.team,
    game.winner,
    game.deployment,
    game.climateSettings,
    game.tiles,
    game.units.map((unit) => ({ ...unit, pilot: pilotState(unit.pilot) })),
  ]);
  if (
    actionAvailabilityCache?.game !== game ||
    actionAvailabilityCache.key !== key
  )
    actionAvailabilityCache = {
      game,
      key,
      value: Rules.hasActions(game, seat),
    };
  return actionAvailabilityCache.value;
}
function updateContents() {
  namedTextNames = null;
  const pendingMove = pendingMovement();
  if (!pendingMove && mode === "move-confirm") mode = "select";
  if (pendingMove && ["idle", "deployment"].includes(phase)) {
    selected = pendingMove.id;
    mode = "move-confirm";
    weaponId = null;
  }
  window.BattlePrompts?.refreshEnd();
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
  const campaignBattle = Net.snapshot?.campaign;
  byId("turnBadge").textContent = campaignBattle?.startRound
    ? `局地战 ${Math.min(game.round - campaignBattle.startRound + 1, campaignBattle.stopRound - campaignBattle.startRound)} / ${campaignBattle.stopRound - campaignBattle.startRound}回合 · ${teamName(game.team)}`
    : `第${game.round}回合 · ${teamName(game.team)}`;
  byId("turnBadge").style.color = game.team ? "var(--red)" : "var(--blue)";
  byId("phaseTitle").textContent = ({ deployment:"部署阶段", moving:"移动阶段", reaction:"应战阶段",
    battle:"交战阶段", victory:"战斗结束" })[phase] || "行动阶段";
  byId("phaseEyebrow").textContent = game.team ? "RED PHASE" : "BLUE PHASE";
  byId("endTurn").textContent = Net.active
    ? "完成计划 · 结束行动 (B)"
    : "结束" + teamName(game.team) + "回合 (B)";
  byId("endTurn").disabled = !!pendingMove || busy || isAI() || (Net.active && !Net.canAct());
  byId("confirmDeployment").classList.toggle(
    "action-attention",
    phase === "deployment" && !byId("confirmDeployment").disabled,
  );
  byId("endTurn").classList.toggle(
    "action-attention",
    !byId("endTurn").disabled && !playerHasActions(),
  );
  byId("modeLabel").textContent = Net.active
    ? (Net.local ? "离线" : "联机") +
      ({ battlefield: "雇佣兵战争模式", campaign: "历史战役模式", quick: "快速战", regular: "常规战" }[Net.snapshot?.settings?.mode] || "常规战") +
      " · " +
      Net.roleName()
    : "常规战";
  renderRoster(busy);
  renderReactionReview();
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
        : mode === "attack-target"
          ? "点击红色范围内的敌人，编排攻击序列。"
          : mode === "move"
            ? "点击蓝色格子选择移动位置，或在下方取消移动。"
            : mode === "attack-weapons"
              ? "在右侧选择武器，确认攻击计划或取消攻击。"
              : u?.team === game.team && !u.acted
                ? "点击可达格子移动，或点击敌人编排攻击。"
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
  if (pendingMove && phase === "idle") hint = "确认移动后更新视野与索敌，取消则返回原位。";
  if (MapEffects.pending()) hint = "单位击破演出中…";
  if (TurnFlow.active) hint = "回合交接中…";
  byId("hint").textContent = hint;
  byId("hint").hidden = phase === "deployment";
  renderPanel();
  window.HangarUI?.refresh();
  window.SFSUI?.refresh();
  window.BattleHUD?.refresh();
  window.BattlefieldUI?.refresh();
  TurnFlow.refreshAutoEnd();
}
// 左侧只按当前视角显示我军；观战者可查看两队，每名所有者单独成组。
function renderReactionReview() {
  let panel = byId("reactionReviewPanel");
  if (!panel) {
    panel = element("section", "reaction-review-panel");
    panel.id = "reactionReviewPanel";
    panel.setAttribute("aria-label", "应战方案复核");
    document.body.append(panel);
  }
  const snapshot = Net.snapshot,
    review = snapshot?.reactionReview;
  panel.hidden =
    !Net.active || snapshot?.phase !== "reaction" || !review || !!snapshot.reactions?.length;
  if (panel.hidden) return;
  const key = snapshot.revision + ":" + !!Net.awaiting;
  if (panel.dataset.renderKey === key) return;
  panel.dataset.renderKey = key;
  panel.replaceChildren(
    element("strong", "", "应战方案复核"),
    element("p", "", "可修改已保存的方案；所有相关玩家确认后执行。"),
  );
  for (const choice of review.choices) {
    const actor = getUnit(choice.target);
    const row = element("div", "reaction-review-row");
    row.append(
      element(
        "span",
        "",
        (actor ? Rules.modelOf(actor).name : choice.target) +
          " · " +
          I18n.text(
            { counter: "反击", defend: "防御", evade: "回避" }[choice.response] || choice.response,
          ),
      ),
    );
    const edit = element("button", "", "修改");
    edit.disabled = !!Net.awaiting;
    edit.onclick = () => Net.request("edit_response", { reactionId: choice.id });
    row.append(edit);
    panel.append(row);
  }
  const names = review.required.map((seat) => {
    const name = snapshot.members.find((member) => member.seat === seat)?.name || "玩家";
    return name + ": " + I18n.text(review.ready.includes(seat) ? "已确认" : "待确认");
  });
  panel.append(element("p", "", names.join(" · ")));
  const confirm = element(
    "button",
    "primary",
    review.ready.includes(Net.seat) ? "已确认，等待队友" : "确认应战方案",
  );
  confirm.id = "confirmReactionReview";
  confirm.disabled = !!Net.awaiting || review.ready.includes(Net.seat);
  confirm.onclick = () => Net.request("confirm_responses", { reviewId: review.id });
  panel.append(confirm);
}
let rosterCache = null;
const rosterRows = new Map();
const rosterStatus = (unit) =>
  unit.hp <= 0
    ? "已击破"
    : unit.embarked
      ? "搭载中"
      : unit.plan
        ? "已计划攻击"
        : unit.acted
          ? "行动结束"
          : unit.moved
            ? "已移动 · 可攻击"
            : "未行动";
const rosterState = (unit) =>
  JSON.stringify([
    unit.model,
    unit.hp,
    unit.en,
    unit.performance,
    pilotState(unit.pilot),
    unit.acted,
    unit.moved,
    !!unit.plan,
    !!unit.embarked,
  ]);
function refreshRosterRows(busy) {
  const units = new Map(game.units.map((unit) => [unit.id, unit]));
  for (const [id, entry] of rosterRows) {
    const unit = units.get(id);
    if (!unit) continue;
    const button = entry.button;
    button.classList.toggle("selected", id === selected);
    button.classList.toggle("dead", unit.hp <= 0);
    button.disabled = unit.hp <= 0 || (busy && phase !== "deployment");
    const state = rosterState(unit);
    if (entry.state === state) continue;
    entry.state = state;
    const model = Rules.modelOf(unit);
    for (const [kind, current, maximum] of [
      ["hp", unit.hp, model.hp],
      ["en", unit.en, model.en],
    ]) {
      const track = button.querySelector("." + kind + "-track");
      track.setAttribute("aria-valuenow", Math.max(0, current));
      track.setAttribute("aria-valuemax", maximum);
      track.title =
        kind.toUpperCase() +
        " " +
        formatNumber(current) +
        " / " +
        formatNumber(maximum);
      track.firstElementChild.style.width =
        Math.max(0, Math.min(100, (current / Math.max(1, maximum)) * 100)) +
        "%";
    }
    button.querySelector(".roster-status").textContent = I18n.text(
      rosterStatus(unit),
    );
  }
  for (const group of byId("unitRoster").querySelectorAll(".roster-owner")) {
    const own = game.units.filter(
      (unit) => Rules.ownerOf(unit) === Number(group.dataset.ownerSeat),
    );
    const text = own.filter((unit) => unit.hp > 0).length + "/" + own.length;
    const label = group.querySelector(".roster-owner-count");
    if (label.textContent !== text) label.textContent = text;
  }
}
function renderRoster(busy) {
  const key = JSON.stringify([
    session,
    game.mapId,
    Net.seat,
    Net.snapshot?.viewTeam,
    Net.snapshot?.members?.map((member) => [
      member.id,
      member.name,
      member.seat,
      member.connected,
    ]),
    I18n.language,
    game.ai,
    game.units.map((unit) => [
      unit.id,
      unit.model,
      unit.team,
      unit.ownerSeat,
      unit.pilot?.id,
      unit.pilot?.name,
      unit.pilot?.aceId,
    ]),
  ]);
  if (rosterCache?.key === key) {
    refreshRosterRows(busy);
    return;
  }
  rosterCache = { game, key };
  rosterRows.clear();
  const viewerTeam = Net.active
    ? (Net.snapshot?.viewTeam ??
      (Net.seat === null ? null : Rules.seatTeam(Net.seat)))
    : game.ai
      ? 0
      : null;
  const roster = byId("unitRoster"),
    scrollTop = roster.scrollTop;
  const allies = byId("allies"),
    enemies = byId("enemies");
  const spectating = Net.active && Net.seat === null;
  const splitTeams = spectating || viewerTeam === null;
  const teamScroll = [allies.scrollTop, enemies.scrollTop];
  roster.classList.toggle("split-teams", splitTeams);
  byId("rosterTeam1").hidden = !splitTeams;
  byId("rosterTeam0").dataset.team = String(splitTeams ? 0 : viewerTeam);
  for (const team of [0, 1]) {
    const title = byId("rosterTeam" + team + "Title");
    title.hidden = !splitTeams;
    title.textContent = I18n.text("队伍") + (team + 1);
  }
  allies.replaceChildren();
  enemies.replaceChildren();
  enemies.hidden = !splitTeams;
  const visible = game.units.filter(
    (unit) => splitTeams || unit.team === viewerTeam,
  );
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
          "roster-unit" +
            (selected === unit.id ? " selected" : "") +
            (unit.hp <= 0 ? " dead" : ""),
        );
      const image = element("img");
      image.src = unitIcon(unit.model, unit.pilot);
      image.alt = "";
      const info = element("span", "roster-unit-info");
      const name = element("strong", "roster-unit-name", unitName(unit));
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
        fill.style.width =
          Math.max(0, Math.min(100, (current / maximum) * 100)) + "%";
        track.append(fill);
        info.append(track);
      }
      info.append(element("small", "roster-status", rosterStatus(unit)));
      button.dataset.unitId = unit.id;
      rosterRows.set(unit.id, { button, state: rosterState(unit) });
      button.append(image, info);
      button.setAttribute(
        "aria-label",
        unitName(unit) + " · " + I18n.text("定位单位"),
      );
      button.disabled = unit.hp <= 0 || (busy && phase !== "deployment");
      button.onclick = () => {
        const unit = getUnit(button.dataset.unitId);
        if (!unit) return;
        if (unit.embarked && !unit.embarked.exposed) {
          const carrier = getUnit(unit.embarked.carrierId);
          if (carrier) {
            selected = carrier.id;
            mode = "select";
            update();
            MapCamera.focus(Rules.center(carrier).x, Rules.center(carrier).y);
            HangarUI.open(carrier);
          }
          return;
        }
        MapCamera.focus(Rules.center(unit).x, Rules.center(unit).y);
        if (phase === "deployment") {
          GameAudio.selectUnit(unit);
          selected = unit.id;
          weaponId = null;
          mode = "select";
          update();
        } else select(unit.id);
      };
      group.append(button);
    }
    (splitTeams && units[0].team === 1 ? enemies : allies).append(group);
  }
  roster.scrollTop = scrollTop;
  allies.scrollTop = teamScroll[0];
  enemies.scrollTop = teamScroll[1];
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
    own = u.team === game.team && (!Net.active || Net.canControl(u)),
    canCommand =
      own &&
      !pendingMovement() &&
      (!u.acted || !!u.plan || !!u.squadOrder) &&
      !isBusy() &&
      !isAI() &&
      (!Net.active || Net.canAct());
  const canSkillCommand =
    own && !u.acted && !u.plan && !u.squadOrder && !pendingMovement() && !isBusy() && !isAI() && (!Net.active || Net.canAct());
  panel.replaceChildren();
  let head = element("div", "unit-card-head");
  head.innerHTML = /* HTML */ `<img src="${unitIcon(u.model, u.pilot)}" alt="" />
    <div>
      <strong class="${u.team ? "red" : "blue"}">${escapeHtml(unitName(u))}</strong
      ><small>${m.code} · ${m.kitName} · ${teamName(u.team)}</small>
    </div>`;
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
  const resources = element("div", "hud-resources");
  for (const [label, value, maximum] of [
    ["HP", u.hp, m.hp],
    ["EN", u.en, m.en],
  ]) {
    const row = element("div", "hud-resource " + label.toLowerCase());
    row.append(
      element("span", "", label),
      element("strong", "", `${formatNumber(value)} / ${formatNumber(maximum)}`),
    );
    const track = element("div", "hud-resource-track"),
      fill = element("i", "");
    fill.style.width = Math.max(0, Math.min(100, (value / Math.max(1, maximum)) * 100)) + "%";
    track.append(fill);
    row.append(track);
    resources.append(row);
  }
  panel.append(resources);
  const overview = element("section", "hud-tab-pane");
  overview.dataset.hudPane = "overview";
  panel.append(overview);
  const sensorRanges = Rules.sensors.ranges(u, game);
  let stats = element("div", "stats");
  stats.innerHTML = /* HTML */ `<div><span>移动力</span>${formatDistance(m.move)}</div>
    <div data-sensor-range="sight"><span>视野距离</span>${formatDistance(sensorRanges.sight)}</div>
    <div data-sensor-range="radar"><span>侦察距离</span>${formatDistance(sensorRanges.radar)}</div>
    <div><span>机动</span>${m.speed ?? 100}</div>
    <div><span>反应系数</span>${Math.round(m.mobility)}</div>
    <div><span>命中系数</span>${Math.round(m.accuracy)}%</div>
    <div><span>地面适应性</span>${m.adaptability.ground}%</div>
    <div><span>宇宙适应性</span>${m.adaptability.space}%</div>
    <div><span>零件强度</span>${Math.round(m.partStructuralStrength)}</div>
    <div>
      <span>盾牌</span
      >${m.shield.hp > 0 ? formatNumber(u.shield ?? 0) + " / " + formatNumber(m.shield.hp) : "无独立盾牌"}
    </div>
    <div>
      <span>当前位置</span>${Rules.columnLabel(u.x)}${u.y + 1} ·
      ${Rules.terrainStyle(game.mapId, game.tiles[u.y][u.x]).name}
    </div>`;
  const pilot = PilotSystem.of(u),
    pilotLine = element("div", "unit-pilot-heading"),
    pilotStats = element("div", "unit-pilot-stats");
  const pilotLabel = element("span", "", I18n.pilotName(pilot));
  pilotLabel.dataset.i18nIgnore = "";
  pilotLine.append(document.createTextNode(I18n.text("驾驶员") + " · "), pilotLabel);
  for (const [key, label] of Object.entries(PilotSystem.labels)) {
    const cell = element("div");
    cell.append(
      element("span", "", label),
      element("strong", "", String(Math.round(pilot.stats[key]))),
    );
    pilotStats.append(cell);
  }
  if (pilot.custom) {
    const xp = element(
      "div",
      "unit-pilot-experience",
      `Lv.${pilot.level} · EXP ${pilot.experience}/${pilot.level >= PilotSystem.maxLevel(pilot) ? "MAX" : PilotSystem.experienceRequired(pilot.level, pilot)}`,
    );
    xp.dataset.pilotExperience = "";
    if (pilot.ace) {
      const placeholder = element("small", "muted", "ACE技能");
      placeholder.append(
        document.createTextNode(
          " · " +
            PilotSystem.aceProfile(pilot)
              .skills.map((s) => s.name)
              .join(" / "),
        ),
      );
      xp.append(placeholder);
    }
    stats.prepend(pilotLine, xp, pilotStats);
  } else stats.prepend(pilotLine, pilotStats);
  stats.append(element("div", "", `${I18n.text("AP参考")} ${formatNumber(m.actionPoints)}`));
  overview.append(stats);
  const partStatus = element("div", "rule-box");
  partStatus.id = "unitPartStatus";
  partStatus.append(element("strong", "", "部位状态"));
  for (const [part, name] of Object.entries(Rules.partNames).filter(
    ([part]) =>
      ["head", "backpack", "leftArm", "rightArm", "leftLeg", "rightLeg"].includes(part) &&
      !m.ship &&
      m.partsBreakable !== false,
  )) {
    const broken = !!u.brokenParts?.[part];
    const label = element(
      "span",
      broken ? "red" : "muted",
      " · " + I18n.text(name) + ": " + I18n.text(broken ? "损坏" : "完好"),
    );
    label.dataset.part = part;
    partStatus.append(label);
  }
  if (m.movementType === "air")
    partStatus.append(element("span", "muted", " · 空军：可跨越山岩和水域"));
  if (m.modules?.length) {
    const moduleList = element("details", "ship-modules");
    moduleList.append(
      element(
        "summary",
        "",
        `炮塔模块 ${m.modules.filter((module) => (u.moduleHp?.[module.id] ?? module.hp) > 0).length}/${m.modules.length}`,
      ),
    );
    for (const module of m.modules) {
      const hp = u.moduleHp?.[module.id] ?? module.hp;
      const row = element(
        "div",
        hp > 0 ? "helper" : "helper red",
        `${module.name} · HP ${formatNumber(hp)}/${formatNumber(module.hp)}`,
      );
      row.dataset.module = module.id;
      moduleList.append(row);
    }
    partStatus.append(moduleList);
    if (m.ship) {
      const size = Rules.dimensions(u);
      partStatus.append(
        element("p", "helper", `战舰占地 ${size.width}×${size.height} · 转向占用移动行动`),
      );
    }
  }
  const penalty = Rules.partPenalties(u),
    effects = [];
  if (penalty.attackMultiplier < 1) effects.push(I18n.text("头部损毁：攻击力-25%"));
  if (penalty.moveMultiplier < 1)
    effects.push(I18n.text("背包损毁：移动力-25%（向下取整，至少1格）"));
  if (penalty.resistancePenalty)
    effects.push(I18n.text("四肢损毁：抗性降低") + " " + penalty.resistancePenalty + "%");
  if (u.burning) effects.push(I18n.text("燃烧中"));
  if (m.iField)
    partStatus.append(
      element(
        "p",
        "helper",
        `${I18n.text("I立场")} ${Math.round(Math.max(0, Rules.iFieldHP(u))).toLocaleString()} / ${m.iField.capacity.toLocaleString()}${Rules.iFieldHP(u) <= 0 ? " · " + I18n.text("恢复中") : ""}`,
      ),
    );
  if (Rules.smokeAt(game, u))
    partStatus.append(element("p", "helper", I18n.text("烟雾掩护：受到远程攻击时命中率×75%")));
  if (effects.length) partStatus.append(element("p", "red", effects.join(" · ")));
  overview.append(partStatus);
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
  overview.append(protection);
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
  overview.append(attacks);
  for (const ability of [
    ...SkillControls.commandAbilities(m, u),
    ...SkillControls.defensiveAbilities(m),
  ]) {
    const card = element("section", "rule-box");
    card.append(element("strong", "", ability.name), element("p", "helper", ability.description));
    overview.append(card);
  }
  const command = Rules.commandEffects(game, u);
  const commandLabels = { attack: "攻击指挥", defense: "防御指挥", communication: "通信指挥" };
  for (const [kind, value] of Object.entries(command))
    if (value)
      overview.append(
        element(
          "p",
          "helper",
          I18n.text(commandLabels[kind]) + " +" + Math.round(value * 100) + "%",
        ),
      );
  let actions = element("div", "actions");
  for (const [label, fn, disabled] of [
    [
      "待机",
      () => {
        if (Net.active) {
          Net.request("wait", { unitId: u.id, single: squadSingleMove });
          return;
        }
        Rules.wait(game, u, squadSingleMove);
        addLog(`${logUnit(u)} 待机。`);
        mode = "select";
        weaponId = null;
        update();
      },
      !canCommand || u.acted || !!u.plan || !!u.squadOrder,
    ],
    [
      "移动",
      () => {
        mode = "move";
        weaponId = null;
        update();
      },
      !canCommand || u.moved || u.acted,
    ],
    [
      "攻击",
      () => AttackControls.start(u),
      !canCommand || !AttackControls.editable(u) || (!AttackControls.hasPlan(u) && !game.units.some((target) => AttackControls.canTarget(u, target))),
    ],
    [
      "技能",
      () => window.BattleHUD?.setTab("skills"),
      !canSkillCommand || u.acted || !!u.plan || !!u.squadOrder ||
        (!m.weapons.some((w) => w.slot === "skill") && !Rules.unitSkills(u).length),
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
    b.dataset.unitCommand = {
      待机: "wait",
      移动: "move",
      撤回移动: "move",
      攻击: "attack",
      技能: "skills",
      取消选武器: "cancel",
    }[label];
    const shortcut = { move: "Q", attack: "W", skills: "E", wait: "V" }[b.dataset.unitCommand];
    if (shortcut) {
      const hint = element("span", "", "(" + shortcut + ")");
      hint.setAttribute("data-i18n-ignore", "");
      b.append(hint);
      b.setAttribute("aria-keyshortcuts", shortcut);
    }
    b.disabled = disabled;
    b.onclick = fn;
    actions.append(b);
  }
  if (m.ship || m.fixedWeaponFacing)
    for (const [direction, label] of [
      [-1, "左转90°"],
      [1, "右转90°"],
    ]) {
      const button = element("button", "", label);
      button.dataset.shipTurn = String(direction);
      const commanding =
        phase === "deployment"
          ? Net.active
            ? Net.canControl(u)
            : Rules.ownerOf(u) === Deployment.team()
          : canCommand;
      button.disabled = !commanding || !Rules.canRotate(game, u, direction);
      button.onclick = () => {
        if (Net.active) return Net.request("rotate", { unitId: u.id, direction });
        Rules.previewRotate(game, u, direction, Rules.ownerOf(u));
        update();
      };
      actions.append(button);
    }
  const hangarButton = window.HangarUI?.actionButton(u);
  if (hangarButton) actions.append(hangarButton);
  overview.append(
    element(
      "p",
      "helper",
      [
        { small: "小型", medium: "中型", large: "大型" }[Rules.unitSize(m)],
        ...(m.unitTags || [])
          .filter((tag) => !["SmallUnit", "MediumUnit", "LargeUnit"].includes(tag))
          .map((tag) => I18n.text(Rules.unitTagName(tag))),
      ].join(" · "),
    ),
  );
  actions.id = "unitActions";
  panel.append(actions);
  const weaponSection = element("section", "hud-tab-pane");
  weaponSection.dataset.hudPane = "weapons";
  panel.append(weaponSection);
  const skillSection = element("section", "hud-tab-pane");
  skillSection.dataset.hudPane = "skills";
  panel.append(skillSection);
  weaponSection.append(element("div", "section-title", "ATTACK / 自动交火"));
  if (m.supplyAura)
    panel.append(
      element(
        "p",
        "helper",
        `补给范围 ${m.supplyAura.range} · 每回合范围内友军HP +5%、EN +10% · 无EN消耗`,
      ),
    );
  if (u.snipeOrder)
    panel.append(
      element("p", "helper", "狙击锁定中：下次己方回合开始时检查射程并自动射击，命中率×2。"),
    );
  if (u.overBoost)
    panel.append(
      element(
        "p",
        "helper",
        "超限喷射启动中 · 移动力+3、反应系数×1.15 · 每个后续己方回合损失25%最大耐久",
      ),
    );
  if (u.fullBoost)
    panel.append(
      element(
        "p",
        "helper",
        `全力推进中 · 移动力+2、反应系数×1.10 · 剩余${u.fullBoost.remaining}个己方回合`,
      ),
    );
  if (u.overdrive)
    panel.append(
      element(
        "p",
        "helper",
        `${u.overdrive.skillId}强化中 · 剩余${u.overdrive.remaining}个己方回合`,
      ),
    );
  for (const skills of [false, true]) {
    const container = skills ? skillSection : weaponSection;
    if (skills) container.append(element("div", "section-title", "SKILLS / 技能"));
    if (!skills) {
      AttackControls.render(container, u, canCommand);
      const loadout = element("div", "weapon-list");
      loadout.dataset.fullLoadout = "true";
      for (const item of m.weapons) loadout.append(WeaponInfo.card(item,null,{unit:u}));
      container.append(loadout);
      continue;
    }
    let list = element("div", "weapon-list");
    if (skills) SkillControls.render(list, u, canSkillCommand);
    container.append(list);
  }
  if (mode === "target" && weaponId && own) {
    let w = getWeapon(u, weaponId),
      targets = game.units.filter((t) => Rules.canAttack(game, u, t, w));
    const targetContainer = w.slot === "skill" ? skillSection : weaponSection;
    targetContainer.append(element("div", "section-title", "TARGETS / 可选目标"));
    if (!targets.length)
      targetContainer.append(
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
      targetContainer.append(button);
    }
  }
  let info = u.attackSkillRound === game.round
    ? "已使用攻击类技能，本回合不能普通攻击或取消攻击。"
    : u.plan
    ? "已确认单一目标；本队结束规划后自动交火，可修改或取消目标。"
    : u.acted
      ? "本单位行动已经结束。"
      : !own
        ? "当前是对手的单位，可查看其射程与资源。"
        : u.moved
          ? "已移动：仍可攻击或待机。攻击后不可再移动。"
          : "移动可选；选择单一目标后自动安排所有可用武器。";
  weaponSection.append(element("div", "rule-box", info));
  if (Net.active && u.plan && Net.canControl(u) && phase === "idle") {
    const cancel = element("button", "", "取消全部攻击计划");
    cancel.id = "cancelAttackPlan";
    cancel.disabled = !Net.canAct() || u.attackSkillRound === game.round;
    cancel.onclick = () => Net.request("cancel_attack", { unitId: u.id, single: squadSingleMove });
    weaponSection.append(cancel);
  }
}
let squadSingleMove = false,
  squadCombatMode = "melee";
function select(id, { single = false } = {}) {
  if (pendingMovement()) return;
  if (isBusy()) return;
  let u = getUnit(id);
  if (!u || u.hp <= 0) return;
  GameAudio.selectUnit(u);
  selected = id;
  squadSingleMove = single;
  if (Rules.squadMembers(game, u).length < 2) squadCombatMode = "melee";
  AttackControls.reset();
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
// Movement and deployment depend on board state, never on animation time or camera zoom.
let mapRangeCache = null;
const emptyMapRanges = {
  moveCells: new Map(),
  moveHighlights: new Set(),
  deploymentArea: new Set(),
  attackArea: new Set(),
  attackTargets: new Set(),
};
function mapRanges(chosen, canMove, deploymentSeat, showAttack = false) {
  if (!canMove && deploymentSeat === null && !showAttack) return emptyMapRanges;
  const state = JSON.stringify([
    chosen?.id,
    squadSingleMove,
    squadCombatMode,
    canMove,
    deploymentSeat,
    showAttack,
    game.mapId,
    game.environment,
    game.team,
    game.deployment,
    game.campaignBattlefield?.regionId,
    game.campaignBattlefield?.version,
    game.campaignBattlefield?.deploymentControllers,
    chosen?.campaignEntry,
    chosen?.campaignDeploying,
    game.units.map((u) => [
      u.id,
      u.model,
      u.x,
      u.y,
      u.angle,
      u.team,
      u.ownerSeat,
      u.squadId,
      u.squadSlot,
      u.hp,
      u.moved,
      u.acted,
      u.performance,
      u.environment,
      u.flying,
      u.overBoost,
      u.fullBoost,
      pilotState(u.pilot),
      u.brokenParts,
      u.moduleHp,
      u.en,
      u.plan,
      u.embarked,
      u.pendingMove,
    ]),
  ]);
  if (
    mapRangeCache?.game === game &&
    mapRangeCache.tiles === game.tiles &&
    mapRangeCache.state === state &&
    mapRangeCache.model === Rules.models[chosen?.model]
  )
    return mapRangeCache;
  const moveCells = canMove
    ? chosen.embarked?.exposed
      ? new Map(Rules.hangars.launchCells(game, chosen).map((p) => [Rules.key(p.x, p.y), p]))
      : Rules.reachable(game, chosen, null, squadSingleMove)
    : new Map();
  const displayCell = (c) => {
    const size = chosen ? Rules.dimensions(chosen) : { width: 1, height: 1 };
    return Rules.key(
      Math.floor(c.x + (size.width - 1) / 2),
      Math.floor(c.y + (size.height - 1) / 2),
    );
  };
  const moveHighlights = new Set(
    [...moveCells.values()].filter((c) => c.path.length).map(displayCell),
  );
  const deploymentCells =
      deploymentSeat === null
        ? []
        : Rules.deploymentCells(
            game,
            deploymentSeat,
            !game.campaignBattlefield ||
              (chosen?.campaignDeploying &&
                Rules.campaignBattlefield.deploymentSeat(game, chosen) === deploymentSeat)
              ? chosen
              : null,
          ),
    allowedFootprint = new Set(deploymentCells.map((c) => Rules.key(c.x, c.y))),
    deploymentArea = new Set(
      deploymentCells
        .filter(
          (c) =>
            !chosen ||
            !Rules.models[chosen.model].ship ||
            Rules.fits(
              game,
              chosen,
              c.x,
              c.y,
              chosen.angle,
              false,
              deploymentSeat,
              allowedFootprint,
            ),
        )
        .map(displayCell),
    );
  const attackArea = new Set(),
    attackTargets = new Set();
  if (showAttack && chosen) {
    for (const member of squadSingleMove ? [chosen] : Rules.squadAttackMembers(game, chosen)) {
      // 射程可随预览落点更新；视野与索敌仍使用未确认的裁定状态。
      const attackOrigin = chosen.pendingMove
        ? {
            ...member,
            x: chosen.pendingMove.x,
            y: chosen.pendingMove.y,
            angle: chosen.pendingMove.angle,
            pendingMove: null,
          }
        : member;
      const weapons = Rules.modelOf(member).weapons.filter(
        (w) => Rules.canUse(member, w) && (squadCombatMode !== "shooting" || w.type !== "melee"),
      );
      const radius = Math.max(0, ...weapons.map((w) => w.max)),
        size = Rules.dimensions(attackOrigin);
      for (
        let y = Math.max(0, attackOrigin.y - radius);
        y < Math.min(Rules.mapHeight(game), attackOrigin.y + size.height + radius);
        y++
      )
        for (
          let x = Math.max(0, attackOrigin.x - radius);
          x < Math.min(Rules.mapWidth(game), attackOrigin.x + size.width + radius);
          x++
        ) {
          const cell = { x, y };
          if (
            weapons.some(
              (w) =>
                Rules.inRange(attackOrigin, cell, w) &&
                Rules.availableStrikes(attackOrigin, w, cell).length,
            )
          )
            attackArea.add(Rules.key(x, y));
        }
      for (const target of game.units)
        if (weapons.some((w) => Rules.canAttack(game, attackOrigin, target, w)))
          attackTargets.add(target.id);
    }
  }
  return (mapRangeCache = {
    game,
    tiles: game.tiles,
    state,
    model: Rules.models[chosen?.model],
    moveCells,
    moveHighlights,
    deploymentArea,
    attackArea,
    attackTargets,
  });
}
// Cache only the viewport-sized terrain image, so large maps do not allocate giant canvases.
// Map catalog tiles are immutable in battle; each server snapshot copies the same terrain.
const mapTerrainCache = { canvas: null, viewKey: "" };
const authoredTerrainBase = {tiles: null, mapId: null, canvas: null};
// Run on battle identity changes, including restarting the same map. Menu and
// hangar navigation within a live match deliberately keep the current resources.
function resetMapPresentation(keepKeys = []) {
  SpriteRenderer.releaseBattleResources(keepKeys);
  TileMapRenderer.reset();
  BattlefieldWeather.reset();
  EnvironmentVisuals.reset();
  mapRangeCache = null;
  for (const cache of [mapTerrainCache, authoredTerrainBase]) {
    if (cache.canvas) cache.canvas.width = cache.canvas.height = 0;
    cache.canvas = null;
  }
  mapTerrainCache.viewKey = "";
  authoredTerrainBase.tiles = authoredTerrainBase.mapId = null;
  dialogueBubbles.clear();
  delete globalThis.ProjectGreedMapLighting;
  delete globalThis.ProjectGreedLightTransition;
}
function drawCachedMapTerrain(target, w, h, dpr, tile, ox, oy, immersive, deploymentArea) {
  if (Rules.getMap(game.mapId).tileMap) {
    // Authored art supplies terrain detail; its fallback colors need only one pixel per cell.
    const base = authoredTerrainBase;
    if (base.tiles !== game.tiles || base.mapId !== game.mapId) {
      const canvas = base.canvas || (base.canvas = document.createElement("canvas"));
      canvas.width = Rules.mapWidth(game); canvas.height = Rules.mapHeight(game);
      const context = canvas.getContext("2d");
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        context.fillStyle = Rules.terrainStyle(game.mapId, game.tiles[y][x]).color;
        context.fillRect(x, y, 1, 1);
      }
      base.tiles = game.tiles; base.mapId = game.mapId;
    }
    target.save(); target.imageSmoothingEnabled = false;
    target.drawImage(base.canvas, ox, oy, base.canvas.width * tile, base.canvas.height * tile);
    target.restore(); return;
  }

  const cache = mapTerrainCache;
  const deploying = !immersive && phase === "deployment";
  const viewKey = JSON.stringify([
    game.mapId,
    w,
    h,
    dpr,
    tile,
    ox,
    oy,
    !!immersive,
    deploying,
    deploying ? Deployment.team() : null,
    deploying ? [...deploymentArea] : null,
  ]);
  if (viewKey !== cache.viewKey) {
    const canvas = cache.canvas || (cache.canvas = document.createElement("canvas"));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const firstX = Math.max(0, Math.floor(-ox / tile)),
      firstY = Math.max(0, Math.floor(-oy / tile)),
      lastX = Math.min(Rules.mapWidth(game), Math.ceil((w - ox) / tile)),
      lastY = Math.min(Rules.mapHeight(game), Math.ceil((h - oy) / tile));
    for (let y = firstY; y < lastY; y++)
      for (let x = firstX; x < lastX; x++) {
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
        if (!immersive) ctx.strokeRect(px + 0.4, py + 0.4, tile - 0.8, tile - 0.8);
        if (!immersive && phase === "deployment" && !game.campaignBattlefield) {
          const expansion = Rules.getMap(game.mapId).deploymentExpansion;
          if (
            expansion &&
            (x < expansion.addedLeft || x >= expansion.addedLeft + expansion.baseWidth)
          ) {
            ctx.fillStyle = x < expansion.addedLeft ? "#59b9f333" : "#f36b7933";
            ctx.fillRect(px, py, tile, tile);
          }
        }
        if (
          !immersive &&
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
      }

    cache.viewKey = viewKey;
  }
  target.drawImage(cache.canvas, 0, 0, w, h);
}

let mapMinovskyCache = { key: "", cells: new Set() };
function mapMinovskyCells() {
  const key = JSON.stringify([
    game.round,
    Rules.mapWidth(game),
    Rules.mapHeight(game),
    game.minovskyFields,
  ]);
  if (key !== mapMinovskyCache.key) mapMinovskyCache = { key, cells: Rules.minovskyCells(game) };
  return mapMinovskyCache.cells;
}

// 地图画布：先画地形与范围，再画单位、血条和名称。now 是毫秒时间。
function drawCampaignSupply(ctx, ox, oy, tile) {
  const field = game.campaignBattlefield,
    net = Rules.campaignBattlefield.network(game);
  if (!field || !net) return;
  const color = (team) => (team === 0 ? "#68c7ff" : team === 1 ? "#ff7789" : "#ffffff");
  const screen = (node) => ({ x: ox + (node.x + 0.5) * tile, y: oy + (node.y + 0.5) * tile });
  ctx.save();
  for (const line of net.lines) {
    const a = screen(line.a),
      b = screen(line.b);
    ctx.strokeStyle = color(line.team);
    ctx.lineWidth = Math.max(1, tile * 0.08);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (const node of net.nodes) {
    const p = screen(node),
      team = node.region ? field.adjacentOwners[node.region] : field.owners[node.id];
    ctx.strokeStyle = color(team);
    ctx.lineWidth = Math.max(1.5, tile * 0.1);
    ctx.fillStyle = "#101923bb";
    const areaRadius = node.region ? node.radius : 1;
    const areaSize = tile * (areaRadius * 2 + 1);
    ctx.strokeRect(p.x - areaSize / 2, p.y - areaSize / 2, areaSize, areaSize);
    if (!node.region) {
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = Math.max(0.5, tile * 0.025);
      for (const offset of [-0.5, 0.5]) {
        ctx.beginPath();
        ctx.moveTo(p.x + tile * offset, p.y - areaSize / 2);
        ctx.lineTo(p.x + tile * offset, p.y + areaSize / 2);
        ctx.moveTo(p.x - areaSize / 2, p.y + tile * offset);
        ctx.lineTo(p.x + areaSize / 2, p.y + tile * offset);
        ctx.stroke();
      }
      ctx.restore();
    }
    const radius = Math.max(6, tile * 0.45);
    ctx.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
    ctx.strokeRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
    ctx.fillStyle = color(team);
    ctx.font = `bold ${Math.max(9, Math.min(13, tile * 0.6))}px sans-serif`;
    ctx.textAlign = "center";
    const label = node.region
      ? CAMPAIGN_WORLD.regions.find((region) => region.id === node.region)?.name || node.region
      : node.kind === "base"
        ? I18n.text("基地")
        : I18n.text(node.name);
    ctx.fillText(label, p.x, p.y - radius - 4);
    ctx.fillText(team === null ? "—" : String(team + 1), p.x, p.y + 4);
  }
  ctx.restore();
}
function drawMap(now) {
  return Rules.withModelQuery(() => drawMapFrame(now));
}
function drawMapFrame(now) {
  const battleSettings = BattleScene.settings();
  // Lifetime is exactly one draw: simulation changes can never reuse a stale model.
  const frameModels = new WeakMap(), frameSquads = new Map();
  const frameUnits = new Map(game.units.map(unit => [unit.id, unit]));
  const frameUnit = id => frameUnits.get(id) || getUnit(id);
  function frameModelOf(unit) {
    if (!frameModels.has(unit)) frameModels.set(unit,Rules.modelOf(unit));
    return frameModels.get(unit);
  }
  const squadKey = unit => JSON.stringify([unit.squadId,unit.team,Rules.controllerOf(game,unit),unit.x,unit.y]);
  for (const unit of game.units) {
    if (!unit.squadId || !Rules.onMap(unit) || unit.embarked) continue;
    const key = squadKey(unit);
    if (!frameSquads.has(key)) frameSquads.set(key,[]);
    frameSquads.get(key).push(unit);
  }
  for (const members of frameSquads.values())
    members.sort((a,b) => (a.squadSlot ?? 0)-(b.squadSlot ?? 0) || a.id.localeCompare(b.id));
  const launchMembers = new Map();
  for (const root of game.units) {
    const ids = root.pendingMove?.squadLaunchIds;
    if (!ids) continue;
    const group = ids.map(frameUnit).filter(Boolean);
    for (const member of group) launchMembers.set(member.id,group);
  }
  const frameMembersOf = unit => launchMembers.get(unit?.id) ||
    (unit?.squadId ? frameSquads.get(squadKey(unit)) || [] : unit ? [unit] : []);
  const selectedSquad = new Set(frameMembersOf(getUnit(selected)).map(unit => unit.id));
  let c = byId("map"),
    box = MapCamera.renderSize(),
    dpr = window.GameViewport?.pixelRatio(box.width, box.height) || window.devicePixelRatio || 1;
  if (box.width < 1 || box.height < 1) return;
  SpriteRenderer.beginFrame?.();
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
  const immersive = window.ReplayPresentation?.immersive;
  const chosen = immersive ? null : getUnit(selected),
    canMove = !!(
      chosen &&
      chosen.hp > 0 &&
      chosen.team === game.team &&
      (!Net.active || Net.canControl(chosen)) &&
      !chosen.acted &&
      !chosen.moved &&
      phase === "idle" &&
      ["select", "move"].includes(mode) &&
      !isAI() &&
      (!Net.active || Net.canAct())
    ),
    { moveHighlights, deploymentArea, attackArea, attackTargets } = mapRanges(
      chosen,
      canMove,
      phase === "deployment" ? Deployment.areaSeat() : null,
      !!(
        chosen &&
        chosen.hp > 0 &&
        chosen.team === game.team &&
        (!chosen.acted || chosen.plan) &&
        phase === "idle" &&
        !isAI() &&
        (!Net.active || Net.canControl(chosen))
      ),
    ),
    weapon = chosen && weaponId ? getWeapon(chosen, weaponId) : null;
  c.dataset.attackRangeCells = String(attackArea.size);
  c.dataset.attackableTargets = String(attackTargets.size);
  const skillCells = new Set([...SkillControls.cells(chosen), ...(window.HangarUI?.cells() || [])]),
    minovskyCells = mapMinovskyCells();
  c.dataset.minovskyCells = String(minovskyCells.size);
  // Skip terrain cells outside the viewport when zoomed in.
  const firstX = Math.max(0, Math.floor(-ox / tile)),
    firstY = Math.max(0, Math.floor(-oy / tile)),
    lastX = Math.min(Rules.mapWidth(game), Math.ceil((w - ox) / tile)),
    lastY = Math.min(Rules.mapHeight(game), Math.ceil((h - oy) / tile));
  drawCachedMapTerrain(ctx, w, h, dpr, tile, ox, oy, immersive, deploymentArea);
  TileMapRenderer.draw(ctx, Rules.getMap(game.mapId), "below", mapGeo, w, h);
  if (Rules.getMap(game.mapId).tileMap && !immersive) {
    // Authored art can be opaque, so tactical guides belong above the image layers.
    ctx.strokeStyle = "#49616b66";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (let x = firstX; x <= lastX; x++) {
      ctx.moveTo(ox + x * tile, oy + firstY * tile);
      ctx.lineTo(ox + x * tile, oy + lastY * tile);
    }
    for (let y = firstY; y <= lastY; y++) {
      ctx.moveTo(ox + firstX * tile, oy + y * tile);
      ctx.lineTo(ox + lastX * tile, oy + y * tile);
    }
    ctx.stroke();
    if (phase === "deployment" && Deployment.team() !== null) {
      ctx.fillStyle = "#5ee4b344";
      for (const key of deploymentArea) {
        const [x, y] = key.split(",").map(Number);
        if (x >= firstX && x < lastX && y >= firstY && y < lastY)
          ctx.fillRect(ox + x * tile, oy + y * tile, tile, tile);
      }
    }
  }
  for (const field of game.beamDiffusionFields || []) {
    if (field.expiresRound <= game.round) continue;
    ctx.save();
    ctx.fillStyle = "rgba(108,197,220,.12)";
    ctx.strokeStyle = "#89dded99";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(
      ox + (field.x + 0.5) * tile,
      oy + (field.y + 0.5) * tile,
      field.radius * tile,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.restore();
  }

  const hasCellOverlays =
    minovskyCells.size ||
    (!immersive &&
      (moveHighlights.size || attackArea.size || skillCells.size || (mode === "target" && weapon)));
  // Idle frames with no range/field overlays need no per-cell traversal at all.
  for (let y = firstY; hasCellOverlays && y < lastY; y++)
    for (let x = firstX; x < lastX; x++) {
      const px = ox + x * tile,
        py = oy + y * tile;
      ctx.lineWidth = 0.7;
      if (minovskyCells.has(Rules.key(x, y))) {
        // Static, deterministic blocks provide a noisy field without animated particles or allocations.
        const seed = (Math.imul(x + 17, 73856093) ^ Math.imul(y + 31, 19349663)) >>> 0;
        ctx.fillStyle = "rgba(118, 103, 190, 0.13)";
        ctx.fillRect(px, py, tile, tile);
        ctx.fillStyle = "rgba(190, 213, 230, 0.12)";
        for (let i = 0; i < 3; i++) {
          const sx = ((seed >>> (i * 5)) & 15) / 16,
            sy = ((seed >>> (i * 5 + 3)) & 15) / 16,
            size = tile * (0.12 + ((seed >>> (i * 4 + 1)) & 3) / 32);
          ctx.fillRect(px + sx * (tile - size), py + sy * (tile - size), size, size);
        }
      }
      if (!immersive && moveHighlights.has(Rules.key(x, y))) {
        ctx.fillStyle = "#63caff2d";
        ctx.fillRect(px + 2, py + 2, tile - 4, tile - 4);
        ctx.strokeStyle = "#6ac6f05f";
        ctx.strokeRect(px + 2, py + 2, tile - 4, tile - 4);
      }
      if (!immersive && attackArea.has(Rules.key(x, y))) {
        ctx.fillStyle = "rgba(242, 107, 115, 0.25)";
        ctx.fillRect(px + 2, py + 2, tile - 4, tile - 4);
        ctx.strokeStyle = "#f26b73aa";
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 2, py + 2, tile - 4, tile - 4);
      }
      if (!immersive && chosen && mode === "attack-weapons") {
        const aiming = AttackControls.targetFor(chosen);
        if (aiming?.aimCell?.x === x && aiming.aimCell.y === y) {
          ctx.strokeStyle = Rules.weakPoint(aiming, aiming.aimCell) ? "#ffd45b" : "#ffffff";
          ctx.lineWidth = 3;
          ctx.strokeRect(px + 3, py + 3, tile - 6, tile - 6);
        }
      }
      if (!immersive && skillCells.has(Rules.key(x, y))) {
        ctx.fillStyle = "#e4c56c45";
        ctx.fillRect(px + 2, py + 2, tile - 4, tile - 4);
        ctx.strokeStyle = "#f1d781bb";
        ctx.strokeRect(px + 2, py + 2, tile - 4, tile - 4);
      }
      if (!immersive && mode === "target" && weapon && Rules.inRange(chosen, { x, y }, weapon)) {
        ctx.fillStyle = "#d19a552b";
        ctx.fillRect(px + 2, py + 2, tile - 4, tile - 4);
      }
    }
  if (!immersive && mode === "target" && weapon?.special?.type === "nuke" && hover) {
    const target = Rules.groundTarget(game, chosen, hover.x, hover.y);
    if (target && Rules.canAttack(game, chosen, target, weapon)) {
      const radius = weapon.special.radius;
      ctx.fillStyle = "rgba(255, 116, 64, 0.35)";
      ctx.strokeStyle = "#ffb36b";
      ctx.lineWidth = 1;
      for (
        let y = Math.max(firstY, hover.y - radius);
        y < Math.min(lastY, hover.y + radius + 1);
        y++
      )
        for (
          let x = Math.max(firstX, hover.x - radius);
          x < Math.min(lastX, hover.x + radius + 1);
          x++
        ) {
          if (!Rules.blastContains(hover, { x, y }, radius)) continue;
          const px = ox + x * tile,
            py = oy + y * tile;
          ctx.fillRect(px, py, tile, tile);
          ctx.strokeRect(px, py, tile, tile);
        }
    }
  }
  ctx.font = "9px ui-monospace,monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#8ea5af";
  for (let x = 0; !immersive && x < Rules.mapWidth(game); x++)
    ctx.fillText(Rules.columnLabel(x), ox + (x + 0.5) * tile, oy - 9);
  for (let y = 0; !immersive && y < Rules.mapHeight(game); y++)
    ctx.fillText(String(y + 1), ox - 9, oy + (y + 0.5) * tile);
  const intel =
    Net.snapshot?.phase === "playback" ? Net.snapshot.combatIntel || game.intel : game.intel;
  EnvironmentVisuals.fog(ctx, intel, ox, oy, tile);
  drawCampaignSupply(ctx, ox, oy, tile);
  window.BattlefieldUI?.draw(ctx, ox, oy, tile);
  // The clip remains available for individual effects opting out of fog visibility.
  const visibilityClip = EnvironmentVisuals.visibilityClip(intel, ox, oy, tile);
  const drawVisibleEffects = (draw) => {
    ctx.save();

    draw();
    ctx.restore();
  };
  SpriteEffects.setFogClip(visibilityClip, ctx);
  const mapUnitPoses = [],
    mapPosesById = new Map(),
    selectionMarks = [];
  const squadPendingMoves = new Map();
  for (const actor of game.units)
    for (const id of actor.pendingMove?.squadIds || [])
      squadPendingMoves.set(id, actor.pendingMove);
  drawVisibleEffects(() => MapCombat.drawUnderlay(ctx, mapGeo));
  const authoredMap = Rules.getMap(game.mapId);
  const mapClimate = game.climateMap || authoredMap;
  const climate = typeof BattlefieldClimate !== "undefined"
    ? BattlefieldClimate.resolve(mapClimate, game.climateSettings || Net.snapshot?.settings || {},
      game.round, game.climateSeed || game.seed || 1) : null;
  const baseLighting = authoredMap.lighting || {};
  const targetLighting = typeof MapShadowLighting !== "undefined" && climate
    ? MapShadowLighting.fromClimate(baseLighting, climate) : baseLighting;
  const lastLight = globalThis.ProjectGreedMapLighting;
  const transition = globalThis.ProjectGreedLightTransition;
  const lightKey = climate?.time + ":" + climate?.weather + ":" + game.mapId;
  if (!transition || transition.key !== lightKey) {
    globalThis.ProjectGreedLightTransition = { key:lightKey, at:now, from:lastLight || targetLighting };
  }
  const fade = Math.min(1,Math.max(0,(now-globalThis.ProjectGreedLightTransition.at)/1800));
  const from = globalThis.ProjectGreedLightTransition.from;
  const blendLight = key => {
    const start = from[key] ?? targetLighting[key], end = targetLighting[key];
    return start === end ? end : start * (1 - fade) + end * fade;
  };
  globalThis.ProjectGreedMapLighting = {
    ...targetLighting,
    distance: blendLight("distance"),
    horizontalAngle: blendLight("horizontalAngle"),
    intensity: blendLight("intensity"),
  };
  let aboveLayerDrawn = false;
  const drawAboveLayer = () =>
    drawVisibleEffects(() => TileMapRenderer.draw(ctx, authoredMap, "above", mapGeo, w, h));
  for (const u of IrradiationFX.units(MapCombat.units(), now).sort(
    (a, b) => Number(!!a.embarked?.exposed) - Number(!!b.embarked?.exposed),
  )) {
    if ((u.hp <= 0 && !u.mapDying) || u.mapPose?.hidden || u.deploymentStaged || Deployment.isDragging(u.id)) continue;
    const motion = PlanningUI.motion(u, now) || (moving?.id === u.id ? moving : null);
    const pendingSquadMove = u.pendingMove || squadPendingMoves.get(u.id);
    const visualUnit = pendingSquadMove
      ? {
          ...u,
          ...(pendingSquadMove.launch ? { embarked: undefined } : {}),
          x: pendingSquadMove.x,
          y: pendingSquadMove.y,
          angle: pendingSquadMove.angle,
        }
      : u;
    const unitCenter = Rules.center(visualUnit),
      unitSize = Rules.dimensions(u);
    let pos = mapPosition(unitCenter.x, unitCenter.y),
      angle = visualUnit.angle,
      anim = frameModelOf(u).presentation.idle,
      t = now / 1000,
      groundCell = { x: visualUnit.x, y: visualUnit.y };
    if (!!motion) {
      let part = Math.min(motion.path.length - 0.0001, (now - motion.start) / motion.step),
        index = Math.floor(Math.max(0, part)),
        frac = Math.max(0, part - index),
        from = index ? motion.path[index - 1] : motion.from,
        to = motion.path[index] || from;
      groundCell = {
        x: Math.round(from.x + (to.x - from.x) * frac),
        y: Math.round(from.y + (to.y - from.y) * frac),
      };
      pos = mapPosition(
        from.x + (to.x - from.x) * frac + (unitSize.width - 1) / 2,
        from.y + (to.y - from.y) * frac + (unitSize.height - 1) / 2,
      );
      if (!frameModelOf(u).ship)
        angle = (Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI;
      anim = SpriteRenderer.movement(u.model);
      t = (now - motion.start) / 1000;
    }
    const combatPose = u.mapPose;
    const formationMembers = frameMembersOf(u);
    const formationLeader = formationMembers[0] || u;
    const formationOffset = MapCombat.formationOffset(u, PlanningUI.facing(formationLeader,formationLeader.angle,frameModelOf(formationLeader)), formationMembers);
    pos.x += formationOffset.x * tile;
    pos.y += formationOffset.y * tile;
    if (combatPose) {
      pos = mapPosition(
        combatPose.x / Rules.mapCellPixels - 0.5,
        combatPose.y / Rules.mapCellPixels - 0.5,
      );
      angle = combatPose.angle;
      anim = combatPose.clip;
      t = combatPose.time;
    }
    if (!combatPose) angle = PlanningUI.facing(u, angle, frameModelOf(u));
    if (Number.isFinite(frameModelOf(u).presentation.fixedFacing))
      angle = frameModelOf(u).presentation.fixedFacing;
    const skillPose = !combatPose && SkillEffects.pose(u, now);
    if (skillPose) {
      angle = skillPose.angle;
      anim = skillPose.clip;
      t = skillPose.time;
    }
    if (u.embarked?.exposed && !u.pendingMove?.launch) {
      const parent = mapPosesById.get(u.embarked.carrierId);
      const carrier = frameUnit(u.embarked.carrierId);
      const slot = carrier && Rules.hangars.of(carrier).find((h) => h.id === u.embarked.hangarId);
      if (parent && slot) {
        const rad = (parent.angle * Math.PI) / 180;
        const scale =
          (tile / Rules.mapCellPixels) *
          ART.presentation.unitMapScale *
          (battleSettings.mapScale / (ART.presentation.mapCellScale || 1)) *
          frameModelOf(carrier).presentation.mapScale;
        const { x, y, height } = slot.offset;
        pos = {
          x: parent.pos.x + (x * Math.cos(rad) + y * Math.sin(rad)) * scale,
          y: parent.pos.y + (x * Math.sin(rad) - y * Math.cos(rad) - height) * scale,
        };
        groundCell = parent.groundCell;
        if (!combatPose && !skillPose) angle = PlanningUI.facing(u, parent.angle, frameModelOf(u));
      }
    }
    pos.y -= (window.BattlefieldUI?.dropHeight(u, now) || 0) * tile;
    EnvironmentVisuals.observe(u, groundCell, now);
    const visualScale = (tile/Rules.mapCellPixels) * ART.presentation.unitMapScale *
      (battleSettings.mapScale/(ART.presentation.mapCellScale || 1)) * frameModelOf(u).presentation.mapScale * formationOffset.scale;
    const radius = SpriteRenderer.radius(u.model)*visualScale + tile;
    const parentCarrier = u.embarked?.exposed && frameUnit(u.embarked.carrierId);
    const pose = {
      u,
      pos,
      angle,
      anim,
      t,
      motion,
      unitSize,
      combatPose,
      skillPose,
      groundCell,
      formationOffset,
      visualScale,
      airborne: !!u.flying || frameModelOf(u).movementType === "air" ||
        !!(parentCarrier && (parentCarrier.flying || frameModelOf(parentCarrier).movementType === "air")),
    };
    // Retain carrier transforms even when its hull is outside the viewport.
    mapPosesById.set(u.id, pose);
    if (pos.x+radius < 0 || pos.y+radius < 0 || pos.x-radius > w || pos.y-radius > h) continue;
    mapUnitPoses.push(pose);
  }
  const pilotLabels = MapCamera.pilotLabelsAt(w, h);
  // Ground overlays are drawn before every unit, including moving and dodging units.
  if (!immersive)
    for (const { u, pos } of mapUnitPoses)
      UnitIdentity.drawCommandAura(ctx, u, pos, tile, getUnit(selected));
  const unitThumbnails = !immersive && MapCamera.unitThumbnails;
  byId("map").dataset.unitThumbnails = String(unitThumbnails);
  if (!immersive && !unitThumbnails)
    for (const { u, pos } of mapUnitPoses)
      UnitIdentity.drawRing(ctx, u, pos, (tile * 64) / Rules.mapCellPixels);
  mapUnitPoses.sort((a, b) => Number(a.airborne) - Number(b.airborne));
  let smokeDrawn = false;
  for (const {
    u,
    pos,
    angle,
    anim,
    t,
    motion,
    unitSize,
    combatPose,
    skillPose,
    groundCell,
    formationOffset,
    visualScale,
    airborne,
  } of mapUnitPoses) {
    if (authoredMap.tileMap && !aboveLayerDrawn && airborne) {
      drawAboveLayer();
      aboveLayerDrawn = true;
    }
    if (!smokeDrawn && airborne) {
      EnvironmentVisuals.smoke(ctx, game, mapPosition, tile);
      smokeDrawn = true;
    }
    ctx.save();
    const environmentPose = EnvironmentVisuals.pose(u, groundCell);
    const spriteTile = (tile * 64) / Rules.mapCellPixels;
    // Animated silhouettes are rendered by SpriteRenderer when enabled.
    ctx.globalAlpha = environmentPose.alpha;
    if (
      !immersive &&
      (u.id === selected ||
        (!squadSingleMove &&
          selected &&
          selectedSquad.has(u.id)) ||
        (phase === "reaction" && pending?.target === u.id))
    ) {
      selectionMarks.push({
        unitId: u.id,
        kind: "selected",
        group:
          !squadSingleMove ||
          phase === "reaction" ||
          mode.startsWith("attack") ||
          mode === "target",
      });
    }
    let turretStatus = null;
    if (
      !immersive &&
      frameModelOf(u).ship &&
      !combatPose &&
      ["idle", "reaction"].includes(phase)
    ) {
      const draft = selected === u.id ? AttackControls.draft(u) : null;
      const reacting = pending?.target === u.id && response === "counter";
      const target = getUnit(
        combatPose?.targetId ?? (reacting ? counterTargetId : (draft?.targetId ?? u.plan?.target)),
      );
      const id =
        combatPose?.attackWeapon ||
        (reacting
          ? counterId
          : selected === u.id
            ? weaponId || draft?.weapons?.at(-1) || u.plan?.weapon
            : null);
      const weapon = frameModelOf(u).weapons.find((w) => w.id === id);
      if (target && weapon) {
        const available = new Set(Rules.availableStrikes(u, weapon, target).map((s) => s.moduleId));
        const inRange = Rules.inRange(u, target, weapon);
        turretStatus = Object.fromEntries(
          (weapon.moduleIds || (weapon.moduleId ? [weapon.moduleId] : [])).map((id) => [
            id,
            inRange && available.has(id),
          ]),
        );
      }
    }
    if (unitThumbnails) {
      UnitIdentity.drawMapSymbol(ctx, u, pos, tile);
    } else {
      SpriteRenderer.draw(
        ctx,
        u.model,
        pos.x,
        pos.y + (combatPose ? 0 : tile * (0.035 + environmentPose.offset)),
        visualScale,
        angle,
        anim,
        t,
        combatPose?.heldWeapon ?? u.heldWeapon,
        !combatPose,
        (u.shield ?? 1) > 0,
        !!motion || !!combatPose?.moving,
        u.brokenParts,
        combatPose?.aimAngle ?? skillPose?.angle ?? u.aimAngle ?? angle,
        combatPose?.attacking ?? null,
        Rules.cellEnvironment(game, groundCell.x, groundCell.y) !== "space" &&
          game.tiles[groundCell.y]?.[groundCell.x] !== "water",
        Rules.cellEnvironment(game, groundCell.x, groundCell.y),
        combatPose?.attackWeapon ?? null,
        combatPose?.weaponDisplayIndex ?? skillPose?.weaponDisplayIndex ?? u.weaponDisplayIndex ?? null,
        combatPose?.flying ?? !!u.flying,
        turretStatus,
        false,
        !!(u.overBoost || u.fullBoost || u.overdrive || u.boostSkillActive),
        combatPose?.hiddenLayers || [],
        !pilotLabels && !combatPose && !motion && !skillPose ? 2048 : 0,
      );
      const fieldImpact = Math.min(
        MapCombat.fieldImpact(u.id),
        IrradiationFX.fieldImpact(u.id, now),
      );
      if (frameModelOf(u).iField && fieldImpact < ART.effects.I_Field_2.duration)
        SpriteEffects.draw(
          ctx,
          "I_Field_2",
          pos.x,
          pos.y,
          (tile / Rules.mapCellPixels) *
            ART.presentation.unitMapScale *
            frameModelOf(u).presentation.mapScale *
            formationOffset.scale,
          fieldImpact,
        );
      if (u.burning && u.hp > 0) {
        const effect = ART.effects.Burned_Hit_1;
        if (effect)
          SpriteEffects.draw(
            ctx,
            "Burned_Hit_1",
            pos.x,
            pos.y,
            tile / Rules.mapCellPixels,
            (now / 1000) % effect.duration,
          );
      }
      SpriteEffects.lowHp(
        ctx,
        u,
        pos.x,
        pos.y + (combatPose ? 0 : tile * (0.035 + environmentPose.offset)),
        visualScale,
        now / 1000,
      );
    }
    ctx.restore();
    if (immersive) continue;
    let hpw =
        spriteTile *
        0.72 *
        battleSettings.mapBarScale *
        (frameModelOf(u).ship ? unitSize.width : 1),
      barx = pos.x - hpw / 2,
      bary = pos.y + spriteTile * (frameModelOf(u).ship ? unitSize.height / 2 - 0.12 : 0.36);
    if (unitThumbnails) {
      const iconSize = Math.max(10, Math.min(28, tile * .9));
      const badgeSize = Math.max(7, Math.min(12, iconSize * .45));
      bary = pos.y + iconSize / 2 + badgeSize * .2 + 3;
    }
    ctx.fillStyle = "#07141c";
    ctx.fillRect(barx, bary, hpw, 4);
    ctx.fillStyle = u.team ? "#ed9685" : "#83d6ee";
    ctx.fillRect(barx, bary, hpw * Math.max(0, Math.min(1, u.hp / frameModelOf(u).hp)), 4);
    ctx.fillStyle = "#07141c";
    ctx.fillRect(barx, bary + 6, hpw, 3);
    ctx.fillStyle = "#efd568";
    const enRatio = Math.max(0, Math.min(1, u.en / Math.max(1, frameModelOf(u).en)));
    ctx.fillRect(barx, bary + 6, hpw * enRatio, 3);
    if (
      u.acted &&
      u.team === game.team &&
      phase !== "battle" &&
      !battleView?.mapBattle &&
      Net.snapshot?.phase !== "playback"
    ) {
      ctx.save();
      ctx.font = "bold 11px system-ui";
      ctx.textAlign = "right";
      ctx.textBaseline = "alphabetic";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#07141c";
      ctx.fillStyle = "#efd568";
      ctx.strokeText("E", barx + hpw - 1, bary - 2);
      ctx.fillText("E", barx + hpw - 1, bary - 2);
      ctx.restore();
    }
    if (pilotLabels && u.pilot?.name && (u.pilot.custom || u.pilot.aceId)) {
      ctx.fillStyle = u.acted && u.team === game.team ? "#8fa0a5" : "#dfebed";
      const nameSize = Math.max(12, Math.min(18, spriteTile * 0.14)) * battleSettings.mapLabelSize;
      ctx.font = `${nameSize}px system-ui`;
      ctx.textAlign = "center";
      ctx.save();
      ctx.textBaseline = "middle";
      const label = I18n.pilotName(u.pilot);
      const labelY = bary + 12 + nameSize / 2;
      if (u.pilot?.custom || u.pilot?.aceId) {
        const width = ctx.measureText(label).width,
          iconSize = Math.max(18, nameSize * 1.1);
        const left = pos.x - (width + iconSize + 3) / 2;
        UnitIdentity.drawPilotPortrait(ctx, u.pilot, left, labelY - iconSize / 2, iconSize);
        ctx.fillText(label, pos.x + (iconSize + 3) / 2, labelY);
      } else ctx.fillText(label, pos.x, labelY);
      ctx.restore();
    }
    PilotRewards.draw(
      ctx,
      u,
      pos.x,
      bary + 16 + Math.max(7, spriteTile * 0.14) * battleSettings.mapLabelSize,
      now,
    );
    if (
      attackTargets.has(u.id) ||
      (mode === "target" && weapon && chosen && Rules.canAttack(game, chosen, u, weapon)) ||
      (chosen && AttackControls.draft(chosen)?.targetId === u.id)
    ) {
      selectionMarks.push({ unitId: u.id, kind: "target", group: true });
    }
  }
  if (!immersive) {
    ctx.save();
    ctx.lineWidth = 2;
    for (const box of PlanningUI.selectionFrames(mapUnitPoses, selectionMarks, tile)) {
      ctx.strokeStyle =
        box.kind === "target" ? `rgba(255,140,115,${0.7 + 0.3 * Math.sin(now / 200)})` : "#e1edaa";
      ctx.strokeRect(box.x, box.y, box.width, box.height);
    }
    ctx.restore();
  }
  Deployment.drawDrag(ctx);
  if (!aboveLayerDrawn) drawAboveLayer();
  // Hidden actors contribute effects only; never silhouettes, bars or selectable units.
  for (const actor of Net.snapshot?.effectActors || []) {
    const motion = PlanningUI.motion(actor, now);
    let location = Rules.center(actor),
      angle = actor.angle;
    if (motion?.path.length) {
      const part = Math.min(motion.path.length - 0.0001, (now - motion.start) / motion.step),
        index = Math.floor(Math.max(0, part)),
        fraction = Math.max(0, part - index);
      const from = index ? motion.path[index - 1] : motion.from,
        to = motion.path[index] || from;
      const size = Rules.dimensions(actor);
      location = {
        x: from.x + (to.x - from.x) * fraction + (size.width - 1) / 2,
        y: from.y + (to.y - from.y) * fraction + (size.height - 1) / 2,
      };
      if (!frameModelOf(actor).ship)
        angle = (Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI;
    }
    const point = mapPosition(location.x, location.y);
    const size = Rules.dimensions(actor);
    const cell = {
      x: Math.round(location.x - (size.width - 1) / 2),
      y: Math.round(location.y - (size.height - 1) / 2),
    };
    EnvironmentVisuals.observe(actor, cell, now);
    const presentation = EnvironmentVisuals.pose(actor, cell);
    const scale =
      (tile / Rules.mapCellPixels) *
      ART.presentation.unitMapScale *
      (battleSettings.mapScale / (ART.presentation.mapCellScale || 1)) *
      frameModelOf(actor).presentation.mapScale;
    SpriteRenderer.draw(
      ctx,
      actor.model,
      point.x,
      point.y + tile * presentation.offset,
      scale,
      angle,
      motion ? SpriteRenderer.movement(actor.model) : frameModelOf(actor).presentation.idle,
      motion ? (now - motion.start) / 1000 : now / 1000,
      actor.heldWeapon,
      true,
      false,
      !!motion,
      actor.brokenParts,
      actor.aimAngle,
      false,
      presentation.environment === "ground",
      Rules.cellEnvironment(game, cell.x, cell.y),
      null,
      actor.weaponDisplayIndex ?? null,
      actor.flying,
      null,
      true,
      !!actor.boostSkillActive,
    );
    if (actor.lowHp)
      SpriteEffects.lowHp(
        ctx,
        actor,
        point.x,
        point.y + tile * presentation.offset,
        scale,
        now / 1000,
      );
  }
  drawVisibleEffects(() => MapCombat.draw(ctx, mapGeo));
  EnvironmentVisuals.drawWater(ctx, now, mapPosition, tile);
  if (!immersive) PlanningUI.arrows(ctx);
  // Radar contacts reveal only location, never a selectable enemy or its model/HP.
  if (!immersive && intel) {
    ctx.save();
    ctx.strokeStyle = "#ff4545";
    ctx.lineWidth = 2;
    for (const contact of intel.radarContacts || []) {
      const p = mapPosition(contact.x, contact.y),
        size = Math.max(10, tile * 0.65);
      ctx.strokeRect(p.x - size / 2, p.y - size / 2, size, size);
    }
    ctx.restore();
  }
  if (!smokeDrawn) EnvironmentVisuals.smoke(ctx, game, mapPosition, tile);
  if (!immersive) PlanningUI.sniperLocks(ctx, now);
  drawVisibleEffects(() => SkillEffects.draw(ctx, now, mapPosition, tile));
  IrradiationFX.draw(ctx, now, mapPosition, tile, (id) => {
    const pose = mapUnitPoses.find((item) => item.u.id === id);
    if (!pose) return null;
    const { u, pos, angle, anim, t, groundCell } = pose;
    const environment = EnvironmentVisuals.pose(u, groundCell);
    const scale =
      (tile / Rules.mapCellPixels) *
      ART.presentation.unitMapScale *
      (battleSettings.mapScale / (ART.presentation.mapCellScale || 1)) *
      frameModelOf(u).presentation.mapScale;
    return {
      x: pos.x,
      y:
        pos.y +
        tile * (0.035 + environment.offset) +
        SpriteRenderer.flightOffset(
          u.model,
          now,
          !!u.flying,
          Rules.cellEnvironment(game, groundCell.x, groundCell.y),
        ) *
          scale,
      scale,
      angle,
      clip: anim,
      time: t,
    };
  }); // Native beam/charge sprites remain visible through fog.
  drawVisibleEffects(() => MapEffects.draw(ctx, now, mapPosition, tile));
  if (!immersive && hover) {
    let p = mapPosition(hover.x, hover.y);
    ctx.strokeStyle = "#f2f1c9aa";
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x - tile * 0.5 + 1, p.y - tile * 0.5 + 1, tile - 2, tile - 2);
  }
  SpriteEffects.setFogClip(null);
  if (typeof BattlefieldWeather !== "undefined") {
    const state = BattlefieldWeather.draw(ctx, w, h, now, { ...Rules.getMap(game.mapId), ...game.climateMap, tiles: Rules.getMap(game.mapId).tiles },
      game.climateSettings || Net.snapshot?.settings || {}, game.round, game.climateSeed || game.seed || 1, mapGeo);
    const label = byId("mapClimateStatus");
    if (label) {
      const next = state.space ? "宇宙 · 无天气/时间" :
        BattlefieldWeather.names[state.weather] + " · " + BattlefieldWeather.times[state.time];
      if (label.textContent !== next) label.textContent = next;
    }
  }
  drawDialogueBubbles(ctx, mapPosesById, intel, w, h, now, pilotLabels);
}
function drawDialogueBubbles(ctx, poses, intel, width, height, now, labelsVisible = MapCamera.pilotLabels) {
  if (!dialogueBubbles.size || ClientSettings.hidePilotDialogue() || !labelsVisible) return;
  const occupied = [];
  ctx.save();
  ctx.font = "12px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const [id, bubble] of dialogueBubbles) {
    if (bubble.defeatUnitId && Net.snapshot?.phase === "playback") {
      if (!battleView || battleView.networkId !== Net.snapshot.playback?.id || MapCombat.health(bubble.defeatUnitId) > 0) continue;
    }
    if (bubble.voiceRecord) {
      if (typeof DialogueAudio !== "undefined") DialogueAudio.play(bubble.voiceRecord);
      bubble.voiceRecord = null;
    }
    if (!bubble.until) bubble.until = now + 4500;
    if (bubble.until <= now) {
      dialogueBubbles.delete(id);
      continue;
    }
    const pose = poses.get(id),
      actor = pose?.u || getUnit(id);
    // Server-provided anchors have already passed the recipient's visibility filter.
    if (
      Net.active &&
      !bubble.position &&
      actor?.team !== Net.team() &&
      !intel?.visibleIds?.includes(id)
    )
      continue;
    const anchor =
      pose?.pos ||
      (bubble.position && mapPosition(bubble.position.x, bubble.position.y));
    if (
      !anchor ||
      anchor.x < -16 ||
      anchor.x > width + 16 ||
      anchor.y < -16 ||
      anchor.y > height + 16
    )
      continue;
    const text = I18n.text(bubble.text).slice(0, 48);
    const name = I18n.text(bubble.pilotName || actor?.pilot?.name || "驾驶员") + ":";
    const boxHeight = 50;
    const boxWidth = Math.min(
      width - 12,
      330,
      Math.max(ctx.measureText(text).width, ctx.measureText(name).width) + 22,
    );
    const x = Math.max(
      boxWidth / 2 + 6,
      Math.min(width - boxWidth / 2 - 6, anchor.x),
    );
    let y = Math.max(boxHeight / 2 + 6, Math.min(height - boxHeight / 2 - 6, anchor.y - 48));
    for (const offset of [-48, -104, -160, -216, 48, 104, 160]) {
      const candidate = anchor.y + offset;
      if (candidate < boxHeight / 2 + 6 || candidate > height - boxHeight / 2 - 6) continue;
      if (
        !occupied.some(
          (box) =>
            Math.abs(box.x - x) < (box.width + boxWidth) / 2 + 4 &&
            Math.abs(box.y - candidate) < boxHeight + 6,
        )
      ) {
        y = candidate;
        break;
      }
    }
    occupied.push({ x, y, width: boxWidth });
    ctx.fillStyle = "rgba(10,25,36,.94)";
    ctx.strokeStyle = "#a8c9d8";
    ctx.lineWidth = 1;
    ctx.fillRect(x - boxWidth / 2, y - boxHeight / 2, boxWidth, boxHeight);
    ctx.strokeRect(x - boxWidth / 2, y - boxHeight / 2, boxWidth, boxHeight);
    ctx.fillStyle = "#a8d9f0";
    ctx.fillText(name, x, y - 10, boxWidth - 12);
    ctx.fillStyle = "#f2f5f7";
    ctx.fillText(text, x, y + 10, boxWidth - 12);
  }
  ctx.restore();
}
function cellAt(e) {
  if (!mapGeo) return null;
  let r = byId("map").getBoundingClientRect(),
    x = Math.floor((e.clientX - r.left - mapGeo.ox) / mapGeo.tile),
    y = Math.floor((e.clientY - r.top - mapGeo.oy) / mapGeo.tile);
  return x >= 0 && x < Rules.mapWidth(game) && y >= 0 && y < Rules.mapHeight(game)
    ? {
        x,
        y,
        mapX: (e.clientX - r.left - mapGeo.ox) / mapGeo.tile - 0.5,
        mapY: (e.clientY - r.top - mapGeo.oy) / mapGeo.tile - 0.5,
      }
    : null;
}
byId("map").onpointermove = (e) => {
  hover = cellAt(e);
  if (hover) {
    let unit = Rules.at(game, hover.x, hover.y),
      t = Rules.terrainStyle(game.mapId, game.tiles[hover.y][hover.x]);
    byId("hoverInfo").textContent =
      Rules.columnLabel(hover.x) +
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
  if (["hangar-launch", "hangar-board"].includes(mode) && window.HangarUI?.click(cellAt(e))) return;
  if (phase === "deployment") {
    const cell = cellAt(e);
    if (cell) Deployment.click(cell);
    return;
  }
  if (phase === "reaction") {
    const cell = cellAt(e),
      target = cell && Rules.at(game, cell.x, cell.y);
    if (target) {
      window.SFSUI?.inspect(target);
      selectCounterTarget(target.id);
    }
    return;
  }
  if (isBusy() || isAI()) return;
  if (pendingMovement()) return;
  let cell = cellAt(e);
  if (!cell) return;
  if (mode === "move" || mode === "select") {
    if (window.BattlefieldUI?.click(cell)) return;
  }
  let target = Rules.at(game, cell.x, cell.y),
    u = getUnit(selected);
  // 查看单位资料不需要操作权限；移动与攻击仍检查所属玩家。
  if (Net.active && !Net.canAct()) {
    if (target) select(target.id);
    else window.BattleHUD?.clearSelection();
    return;
  }
  if (SkillControls.click(cell, u)) return;
  window.SFSUI?.inspect(target);
  if (
    target &&
    u &&
    target !== u &&
    mode === "move" &&
    mapRanges(u, true, null).moveCells.get(Rules.key(cell.x, cell.y))?.squadTarget
  ) {
    try {
      await performMove(u, cell.x, cell.y);
    } catch (error) {
      note(error.message);
    }
    return;
  }
  // Friendly carrier cells are movement endpoints before they are selections.
  if (
    target &&
    u &&
    target !== u &&
    target.team === u.team &&
    mode === "move" &&
    !u.embarked &&
    mapRanges(u, true, null).moveCells.get(Rules.key(cell.x, cell.y))?.boarding
  ) {
    try {
      await performMove(u, cell.x, cell.y);
    } catch (error) {
      note(error.message);
    }
    return;
  }
  if (target && u && target.team !== u.team)
    target = { ...target, aimCell: { x: cell.x, y: cell.y } };
  if (mode === "target" && u && weaponId) {
    let w = getWeapon(u, weaponId);
    if (["mortar", "nuke"].includes(w?.special?.type))
      target = Rules.groundTarget(game, u, cell.x, cell.y);
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
  if (
    target &&
    u &&
    target.team !== u.team &&
    u.team === game.team &&
    (!Net.active || Net.canControl(u)) &&
    (!u.acted || u.plan || u.squadOrder) &&
    ["select", "move", "attack-target", "attack-weapons"].includes(mode) &&
    AttackControls.canTarget(u, target)
  ) {
    AttackControls.choose(u, target);
    return;
  }
  if (mode === "attack-weapons") return;
  if (mode === "attack-target") {
    note("请选择红色范围内的有效目标。");
    return;
  }
  if (target && !(target.id === u?.id && mode === "move")) {
    select(target.id);
    return;
  }
  if (!target && mode === "select") {
    const anchor = u && Rules.anchorAt(u, cell.mapX ?? cell.x, cell.mapY ?? cell.y);
    if (
      !u ||
      u.team !== game.team ||
      (Net.active && !Net.canControl(u)) ||
      u.acted ||
      u.moved ||
      !mapRanges(u, true, null).moveCells.has(Rules.key(anchor.x, anchor.y))
    ) {
      window.BattleHUD?.clearSelection();
      return;
    }
  }
  if (
    ["select", "move"].includes(mode) &&
    u &&
    u.team === game.team &&
    (!Net.active || Net.canControl(u)) &&
    !u.acted &&
    !u.moved
  ) {
    try {
      const anchor = Rules.anchorAt(u, cell.mapX ?? cell.x, cell.mapY ?? cell.y);
      await performMove(u, anchor.x, anchor.y);
    } catch (err) {
      note(err.message);
    }
  }
};
async function performMove(u, x, y) {
  if (Net.active) {
    Net.request("move", { unitId: u.id, x, y, single: squadSingleMove });
    return;
  }
  let from = { x: u.x, y: u.y },
    path = Rules.previewMove(game, u, x, y, Rules.ownerOf(u), squadSingleMove);
  PlanningUI.move({
    unitId: u.id,
    from,
    path,
    squadIds: u.pendingMove.squadIds,
    squadPaths: u.pendingMove.squadPaths,
  });
  GameAudio.moveUnit(u);
  phase = "moving";
  moving = {
    id: u.id,
    from,
    path,
    start: performance.now(),
    step: MovementTiming.step(path, byId("quick").checked),
  };
  update();
  let stamp = session;
  await new Promise((resolve) => setTimeout(resolve, path.length * moving.step + 20));
  if (stamp !== session) return;
  moving = null;
  phase = "idle";
  mode = "move-confirm";
  update();
}
function pendingMovement() {
  if (window.ReplayPlayer?.active) return null;
  return game.units.find(
    (unit) =>
      unit.pendingMove && !unit.pendingMove.launchMemberOf &&
      (Net.active
        ? unit.pendingMove.seat === Net.seat
        : phase === "deployment"
          ? Rules.ownerOf(unit) === Deployment.team()
          : unit.team === game.team),
  );
}
function finishMovement(confirm) {
  const unit = pendingMovement();
  if (!unit || isBusy(true) || PlanningUI.motion(unit, performance.now())) return;
  if (Net.active) return Net.request(confirm ? "confirm_move" : "cancel_move", { unitId: unit.id });
  if (confirm) {
    const rotation = unit.pendingMove.rotation;
    Rules.confirmMove(game, unit);
    if (rotation) addLog(`${logUnit(unit)} ${rotation < 0 ? "左转" : "右转"}。`);
    else addLog(`${logUnit(unit)} 移动至${Rules.columnLabel(unit.x)}${unit.y + 1}。`);
  } else Rules.cancelMove(game, unit);
  PlanningUI.stop(unit.id);
  if (Rules.squadMembers(game, unit).length < 2) squadCombatMode = "melee";
  mode = "select";
  update();
}
// a = 攻击方，b = 防守方，w = 武器。联机只发请求，离线进入本地应战。
function beginAttack(a, b, w, weapons = [w]) {
  const offensiveSkill = w?.slot === "skill";
  if (!offensiveSkill && !squadSingleMove && !Rules.automaticSquadQueue(game, a, b).length)
    a =
      Rules.squadAttackMembers(game, a).find(
        (member) => Rules.automaticSquadQueue(game, member, b).length,
      ) || a;
  const plannedMembers = offensiveSkill ? [{unit:a,weapons:[w]}] : (squadSingleMove ? [a] : Rules.squadAttackMembers(game,a))
    .filter(member=>!member.embarked?.exposed || !member.acted || member.plan || member.squadOrder).map(member => ({
    unit: member,
    weapons: Rules.firePlan(game, member, b, { combatMode: squadCombatMode }).weapons,
  })).filter(plan=>plan.weapons.length);
  if (!plannedMembers.length) return note(I18n.text("没有满足射程、EN与部位条件的武器"));
  if (!plannedMembers.some(plan=>plan.unit.id===a.id)) a=plannedMembers[0].unit;
  weapons=plannedMembers.find(plan=>plan.unit.id===a.id).weapons;
  w = weapons[0];
  if (Net.active) {
    if (Net.canAct() && Net.canControl(a) && phase === "idle" && !Net.awaiting) {
      Net.request("attack", {
        unitId: a.id,
        combatMode: squadCombatMode,
        single: offensiveSkill || squadSingleMove,
        targetId: b.id,
        aimCell: b.aimCell,
        targetCell: b.groundTarget ? { x: b.x, y: b.y } : undefined,
        weaponId: w.id,
        weaponIds: weapons.map((w) => w.id),
      });
      if (["mortar", "nuke"].includes(w.special?.type)) {
        AttackControls.reset();
        selected = weaponId = null;
        mode = "select";
        update();
      }
    }
    return;
  }
  if (phase !== "idle" || !weapons.length || a.acted) return;
  GameAudio.play("lockonSound");
  for (const member of squadSingleMove ? [a] : Rules.squadAttackMembers(game, a))
    Rules.faceTarget(member, b);
  Rules.faceTarget(b, a);
  pending = {
    single: offensiveSkill || squadSingleMove,
    offensiveSkill,
    combatMode: squadCombatMode,
    aimCell: b.aimCell,
    attacker: a.id,
    target: b.id,
    weapon: w.id,
    weapons: weapons.map((w) => w.id),
    attacks: plannedMembers.map(plan=>({attacker:plan.unit.id,target:b.id,
      weapon:plan.weapons[0].id,weapons:plan.weapons.map(w=>w.id),
      noCounter:plan.weapons.every(w=>w.noCounter)})),
  };
  phase = "reaction";
  let legal = Rules.squadMembers(game, b).flatMap((member) =>
    Rules.firePlan(game,member,a,{counter:true,combatMode:"melee"}).weapons,
  );
  response = legal.length ? "counter" : "defend";
  counterId = legal[0]?.id || null;
  if (game.ai && b.team === 1) {
    let choice = Rules.bestResponse(game, a, b, w);
    response = choice.response;
    counterId = choice.weapon || null;
    counterDraftState = {
      key: pending,
      session,
      ids: counterId ? [counterId] : [],
    };
    addLog(
      `AI ${logUnit(b)}选择${response === "counter" ? "反击" : response === "defend" ? "防御" : "回避"}。`,
    );
    commitAttack();
    return;
  }
  MapCamera.focus(Rules.center(b).x, Rules.center(b).y, { preserveZoom: true });
  renderReaction();
  byId("reaction").hidden = false;
  update();
}
// 反击序列按应战请求保留；点击武器追加，清空按钮重置整个待提交序列。
let counterDraftState = null;
function counterDraft(unit) {
  const key = pending?.id || pending;
  if (!counterDraftState || counterDraftState.key !== key || counterDraftState.session !== session)
    counterDraftState = { key, session, ids: counterId ? [counterId] : [] };
  const draft = counterDraftState;
  draft.memberId ??= null;
  draft.groupResponse ??= response;
  draft.groupTargetId ??= pending.attacker;
  draft.memberResponses ??= {};
  const targets = Rules.counterTargetEntries(game, pending);
  const targetId = targets.some((entry) => entry.attacker === counterTargetId)
    ? counterTargetId
    : pending.attacker;
  if (draft.autoTargetId !== targetId || draft.autoUnitId !== unit.id) {
    draft.autoIds = Rules.firePlan(game,unit,getUnit(targetId),{
      counter:true,combatMode:"melee",
    }).weapons.map(w=>w.id);
    draft.autoTargetId = targetId; draft.autoUnitId = unit.id;
  }
  draft.ids = draft.autoIds;
  draft.entries = draft.ids.map((weaponId) => ({ weaponId, targetId }));
  return draft;
}
function counterMembers() {
  const root = getUnit(pending.target),
    state = counterDraft(root);
  return state.memberId ? [getUnit(state.memberId)] : Rules.squadMembers(game, root);
}
function counterChoices() {
  const root = getUnit(pending.target),
    state = counterDraft(root);
  return Rules.squadMembers(game, root).map((unit) => ({
    unitId: unit.id,
    response: state.memberResponses[unit.id]?.response ?? state.groupResponse,
    counterTargetId: state.memberResponses[unit.id]?.counterTargetId ?? state.groupTargetId,
  }));
}
function selectCounterMember(id) {
  if (Net.awaiting || (Net.active && !Net.canControl(getUnit(pending.target)))) return;
  const state = counterDraft(getUnit(pending.target));
  if (id && !Rules.squadMembers(game, getUnit(pending.target)).some((unit) => unit.id === id))
    return;
  state.memberId = id;
  response = state.memberResponses[id]?.response ?? state.groupResponse;
  counterTargetId = state.memberResponses[id]?.counterTargetId ?? state.groupTargetId;
  renderReaction();
  update();
}
function saveCounterChoice() {
  const state = counterDraft(getUnit(pending.target));
  if (state.memberId) state.memberResponses[state.memberId] = { response, counterTargetId };
  else {
    state.groupResponse = response;
    state.groupTargetId = counterTargetId;
    state.memberResponses = {};
  }
}
function counterWeapons(unit) {
  return counterDraft(unit)
    .entries.filter((entry) => entry.targetId === counterTargetId)
    .map((entry) => getWeapon(unit, entry.weaponId));
}
function counterOrders(unit) {
  const entries = counterDraft(unit).entries;
  return entries.length
    ? [{ targetId: entries[0].targetId, weaponIds: entries.map((e) => e.weaponId) }]
    : [];
}
function renderCounterSummary(panel, unit) {
  panel.replaceChildren();
  const entries = unit && counterDraft(unit).entries;
  if (!entries?.length) return false;
  panel.append(element("div", "section-title", "反击武器序列"));
  entries.forEach((entry, index) => {
    const row = element("div", "attack-plan-line"),
      target = getUnit(entry.targetId);
    row.append(
      element("span", "weapon-plan-index", String(index + 1)),
      element(
        "span",
        "attack-plan-weapon",
        getWeapon(unit, entry.weaponId)?.name || entry.weaponId,
      ),
      element("span", "attack-plan-arrow", "→"),
      element("span", "attack-plan-target", target ? unitName(target) : I18n.text("目标已不可见")),
    );
    panel.append(row);
  });
  return true;
}
// 应战弹窗展示预估值，不扣血或消耗资源。
function renderReaction() {
  byId("confirmResponse").textContent = I18n.text(
    Net.active && Net.snapshot?.reactionReview ? "保存单位应战方案" : "确认应战",
  );
  const targets = pending.counterTargets || [
    {
      attacker: pending.attacker,
      aimCell: pending.aimCell,
      weapon: pending.weapon,
      weapons: pending.weapons,
      options: pending.counterOptions,
    },
  ];
  const scope = counterMembers(),
    b = scope[0];
  const available = (entry) =>
    scope.flatMap((member) =>
      Rules.firePlan(game,member,getUnit(entry.attacker),{
        counter:true,combatMode:"melee",
      }).weapons,
    );
  const legalTargets = legalCounterTargets();
  const targetOptions = [];
  for (const entry of Rules.counterTargetEntries(game, pending)) {
    const unit = getUnit(entry.attacker);
    const members = Rules.squadMembers(game, unit);
    if (!targetOptions.some((other) => members.some((member) => member.id === other.attacker)))
      targetOptions.push(entry);
  }
  if (!targetOptions.some((entry) => entry.attacker === counterTargetId))
    counterTargetId = legalTargets[0]?.attacker || targets[0].attacker;
  const selectedTarget = targets.find((entry) => entry.attacker === counterTargetId) || targets[0];
  const incoming = response === "counter" ? selectedTarget : targets[0];
  const a = getUnit(incoming.attacker),
    w = Rules.eventWeapon(a, incoming);
  byId("counterTargetWrap").hidden = response !== "counter";
  const select = byId("counterTarget");
  select.replaceChildren(
    ...targetOptions.map((entry) => {
      const unit = getUnit(entry.attacker),
        owner = UnitIdentity.owner(unit);
      const option = new Option(
        unitName(unit) + " · " + owner.name + " · " + Rules.columnLabel(unit.x) + (unit.y + 1),
        unit.id,
      );
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
    image.src = unitIcon(unit.model, unit.pilot);
    image.alt = "";
    const identity = UnitIdentity.owner(unit);
    const owner = element("small", "response-owner", identity.name + " · " + identity.team);
    owner.setAttribute("data-i18n-ignore", "");
    const title = element("strong", "", unitName(unit));
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
        weapon = Rules.eventWeapon(unit, entry);
      const card = element(
        "button",
        "incoming-entry" +
          (response === "counter" && Rules.squadMembers(game, unit).some((member) => member.id === counterTargetId) ? " selected" : ""),
      );
      card.type = "button";
      card.dataset.unitId = unit.id;
      card.disabled =
        response !== "counter" || !legalTargets.some((target) => target.attacker === unit.id);
      card.append(fighter(unit, weapon));
      const weapons = (entry.weapons || [entry.weapon]).map((id) => getWeapon(unit, id));
      if (weapons.length > 1)
        card.append(element("div", "helper", weapons.map((w) => w.name).join(" → ")));
      const forecast = attackForecast(unit, b, weapons, response);
      card.append(
        element("div", "incoming-forecast", `${forecast.hit}% · ${formatNumber(forecast.damage)}`),
      );
      card.onclick = () => selectCounterTarget(unit.id);
      return card;
    }),
  );
  incomingList.scrollTop = previousScroll;
  byId("defenderInfo").replaceChildren(
    element(
      "strong",
      "",
      scope.length > 1 ? I18n.text("全队") + ` · ${scope.length}` : unitName(b),
    ),
  );
  for (const [id, value] of [
    ["responseCounter", "counter"],
    ["responseDefend", "defend"],
    ["responseEvade", "evade"],
  ])
    byId(id).classList.toggle("active", response === value);
  byId("responseCounter").disabled = !targetOptions.some(
    (entry) => !entry.noCounter && available(entry).length,
  );
  const choices = counterChoices();
  byId("counterAutomaticInfo").textContent = I18n.text("按类型轮数自动使用可用武器；射击结束后进行格斗。");
  byId("counterList").replaceChildren();
  for (const member of scope) {
    const choice = choices.find((entry) => entry.unitId === member.id),
      enemy = getUnit(choice.counterTargetId),
      queue =
        choice.response === "counter" ? Rules.firePlan(game, member, enemy, {
          counter: true, combatMode: "melee",
        }).weapons : [];
    AttackControls.memberCard(byId("counterList"), member, enemy, queue, { isCounter: true,
      emptyMessage: choice.response === "counter" ? "无可用武器" : "本次不进行反击",

    });
    const label =
      choice.response === "counter" ? "反击" : choice.response === "defend" ? "防御" : "回避";
    byId("counterList")
      .lastElementChild.querySelector("header")
      .append(element("small", "", I18n.text(label)));
  }
  byId("estimate").textContent = I18n.text(
    response === "counter" ? "射击结束后格斗；仅对前来格斗的敌人回击。" : "本次不进行反击",
  );
  byId("incomingEstimate").textContent = I18n.text("来袭单位") + " " + targets.length;
  byId("confirmResponse").disabled = !!Net.awaiting;
}
for (const [id, value] of [
  ["responseCounter", "counter"],
  ["responseDefend", "defend"],
  ["responseEvade", "evade"],
])
  byId(id).onclick = () => {
    response = value;
    saveCounterChoice();
    renderReaction();
  };
// 地图、左侧列表、下拉框统一走同一条合法目标选择路径。
function legalCounterTargets() {
  if (phase !== "reaction" || !pending || response !== "counter") return [];
  const defender = getUnit(pending.target);
  if (!defender) return [];
  const entries = Rules.counterTargetEntries(game, pending);
  return entries.filter((entry) => {
    const enemy = getUnit(entry.attacker);
    return (
      !entry.noCounter &&
      enemy &&
      Rules.onMap(enemy) &&
      enemy.team !== defender.team &&
      counterMembers().some((member) => Rules.firePlan(game,member,enemy,{
        counter:true,combatMode:"melee",
      }).weapons.length)
    );
  });
}
function selectCounterTarget(id) {
  if (Net.awaiting || !legalCounterTargets().some((entry) => entry.attacker === id)) return false;
  if (Net.active && !Net.canControl(getUnit(pending.target))) return false;
  const defender = getUnit(pending.target),
    draft = counterDraft(defender);
  const members = Rules.squadMembers(game, getUnit(id));
  counterTargetId = Rules.counterTargetEntries(game, pending)
    .find((entry) => members.some((member) => member.id === entry.attacker)).attacker;
  saveCounterChoice();
  draft.ids = counterWeapons(defender).map((weapon) => weapon.id);
  counterId = draft.ids.at(-1) || null;
  draft.pickingTarget = false;
  GameAudio.play("lockonSound");
  renderReaction();
  update();
  return true;
}
byId("counterTarget").onchange = () => selectCounterTarget(byId("counterTarget").value);
byId("confirmResponse").onclick = () => commitAttack();
// 确认应战：离线调用规则结算；联机等待服务端返回事件。
function commitAttack() {
  if (!pending || (!Net.active && phase !== "reaction")) return;
  const squadResponses = counterChoices(),
    state = counterDraft(getUnit(pending.target));
  if (Net.active) {
    Net.request("respond", {
      response: state.groupResponse,
      counterId,
      counterTargetId: state.groupTargetId,
      squadResponses,
    });
    return;
  }
  if (phase !== "reaction" || !pending) return;
  const a = getUnit(pending.attacker),
    b = getUnit(pending.target),
    room = { game, matchId: "local-preview" };
  let sequence = 0;
  const planner = createAttackPlanner(Rules, () => "local-" + ++sequence);
  let battles;
  try {
    planner.reset(room);
    planner.plan(
      room,
      a,
      b,
      pending.offensiveSkill ? [getWeapon(a,pending.weapon)] : null,
      Rules.ownerOf(a),
      pending.combatMode || squadCombatMode,
      pending.single === true,
    );
    const requests = planner.prepare(room);
    while (room.reactions.length) {
      const request = room.reactions[0];
      planner.choose(
        room,
        request.id,
        state.groupResponse,
        [],
        state.groupTargetId,
        squadResponses,
      );
    }
    battles = planner.resolve(room);
  } catch (error) {
    note(error.message);
    return;
  }
  byId("reaction").hidden = true;
  selected = null;
  mode = "select";
  weaponId = null;
  if (!battles.length) {
    pending = null;
    phase = "idle";
    update();
    return;
  }
  phase = "battle";
  const actors = battles.flatMap((battle) => battle.actors);
  battleView = {
    a: a.id,
    b: b.id,
    actors,
    battles,
    events: battles.flatMap((b) => b.events),
    index: 0,
    start: performance.now(),
    displayHp: Object.fromEntries(actors.map((u) => [u.id, u.hp])),
    completed: false,
  };
  MapCombat.reset();
  MapCombat.seed(battles);
  MapCombat.begin(battleView);
  update();
}

function battleEventDuration() {
  const event = battleView.events[Math.min(battleView.index, battleView.events.length - 1)];
  return (
    (BattleScene.duration(
      event,
      battleUnit(battleView.a),
      battleUnit(battleView.b),
      byId("battleCanvas"),
    ) *
      1000 *
      (byId("quick").checked ? 0.35 : 1)) /
    MovementTiming.presentationSpeed
  );
}
function logEvent(event) {
  if (Net.active) return;
  let a = battleUnit(event.from),
    b = battleUnit(event.to),
    w = getWeapon(a, event.weapon);
  addLog(
    `${logUnit(a)} 使用${w.name} → ${logUnit(b)}：${event.hit ? formatNumber(event.damage) + "伤害" : "未命中"}${event.strikes ? `（命中 ${event.hitCount}/${event.strikeCount}）` : ""}${event.brokenParts?.length ? "，部位破坏：" + [...new Set(event.brokenParts)].map((part) => Rules.partNames[part] || part).join("、") : ""}${event.after <= 0 ? "，击破！" : ""}`,
  );
  recordBattleDialogue(event.after <= 0 ? "kill" : event.hit ? "attack" : "miss", a, b);
  if (event.after <= 0 && event.before > 0) {
    recordBattleDialogue("defeat", b, a);
    for (const [speaker, kind] of [[a,"allyKill"],[b,"allyLoss"]]) {
      const ally = game.units.find(unit => unit.hp > 0 && unit.team === speaker.team &&
        unit.id !== speaker.id && DialogueRange.nearby(unit, speaker, getUnit));
      if (ally) recordBattleDialogue(kind, ally, speaker);
    }
  }
  if (event.hit && event.after > 0) recordBattleDialogue("hit", b, a);
  if (event.after > 0 && a.team !== b.team) {
    const before = dialogueHistory.length;
    recordBattleDialogue("taunt", a, b);
    if (dialogueHistory.length > before) recordBattleDialogue("reply", b, a);
  }
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
        <small
          >视野距离 ${formatDistance(Rules.sensors.ranges(unit, game).sight)} · 侦察距离
          ${formatDistance(Rules.sensors.ranges(unit, game).radar)}</small
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
  if (!battleView.mapBattle) MapEffects.capture(battleView);
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
  MapEffects.captureTurn(game);
  for (const effect of game.turnEffects || [])
    if (effect.type === "overdrive")
      addLog(
        `${logUnit(getUnit(effect.unitId))} ${effect.skillId}消耗耐久与EN${effect.expired ? "，强化解除" : ""}。`,
      );
  selected = null;
  weaponId = null;
  mode = "select";
  addLog(`第${game.round}回合 · 队伍${game.team + 1}行动开始。`);
  if (game.winner !== null) {
    showVictory();
    return;
  }
  TurnFlow.play(fromTeam, game.round, game.team);
}
byId("endTurn").onclick = () => {
  if (pendingMovement() || isBusy() || isAI() || (Net.active && !Net.canAct())) return;
  let remaining = game.units.filter(
    (u) =>
      u.team === game.team &&
      (!Net.active || Net.owns(u)) &&
      u.hp > 0 &&
      !u.acted &&
      (!u.embarked || Rules.hangars.launchCells(game, u).length),
  ).length;
  if (remaining && Rules.hasActions(game, Net.active ? Net.seat : null)) {
    BattlePrompts.confirmEnd(remaining);
    return;
  }
  endTurn();
};
function showVictory() {
  if (Net.active && (!Net.snapshot?.started || Net.snapshot.phase !== "finished")) return;
  if (game.winner === null) return;
  if (MapEffects.pending()) {
    phase = "victory";
    MapEffects.after(showVictory);
    return;
  }
  phase = "victory";
  byId("victoryTitle").textContent =
    game.winner === -1 ? I18n.text(game.battlefield ? "战力相同，平局" : "双方全灭，平局") : teamName(game.winner) + "胜利";
  byId("victoryNote").textContent =
    `第${game.round}回合，全歼敌方小队。存活单位 ${game.units.filter((u) => u.team === game.winner && u.hp > 0).length} 台。`;
  byId("victory").hidden = false;
  MatchResults.show();
  update();
}
// 主动回主菜单会退出当前房间；网络意外中断则由网络层自动恢复。
function openMenu() {
  if (byId("leaveConfirm").open) byId("leaveConfirm").close();
  session++;
  Net.leave();
  moving = pending = battleView = null;
  selected = weaponId = null;
  mode = "select";
  hover = mapGeo = null;
  log = [];
  game = menuGame();
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
  const dialog = byId("leaveConfirm");
  dialog.hidden = false;
  if (!dialog.open) dialog.showModal();
}
byId("netSettings").onclick = requestMenu;

byId("cancelLeave").onclick = () => {
  byId("leaveConfirm").close();
  byId("leaveConfirm").hidden = true;
};
byId("leaveConfirm").addEventListener("cancel", () => {
  byId("leaveConfirm").hidden = true;
});
byId("confirmLeave").onclick = openMenu;
byId("helpBtn").onclick = () => {
  byId("help").hidden = false;
};
byId("closeHelp").onclick = () => {
  byId("help").hidden = true;
};
// 每帧入口：独立预览接管自己的绘制，实际游戏绘制正常地图与战斗。
let lastRenderError = null;
function tick(now) {
  animationFrameId = null;
  try {
    if (window.ReplayPlayer?.active) now = window.ReplayPlayer.tick(now);
    clock = now / 1000;
    if (assetsReady) {
      if (window.GamePreview?.active) window.GamePreview.tick(now);
      else if (pageView === "game" && !window.BattleAssets?.loading) {
        MapCombat.update(now);
        drawMap(now);
        drawBattle(now);
      }
    }
  } catch (error) {
    // Keep refresh and network/UI recovery alive without changing authoritative combat.
    const message = String(error?.stack || error);
    if (message !== lastRenderError) {
      lastRenderError = message;
      console.error("Battle rendering failed", error);
      GameDialog.alert(I18n.text("战斗画面绘制异常") + "\n" + String(error?.message || error));
    }
    const canvas = byId("map");
    canvas.width = canvas.width; // Clear any unbalanced canvas clipping state.
  } finally {
    if (pageView === "game" || window.isLayoutPreview) startRendering();
  }
}
window.addEventListener("language-change", () => {
  update();
});
SpriteRenderer.loadMenu(StartupLoading.progress)
  .then(() => {
    assetsReady = true;
    StartupLoading.finish();
    byId("openSkirmish").disabled = false;
    byId("openRooms").disabled = false;
    update();
    if (pageView === "game" || window.isLayoutPreview) startRendering();
    window.dispatchEvent(new Event("game-assets-ready"));
  })
  .catch((err) => {
    StartupLoading.fail(err);
  });
