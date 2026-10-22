// 探针：多选题点击后，数据层 sel 是否变化、DOM 上 .opt.sel 是否出现
// 前置：cli.bat auto --project <path> --auto-port 9420
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
  if (seed) { await seed.tap(); await page.waitFor(1500); }
  page = await mp.reLaunch('/pages/banks/banks');
  await page.waitFor(1500);
  const bank = await mp.evaluate(() => {
    const p = getCurrentPages()[getCurrentPages().length - 1];
    const b = (p.data.banks || [])[0];
    return b ? { id: b.id, name: b.name } : null;
  });
  ok('题库就绪', !!bank, bank && bank.name);

  // 建练习卷
  await mp.reLaunch('/pages/home/home');
  await page.waitFor(800);
  page = await mp.navigateTo('/pages/setup/setup?bank=' + bank.id + '&mode=practice');
  await page.waitFor(1800);
  const start = await page.$('.footbar .btn.pri');
  if (start) await start.tap();
  await page.waitFor(2500);
  page = await mp.currentPage();
  await page.waitFor(1500);

  let route = await mp.evaluate(() => getCurrentPages().pop().route);
  ok('进入练习页', route === 'pages/practice/practice', 'route=' + route);

  // 直接跳到第一道多选题（练习卷：单选 8 -> 多选 4 -> 判断 4）
  await mp.evaluate(() => {
    const p = getCurrentPages().pop();
    const idx = (p.data.__all || []).length;
    return null;
  });
  for (let i = 0; i < 20; i++) {
    const qt = await mp.evaluate(() => {
      const p = getCurrentPages().pop();
      return p.data.item && p.data.item.qtype;
    });
    if (qt === 'multi') break;
    await mp.evaluate(() => {
      const p = getCurrentPages().pop();
      p.setData({ result: null, sel: [] }, () => p.load(p.data.pos + 1));
    });
    await page.waitFor(700);
  }
  const st = await mp.evaluate(() => {
    const p = getCurrentPages().pop();
    return { pos: p.data.pos, qtype: p.data.item && p.data.item.qtype, opts: (p.data.item && p.data.item.options_disp || []).length };
  });
  ok('定位到多选题', st.qtype === 'multi', JSON.stringify(st));

  // 点第一个选项
  const before = await mp.evaluate(() => {
    const p = getCurrentPages().pop();
    return { sel: JSON.parse(JSON.stringify(p.data.sel || [])) };
  });
  const opt = await page.$('.opts .opt');
  if (opt) await opt.tap();
  await page.waitFor(800);

  const after = await mp.evaluate(() => {
    const p = getCurrentPages().pop();
    return { sel: JSON.parse(JSON.stringify(p.data.sel || [])), result: !!p.data.result };
  });
  ok('点击后 data.sel 有值', (after.sel || []).length > 0, 'before=' + JSON.stringify(before.sel) + ' after=' + JSON.stringify(after.sel));

  // DOM 上是否真的带上了 sel 类
  let domSel = -1;
  try {
    const els = await page.$$('.opt.sel');
    domSel = (els || []).length;
  } catch (e) { domSel = -2; }
  ok('DOM 上出现 .opt.sel', domSel > 0, '匹配数=' + domSel);

  // 再点一次应取消
  if (opt) await opt.tap();
  await page.waitFor(700);
  const after2 = await mp.evaluate(() => {
    const p = getCurrentPages().pop();
    return JSON.parse(JSON.stringify(p.data.sel || []));
  });
  ok('再次点击可取消', (after2 || []).length === 0, 'sel=' + JSON.stringify(after2));

  // 练习模式：多选题再选两个 -> 点「完成」应判分
  const opts = await page.$$('.opts .opt');
  if (opts[0]) await opts[0].tap();
  await page.waitFor(400);
  if (opts[1]) await opts[1].tap();
  await page.waitFor(600);
  const sel2 = await mp.evaluate(() => JSON.parse(JSON.stringify(getCurrentPages().pop().data.sel || [])));
  ok('多选题可多选', (sel2 || []).length === 2, 'sel=' + JSON.stringify(sel2));
  let domSel2 = 0;
  try { domSel2 = (await page.$$('.opt.sel') || []).length; } catch (e) {}
  ok('两个选项都高亮', domSel2 === 2, '匹配数=' + domSel2);

  const doneBtn = await page.$('.btn.pri.sm');
  if (doneBtn) await doneBtn.tap();
  await page.waitFor(900);
  const fb = await mp.evaluate(() => {
    const p = getCurrentPages().pop();
    return { result: !!p.data.result, isCorrect: p.data.result && p.data.result.isCorrect, chosen: p.data.result && p.data.result.chosenText };
  });
  ok('点「完成」后判分', !!fb.result, JSON.stringify(fb));

  // ---------------- 考试页多选 ----------------
  await mp.reLaunch('/pages/home/home');
  await page.waitFor(800);
  page = await mp.navigateTo('/pages/setup/setup?bank=' + bank.id + '&mode=mock');
  await page.waitFor(1800);
  await mp.evaluate(() => {
    const p = getCurrentPages().pop();
    p.onCandidateInput({ detail: { value: '张三 001' } });
  });
  await page.waitFor(400);
  const start2 = await page.$('.footbar .btn.pri');
  if (start2) await start2.tap();
  await page.waitFor(2500);
  page = await mp.currentPage();
  await page.waitFor(1500);
  route = await mp.evaluate(() => getCurrentPages().pop().route);
  ok('进入考试页', route === 'pages/exam/exam', 'route=' + route);

  for (let i = 0; i < 20; i++) {
    const qt = await mp.evaluate(() => {
      const p = getCurrentPages().pop();
      return p.data.item && p.data.item.qtype;
    });
    if (qt === 'multi') break;
    await mp.evaluate(() => {
      const p = getCurrentPages().pop();
      p.setData({ sel: [] }, () => p.load(p.data.pos + 1));
    });
    await page.waitFor(700);
  }
  const st2 = await mp.evaluate(() => {
    const p = getCurrentPages().pop();
    return { pos: p.data.pos, qtype: p.data.item && p.data.item.qtype };
  });
  ok('考试页定位到多选题', st2.qtype === 'multi', JSON.stringify(st2));

  const eopts = await page.$$('.opts .opt');
  if (eopts[0]) await eopts[0].tap();
  await page.waitFor(800);
  const esel = await mp.evaluate(() => JSON.parse(JSON.stringify(getCurrentPages().pop().data.sel || [])));
  let edom = 0;
  try { edom = (await page.$$('.opt.sel') || []).length; } catch (e) {}
  ok('考试页多选 data.sel 有值', (esel || []).length > 0, 'sel=' + JSON.stringify(esel));
  ok('考试页多选选项高亮', edom > 0, '匹配数=' + edom);

  if (eopts[2]) await eopts[2].tap();
  await page.waitFor(800);
  const esel2 = await mp.evaluate(() => JSON.parse(JSON.stringify(getCurrentPages().pop().data.sel || [])));
  let edom2 = 0;
  try { edom2 = (await page.$$('.opt.sel') || []).length; } catch (e) {}
  ok('考试页可加选且高亮同步', (esel2 || []).length === 2 && edom2 === 2, 'sel=' + JSON.stringify(esel2) + ' dom=' + edom2);

  console.log('\n完成');
  await mp.disconnect();
})().catch((e) => {
  console.error('失败：', (e && e.message) || e);
  process.exit(1);
});
