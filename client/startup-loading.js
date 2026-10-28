/* Startup progress counts completed texture loads; no timer-generated percentages. */
const StartupLoading = (() => {
  const panel = document.getElementById("resourceLoading");
  const bar = document.getElementById("resourceProgress");
  const label = document.getElementById("resourceProgressText");
  let completed = 0,
    total = 0,
    frame = null,
    stopped = false;
  function paint() {
    frame = null;
    bar.max = Math.max(1, total);
    bar.value = completed;
    label.textContent =
      (total ? Math.floor((completed / total) * 100) : 0) + "% · " + completed + " / " + total;
  }
  let stageText = "正在加载单位贴图与特效…";
  function begin(text) {
    stopped = false;
    completed = total = 0;
    stageText = text;
    panel.hidden = false;
    panel.setAttribute("aria-busy", "true");
    document.getElementById("resourceLoadingError").hidden = true;
    document.getElementById("retryResourceLoading").hidden = true;
    document.getElementById("resourceLoadingStage").textContent = I18n.text(text);
    paint();
  }
  function progress(count, size) {
    if (stopped) return;
    completed = count;
    total = size;
    document.getElementById("resourceLoadingStage").textContent = I18n.text(stageText);
    if (frame === null) frame = requestAnimationFrame(paint);
  }
  function finish() {
    stopped = true;
    cancelAnimationFrame(frame);
    completed = total;
    paint();
    bar.value = bar.max;
    panel.setAttribute("aria-busy", "false");
    panel.hidden = true;
    document.documentElement.classList.remove("resources-loading");
  }
  function fail(error) {
    stopped = true;
    cancelAnimationFrame(frame);
    paint();
    panel.setAttribute("aria-busy", "false");
    const message = document.getElementById("resourceLoadingError");
    message.textContent = error.message;
    message.hidden = false;
    document.getElementById("retryResourceLoading").hidden = false;
  }
  document.getElementById("retryResourceLoading").onclick = () => location.reload();
  return { begin, progress, finish, fail };
})();
