// 用本机 Edge（playwright-core，无需下载浏览器）把 HTML 渲染成 PNG。
// 用法: node tools/shot.js <url-or-file> <out.png> [width=1280] [height=900] [full=0|1] [selector]
const path = require('path');
const { chromium } = require('playwright-core');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

(async () => {
  const [, , target, out, w = '1280', h = '900', full = '0', selector] = process.argv;
  if (!target || !out) {
    console.error('usage: node shot.js <url> <out.png> [width] [height] [full] [selector]');
    process.exit(2);
  }
  const url = /^https?:|^file:/.test(target) ? target : 'file:///' + path.resolve(target).replace(/\\/g, '/');
  const browser = await chromium.launch({ executablePath: EDGE, args: ['--disable-gpu'] });
  const page = await browser.newPage({
    viewport: { width: Number(w), height: Number(h) },
    deviceScaleFactor: 1.4,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => {
    errors.push('goto: ' + e.message);
  });
  await page.waitForTimeout(900);
  if (selector) {
    const el = await page.$(selector);
    if (el) await el.screenshot({ path: out });
    else await page.screenshot({ path: out, fullPage: full === '1' });
  } else {
    await page.screenshot({ path: out, fullPage: full === '1' });
  }
  await browser.close();
  if (errors.length) console.log(errors.join('\n'));
  console.log('saved ' + out);
})();
