class DomainError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        self.status_code = status_code
        self.code = code
        self.message = message
        super().__init__(message)


def bad_request(code: str, message: str) -> DomainError:
    return DomainError(422, code, message)


def forbidden(message: str = "此操作不在目前身分的授權範圍內") -> DomainError:
    return DomainError(403, "forbidden", message)


def not_found(message: str = "找不到資源或沒有存取權限") -> DomainError:
    return DomainError(404, "not_found", message)


def conflict(code: str, message: str) -> DomainError:
    return DomainError(409, code, message)
