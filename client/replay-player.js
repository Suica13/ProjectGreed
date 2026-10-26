/* One record entry point for save/load, text LOG and synchronized replay. */
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
  const save = button("保存记录", async () => {
    if (active && !shared) {
      download(record);
      return;
    }
    const result = await request("record_export", {
      perspective: active ? perspective : (live || Net.snapshot)?.logExport?.options?.[0],
    });
    download(result.record);
  });
  const playCurrent = button("回放本局", async () => {
    await request("replay_open");
    dialog.close();
  });
  const file = create("input");
  file.type = "file";
  file.accept = ".json,.greed,application/json";
  file.hidden = true;
  const load = button("载入记录", () => file.click());
  file.onchange = async () => {
    try {
      const selected = file.files[0];
      if (!selected) return;
      if (selected.size > MatchRecords.maxBytes) throw Error("对局记录超过32MB限制。");
      const imported = MatchRecords.validate(Rules, JSON.parse(await selected.text()));
      if (Net.active) {
        if (Net.memberId !== (live || Net.snapshot)?.hostId)
          throw Error("只有房主可以载入房间回放。");
        await upload(imported);
        await request("replay_open", { loaded: true });
      } else startLocal(imported);
      dialog.close();
    } catch (error) {
      note(error.message);
    } finally {
      file.value = "";
    }
  };
  actions.append(save, playCurrent, load, close);
  dialog.append(title, hint, actions, file, create("h3", "文字战报"));
  // Keep the original IDs and handlers; there is now just one visible download location.
  dialog.append(byId("battleLogPerspective"), byId("downloadBattleLog"));
  const originalLogDownload = byId("downloadBattleLog").onclick;
  byId("downloadBattleLog").onclick = () =>
    active ? Chat.saveLog(log, perspective) : originalLogDownload();
  byId("roomDownloadBattleLog").hidden = true;
  byId("roomLogPerspective").style.display = "none";
  document.body.append(dialog);
  const access = button("对局记录", () => {
    refresh();
    dialog.showModal();
  });
  access.id = "openMatchRecords";
  document.body.append(access);
  const bar = create("div");
  bar.id = "replayControls";
  bar.hidden = true;
  const play = button("播放", () => control({ playing: !playing }));
  const previous = button("上一回合", () => seekTurn(-1)),
    next = button("下一回合", () => seekTurn(1));
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
  const resume = button("从此回合继续", () => showSeats());
  const exit = button("退出回放", async () => {
    if (shared) await request("replay_close");
    else stop();
  });
  bar.append(play, previous, next, timeline, position, rates, views, immersive, resume, exit);
  document.body.append(bar);
  const seatDialog = create("dialog");
  seatDialog.id = "recordSeatsDialog";
  document.body.append(seatDialog);
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
  async function upload(value) {
    if (active && shared && playing) await control({ playing: false });
    const text = JSON.stringify(value),
      { uploadId } = await request("record_upload_begin", { length: text.length });
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
  function download(value) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value)], { type: "application/json" }),
    );
    const a = create("a");
    a.href = url;
    a.download = "ProjectGreed-record-" + new Date().toISOString().replaceAll(":", "-") + ".greed";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const checkpoints = () =>
    shared
      ? state?.checkpoints || []
      : record?.checkpoints.map((c) => ({
          frame: c.frame,
          round: c.game.round,
          team: c.game.team,
          seats: [...new Set(c.game.units.filter((u) => u.hp > 0).map(Rules.ownerOf))],
        })) || [];
  function seekTurn(direction) {
    const list = checkpoints().map((c) => c.frame);
    const target =
      direction < 0 ? list.filter((f) => f < index).at(-1) : list.find((f) => f > index);
    if (target !== undefined) return control({ index: target });
  }
  async function showSeats() {
    const checkpoint = checkpoints().find((c) => c.frame === index);
    if (!checkpoint) throw Error("只能从回合开始节点继续。");
    if (!shared) {
      const copy = record,
        frame = index;
      stop();
      LocalRoom.open();
      await new Promise((resolve, reject) => {
        let tries = 0;
        const timer = setInterval(() => {
          if (Net.active && Net.snapshot) {
            clearInterval(timer);
            resolve();
          } else if (++tries > 100) {
            clearInterval(timer);
            reject(Error("离线房间创建失败。"));
          }
        }, 50);
      });
      await upload(copy);
      await request("replay_open", { loaded: true });
      await request("replay_control", { replayId: state.id, index: frame });
    }
    const room = live;
    seatDialog.replaceChildren(create("h2", "续局席位"));
    const selects = new Map();
    for (const seat of checkpoint.seats) {
      const row = create("label", "队伍" + (Rules.seatTeam(seat) + 1) + " · 席位" + (seat + 1)),
        select = create("select");
      select.add(new Option("AI", "ai"));
      for (const member of room.members.filter((m) => !m.bot && m.connected))
        select.add(new Option(member.name, member.id));
      const current = room.members.find((m) => m.seat === seat && !m.bot);
      if (current) select.value = current.id;
      row.append(select);
      seatDialog.append(row);
      selects.set(seat, select);
    }
    seatDialog.append(
      button("开始新对局", async () => {
        const assignments = Array(Rules.getMap(game.mapId).spawns.length).fill(null);
        for (const [seat, select] of selects) assignments[seat] = select.value;
        await request("replay_fork", { replayId: state.id, index, assignments });
        seatDialog.close();
      }),
      button("取消", () => seatDialog.close()),
    );
    seatDialog.showModal();
  }
  function refresh() {
    const room = live || Net.snapshot,
      isHost = Net.active && room?.hostId === Net.memberId;
    save.disabled = !(active && !shared) && !(room?.record?.frames || room?.replay);
    playCurrent.disabled = !isHost || room?.started || !room?.record?.frames;
    load.disabled = Net.active && (!isHost || room?.started);
    hint.textContent = room?.record?.truncated
      ? "记录已达到容量上限，已保留此前内容。"
      : room?.started
        ? "对局中保存本队录像；结束或全员返回大厅后可保存完整存档并续局。"
        : "一份对局记录同时用于保存、回放和从回合开始继续。";
    if (!active) return;
    byId("downloadBattleLog").disabled = false;
    const total = shared ? state.total : record.frames.length,
      options = shared ? state.perspectives : record.perspectives;
    timeline.max = total - 1;
    timeline.value = index;
    play.textContent = playing ? "暂停" : "播放";
    rates.value = speed;
    const canControl = !shared || isHost;
    for (const e of [play, previous, next, timeline, rates, exit]) e.disabled = !canControl;
    resume.disabled = !canControl || !checkpoints().some((c) => c.frame === index);
    position.textContent = `${index + 1} / ${total} · 回合${game.round} · 队伍${game.team + 1}`;
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
  window.addEventListener("language-change", refresh);
  return {
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
