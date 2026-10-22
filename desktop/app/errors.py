# -*- coding: utf-8 -*-
"""面向用户的业务异常：message 会原样展示在前端提示里。"""


class UserError(Exception):
    def __init__(self, msg: str, code: str = "BAD_INPUT", detail=None):
        super().__init__(msg)
        self.code = code
        self.msg = msg
        self.detail = detail or {}
