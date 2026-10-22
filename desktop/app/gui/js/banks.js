/* 我的题库：模板下载、导入、列表、删除 */
(function () {
  var App = window.App;
  var pendingMode = '';

  App.route('banks', function (view, q) {
    pendingMode = q.mode || '';
    var title = pendingMode ? '选择题库 · ' + (App.modeLabel[pendingMode] || '') : '我的题库';
    App.setTop(title, pendingMode ? '点「进入」选择该题库后去设置' : '');
    App.setTopActions('');
    load(view);
  });

  function load(view) {
    view.innerHTML = '<div class="skeleton">正在读取题库…</div>';
    return App.call('list_banks', {}).then(function (d) {
      render(view, d.banks || []);
    });
  }

  function render(view, banks) {
    var html = '';
    html +=
      '<div class="card pad" style="margin-bottom:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">' +
      '<div style="flex:1 1 320px;min-width:240px"><div style="font-weight:600;margin-bottom:3px">题库导入</div>' +
      '<div class="small muted">先下载 Excel 模板，按说明填好题目后导入。一个文件生成一个题库，选项数量不限。</div></div>' +
      '<button class="btn" id="btn-tpl">下载导入模板</button>' +
      '<button class="btn pri" id="btn-import">导入题库文件</button>' +
      '</div>';

    if (!banks.length) {
      html +=
        '<div class="empty"><b>题库是空的</b>下载模板 → 填入题型、题干、选项、正确答案 → 导入即可开始做题。</div>';
      view.innerHTML = html;
      bind(view);
      return;
    }

    html += '<div class="bank-list">';
    banks.forEach(function (b) {
      html +=
        '<div class="bank"><div class="info"><div class="nm">' +
        App.esc(b.name) +
        '</div><div class="sub">' +
        '<span>单选 ' +
        b.counts.single +
        '</span><span>多选 ' +
        b.counts.multi +
        '</span><span>判断 ' +
        b.counts.judge +
        '</span><span>合计 <b>' +
        b.counts.total +
        '</b> 题</span><span>导入于 ' +
        App.esc((b.created_at || '').slice(0, 16)) +
        '</span></div></div>' +
        '<div class="acts">' +
        '<button class="btn sm" data-mode="practice" data-bank="' +
        b.id +
        '">练习</button>' +
        '<button class="btn sm" data-mode="mock" data-bank="' +
        b.id +
        '">模拟</button>' +
        '<button class="btn sm pri" data-mode="exam" data-bank="' +
        b.id +
        '">正式考试</button>' +
        '<button class="btn sm danger" data-del="' +
        b.id +
        '" data-name="' +
        App.esc(b.name) +
        '">删除</button>' +
        '</div></div>';
    });
    html += '</div>';
    view.innerHTML = html;
    bind(view);
  }

  function bind(view) {
    var tpl = App.$('#btn-tpl', view);
    if (tpl)
      tpl.addEventListener('click', function () {
        tpl.disabled = true;
        App.call('download_template', {})
          .then(function (d) {
            if (d.cancelled) return;
            App.toast('模板已保存：' + d.filename, 'ok');
            App.modal({
              title: '模板已保存',
              body:
                '<div class="small" style="word-break:break-all">' +
                App.esc(d.path) +
                '</div><div class="small muted" style="margin-top:10px">表格里已经有 4 行示例和一份「填写说明」，照着改就行。</div>',
              cancelText: '知道了',
              okText: '打开所在文件夹',
              onOk: function () {
                App.call('open_folder', { path: d.path }).catch(function () {});
              },
            });
          })
          .catch(function (e) {
            App.toast(e.message, 'bad');
          })
          .then(function () {
            tpl.disabled = false;
          });
      });

    var imp = App.$('#btn-import', view);
    if (imp)
      imp.addEventListener('click', function () {
        imp.disabled = true;
        imp.innerHTML = '<span class="spin"></span> 导入中…';
        App.call('pick_and_import_bank', {})
          .then(function (d) {
            if (d.cancelled) return;
            showImportResult(d.results || [], view);
          })
          .catch(function (e) {
            App.toast(e.message, 'bad');
          })
          .then(function () {
            imp.disabled = false;
            imp.textContent = '导入题库文件';
          });
      });

    App.$$('[data-mode]', view).forEach(function (b) {
      b.addEventListener('click', function () {
        App.go('/setup?bank=' + b.dataset.bank + '&mode=' + b.dataset.mode);
      });
    });

    App.$$('[data-del]', view).forEach(function (b) {
      b.addEventListener('click', function () {
        App.confirm(
          '删除题库',
          '确定删除「' + App.esc(b.dataset.name) + '」吗？<div class="small muted" style="margin-top:8px">题库删除后不影响已有的做题记录与考试成绩。</div>',
          '删除'
        ).then(function (yes) {
          if (!yes) return;
          App.call('delete_bank', { bank_id: Number(b.dataset.del) })
            .then(function () {
              App.toast('已删除', 'ok');
              load(view);
            })
            .catch(function (e) {
              App.toast(e.message, 'bad');
            });
        });
      });
    });
  }

  function showImportResult(results, view) {
    var okCount = results.filter(function (r) {
      return r.ok;
    }).length;
    var body = '';
    results.forEach(function (r) {
      body += '<div style="padding:10px 0;border-bottom:1px dashed #e3ebf5">';
      if (r.ok) {
        body +=
          '<div><span class="tag ok">导入成功</span> <b>' +
          App.esc(r.name) +
          '</b>' +
          (r.renamed ? ' <span class="tag warn">重名已自动改名</span>' : '') +
          '</div><div class="small muted" style="margin-top:5px">单选 ' +
          r.counts.single +
          ' · 多选 ' +
          r.counts.multi +
          ' · 判断 ' +
          r.counts.judge +
          ' · 合计 ' +
          r.counts.total +
          ' 题</div>';
      } else {
        body +=
          '<div><span class="tag bad">导入失败</span> <b>' +
          App.esc(r.file) +
          '</b></div>';
        (r.errors || []).slice(0, 8).forEach(function (e) {
          body +=
            '<div class="small" style="color:#c62828;margin-top:4px">' +
            (e.row ? '第 ' + e.row + ' 行：' : '') +
            App.esc(e.msg) +
            '</div>';
        });
        if (r.error_count && r.error_count > 8) {
          body += '<div class="small muted" style="margin-top:4px">…共 ' + r.error_count + ' 处问题</div>';
        }
      }
      if (r.warnings && r.warnings.length) {
        r.warnings.slice(0, 5).forEach(function (w) {
          body +=
            '<div class="small" style="color:#a15c07;margin-top:4px">提示：' +
            (w.row ? '第 ' + w.row + ' 行：' : '') +
            App.esc(w.msg) +
            '</div>';
        });
      }
      body += '</div>';
    });
    if (!body) body = '<div class="muted">没有选择文件</div>';

    App.modal({
      title: okCount ? '导入完成' : '导入失败',
      body: body,
      cancelText: null,
      okText: '知道了',
    }).then(function () {
      load(view);
    });
  }
})();
