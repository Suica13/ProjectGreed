/* 仅开发者预览 iframe 使用。
 * 这里的 game、selected 等变量属于 iframe 内的独立游戏实例。
 * 外层实际对局继续运行，预览永远不连接服务器、不发送战斗确认。
 */
(() => {
  const preview = {
    active: true,
    suspended: false,
    scene: "start",
    leftModel: Object.keys(UnitModels)[0],
    rightModel: Object.keys(UnitModels)[1] || Object.keys(UnitModels)[0],
    weapon: null,
    response: "counter",
    result: "hit",
    unitState: "targets",
    connection: "normal",
    progress: 0.35,
    playing: false,
    lastTime: null,
    boxes: [],
    ready: false,
  };

  function makeUnit(id, model, team, x) {
    const m = UnitModels[model];
    const formation = [{ unitId: m.prefabId, kitId: m.kitId }];
    const unit = Rules.create(false, 7319, [formation, formation]).units.find(
      (item) => item.team === team,
    );
    return { ...unit, id, x, y: 4 };
  }

  function configure(changes = {}) {
    WeaponAudio.stop();
    Object.assign(preview, changes);
    if (!assetsReady) return;
    const firstRender = !preview.ready;
    preview.ready = true;
    const gameScenes = [
      "map",
      "deployment",
      "reaction",
      "battle",
      "help",
      "victory",
      "leaveConfirm",
    ];
    setPageView(
      gameScenes.includes(preview.scene)
        ? "game"
        : preview.scene === "roomPreparation"
          ? "room"
          : "menu",
    );
    game = Rules.create();
    game.ai = false;
    log = [];
    const left = makeUnit("preview-left", preview.leftModel, 0, 3);
    const right = makeUnit("preview-right", preview.rightModel, 1, 6);
    const weapon =
      UnitModels[left.model].weapons.find((item) => item.id === preview.weapon) ||
      UnitModels[left.model].weapons[0];
    preview.weapon = weapon.id;
    right.x = left.x + Math.max(1, weapon.min);
    game.units = [left, right];
    selected = preview.unitState === "empty" ? null : left.id;
    mode = preview.unitState === "targets" ? "target" : "select";
    weaponId = mode === "target" ? weapon.id : null;
    phase = "idle";
    if (preview.unitState === "acted") left.acted = true;
    if (preview.unitState === "dead") right.hp = 0;
    update();
    addLog("布局预览：选中机体、选择武器、交战。此处使用独立示例数据。");
    pending = { attacker: left.id, target: right.id, weapon: weapon.id };
    response = preview.response;
    const legalCounter = UnitModels[right.model].weapons.find((item) =>
      Rules.canAttack(game, right, left, item),
    );
    counterId = legalCounter?.id || null;
    renderReaction();
    // 即使该武器的实际距离不能反击，也能查看反击列表的排版。
    if (preview.response === "counter" && !legalCounter) {
      byId("counterList").innerHTML = UnitModels[right.model].weapons
        .map((item) => `<button class="weapon" disabled>${htmlWeapon(item, right)}</button>`)
        .join("");
    }
    byId("victoryTitle").textContent = "蓝方胜利";
    byId("victoryNote").textContent = "第8回合，全歼敌方小队。存活单位 2 台。";
    byId("networkStatus").textContent = {
      normal: "选择列表中的房间加入，或创建新房间。",
      waiting: "房间 ROOM1 · 你是蓝方 · 等待另一位玩家加入",
      disconnected: "连接中断，正在自动重连…",
    }[preview.connection];
    byId("lobby").hidden = preview.scene !== "rooms";
    byId("connectedServer").textContent = "192.168.1.10:1313";
    byId("serverStatus").textContent =
      preview.connection === "disconnected"
        ? "连接失败，请检查服务器 IP 和端口。"
        : "输入服务器 IP 和端口后连接。";
    Lobby.render([
      { code: "ROOM1", players: 1, capacity: 2, phase: "waiting", joinable: true },
      { code: "ROOM2", players: 2, capacity: 2, phase: "playing", joinable: false },
    ]);
    RoomPanel.render({
      room: "ROOM1",
      started: false,
      connected: [true, true],
      you: { id: "preview-1", seat: 0 },
      members: [
        { id: "preview-1", name: "玩家1", seat: 0, ready: true, connected: true },
        { id: "preview-2", name: "玩家2", seat: 1, ready: false, connected: true },
        { id: "preview-3", name: "玩家3", seat: null, ready: false, connected: true },
      ],
    });
    for (const overlay of document.querySelectorAll(".overlay"))
      overlay.hidden = overlay.id !== (preview.scene === "rooms" ? "start" : preview.scene);
    byId("battleTitle").textContent = `${unitName(left)} vs ${unitName(right)}`;
    byId("battleSummary").textContent = "独立演出预览，可暂停并拖动进度。";
    byId("continueBattle").disabled = false;
    byId("skipBattle").disabled = false;
    byId("toast").classList.add("show");
    byId("toast").textContent = "操作提示样例";
    preview.left = left;
    preview.right = right;
    const counterWeapon = legalCounter || UnitModels[right.model].weapons[0];
    preview.events = [makeEvent(left, right, weapon)];
    if (preview.response === "counter" && preview.result !== "kill")
      preview.events.push(makeEvent(right, left, counterWeapon));
    if (preview.scene === "formation") Formation.open();
    if (preview.scene === "deployment") {
      game.deployment = [false, false];
      phase = "deployment";
      Deployment.reset();
      Deployment.render();
    }
    if (firstRender) window.dispatchEvent(new Event("ui-preview-ready"));
  }

  function makeEvent(from, to, weapon) {
    const damage =
      preview.result === "kill"
        ? UnitModels[to.model].hp
        : Rules.estimate(game, from, to, weapon, from.team === 0 ? preview.response : "counter")
            .damage;
    return {
      from: from.id,
      to: to.id,
      weapon: weapon.id,
      type: weapon.type,
      clip: weapon.clip,
      heldWeapon: weapon.changeHeldWeapon === false ? from.heldWeapon : weapon.id,
      shotCount: weapon.shotCount,
      damagePerShot: weapon.damagePerShot,
      hit: preview.result !== "miss",
      response: from.team === 0 ? preview.response : "counter",
      damage,
      before: to.hp,
      after: preview.result === "miss" ? to.hp : Math.max(0, to.hp - damage),
    };
  }

  function tick(now) {
    if (preview.suspended) {
      WeaponAudio.stop();
      preview.lastTime = null;
      return;
    }
    if (!preview.ready) configure();
    if (!["map", "deployment", "battle"].includes(preview.scene)) {
      WeaponAudio.stop();
      preview.boxes = [];
      return;
    }
    if (preview.playing && preview.lastTime !== null) {
      preview.progress =
        (preview.progress +
          (now - preview.lastTime) /
            preview.events.reduce(
              (total, event) =>
                total +
                BattleScene.duration(event, preview.left, preview.right, byId("battleCanvas")) *
                  1000,
              0,
            )) %
        1;
    }
    preview.lastTime = now;
    drawMap(now);
    if (preview.scene !== "battle") {
      WeaponAudio.stop();
      preview.boxes = [];
      return;
    }
    const durations = preview.events.map((event) =>
      BattleScene.duration(event, preview.left, preview.right, byId("battleCanvas")),
    );
    const total = durations.reduce((a, b) => a + b, 0);
    let position = preview.progress * total,
      index = 0;
    while (index < durations.length - 1 && position > durations[index]) {
      position -= durations[index];
      index++;
    }
    const ratio = preview.progress === 1 ? 1 : position / durations[index];
    const event = preview.events[index];
    if (preview.playing) {
      const bounds = byId("battleCanvas").getBoundingClientRect();
      const plan = BattleScene.timeline(
        event,
        preview.left,
        preview.right,
        bounds.width,
        bounds.height,
      ).plan;
      WeaponAudio.sync(
        preview,
        index,
        getWeapon(getUnit(event.from), event.weapon),
        ratio * durations[index],
        1,
        plan.cues,
      );
    } else WeaponAudio.stop();
    const displayHp = {
      [preview.left.id]: preview.left.hp,
      [preview.right.id]: preview.right.hp,
    };
    for (let i = 0; i < index; i++) displayHp[preview.events[i].to] = preview.events[i].after;
    if (preview.progress === 1) displayHp[event.to] = event.after;
    preview.boxes = BattleScene.draw(byId("battleCanvas"), {
      left: preview.left,
      right: preview.right,
      event,
      ratio,
      elapsed: ratio * durations[index],
      time: preview.progress * 3.8,
      completed: preview.progress === 1,
      displayHp,
    });
    byId("battleCaption").textContent =
      `${index ? "反击 · " : ""}${getWeapon(getUnit(event.from), event.weapon).name}`;
    byId("battleInfo").innerHTML = [preview.left, preview.right]
      .map((unit) => {
        const hp =
          unit.id === event.to
            ? BattleScene.displayedHp(
                event,
                preview.left,
                preview.right,
                byId("battleCanvas"),
                ratio,
                displayHp[unit.id],
              )
            : displayHp[unit.id];
        return /* HTML */ `<div>
          <strong>${teamName(unit.team)} ${unitName(unit)}</strong>
          <div class="hp-track">
            <div
              class="hp-fill ${unit.team ? "red" : ""}"
              style="width:${(hp / UnitModels[unit.model].hp) * 100}%"
            ></div>
          </div>
          <small
            >HP ${formatNumber(hp)} / ${formatNumber(UnitModels[unit.model].hp)} · EN
            ${unit.en}</small
          >
        </div>`;
      })
      .join("");
  }

  // 对外公开同一个状态对象，编辑器读取的进度与 tick 使用的进度一致。
  Object.assign(preview, {
    configure,
    tick,
    unlockAudio: WeaponAudio.unlock,
    stopAudio: WeaponAudio.stop,
  });
  window.GamePreview = preview;
})();
