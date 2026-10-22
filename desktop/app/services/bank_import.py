# -*- coding: utf-8 -*-
"""题库模板生成与上传解析。

模板同时支持两种"选项"写法（用户明确要求）：
  写法一（推荐，选项数量不限）：把选项都塞进「选项」一列，用 | 或 Alt+Enter 换行分隔；
  写法二（最直观，最多 8 个）：分别填「选项A」…「选项H」。
解析时优先取「选项」列，该列为空时才去读 选项A~H。

导入原则：宁可整个文件不入库，也不带病入库 —— 任何一行解析失败都会中止该文件并报出行号。
"""
from __future__ import annotations

import os
import re

from services import grading

TEMPLATE_NAME = "随题-题库导入模板.xlsx"

# 模板表头（顺序即列序）
HEADERS = [
    "题型",
    "题干",
    "选项",
    "选项A",
    "选项B",
    "选项C",
    "选项D",
    "选项E",
    "选项F",
    "选项G",
    "选项H",
    "正确答案",
]

COL_WIDTHS = [10, 62, 34, 20, 20, 20, 18, 16, 16, 16, 16, 14]

SAMPLE_ROWS = [
    [
        "单选",
        "我国法定存款准备金制度由（　）负责统一实施。",
        "中国人民银行|国家金融监督管理总局|财政部|商业银行",
        "", "", "", "", "", "", "", "",
        "A",
    ],
    [
        "多选",
        "下列属于商业银行流动性资产的有（　）。",
        "库存现金|存放中央银行款项|固定资产|一个月内到期的拆放同业",
        "", "", "", "", "", "", "", "",
        "ABD",
    ],
    [
        "判断",
        "同业存单属于商业银行的负债业务。",
        "", "", "", "", "", "", "", "", "", "",
        "正确",
    ],
    # 写法二示例：答案写成 选项文本 也支持
    [
        "单选",
        "（示例二：用 A~H 分列填写选项）以下属于信用风险缓释工具的是（　）。",
        "",
        "合格保证", "抵押品", "净额结算", "",
        "", "", "", "", "",
        "A,B",
    ],
]

GUIDE_LINES = [
    ("随题 · 题库导入模板 使用说明", "title"),
    ("", ""),
    ("一、整体要求", "h"),
    ("1. 请在「题库」工作表中填写，一行一道题；表头行请勿修改、删除或调换顺序。", ""),
    ("2. 一个文件导入后生成一个题库，题库名称取文件名（可含中文）。文件格式必须是 .xlsx。", ""),
    ("3. 题型只能填：单选 / 多选 / 判断（也接受 单选题、多项选择题 等写法）。", ""),
    ("", ""),
    ("二、选项怎么填（两种写法二选一）", "h"),
    ("写法一（推荐，选项数量真正不限）：只填「选项」这一列，多个选项用竖线 | 或 Alt+Enter 换行分隔。", ""),
    ("        示例：中国人民银行|国家金融监督管理总局|财政部", ""),
    ("写法二（最直观，最多 8 个）：分别填「选项A」到「选项H」，每列一个选项。", ""),
    ("注意：「选项」列与「选项A~H」同时填写时，只认「选项」列。", ""),
    ("判断题不需要填选项，程序自动按「正确 / 错误」两选项处理。", ""),
    ("选项前可以带 A. A、 （1） 这类序号，程序会自动去掉。", ""),
    ("", ""),
    ("三、正确答案怎么写", "h"),
    ("单选：填一个字母，如 A", ""),
    ("多选：填多个字母，如 ABD 或 A,B,D 或 A、B、D", ""),
    ("判断：填 正确 / 错误（也接受 对、错、√、×、T、F、是、否、A、B）", ""),
    ("也允许直接填写选项的完整内容（程序会按文本匹配）。", ""),
    ("", ""),
    ("四、常见错误（出现即整个文件不予导入，并提示行号）", "h"),
    ("· 答案字母超出选项数量（例如只有 4 个选项却填了 E）", ""),
    ("· 单选题/判断题的正确答案不是 1 个", ""),
    ("· 题干为空、选项少于 2 个、题型写法无法识别", ""),
    ("· 文件为 .xls 老格式 —— 请在 Excel 中「另存为」.xlsx 后再导入", ""),
    ("", ""),
    ("五、提示", "h"),
    ("· 多选题只有 1 个正确项时会导入成功但给出提醒，请自行核对。", ""),
    ("· 同一题库内题干重复不会阻止导入，但会在导入结果里给出提醒。", ""),
]


def build_template(path: str) -> str:
    """生成导入模板（含示例行 + 说明页）。"""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = "题库"

    head_fill = PatternFill("solid", fgColor="1F5FD0")
    head_font = Font(name="微软雅黑", size=10, bold=True, color="FFFFFF")
    body_font = Font(name="微软雅黑", size=10)
    thin = Side(style="thin", color="C9D6E8")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    ws.append(HEADERS)
    for c in range(1, len(HEADERS) + 1):
        cell = ws.cell(row=1, column=c)
        cell.fill = head_fill
        cell.font = head_font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = border
        ws.column_dimensions[get_column_letter(c)].width = COL_WIDTHS[c - 1]
    ws.row_dimensions[1].height = 26

    for row in SAMPLE_ROWS:
        ws.append(row)
    for r in range(2, 2 + len(SAMPLE_ROWS)):
        for c in range(1, len(HEADERS) + 1):
            cell = ws.cell(row=r, column=c)
            cell.font = body_font
            cell.alignment = Alignment(vertical="top", wrap_text=True, horizontal="center" if c in (1, 11) else "left")
            cell.border = border
        ws.row_dimensions[r].height = 34

    for r in range(2 + len(SAMPLE_ROWS), 302):
        for c in range(1, len(HEADERS) + 1):
            cell = ws.cell(row=r, column=c)
            cell.font = body_font
            cell.alignment = Alignment(vertical="top", wrap_text=True, horizontal="center" if c in (1, 11) else "left")
            cell.border = border

    ws.freeze_panes = "A2"

    try:
        from openpyxl.worksheet.datavalidation import DataValidation

        dv = DataValidation(type="list", formula1='"单选,多选,判断"', allow_blank=True)
        dv.error = "请选择 单选 / 多选 / 判断"
        dv.errorTitle = "题型"
        ws.add_data_validation(dv)
        dv.add("A2:A3000")
    except Exception:
        pass

    gs = wb.create_sheet("填写说明")
    gs.column_dimensions["A"].width = 112
    for i, (text, kind) in enumerate(GUIDE_LINES, start=1):
        cell = gs.cell(row=i, column=1, value=text)
        if kind == "title":
            cell.font = Font(name="微软雅黑", size=14, bold=True, color="1F5FD0")
        elif kind == "h":
            cell.font = Font(name="微软雅黑", size=11, bold=True, color="0F172A")
        else:
            cell.font = Font(name="微软雅黑", size=10, color="334155")
        cell.alignment = Alignment(vertical="center", wrap_text=False)

    wb.save(path)
    return path


# ---------------- 解析 ----------------

_HEAD_ALIAS = {
    "题型": "qtype",
    "类型": "qtype",
    "题目类型": "qtype",
    "题干": "stem",
    "题目": "stem",
    "问题": "stem",
    "题目内容": "stem",
    "选项": "options",
    "选项内容": "options",
    "备选项": "options",
    "正确答案": "answer",
    "答案": "answer",
    "标准答案": "answer",
    "正确选项": "answer",
    "参考答案": "answer",
}

_OPT_COL_RE = re.compile(r"^选项\s*([A-Z])$")

_SPLIT_RE = re.compile(r"[|\r\n]+")


def _head_key(text) -> str:
    s = grading.normalize_text(text)
    if not s:
        return ""
    s = re.split(r"[（(]", s)[0].strip()
    s = s.replace(" ", "").replace("\u3000", "")
    return s


def _cell_text(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and abs(v - round(v)) < 1e-9:
        return str(int(round(v)))
    return str(v).strip()


def _find_header(ws) -> tuple[int, dict[str, int], dict[str, int]]:
    """返回 (表头所在行号, 字段->列号, 选项字母->列号)。"""
    for row_idx, row in enumerate(ws.iter_rows(min_row=1, max_row=min(15, ws.max_row), values_only=True), start=1):
        mapped: dict[str, int] = {}
        opt_cols: dict[str, int] = {}
        for col_idx, raw in enumerate(row, start=1):
            key = _head_key(raw)
            if not key:
                continue
            m = _OPT_COL_RE.match(key)
            if m:
                opt_cols[m.group(1)] = col_idx
                continue
            field = _HEAD_ALIAS.get(key)
            if field and field not in mapped:
                mapped[field] = col_idx
        if "stem" in mapped and ("qtype" in mapped or "answer" in mapped):
            return row_idx, mapped, opt_cols
    return 0, {}, {}


def parse_workbook(path: str) -> dict:
    """解析题库文件，返回 {"questions":[...], "errors":[...], "warnings":[...]}。"""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".xls":
        raise grading.AnswerError("不支持 .xls 老格式，请在 Excel 中另存为 .xlsx 后再导入")
    if ext not in (".xlsx", ".xlsm"):
        raise grading.AnswerError("只支持 .xlsx 文件")

    from openpyxl import load_workbook

    wb = load_workbook(path, read_only=True, data_only=True)
    try:
        ws = wb["题库"] if "题库" in wb.sheetnames else wb[wb.sheetnames[0]]
        head_row, colmap, opt_cols = _find_header(ws)
        if not head_row:
            raise grading.AnswerError("找不到表头行，请使用「下载模板」生成的表格填写（需包含「题干」「正确答案」列）")

        questions: list[dict] = []
        errors: list[dict] = []
        warnings: list[dict] = []
        seen: dict[str, int] = {}

        for row_idx, row in enumerate(ws.iter_rows(min_row=head_row + 1, values_only=True), start=head_row + 1):
            def cell(field):
                idx = colmap.get(field)
                if not idx or idx - 1 >= len(row):
                    return ""
                return _cell_text(row[idx - 1])

            stem = cell("stem")
            qtype_raw = cell("qtype")
            ans_raw = cell("answer")
            opt_col_text = cell("options")

            if not stem and not qtype_raw and not ans_raw and not opt_col_text:
                continue
            if not stem:
                errors.append({"row": row_idx, "msg": "题干为空"})
                continue

            try:
                qtype = grading.parse_qtype(qtype_raw)
            except grading.AnswerError as e:
                errors.append({"row": row_idx, "msg": str(e)})
                continue

            options: list[str] = []
            if qtype == "judge":
                options = list(grading.JUDGE_OPTIONS)
                if opt_col_text:
                    warnings.append({"row": row_idx, "msg": "判断题的选项已自动按「正确/错误」处理，填写的选项被忽略"})
            else:
                if opt_col_text:
                    parts = [grading.strip_label(p) for p in _SPLIT_RE.split(opt_col_text)]
                    options = [p for p in parts if p]
                else:
                    for letter in sorted(opt_cols):
                        idx = opt_cols[letter]
                        if idx - 1 < len(row):
                            t = grading.strip_label(_cell_text(row[idx - 1]))
                            if t:
                                options.append(t)
                if len(options) < 2:
                    errors.append({"row": row_idx, "msg": "选项少于 2 个（请用 | 或换行分隔，或填 选项A~H）"})
                    continue

            try:
                answer = grading.parse_answer(ans_raw, qtype, options)
            except grading.AnswerError as e:
                errors.append({"row": row_idx, "msg": str(e)})
                continue

            if qtype in ("single", "judge") and len(answer) != 1:
                errors.append({"row": row_idx, "msg": "%s只能有 1 个正确答案，当前解析出 %d 个" % (grading.QTYPE_LABEL[qtype], len(answer))})
                continue
            if qtype == "multi" and len(answer) < 2:
                warnings.append({"row": row_idx, "msg": "多选题只有 1 个正确答案，请核对"})

            answer_text = grading.answer_text(qtype, options, answer)
            key = stem + "\u0001" + "|".join(options)
            if key in seen:
                warnings.append({"row": row_idx, "msg": "与第 %d 行题干重复" % seen[key]})
            else:
                seen[key] = row_idx

            questions.append(
                {
                    "qtype": qtype,
                    "stem": stem,
                    "options": options,
                    "answer": answer,
                    "answer_text": answer_text,
                    "source_row": row_idx,
                    "raw_type": qtype_raw,
                }
            )

        return {"questions": questions, "errors": errors, "warnings": warnings}
    finally:
        wb.close()
