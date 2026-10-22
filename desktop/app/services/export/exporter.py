# -*- coding: utf-8 -*-
"""导出调度：格式分发、保存对话框、文件名清洗。"""
from __future__ import annotations

import logging
import os
import re
import tempfile
from datetime import datetime

import paths
from errors import UserError
from services.export import html_tpl, model, to_docx, to_pdf, to_xlsx

log = logging.getLogger("export")

FMT_EXT = {"pdf": "pdf", "docx": "docx", "xlsx": "xlsx"}
FMT_LABEL = {"pdf": "PDF 文件", "docx": "Word 文件", "xlsx": "Excel 文件"}

_BAD = re.compile(r'[\\/:*?"<>|\r\n\t]+')


def sanitize(name: str, limit: int = 110) -> str:
    s = _BAD.sub("_", (name or "").strip())
    s = re.sub(r"\s+", " ", s).strip(" ._")
    if not s:
        s = "试卷"
    return s[:limit]


def default_filename(vm: dict, ext: str) -> str:
    """默认文件名同样只用题库名（不带练习/考试字样），保留时间戳避免重名覆盖。"""
    ts = datetime.now().strftime("%Y%m%d_%H%M")
    parts = [vm["bank_name"] or "试卷", ts]
    if vm.get("candidate"):
        parts.append(vm["candidate"])
    return sanitize("_".join(parts)) + "." + ext

def _ask_save(window, filename: str, fmt: str) -> str | None:
    """原生保存对话框；取消返回 None。"""
    if window is None:
        return str(paths.export_dir() / filename)
    import webview

    try:
        result = window.create_file_dialog(
            webview.SAVE_DIALOG,
            directory=str(paths.export_dir()),
            save_filename=filename,
            file_types=("所有文件 (*.*)",) if fmt else (),
        )
    except Exception as e:
        log.warning("保存对话框失败，落到默认导出目录: %s", e)
        return str(paths.export_dir() / filename)

    if not result:
        return None
    if isinstance(result, (list, tuple)):
        result = result[0] if result else None
    if not result:
        return None
    out = str(result)
    if not os.path.splitext(out)[1]:
        out += "." + FMT_EXT[fmt]
    return out


def export_paper(session_id: int, fmt: str, window=None, with_answer: bool = True) -> dict:
    if fmt not in FMT_EXT:
        raise UserError("不支持的导出格式：%s" % fmt)
    vm = model.build(session_id, with_answer)
    return _write(vm, fmt, window)


def export_hard(bank_id: int, fmt: str, window=None, with_answer: bool = True) -> dict:
    """把某个题库的重难错题整份导出。"""
    if fmt not in FMT_EXT:
        raise UserError("不支持的导出格式：%s" % fmt)
    vm = model.build_hard(bank_id, with_answer)
    if not vm["total"]:
        raise UserError("这个题库还没有重难错题")
    return _write(vm, fmt, window)


def _write(vm: dict, fmt: str, window=None) -> dict:
    fname = default_filename(vm, FMT_EXT[fmt])
    out = _ask_save(window, fname, fmt)
    if out is None:
        return {"saved": False, "cancelled": True}

    out_dir = os.path.dirname(os.path.abspath(out))
    if out_dir and not os.path.isdir(out_dir):
        os.makedirs(out_dir, exist_ok=True)

    warning = ""
    if fmt == "xlsx":
        to_xlsx.build_xlsx(vm, out)
    elif fmt == "docx":
        to_docx.build_docx(vm, out)
    else:
        html = html_tpl.render_html(vm)
        try:
            to_pdf.render(html, out)
        except to_pdf.PdfError as e:
            log.warning("Edge 打印 PDF 失败，改走 Word 转换：%s", e)
            tmp_docx = os.path.join(tempfile.gettempdir(), "_suiti_tmp_%d.docx" % os.getpid())
            try:
                to_docx.build_docx(vm, tmp_docx)
                to_pdf.docx_to_pdf(tmp_docx, out)
                warning = "本机 Edge 打印不可用，已改用 Word 转换生成 PDF。"
            except Exception as e2:
                raise UserError(
                    "PDF 生成失败：%s\n建议先导出 Word，再用 Word「另存为 PDF」。" % e2,
                    "PDF_FAILED",
                )
            finally:
                try:
                    os.remove(tmp_docx)
                except OSError:
                    pass

    log.info("导出完成 %s -> %s", fmt, out)
    return {"saved": True, "path": out, "filename": os.path.basename(out), "warning": warning}


def open_folder(path: str) -> dict:
    p = path
    if p and os.path.isfile(p):
        p = os.path.dirname(p)
    if not p or not os.path.isdir(p):
        p = str(paths.export_dir())
    try:
        os.startfile(p)  # noqa: S606  (Windows 专用)
        return {"opened": True, "path": p}
    except Exception as e:
        raise UserError("无法打开文件夹：%s" % e)
