# -*- coding: utf-8 -*-
"""PDF 导出：生成打印用 HTML，交给 Edge headless 打印。

为什么不引入 reportlab/weasyprint：
  * reportlab 要自己重排中文版式，工作量大且版面难看；
  * weasyprint 在 Windows 上依赖 GTK，打包极麻烦。
Windows 10/11 自带 Edge（Chromium），`--headless=new --print-to-pdf` 中文渲染与分页最稳，
且零额外依赖。若被组策略禁用，退化为 Word COM 转 PDF（exporter 负责调度）。
"""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path

import paths

log = logging.getLogger("export.pdf")

CREATE_NO_WINDOW = 0x08000000
_EDGE_CACHE: str | None = None
_EDGE_TRIED = False


class PdfError(Exception):
    pass


def _registry_candidates() -> list[str]:
    out: list[str] = []
    try:
        import winreg
    except Exception:
        return out
    rel = r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"
    for hive in ("HKLM", "HKCU"):
        for flag in (0, getattr(winreg, "KEY_WOW64_64KEY", 0), getattr(winreg, "KEY_WOW64_32KEY", 0)):
            try:
                with winreg.OpenKey(getattr(winreg, hive), rel, 0, winreg.KEY_READ | flag) as k:
                    v, _ = winreg.QueryValueEx(k, "")
                    if v:
                        out.append(v)
            except Exception:
                continue
    return out


def find_edge(refresh: bool = False) -> str | None:
    """多路探测 msedge.exe，找到可用的绝对路径。"""
    global _EDGE_CACHE, _EDGE_TRIED
    if _EDGE_CACHE and not refresh:
        return _EDGE_CACHE
    if _EDGE_TRIED and not refresh:
        return _EDGE_CACHE

    _EDGE_TRIED = True
    cands: list[str] = []
    cands += _registry_candidates()
    for env in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"):
        base = os.environ.get(env)
        if base:
            cands.append(os.path.join(base, r"Microsoft\Edge\Application\msedge.exe"))
    cands += [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    which = shutil.which("msedge")
    if which:
        cands.append(which)
    for c in cands:
        try:
            if c and os.path.isfile(c):
                _EDGE_CACHE = c
                log.info("找到 Edge: %s", c)
                return c
        except OSError:
            continue
    _EDGE_CACHE = None
    log.warning("未找到 msedge.exe")
    return None


def _html_to_url(html_path: Path) -> str:
    return html_path.resolve().as_uri()


def render(html: str, out_path: str) -> str:
    """把 HTML 打印成 PDF，返回文件绝对路径。失败抛 PdfError。"""
    edge = find_edge()
    if not edge:
        raise PdfError("未找到 Microsoft Edge，无法生成 PDF")

    tmp_dir = paths.tmp_html_dir()
    html_path = tmp_dir / ("paper_%s.html" % uuid.uuid4().hex[:12])
    html_path.write_text(html, encoding="utf-8")

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        try:
            out.unlink()
        except OSError:
            pass

    profile = Path(tempfile.mkdtemp(prefix="suiti_edge_"))
    cmd = [
        edge,
        "--headless=new",
        "--disable-gpu",
        "--disable-extensions",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-features=Translate,msEdgeIdentityFeature",
        "--user-data-dir=%s" % profile,
        "--no-pdf-header-footer",
        "--print-to-pdf-no-header",
        "--virtual-time-budget=4000",
        "--print-to-pdf=%s" % str(out),
        _html_to_url(html_path),
    ]
    log.info("Edge 打印 PDF: %s", out)
    proc = None
    try:
        proc = subprocess.run(
            cmd,
            timeout=90,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=CREATE_NO_WINDOW,
        )
    except subprocess.TimeoutExpired:
        raise PdfError("Edge 打印超时（90 秒）")
    except OSError as e:
        raise PdfError("无法启动 Edge：%s" % e)
    finally:
        try:
            html_path.unlink()
        except OSError:
            pass

    err = (proc.stderr or b"").decode("utf-8", "ignore").strip()
    if err:
        log.debug("edge stderr: %s", err[-800:])

    if not out.exists() or out.stat().st_size < 1024:
        raise PdfError("Edge 未生成有效 PDF（退出码 %s）%s" % (proc.returncode, ("：" + err[-300:]) if err else ""))

    with open(out, "rb") as f:
        head = f.read(4)
    if head != b"%PDF":
        try:
            out.unlink()
        except OSError:
            pass
        raise PdfError("生成的文件不是有效 PDF")

    log.info("PDF 生成成功 %.1f KB", out.stat().st_size / 1024.0)
    _cleanup(profile)
    return str(out.resolve())


def _cleanup(profile: Path) -> None:
    """WebView2/Edge 退出后 profile 目录可能被占用，尽力清理即可。"""
    try:
        shutil.rmtree(profile, ignore_errors=True)
    except Exception:
        pass


def docx_to_pdf(docx_path: str, out_path: str) -> str:
    """兜底：用本机 Word COM 转 PDF。"""
    try:
        import win32com.client as win32
    except Exception as e:
        raise PdfError("未安装 pywin32，无法走 Word 转 PDF：%s" % e)

    out = os.path.abspath(out_path)
    src = os.path.abspath(docx_path)
    app = None
    try:
        app = win32.DispatchEx("Word.Application")
        app.Visible = False
        app.DisplayAlerts = 0
        doc = app.Documents.Open(src, ReadOnly=True)
        try:
            doc.SaveAs2(out, FileFormat=17)  # wdFormatPDF
        finally:
            doc.Close(False)
        if not os.path.exists(out) or os.path.getsize(out) < 1024:
            raise PdfError("Word 未生成有效 PDF")
        return out
    except PdfError:
        raise
    except Exception as e:
        raise PdfError("Word 转 PDF 失败：%s" % e)
    finally:
        if app is not None:
            try:
                app.Quit()
            except Exception:
                pass
