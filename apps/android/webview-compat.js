/* ES5 on purpose: this probe must explain missing features even on old WebViews.
 * No game scripts or profile bridge reads are loaded until the native host accepts it. */
(function (root) {
  "use strict";
  function missingFeatures(view) {
    var missing = [];
    function requireFeature(name, available) { if (!available) missing.push(name); }
    requireFeature("JavaScript 集合与代理", typeof view.Map === "function" && typeof view.Set === "function" && typeof view.Proxy === "function");
    requireFeature("异步任务与网络", typeof view.Promise === "function" && typeof view.fetch === "function" && typeof view.WebSocket === "function");
    requireFeature("structuredClone（战局与存档复制）", typeof view.structuredClone === "function");
    requireFeature("Array.at / Object.hasOwn（游戏数据）", typeof view.Array.prototype.at === "function" && typeof view.Object.hasOwn === "function");
    requireFeature("文本编码", typeof view.TextEncoder === "function" && typeof view.TextDecoder === "function");
    requireFeature("安全随机数", !!view.crypto && typeof view.crypto.getRandomValues === "function");
    requireFeature("ResizeObserver（画面尺寸同步）", typeof view.ResizeObserver === "function");
    requireFeature("HTML 对话框", !!view.HTMLDialogElement && typeof view.HTMLDialogElement.prototype.showModal === "function");
    requireFeature("DOM 内容更新", !!view.Element && typeof view.Element.prototype.replaceChildren === "function");
    var selectors = false, canvas = false;
    try { selectors = !!view.CSS && view.CSS.supports("selector(:has(*))"); } catch (ignored) { }
    try { canvas = !!view.document.createElement("canvas").getContext("2d"); } catch (ignored) { }
    requireFeature("CSS :has（界面布局）", selectors);
    requireFeature("Canvas 2D（地图绘制）", canvas);
    return missing;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { missingFeatures: missingFeatures };
    return;
  }
  var missing = missingFeatures(root);
  var message = root.document.getElementById("compatibilityStatus");
  if (message) message.textContent = missing.length ? "当前 WebView 缺少必要功能：\n" + missing.join("\n") : "兼容性检查通过，正在加载游戏…";
  if (root.ProjectGreedAndroid && typeof root.ProjectGreedAndroid.compatibilityResult === "function")
    root.ProjectGreedAndroid.compatibilityResult(JSON.stringify(missing));
})(typeof window !== "undefined" ? window : this);
