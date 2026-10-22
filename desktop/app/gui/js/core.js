/* 随题 · 前端核心
   桥接、路由、通用 UI 组件。无框架、无构建，全部挂到 window.App。 */
(function () {
  'use strict';

  var App = (window.App = {});
  var DEV = /(?:^|[?&])dev=1(?:&|$)/.test(location.search);

  /* ------------------------------------------------ 桥接 */
  function httpBridge() {
    var call = function (name) {
      return function (payload) {
        return fetch('api/' + name, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload || {}),
        }).then(function (r) {
          return r.json();
        });
      };
    };
    return new Proxy(
      {},
      {
        get: function (_, name) {
          // 不能让 Proxy 被当成 thenable：否则 Promise.resolve(proxy) 会去调 proxy.then
          if (typeof name !== 'string') return undefined;
          if (name === 'then' || name === 'catch' || name === 'finally' || name === 'toJSON') return undefined;
          return call(name);
        },
      }
    );
  }

  function pywebviewBridge() {
    return window.pywebview && window.pywebview.api ? window.pywebview.api : null;
  }

  App.ready = new Promise(function (resolve) {
    if (DEV) return resolve(httpBridge());
    var b = pywebviewBridge();
    if (b) return resolve(b);
    window.addEventListener('pywebviewready', function () {
      resolve(pywebviewBridge());
    });
    setTimeout(function () {
      resolve(pywebviewBridge());
    }, 4000);
  });

  function ApiError(msg, code, detail) {
    var e = new Error(msg);
    e.name = 'ApiError';
    e.code = code || 'ERROR';
    e.detail = detail || {};
    return e;
  }
  App.ApiError = ApiError;

  App.call = function (name, payload) {
    return App.ready.then(function (api) {
      if (!api) throw ApiError('后端未就绪，请重新打开程序', 'NO_BRIDGE');
      var fn = api[name];
      if (typeof fn !== 'function') throw ApiError('接口不存在：' + name, 'NO_METHOD');
      return Promise.resolve(fn.call(api, payload || {})).then(function (res) {
        if (!res || res.ok !== true) {
          var err = (res && res.error) || {};
          throw ApiError(err.msg || '操作失败', err.code, err.detail);
        }
        return res.data;
      });
    });
  };

  /* 静默调用：失败只 toast，不抛 */
  App.tryCall = function (name, payload) {
    return App.call(name, payload).catch(function (e) {
      App.toast(e.message || String(e), 'bad');
      throw e;
    });
  };

  /* ------------------------------------------------ 工具 */
  App.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };
  App.$ = function (sel, root) {
    return (root || document).querySelector(sel);
  };
  App.$$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };
  App.fmtScore = function (v) {
    var f = Number(v || 0);
    return Math.abs(f - Math.round(f)) < 1e-9 ? String(Math.round(f)) : f.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  };
  App.fmtDur = function (sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    if (m >= 60) return Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分';
    return m + ' 分 ' + s + ' 秒';
  };
  App.modeLabel = { practice: '练习模式', mock: '模拟考试', exam: '正式考试' };
  App.typeLabel = { single: '单选题', multi: '多选题', judge: '判断题' };
  App.typeName = { single: '单项选择题', multi: '多项选择题', judge: '判断题' };

  /* ------------------------------------------------ toast */
  var toastBox;
  App.toast = function (msg, kind, ms) {
    if (!toastBox) {
      toastBox = document.createElement('div');
      toastBox.className = 'toasts';
      document.body.appendChild(toastBox);
    }
    var t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.textContent = msg;
    toastBox.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .2s';
      t.style.opacity = '0';
      setTimeout(function () {
        t.remove();
      }, 220);
    }, ms || 2200);
  };

  /* ------------------------------------------------ 弹窗 */
  function openModal(opt) {
    return new Promise(function (resolve) {
      var mask = document.createElement('div');
      mask.className = 'mask';
      var okText = opt.okText === null ? null : opt.okText || '确定';
      var cancelText = opt.cancelText === null ? null : opt.cancelText || '取消';
      mask.innerHTML =
        '<div class="modal">' +
        '<div class="mh">' +
        App.esc(opt.title || '') +
        '</div>' +
        '<div class="mb">' +
        (opt.body || '') +
        '</div>' +
        '<div class="mf">' +
        (cancelText ? '<button class="btn" data-act="cancel">' + App.esc(cancelText) + '</button>' : '') +
        (okText ? '<button class="btn pri" data-act="ok">' + App.esc(okText) + '</button>' : '') +
        '</div></div>';
      document.body.appendChild(mask);

      var okBtn = App.$('[data-act=ok]', mask);
      var cancelBtn = App.$('[data-act=cancel]', mask);
      var body = App.$('.mb', mask);

      function close(v) {
        mask.remove();
        document.removeEventListener('keydown', onKey);
        resolve(v);
      }
      function tryOk() {
        if (typeof opt.onOk === 'function') {
          var r = opt.onOk(body, close);
          if (r === false) return;
        }
        close(true);
      }
      function onKey(e) {
        if (e.key === 'Escape') close(false);
        if (e.key === 'Enter' && !e.shiftKey) {
          var tag = (document.activeElement && document.activeElement.tagName) || '';
          if (tag !== 'TEXTAREA') tryOk();
        }
      }
      if (okBtn) okBtn.addEventListener('click', tryOk);
      if (cancelBtn)
        cancelBtn.addEventListener('click', function () {
          close(false);
        });      mask.addEventListener('click', function (e) {
        if (e.target === mask) close(false);
      });
      document.addEventListener('keydown', onKey);
      setTimeout(function () {
        var f = body.querySelector('input,textarea');
        if (f) {
          f.focus();
          if (f.setSelectionRange && f.value) f.setSelectionRange(f.value.length, f.value.length);
        } else if (okBtn) okBtn.focus();
      }, 30);
      if (typeof opt.after === 'function') opt.after(body, close);
    });
  }
  App.modal = openModal;

  App.confirm = function (title, msg, okText) {
    return openModal({
      title: title,
      body: '<div>' + (msg || '') + '</div>',
      okText: okText || '确定',
    });
  };

  /* 单行输入弹窗，返回字符串或 false */
  App.prompt = function (opt) {
    var max = opt.maxlength || 50;
    return openModal({
      title: opt.title,
      okText: opt.okText || '确定',
      body:
        '<label class="small muted">' +
        App.esc(opt.label || '') +
        '</label>' +
        '<input class="inp" id="pm-in" maxlength="' +
        max +
        '" placeholder="' +
        App.esc(opt.placeholder || '') +
        '">' +
        '<div class="cnt" id="pm-cnt">0 / ' +
        max +
        '</div>' +
        '<div class="err" id="pm-err"></div>',
      onOk: function (body, close) {
        var v = (body.querySelector('#pm-in').value || '').trim();
        var err = body.querySelector('#pm-err');
        if (!v) {
          err.textContent = '请填写后再继续';
          body.querySelector('#pm-in').focus();
          return false;
        }
        if (v.length > max) {
          err.textContent = '不能超过 ' + max + ' 个字符';
          return false;
        }
        close(v);
        return false;
      },
      after: function (body) {
        var i = body.querySelector('#pm-in');
        var c = body.querySelector('#pm-cnt');
        i.addEventListener('input', function () {
          c.textContent = i.value.length + ' / ' + max;
        });
      },
    });
  };

  /* ------------------------------------------------ 重难错题 */
  App.hardLabel = function (pos, on, text) {
    return (
      '<label class="mk hard' +
      (on ? ' on' : '') +
      '"><input type="checkbox" data-hard="' +
      pos +
      '"' +
      (on ? ' checked' : '') +
      '> ' +
      (text || '重难错题') +
      '</label>'
    );
  };

  /** 一次性取回某题库已归集的重难错题 qid 集合 */
  App.loadHardSet = function (bankId) {
    App.hardSet = null;
    return App.call('hard_map', {})
      .then(function (d) {
        var arr = (d.map && d.map[String(bankId)]) || [];
        App.hardSet = {};
        arr.forEach(function (q) {
          App.hardSet[String(q)] = true;
        });
        return App.hardSet;
      })
      .catch(function () {
        App.hardSet = {};
        return App.hardSet;
      });
  };

  App.isHard = function (qid) {
    return !!(App.hardSet && App.hardSet[String(qid)]);
  };

  App.toggleHard = function (sessionId, pos, hard) {
    return App.call('toggle_hard', { session_id: sessionId, pos: pos, hard: hard });
  };

  /* 给一组 checkbox 绑定「重难错题」勾选行为；qidOf(pos) 返回题目原始 id */
  App.bindHardBoxes = function (root, sessionId, qidOf) {
    App.$$('[data-hard]', root).forEach(function (cb) {
      if (cb.dataset.bound === '1') return;
      cb.dataset.bound = '1';
      cb.addEventListener('change', function () {
        var pos = Number(cb.dataset.hard);
        var on = cb.checked;
        App.toggleHard(sessionId, pos, on)
          .then(function (d) {
            var qid = qidOf ? qidOf(pos) : null;
            if (qid != null) {
              if (on) App.hardSet[String(qid)] = true;
              else delete App.hardSet[String(qid)];
            }
            var lb = cb.closest('.mk');
            if (lb) lb.classList.toggle('on', on);
            App.toast(on ? '已加入重难错题（本库共 ' + d.count + ' 题）' : '已从重难错题移除', on ? 'ok' : '');
          })
          .catch(function (e) {
            cb.checked = !on;
            App.toast(e.message, 'bad');
          });
      });
    });
  };

  /* ------------------------------------------------ 导出（多页共用） */
  App.exportAny = function (callName, params, warnText, subtitle) {
    function formatModal() {
      var body =
        '<div class="small muted" style="margin-bottom:12px">' +
        App.esc(subtitle || '导出内容：试题正文 + 卷末参考答案页。') +
        '</div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
        '<button class="btn" data-fmt="pdf">导出 PDF</button>' +
        '<button class="btn" data-fmt="docx">导出 Word</button>' +
        '<button class="btn" data-fmt="xlsx">导出 Excel</button>' +
        '</div><div class="err"></div>';

      return openModal({
        title: '导出试卷',
        body: body,
        cancelText: '关闭',
        okText: null,
        after: function (box, close) {
          var errBox = box.querySelector('.err');
          App.$$('[data-fmt]', box).forEach(function (b) {
            b.addEventListener('click', function () {
              var fmt = b.dataset.fmt;
              var all = App.$$('[data-fmt]', box);
              all.forEach(function (x) {
                x.disabled = true;
              });
              b.innerHTML = '<span class="spin" style="border-color:rgba(0,0,0,.15);border-top-color:#1f5fd0"></span> 生成中…';
              var payload = {};
              Object.keys(params || {}).forEach(function (k) {
                payload[k] = params[k];
              });
              payload.fmt = fmt;
              App.call(callName, payload)
                .then(function (d) {
                  if (d.cancelled) {
                    all.forEach(function (x) {
                      x.disabled = false;
                    });
                    b.textContent = '导出 ' + fmt.toUpperCase();
                    return;
                  }
                  close(true);
                  App.modal({
                    title: '导出成功',
                    body:
                      '<div class="small" style="word-break:break-all">' +
                      App.esc(d.path) +
                      '</div>' +
                      (d.warning
                        ? '<div class="small" style="color:#a15c07;margin-top:8px">' + App.esc(d.warning) + '</div>'
                        : ''),
                    cancelText: '知道了',
                    okText: '打开所在文件夹',
                    onOk: function () {
                      App.call('open_folder', { path: d.path }).catch(function () {});
                    },
                  });
                })
                .catch(function (e) {
                  errBox.textContent = e.message;
                  all.forEach(function (x) {
                    x.disabled = false;
                  });
                  b.textContent = '导出 ' + fmt.toUpperCase();
                });
            });
          });
        },
      });
    }

    if (warnText) {
      return openModal({
        title: '导出提示',
        body: '<div>' + App.esc(warnText) + '</div>',
        cancelText: '取消',
        okText: '继续导出',
      }).then(function (yes) {
        return yes ? formatModal() : null;
      });
    }
    return formatModal();
  };

  App.exportPaper = function (sessionId, warnText) {
    return App.exportAny('export_paper', { session_id: sessionId, with_answer: true }, warnText);
  };

  /* ------------------------------------------------ 路由 */
  var routes = {};
  App.route = function (name, fn) {
    routes[name] = fn;
  };

  App.go = function (path) {
    if (location.hash === '#' + path) render();
    else location.hash = path;
  };

  App.back = function () {
    history.back();
  };

  function parseHash() {
    var h = location.hash.replace(/^#/, '') || '/home';
    var qi = h.indexOf('?');
    var page = h;
    var query = {};
    if (qi >= 0) {
      page = h.slice(0, qi);
      h
        .slice(qi + 1)
        .split('&')
        .forEach(function (kv) {
          if (!kv) return;
          var p = kv.split('=');
          query[decodeURIComponent(p[0])] = decodeURIComponent(p.slice(1).join('=') || '');
        });
    }
    return { page: page.replace(/^\//, '') || 'home', query: query };
  }

  var renderToken = 0;
  var NAVMAP = {
    home: 'home',
    banks: 'banks',
    hard: 'hard',
    setup: 'banks',
    practice: 'banks',
    mock: 'banks',
    exam: 'banks',
    result: 'banks',
    records: 'records',
  };

  function render() {
    var r = parseHash();
    var fn = routes[r.page] || routes['home'];
    var view = document.getElementById('view');
    if (!view) return;
    var my = ++renderToken;
    view.className = 'view';
    view.scrollTop = 0;
    App.setTopActions('');
    var ret = fn(view, r.query);
    if (ret && typeof ret.then === 'function') {
      ret.catch(function (e) {
        if (my !== renderToken) return;
        console.error(e);
        view.innerHTML = '<div class="empty"><b>页面加载失败</b>' + App.esc(e.message || String(e)) + '</div>';
      });
    }
    var key = NAVMAP[r.page] || r.page;
    App.$$('.side nav a').forEach(function (a) {
      a.classList.toggle('on', a.dataset.route === key);
    });
  }
  App.render = render;

  App.setTop = function (title, meta) {
    var h = document.getElementById('page-title');
    var m = document.getElementById('page-meta');
    if (h) h.textContent = title || '';
    if (m) m.innerHTML = meta || '';
  };

  /* 顶栏插槽（做题页需要放按钮） */
  App.setTopActions = function (html) {
    var slot = document.getElementById('top-actions');
    if (slot) slot.innerHTML = html || '';
  };

  window.addEventListener('hashchange', render);

  /* 脚本在 </body> 前按顺序加载，此时 DOM 已就绪，直接初始化 */
  function init() {
    App.$$('.side nav a').forEach(function (a) {
      a.addEventListener('click', function () {
        App.go('/' + a.dataset.route);
      });
    });
    if (!location.hash) location.hash = '/home';
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
