/* 菜单与战斗均按当前身份选择音乐，曲终顺序循环，“下一首”随机切换。 */
const MusicPlayer = (() => {
  const audio = new Audio();
  const playlist = ART.music.tracks;
  const toggle = document.getElementById("musicToggle");
  const next = document.getElementById("musicNext");
  const title = document.getElementById("musicTitle");
  const status = document.getElementById("musicStatus");
  let menuFaction = "EFSF";
  try {
    const saved = localStorage.getItem("projectgreed.combatFaction");
    if (["PMC", "EFSF", "ZEON"].includes(saved)) menuFaction = saved;
  } catch {}
  let available = playlist.filter(
    (track) => track.scene === "menu" && (!track.faction || track.faction === menuFaction),
  );
  let index = playlist.indexOf(available[0]);
  let wantsPlayback = true;
  let started = false;
  let request = 0;

  function applyVolume() {
    audio.volume = Math.max(
      0,
      Math.min(
        1,
        ART.music.volume *
          (typeof ClientSettings === "undefined" ? 1 : ClientSettings.volume("music")),
      ),
    );
  }
  applyVolume();
  window.addEventListener("audio-settings-change", applyVolume);
  audio.preload = "none";
  audio.loop = available.length === 1;

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
  function select(value, shouldPlay = started) {
    request++;
    index = value;
    audio.src = playlist[index].source;
    if (wantsPlayback && shouldPlay) play();
    render();
  }
  function currentFaction() {
    const snapshot = typeof Net === "undefined" ? null : Net.snapshot;
    const member = snapshot?.members?.find((entry) => entry.id === snapshot.you?.id);
    if (member) return member.characterFaction;
    return typeof PlayerProfile === "undefined" ? null : PlayerProfile.faction();
  }
  function sync() {
    const scene = typeof pageView !== "undefined" && pageView === "game" ? "battle" : "menu";
    const faction = currentFaction();
    available = playlist.filter(
      (track) => track.scene === scene && (!track.faction || track.faction === faction),
    );
    if (!available.length) return;
    audio.loop = available.length === 1;
    if (!available.includes(playlist[index])) select(playlist.indexOf(available[0]));
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
  toggle.addEventListener("pointerdown", (event) => event.stopPropagation());
  next.addEventListener("click", () => {
    if (available.length === 1) {
      audio.currentTime = 0;
      if (wantsPlayback) play();
      return;
    }
    const choices = available.filter((track) => track !== playlist[index]);
    select(playlist.indexOf(choices[Math.floor(Math.random() * choices.length)]), true);
  });
  audio.addEventListener("ended", () => {
    if (!wantsPlayback) return;
    const position = available.indexOf(playlist[index]);
    select(playlist.indexOf(available[(position + 1) % available.length]));
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
  window.addEventListener("character-selected", sync);
  window.addEventListener("pagehide", () => audio.pause());
  render();
  return {
    audio,
    sync,
    get index() {
      return index;
    },
  };
})();
