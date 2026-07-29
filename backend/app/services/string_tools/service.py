import base64


def encode_base64(text: str) -> str:
    """Encode a string to Base64."""
    encoded_bytes = base64.b64encode(text.encode("utf-8"))
    return encoded_bytes.decode("utf-8")


def decode_base64(text: str) -> str:
    """Decode a Base64 string."""
    decoded_bytes = base64.b64decode(text.encode("utf-8"))
    return decoded_bytes.decode("utf-8")


def analyze_string(text: str) -> dict:
    """Analyze a string and return length, word count, and line count."""
    return {
        "length": len(text),
        "words": len(text.split()),
        "lines": len(text.splitlines()),
    }
