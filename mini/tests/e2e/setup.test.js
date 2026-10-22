// P2 补充：出题设置页的两个真机缺陷回归
//  1) 字符串题库 ID 曾被判"请先选择题库"
//  2) 「按题型指定」下数量/分值控件曾整块消失
// 前置：cli.bat auto --project <path> --auto-port 9420
const automator = require('miniprogram-automator');

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  const ok = (name, cond, extra) => console.log((cond ? '  [OK]   ' : '  [FAIL] ') + name + (extra ? '  ' + extra : ''));

  // 准备：注入演示题库
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
    return b ? { id: b.id, name: b.name, counts: b.counts } : null;
  });
  ok('演示题库就绪', !!bank, bank && bank.name);

  // 进出题设置：先回 tab 页，再用 navigateTo（reLaunch 到非 tab 页在部分版本会抛内部错误）
  await mp.reLaunch('/pages/home/home');
  await page.waitFor(1000);
  page = await mp.navigateTo('/pages/setup/setup?bank=' + bank.id + '&mode=practice');
  await page.waitFor(2000);
  let d = await mp.evaluate(() => {
    const p = getCurrentPages()[getCurrentPages().length - 1];
    return { err: p.data.err, total: p.data.total, scoreTotalText: p.data.scoreTotalText, rows: (p.data.rows || []).length, bankName: p.data.bankName };
  });
  ok('不再提示"请先选择题库"', d.err !== '请先选择题库', 'err=' + JSON.stringify(d.err));
  ok('全量预览 16 题 / 满分 36 分（8×2+4×4+4×1）', d.total === 16 && d.scoreTotalText === '36', 'total=' + d.total + ' 满分=' + d.scoreTotalText);
  ok('数量与分值行 = 已勾选题型 3 行', d.rows === 3, 'rows=' + d.rows);

  // 切换到「按题型指定」，控件必须还在
  const seg = await page.$$('.seg .item');
  if (seg[1]) await seg[1].tap();
  await page.waitFor(800);
  d = await mp.evaluate(() => {
    const p = getCurrentPages()[getCurrentPages().length - 1];
    return {
      amountMode: p.data.amountMode,
      rows: (p.data.rows || []).map((r) => ({ key: r.key, subtotal: r.subtotal })),
      total: p.data.total,
      err: p.data.err,
      inputs: null,
    };
  });
  ok('「按题型指定」下仍有 3 行控件', d.rows.length === 3, JSON.stringify(d.rows));
  ok('切回按题型指定后合计不变', d.total === 16 && !d.err, 'total=' + d.total);

  const inputs = await page.$$('.inp.sm');
  ok('数量/分值输入框共 6 个（3 题型 × 数量+分值）', inputs.length === 6, 'inputs=' + inputs.length);

  console.log('\n完成');
  await mp.disconnect();
})().catch((e) => {
  console.error('失败：', (e && e.message) || e);
  process.exit(1);
});
