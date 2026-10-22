const repo = require('../../../utils/repo/index');
const xlsx = require('../../../utils/xlsx');
const importer = require('../../../core/importer');

// 「下载模板」用的示例数据（与桌面版 / importer 解析规则一致）
const SAMPLE = [
  ['单选', '示例：中国的首都是哪里？', '北京|上海|广州', 'A'],
  ['多选', '示例：下列哪些是水果？', '苹果|萝卜|香蕉|白菜', 'A,C'],
  ['判断', '示例：地球是球体。', '', '正确'],
];

function safeName(s) {
  return (
    String(s || '')
      .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
      .replace(/\s+$/, '')
      .slice(0, 40) || '导入题库'
  );
}

Page({
  data: {
    parsing: false,
    fileName: '',
    bankName: '',
    total: 0,
    errors: [],
    warnings: [],
    questions: [],
    ready: false,
    busy: false,
  },

  onLoad() {
    wx.setNavigationBarTitle({ title: '导入题库' });
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/banks/banks' }) });
  },

  // 用 SheetJS 现造一个模板并打开，让用户转发/保存到聊天后回填
  downloadTemplate() {
    const rows = [['题型', '题干', '选项', '正确答案']].concat(SAMPLE);
    const ab = xlsx.writeSheets([{ name: '题库', rows }]);
    const path = `${wx.env.USER_DATA_PATH}/随题导入模板.xlsx`;
    try {
      wx.getFileSystemManager().writeFileSync(path, ab);
    } catch (e) {
      wx.showToast({ title: '模板生成失败', icon: 'none' });
      return;
    }
    wx.openDocument({
      filePath: path,
      fileType: 'xlsx',
      showMenu: true,
      fail: () => wx.showToast({ title: '无法打开文档预览', icon: 'none' }),
    });
  },

  chooseFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['xlsx', 'xls'],
      success: (res) => this.readFile(res.tempFiles[0]),
      fail: () => {},
    });
  },

  readFile(file) {
    if (!file) return;
    this.setData({
      parsing: true,
      fileName: file.name || '',
      bankName: safeName((file.name || '').replace(/\.[^.]+$/, '')),
      ready: false,
      errors: [],
      warnings: [],
      questions: [],
      total: 0,
    });
    wx.getFileSystemManager().readFile({
      filePath: file.path,
      success: (r) => this.parse(r.data),
      fail: () => {
        this.setData({ parsing: false });
        wx.showToast({ title: '读取文件失败', icon: 'none' });
      },
    });
  },

  parse(buf) {
    let rows;
    try {
      rows = xlsx.readFirstSheet(buf);
    } catch (e) {
      this.setData({ parsing: false });
      wx.showToast({ title: '不是有效的 Excel 文件', icon: 'none' });
      return;
    }
    let parsed;
    try {
      parsed = importer.parseRows(rows);
    } catch (e) {
      this.setData({
        parsing: false,
        errors: [{ row: 0, msg: (e && e.message) || '解析失败' }],
        warnings: [],
        questions: [],
        total: 0,
        ready: false,
      });
      return;
    }
    const errors = parsed.errors || [];
    const warnings = parsed.warnings || [];
    const questions = parsed.questions || [];
    this.setData({
      parsing: false,
      total: questions.length,
      errors,
      warnings,
      questions,
      ready: questions.length > 0,
    });
    if (!questions.length) {
      wx.showToast({ title: '没有解析到任何题目', icon: 'none' });
    }
  },

  onName(e) {
    this.setData({ bankName: e.detail.value });
  },

  async createBank() {
    if (this.data.busy) return;
    if (!this.data.ready || !this.data.questions.length) {
      wx.showToast({ title: '请先选择有效的文件', icon: 'none' });
      return;
    }
    if (this.data.errors.length) {
      wx.showToast({ title: '存在错误，请修正后重试', icon: 'none' });
      return;
    }
    const name = (this.data.bankName || '').trim() || safeName(this.data.fileName);
    this.setData({ busy: true });
    wx.showLoading({ title: '创建中' });
    try {
      const r = await repo.createBank({
        name,
        questions: this.data.questions,
        sourceFile: this.data.fileName,
      });
      wx.hideLoading();
      wx.showToast({ title: '已创建：' + r.name, icon: 'success' });
      setTimeout(() => wx.reLaunch({ url: '/pages/banks/banks' }), 700);
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: (e && e.message) || '创建失败', icon: 'none' });
      this.setData({ busy: false });
    }
  },
});
