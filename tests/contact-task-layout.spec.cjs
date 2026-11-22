const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const width of [1440, 390])
  test(`liaison grouped commission cards and two-line objectives at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 960 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    await page.locator("#profileCompanyName").fill("UI PMC");
    await page.locator("#profileOnboardingConfirm").click();
    await page.evaluate(() => {
      I18n.setLanguage("zh");
      Economy.meetLiaison();
    });
    await page.locator("#shellMissions").click();
    const tasks = page.locator("#contactTasks");
    await expect(tasks.locator(".contact-task-group > h3")).toHaveText("联邦联络人");
    await expect(tasks.locator(".contact-task-detail")).toHaveText("请选择任务");
    await page.locator("#shellContactMerchants").click();
    await page.locator('[data-merchant-id="efsf"] .merchant-portrait').click();
    const terminal = page.locator("#merchantTerminal");
    await terminal.getByRole("button", { name: "任务", exact: true }).click();
    await expect(terminal.locator(".contact-task-group > h3")).toHaveText("联邦联络人");
    await expect(terminal.locator(".contact-task-card")).toHaveCount(10);
    await expect(terminal.locator(".contact-task-detail")).toHaveText("请选择任务");
    const merchantToggle = terminal.locator(".contact-task-group-toggle");
    await merchantToggle.click();
    await expect(merchantToggle).toHaveAttribute("aria-expanded", "false");
    await expect(terminal.locator('[data-task-id="efsf-1"]')).not.toBeVisible();
    await merchantToggle.click();
    await terminal.locator('[data-task-id="efsf-2"]').click();
    await expect(terminal.locator(".contact-task-detail > h3")).toHaveText("搜索任务");
    await expect(terminal.locator("#contactTaskAction")).toBeDisabled();
    await terminal.locator('[data-task-id="efsf-1"]').click();
    await expect(terminal.locator(".contact-task-conditions")).toHaveText(
      "合约模式 · N1以上 · 0079T1 · 敌军：吉翁军",
    );
    await expect(terminal.locator(".contact-task-progress")).toHaveText("歼灭吉翁军MS 0/6");
    await terminal.locator("#contactTaskAction").click();
    await terminal.getByRole("button", { name: "关闭", exact: true }).click();
    await page.locator("#shellContactTasks").click();
    await expect(tasks.locator(".contact-task-card")).toHaveCount(1);
    await expect(tasks.locator(".contact-task-detail")).toHaveText("请选择任务");
    const acceptedToggle = tasks.locator(".contact-task-group-toggle");
    await acceptedToggle.click();
    await expect(tasks.locator('[data-task-id="efsf-1"]')).not.toBeVisible();
    await acceptedToggle.click();
    const headingX = await acceptedToggle.evaluate((n) => n.getBoundingClientRect().x);
    const cardX = await tasks
      .locator('[data-task-id="efsf-1"]')
      .evaluate((n) => n.getBoundingClientRect().x);
    expect(cardX).toBeGreaterThan(headingX + 12);
    await tasks.locator('[data-task-id="efsf-1"]').click();
    await expect(tasks.locator(".contact-task-progress")).toHaveText("歼灭吉翁军MS 0/6");
    await page.evaluate(() =>
      Economy.creditAward({
        id: "half",
        matchId: "half",
        money: 0,
        supplies: 0,
        contactProgress: [{ id: "efsf-1", amount: 3 }],
      }),
    );
    await expect(tasks.locator(".contact-task-progress")).toHaveText("歼灭吉翁军MS 3/6");
    const geometry = await tasks.evaluate((n) => {
      const list = n.querySelector(".contact-task-list").getBoundingClientRect(),
        detail = n.querySelector(".contact-task-detail").getBoundingClientRect(),
        bounds = n.getBoundingClientRect();
      return {
        list: { x: list.x, y: list.y, right: list.right, bottom: list.bottom },
        detail: { x: detail.x, y: detail.y, right: detail.right, bottom: detail.bottom },
        right: bounds.right,
        bottom: bounds.bottom,
        overflow: n.scrollWidth > n.clientWidth + 1,
      };
    });
    expect(geometry.overflow).toBe(false);
    expect(Math.abs(geometry.detail.right - geometry.right)).toBeLessThan(2);
    expect(Math.abs(geometry.detail.bottom - geometry.bottom)).toBeLessThan(2);
    const mainBottom = await page
      .locator("#contactScreen .warehouse-main")
      .evaluate((n) => n.getBoundingClientRect().bottom);
    expect(mainBottom - geometry.bottom).toBeLessThan(20);
    const icon = await tasks
      .locator(".contact-currency-reward .resource-icon")
      .first()
      .boundingBox();
    expect(icon.width).toBe(18);
    expect(icon.height).toBe(18);
    if (width > 720) expect(geometry.detail.x).toBeGreaterThan(geometry.list.right);
    else expect(geometry.detail.y).toBeGreaterThanOrEqual(geometry.list.bottom);
    await page.screenshot({
      path: `tmp/verification/screenshots/contact-task-layout-${width}.png`,
    });
    await page.evaluate(() =>
      Economy.creditAward({
        id: "ready",
        matchId: "ready",
        money: 0,
        supplies: 0,
        contactProgress: [{ id: "efsf-1", amount: 3 }],
      }),
    );
    await expect(tasks.locator(".contact-task-card-status")).toHaveText("可交付");
    await tasks.locator("#acceptedContactTaskAction").click();
    await expect(terminal.locator("#liaisonDialogueNext")).toBeVisible();
    await terminal.locator("#liaisonDialogueNext").click();
    await terminal.locator("#liaisonDialogueNext").click();
    expect(await page.evaluate(() => Economy.snapshot().contactTasks[0].status)).toBe("claimed");
    await terminal.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(tasks.locator(".contact-task-card")).toHaveCount(0);
    await expect(tasks.locator(".contact-task-detail")).toHaveText("请选择任务");
    await page.evaluate(() => {
      Economy.acceptContactTask("efsf-2");
      I18n.setLanguage("en");
    });
    await tasks.locator('[data-task-id="efsf-2"]').click();
    await expect(tasks.locator(".contact-task-progress")).toContainText(
      "Recover the crashed Medea's data and extract 0/1",
    );
    await expect(tasks.locator(".contact-task-conditions")).toContainText(
      "N1+ · 0079T1 · Enemy: Zeon",
    );
    expect(errors).toEqual([]);
  });

for (const width of [1440,390])
  test(`commission prerequisites, side tags and stable task-list scrolling at ${width}px`,async({page})=>{
    test.setTimeout(90000);
    await page.setViewportSize({width,height:650});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
    await page.waitForFunction(()=>assetsReady);
    await page.locator('#profileCompanyName').fill('Scroll PMC');
    await page.locator('#profileOnboardingConfirm').click();
    await page.evaluate(()=>{I18n.setLanguage('zh');Economy.meetLiaison();});
    await page.locator('#shellMissions').click();
    await page.locator('#shellContactMerchants').click();
    await page.locator('[data-merchant-id="efsf"] .merchant-portrait').click();
    const terminal=page.locator('#merchantTerminal');
    await terminal.getByRole('button',{name:'任务',exact:true}).click();
    await expect(terminal.locator('[data-task-id="efsf-1"] strong')).toHaveText('首秀');
    expect(await terminal.locator('.contact-task-card[data-branch="side"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.taskId)))
      .toEqual(['efsf-7','efsf-10']);
    await expect(terminal.locator('[data-task-id="efsf-8"] .contact-task-side-tag')).toHaveCount(0);
    await terminal.locator('[data-task-id="efsf-9"]').click();
    const requirements=terminal.locator('.contact-task-requirements');
    await expect(requirements).toHaveText('前提任务：最好的差事');
    await terminal.locator('.contact-task-actions').scrollIntoViewIfNeeded();
    const geometry=await terminal.locator('.contact-task-actions').evaluate(node=>{
      const action=node.querySelector('button').getBoundingClientRect(),requirement=node.querySelector('.contact-task-requirements').getBoundingClientRect();
      return {right:requirement.left>=action.right,sameRow:requirement.top<action.bottom && requirement.bottom>action.top};
    });
    expect(geometry).toEqual({right:true,sameRow:true});
    await terminal.locator('.contact-task-list').evaluate(node=>{window.testTaskList=node;node.scrollTop=node.scrollHeight;});
    const before=await terminal.locator('.contact-task-list').evaluate(node=>node.scrollTop);
    expect(before).toBeGreaterThan(0);
    await terminal.locator('[data-task-id="efsf-10"]').click();
    expect(await terminal.locator('.contact-task-list').evaluate(node=>node===window.testTaskList)).toBe(true);
    expect(await terminal.locator('.contact-task-list').evaluate(node=>node.scrollTop)).toBeCloseTo(before,0);
    await expect(terminal.locator('.contact-task-detail > h3 .contact-task-side-tag')).toHaveText('支线');
    await expect(requirements).toHaveText('前提任务：往事速递');
    await terminal.locator('.contact-task-detail').evaluate(node=>{node.scrollTop=node.scrollHeight;});
    const positions=await terminal.evaluate(node=>[node.querySelector('.contact-task-list').scrollTop,node.querySelector('.contact-task-detail').scrollTop]);
    await terminal.locator('[data-task-id="efsf-10"]').click();
    expect(await terminal.locator('.contact-task-detail').evaluate(node=>node.scrollTop)).toBe(positions[1]);
    await page.evaluate(()=>Economy.creditActivity({id:'scroll-refresh',matchId:'scroll-refresh',money:0,supplies:0,inventory:{}}));
    expect(await terminal.evaluate(node=>[node.querySelector('.contact-task-list').scrollTop,node.querySelector('.contact-task-detail').scrollTop])).toEqual(positions);
    await page.evaluate(()=>I18n.setLanguage('en'));
    await expect(terminal.locator('.contact-task-requirements')).toContainText('Prerequisite commission:');
    await expect(terminal.locator('.contact-task-detail > h3 .contact-task-side-tag')).toHaveText('Side');
    await terminal.getByRole('button',{name:'Close',exact:true}).click();
    await page.evaluate(()=>{
      const p=ProfileSave.encodeData();p.economy.contactTasks=ContactTasks.tasks.map(task=>({id:task.id,status:'accepted',progress:0}));
      ProfileSave.importData(p);
    });
    await page.reload();await page.waitForFunction(()=>assetsReady);
    await page.locator('#shellMissions').click();await page.locator('#shellContactTasks').click();
    const accepted=page.locator('#contactTasks');
    await accepted.locator('.contact-task-list').evaluate(node=>{window.testAcceptedList=node;node.scrollTop=node.scrollHeight;});
    const acceptedBefore=await accepted.locator('.contact-task-list').evaluate(node=>node.scrollTop);
    expect(acceptedBefore).toBeGreaterThan(0);
    await accepted.locator('[data-task-id="efsf-10"]').click();
    expect(await accepted.locator('.contact-task-list').evaluate(node=>node===window.testAcceptedList)).toBe(true);
    expect(await accepted.locator('.contact-task-list').evaluate(node=>node.scrollTop)).toBeCloseTo(acceptedBefore,0);
    expect(errors).toEqual([]);
  });
