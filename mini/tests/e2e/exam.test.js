// P3 端到端（考试模式）：考生信息必填 -> 答题卡 -> 交卷 -> 漏答计入统计
const automator = require('miniprogram-automator');

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  const ok = (n, c, e) => console.log((c ? '  [OK]   ' : '  [FAIL] ') + n + (e ? '  ' + e : ''));
  try {
    await mp.mockWxMethod('showModal', { confirm: true });
    await mp.mockWxMethod('showToast', {});
    await mp.mockWxMethod('showLoading', {});
    await mp.mockWxMethod('hideLoading', {});
  } catch (e) {}

  // 题库
  let page = await mp.reLaunch('/pages/banks/banks');
  await page.waitFor(1200);
  const seed = await page.$('.btn.ghost.sm');
  if (seed) { await seed.tap(); await page.waitFor(1200); }
  page = await mp.reLaunch('/pages/banks/banks');
  await page.waitFor(1500);
  const bank = await mp.evaluate(() => {
    const p = getCurrentPages()[getCurrentPages().length - 1];
    const b = (p.data.banks || [])[0];
    return b ? { id: b.id, name: b.name } : null;
  });
  ok('题库就绪', !!bank, bank && bank.name);

  // 出题设置（正式考试）
  await mp.reLaunch('/pages/home/home');
  await page.waitFor(800);
  page = await mp.navigateTo('/pages/setup/setup?bank=' + bank.id + '&mode=exam');
  await page.waitFor(1800);
  const hasCandidate = await mp.evaluate(() => {
    const p = getCurrentPages()[getCurrentPages().length - 1];
    return !!p.data.showCandidate;
  });
  ok('正式考试显示考生信息输入', hasCandidate);

  // 未填考生信息 -> 不能开始
  const s0 = await page.$('.footbar .btn.pri');
  if (s0) await s0.tap();
  await page.waitFor(1200);
  let route = await mp.evaluate(() => {
    const ps = getCurrentPages();
    return ps[ps.length - 1].route;
  });
  ok('未填考生信息时被拦下', route === 'pages/setup/setup', 'route=' + route);

  // 填入考生信息（直接触发页面的输入回调）
  await mp.evaluate(() => {
    const p = getCurrentPages()[getCurrentPages().length - 1];
    p.onCandidateInput({ detail: { value: '张三 001' } });
  });
  await page.waitFor(800);
  const s1 = await page.$('.footbar .btn.pri');
  if (s1) await s1.tap();
  await page.waitFor(2500);
  route = await mp.evaluate(() => {
    const ps = getCurrentPages();
    return ps[ps.length - 1].route;
  });
  ok('进入考试页', route === 'pages/exam/exam', 'route=' + route);
  page = await mp.currentPage();
  await page.waitFor(1200);

  // 答 3 题
  for (let i = 0; i < 3; i++) {
    const opt = await page.$('.opts .opt');
    if (opt) await opt.tap();
    await page.waitFor(700);
    const nx = await page.$('.nav .btn.pri');
    if (nx) await nx.tap();
    await page.waitFor(800);
  }
  const st = await mp.evaluate(() => {
    const p = getCurrentPages()[getCurrentPages().length - 1];
    return { done: p.data.doneCnt, total: p.data.total, sheet: (p.data.sheet || []).length };
  });
  ok('已答 3 题且答题卡有分组', st.done === 3 && st.sheet >= 1, JSON.stringify(st));

  // 打开答题卡
  const sheetBtn = await page.$('.footbar .btn.ghost');
  if (sheetBtn) await sheetBtn.tap();
  await page.waitFor(1000);
  const opened = await mp.evaluate(() => {
    const p = getCurrentPages()[getCurrentPages().length - 1];
    return !!p.data.showSheet;
  });
  ok('答题卡能打开', opened);

  // 交卷
  const sub = await page.$('.footbar .btn.pri');
  if (sub) await sub.tap();
  await page.waitFor(3000);
  route = await mp.evaluate(() => {
    const ps = getCurrentPages();
    return ps[ps.length - 1].route;
  });
  ok('交卷后进入结果页', route === 'pages/result/result', 'route=' + route);

  if (route === 'pages/result/result') {
    const r = await mp.evaluate(() => {
      const p = getCurrentPages()[getCurrentPages().length - 1];
      const s = p.data.summary || {};
      return { total: s.total, right: s.right, wrong: s.wrong, missing: s.missing, candidate: s.candidate, acc: p.data.accText };
    });
    // 考试模式：正确率按题量，未答计入漏答
    ok('对+错+漏 = 总题数', r.right + r.wrong + r.missing === r.total, JSON.stringify(r));
    ok('漏答 = 总题数 - 已答 3', r.missing === r.total - 3, 'missing=' + r.missing);
    ok('考生信息带入结果', r.candidate === '张三 001', r.candidate);

    // 结果页把第一道错题勾选为「重难」
    await mp.evaluate(() => {
      const p = getCurrentPages()[getCurrentPages().length - 1];
      const w = p.data.wrong || [];
      if (w.length) p.toggleHard({ currentTarget: { dataset: { pos: w[0].pos, qid: w[0].qid } } });
    });
    await page.waitFor(1500);

    // 重难错题页应统计到这一道
    const hp = await mp.reLaunch('/pages/hard/hard');
    await hp.waitFor(1800);
    const h = await mp.evaluate(() => {
      const p = getCurrentPages()[getCurrentPages().length - 1];
      return { total: p.data.total, bankCnt: p.data.bankCnt };
    });
    ok('重难错题页统计到刚归集的题', h.total === 1 && h.bankCnt === 1, JSON.stringify(h));

    // 展开后能看到明细并可移出
    const expand = await mp.evaluate(() => {
      const p = getCurrentPages()[getCurrentPages().length - 1];
      p.toggle({ currentTarget: { dataset: { id: (p.data.banks || [])[0].bankId } } });
      return true;
    });
    await hp.waitFor(1200);
    const items = await mp.evaluate(() => {
      const p = getCurrentPages()[getCurrentPages().length - 1];
      return (p.data.openItems || []).length;
    });
    ok('展开可见题目明细', items === 1, 'items=' + items);
  }

  console.log('\n完成');
  await mp.disconnect();
})().catch((e) => {
  console.error('失败：', (e && e.message) || e);
  process.exit(1);
});
