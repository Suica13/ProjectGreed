/* 开火音效按 Step 时刻调度；跳过、离开、暂停会取消尚未播放的声音。 */
const WeaponAudio = (() => {
  let context = null,
    current = null,
    battleMuted = false;
  const decoding = new Map();
  const channelGeneration = new Map();
  let battleSoundsKey = null;
  const decodeQueue = [];
  let activeDecodes = 0;
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
    for (const kind of channel ? [channel] : ["ui", "map", "battle", "tail"])
      channelGeneration.set(kind, (channelGeneration.get(kind) || 0) + 1);
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
    if (!decoding.has(source)) decoding.set(source, new Promise((resolve, reject) => {
      decodeQueue.push({ source, resolve, reject });
      pumpDecodes();
    }));
    return decoding.get(source);
  }
  function pumpDecodes() {
    while (activeDecodes < 2 && decodeQueue.length) {
      const job = decodeQueue.shift();
      activeDecodes++;
      fetch(job.source).then(response => response.arrayBuffer())
        .then(bytes => context.decodeAudioData(bytes)).then(job.resolve, job.reject)
        .finally(() => { activeDecodes--; setTimeout(pumpDecodes, 0); });
    }
  }
  function prepare(sounds) {
    if (!context) return Promise.resolve();
    return Promise.all(sounds.filter(sound => sound?.asset && !buffers.has(sound.asset))
      .map(async sound => {
        try { buffers.set(sound.asset, await decodeSound(ART.sounds[sound.asset])); } catch {}
      }));
  }
  function prepareBattle(snapshot) {
    const models = [...new Set(snapshot.game?.units?.map(unit => unit.model) || [])].sort();
    const key = models.join("|");
    if (!context || key === battleSoundsKey) return;
    battleSoundsKey = key;
    const sounds = models.flatMap(id => {
      const model = ART.models[id];
      return [...(model?.weapons || []).flatMap(weapon => [weapon.sound,
        ...(weapon.attack?.strikes || []).map(strike => strike.sound)]),
        ...(model?.skills || []).map(skill => skill.sound)];
    });
    prepare(sounds);
  }
  function unlock() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return Promise.resolve();
      context ||= new AudioContext();
      if (context.state === "suspended") return context.resume().catch(() => {});
      return Promise.resolve();
    } catch {
      return Promise.resolve();
    }
  }
  function sonar() {
    unlock().then(() => {
      if (!context || context.state !== "running") return;
      for (const [delay, frequency, volume] of [[0, 1120, .12], [.3, 1080, .05]]) {
        const oscillator = context.createOscillator(), envelope = context.createGain(), gain = context.createGain();
        const start = context.currentTime + delay;
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, start);
        oscillator.frequency.exponentialRampToValueAtTime(frequency * .92, start + .8);
        envelope.gain.setValueAtTime(.001, start);
        envelope.gain.exponentialRampToValueAtTime(1, start + .015);
        envelope.gain.exponentialRampToValueAtTime(.001, start + .9);
        gain.gain.value = volume * volumeMultiplier();
        oscillator.connect(envelope).connect(gain).connect(context.destination);
        nodes.set(oscillator, "ui");
        volumeGains.set(oscillator, { gain, volume });
        oscillator.onended = () => {
          nodes.delete(oscillator); volumeGains.delete(oscillator);
          oscillator.disconnect(); envelope.disconnect(); gain.disconnect();
        };
        oscillator.start(start); oscillator.stop(start + .95);
      }
    });
  }
  function play(sound, at = null, rate = 1, channel = "map") {
    if (channel === "battle" && battleMuted) return;
    if (!context || context.state !== "running" || !sound?.asset) return;
    if (!buffers.has(sound.asset)) {
      const stamp = channelGeneration.get(channel) || 0;
      prepare([sound]).then(() => {
        if (buffers.has(sound.asset) && stamp === (channelGeneration.get(channel) || 0) &&
            !document.hidden && (at === null || at >= context.currentTime - 0.12))
          play(sound, at, rate, channel);
      });
      return;
    }
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
    const startsAt = Math.max(context.currentTime, at ?? context.currentTime);
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
      prepare([sound]).then(() => {
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
    if (sequence.some(c => c.sound && !buffers.has(c.sound.asset))) prepare(sequence.map(c => c.sound));
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
  return { unlock, prepare, prepareBattle, sync, stop, stopBattle, stopChannel: stopNodes, setBattleMuted, play, sonar, releaseBattle };
})();
