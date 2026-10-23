/* 开火音效按 Step 时刻调度；跳过、离开、暂停会取消尚未播放的声音。 */
const WeaponAudio = (() => {
  let context = null,
    loading = null,
    current = null;
  const buffers = new Map(),
    nodes = new Map();
  function stopNodes(channel = null) {
    for (const [node, kind] of nodes) {
      if (channel && kind !== channel) continue;
      try {
        node.stop();
      } catch {}
      nodes.delete(node);
    }
  }
  function stop() {
    current = null;
    stopNodes();
  }
  function stopBattle() {
    current = null;
    stopNodes("battle");
  }
  function unlock() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return Promise.resolve();
      context ||= new AudioContext();
      if (context.state === "suspended") context.resume().catch(() => {});
      loading ||= Promise.all(
        Object.entries(ART.sounds).map(async ([key, source]) => {
          const bytes = Uint8Array.from(atob(source.split(",")[1]), (c) => c.charCodeAt(0));
          buffers.set(key, await context.decodeAudioData(bytes.buffer));
        }),
      ).catch(() => {});
      return loading;
    } catch {
      return Promise.resolve();
    }
  }
  function play(sound, at = context?.currentTime, rate = 1, channel = "map") {
    if (!context || context.state !== "running" || !buffers.has(sound?.asset)) return;
    const source = context.createBufferSource(),
      gain = context.createGain();
    source.buffer = buffers.get(sound.asset);
    source.playbackRate.value = rate;
    gain.gain.value = sound.volume * ART.presentation.sfxVolume;
    source.connect(gain);
    gain.connect(context.destination);
    source.onended = () => {
      nodes.delete(source);
      source.disconnect();
      gain.disconnect();
    };
    nodes.set(source, channel);
    source.start(Math.max(context.currentTime, at));
  }
  function sync(owner, index, weapon, time, rate = 1, cues = null) {
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
  window.addEventListener("pointerdown", unlock, { capture: true });
  window.addEventListener("keydown", unlock, { capture: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
  });
  window.addEventListener("pagehide", stop);
  return { unlock, sync, stop, stopBattle, play };
})();
