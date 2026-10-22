/* 练习模式：一题一屏，作答即判 */
(function () {
  var App = window.App;
  var S = null;
  var idx = 0;
  var state = {}; // pos -> {pick:[], graded, correct, answerDisp, answerText}

  function loadSession() {
    if (App.current && App.current.mode === 'practice') return App.current;
    try {
      var raw = sessionStorage.getItem('suiti_session');
      if (raw) {
        var d = JSON.parse(raw);
        if (d && d.mode === 'practice') return d;
      }
    } catch (e) {}
    return null;
  }

  App.route('practice', function (view, q) {
    var data = loadSession();
    if (!data) {
      App.setTop('练习模式', '');
      App.setTopActions('');
      view.innerHTML =
        '<div class="empty"><b>没有正在进行的练习</b>请先选择题库并生成题目。<div style="margin-top:14px"><button class="btn pri" id="e1">去选择题库</button></div></div>';
      App.$('#e1', view).addEventListener('click', function () {
        App.go('/banks');
      });
      return;
    }
    S = data;
    idx = 0;
    state = {};
    S.items.forEach(function (it) {
      state[it.pos] = { pick: [], graded: false, correct: null, answerDisp: [], answerText: '' };
    });
    App.setTop(App.esc(S.bank_name) + ' · 练习模式', '');
    App.setTopActions(
      '<button class="btn sm" id="act-export">导出试卷</button><button class="btn sm danger" id="act-end">结束练习</button>'
    );
    App.$('#act-export').addEventListener('click', function () {
      App.exportPaper(S.session_id, null);
    });
    App.$('#act-end').addEventListener('click', function () {
      finish();
    });
    App.loadHardSet(S.bank_id).then(function () {
      render(view);
    });
  });

  function answeredCount() {
    var n = 0,
      r = 0;
    S.items.forEach(function (it) {
      var s = state[it.pos];
      if (s.graded) {
        n++;
        if (s.correct) r++;
      }
    });
    return { done: n, right: r };
  }

  function render(view) {
    var it = S.items[idx];
    var st = state[it.pos];
    var c = answeredCount();
    App.setTop(
      App.esc(S.bank_name) + ' · 练习模式',
      '<span class="muted">第 ' + (idx + 1) + ' / ' + S.total + ' 题　已答 ' + c.done + '　正确 ' + c.right + '</span>'
    );

    var html = '<div class="qwrap"><div class="qcard">';
    html += '<div class="qhead"><span class="qno">' + it.pos + '</span>';
    html += '<span class="tag">' + App.typeLabel[it.qtype] + '</span>';
    if (it.qtype === 'multi') html += '<span class="small muted">多选，选好后点「完成」</span>';
    html += '<div style="flex:1 1 auto"></div>';
    html += App.hardLabel(it.pos, App.isHard(it.qid));
    html += '</div>';
    html += '<div class="qstem">' + App.esc(it.stem) + '</div>';
    html += '<div class="qopts">';
    it.options.forEach(function (o, i) {
      var cls = 'opt';
      if (st.graded) {
        cls += ' locked';
        if (st.answerDisp.indexOf(i) >= 0) cls += ' correct';
        else if (st.pick.indexOf(i) >= 0) cls += ' wrong';
      } else if (st.pick.indexOf(i) >= 0) cls += ' sel';
      html +=
        '<div class="' +
        cls +
        '" data-opt="' +
        i +
        '"><div class="k">' +
        App.esc(o.label) +
        '</div><div class="v">' +
        App.esc(o.text) +
        '</div></div>';
    });
    html += '</div>';

    if (st.graded) {
      html +=
        '<div class="fb ' +
        (st.correct ? 'ok' : 'bad') +
        '">' +
        (st.correct ? '<b>回答正确</b>' : '<b>回答错误</b>') +
        '<span class="spacer" style="flex:1"></span><span>正确答案：<b>' +
        App.esc(st.answerText) +
        '</b></span></div>';
    }

    html += '<div class="qfoot">';
    html += '<button class="btn" id="prev"' + (idx === 0 ? ' disabled' : '') + '>上一题</button>';
    html += '<div class="spacer"></div>';
    if (it.qtype === 'multi' && !st.graded) {
      html += '<button class="btn pri" id="done"' + (st.pick.length ? '' : ' disabled') + '>完成（' + st.pick.length + ' 项）</button>';
    } else if (idx < S.total - 1) {
      html += '<button class="btn ' + (st.graded ? 'pri' : '') + '" id="next">下一题</button>';
    } else if (st.graded || idx === S.total - 1) {
      html += '<button class="btn pri" id="fin">' + (idx === S.total - 1 ? '完成练习并查看结果' : '下一题') + '</button>';
    }
    html += '</div></div></div>';

    view.innerHTML = html;
    bind(view, it, st);
  }

  function bind(view, it, st) {
    App.bindHardBoxes(view, S.session_id, function (pos) {
      var x = S.items.filter(function (i) {
        return i.pos === pos;
      })[0];
      return x ? x.qid : null;
    });

    App.$$('[data-opt]', view).forEach(function (el) {
      el.addEventListener('click', function () {
        if (st.graded) return;
        var i = Number(el.dataset.opt);
        if (it.qtype === 'multi') {
          var k = st.pick.indexOf(i);
          if (k >= 0) st.pick.splice(k, 1);
          else st.pick.push(i);
          render(view);
        } else {
          st.pick = [i];
          submit(view, it, st);
        }
      });
    });

    var prev = App.$('#prev', view);
    if (prev)
      prev.addEventListener('click', function () {
        if (idx > 0) {
          idx--;
          render(view);
        }
      });

    var done = App.$('#done', view);
    if (done)
      done.addEventListener('click', function () {
        submit(view, it, st);
      });

    var next = App.$('#next', view);
    if (next)
      next.addEventListener('click', function () {
        if (idx < S.total - 1) {
          idx++;
          render(view);
        }
      });

    var fin = App.$('#fin', view);
    if (fin)
      fin.addEventListener('click', function () {
        if (idx < S.total - 1) {
          idx++;
          render(view);
        } else {
          finish();
        }
      });
  }

  function submit(view, it, st) {
    if (!st.pick.length) return;
    var chosen = st.pick.slice().sort(function (a, b) {
      return a - b;
    });
    App.call('answer', { session_id: S.session_id, pos: it.pos, chosen: chosen, submit: true })
      .then(function (d) {
        st.graded = true;
        st.correct = !!d.is_correct;
        st.answerDisp = d.answer_disp || [];
        st.answerText = d.answer_text || '';
        render(view);
      })
      .catch(function (e) {
        App.toast(e.message, 'bad');
      });
  }

  function finish() {
    var c = answeredCount();
    var left = S.total - c.done;
    var msg =
      left > 0
        ? '还有 <b>' + left + '</b> 题没有作答，结束后按已完成情况统计（练习模式不计漏答）。确定结束吗？'
        : '确定结束本次练习并查看结果吗？';
    App.confirm('结束练习', msg, '结束并查看结果').then(function (yes) {
      if (!yes) return;
      App.call('submit_session', { session_id: S.session_id })
        .then(function (d) {
          try {
            sessionStorage.removeItem('suiti_session');
          } catch (e) {}
          App.current = null;
          App.go('/result?session=' + S.session_id + '&from=practice&mode=practice');
        })
        .catch(function (e) {
          App.toast(e.message, 'bad');
        });
    });
  }
})();
