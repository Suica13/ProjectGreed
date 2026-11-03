/* 开火音效按 Step 时刻调度；跳过、离开、暂停会取消尚未播放的声音。 */
const WeaponAudio = (() => {
  let context = null,
    loading = null,
    current = null,
    battleMuted = false;
  const decoding = new Map();
  const buffers = new Map(),
    nodes = new Map(),
    volumeGains = new Map(),
    startTimes = new WeakMap();
  const volumeMultiplier = () =>
    typeof ClientSettings === "undefined" ? 1 : ClientSettings.volume("sfx");
  function updateVolume() {
    for (const { gain, volume } of volumeGains.values())
      gain.gain.value = volume * volumeMultiplier();
  }
  window.addEventListener("audio-settings-change", updateVolume);
  function stopNodes(channel = null) {
    for (const [node, kind] of nodes) {
      if (channel && kind !== channel) continue;
      try {
        node.stop();
      } catch {}
      nodes.delete(node);
      volumeGains.delete(node);
    }
  }
  // Page/room changes stop scene audio, but let button feedback finish.
  // Hiding or leaving the browser page still stops every channel.
  function stop(includeUI = false) {
    current = null;
    if (includeUI) stopNodes();
    else {
      stopNodes("battle");
      stopNodes("tail");
      stopNodes("map");
    }
  }
  function stopBattle() {
    current = null;
    stopNodes("battle");
  }
  // 自然结束只取消尚未开始的提示，正在响的最后一发允许完整播放。
  function releaseBattle() {
    current = null;
    for (const [node, kind] of nodes) {
      if (kind !== "battle") continue;
      if ((startTimes.get(node) ?? Infinity) <= context.currentTime) nodes.set(node, "tail");
      else {
        try {
          node.stop();
        } catch {}
        nodes.delete(node);
        volumeGains.delete(node);
      }
    }
  }
  function setBattleMuted(muted) {
    battleMuted = !!muted;
    if (battleMuted) {
      stopBattle();
      stopNodes("tail");
    }
  }
  function decodeSound(source) {
    if (!decoding.has(source)) decoding.set(source, (async () => {
      const response = await fetch(source);
      return context.decodeAudioData(await response.arrayBuffer());
    })());
    return decoding.get(source);
  }
  async function loadSounds() {
    // 不同单位复用了同一份 OGG；按素材内容解码一次，所有逻辑 ID 共用缓冲。
    const groups = new Map();
    for (const [key, source] of Object.entries(ART.sounds)) {
      if (!groups.has(source)) groups.set(source, []);
      groups.get(source).push(key);
    }
    const entries = [...groups];
    // 控制解码并发，并在批次间交还主线程，避免首次点击阻塞网络消息。
    for (let i = 0; i < entries.length; i += 2) {
      await Promise.all(
        entries.slice(i, i + 2).map(async ([source, keys]) => {
          try {
            // data URL 在浏览器内部读取，不访问服务器，也不在 JS 中逐字节转换。
            const buffer = await decodeSound(source);
            for (const key of keys) buffers.set(key, buffer);
          } catch {
            // 单份损坏素材不妨碍其余音效初始化。
          }
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  function unlock() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return Promise.resolve();
      context ||= new AudioContext();
      if (context.state === "suspended") context.resume().catch(() => {});
      loading ||= loadSounds().catch(() => {});
      return loading;
    } catch {
      return Promise.resolve();
    }
  }
  function play(sound, at = context?.currentTime, rate = 1, channel = "map") {
    if (channel === "battle" && battleMuted) return;
    if (!context || context.state !== "running" || !buffers.has(sound?.asset)) return;
    const source = context.createBufferSource(),
      gain = context.createGain();
    source.buffer = buffers.get(sound.asset);
    source.playbackRate.value = rate;
    const volume =
      sound.volume *
      ART.presentation.sfxVolume *
      (channel === "battle" ? (ART.presentation.battleSfxVolume ?? 0.5) : 1);
    gain.gain.value = volume * volumeMultiplier();
    volumeGains.set(source, { gain, volume });
    source.connect(gain);
    gain.connect(context.destination);
    source.onended = () => {
      nodes.delete(source);
      volumeGains.delete(source);
      source.disconnect();
      gain.disconnect();
    };
    nodes.set(source, channel);
    const startsAt = Math.max(context.currentTime, at);
    startTimes.set(source, startsAt);
    source.start(startsAt);
  }
  // Decode only the native button asset on first use; reuse the normal sound cache.
  function buttonClick() {
    try {
      unlock();
      const sound = ART.presentation.buttonSound;
      if (!context || !sound || volumeMultiplier() === 0) return;
      if (buffers.has(sound.asset)) return play(sound, undefined, 1, "ui");
      decodeSound(ART.sounds[sound.asset]).then((buffer) => {
        buffers.set(sound.asset, buffer);
        if (!document.hidden) play(sound, undefined, 1, "ui");
      }).catch(() => {});
    } catch {
      // Unavailable audio must never block an interface action.
    }
  }
  function sync(owner, index, weapon, time, rate = 1, cues = null) {
    if (battleMuted) {
      stopBattle();
      return;
    }
    const sequence =
      cues || [...new Set(weapon.attack.shots)].map((at) => ({ at, sound: weapon.sound }));
    if (!context || context.state !== "running") return;
    if (!sequence.some((c) => buffers.has(c.sound?.asset))) return;
    const cueKey = sequence
      .map((c) => c.at + ":" + c.sound?.asset + ":" + buffers.has(c.sound?.asset))
      .join("|");
    if (
      current?.owner === owner &&
      current.index === index &&
      current.weapon === weapon &&
      current.cueKey === cueKey &&
      current.rate === rate &&
      Math.abs((context.currentTime - current.origin) * rate - time) < 0.12
    )
      return;
    stopBattle();
    const origin = context.currentTime - time / rate;
    current = { owner, index, weapon, rate, origin, cueKey };
    for (const { at, sound } of sequence) {
      if (at < time - 0.03) continue;
      play(sound, origin + at / rate, rate, "battle");
    }
  }
  // Delegation also covers dynamically created dialogs and keyboard/touch activation.
  document.addEventListener("click", (event) => {
    if (!event.isTrusted) return;
    const button = event.target?.closest?.("button, [role='button'], input[type='button'], input[type='submit'], summary");
    if (!button || button.dataset.buttonSound === "off" || button.matches(":disabled") || button.getAttribute("aria-disabled") === "true" || button.closest("[inert]")) return;
    buttonClick();
  }, { capture: true });
  window.addEventListener("pointerdown", unlock, { capture: true });
  window.addEventListener("keydown", unlock, { capture: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop(true);
  });
  window.addEventListener("pagehide", () => stop(true));
  return { unlock, sync, stop, stopBattle, setBattleMuted, play, releaseBattle };
})();
