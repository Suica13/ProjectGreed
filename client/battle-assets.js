/* Keep playback clocks and ready acknowledgements behind actual resource readiness. */
window.BattleAssets = (() => {
  let generation = 0,
    loading = false,
    sceneKey = null;
  function cancel() {
    generation++;
    if (loading) {
      loading = false;
      StartupLoading.finish();
    }
  }
  function release() {
    cancel();
    if (sceneKey !== null) {
      sceneKey = null;
      resetMapPresentation();
    }
  }
  function guard(snapshot, resume) {
    if (["waiting", "assembly"].includes(snapshot.phase)) {
      release();
      return false;
    }
    const keys = SpriteRenderer.battleKeys(snapshot);
    const nextKey = JSON.stringify([snapshot.room, snapshot.matchId, snapshot.game?.mapId, snapshot.game?.campaignBattlefield?.regionId]);
    if (sceneKey !== nextKey) {
      cancel();
      sceneKey = nextKey;
      resetMapPresentation(keys);
    }
    if (SpriteRenderer.readyAssets(keys)) {
      cancel();
      return false;
    }
    const stamp = ++generation;
    loading = true;
    if (battleView?.mapBattle) MapCombat.suspend(battleView);
    WeaponAudio.stopBattle();
    StartupLoading.begin("正在加载战斗资源…");
    SpriteRenderer.ensureAssets(keys, (count, total) => {
      if (stamp === generation) StartupLoading.progress(count, total);
    })
      .then(() => {
        if (stamp !== generation) return;
        loading = false;
        StartupLoading.finish();
        resume();
      })
      .catch((error) => {
        if (stamp === generation) StartupLoading.fail(error);
      });
    return true;
  }
  return {
    guard,
    cancel,
    release,
    get loading() {
      return loading;
    },
  };
})();
