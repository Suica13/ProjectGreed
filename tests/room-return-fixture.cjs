/* 等待真实界面/快照事件，不用重试轮询或固定睡眠。 */
async function waitForRoomReturn(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        if (!Net.snapshot?.started) {
          resolve();
          return;
        }
        const observer = new MutationObserver(() => {
          if (!Net.snapshot?.started) {
            observer.disconnect();
            resolve();
          }
        });
        observer.observe(document.body, { childList: true, attributes: true, subtree: true });
      }),
  );
}
module.exports = { waitForRoomReturn };
