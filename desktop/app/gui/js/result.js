/* 结果页：分数、正确率、错题 */
(function () {
  var App = window.App;

  App.route('result', function (view, q) {
    var sid = Number(q.session || 0);
    App.setTop('做题结果', '');
    App.setTopActions('');
    view.className = 'view';
    view.innerHTML = '<div class="skeleton">正在评卷…</div>';
    if (!sid) {
      view.innerHTML = '<div class="empty"><b>没有可显示的结果</b></div>';
      return;
    }

    return App.call('get_result', { session_id: sid }).then(function (r) {
      render(view, r, q);
    });
  });

  function render(view, r, q) {
    var acc = r.accuracy || 0;
    var html = '';
    html += '<div class="card pad" style="margin-bottom:16px">';
    html += '<div class="result-hero">';
    html +=
      '<div class="score-ring" style="--p:' +
      Math.max(0, Math.min(100, acc)) +
      '%"><div class="in"><div class="n" style="color:' +
      (acc >= 80 ? '#0f7a55' : acc >= 60 ? '#1f5fd0' : '#c62828') +
      '">' +
      App.fmtScore(r.score) +
      '</div><div class="u">得分 / ' +
      App.fmtScore(r.score_total) +
      '</div></div></div>';

    html += '<div style="flex:1 1 320px;min-width:260px">';
    html += '<div style="font-size:17px;font-weight:600;margin-bottom:4px">' + App.esc(r.bank_name) + ' · ' + App.esc(r.mode_label) + '</div>';
    html += '<div class="small muted" style="margin-bottom:12px">';
    if (r.candidate) html += '考生：' + App.esc(r.candidate) + '　';
    html += '交卷时间：' + App.esc((r.submitted_at || '').slice(0, 19)) + '　用时：' + App.fmtDur(r.duration_sec) + '</div>';
    html += '<div class="kv">';
    html += '<div>总题数 <b>' + r.total + '</b></div>';
    html += '<div>正确 <b class="ok">' + r.right + '</b></div>';
    html += '<div>错误 <b class="bad">' + r.wrong + '</b></div>';
    html += '<div>漏答 <b class="' + (r.missing ? 'bad' : '') + '">' + r.missing + '</b></div>';
    html += '<div>正确率 <b>' + acc + '%</b></div>';
    html += '<div>满分 <b>' + App.fmtScore(r.score_total) + '</b> 分</div>';
    html += '</div></div></div></div>';

    html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">';
    html += '<button class="btn pri" id="btn-wrong">查看错题（' + (r.wrong_items ? r.wrong_items.length : r.wrong + r.missing) + '）</button>';
    html += '<button class="btn" id="btn-export">导出试卷</button>';
    html += '<button class="btn" id="btn-home">返回首页</button>';
    if (r.mode === 'practice') html += '<button class="btn" id="btn-bank">换个题库再练</button>';
    html += '</div>';

    html += '<div id="wrong-box"></div>';
    view.innerHTML = html;

    var wrongBox = App.$('#wrong-box', view);
    App.$('#btn-wrong', view).addEventListener('click', function () {
      if (wrongBox.dataset.open === '1') {
        wrongBox.dataset.open = '0';
        wrongBox.innerHTML = '';
        return;
      }
      wrongBox.dataset.open = '1';
      wrongBox.innerHTML = '<div class="skeleton">加载错题…</div>';
      var list = r.wrong_items;
      var go = function (items) {
        App.loadHardSet(r.bank_id).then(function () {
          renderWrong(wrongBox, items || [], r.session_id);
        });
      };
      if (!list) {
        App.call('get_result', { session_id: r.session_id }).then(function (d) {
          go(d.wrong_items || []);
        });
      } else {
        go(list);
      }
    });

    App.$('#btn-export', view).addEventListener('click', function () {
      App.exportPaper(r.session_id, null);
    });
    App.$('#btn-home', view).addEventListener('click', function () {
      App.go('/home');
    });
    var bb = App.$('#btn-bank', view);
    if (bb)
      bb.addEventListener('click', function () {
        App.go('/banks');
      });
  }

  function renderWrong(box, list, sid) {
    if (!list.length) {
      box.innerHTML = '<div class="empty"><b>没有错题</b>全部答对了，漂亮。</div>';
      return;
    }
    var html = '';
    list.forEach(function (w) {
      html += '<div class="wrong-item">';
      html += '<div class="st"><span class="qno">' + w.pos + '</span><span class="tag">' + App.esc(w.qtype_label) + '</span>';
      if (w.missing) html += '<span class="tag bad">未作答</span>';
      html += '<div style="flex:1 1 auto"></div>';
      html += App.hardLabel(w.pos, App.isHard(w.qid));
      html += '</div>';
      html += '<div style="margin-bottom:8px">' + App.esc(w.stem) + '</div>';
      html += '<div class="opts-mini">';
      w.options.forEach(function (o, i) {
        var mark = '';
        if (w.answer_disp.indexOf(i) >= 0) mark = '<span style="color:#0f7a55;font-weight:600"> ✓</span>';
        else if (w.chosen.indexOf(i) >= 0) mark = '<span style="color:#c62828;font-weight:600"> ✗</span>';
        html += '<span>' + App.esc(o.label) + '. ' + App.esc(o.text) + mark + '</span>';
      });
      html += '</div>';
      html += '<div class="small"><span class="muted">你的作答：</span>';
      html += w.chosen_text ? '<b style="color:#c62828">' + App.esc(w.chosen_text) + '</b>' : '<span class="muted">未作答</span>';
      html += '　<span class="muted">正确答案：</span><b style="color:#0f7a55">' + App.esc(w.answer_text) + '</b></div>';
      html += '</div>';
    });
    box.innerHTML = html;

    if (sid) {
      App.bindHardBoxes(box, sid, function (pos) {
        var it = list.filter(function (x) {
          return x.pos === pos;
        })[0];
        return it ? it.qid : null;
      });
    }
  }
})();
