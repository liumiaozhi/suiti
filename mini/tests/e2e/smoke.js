// P2 端到端冒烟（模拟器）：注入演示题库 -> 列表出现 -> 首页统计刷新 -> 删除生效
// 前置：cli.bat auto --project <path> --auto-port 9420
const automator = require('miniprogram-automator');

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  const errors = [];
  try {
    mp.on('console', (m) => {
      if (String(m.type) === 'error') errors.push(String(m.text || JSON.stringify(m.args || '')).slice(0, 200));
    });
  } catch (e) {}

  const ok = (name, cond, extra) => console.log((cond ? '  [OK]   ' : '  [FAIL] ') + name + (extra ? '  ' + extra : ''));

  // 1. 题库页：注入演示题库
  let page = await mp.reLaunch('/pages/banks/banks');
  await page.waitFor(1200);
  const seedBtn = await page.$('.btn.ghost.sm');
  if (seedBtn) await seedBtn.tap();
  else {
    // 退而求其次：按文本找
    const els = await page.$$('view');
    for (const e of els) {
      const t = await e.text();
      if (String(t).indexOf('注入演示题库') >= 0) {
        await e.tap();
        break;
      }
    }
  }
  await page.waitFor(1500);
  page = await mp.reLaunch('/pages/banks/banks');
  await page.waitFor(1500);
  let banks = await mp.evaluate(() => {
    const p = getCurrentPages()[getCurrentPages().length - 1];
    return (p.data.banks || []).map((b) => ({ name: b.name, counts: b.counts }));
  });
  ok('题库列表出现演示题库', banks.length >= 1, JSON.stringify(banks[0] || {}));

  // 2. 首页统计刷新
  page = await mp.reLaunch('/pages/home/home');
  await page.waitFor(1500);
  const home = await mp.evaluate(() => {
    const p = getCurrentPages()[getCurrentPages().length - 1];
    return { bankCnt: p.data.bankCnt, loading: p.data.loading, err: p.data.err, banks: (p.data.banks || []).length };
  });
  ok('首页题库数 = 1', home.bankCnt === 1, JSON.stringify(home));

  // 3. 删除题库（走页面里的删除按钮）
  page = await mp.reLaunch('/pages/banks/banks');
  await page.waitFor(1200);
  await mp.evaluate(() => {
    wx.showModal = function (o) {
      o.success && o.success({ confirm: true });
    };
  });
  const del = await page.$('.btn.danger.sm');
  if (del) await del.tap();
  await page.waitFor(1500);
  page = await mp.reLaunch('/pages/banks/banks');
  await page.waitFor(1500);
  const after = await mp.evaluate(() => {
    const p = getCurrentPages()[getCurrentPages().length - 1];
    return (p.data.banks || []).length;
  });
  ok('删除后题库列表为空', after === 0, '剩余 ' + after);

  console.log('\n控制台错误：' + (errors.length ? errors.join('\n') : '（无）'));
  await mp.disconnect();
})().catch((e) => {
  console.error('失败：', (e && e.message) || e);
  process.exit(1);
});
