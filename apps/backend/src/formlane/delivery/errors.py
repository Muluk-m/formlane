"""Delivery failures that bypass recoverable model tool errors."""


class HarnessFailure(BaseException):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


class RuntimeAbort(BaseException):
    """A producer failure must bypass CrewAI's recoverable tool-error narration."""

    def __init__(self, cause: BaseException):
        self.cause = cause
        super().__init__("Execution authority or provider unavailable.")
