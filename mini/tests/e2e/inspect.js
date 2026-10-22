// 连接开发者工具自动化端口，从模拟器读真相：
// 每个页面渲染出多少节点、当前页 data 是什么、控制台有没有报错。
// 前置：cli.bat auto --project <path> --auto-port 9420
//
// 注意：该版本 automator 的 page 没有 evaluate，要用 mp.evaluate（应用上下文）。
const automator = require('miniprogram-automator');

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  const errors = [];
  try {
    mp.on('console', (msg) => {
      const t = String(msg.type || '');
      if (t === 'error' || t === 'warn') errors.push('[' + t + '] ' + String(msg.text || JSON.stringify(msg.args || '')).slice(0, 300));
    });
  } catch (e) {}

  for (const p of ['/pages/home/home', '/pages/banks/banks', '/pages/records/records']) {
    console.log('\n=== ' + p + ' ===');
    let page;
    try {
      page = await mp.reLaunch(p);
      await page.waitFor(1800);
    } catch (e) {
      console.log('  reLaunch 失败: ' + (e && e.message));
      continue;
    }

    let info = {};
    try {
      info = await mp.evaluate(() => {
        const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
        const cur = pages[pages.length - 1];
        if (!cur) return { route: '(无页面栈)' };
        const d = cur.data || {};
        return {
          route: cur.route,
          keys: Object.keys(d),
          loading: d.loading,
          err: d.err,
          bankCnt: d.bankCnt,
          listLen: (d.banks || d.rows || []).length,
        };
      });
    } catch (e) {
      info = { evalError: (e && e.message) || String(e) };
    }
    console.log('  data: ' + JSON.stringify(info));

    let views = [];
    try {
      views = (await page.$$('view')) || [];
    } catch (e) {}
    console.log('  可见 view 节点数: ' + views.length);

    const texts = [];
    for (const v of views.slice(0, 30)) {
      try {
        const t = await v.text();
        if (t && String(t).trim()) texts.push(String(t).trim().slice(0, 20));
      } catch (e) {}
    }
    console.log('  文本: ' + (texts.length ? texts.slice(0, 10).join(' | ') : '（无文本）'));

    // 真机/模拟器上是否有报错弹层
    try {
      const toast = await mp.evaluate(() => ({ ok: true }));
      if (toast && toast.ok) console.log('  evaluate 通道正常');
    } catch (e) {}
  }

  console.log('\n=== 控制台错误/警告 ===');
  console.log(errors.length ? errors.slice(0, 20).join('\n') : '（未捕获到）');
  await mp.disconnect();
})().catch((e) => {
  console.error('连接失败：', (e && e.message) || e);
  process.exit(1);
});
