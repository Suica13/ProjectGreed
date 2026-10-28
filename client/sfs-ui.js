/* Visible transport slots use the same server-owned passenger identities as hangars. */
const SFSUI = (() => {
  const panel = element("div", "sfs-passengers");
  panel.id = "sfsPassengers";
  panel.hidden = true;
  panel.setAttribute("aria-label", I18n.text("SFS搭载单位"));
  byId("mapWrap").append(panel);
  let inspected = null,
    prompted = null,
    panelKey = "";
  const isSFS = (u) => u?.hp > 0 && Rules.hangars.of(u).some((h) => h.kind === "sfs");
  function inspect(u) {
    inspected = isSFS(u) ? u.id : null;
  }
  function choose(u) {
    if (!u || u.hp <= 0) return;
    const actor = getUnit(selected);
    if (pendingMovement() || (isBusy() && phase !== "reaction")) return;
    MapCamera.focus(Rules.center(u).x, Rules.center(u).y);
    if (phase === "reaction") {
      selectCounterTarget(u.id);
      update();
      return;
    }
    if (actor && actor.team !== u.team && (!Net.active || Net.canControl(actor))) {
      if (mode === "target" && weaponId) {
        const w = getWeapon(actor, weaponId);
        if (Rules.canAttack(game, actor, u, w)) beginAttack(actor, u, w);
      } else if (AttackControls.canTarget(actor, u)) AttackControls.choose(actor, u);
      else note("请选择高亮的有效攻击目标。");
      update();
    } else select(u.id);
  }
  function refresh() {
    const pending = pendingMovement();
    if (!pending?.pendingMove?.boarding) prompted = null;
    if (
      pending?.pendingMove?.boarding &&
      phase === "idle" &&
      !Net.awaiting &&
      !moving &&
      !PlanningUI.motion(pending, performance.now())
    ) {
      const move = pending.pendingMove;
      const key = `${session}/${pending.id}/${move.x}/${move.y}/${move.boarding.carrierId}`;
      if (prompted !== key) {
        prompted = key;
        const stamp = session;
        GameDialog.confirm("是否搭载？取消将撤回本次移动。", {
          title: "搭载确认",
          confirmText: "确认搭载",
        }).then((yes) => {
          const current = pendingMovement();
          if (
            session === stamp &&
            current?.id === pending.id &&
            current.pendingMove?.boarding?.carrierId === move.boarding.carrierId &&
            current.pendingMove.x === move.x &&
            current.pendingMove.y === move.y
          )
            finishMovement(yes);
        });
      }
    }
    const actor = getUnit(selected);
    const attacking =
      ["attack-target", "attack-weapons", "target"].includes(mode) || phase === "reaction";
    const carrier =
      attacking && isSFS(getUnit(inspected))
        ? getUnit(inspected)
        : mode === "select" && isSFS(actor)
          ? actor
          : mode === "select" && actor?.embarked?.exposed
            ? getUnit(actor.embarked.carrierId)
            : null;
    panel.hidden =
      pageView !== "game" ||
      !carrier ||
      !!pending ||
      !["idle", "reaction", "deployment"].includes(phase);
    if (panel.hidden) {
      panelKey = "";
      return;
    }
    const cargo = Rules.hangars.cargo(game, carrier).filter((u) => u.embarked.exposed);
    const key = JSON.stringify([
      carrier.id,
      selected,
      mode,
      phase,
      cargo.map((u) => [u.id, u.model, u.hp]),
      I18n.language,
    ]);
    if (key === panelKey) return;
    panelKey = key;
    panel.replaceChildren();
    if (!cargo.length) panel.append(element("span", "sfs-empty", I18n.text("空槽位")));
    for (const u of cargo) {
      const b = element("button", "sfs-passenger");
      b.type = "button";
      b.dataset.unitId = u.id;
      b.title = unitName(u);
      b.setAttribute("aria-label", unitName(u));
      b.classList.toggle("selected", u.id === selected);
      const img = element("img", "");
      img.src = unitIcon(u.model, u.pilot);
      img.alt = unitName(u);
      b.append(img);
      b.onclick = () => choose(getUnit(u.id));
      panel.append(b);
    }
  }
  return { refresh, inspect };
})();
window.SFSUI = SFSUI;
