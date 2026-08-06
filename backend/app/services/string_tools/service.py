import base64
import gzip
import hashlib
import urllib.parse
import zlib

import brotli

# 解压输出上限（16MB）：输入上限为 1MB hex（约 0.5MB 压缩数据），
# 正常解压结果远小于此；16MB 足够覆盖正常场景，同时拦截解压炸弹
# （高膨胀压缩数据可膨胀数百倍）避免重复请求耗尽进程内存。
MAX_DECODED_BYTES = 16 * 1024 * 1024
_DECODE_CHUNK_SIZE = 64 * 1024

# 解压结果超过上限的文案，端点 catch ValueError 后作为 400 detail 返回
_DECODE_OVERFLOW_MESSAGE = "解压结果超过大小限制"


def encode_base64(text: str) -> str:
    """将字符串编码为 Base64。"""
    encoded_bytes = base64.b64encode(text.encode("utf-8"))
    return encoded_bytes.decode("utf-8")


def decode_base64(text: str) -> str:
    """解码 Base64 字符串。"""
    decoded_bytes = base64.b64decode(text.encode("utf-8"))
    return decoded_bytes.decode("utf-8")


def analyze_string(text: str) -> dict:
    """分析字符串并返回长度、单词数和行数。"""
    return {
        "length": len(text),
        "words": len(text.split()),
        "lines": len(text.splitlines()),
    }


def hash_md5(text: str) -> str:
    """计算字符串的 MD5 摘要（十六进制小写）。"""
    return hashlib.md5(text.encode("utf-8")).hexdigest()


def hash_sha1(text: str) -> str:
    """计算字符串的 SHA-1 摘要（十六进制小写）。"""
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def hash_sha256(text: str) -> str:
    """计算字符串的 SHA-256 摘要（十六进制小写）。"""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def hash_sha512(text: str) -> str:
    """计算字符串的 SHA-512 摘要（十六进制小写）。"""
    return hashlib.sha512(text.encode("utf-8")).hexdigest()


def url_encode(text: str) -> str:
    """URL 编码，对齐 JS 的 encodeURIComponent（对除字母数字外的所有字符编码）。"""
    return urllib.parse.quote(text, safe="")


def url_decode(text: str) -> str:
    """URL 解码，对齐 JS 的 decodeURIComponent。"""
    return urllib.parse.unquote(text)


def gzip_encode(text: str) -> str:
    """gzip 压缩字节的十六进制表示（小写）。"""
    return gzip.compress(text.encode("utf-8")).hex()


def gzip_decode(hex_text: str) -> str:
    """解码 gzip 压缩的十六进制字符串并返回 utf-8 文本。

    流式解压并限制输出上限（MAX_DECODED_BYTES），防止解压炸弹；超限抛 ValueError。
    """
    raw = bytes.fromhex(hex_text)
    decompressor = zlib.decompressobj(16 + zlib.MAX_WBITS)
    output = bytearray()
    for i in range(0, len(raw), _DECODE_CHUNK_SIZE):
        output.extend(decompressor.decompress(raw[i : i + _DECODE_CHUNK_SIZE]))
        if len(output) > MAX_DECODED_BYTES:
            raise ValueError(_DECODE_OVERFLOW_MESSAGE)
    output.extend(decompressor.flush())
    if len(output) > MAX_DECODED_BYTES:
        raise ValueError(_DECODE_OVERFLOW_MESSAGE)
    return output.decode("utf-8")


def deflate_encode(text: str) -> str:
    """deflate 压缩字节的十六进制表示（小写），对应 JS 的 deflateSync。"""
    return zlib.compress(text.encode("utf-8")).hex()


def deflate_decode(hex_text: str) -> str:
    """解码 deflate 压缩的十六进制字符串并返回 utf-8 文本。

    流式解压并限制输出上限（MAX_DECODED_BYTES），防止解压炸弹；超限抛 ValueError。
    """
    raw = bytes.fromhex(hex_text)
    decompressor = zlib.decompressobj()
    output = bytearray()
    for i in range(0, len(raw), _DECODE_CHUNK_SIZE):
        output.extend(decompressor.decompress(raw[i : i + _DECODE_CHUNK_SIZE]))
        if len(output) > MAX_DECODED_BYTES:
            raise ValueError(_DECODE_OVERFLOW_MESSAGE)
    output.extend(decompressor.flush())
    if len(output) > MAX_DECODED_BYTES:
        raise ValueError(_DECODE_OVERFLOW_MESSAGE)
    return output.decode("utf-8")


def brotli_encode(text: str) -> str:
    """brotli 压缩字节的十六进制表示（小写），对应 JS 的 brotliCompressSync。"""
    return brotli.compress(text.encode("utf-8")).hex()


def brotli_decode(hex_text: str) -> str:
    """解码 brotli 压缩的十六进制字符串并返回 utf-8 文本。

    流式解压并限制输出上限（MAX_DECODED_BYTES），防止解压炸弹；超限抛 ValueError。
    """
    raw = bytes.fromhex(hex_text)
    decompressor = brotli.Decompressor()
    output = bytearray()
    for i in range(0, len(raw), _DECODE_CHUNK_SIZE):
        output.extend(decompressor.process(raw[i : i + _DECODE_CHUNK_SIZE]))
        if len(output) > MAX_DECODED_BYTES:
            raise ValueError(_DECODE_OVERFLOW_MESSAGE)
    if not decompressor.is_finished():
        # 截断/损坏的 brotli 流，与 brotli.decompress 行为一致，视为无效数据
        raise ValueError("Invalid brotli data")
    return output.decode("utf-8")
