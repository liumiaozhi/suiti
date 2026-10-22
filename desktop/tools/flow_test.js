// 全流程交互回归（配合 run_dev_server.py）：出题 → 考生信息 → 作答 → 标记 → 交卷 → 结果 → 错题 → 记录
// 用法: node tools/flow_test.js [outDir]
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://127.0.0.1:8765/index.html?dev=1';
const OUT = process.argv[2] || path.join(process.env.TEMP, 'suiti_flow');

const steps = [];
function ok(name, cond, extra) {
  steps.push([name, !!cond, extra || '']);
  console.log((cond ? '  [OK]   ' : '  [FAIL] ') + name + (extra ? '  ' + extra : ''));
}

async function apiNum(page, name, key) {
  return page.evaluate(
    async (a) => {
      const r = await fetch('api/' + a.name, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).then((x) => x.json());
      return r.ok ? r.data[a.key] : -1;
    },
    { name, key }
  );
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EDGE, args: ['--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1320, height: 900 }, deviceScaleFactor: 1.3 });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) errs.push('console: ' + m.text());
  });

  // ---------- 正式考试全流程 ----------
  await page.goto(BASE + '#/setup?bank=1&mode=exam', { waitUntil: 'networkidle' });
  await page.waitForSelector('#btn-gen');
  ok('设置页加载', await page.isVisible('.type-card'));

  await page.click('#btn-gen');
  await page.waitForSelector('.mask #pm-in', { timeout: 8000 });
  ok('点生成后弹出考生信息弹窗', await page.isVisible('.mask .mh'));
  await page.screenshot({ path: path.join(OUT, '01-candidate.png') });

  // 空内容不能提交
  await page.click('.mask [data-act=ok]');
  await page.waitForTimeout(200);
  const errText = await page.textContent('.mask #pm-err').catch(() => '');
  ok('空考生信息被拦截', /请填写/.test(errText || ''), errText);

  // 51 字被截断
  await page.fill('.mask #pm-in', '张'.repeat(60));
  const vlen = await page.$eval('.mask #pm-in', (el) => el.value.length);
  ok('考生信息最长 50 字', vlen === 50, 'len=' + vlen);

  await page.fill('.mask #pm-in', '张三 2026001');
  await page.click('.mask [data-act=ok]');
  await page.waitForFunction(() => location.hash.indexOf('/exam') > 0, { timeout: 8000 });
  await page.waitForSelector('.qbox');
  ok('进入考试页', await page.isVisible('#nav'));

  const total = await page.$$eval('.qbox', (els) => els.length);
  ok('题号面板题数与卷面一致', total > 0, 'total=' + total);

  // 答前 4 题
  const cards = await page.$$('.qcard');
  for (let i = 0; i < Math.min(4, cards.length); i++) {
    const opts = await cards[i].$$('.opt');
    if (opts.length) {
      await opts[0].click();
      await page.waitForTimeout(120);
    }
  }
  await page.waitForTimeout(500);
  const doneBoxes = await page.$$eval('.qbox[data-state=done]', (els) => els.length);
  ok('已答题号变蓝（4 格）', doneBoxes === 4, 'done=' + doneBoxes);

  // 标记第 5 题
  const marks = await page.$$('input[data-mark]');
  await marks[4].click();
  await page.waitForTimeout(400);
  const markedBoxes = await page.$$eval('.qbox.marked', (els) => els.length);
  const markedState = await page.$eval('.qbox.marked', (el) => getComputedStyle(el, '::after').content).catch(() => '');
  ok('标记后出现黄色感叹号角标', markedBoxes === 1, 'marked=' + markedBoxes + ' content=' + markedState);

  // 双击题号定位
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.dblclick('.qbox[data-goto="8"]');
  await page.waitForTimeout(800);
  const inView = await page.evaluate(() => {
    const el = document.getElementById('q-8');
    const r = el.getBoundingClientRect();
    return r.top > -20 && r.top < 260;
  });
  ok('双击题号滚到对应题目', inView);
  await page.screenshot({ path: path.join(OUT, '02-exam.png') });

  // 重难错题勾选（考试页）：挑一道当前未勾选的题，避免与已有归集撞车
  const hardTotal0 = await apiNum(page, 'hard_overview', 'total');
  await page.click('.qcard input[data-hard]:not(:checked)');
  await page.waitForTimeout(700);
  const hardChecked = await page.$eval('.qcard input[data-hard]:checked', (el) => el.checked);
  const hardTotal1 = await apiNum(page, 'hard_overview', 'total');
  ok('考试页勾选重难错题', hardChecked === true && hardTotal1 === hardTotal0 + 1, hardTotal0 + '→' + hardTotal1);

  // 交卷
  await page.click('#act-submit');
  await page.waitForSelector('.mask .mh');
  const subText = await page.textContent('.mask .mb');
  ok('交卷确认框显示未答/标记数量', /未答/.test(subText) && /已标记/.test(subText), subText.replace(/\s+/g, ' ').slice(0, 80));
  await page.screenshot({ path: path.join(OUT, '03-submit.png') });
  await page.click('.mask [data-act=ok]');

  await page.waitForFunction(() => location.hash.indexOf('/result') > 0, { timeout: 10000 });
  await page.waitForSelector('.score-ring', { timeout: 8000 });
  const scoreText = await page.textContent('.score-ring .n');
  const kvText = await page.textContent('.kv');
  ok('结果页显示分数', !!scoreText, 'score=' + scoreText);
  ok('结果页显示正确/错误/漏答', /总题数/.test(kvText) && /漏答/.test(kvText), kvText.replace(/\s+/g, ' ').slice(0, 90));
  await page.screenshot({ path: path.join(OUT, '04-result.png') });

  await page.click('#btn-wrong');
  await page.waitForTimeout(900);
  const wrongCount = await page.$$eval('.wrong-item', (els) => els.length);
  ok('查看错题列表', wrongCount > 0, 'wrong=' + wrongCount);
  await page.screenshot({ path: path.join(OUT, '05-wrong.png') });

  // 导出（开发态会直接落到导出目录）
  await page.click('#btn-export');
  await page.waitForSelector('.mask [data-fmt=pdf]');
  ok('导出弹窗出现三种格式', (await page.$$('.mask [data-fmt]')).length === 3);
  await page.click('.mask [data-fmt=pdf]');
  await page.waitForSelector('.mask .mh:has-text("导出成功")', { timeout: 90000 }).catch(() => null);
  const expOk = await page.isVisible('.mask .mh:has-text("导出成功")').catch(() => false);
  const expPath = expOk ? await page.textContent('.mask .mb') : '';
  ok('页面内导出 PDF 成功', expOk, (expPath || '').replace(/\s+/g, ' ').slice(0, 90));
  await page.screenshot({ path: path.join(OUT, '08-export.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // 记录页
  await page.goto(BASE + '#/records?tab=exam', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const rows = await page.$$eval('.tbl tbody tr', (els) => els.length);
  ok('考试记录列出每次正式考试', rows >= 1, 'rows=' + rows);
  const h1 = await page.textContent('#page-title');
  ok('考试记录页标题正确', h1.trim() === '考试记录', h1);

  // ---------- 练习流程 ----------
  await page.goto(BASE + '#/setup?bank=2&mode=practice', { waitUntil: 'networkidle' });
  await page.waitForSelector('#btn-gen');
  await page.click('#btn-gen');
  await page.waitForFunction(() => location.hash.indexOf('/practice') > 0, { timeout: 8000 });
  await page.waitForSelector('.qcard');
  ok('练习模式无需考生信息直接进入', true);

  await page.click('.opt');
  await page.waitForTimeout(600);
  const fb = await page.textContent('.fb').catch(() => '');
  ok('练习点选即判并给出正确答案', /回答(正确|错误)/.test(fb), fb.replace(/\s+/g, ' ').slice(0, 60));
  await page.screenshot({ path: path.join(OUT, '06-practice.png') });

  // 多选题必须点「完成」
  let foundMulti = false;
  for (let i = 0; i < 15; i++) {
    const tag = await page.textContent('.qhead .tag').catch(() => '');
    if ((tag || '').indexOf('多选') >= 0) {
      foundMulti = true;
      break;
    }
    const nx = await page.$('#next');
    if (!nx) break;
    await nx.click();
    await page.waitForTimeout(250);
  }
  if (!foundMulti) {
    ok('多选题用例（未找到多选题，跳过）', true);
  } else {
    await page.click('.opt');
    await page.waitForTimeout(400);
    const noFb = (await page.$$('.fb')).length === 0;
    ok('多选题选中不出结果', noFb);
    const doneVisible = await page.isVisible('#done');
    ok('多选题出现「完成」按钮', doneVisible);
    await page.click('#done');
    await page.waitForTimeout(600);
    const fb2 = await page.textContent('.fb').catch(() => '');
    ok('多选题点「完成」后出结果', /回答(正确|错误)/.test(fb2), (fb2 || '').replace(/\s+/g, ' ').slice(0, 50));
    await page.screenshot({ path: path.join(OUT, '07-practice-multi.png') });
  }

  // ---------- 模拟考试：必须能进 /mock 且不进考试记录 ----------
  const examBefore = await (async () => {
    const r = await page.evaluate(() =>
      fetch('api/list_exam_records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then((x) => x.json())
        .then((j) => j.data.overall.exam_cnt)
    );
    return r;
  })();

  await page.goto(BASE + '#/setup?bank=2&mode=mock', { waitUntil: 'networkidle' });
  await page.waitForSelector('#btn-gen');
  await page.click('#btn-gen');
  await page.waitForSelector('.mask #pm-in');
  await page.fill('.mask #pm-in', '李四 2026002');
  await page.click('.mask [data-act=ok]');
  await page.waitForFunction(() => location.hash.indexOf('/mock') > 0, { timeout: 8000 });
  await page.waitForSelector('.qbox');
  const mockTitle = await page.textContent('#page-title');
  ok('模拟考试进入 /mock 页面', /模拟考试/.test(mockTitle), mockTitle);
  await page.screenshot({ path: path.join(OUT, '09-mock.png') });

  await page.click('#act-submit');
  await page.waitForSelector('.mask [data-act=ok]');
  await page.click('.mask [data-act=ok]');
  await page.waitForFunction(() => location.hash.indexOf('/result') > 0, { timeout: 10000 });
  await page.waitForSelector('.score-ring');
  ok('模拟考试交卷后进入结果页', true);

  const examAfter = await page.evaluate(() =>
    fetch('api/list_exam_records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then((x) => x.json())
      .then((j) => j.data.overall.exam_cnt)
  );
  ok('模拟考试不计入考试记录', examAfter === examBefore, 'before=' + examBefore + ' after=' + examAfter);

  // ---------- 重难错题模块 ----------
  await page.goto(BASE + '#/hard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const hardCards = await page.$$('.bank');
  ok('重难错题页按题库列出', hardCards.length >= 1, 'banks=' + hardCards.length);

  // 展开列表
  await page.click('[data-toggle]');
  await page.waitForTimeout(900);
  const hardItems = await page.$$eval('.wrong-item', (els) => els.length);
  ok('展开可看题目明细', hardItems >= 1, 'items=' + hardItems);
  await page.screenshot({ path: path.join(OUT, '10-hard.png') });

  // 练习重难错题
  await page.click('[data-play]');
  await page.waitForFunction(() => location.hash.indexOf('/setup') > 0, { timeout: 8000 });
  await page.waitForSelector('#btn-gen');
  const totalHard = await page.textContent('#total-line');
  ok('重难错题进入出题设置并带上题量', /共\s*\d+\s*题/.test(totalHard), totalHard.replace(/\s+/g, ' '));
  await page.screenshot({ path: path.join(OUT, '11-hard-setup.png') });

  await page.click('#btn-gen');
  await page.waitForFunction(() => location.hash.indexOf('/practice') > 0, { timeout: 8000 });
  await page.waitForSelector('.qcard');
  const hardBoxChecked = await page.$eval('.qcard input[data-hard]', (el) => el.checked);
  ok('重难错题练习页勾选框默认已选中', hardBoxChecked === true);

  // 在练习中取消勾选 = 移出
  const before = await apiNum(page, 'hard_overview', 'total');
  await page.click('.qcard input[data-hard]');
  await page.waitForTimeout(700);
  const after = await apiNum(page, 'hard_overview', 'total');
  ok('练习中取消勾选即移出重难错题', after === before - 1, before + '→' + after);

  await browser.close();

  console.log('\n--- 前端报错 ---');
  console.log(errs.length ? [...new Set(errs)].join('\n') : '无');
  const bad = steps.filter((s) => !s[1]);
  console.log('\n通过 ' + (steps.length - bad.length) + ' / ' + steps.length);
  process.exit(bad.length ? 1 : 0);
})();
