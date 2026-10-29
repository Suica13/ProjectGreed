/* 对局回放与文字战报入口；回放只供观看，不能接管为新对局。 */
window.ReplayPlayer = (() => {
  let active = false,
    shared = false,
    live = null,
    record = null,
    state = null,
    perspective = "global",
    index = 0;
  let playing = false,
    speed = 1,
    clock = 0,
    lastNow = 0,
    elapsed = 0,
    duration = 250,
    combatDone = true,
    cutinDone = true,
    readyToken = null,
    token = null;
  let saved = null,
    localView = null,
    localIndex = -1,
    session = 0;
  const pendingRequests = new Map();
  const create = (tag, text) => {
    const e = document.createElement(tag);
    if (text) e.textContent = text;
    return e;
  };
  const button = (text, run) => {
    const e = create("button", text);
    e.type = "button";
    e.onclick = () =>
      Promise.resolve()
        .then(run)
        .catch((error) => note(error.message));
    return e;
  };
  const dialog = create("dialog");
  dialog.id = "matchRecordsDialog";
  const title = create("h2", "对局记录"),
    hint = create("p"),
    actions = create("div");
  actions.className = "record-actions";
  const close = button("关闭", () => dialog.close());
  close.className = "record-close";
  const heading = create("div");
  heading.className = "record-heading";
  heading.append(title, close);
  function download(value, suffix) {
    const link = create("a");
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value)], { type: "application/json" }),
    );
    link.href = url;
    link.download = "ProjectGreed-" + new Date().toISOString().replace(/[:.]/g, "-") + suffix;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const saveGame = button("保存存档", async () => {
    const result = await request("save_export");
    download(result.save, ".save.greed");
  });
  const saveReplay = button("保存回放", async () => {
    const value = active && !shared ? record : (await request("record_export")).record;
    download(value, ".replay.greed");
  });
  const file = create("input");
  file.type = "file";
  file.accept = ".json,.greed,application/json";
  file.hidden = true;
  const menuReplay = byId("openReplayFile");
  menuReplay.onclick = () => file.click();
  file.onchange = async () => {
    try {
      const selected = file.files[0];
      if (!selected) return;
      if (selected.size > MatchRecords.maxBytes) throw Error("对局记录超过32MB限制。");
      const imported = MatchRecords.validate(Rules, JSON.parse(await selected.text()));
      startLocal(imported);
    } catch (error) {
      note(error.message);
    } finally {
      file.value = "";
    }
  };
  const saveFile = create("input");
  saveFile.type = "file";
  saveFile.accept = ".json,.greed,application/json";
  saveFile.hidden = true;
  const loadSave = button("加载存档", () => {});
  loadSave.id = "roomLoadSave";
  loadSave.onclick = () => saveFile.click();
  saveFile.onchange = async () => {
    try {
      const selected = saveFile.files[0];
      if (!selected) return;
      if (selected.size > MatchRecords.maxBytes) throw Error("存档超过32MB限制。");
      const value = MatchRecords.validateSave(Rules, JSON.parse(await selected.text()));
      await upload(value, "save");
      await request("save_load");
      note("存档已加载，请选择席位并准备。");
    } catch (error) {
      note(error.message);
    } finally {
      saveFile.value = "";
    }
  };
  actions.append(saveGame, saveReplay);
  dialog.append(heading, create("h3", "存档"), actions, create("h3", "战斗LOG"));
  document.body.append(dialog, file, saveFile);
  const logActions = create("div");
  logActions.className = "record-actions";
  // Keep shared controls attached so byId can still find them during startup.
  dialog.append(logActions, hint);
  const logPerspective = byId("battleLogPerspective");
  const logDownload = byId("downloadBattleLog");
  logActions.append(logPerspective, logDownload);
  logDownload.textContent = "下载战斗LOG";
  byId("roomDownloadBattleLog").hidden = true;
  byId("roomLogPerspective").style.display = "none";
  function openRecords() {
    refresh();
    if (!dialog.open) dialog.showModal();
  }
  const access = button("对局记录", openRecords);
  access.id = "openMatchRecords";
  byId("netSettings").before(access);
  const roomAccess = button("对局记录", openRecords);
  roomAccess.id = "roomOpenMatchRecords";
  byId("roomShowLog").after(roomAccess);
  byId("roomRulesActions").append(loadSave);
  const bar = create("div");
  bar.id = "replayControls";
  bar.hidden = true;
  const play = button("播放", () => control({ playing: !playing }));
  const previous = button("◀", () => seekTurn(-1)),
    next = button("▶", () => seekTurn(1));
  for (const [control, label] of [
    [previous, "上一回合"],
    [next, "下一回合"],
  ]) {
    control.title = label;
    control.setAttribute("aria-label", label);
    control.classList.add("replay-turn-arrow");
  }
  const convertSave = button("转存为对局存档", async () => {
    const at = index;
    let save;
    if (shared)
      save = (await request("replay_save_export", { replayId: state.id, index: at })).save;
    else {
      const seeds = crypto.getRandomValues(new Uint32Array(2));
      save = MatchRecords.saveFromReplay(Rules, record, at, seeds[0], seeds[1]);
    }
    download(save, ".save.greed");
    note("已转存回合初状态，可在房间中加载存档。");
  });
  convertSave.id = "replayConvertSave";
  convertSave.title = "转存当前回合开始时的状态，后续随机结果重新生成";
  const timeline = create("input");
  timeline.type = "range";
  timeline.min = 0;
  timeline.step = 1;
  timeline.setAttribute("aria-label", "回放时间轴");
  timeline.onchange = () =>
    control({ index: Number(timeline.value) }).catch((e) => note(e.message));
  const position = create("span"),
    rates = create("select"),
    views = create("select");
  for (const value of [0.5, 1, 2, 4]) rates.add(new Option(value + "×", String(value)));
  rates.setAttribute("aria-label", "回放速度");
  rates.onchange = () => control({ speed: Number(rates.value) }).catch((e) => note(e.message));
  views.setAttribute("aria-label", "回放视角");
  views.onchange = async () => {
    try {
      if (shared) await request("replay_view", { perspective: views.value });
      else {
        perspective = views.value;
        localIndex = -1;
        presentLocal();
      }
    } catch (e) {
      note(e.message);
    }
  };
  const immersive = create("label"),
    immersiveInput = create("input");
  immersiveInput.type = "checkbox";
  immersive.title = "隐藏战斗界面，跳过回合交接；按 Esc 退出";
  immersive.append(immersiveInput, document.createTextNode("沉浸模式"));
  immersiveInput.onchange = () => {
    ReplayPresentation.setImmersive(immersiveInput.checked);
    if (immersiveInput.checked) cutinDone = true;
  };
  const exit = button("退出回放", async () => {
    if (shared) await request("replay_close");
    else stop();
  });
  timeline.className = "replay-timeline";
  position.className = "replay-position";
  bar.append(play, previous, next, timeline, position, rates, views, immersive, convertSave, exit);
  byId("mapWrap").append(bar);
  // Wrapped mobile controls change height; keep terrain details above the whole bar.
  new ResizeObserver(() => {
    byId("mapWrap").style.setProperty("--replay-controls-height", bar.offsetHeight + "px");
  }).observe(bar);
  function request(action, fields = {}) {
    if (!Net.active || Net.socket?.readyState !== 1)
      return Promise.reject(Error("请先创建离线房间或连接房间。"));
    const id = crypto.randomUUID?.() || Date.now() + "-" + Math.random();
    const source = live || Net.snapshot;
    const payload = JSON.stringify({
      type: "action",
      action,
      id,
      revision: Net.revision,
      matchId: source?.matchId,
      ...fields,
    });
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, timer: null };
      pendingRequests.set(id, entry);
      entry.timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(Error("对局记录请求超时，请重试。"));
      }, 30000);
      Net.socket.send(payload);
    });
  }
  function response(message) {
    const entry = pendingRequests.get(message.ack || message.id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    pendingRequests.delete(message.ack || message.id);
    if (message.type === "error") entry.reject(Error(message.message));
    else entry.resolve(message);
    return true;
  }
  async function upload(value, kind = "replay") {
    if (active && shared && playing) await control({ playing: false });
    const text = JSON.stringify(value),
      { uploadId } = await request("record_upload_begin", { length: text.length, kind });
    for (let offset = 0, sequence = 0; offset < text.length; offset += 20000, sequence++) {
      await request("record_upload_chunk", {
        uploadId,
        sequence,
        text: text.slice(offset, offset + 20000),
      });
      if (sequence % 12 === 11) await new Promise((resolve) => setTimeout(resolve, 300));
    }
    await request("record_upload_finish", { uploadId });
  }
  function begin(isShared) {
    if (!active)
      saved = { game, phase, page: pageView, snapshot: Net.snapshot, quick: byId("quick").checked };
    active = true;
    shared = isShared;
    session++;
    ReplayPresentation.setActive(true);
    document.body.classList.add("replay-active");
    bar.hidden = false;
    byId("quick").checked = false;
    MatchResults.reset();
    MapCamera.reset();
    setPageView("game");
  }
  function stop(restore = true) {
    BattleAssets.cancel();
    session++;
    active = false;
    shared = false;
    playing = false;
    token = null;
    localIndex = -1;
    record = null;
    state = null;
    ReplayPresentation.setActive(false);
    TurnFlow.setReplayPaused?.(false);
    document.body.classList.remove("replay-active");
    bar.hidden = true;
    resetVisuals();
    if (saved) {
      byId("quick").checked = saved.quick;
      if (restore) {
        game = saved.game;
        phase = saved.phase;
        Net.snapshot = live || saved.snapshot;
        if (Net.snapshot) Chat.setSnapshot(Net.snapshot);
        setPageView(saved.page);
        if (Net.active && live) Net.applySnapshot(live);
        else update();
      }
    }
    saved = null;
  }
  function resetVisuals() {
    CombatPlayback.reset();
    PlanningUI.reset();
    MapEffects.reset();
    SkillEffects.reset();
    TurnFlow.reset();
    WeaponAudio.stop();
    battleView = moving = selected = weaponId = pending = null;
    mode = "select";
  }
  function receive(snapshot) {
    live = snapshot;
    if (active && !shared) return true;
    if (!snapshot.replay) {
      if (active && shared) stop(false);
      refresh();
      return false;
    }
    const replay = snapshot.replay;
    if (!active || !shared) begin(true);
    const changed = token !== replay.token || perspective !== replay.perspective;
    state = replay;
    index = replay.index;
    perspective = replay.perspective;
    playing = replay.playing;
    speed = replay.speed;
    if (changed) {
      token = replay.token;
      present(replay.frame);
    } else Net.snapshot = { ...snapshot, ...replay.frame, replay };
    TurnFlow.setReplayPaused?.(!playing);
    refresh();
    return true;
  }
  function startLocal(value) {
    begin(false);
    record = value;
    index = 0;
    perspective = value.perspectives[0];
    playing = false;
    speed = 1;
    localIndex = -1;
    presentLocal();
  }
  function presentLocal() {
    localView =
      localIndex + 1 === index
        ? MatchRecords.unpack(localView, record.frames[index].views[perspective], record.tiles)
        : MatchRecords.view(record, index, perspective);
    localIndex = index;
    token = "local-" + ++session;
    present(localView);
    refresh();
  }
  function present(view) {
    if (BattleAssets.guard(view, () => present(view))) return;
    resetVisuals();
    clock = performance.now();
    lastNow = clock;
    elapsed = 0;
    readyToken = null;
    combatDone = true;
    cutinDone = true;
    game = MatchRecords.clone(view.game);
    game.ai = false;
    phase = "idle";
    log = view.log.slice();
    const source = live || saved?.snapshot || {};
    Net.snapshot = {
      ...source,
      ...view,
      settings: shared ? source.settings : record.settings,
      started: true,
      returnCountdown: null,
      returnAt: null,
      connected: [],
      turnDone: [],
      members: view.members || source.members || [],
      logExport: { perspective, options: [], unlocked: false },
      replay: state,
    };
    Chat.setSnapshot(Net.snapshot);
    setPageView("game");
    update();
    const event = view.lastEvent;
    duration = ReplayPresentation.immersive ? 0 : 250;
    if (event && ["move", "launch"].includes(event.type) && event.path?.length) {
      PlanningUI.move(event);
      duration = event.path.length * 120 + 150;
    }
    if (view.effectEvent?.path?.length) {
      PlanningUI.move(
        view.effectEvent,
        view.effectActors?.find((u) => u.id === view.effectEvent.unitId),
      );
      duration = Math.max(duration, view.effectEvent.path.length * 120 + 150);
    }
    if (event?.effect) {
      SkillEffects.start(event);
      duration = Math.max(duration, (ART.effects[event.effect]?.duration || 1) * 1000);
    }
    if (event?.type === "turn" && playing && !ReplayPresentation.immersive) {
      const stamp = session;
      cutinDone = false;
      TurnFlow.play(event.fromTeam ?? 1 - game.team, game.round, game.team).finally(() => {
        if (session === stamp) cutinDone = true;
      });
    }
    if (view.phase === "playback") {
      if (view.playback?.skillEffect) {
        combatDone = false;
        phase = "battle";
        IrradiationFX.start({ ...view.playback.skillEffect, id: view.playback.id }, () => {
          combatDone = true;
        });
      }
      const battles = [...(view.combats || []), ...(view.effectCombats || [])];
      if (battles.length) {
        const actors = [
          ...new Map(battles.flatMap((b) => b.actors).map((u) => [u.id, u])).values(),
        ];
        battleView = {
          a: battles[0].a,
          b: battles[0].b,
          actors,
          battles,
          events: battles.flatMap((b) => b.events),
          index: 0,
          start: clock,
          displayHp: Object.fromEntries(actors.map((u) => [u.id, u.hp])),
          completed: false,
        };
        MapCombat.seed(battles);
        MapCombat.begin(battleView, () => 0);
        combatDone = false;
        phase = "battle";
      }
    }
  }
  function combatFinished() {
    battleView = null;
    MapCombat.reset();
    combatDone = true;
    phase = "idle";
    update();
  }
  function tick(now) {
    if (BattleAssets.loading) {
      lastNow = now;
      return clock;
    }
    const step = Math.min(250, Math.max(0, now - lastNow));
    lastNow = now;
    if (playing) {
      clock += step * speed;
      elapsed += step * speed;
    }
    if (playing && combatDone && cutinDone && elapsed >= duration && readyToken !== token) {
      readyToken = token;
      if (shared)
        request("replay_ready", { replayId: state.id, token }).catch(() => {
          if (active) readyToken = null;
        });
      else if (index + 1 < record.frames.length) {
        index++;
        presentLocal();
      } else {
        playing = false;
        refresh();
      }
    }
    immersiveInput.checked = ReplayPresentation.immersive;
    return clock;
  }
  async function control(fields) {
    if (shared) return request("replay_control", { replayId: state.id, ...fields });
    if (fields.speed !== undefined) speed = fields.speed;
    if (fields.playing !== undefined) playing = fields.playing;
    if (fields.index !== undefined) {
      index = fields.index;
      presentLocal();
    }
    TurnFlow.setReplayPaused?.(!playing);
    refresh();
  }
  const checkpoints = () => (shared ? state?.checkpoints : record?.checkpoints) || [];
  function seekTurn(direction) {
    const list = checkpoints().map((c) => c.frame);
    const target =
      direction < 0 ? list.filter((f) => f < index).at(-1) : list.find((f) => f > index);
    if (target !== undefined) return control({ index: target });
  }
  function refresh() {
    const room = live || Net.snapshot,
      isHost = Net.active && room?.hostId === Net.memberId;
    saveGame.disabled = !isHost || !room?.saveAvailable || active;
    saveReplay.disabled = active && !shared ? !record : !isHost || !room?.record?.frames;
    loadSave.disabled = !isHost || !!room?.started || !!room?.replay || !!Net.awaiting;
    hint.textContent = room?.record?.truncated
      ? "记录已达到容量上限，已保留此前内容。"
      : "存档保存回合初状态；回放可转存为对局存档后在房间加载。";
    if (!active) return;
    Chat.refreshStatus();
    const total = shared ? state.total : record.frames.length,
      options = shared ? state.perspectives : record.perspectives;
    timeline.max = total - 1;
    timeline.value = index;
    play.textContent = playing ? "暂停" : "播放";
    rates.value = speed;
    const canControl = !shared || isHost;
    convertSave.disabled =
      !canControl || !options.includes("global") || !checkpoints().some((c) => c.frame <= index);
    for (const e of [play, previous, next, timeline, rates, exit]) e.disabled = !canControl;
    position.textContent = `${index + 1} / ${total} · 回合${game.round} · 队伍${game.team + 1} · ${shared ? state.gameVersion : record.gameVersion || "unknown"}`;
    if ([...views.options].map((o) => o.value).join() !== options.join()) {
      views.replaceChildren();
      for (const value of options)
        views.add(
          new Option(
            value === "global" ? "上帝视角" : "队伍" + (Number(value.slice(5)) + 1),
            value,
          ),
        );
    }
    views.value = perspective;
  }
  function logOptions() {
    if (!active) return null;
    return shared ? state.perspectives : record.perspectives;
  }
  async function downloadLog(choice) {
    if (!logOptions()?.includes(choice)) throw Error("记录不包含这个视角。");
    const entries = shared
      ? (await request("replay_log", { replayId: state.id, perspective: choice })).log
      : MatchRecords.view(record, record.frames.length - 1, choice).log;
    Chat.saveLog(entries, choice);
  }
  window.addEventListener("language-change", refresh);
  return {
    openRecords,
    logOptions,
    downloadLog,
    receive,
    response,
    tick,
    combatFinished,
    stop,
    refresh,
    request,
    get active() {
      return active;
    },
    get time() {
      return clock / 1000;
    },
    get speed() {
      return speed;
    },
    get playing() {
      return playing;
    },
  };
})();
