/* 记录页：做题记录（练习+考试）/ 考试记录（仅正式考试） */
(function () {
  var App = window.App;
  var tab = 'practice';

  App.route('records', function (view, q) {
    tab = q.tab === 'exam' ? 'exam' : 'practice';
    App.setTop(tab === 'exam' ? '考试记录' : '做题记录', '');
    App.setTopActions('');
    view.className = 'view';
    paint(view);
  });

  function paint(view) {
    view.innerHTML =
      '<div class="tabs"><button data-tab="practice" class="' +
      (tab === 'practice' ? 'on' : '') +
      '">做题记录</button><button data-tab="exam" class="' +
      (tab === 'exam' ? 'on' : '') +
      '">考试记录</button></div><div id="tab-body"><div class="skeleton">正在统计…</div></div>';

    App.$$('[data-tab]', view).forEach(function (b) {
      b.addEventListener('click', function () {
        if (tab === b.dataset.tab) return;
        tab = b.dataset.tab;
        App.setTop(tab === 'exam' ? '考试记录' : '做题记录', '');
        paint(view);
      });
    });

    var body = App.$('#tab-body', view);
    if (tab === 'practice') loadPractice(body);
    else loadExam(body);
  }

  function statCard(k, v, unit, cls) {
    return (
      '<div class="stat ' +
      (cls || '') +
      '"><div class="k">' +
      k +
      '</div><div class="v">' +
      App.esc(v) +
      '<small>' +
      (unit || '') +
      '</small></div></div>'
    );
  }

  function loadPractice(body) {
    App.call('get_records', {})
      .then(function (d) {
        var o = d.overall || {};
        var rows = d.by_bank || [];
        var html = '<div class="stats" style="margin-bottom:16px">';
        html += statCard('题库数量', o.bank_total || 0, '个');
        html += statCard('做题数量', o.done_cnt || 0, '道', 'pri');
        html += statCard('正确', o.right || 0, '道', 'ok');
        html += statCard('错误', o.wrong || 0, '道', 'bad');
        html += statCard('漏答', o.missing || 0, '道');
        html += statCard('正确率', o.accuracy == null ? 0 : o.accuracy, '%', 'pri');
        html += '</div>';

        if (!rows.length) {
          html += '<div class="empty"><b>还没有做题记录</b>做一套练习或考一次试，这里就会自动统计。<div style="margin-top:14px"><button class="btn pri" id="go1">去做题</button></div></div>';
          body.innerHTML = html;
          var g = App.$('#go1', body);
          if (g)
            g.addEventListener('click', function () {
              App.go('/banks');
            });
          return;
        }

        html += '<div class="card"><table class="tbl"><thead><tr>';
        html +=
          '<th>题库</th><th class="num">做题</th><th class="num">正确</th><th class="num">错误</th><th class="num">漏答</th><th class="num">正确率</th><th>最近一次</th></tr></thead><tbody>';
        rows.forEach(function (r) {
          html +=
            '<tr><td class="name">' +
            App.esc(r.bank_name) +
            '</td><td class="num">' +
            r.done_cnt +
            '</td><td class="num" style="color:#0f7a55">' +
            r.right +
            '</td><td class="num" style="color:#c62828">' +
            r.wrong +
            '</td><td class="num">' +
            r.missing +
            '</td><td class="num"><b>' +
            r.accuracy +
            '%</b></td><td class="muted small">' +
            App.esc((r.last_at || '').slice(0, 16)) +
            '</td></tr>';
        });
        html += '</tbody></table></div>';
        html +=
          '<div class="small muted" style="margin-top:10px">口径：做题数量 = 已判定对错的题数（练习与考试累加）；漏答仅统计模拟考试与正式考试中未作答的题；正确率 = 正确 ÷ 做题数量。</div>';
        body.innerHTML = html;
      })
      .catch(function (e) {
        body.innerHTML = '<div class="empty"><b>统计失败</b>' + App.esc(e.message) + '</div>';
      });
  }

  function loadExam(body) {
    App.call('list_exam_records', { page: 1, size: 100 })
      .then(function (d) {
        var o = d.overall || {};
        var rows = d.rows || [];
        var html = '<div class="stats" style="margin-bottom:16px">';
        html += statCard('题库', o.bank_cnt || 0, '个');
        html += statCard('题量', o.total_q || 0, '道', 'pri');
        html += statCard('正确', o.right || 0, '道', 'ok');
        html += statCard('错误', o.wrong || 0, '道', 'bad');
        html += statCard('漏答', o.missing || 0, '道');
        html += statCard('正确率', o.accuracy == null ? 0 : o.accuracy, '%', 'pri');
        html += '</div>';

        if (!rows.length) {
          html +=
            '<div class="empty"><b>还没有正式考试记录</b>只有「正式考试」的成绩会计入这里（模拟考试不计入）。<div style="margin-top:14px"><button class="btn pri" id="go2">去考试</button></div></div>';
          body.innerHTML = html;
          var g = App.$('#go2', body);
          if (g)
            g.addEventListener('click', function () {
              App.go('/banks');
            });
          return;
        }

        html += '<div class="card"><table class="tbl"><thead><tr>';
        html +=
          '<th>交卷时间</th><th>考生信息</th><th>题库</th><th class="num">题量</th><th class="num">正确</th><th class="num">错误</th><th class="num">漏答</th><th class="num">正确率</th><th class="num">得分 / 满分</th><th></th></tr></thead><tbody>';
        rows.forEach(function (r) {
          html +=
            '<tr class="clickable" data-session="' +
            r.session_id +
            '"><td class="small">' +
            App.esc((r.submitted_at || r.started_at || '').slice(0, 16)) +
            '</td><td>' +
            (r.candidate ? App.esc(r.candidate) : '<span class="muted">—</span>') +
            '</td><td class="name">' +
            App.esc(r.bank_name) +
            '</td><td class="num">' +
            r.total +
            '</td><td class="num" style="color:#0f7a55">' +
            r.right +
            '</td><td class="num" style="color:#c62828">' +
            r.wrong +
            '</td><td class="num">' +
            r.missing +
            '</td><td class="num"><b>' +
            r.accuracy +
            '%</b></td><td class="num"><b>' +
            App.fmtScore(r.score) +
            '</b> / ' +
            App.fmtScore(r.score_total) +
            '</td><td class="small" style="text-align:right"><span class="tag">看错题</span></td></tr>';
        });
        html += '</tbody></table></div>';
        html += '<div class="small muted" style="margin-top:10px">每次正式考试一行；点任意一行可查看该次考试的错题明细。</div>';
        body.innerHTML = html;

        App.$$('[data-session]', body).forEach(function (tr) {
          tr.addEventListener('click', function () {
            showDetail(Number(tr.dataset.session));
          });
        });
      })
      .catch(function (e) {
        body.innerHTML = '<div class="empty"><b>统计失败</b>' + App.esc(e.message) + '</div>';
      });
  }

  function showDetail(sid) {
    App.call('get_exam_detail', { session_id: sid })
      .then(function (r) {
        var list = r.wrong_items || [];
        var head =
          '<div class="kv" style="margin-bottom:12px"><div>得分 <b>' +
          App.fmtScore(r.score) +
          '</b> / ' +
          App.fmtScore(r.score_total) +
          '</div><div>正确 <b class="ok">' +
          r.right +
          '</b></div><div>错误 <b class="bad">' +
          r.wrong +
          '</b></div><div>漏答 <b>' +
          r.missing +
          '</b></div></div>';
        var items = '';
        if (!list.length) items = '<div class="small muted">本次考试没有错题。</div>';
        list.forEach(function (w) {
          items +=
            '<div style="padding:10px 0;border-bottom:1px dashed #e3ebf5"><div style="margin-bottom:5px"><span class="qno">' +
            w.pos +
            '</span> <span class="tag">' +
            App.esc(w.qtype_label) +
            '</span>' +
            (w.missing ? ' <span class="tag bad">未作答</span>' : '') +
            ' ' +
            App.esc(w.stem) +
            '</div><div class="small"><span class="muted">作答：</span>' +
            (w.chosen_text ? '<b style="color:#c62828">' + App.esc(w.chosen_text) + '</b>' : '<span class="muted">未作答</span>') +
            '　<span class="muted">正确答案：</span><b style="color:#0f7a55">' +
            App.esc(w.answer_text) +
            '</b></div></div>';
        });
        App.modal({
          title: '考试详情 · ' + App.esc((r.submitted_at || '').slice(0, 16)),
          body: head + '<div style="max-height:52vh;overflow:auto">' + items + '</div>',
          cancelText: null,
          okText: '关闭',
        });
      })
      .catch(function (e) {
        App.toast(e.message, 'bad');
      });
  }
})();
