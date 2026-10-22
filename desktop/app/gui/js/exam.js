/* 模拟考试 / 正式考试：整卷作答 + 右侧题号面板 + 标记 */
(function () {
  var App = window.App;
  var S = null;
  var state = {}; // pos -> {pick:[], marked:bool, saved:bool}

  function loadSession(mode) {
    if (App.current && App.current.mode === mode) return App.current;
    try {
      var raw = sessionStorage.getItem('suiti_session');
      if (raw) {
        var d = JSON.parse(raw);
        if (d && d.mode === mode) return d;
      }
    } catch (e) {}
    return null;
  }

  function routeFor(mode) {
    App.route(mode === 'exam' ? 'exam' : 'mock', function (view) {
      var data = loadSession(mode);
      if (!data) {
        App.setTop(App.modeLabel[mode], '');
        App.setTopActions('');
        view.innerHTML =
          '<div class="empty"><b>没有正在进行的' +
          App.modeLabel[mode] +
          '</b>请先选择题库并生成题目。<div style="margin-top:14px"><button class="btn pri" id="e1">去选择题库</button></div></div>';
        App.$('#e1', view).addEventListener('click', function () {
          App.go('/banks');
        });
        return;
      }
      S = data;
      state = {};
      S.items.forEach(function (it) {
        state[it.pos] = { pick: [], marked: false, saved: false };
      });
      view.className = 'view nopad';
      App.setTop(App.esc(S.bank_name) + ' · ' + App.modeLabel[mode], '');
      App.setTopActions(
        '<span class="small muted" id="top-count">已答 0 / ' + S.total + '</span>' +
          '<button class="btn sm" id="act-export">导出试卷</button>' +
          '<button class="btn sm pri" id="act-submit">交卷</button>'
      );
      App.$('#act-export').addEventListener('click', function () {
        var left = S.total - doneCount();
        App.exportPaper(
          S.session_id,
          left > 0 ? '本次考试尚未交卷（还有 ' + left + ' 题未答），导出的文件包含参考答案页，请勿在考试中发给考生。' : null
        );
      });
      App.$('#act-submit').addEventListener('click', doSubmit);
      App.loadHardSet(S.bank_id).then(function () {
        render(view);
      });
    });
  }

  routeFor('mock');
  routeFor('exam');

  function doneCount() {
    var n = 0;
    S.items.forEach(function (it) {
      if (state[it.pos].pick.length) n++;
    });
    return n;
  }

  function groupByType() {
    var out = [];
    ['single', 'multi', 'judge'].forEach(function (t) {
      var items = S.items.filter(function (it) {
        return it.qtype === t;
      });
      if (items.length) out.push({ type: t, items: items });
    });
    return out;
  }

  function render(view) {
    var groups = groupByType();
    var cn = ['一', '二', '三', '四', '五'];
    var paper = '<div class="qwrap" style="max-width:900px">';
    groups.forEach(function (g, gi) {
      paper +=
        '<div style="display:flex;align-items:center;gap:10px;margin:6px 0 12px"><span style="font-weight:600">' +
        (cn[gi] || gi + 1) +
        '、' +
        App.typeName[g.type] +
        '</span><span class="small muted">共 ' +
        g.items.length +
        ' 题</span></div>';
      g.items.forEach(function (it) {
        paper += cardHtml(it);
      });
    });
    paper += '</div>';

    var nav = '<div class="nav-title"><span>题号导航</span><span id="nav-count">已答 0 / ' + S.total + '</span></div>';
    groups.forEach(function (g, gi) {
      nav += '<div class="nav-group"><h4>' + (cn[gi] || gi + 1) + '、' + App.typeName[g.type] + '<span>' + g.items.length + '</span></h4><div class="boxes">';
      g.items.forEach(function (it) {
        nav += '<button class="qbox" data-goto="' + it.pos + '">' + it.pos + '</button>';
      });
      nav += '</div></div>';
    });
    nav +=
      '<div class="nav-legend"><div><i></i>未作答</div><div><i class="b"></i>已作答</div><div><i class="m"></i>已标记（黄色感叹号）</div></div>';

    view.innerHTML = '<div class="exam"><div class="paper" id="paper">' + paper + '</div><aside class="side-nav" id="nav">' + nav + '</aside></div>';

    bindPaper(view);
    bindNav(view);
    refreshNav();
    App.bindHardBoxes(App.$('#paper', view), S.session_id, function (pos) {
      var x = S.items.filter(function (i) {
        return i.pos === pos;
      })[0];
      return x ? x.qid : null;
    });
  }

  function cardHtml(it) {
    var s = state[it.pos];
    var h = '<div class="qcard" id="q-' + it.pos + '" data-pos="' + it.pos + '">';
    h += '<div class="qhead"><span class="qno">' + it.pos + '</span><span class="tag">' + App.typeLabel[it.qtype] + '</span>';
    if (it.qtype === 'multi') h += '<span class="small muted">可多选</span>';
    h += '<div style="flex:1 1 auto"></div>';
    h +=
      '<label class="mk' +
      (s.marked ? ' on' : '') +
      '"><input type="checkbox" data-mark="' +
      it.pos +
      '"' +
      (s.marked ? ' checked' : '') +
      '> 标记</label>';
    h += App.hardLabel(it.pos, App.isHard(it.qid));
    h += '</div>';
    h += '<div class="qstem">' + App.esc(it.stem) + '</div><div class="qopts">';
    it.options.forEach(function (o, i) {
      h +=
        '<div class="opt' +
        (s.pick.indexOf(i) >= 0 ? ' sel' : '') +
        '" data-pos="' +
        it.pos +
        '" data-opt="' +
        i +
        '"><div class="k">' +
        App.esc(o.label) +
        '</div><div class="v">' +
        App.esc(o.text) +
        '</div></div>';
    });
    h += '</div></div>';
    return h;
  }

  function bindPaper(view) {
    var paper = App.$('#paper', view);
    paper.addEventListener('click', function (e) {
      var opt = e.target.closest ? e.target.closest('.opt') : null;
      if (!opt) return;
      var pos = Number(opt.dataset.pos);
      var i = Number(opt.dataset.opt);
      if (!pos) return;
      var it = S.items.filter(function (x) {
        return x.pos === pos;
      })[0];
      var s = state[pos];
      if (it.qtype === 'multi') {
        var k = s.pick.indexOf(i);
        if (k >= 0) s.pick.splice(k, 1);
        else s.pick.push(i);
      } else {
        s.pick = [i];
      }
      paintQuestion(pos);
      saveAnswer(pos);
    });

    paper.addEventListener('change', function (e) {
      var cb = e.target;
      if (!cb.dataset || !cb.dataset.mark) return;
      var pos = Number(cb.dataset.mark);
      var s = state[pos];
      s.marked = cb.checked;
      var lb = cb.closest('.mk');
      if (lb) lb.classList.toggle('on', s.marked);
      App.call('toggle_mark', { session_id: S.session_id, pos: pos, marked: s.marked }).catch(function (err) {
        App.toast(err.message, 'bad');
      });
      refreshNav();
    });
  }

  function paintQuestion(pos) {
    var card = document.getElementById('q-' + pos);
    if (!card) return;
    var s = state[pos];
    App.$$('.opt', card).forEach(function (el) {
      el.classList.toggle('sel', s.pick.indexOf(Number(el.dataset.opt)) >= 0);
    });
  }

  function saveAnswer(pos) {
    var s = state[pos];
    var chosen = s.pick.slice().sort(function (a, b) {
      return a - b;
    });
    App.call('answer', { session_id: S.session_id, pos: pos, chosen: chosen, submit: false })
      .then(function () {
        s.saved = true;
        refreshNav();
      })
      .catch(function (e) {
        App.toast(e.message, 'bad');
      });
  }

  function bindNav(view) {
    var nav = App.$('#nav', view);
    var jump = function (el) {
      var pos = Number(el.dataset.goto);
      var card = document.getElementById('q-' + pos);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    nav.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.qbox') : null;
      if (b) jump(b);
    });
    nav.addEventListener('dblclick', function (e) {
      var b = e.target.closest ? e.target.closest('.qbox') : null;
      if (b) jump(b);
    });
  }

  function refreshNav() {
    var done = doneCount();
    var tc = document.getElementById('top-count');
    if (tc) tc.textContent = '已答 ' + done + ' / ' + S.total;
    var nc = document.getElementById('nav-count');
    if (nc) nc.textContent = '已答 ' + done + ' / ' + S.total;
    App.$$('.qbox').forEach(function (b) {
      var pos = Number(b.dataset.goto);
      var s = state[pos];
      b.dataset.state = s.pick.length ? 'done' : 'todo';
      b.classList.toggle('marked', !!s.marked);
    });
  }

  function doSubmit() {
    var done = doneCount();
    var marked = 0;
    S.items.forEach(function (it) {
      if (state[it.pos].marked) marked++;
    });
    var left = S.total - done;
    var body =
      '<div class="kv" style="margin-bottom:10px"><div>总题数 <b>' +
      S.total +
      '</b></div><div>已答 <b class="ok">' +
      done +
      '</b></div><div>未答 <b class="' +
      (left ? 'bad' : '') +
      '">' +
      left +
      '</b></div><div>已标记 <b>' +
      marked +
      '</b></div></div>' +
      (left ? '<div class="fb bad">还有 ' + left + ' 题未作答，交卷后这些题将计为「漏答」。</div>' : '<div class="small muted">所有题目均已作答。</div>');

    App.modal({
      title: '确认交卷',
      body: body,
      cancelText: '再检查一下',
      okText: '交卷并评卷',
    }).then(function (yes) {
      if (!yes) return;
      App.call('submit_session', { session_id: S.session_id })
        .then(function () {
          try {
            sessionStorage.removeItem('suiti_session');
          } catch (e) {}
          var m = S.mode;
          App.current = null;
          App.go('/result?session=' + S.session_id + '&mode=' + m);
        })
        .catch(function (e) {
          App.toast(e.message, 'bad');
        });
    });
  }
})();
