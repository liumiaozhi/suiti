/* 出题设置：三种模式共用；数量与分值按题型逐项设置；支持从「重难错题」出卷 */
(function () {
  var App = window.App;

  var st = null;
  var mode = 'practice';
  var source = 'bank';
  var banksCache = [];
  var hardCache = {}; // bank_id -> {total, single, multi, judge}

  App.route('setup', function (view, q) {
    mode = q.mode || 'practice';
    source = q.source === 'hard' ? 'hard' : 'bank';
    App.setTop(
      (source === 'hard' ? '重难错题 · ' : '') + '出题设置 · ' + (App.modeLabel[mode] || ''),
      source === 'hard' ? '只从该题库的重难错题中出卷' : ''
    );
    App.setTopActions('');
    view.innerHTML = '<div class="skeleton">正在读取题库…</div>';

    return Promise.all([App.call('list_banks', {}), App.call('hard_overview', {})]).then(function (res) {
      banksCache = res[0].banks || [];
      hardCache = {};
      (res[1].banks || []).forEach(function (h) {
        hardCache[String(h.bank_id)] = h;
      });

      var usable = source === 'hard' ? banksCache.filter(function (b) { return !!hardCache[String(b.id)]; }) : banksCache;
      if (!usable.length) {
        view.innerHTML =
          '<div class="empty"><b>' +
          (source === 'hard' ? '还没有重难错题' : '还没有题库') +
          '</b>' +
          (source === 'hard'
            ? '在练习或考试时，点题目右侧的「重难错题」勾选，题目就会归集到这里。'
            : '请先下载模板、填好题目并导入。') +
          '<div style="margin-top:14px"><button class="btn pri" id="go-banks">' +
          (source === 'hard' ? '去做题' : '去导入题库') +
          '</button></div></div>';
        App.$('#go-banks', view).addEventListener('click', function () {
          App.go(source === 'hard' ? '/hard' : '/banks');
        });
        return;
      }

      var bid = Number(q.bank || 0);
      var bank = usable.filter(function (b) { return b.id === bid; })[0] || usable[0];

      st = {
        bankId: bank.id,
        bankName: bank.name,
        counts: countsOf(bank),
        types: ['single', 'multi', 'judge'].filter(function (t) {
          return (countsOf(bank)[t] || 0) > 0;
        }),
        amountMode: 'all',
        amounts: { single: 0, multi: 0, judge: 0 },
        scores: { single: 2, multi: 2, judge: 2 },
        qOrder: 'asc',
        aOrder: 'keep',
      };
      render(view);
    });
  });

  function countsOf(bank) {
    if (source === 'hard') {
      var h = hardCache[String(bank.id)];
      return h
        ? { total: h.total, single: h.single, multi: h.multi, judge: h.judge }
        : { total: 0, single: 0, multi: 0, judge: 0 };
    }
    return bank.counts;
  }

  function pickedOf(t) {
    var c = st.counts[t] || 0;
    if (st.amountMode === 'all') return c;
    var n = st.amounts[t] > 0 ? st.amounts[t] : c;
    return Math.min(n, c);
  }

  function totalPicked() {
    var n = 0;
    st.types.forEach(function (t) {
      n += pickedOf(t);
    });
    return n;
  }

  function totalScore() {
    var s = 0;
    st.types.forEach(function (t) {
      s += pickedOf(t) * (st.scores[t] || 0);
    });
    return Math.round(s * 100) / 100;
  }

  function render(view) {
    var html = '';
    html +=
      '<div class="card pad" style="margin-bottom:16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap">' +
      '<div style="flex:1 1 auto;min-width:220px">' +
      '<div style="font-size:12px;color:#7b8ca3">' +
      (source === 'hard' ? '重难错题所在题库' : '当前题库') +
      '</div>' +
      '<div style="font-size:16px;font-weight:600;margin-top:2px">' +
      App.esc(st.bankName) +
      '</div>' +
      '<div class="small muted" style="margin-top:4px">' +
      (source === 'hard' ? '重难错题：' : '') +
      '单选 ' +
      st.counts.single +
      ' · 多选 ' +
      st.counts.multi +
      ' · 判断 ' +
      st.counts.judge +
      ' · 合计 ' +
      st.counts.total +
      ' 题</div></div>' +
      (banksCache.length > 1 ? '<button class="btn" id="btn-switch">更换题库</button>' : '') +
      '</div>';

    // 1. 题型
    html += '<div class="card pad" style="margin-bottom:16px">';
    html += '<div class="card-h"><h3>1. 题型</h3><div class="spacer"></div><span class="small muted">勾选要抽的题型</span></div>';
    html += '<div class="types">';
    [
      ['single', '单选题'],
      ['multi', '多选题'],
      ['judge', '判断题'],
    ].forEach(function (p) {
      var t = p[0];
      var c = st.counts[t] || 0;
      var on = st.types.indexOf(t) >= 0;
      html +=
        '<div class="type-card ' +
        (on ? 'on' : '') +
        '" data-type="' +
        t +
        '" style="' +
        (c ? '' : 'opacity:.45;cursor:not-allowed') +
        '"><div class="ck">✓</div><div class="t">' +
        p[1] +
        '</div><div class="n">' +
        (c ? '可出 ' + c + ' 题' : '没有该题型') +
        '</div></div>';
    });
    html += '</div></div>';

    // 2. 数量与分值（合并）
    html += '<div class="card pad" style="margin-bottom:16px">';
    html += '<div class="card-h"><h3>2. 数量与分值</h3><div class="spacer"></div>';
    html +=
      '<div class="seg"><button class="' +
      (st.amountMode === 'all' ? 'on' : '') +
      '" data-amt="all">全量</button><button class="' +
      (st.amountMode === 'num' ? 'on' : '') +
      '" data-amt="num">指定数量</button></div></div>';

    if (!st.types.length) html += '<div class="muted small">请先勾选题型</div>';

    st.types.forEach(function (t) {
      var c = st.counts[t] || 0;
      var picked = pickedOf(t);
      var sc = st.scores[t] || 0;
      html += '<div class="amount-row"><div class="nm">' + App.typeLabel[t] + '</div>';
      html += '<div class="right">';
      if (st.amountMode === 'num') {
        html +=
          '<span class="small muted">数量</span> <input class="inp num sm" type="number" min="1" max="' +
          c +
          '" value="' +
          (st.amounts[t] || c) +
          '" data-amount="' +
          t +
          '"> <span class="small muted">题</span>';
      } else {
        html += '<span class="small muted">全量 ' + c + ' 题</span>';
      }
      html += '<span class="dot">·</span>';
      html +=
        '<span class="small muted">每题</span> <input class="inp num sm" type="number" min="0.5" step="0.5" value="' +
        sc +
        '" data-score="' +
        t +
        '"> <span class="small muted">分</span>';
      html += '<span class="sub-total">= ' + App.fmtScore(picked * sc) + ' 分</span>';
      html += '</div></div>';
    });
    html +=
      '<div class="hint" style="margin-top:10px">分值按题型分别设置，支持 0.5 这样的步长；多选题须全选正确才得分。</div>';
    html += '</div>';

    // 3. 顺序
    html += '<div class="card pad" style="margin-bottom:16px">';
    html += '<div class="card-h"><h3>3. 顺序</h3></div>';
    html +=
      '<div class="field"><label class="lbl">题目顺序</label><div class="seg" id="seg-qorder">' +
      '<button data-qo="asc" class="' +
      (st.qOrder === 'asc' ? 'on' : '') +
      '">正序</button>' +
      '<button data-qo="desc" class="' +
      (st.qOrder === 'desc' ? 'on' : '') +
      '">倒序</button>' +
      '<button data-qo="random" class="' +
      (st.qOrder === 'random' ? 'on' : '') +
      '">随机</button></div>' +
      '<div class="hint">在每种题型内部生效，题型之间固定按 单选 → 多选 → 判断 排列。</div></div>';
    html +=
      '<div class="field" style="margin-bottom:0"><label class="lbl">答案顺序</label><div class="seg">' +
      '<button data-ao="keep" class="' +
      (st.aOrder === 'keep' ? 'on' : '') +
      '">与题库一致</button>' +
      '<button data-ao="shuffle" class="' +
      (st.aOrder === 'shuffle' ? 'on' : '') +
      '">随机打乱</button></div>' +
      '<div class="hint">判断题固定 A=正确、B=错误，不打乱。</div></div>';
    html += '</div>';

    var total = totalPicked();
    html +=
      '<div class="card pad" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">' +
      '<div style="flex:1 1 auto"><div class="small muted" id="total-line">' +
      totalLine(total) +
      '</div>' +
      '<div class="small muted" style="margin-top:2px">' +
      (mode === 'practice' ? '练习模式：每题作答后立即判分。' : '进入前会要求填写考生信息（50 字以内）。') +
      '</div></div>' +
      '<button class="btn lg pri" id="btn-gen"' +
      (total ? '' : ' disabled') +
      '>生成并进入' +
      App.modeLabel[mode] +
      '</button></div>';

    view.innerHTML = html;
    bind(view);
  }

  function bind(view) {
    var sw = App.$('#btn-switch', view);
    if (sw)
      sw.addEventListener('click', function () {
        var list =
          source === 'hard'
            ? banksCache.filter(function (b) {
                return !!hardCache[String(b.id)];
              })
            : banksCache;
        var body = '<div class="small muted" style="margin-bottom:10px">选择题库：</div>';
        list.forEach(function (b) {
          var c = countsOf(b);
          body +=
            '<div class="type-card" data-pick="' +
            b.id +
            '" style="margin-bottom:8px"><div class="t">' +
            App.esc(b.name) +
            '</div><div class="n">共 ' +
            c.total +
            ' 题（单选 ' +
            c.single +
            ' / 多选 ' +
            c.multi +
            ' / 判断 ' +
            c.judge +
            '）</div></div>';
        });
        App.modal({
          title: '更换题库',
          body: body,
          cancelText: '取消',
          okText: '关闭',
          after: function (box, close) {
            App.$$('[data-pick]', box).forEach(function (el) {
              el.addEventListener('click', function () {
                var id = Number(el.dataset.pick);
                var b = list.filter(function (x) {
                  return x.id === id;
                })[0];
                st.bankId = b.id;
                st.bankName = b.name;
                st.counts = countsOf(b);
                st.types = ['single', 'multi', 'judge'].filter(function (t) {
                  return (st.counts[t] || 0) > 0;
                });
                st.amounts = { single: 0, multi: 0, judge: 0 };
                close(true);
                render(view);
              });
            });
          },
        });
      });

    App.$$('[data-type]', view).forEach(function (el) {
      el.addEventListener('click', function () {
        var t = el.dataset.type;
        if (!(st.counts[t] > 0)) return;
        var i = st.types.indexOf(t);
        if (i >= 0) st.types.splice(i, 1);
        else st.types.push(t);
        st.types.sort(function (a, b) {
          return ['single', 'multi', 'judge'].indexOf(a) - ['single', 'multi', 'judge'].indexOf(b);
        });
        render(view);
      });
    });

    App.$$('[data-amt]', view).forEach(function (el) {
      el.addEventListener('click', function () {
        st.amountMode = el.dataset.amt;
        render(view);
      });
    });

    App.$$('[data-amount]', view).forEach(function (el) {
      el.addEventListener('input', function () {
        var v = Math.max(1, Number(el.value) || 1);
        st.amounts[el.dataset.amount] = v;
        updateFooter(view);
      });
      el.addEventListener('change', function () {
        render(view);
      });
    });

    App.$$('[data-score]', view).forEach(function (el) {
      el.addEventListener('input', function () {
        var v = Number(el.value);
        if (v > 0) st.scores[el.dataset.score] = Math.round(v * 100) / 100;
        updateFooter(view);
      });
      el.addEventListener('change', function () {
        var v = Number(el.value);
        if (!(v > 0)) {
          App.toast('分值必须大于 0', 'bad');
          el.value = st.scores[el.dataset.score];
          return;
        }
        st.scores[el.dataset.score] = Math.round(v * 100) / 100;
        render(view);
      });
    });

    App.$$('[data-qo]', view).forEach(function (el) {
      el.addEventListener('click', function () {
        st.qOrder = el.dataset.qo;
        render(view);
      });
    });
    App.$$('[data-ao]', view).forEach(function (el) {
      el.addEventListener('click', function () {
        st.aOrder = el.dataset.ao;
        render(view);
      });
    });

    var gen = App.$('#btn-gen', view);
    if (gen)
      gen.addEventListener('click', function () {
        generate(gen);
      });
  }

  /* 数量/分值输入时只刷新底部合计，不整页重绘（避免输入框失焦） */
  function updateFooter(view) {
    var total = totalPicked();
    var el = view.querySelector('#total-line');
    if (el) el.innerHTML = totalLine(total);
    var btn = App.$('#btn-gen', view);
    if (btn) btn.disabled = !total;
  }

  function totalLine(total) {
    return (
      '本次共 <b style="color:#16233a;font-size:16px">' +
      total +
      '</b> 题，满分 <b style="color:#16233a;font-size:16px">' +
      App.fmtScore(totalScore()) +
      '</b> 分'
    );
  }

  function payload() {
    var amount = {};
    var score = {};
    ['single', 'multi', 'judge'].forEach(function (t) {
      amount[t] = st.amounts[t] || 0;
      score[t] = st.scores[t] || 0;
    });
    var p = {
      bank_id: st.bankId,
      types: st.types.slice(),
      amount_mode: st.amountMode,
      amount: amount,
      score: score,
      q_order: st.qOrder,
      a_order: st.aOrder,
    };
    if (source === 'hard') p.source = 'hard';
    return p;
  }

  function generate(btn) {
    if (!st.types.length) {
      App.toast('请至少勾选一种题型', 'bad');
      return;
    }
    btn.disabled = true;
    var old = btn.textContent;
    btn.innerHTML = '<span class="spin"></span> 生成中…';

    var p = payload();
    App.call('preview_paper', p)
      .then(function (pv) {
        if (pv.warnings && pv.warnings.length) {
          pv.warnings.forEach(function (w) {
            App.toast(w);
          });
        }
        if (mode === 'practice') return null;
        return App.prompt({
          title: '填写考生信息',
          label: '考生信息（姓名、准考证号等，50 字以内）',
          placeholder: '例如：张三 2026001',
          maxlength: 50,
          okText: '确定并进入' + App.modeLabel[mode],
        });
      })
      .then(function (cand) {
        if (mode !== 'practice' && cand === false) return null;
        p.mode = mode;
        if (cand) p.candidate = cand;
        return App.call('create_session', p).then(function (data) {
          App.current = data;
          try {
            sessionStorage.setItem('suiti_session', JSON.stringify(data));
          } catch (e) {}
          App.go(mode === 'practice' ? '/practice' : mode === 'mock' ? '/mock' : '/exam');
        });
      })
      .catch(function (e) {
        App.toast(e.message, 'bad');
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = old;
      });
  }
})();
