/* 独立音乐播放器：首个用户操作后播放；曲终顺序循环，“下一首”随机且不重复当前曲。 */
const MusicPlayer = (() => {
  const audio = new Audio(),
    playlist = ART.music.tracks,
    toggle = document.getElementById("musicToggle"),
    next = document.getElementById("musicNext"),
    title = document.getElementById("musicTitle"),
    status = document.getElementById("musicStatus");
  let index = 0,
    wantsPlayback = true,
    started = false,
    request = 0;
  audio.volume = ART.music.volume;
  audio.preload = "none";
  function render() {
    title.textContent = playlist[index].name;
    toggle.textContent = audio.paused ? "播放" : "暂停";
    toggle.setAttribute("aria-label", audio.paused ? "播放背景音乐" : "暂停背景音乐");
    toggle.setAttribute("aria-pressed", String(!audio.paused));
  }
  async function play() {
    const current = ++request;
    started = true;
    if (!audio.getAttribute("src")) audio.src = playlist[index].source;
    status.textContent = "";
    try {
      await audio.play();
    } catch {
      if (current === request && wantsPlayback) status.textContent = "点击播放以开始音乐";
    }
    render();
  }
  function select(value) {
    request++;
    index = value;
    audio.src = playlist[index].source;
    if (wantsPlayback) play();
    render();
  }
  toggle.addEventListener("click", () => {
    wantsPlayback = !wantsPlayback || audio.paused;
    if (wantsPlayback) play();
    else {
      request++;
      audio.pause();
      render();
    }
  });
  // Pause intent must survive later pointer/keyboard events.
  toggle.addEventListener("pointerdown", (event) => event.stopPropagation());
  next.addEventListener("click", () =>
    select((index + 1 + Math.floor(Math.random() * (playlist.length - 1))) % playlist.length),
  );
  audio.addEventListener("ended", () => {
    if (wantsPlayback) select((index + 1) % playlist.length);
  });
  audio.addEventListener("play", render);
  audio.addEventListener("pause", render);
  audio.addEventListener("error", () => {
    status.textContent = "音乐加载失败，可切换下一首";
  });
  function unlock(event) {
    if (event.target.closest?.("#musicPlayer")) return;
    if (!started && wantsPlayback && window.parent === window) play();
  }
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
  window.addEventListener("pagehide", () => audio.pause());
  render();
  return {
    audio,
    get index() {
      return index;
    },
  };
})();
