// P3 端到端：出题设置 -> 练习答题 -> 交卷 -> 结果页
// 前置：cli.bat auto --project <path> --auto-port 9420
const automator = require('miniprogram-automator');

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  const ok = (n, c, e) => console.log((c ? '  [OK]   ' : '  [FAIL] ') + n + (e ? '  ' + e : ''));

  // 弹窗一律确认，避免卡在 confirm
  try {
    await mp.mockWxMethod('showModal', { confirm: true });
    await mp.mockWxMethod('showToast', {});
    await mp.mockWxMethod('showLoading', {});
    await mp.mockWxMethod('hideLoading', {});
  } catch (e) {}

  // 1) 准备题库
  let page = await mp.reLaunch('/pages/banks/banks');
  await page.waitFor(1200);
  const seed = await page.$('.btn.ghost.sm');
  if (seed) {
    await seed.tap();
    await page.waitFor(1200);
  }
  page = await mp.reLaunch('/pages/banks/banks');
  await page.waitFor(1500);
  const bank = await mp.evaluate(() => {
    const p = getCurrentPages()[getCurrentPages().length - 1];
    const b = (p.data.banks || [])[0];
    return b ? { id: b.id, name: b.name } : null;
  });
  ok('题库就绪', !!bank, bank && bank.name);

  // 2) 出题设置 -> 开始
  await mp.reLaunch('/pages/home/home');
  await page.waitFor(800);
  page = await mp.navigateTo('/pages/setup/setup?bank=' + bank.id + '&mode=practice');
  await page.waitFor(1800);
  const start = await page.$('.footbar .btn.pri');
  ok('设置页有「开始」按钮', !!start);
  if (start) await start.tap();
  await page.waitFor(2500);

  // 关键：跳转后必须重新取当前页，否则点击会落到已销毁的旧页面上
  let route = await mp.evaluate(() => {
    const ps = getCurrentPages();
    return ps[ps.length - 1].route;
  });
  ok('跳转到练习页', route === 'pages/practice/practice', 'route=' + route);
  page = await mp.currentPage();
  await page.waitFor(1200);

  // 3) 答前 5 题（每次点第一个选项，多选还需点「完成」）
  for (let i = 1; i <= 5; i++) {
    const st = await mp.evaluate(() => {
      const p = getCurrentPages()[getCurrentPages().length - 1];
      return { pos: p.data.pos, total: p.data.total, result: !!p.data.result, qtype: p.data.item && p.data.item.qtype };
    });
    if (st.result) {
      // 已判分 -> 下一题
      const next = await page.$('.nav .btn.pri');
      if (next) await next.tap();
      await page.waitFor(900);
      continue;
    }
    const opt = await page.$('.opts .opt');
    if (opt) await opt.tap();
    await page.waitFor(600);
    if (st.qtype === 'multi') {
      const done = await page.$('.btn.pri.sm');
      if (done) await done.tap();
      await page.waitFor(600);
    }
    const nx = await page.$('.nav .btn.pri');
    if (nx) await nx.tap();
    await page.waitFor(900);
  }

  const mid = await mp.evaluate(() => {
    const p = getCurrentPages()[getCurrentPages().length - 1];
    return { pos: p.data.pos, doneCnt: p.data.doneCnt, total: p.data.total };
  });
  ok('已作答并推进题号', mid.pos > 1 || mid.doneCnt > 0, JSON.stringify(mid));

  // 4) 直接点「结束练习」交卷（最后一题时该按钮文案会变）
  page = await mp.reLaunch('/pages/practice/practice?sid=' + (await mp.evaluate(() => {
    const p = getCurrentPages()[getCurrentPages().length - 1];
    return p.data.sid;
  })));
  await page.waitFor(1500);
  const endBtn = await page.$('.nav .btn.pri');
  if (endBtn) await endBtn.tap();
  await page.waitFor(2500);
  route = await mp.evaluate(() => {
    const ps = getCurrentPages();
    return ps[ps.length - 1].route;
  });

  if (route !== 'pages/result/result') {
    // 还不在结果页：跳到最后一题再结束
    const total = await mp.evaluate(() => {
      const p = getCurrentPages()[getCurrentPages().length - 1];
      return p.data.total || 0;
    });
    for (let i = 0; i < total + 2; i++) {
      const b = await page.$('.nav .btn.pri');
      if (b) await b.tap();
      await page.waitFor(700);
      const r = await mp.evaluate(() => {
        const ps = getCurrentPages();
        return ps[ps.length - 1].route;
      });
      if (r === 'pages/result/result') break;
    }
  }
  route = await mp.evaluate(() => {
    const ps = getCurrentPages();
    return ps[ps.length - 1].route;
  });
  ok('交卷后进入结果页', route === 'pages/result/result', 'route=' + route);

  if (route === 'pages/result/result') {
    const res = await mp.evaluate(() => {
      const p = getCurrentPages()[getCurrentPages().length - 1];
      const s = p.data.summary || {};
      return {
        total: s.total, right: s.right, wrong: s.wrong, missing: s.missing, done: s.done_cnt,
        score: s.score, acc: p.data.accText, wrongList: (p.data.wrong || []).length,
      };
    });
    // 练习模式口径：未作答不产生"漏答"，正确率 = 正确 / 已答
    ok('练习模式不产生漏答', res.missing === 0, 'missing=' + res.missing);
    ok('对 + 错 = 已答题数', res.right + res.wrong === res.done, JSON.stringify(res));
    ok('错题列表 = 总题数 - 正确数（含未作答）', res.wrongList === res.total - res.right, '列表=' + res.wrongList);
    ok('正确率按已答数计算', res.acc === Math.round((res.right * 100) / res.done) + '%', res.acc);
  }

  console.log('\n完成');
  await mp.disconnect();
})().catch((e) => {
  console.error('失败：', (e && e.message) || e);
  process.exit(1);
});
