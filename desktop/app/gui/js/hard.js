/* 重难错题：按题库归集，可练习、可移除、可整份导出 */
(function () {
  var App = window.App;
  var data = null;
  var openBank = 0; // 当前展开的题库

  App.route('hard', function (view, q) {
    App.setTop('重难错题', '做题时点题目右侧「重难错题」即可归集到这里');
    App.setTopActions('');
    openBank = Number(q.bank || 0);
    view.innerHTML = '<div class="skeleton">正在读取…</div>';
    return load(view);
  });

  function load(view) {
    return App.call('hard_overview', {}).then(function (d) {
      data = d;
      render(view);
    });
  }

  function render(view) {
    var banks = data.banks || [];
    var html = '';

    html += '<div class="stats" style="margin-bottom:16px;grid-template-columns:repeat(3,1fr)">';
    html += stat('涉及题库', banks.length, '个');
    html += stat('重难错题', data.total || 0, '道', 'pri');
    html += stat('最多的一库', banks.length ? Math.max.apply(null, banks.map(function (b) { return b.total; })) : 0, '道');
    html += '</div>';

    if (!banks.length) {
      html +=
        '<div class="empty"><b>还没有重难错题</b>在练习、模拟考试或正式考试时，点题目右侧的「重难错题」勾选框，题目就会归集到这里，之后可以单独反复练。<div style="margin-top:14px"><button class="btn pri" id="go-do">去做题</button></div></div>';
      view.innerHTML = html;
      var b = App.$('#go-do', view);
      if (b)
        b.addEventListener('click', function () {
          App.go('/banks');
        });
      return;
    }

    banks.forEach(function (bk) {
      var expanded = openBank === bk.bank_id;
      html += '<div class="bank" style="margin-bottom:10px;align-items:flex-start">';
      html +=
        '<div class="info"><div class="nm">' +
        App.esc(bk.bank_name) +
        '</div><div class="sub"><span>单选 ' +
        bk.single +
        '</span><span>多选 ' +
        bk.multi +
        '</span><span>判断 ' +
        bk.judge +
        '</span><span>合计 <b>' +
        bk.total +
        '</b> 道</span><span>最近归集 ' +
        App.esc((bk.last_at || '').slice(0, 16)) +
        '</span></div></div>';
      html += '<div class="acts">';
      html += '<button class="btn sm pri" data-play="' + bk.bank_id + '">练习重难错题</button>';
      html += '<button class="btn sm" data-toggle="' + bk.bank_id + '">' + (expanded ? '收起' : '查看题目') + '</button>';
      html += '<button class="btn sm" data-export="' + bk.bank_id + '">导出</button>';
      html += '<button class="btn sm danger" data-clear="' + bk.bank_id + '" data-name="' + App.esc(bk.bank_name) + '">清空</button>';
      html += '</div></div>';
      html += '<div id="hard-list-' + bk.bank_id + '"></div>';
    });

    view.innerHTML = '<div style="max-width:1000px">' + html + '</div>';
    bind(view);

    if (openBank) {
      var box = App.$('#hard-list-' + openBank, view);
      if (box) showList(box, openBank);
    }
  }

  function stat(k, v, unit, cls) {
    return (
      '<div class="stat ' + (cls || '') + '"><div class="k">' + k + '</div><div class="v">' +
      App.esc(v) + '<small>' + (unit || '') + '</small></div></div>'
    );
  }

  function bind(view) {
    App.$$('[data-play]', view).forEach(function (b) {
      b.addEventListener('click', function () {
        App.go('/setup?bank=' + b.dataset.play + '&mode=practice&source=hard');
      });
    });

    App.$$('[data-export]', view).forEach(function (b) {
      b.addEventListener('click', function () {
        App.exportAny(
          'export_hard',
          { bank_id: Number(b.dataset.export), with_answer: true },
          null,
          '导出内容：该题库的全部重难错题 + 卷末参考答案页。'
        );
      });
    });

    App.$$('[data-toggle]', view).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = Number(b.dataset.toggle);
        var box = App.$('#hard-list-' + id, view);
        if (!box) return;
        if (box.dataset.open === '1') {
          box.dataset.open = '0';
          box.innerHTML = '';
          b.textContent = '查看题目';
          return;
        }
        b.textContent = '收起';
        showList(box, id);
      });
    });

    App.$$('[data-clear]', view).forEach(function (b) {
      b.addEventListener('click', function () {
        App.confirm(
          '清空重难错题',
          '确定把「' + b.dataset.name + '」的重难错题全部移除吗？<div class="small muted" style="margin-top:8px">只影响归集清单，不影响题库和已有成绩。</div>',
          '全部移除'
        ).then(function (yes) {
          if (!yes) return;
          App.call('remove_hard', { bank_id: Number(b.dataset.clear), all: true })
            .then(function () {
              App.toast('已清空', 'ok');
              openBank = 0;
              load(view);
            })
            .catch(function (e) {
              App.toast(e.message, 'bad');
            });
        });
      });
    });
  }

  function showList(box, bankId) {
    box.dataset.open = '1';
    box.innerHTML = '<div class="card pad" style="margin:0 0 16px"><div class="skeleton">加载题目…</div></div>';
    App.call('list_hard', { bank_id: bankId })
      .then(function (d) {
        var items = d.items || [];
        var html = '<div class="card" style="margin:0 0 16px"><div class="card-h" style="padding:14px 18px 0"><h3>重难错题（' + items.length + '）</h3></div>';
        html += '<div style="padding:6px 18px 14px">';
        items.forEach(function (it, i) {
          html += '<div class="wrong-item" style="margin-bottom:8px">';
          html += '<div class="st"><span class="qno">' + (i + 1) + '</span><span class="tag">' + App.esc(it.qtype_label) + '</span>';
          html += '<div style="flex:1 1 auto"></div>';
          html += '<button class="btn sm danger" data-remove="' + it.hid + '">移出重难错题</button>';
          html += '</div>';
          html += '<div style="margin-bottom:6px">' + App.esc(it.stem) + '</div>';
          if (it.options && it.options.length) {
            html += '<div class="opts-mini">';
            it.options.forEach(function (o) {
              html += '<span>' + App.esc(o.label) + '. ' + App.esc(o.text) + '</span>';
            });
            html += '</div>';
          }
          html += '<div class="small"><span class="muted">正确答案：</span><b style="color:#0f7a55">' + App.esc(it.answer_text) + '</b></div>';
          html += '</div>';
        });
        html += '</div></div>';
        box.innerHTML = html;

        App.$$('[data-remove]', box).forEach(function (b) {
          b.addEventListener('click', function () {
            b.disabled = true;
            App.call('remove_hard', { hid: Number(b.dataset.remove) })
              .then(function () {
                App.toast('已移出重难错题', 'ok');
                openBank = bankId;
                load(box.closest('.view') || document.getElementById('view'));
              })
              .catch(function (e) {
                b.disabled = false;
                App.toast(e.message, 'bad');
              });
          });
        });
      })
      .catch(function (e) {
        box.innerHTML = '<div class="empty">加载失败：' + App.esc(e.message) + '</div>';
      });
  }
})();
