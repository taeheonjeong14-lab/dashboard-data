"""
Chrome Crashpad 미니덤프에서 "왜 죽었는지"만 뽑아낸다. WinDbg 없이 표준 라이브러리만 쓴다.

쓰는 법 (워커 머신):
    python scripts/read-crash-dump.py
    python scripts/read-crash-dump.py "C:\\경로\\어떤.dmp"

인자가 없으면 순위 전용 크롬 프로필의 Crashpad 폴더에서 최근 5개를 읽는다.

왜 이게 필요한가: 수집 실패 시각마다 크래시 덤프가 남는데(정담 11:37, 송정 13:10 …), 덤프를
열어보지 않으면 "크롬이 죽었다"에서 더 못 나간다. 예외 코드 하나로 방향이 갈린다 —
메모리 부족이면 주기적 재시작이 답이고, 접근 위반이면 특정 모듈 문제다.
"""
import struct
import sys
from pathlib import Path

DEFAULT_DIR = Path(r"C:\Projects\chrome-profiles\rank-nologin-9223\Crashpad\reports")

STREAM_MODULE_LIST = 4
STREAM_EXCEPTION = 6
STREAM_SYSTEM_INFO = 7
STREAM_MISC_INFO = 15

# 자주 나오는 예외 코드. Chrome 은 메모리 부족을 자체 코드로 올린다.
EXCEPTION_NAMES = {
    0xC0000005: ("ACCESS_VIOLATION", "잘못된 메모리 접근 — 크롬/드라이버 버그이거나 손상된 상태"),
    0xC00000FD: ("STACK_OVERFLOW", "스택 오버플로"),
    0xC0000409: ("STACK_BUFFER_OVERRUN", "스택 손상 감지(보안 검사에 걸려 강제 종료)"),
    0xC000001D: ("ILLEGAL_INSTRUCTION", "잘못된 명령"),
    0xC0000374: ("HEAP_CORRUPTION", "힙 손상"),
    0xE0000008: ("CHROME_OUT_OF_MEMORY", "크롬이 메모리 할당에 실패해 스스로 종료 — 메모리 부족"),
    0x80000003: ("BREAKPOINT", "디버그 중단점(대개 CHECK 실패 등 의도적 중단)"),
    0xE06D7363: ("CPP_EXCEPTION", "처리되지 않은 C++ 예외"),
}


def read_struct(buf, fmt, off):
    return struct.unpack_from(fmt, buf, off)


def read_mdstring(buf, rva):
    """MINIDUMP_STRING: 길이(4바이트, 바이트 단위) + UTF-16 본문."""
    if rva <= 0 or rva + 4 > len(buf):
        return ""
    (length,) = struct.unpack_from("<I", buf, rva)
    raw = buf[rva + 4 : rva + 4 + length]
    try:
        return raw.decode("utf-16-le", errors="replace")
    except Exception:
        return ""


def parse(path: Path) -> None:
    buf = path.read_bytes()
    if buf[:4] != b"MDMP":
        print(f"  ! 미니덤프 형식이 아님: {path.name}")
        return

    _, _, n_streams, dir_rva = struct.unpack_from("<4sIII", buf, 0)
    streams = {}
    for i in range(n_streams):
        st, size, rva = struct.unpack_from("<III", buf, dir_rva + i * 12)
        streams[st] = (size, rva)

    print(f"\n══ {path.name}  ({path.stat().st_size:,} bytes, {path.stat().st_mtime_ns // 10**9})")

    # ── 예외 정보
    exc_code = None
    exc_addr = None
    if STREAM_EXCEPTION in streams and streams[STREAM_EXCEPTION][1] + 32 <= len(buf):
        _, rva = streams[STREAM_EXCEPTION]
        # MINIDUMP_EXCEPTION_STREAM: ThreadId(4) + alignment(4) + MINIDUMP_EXCEPTION
        exc_code, exc_flags, _rec, exc_addr = struct.unpack_from("<IIQQ", buf, rva + 8)
        name, desc = EXCEPTION_NAMES.get(exc_code, ("UNKNOWN", "알려지지 않은 예외 코드"))
        print(f"   예외 코드 : 0x{exc_code:08X}  {name}")
        print(f"   설명      : {desc}")
        print(f"   주소      : 0x{exc_addr:016X}")
    else:
        print("   예외 스트림 없음 (강제 종료·행 등 예외 없이 남긴 덤프일 수 있음)")

    # ── 모듈 목록에서 예외 주소가 속한 모듈 찾기
    if STREAM_MODULE_LIST in streams and streams[STREAM_MODULE_LIST][1] + 4 <= len(buf):
        _, rva = streams[STREAM_MODULE_LIST]
        (n_mod,) = struct.unpack_from("<I", buf, rva)
        # 크래시 도중 잘린 덤프가 있을 수 있다 — 버퍼에 실제로 담긴 만큼만 읽는다.
        n_mod = min(n_mod, max(0, (len(buf) - rva - 4) // 108))
        base = rva + 4
        faulting = None
        chrome_ver = None
        for i in range(n_mod):
            off = base + i * 108
            # MINIDUMP_MODULE 앞부분: BaseOfImage(Q) SizeOfImage(I) CheckSum(I) TimeDateStamp(i) NameRva(I)
            base_img, size_img, _cs, _ts, name_rva = struct.unpack_from("<QIIiI", buf, off)
            mod_name = read_mdstring(buf, name_rva)
            short = mod_name.rsplit("\\", 1)[-1]
            if short.lower() == "chrome.dll":
                # VS_FIXEDFILEINFO 의 FileVersionMS/LS (오프셋: 24 + 8)
                ms, ls = struct.unpack_from("<II", buf, off + 24 + 8)
                chrome_ver = f"{ms >> 16}.{ms & 0xFFFF}.{ls >> 16}.{ls & 0xFFFF}"
            if exc_addr and base_img <= exc_addr < base_img + size_img:
                faulting = (short, exc_addr - base_img)
        print(f"   모듈 수   : {n_mod}")
        if chrome_ver:
            print(f"   chrome.dll: {chrome_ver}")
        if faulting:
            print(f"   ▶ 터진 모듈: {faulting[0]}  (+0x{faulting[1]:X})")
        elif exc_addr:
            print("   ▶ 터진 모듈: 모듈 범위 밖 (주소가 어느 모듈에도 속하지 않음)")


def main() -> None:
    args = sys.argv[1:]
    if args:
        targets = [Path(a) for a in args]
    else:
        if not DEFAULT_DIR.exists():
            print(f"덤프 폴더 없음: {DEFAULT_DIR}")
            sys.exit(1)
        targets = sorted(DEFAULT_DIR.glob("*.dmp"), key=lambda p: p.stat().st_mtime, reverse=True)[:5]
        if not targets:
            print(f"덤프 파일 없음: {DEFAULT_DIR}")
            sys.exit(1)

    print(f"덤프 {len(targets)}개 분석")
    for t in targets:
        try:
            parse(t)
        except Exception as e:  # 한 파일이 깨져도 나머지는 계속 본다
            print(f"  ! {t.name} 읽기 실패: {type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
