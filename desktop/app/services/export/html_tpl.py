# -*- coding: utf-8 -*-
"""打印用 HTML 模板（纯字符串拼接，不引入 Jinja）。"""
from __future__ import annotations

from html import escape

from services import grading
from services.export import model as export_model

CSS = """
@page { size: A4; margin: 18mm 16mm 14mm 16mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: "Microsoft YaHei", "微软雅黑", "SimSun", serif;
  font-size: 11.5pt; line-height: 1.72; color: #000;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.title { font-size: 17pt; font-weight: 700; text-align: center; margin: 0 0 4pt; letter-spacing: 1pt; }
/* 卷头一行三栏：考生信息靠左、题量与满分居中、得分靠右 */
.header-row {
  display: grid; grid-template-columns: 1fr auto 1fr; align-items: baseline;
  font-size: 10.5pt; margin: 5pt 0 0; column-gap: 10pt;
}
.header-row .h-left { justify-self: start; white-space: nowrap; }
.header-row .h-mid { justify-self: center; text-align: center; white-space: nowrap; }
.header-row .h-right { justify-self: end; white-space: nowrap; }
.header-row .line { border-bottom: 0.9pt solid #000; display: inline-block; min-width: 96pt; }
.header-row .line.short { min-width: 54pt; }
/* 横线紧贴卷头那一行，中间不留空行 */
hr.sep { border: none; border-top: 1pt solid #000; margin: 0 0 10pt; }
.group { margin-top: 10pt; }
.group > h3 { font-size: 11.5pt; font-weight: 700; margin: 12pt 0 6pt; page-break-after: avoid; border-bottom: 0.6pt dashed #999; padding-bottom: 3pt; }
.q { margin: 0 0 9pt; page-break-inside: avoid; }
.stem { text-align: justify; }
.stem .no { font-weight: 700; margin-right: 3pt; }
.opts { margin: 4pt 0 0 1.4em; display: grid; gap: 2pt 16pt; }
.opts.two { grid-template-columns: 1fr 1fr; }
.opts.one { grid-template-columns: 1fr; }
.opt { display: flex; gap: 4pt; page-break-inside: avoid; }
.opt .lbl { flex: 0 0 auto; font-weight: 600; }
.opt .txt { flex: 1 1 auto; }
.answers { page-break-before: always; }
.answers h2 { font-size: 15pt; text-align: center; margin: 0 0 10pt; }
.answers pre { font-family: inherit; white-space: pre-wrap; font-size: 11pt; line-height: 2; margin: 0; }
.answers .tip { font-size: 9.5pt; color: #555; margin-top: 10pt; }
.footer-note { font-size: 9pt; color: #666; margin-top: 14pt; text-align: center; }
"""


def _opts_html(item: dict) -> str:
    opts = item["options"]
    if not opts:
        return ""
    longest = max((len(o["text"]) for o in opts), default=0)
    two = len(opts) <= 6 and longest <= 18
    cells = "".join(
        '<div class="opt"><span class="lbl">%s.</span><span class="txt">%s</span></div>'
        % (escape(o["label"]), escape(o["text"]))
        for o in opts
    )
    return '<div class="opts %s">%s</div>' % ("two" if two else "one", cells)


def render_html(vm: dict) -> str:
    parts = []
    parts.append("<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">")
    parts.append("<title>%s</title>" % escape(vm["title"]))
    parts.append("<style>%s</style></head><body>" % CSS)

    parts.append('<div class="title">%s</div>' % escape(vm["title"]))

    mid = ["共 %d 题" % vm["total"]]
    if vm.get("show_score") and vm.get("score_total"):
        mid.append("满分 %s 分" % grading.fmt_score(vm["score_total"]))

    left = ""
    if vm.get("show_candidate"):
        left = '考生信息：<span class="line">%s</span>' % escape(vm.get("candidate") or "")
    right = '得分：<span class="line short">&nbsp;</span>' if vm.get("show_score") else ""

    parts.append(
        '<div class="header-row"><span class="h-left">%s</span>'
        '<span class="h-mid">%s</span><span class="h-right">%s</span></div>'
        % (left, "　".join(mid), right)
    )
    parts.append('<hr class="sep">')

    for g in vm["groups"]:
        parts.append(
            '<div class="group"><h3>%s（%s）</h3>' % (escape(g["name"]), export_model.group_subtitle(g))
        )
        for it in g["items"]:
            # 题干必须带答题括号：单选/判断 2 字符间隙、多选 6 字符间隙
            body = escape(grading.ensure_answer_parens(it["stem"], it["qtype"]))
            parts.append(
                '<div class="q"><div class="stem"><span class="no">%d.</span>%s</div>%s</div>'
                % (it["pos"], body, _opts_html(it))
            )
        parts.append("</div>")

    if vm["with_answer"]:
        parts.append('<div class="answers"><h2>参考答案</h2><pre>')
        line = []
        for i, a in enumerate(vm["answer_sheet"], start=1):
            line.append("%d. %s" % (a["pos"], a["answer_text"]))
            if i % 6 == 0:
                parts.append(escape("　　".join(line)) + "\n")
                line = []
        if line:
            parts.append(escape("　　".join(line)) + "\n")
        parts.append("</pre>")
        parts.append('<div class="tip">说明：多选题须与标准答案完全一致才计分（漏选、错选均为 0 分）。</div>')
        parts.append("</div>")

    parts.append('<div class="footer-note">本试卷由「随题」生成</div>')
    parts.append("</body></html>")
    return "".join(parts)
