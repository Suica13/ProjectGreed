/* 战斗窗口生命周期：淡入 → 演出 → 停留 → 淡出。使用游戏帧更新，离开后没有遗留定时器。 */
const BattleWindow = (() => {
  let owner = null;
  const element = () => document.getElementById("battle");
  function show(view, now = performance.now()) {
    element().hidden = false;
    if (owner === view) return;
    owner = view;
    view.windowState = "opening";
    view.openedAt = now;
    view.start = now + ART.presentation.battleFadeIn * 1000;
    element().style.opacity = "0";
  }
  function complete(view, now = performance.now()) {
    if (view.returned || view.windowState === "closing") return;
    view.completedAt ??= now;
    view.windowState = "holding";
    element().style.opacity = "1";
  }
  function close(view, now = performance.now()) {
    if (!view?.completed || view.returned || view.windowState === "closing") return;
    view.windowState = "closing";
    view.closedAt = now;
    view.closeOpacity = Number(element().style.opacity || 1);
  }
  function update(view, now, onClosed) {
    if (owner !== view || view.returned || view.suspendedAt !== undefined) return;
    if (view.completed) complete(view, now);
    if (view.windowState === "opening") {
      const amount = Math.min(1, (now - view.openedAt) / (ART.presentation.battleFadeIn * 1000));
      element().style.opacity = String(Math.max(0, amount));
      if (amount >= 1) view.windowState = "playing";
    }
    if (
      view.windowState === "holding" &&
      now >= view.completedAt + ART.presentation.battleHold * 1000
    )
      close(view, now);
    if (view.windowState === "closing") {
      const amount = Math.min(1, (now - view.closedAt) / (ART.presentation.battleFadeOut * 1000));
      element().style.opacity = String(view.closeOpacity * (1 - Math.max(0, amount)));
      if (amount >= 1) {
        view.returned = true;
        element().hidden = true;
        onClosed();
      }
    }
  }
  function suspend(view, now = performance.now()) {
    if (owner === view) view.suspendedAt ??= now;
  }
  function resume(view, now = performance.now()) {
    if (view.returned) {
      element().hidden = true;
      return;
    }
    if (owner !== view) {
      show(view, now);
      return;
    }
    if (view.suspendedAt !== undefined) {
      const delay = now - view.suspendedAt;
      for (const key of ["start", "openedAt", "completedAt", "closedAt"])
        if (view[key] !== undefined) view[key] += delay;
      delete view.suspendedAt;
    }
    element().hidden = false;
  }
  return { show, complete, close, update, suspend, resume };
})();
