// 探针：P4/P5 导入导出在小程序运行时的关键验证
// 思路：页面能加载 = 顶层 require 的 930KB SheetJS UMD 已在运行时成功加载。
//      进一步在真实运行时跑通「写(xlsx.writeSheets) -> 读(xlsx.readFirstSheet) -> 解析(importer)」全链路。
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
    await mp.mockWxMethod('openDocument', {});
    await mp.mockWxMethod('chooseMessageFile', { tempFiles: [] });
  } catch (e) {}

  // 1) 两个分包页能正常加载（不白屏 = require 链在运行时成功，含 930KB UMD）
  let page = await mp.reLaunch('/pkg-io-import/pages/import/import');
  await page.waitFor(1500);
  const route1 = await mp.evaluate(() => getCurrentPages().pop().route);
  ok('导入页加载（UMD 运行时加载成功）', route1 === 'pkg-io-import/pages/import/import', 'route=' + route1);

  page = await mp.reLaunch('/pkg-io-export/pages/export/export');
  await page.waitFor(1500);
  const route2 = await mp.evaluate(() => getCurrentPages().pop().route);
  ok('导出页加载（UMD 运行时加载成功）', route2 === 'pkg-io-export/pages/export/export', 'route=' + route2);

  // 2) 真实运行时全链路：写模板 -> 读回 -> 解析
  //    先回到导入页，调用页面方法 downloadTemplate（内部走 xlsx.writeSheets 写文件 + openDocument 已 mock）
  page = await mp.reLaunch('/pkg-io-import/pages/import/import');
  await page.waitFor(1500);
  const wrote = await mp.evaluate(() => {
    const p = getCurrentPages().pop();
    try {
      p.downloadTemplate();
      const fs = wx.getFileSystemManager();
      const path = wx.env.USER_DATA_PATH + '/随题导入模板.xlsx';
      fs.accessSync(path); // 抛错即不存在
      return { fileOk: true, path };
    } catch (e) {
      return { fileOk: false, err: (e && e.message) || String(e) };
    }
  });
  ok('运行时 xlsx.writeSheets 生成模板文件', wrote.fileOk, wrote.err || wrote.path);

  // 3) 把刚写的模板读回，喂给页面 parse()（内部走 xlsx.readFirstSheet + importer.parseRows）
  await mp.evaluate(() => {
    const p = getCurrentPages().pop();
    const fs = wx.getFileSystemManager();
    const path = wx.env.USER_DATA_PATH + '/随题导入模板.xlsx';
    const buf = fs.readFileSync(path); // ArrayBuffer
    p.parse(buf);
  });
  await page.waitFor(800);
  const pd = await mp.evaluate(() => {
    const p = getCurrentPages().pop();
    return { total: p.data.total, ready: p.data.ready, q: (p.data.questions || []).length, e: (p.data.errors || []).length };
  });
  // 模板含 3 道示例题（单选/多选/判断）
  ok('运行时 xlsx.readFirstSheet + importer 全链路', pd.q === 3 && pd.total === 3 && pd.ready === true && pd.e === 0, JSON.stringify(pd));

  // 4) 导出页运行时写 xlsx 文件（导出独有的 writeFile 路径）
  page = await mp.reLaunch('/pkg-io-export/pages/export/export');
  await page.waitFor(1500);
  await mp.evaluate(() => {
    const p = getCurrentPages().pop();
    const rows = [['题型', '题干', '选项', '正确答案'], ['单选', '导出测试题', '甲|乙|丙', 'A']];
    p.saveAndOpen(rows, 'test_export');
  });
  await page.waitFor(900);
  const exportFileOk = await mp.evaluate(() => {
    try {
      wx.getFileSystemManager().accessSync(wx.env.USER_DATA_PATH + '/test_export.xlsx');
      return true;
    } catch (e) {
      return false;
    }
  });
  ok('导出页运行时写出 xlsx 文件', exportFileOk, '');

  console.log('\n完成');
  await mp.disconnect();
})().catch((e) => {
  console.error('失败：', (e && e.message) || e);
  process.exit(1);
});
