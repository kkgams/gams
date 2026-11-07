#!/usr/bin/env python3
"""Temporary native-loader probe for the v3 Windows CI failure."""
import argparse
import ctypes
import os
from pathlib import Path
import struct

PREFIX = "[DEBUG-v3-win]"


def imports(path):
    data = path.read_bytes()
    u16 = lambda offset: struct.unpack_from("<H", data, offset)[0]
    u32 = lambda offset: struct.unpack_from("<I", data, offset)[0]
    pe = u32(0x3C)
    if data[pe:pe + 4] != b"PE\0\0":
        raise ValueError(f"Not a PE image: {path}")
    optional = pe + 24
    is64 = u16(optional) == 0x20B
    directories = optional + (112 if is64 else 96)
    sections = optional + u16(pe + 20)
    mapping = []
    for index in range(u16(pe + 6)):
        section = sections + 40 * index
        mapping.append((u32(section + 12), max(u32(section + 8), u32(section + 16)), u32(section + 20)))

    def offset(rva):
        for start, size, raw in mapping:
            if start <= rva < start + size:
                return raw + rva - start
        if rva < u32(optional + 60):
            return rva
        raise ValueError(f"Unmapped RVA {rva:x}")

    def string(rva):
        start = offset(rva)
        return data[start:data.index(b"\0", start)].decode("ascii")

    import_rva = u32(directories + 8)
    if not import_rva:
        return {}
    descriptor = offset(import_rva)
    result = {}
    while any(data[descriptor:descriptor + 20]):
        names = []
        thunk = offset(u32(descriptor) or u32(descriptor + 16))
        width = 8 if is64 else 4
        while True:
            value = struct.unpack_from("<Q" if is64 else "<I", data, thunk)[0]
            if not value:
                break
            names.append(value & 0xFFFF if value >> (width * 8 - 1) else string(value + 2))
            thunk += width
        result[string(u32(descriptor + 12))] = names
        descriptor += 20
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path)
    parser.add_argument("--imports-only", action="store_true")
    args = parser.parse_args()
    required = imports(args.image)
    print(PREFIX, "IMAGE", args.image, flush=True)
    if args.imports_only:
        for dll, symbols in required.items():
            print(PREFIX, dll, symbols, flush=True)
        return
    if os.name != "nt":
        raise RuntimeError("Runtime probing requires Windows")
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.GetProcAddress.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    kernel.GetProcAddress.restype = ctypes.c_void_p
    kernel.GetModuleFileNameW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_uint32]
    kernel.GetModuleFileNameW.restype = ctypes.c_uint32
    kernel.SetErrorMode(0x0001 | 0x0002 | 0x8000)
    missing = 0
    for dll, symbols in required.items():
        try:
            module = ctypes.WinDLL(dll, use_last_error=True)
        except OSError as error:
            print(PREFIX, "LOAD-FAIL", dll, str(error), flush=True)
            missing += 1
            continue
        buffer = ctypes.create_unicode_buffer(32768)
        kernel.GetModuleFileNameW(module._handle, buffer, len(buffer))
        print(PREFIX, "MODULE", dll, buffer.value, flush=True)
        for symbol in symbols:
            encoded = ctypes.c_char_p(symbol.encode("ascii")) if isinstance(symbol, str) else ctypes.c_void_p(symbol)
            pointer = ctypes.cast(encoded, ctypes.c_void_p)
            if not kernel.GetProcAddress(module._handle, pointer):
                print(PREFIX, "MISSING", dll, symbol, "in", buffer.value, flush=True)
                missing += 1
    print(PREFIX, "MISSING-COUNT", missing, flush=True)


if __name__ == "__main__":
    main()
