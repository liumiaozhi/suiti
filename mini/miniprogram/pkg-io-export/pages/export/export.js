const repo = require('../../../utils/repo/index');
const xlsx = require('../../../utils/xlsx');

const QT = { single: '单选', multi: '多选', judge: '判断' };

/** 卷面题目 -> 与导入模板一致的二维数组（题型|题干|选项|正确答案），便于二次导入。 */
function itemsToRows(items) {
  const rows = [['题型', '题干', '选项', '正确答案']];
  for (const it of items || []) {
    const opts = (it.options_disp || it.options || []).slice();
    const optStr = it.qtype === 'judge' ? '正确|错误' : opts.join('|');
    rows.push([QT[it.qtype] || it.qtype, it.stem, optStr, it.answer_text || '']);
  }
  return rows;
}

function safeName(s) {
  return (
    String(s || '试卷')
      .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
      .replace(/\s+$/, '')
      .slice(0, 60) || '试卷'
  );
}

function stamp() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
}

Page({
  data: { loading: true, kind: '', name: '', err: '' },

  onLoad(q) {
    wx.setNavigationBarTitle({ title: '导出' });
    const kind = q.kind || 'paper';
    this.setData({ kind });
    if (kind === 'paper') this.exportPaper(q.sid);
    else if (kind === 'hard') this.exportHard(q.bank);
    else this.setData({ loading: false, err: '未知的导出类型' });
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/home' }) });
  },

  async exportPaper(sid) {
    if (!sid) {
      this.setData({ loading: false, err: '缺少会话参数' });
      return;
    }
    try {
      const items = await repo.getSessionItems(sid);
      const head = await repo.getSession(sid);
      if (!items || !items.length) {
        this.setData({ loading: false, err: '该会话没有可导出的题目' });
        return;
      }
      const rows = itemsToRows(items);
      const name = (head && head.bankName) || '试卷';
      this.saveAndOpen(rows, safeName(name) + '_' + stamp());
    } catch (e) {
      this.setData({ loading: false, err: (e && e.message) || '导出失败' });
    }
  },

  async exportHard(bankId) {
    if (!bankId) {
      this.setData({ loading: false, err: '缺少题库参数' });
      return;
    }
    try {
      const r = await repo.listHard({ bankId });
      const items = (r.items || []).map((x) => ({
        qtype: x.qtype,
        stem: x.stem,
        options_disp: (x.options || []).map((o) => (typeof o === 'string' ? o : o.text)),
        answer_text: x.answer_text,
      }));
      if (!items.length) {
        this.setData({ loading: false, err: '该题库还没有重难错题' });
        return;
      }
      const rows = itemsToRows(items);
      this.saveAndOpen(rows, safeName(r.bankName || '重难错题') + '_重难_' + stamp());
    } catch (e) {
      this.setData({ loading: false, err: (e && e.message) || '导出失败' });
    }
  },

  saveAndOpen(rows, baseName) {
    const ab = xlsx.writeSheets([{ name: '题库', rows }]);
    const path = `${wx.env.USER_DATA_PATH}/${baseName}.xlsx`;
    wx.getFileSystemManager().writeFile({
      filePath: path,
      data: ab,
      success: () => {
        this.setData({ loading: false, name: baseName });
        wx.openDocument({
          filePath: path,
          fileType: 'xlsx',
          showMenu: true,
          fail: () => wx.showToast({ title: '已生成，但无法打开预览', icon: 'none' }),
        });
      },
      fail: () => this.setData({ loading: false, err: '写入文件失败' }),
    });
  },
});
