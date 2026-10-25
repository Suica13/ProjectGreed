/* 手机每次打开页面时提示一次；不锁定方向，不拦截后续房间或战斗。 */
(() => {
  const tip = document.getElementById("mobileLandscapeTip"),
    touchDevice = matchMedia("(pointer: coarse)").matches,
    mobile = touchDevice && Math.min(innerWidth, innerHeight) <= 900;
  if (mobile) {
    tip.hidden = false;
    document.documentElement.classList.add("mobile-intro-pending");
  }
  document.getElementById("continueFromLandscapeTip").onclick = () => {
    tip.hidden = true;
    document.documentElement.classList.remove("mobile-intro-pending");
  };
})();
