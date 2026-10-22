/* 首页：三种模式入口 + 概览 */
(function () {
  var App = window.App;

  var MODES = [
    { key: 'practice', cls: 'm1', ic: '✎', name: '练习模式', desc: '边做边看答案，单选/判断一点即判，多选点「完成」判分' },
    { key: 'mock', cls: 'm2', ic: '⏱', name: '模拟考试', desc: '先做题后评卷，可标记疑难题、按题号跳转，交卷出成绩' },
    { key: 'exam', cls: 'm3', ic: '★', name: '正式考试', desc: '与模拟考试流程一致，成绩计入「考试记录」' },
  ];

  App.route('home', function (view) {
    App.setTop('首页', '');
    App.setTopActions('');
    view.innerHTML = '<div class="skeleton">正在读取数据…</div>';

    return Promise.all([App.call('list_banks', {}), App.call('get_records', {})])
      .then(function (res) {
        var banks = res[0].banks || [];
        var ov = res[1].overall || {};
        var total = banks.reduce(function (s, b) {
          return s + (b.counts.total || 0);
        }, 0);

        var html = '';
        html +=
          '<div class="hero"><h2>随题 · 想练就练</h2>' +
          '<p>导入题库即可开始：模板一键下载，三种做题方式，成绩自动留痕。</p>' +
          '<div class="row">' +
          '<button class="btn pri" data-go="banks">' +
          (banks.length ? '选择题库开始做题' : '先导入一份题库') +
          '</button>' +
          '<button class="btn" data-go="records">查看做题记录</button>' +
          '</div></div>';

        html += '<div class="stats" style="margin-bottom:18px">';
        html += stat('题库数量', banks.length, '个');
        html += stat('题目总数', total, '道');
        html += stat('累计做题', ov.done_cnt || 0, '道');
        html += stat('答对', ov.right || 0, '道', 'ok');
        html += stat('答错/漏答', (ov.wrong || 0) + (ov.missing || 0), '道', 'bad');
        html += stat('正确率', ov.accuracy == null ? 0 : ov.accuracy, '%', 'pri');
        html += '</div>';

        html += '<div class="mode-grid">';
        MODES.forEach(function (m) {
          html +=
            '<div class="mode ' +
            m.cls +
            '" data-mode="' +
            m.key +
            '"><div class="ic">' +
            m.ic +
            '</div><h4>' +
            m.name +
            '</h4><p>' +
            m.desc +
            '</p></div>';
        });
        html += '</div>';

        if (banks.length) {
          html += '<div class="card pad"><div class="card-h"><h3>最近题库</h3><div class="spacer"></div>';
          html += '<button class="btn sm ghost" data-go="banks">全部题库 →</button></div>';
          html += '<table class="tbl"><thead><tr><th>题库名称</th><th class="num">单选题</th><th class="num">多选题</th><th class="num">判断题</th><th class="num">合计</th><th>导入时间</th><th></th></tr></thead><tbody>';
          banks.slice(0, 5).forEach(function (b) {
            html +=
              '<tr><td class="name">' +
              App.esc(b.name) +
              '</td><td class="num">' +
              b.counts.single +
              '</td><td class="num">' +
              b.counts.multi +
              '</td><td class="num">' +
              b.counts.judge +
              '</td><td class="num"><b>' +
              b.counts.total +
              '</b></td><td class="muted small">' +
              App.esc((b.created_at || '').slice(0, 16)) +
              '</td><td style="text-align:right"><button class="btn sm" data-bank="' +
              b.id +
              '">去练习</button></td></tr>';
          });
          html += '</tbody></table></div>';
        } else {
          html +=
            '<div class="empty"><b>还没有题库</b>先在「我的题库」里下载模板、填好后导入，就能开始做题了。<div style="margin-top:14px"><button class="btn pri" data-go="banks">去导入题库</button></div></div>';
        }

        view.innerHTML = html;

        App.$$('[data-go]', view).forEach(function (b) {
          b.addEventListener('click', function () {
            App.go('/' + b.dataset.go);
          });
        });
        App.$$('[data-mode]', view).forEach(function (b) {
          b.addEventListener('click', function () {
            App.go('/banks?mode=' + b.dataset.mode);
          });
        });
        App.$$('[data-bank]', view).forEach(function (b) {
          b.addEventListener('click', function () {
            App.go('/setup?bank=' + b.dataset.bank + '&mode=practice');
          });
        });
      });
  });

  function stat(k, v, unit, cls) {
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
})();
