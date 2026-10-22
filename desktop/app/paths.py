# -*- coding: utf-8 -*-
"""路径解析：资源只读 _MEIPASS，数据只写 %APPDATA%。

铁律：
  * 冻结态前端资源在 sys._MEIPASS（只读、退出即删），绝不往那里写文件。
  * 所有用户数据（SQLite / 日志 / 导出件）都在 %APPDATA%\\SuiTi。
  * 内部标识一律 ASCII（SuiTi），对外展示用中文"随题"。
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

APP_NAME = "随题"
APP_ID = "SuiTi"
VERSION = "1.2.0"

FROZEN = bool(getattr(sys, "frozen", False))


def res_base() -> Path:
    """资源根目录：冻结态为 PyInstaller 解包目录，开发态为 app/ 目录。"""
    if FROZEN:
        return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return Path(__file__).resolve().parent


def gui_dir() -> Path:
    return res_base() / "gui"


def index_html() -> Path:
    return gui_dir() / "index.html"


def icon_path() -> Path:
    return gui_dir() / "assets" / "app.ico"


def data_dir() -> Path:
    base = os.environ.get("APPDATA") or str(Path.home())
    p = Path(base) / APP_ID
    p.mkdir(parents=True, exist_ok=True)
    return p


def db_path() -> Path:
    return data_dir() / "suiti.db"


def log_path() -> Path:
    return data_dir() / "app.log"


def export_dir() -> Path:
    p = data_dir() / "exports"
    p.mkdir(parents=True, exist_ok=True)
    return p


def tmp_html_dir() -> Path:
    p = Path(tempfile.gettempdir()) / "suiti_html"
    try:
        p.mkdir(parents=True, exist_ok=True)
    except OSError:
        p = data_dir() / "tmp_html"
        p.mkdir(parents=True, exist_ok=True)
    return p


def lock_path() -> Path:
    return data_dir() / ".lock"
