/* Small retro RPG dialogue bleeps. Optional future voice playback via registerVoiceProvider.
 * Audio is presentation-only and never affects battle events or deterministic logs. */
const DialogueAudio = (() => {
  let context = null, provider = null, enabled = true, volume = 0.16;
  const presets = Object.freeze({
    calm: { frequency: 440, wave: "sine", duration: 0.045 },
    aggressive: { frequency: 310, wave: "square", duration: 0.04 },
    cautious: { frequency: 540, wave: "triangle", duration: 0.035 },
    idealist: { frequency: 660, wave: "sine", duration: 0.055 },
  });
  function configure(options = {}) {
    if (typeof options.enabled === "boolean") enabled = options.enabled;
    if (Number.isFinite(options.volume)) volume = Math.max(0, Math.min(1, options.volume));
  }
  function registerVoiceProvider(callback) {
    if (callback !== null && typeof callback !== "function") throw TypeError("Voice provider must be a function or null");
    provider = callback;
  }
  function bleep(record) {
    if (!enabled || volume <= 0 || typeof window === "undefined") return false;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return false;
    try {
      context ||= new Audio();
      if (context.state === "suspended") void context.resume().catch(() => {});
      const preset = presets[record?.personality] || presets.calm;
      const count = Math.min(7, Math.max(2, Math.ceil(String(record?.text || "").length / 7)));
      const start = context.currentTime + 0.015;
      for (let i = 0; i < count; i++) {
        const oscillator = context.createOscillator(), gain = context.createGain();
        oscillator.type = preset.wave;
        oscillator.frequency.value = preset.frequency * (i % 3 === 1 ? 1.125 : 1);
        const at = start + i * 0.095;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.linearRampToValueAtTime(volume * 0.12, at + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + preset.duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(at);
        oscillator.stop(at + preset.duration + 0.005);
      }
      return true;
    } catch { return false; }
  }
  function play(record) {
    if (!enabled) return;
    // Future providers can resolve recorded voice clips, voice packs or TTS.
    // Return true from a provider to suppress the fallback bleeps.
    try {
      if (provider?.(record) === true) return;
    } catch {}
    bleep(record);
  }
  return { play, bleep, configure, registerVoiceProvider, presets };
})();
if (typeof module !== "undefined") module.exports = DialogueAudio;
