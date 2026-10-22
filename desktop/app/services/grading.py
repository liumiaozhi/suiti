# -*- coding: utf-8 -*-
"""判题核心：答案归一化、打乱映射、判分。

唯一不变式（全工程最重要的约定）：
    answer_disp（展示下标）在"建会话"时一次算定并写进 session_items，
    之后前端渲染、后端判分、导出 PDF/Word/Excel 三方都只读它，
    任何地方都不许再做第二次映射。违反这条必然出现"点对判错"。
"""
from __future__ import annotations

import random
import re
import unicodedata

from errors import UserError

# 题型：固定展示顺序
QTYPES = ("single", "multi", "judge")
QTYPE_LABEL = {"single": "单选题", "multi": "多选题", "judge": "判断题"}
QTYPE_NAME = {"single": "单项选择题", "multi": "多项选择题", "judge": "判断题"}
CN_NUM = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"]

JUDGE_OPTIONS = ["正确", "错误"]

JUDGE_TRUE = {"对", "正确", "是", "√", "✓", "✔", "T", "TRUE", "Y", "YES", "1", "TURE"}
JUDGE_FALSE = {"错", "错误", "否", "×", "✗", "✘", "X", "F", "FALSE", "N", "NO", "0", "不"}

_SEP = " \t\r\n\u00a0\u3000,，、;；/|·.。:：()（）[]【】{}<>\"'“”‘’_-－—~*"
_SEP_RE = r"[\s\u00a0\u3000,，、;；/|·.。:：()（）\[\]【】{}<>\"'“”‘’_\-－—~*]+"
_LABEL_RE = re.compile(r"^[\s(（\[]*[A-Za-z1-9][\s)）\].、,:：]+")


class AnswerError(UserError):
    """答案无法解析 / 与选项不匹配。"""

    def __init__(self, msg: str, code: str = "ANSWER_INVALID"):
        super().__init__(msg, code)


def strip_sep(text: str) -> str:
    return re.sub(_SEP_RE, "", text or "")


def strip_label(text: str) -> str:
    """去掉选项前缀标签：'A. foo' / 'A、foo' / '（1）foo' / '1. foo' -> 'foo'。"""
    t = (text or "").strip()
    prev = None
    while prev != t:
        prev = t
        t = _LABEL_RE.sub("", t).strip()
    return t


def normalize_text(raw) -> str:
    return unicodedata.normalize("NFKC", str(raw if raw is not None else "")).strip()


def parse_answer(raw, qtype: str, options: list[str]) -> list[int]:
    """把 Excel 里五花八门的答案写法解析成 0 基下标列表（升序去重）。

    支持：ABD / A,B,D / A B D / （A）（B） / b、a、d / 1,3 / 对 / √ / T / 正确 / A
    失败抛 AnswerError（绝不静默返回空列表 —— 宁可拒绝导入也不能带病入库）。
    """
    s = normalize_text(raw)
    if not s:
        raise AnswerError("答案为空")
    up = s.upper()
    compact = strip_sep(up)
    n = len(options)

    # 判断题：先走语义集合
    if qtype == "judge":
        if compact in JUDGE_TRUE:
            return [0]
        if compact in JUDGE_FALSE:
            return [1]
        if compact == "A":
            return [0]
        if compact == "B":
            return [1]

    # 数字编号（1 基；若出现 0 则按 0 基处理）
    if re.fullmatch(r"[\s\u3000,，、;；/|]*\d+([\s\u3000,，、;；/|]+\d+)+[\s\u3000,，、;；/|]*", s) or re.fullmatch(
        r"[\s\u3000]*\d+[\s\u3000]*", s
    ):
        nums = [int(x) for x in re.findall(r"\d+", s)]
        if all(1 <= v <= n for v in nums):
            idx = sorted({v - 1 for v in nums})
            return idx
        if all(0 <= v <= n - 1 for v in nums):
            return sorted(set(nums))

    # 字母串
    if compact and re.fullmatch(r"[A-Z]+", compact):
        idx = sorted({ord(c) - 65 for c in compact})
        if idx[-1] >= n:
            ok = "".join(chr(65 + i) for i in range(n))
            raise AnswerError("答案字母超出选项范围（本题只有 %d 个选项：%s）" % (n, ok))
        return idx

    # 兜底一：答案直接写成选项文本
    cleaned = strip_label(s)
    hits = [i for i, o in enumerate(options) if strip_label(o) == cleaned]
    if len(hits) == 1:
        return hits

    # 兜底二：多个选项文本用分隔符拼接
    parts = [p for p in re.split(_SEP_RE, s) if p.strip()]
    if len(parts) > 1:
        out = set()
        for p in parts:
            h = [i for i, o in enumerate(options) if strip_label(o) == strip_label(p)]
            if len(h) != 1:
                raise AnswerError("答案无法识别：%s" % s)
            out.add(h[0])
        if out:
            return sorted(out)

    raise AnswerError("答案无法识别：%s" % s)


def idx_to_letters(idxs) -> str:
    return ",".join(chr(65 + i) for i in idxs)


def parse_qtype(raw) -> str:
    """题型文本 -> single/multi/judge。"""
    s = normalize_text(raw).lower()
    if not s:
        raise AnswerError("题型为空")
    if "多" in s or "multi" in s or s in {"2", "多选", "多项"}:
        return "multi"
    if "判断" in s or "judge" in s or "tf" in s or s in {"3", "对错"}:
        return "judge"
    if "单" in s or "single" in s or "radio" in s or s in {"1", "选择"}:
        return "single"
    raise AnswerError("题型无法识别：%s（应为 单选/多选/判断）" % raw)


def build_display_order(n: int, shuffle: bool, rng: random.Random | None = None) -> list[int]:
    """返回展示序 -> 原始下标 的数组。order[k] = 第 k 个展示的是原第几个选项。"""
    order = list(range(n))
    if shuffle:
        (rng or random).shuffle(order)
    return order


def map_answer(answer_orig: list[int], order: list[int]) -> list[int]:
    """把原始答案下标映射为展示下标（升序）。order 见 build_display_order。"""
    inv = {orig: disp for disp, orig in enumerate(order)}
    return sorted(inv[a] for a in answer_orig if a in inv)


def display_options(options: list[str], order: list[int]) -> list[str]:
    return [options[i] for i in order]


def answer_text(qtype: str, options_display: list[str], answer_disp: list[int]) -> str:
    """答案展示文本：判断题给"正确/错误"，其余给字母串。"""
    if qtype == "judge":
        if answer_disp and 0 <= answer_disp[0] < len(options_display):
            return options_display[answer_disp[0]]
        return ""
    return idx_to_letters(answer_disp)


def is_correct(chosen: list[int], answer_disp: list[int], qtype: str) -> bool:
    """多选全对才得分；单选/判断等价于单元素集合比较。"""
    c = sorted(set(int(x) for x in (chosen or [])))
    a = sorted(set(int(x) for x in (answer_disp or [])))
    if not c:
        return False
    return c == a


def sel_text(qtype: str, options_display: list[str], idxs: list[int] | None) -> str:
    """作答/答案的展示文本：判断题给选项文本，其余给字母串；未作答给空串。"""
    if not idxs:
        return ""
    idxs = sorted(set(int(i) for i in idxs))
    if qtype == "judge":
        if 0 <= idxs[0] < len(options_display):
            return options_display[idxs[0]]
        return ""
    return idx_to_letters(idxs)


def group_title(order_index: int, qtype: str) -> str:
    num = CN_NUM[order_index] if order_index < len(CN_NUM) else str(order_index + 1)
    return "%s、%s" % (num, QTYPE_NAME.get(qtype, "题目"))


def fmt_score(v) -> str:
    if v is None:
        return "0"
    f = float(v)
    if abs(f - round(f)) < 1e-9:
        return str(int(round(f)))
    return ("%.2f" % f).rstrip("0").rstrip(".")


def accuracy(right: int, base: int) -> float:
    if not base:
        return 0.0
    return round(right * 100.0 / base, 1)


# ---------------------------------------------------------------- 答题括号
# 导出的纸面必须留出作答位置：题干里已有「空括号」就地按题型统一宽度，
# 没有空括号（含只有「（2015 年修订）」这类有内容的括号）就在题干末尾补一个。
PAREN_GAP = {"single": 2, "judge": 2, "multi": 6}  # 括号中间留几个全角字符
_BLANK_PAREN_RE = re.compile(r"[（(][\s\u3000]*[）)]")


def blank_paren(gap: int) -> str:
    return "（" + "\u3000" * max(1, gap) + "）"


def ensure_answer_parens(stem: str, qtype: str) -> str:
    """保证题干带一个空括号，且括号中间宽度按题型固定。"""
    s = (stem or "").rstrip()
    gap = PAREN_GAP.get(qtype, 2)
    pat = blank_paren(gap)
    if _BLANK_PAREN_RE.search(s):
        return _BLANK_PAREN_RE.sub(pat, s)
    if not s:
        return pat
    return s + "\u3000" + pat
