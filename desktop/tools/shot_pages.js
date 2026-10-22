// 逐页截图（配合 run_dev_server.py）。用法: node tools/shot_pages.js [outDir]
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://127.0.0.1:8765/index.html?dev=1';
const OUT = process.argv[2] || path.join(process.env.TEMP, 'suiti_pages');

const PAGES = [
  ['home', '#/home', 1300, 900, false],
  ['banks', '#/banks', 1300, 900, false],
  ['setup', '#/setup?bank=2&mode=exam', 1300, 1080, false],
  ['hard', '#/hard', 1300, 950, false],
  ['records-practice', '#/records', 1300, 950, false],
  ['records-exam', '#/records?tab=exam', 1300, 950, false],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EDGE, args: ['--disable-gpu'] });
  const errs = [];

  async function newPage(w, h) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1.3 });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errs.push('console: ' + m.text());
    });
    return page;
  }

  for (const [name, hash, w, h, full] of PAGES) {
    const page = await newPage(w, h);
    await page.goto(BASE + hash, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: full });
    console.log('shot', name);
    await page.close();
  }

  // 做题页：先用真实接口建卷，再注入 sessionStorage 跳转
  async function sessionPage(name, mode, prepare) {
    const page = await newPage(1320, 900);
    await page.goto(BASE + '#/home', { waitUntil: 'networkidle' });
    const ok = await page.evaluate(async (m) => {
      const r = await fetch('api/create_session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bank_id: 2,
          types: ['single', 'multi', 'judge'],
          amount_mode: 'num',
          amount: { single: 6, multi: 3, judge: 3 },
          score_per_q: 2,
          q_order: 'asc',
          a_order: 'shuffle',
          mode: m,
          candidate: m === 'practice' ? '' : '张三 2026001',
        }),
      }).then((x) => x.json());
      if (!r.ok) return r;
      sessionStorage.setItem('suiti_session', JSON.stringify(r.data));
      window.App.current = r.data;
      return { ok: true, sid: r.data.session_id, total: r.data.total };
    }, mode);
    if (!ok.ok) {
      console.log('create_session failed', JSON.stringify(ok));
      await page.close();
      return;
    }
    await page.evaluate((m) => {
      location.hash = m === 'practice' ? '/practice' : '/exam';
    }, mode);
    await page.waitForTimeout(1200);
    if (prepare) await prepare(page, ok);
    await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: false });
    console.log('shot', name);
    await page.close();
  }

  await sessionPage('practice', 'practice', async (page) => {
    // 点第一个选项，制造"已判分"状态
    await page.click('.opt');
    await page.waitForTimeout(600);
  });

  await sessionPage('exam', 'exam', async (page) => {
    // 答 3 题、标记 1 题
    const cards = await page.$$('.qcard');
    for (let i = 0; i < 3 && i < cards.length; i++) {
      const opts = await cards[i].$$('.opt');
      if (opts.length) {
        await opts[0].click();
        await page.waitForTimeout(120);
      }
    }
    const marks = await page.$$('input[data-mark]');
    if (marks.length > 4) {
      await marks[4].click();
      await page.waitForTimeout(200);
    }
    await page.evaluate(() => {
      document.getElementById('q-8').scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(400);
  });

  await browser.close();
  if (errs.length) {
    console.log('\n--- 前端报错 ---');
    console.log([...new Set(errs)].join('\n'));
  } else {
    console.log('\n无前端报错');
  }
})();
