import bcrypt


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        password_bytes = plain_password.encode("utf-8")[:72]
        return bcrypt.checkpw(password_bytes, hashed_password.encode("utf-8"))
    except ValueError:
        return False


def get_password_hash(password: str) -> str:
    salt = bcrypt.gensalt()
    # truncate to 72 bytes to match bcrypt limitations
    password_bytes = password.encode("utf-8")[:72]
    hashed_bytes = bcrypt.hashpw(password_bytes, salt)
    return hashed_bytes.decode("utf-8")


def _token_version_from_payload(payload: dict) -> int:
    """从 JWT payload 读取 tv；缺省或非法视为 0。"""
    raw = payload.get("tv", 0)
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0
