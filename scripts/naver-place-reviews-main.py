"""
네이버 스마트플레이스 "방문자 리뷰" 수집기 (독립 매크로 · 로그인 불필요)

- 순위 수집(naver-rank-main.py)과는 완전히 별개. 병원별 core.hospitals.smartplace_review_url 을 연다.
- 순수 HTTP 호출은 네이버 봇탐지(x-wtm-ncaptcha-token)·429 로 막혀서, Playwright(실브라우저)로 페이지를 열고
  네이버가 스스로 호출하는 GraphQL 응답(pcmap-api.place.naver.com/graphql)을 가로채서 리뷰 JSON 만 뽑는다.
- 최근 N개월(기본 6) 리뷰를 analytics.analytics_place_reviews 에 upsert (sentiment=null, 레이블링은 별도 잡).

환경변수:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (필수)
  COLLECT_HOSPITAL_ID   (선택) — 지정 시 그 병원만
  REVIEW_MONTHS         (선택, 기본 6)
  REVIEW_HEADLESS       (선택, 기본 "1" → 헤드리스. "0" 이면 브라우저 띄움)
  REVIEW_MAX_SCROLLS    (선택, 기본 40)

실행: python naver-place-reviews-main.py [hospital_id]

⚠️ 이 스크립트는 네이버 차단으로 인해 개발 샌드박스에서 실테스트가 불가했습니다.
   수집 환경에서 첫 실행 시 (1) entryIframe 탐지 (2) 스크롤로 추가 로드 여부 (3) 날짜 포맷 을 한번 검증하세요.
"""

import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

KST = timezone(timedelta(hours=9))
GRAPHQL_HOST_HINT = "place.naver.com/graphql"  # pcmap-api / api 둘 다 매치

# 페이지(실브라우저, 차단 안 됨) 안에서 getVisitorReviews 를 페이지 단위로 직접 호출.
# 스크롤 무한로딩에 의존하지 않고 본문 리뷰 전체를 결정적으로 긁는다.
_GET_VISITOR_REVIEWS_JS = r"""
async ({ businessId, businessType, base, cutoff, maxPages }) => {
  const wtm = btoa(JSON.stringify({ arg: businessId, type: businessType, source: "place" })).replace(/=+$/, "");
  const query = `query getVisitorReviews($input: VisitorReviewsInput) {
    visitorReviews(input: $input) {
      total
      items { id cursor rating body created visited nickname author { id nickname } }
    }
  }`;
  // 증분 조기중단용 날짜 파서(Python parse_review_date 와 동일 규칙, best-effort)
  const pad = (n) => String(n).padStart(2, "0");
  function parseDate(s) {
    if (!s) return null;
    s = String(s).trim();
    let m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})T/))) return s.slice(0, 10);
    if ((m = s.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/))) return m[1] + "-" + pad(+m[2]) + "-" + pad(+m[3]);
    if ((m = s.match(/^(\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})/))) return "20" + m[1] + "-" + pad(+m[2]) + "-" + pad(+m[3]);
    const nd = new Date(Date.now() + 9 * 3600 * 1000);
    const ny = nd.getUTCFullYear(), nm = nd.getUTCMonth() + 1, ndd = nd.getUTCDate();
    if ((m = s.match(/^(\d{1,2})\.\s*(\d{1,2})\.?\s*[월화수목금토일]?/))) {
      let y = ny, mo = +m[1], dd = +m[2];
      if (mo > nm || (mo === nm && dd > ndd + 1)) y = y - 1;
      return y + "-" + pad(mo) + "-" + pad(dd);
    }
    if (s.indexOf("오늘") >= 0) return ny + "-" + pad(nm) + "-" + pad(ndd);
    let back = null;
    if (s.indexOf("어제") >= 0) back = 1;
    else if (s.indexOf("그제") >= 0 || s.indexOf("그저께") >= 0) back = 2;
    else if ((m = s.match(/^(\d+)\s*일\s*전/))) back = +m[1];
    else if ((m = s.match(/^(\d+)\s*주\s*전/))) back = 7 * (+m[1]);
    if (back != null) { const t = new Date(nd.getTime() - back * 86400000); return t.getUTCFullYear() + "-" + pad(t.getUTCMonth() + 1) + "-" + pad(t.getUTCDate()); }
    return null;
  }
  // 페이지가 실제로 쓰는 컨텍스트 변수(bookingBusinessId, cidList 등)를 그대로 base 로 받아 재사용.
  const baseInput = Object.assign(
    { businessId, businessType, cidList: [] },
    base || {},
    { includeContent: true, size: 30 }
  );
  delete baseInput.after;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function fetchAfter(after) {
    const input = Object.assign({}, baseInput);
    if (after) input.after = after;
    try {
      const res = await fetch("https://pcmap-api.place.naver.com/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wtm-graphql": wtm },
        credentials: "include",
        body: JSON.stringify([{ operationName: "getVisitorReviews", variables: { input }, query }]),
      });
      const json = await res.json();
      const vr = json && json[0] && json[0].data && json[0].data.visitorReviews;
      return vr ? { total: vr.total, items: vr.items || [] } : { total: null, items: [] };
    } catch (e) { return { total: null, items: [] }; }
  }

  const out = [];
  const seen = new Set();
  const addItems = (items) => {
    let added = 0;
    for (const it of items) { if (it && !seen.has(it.id)) { seen.add(it.id); out.push(it); added++; } }
    return added;
  };

  // after(커서) 페이지네이션: 각 응답의 마지막 item.cursor 를 다음 요청 after 로.
  let after = null;
  let total = null;
  let pages = 0;
  for (let p = 0; p < maxPages; p++) {
    const r = await fetchAfter(after);
    if (r.total != null) total = r.total;
    if (!r.items.length) break;
    pages++;
    const added = addItems(r.items);
    // 증분: 이 페이지에서 cutoff 이전(이미 수집된) 리뷰가 나오면 중단
    if (cutoff) {
      let oldest = null;
      for (const it of r.items) {
        const d = parseDate(it.created || it.visited);
        if (d && (!oldest || d < oldest)) oldest = d;
      }
      if (oldest && oldest < cutoff) break;
    }
    const last = r.items[r.items.length - 1];
    const next = last && last.cursor;
    if (!next || next === after) break;
    if (added === 0) break;
    after = next;
    if (total && out.length >= total) break;
    await sleep(300);
  }
  return { items: out, total, strategy: "after-cursor", pages };
}
"""


# ──────────────────────────────────────────────────────────────────────────
# env 로딩 (naver-rank-main.py 와 동일 규칙)
# ──────────────────────────────────────────────────────────────────────────
def load_local_env_files() -> None:
    here = Path(__file__).resolve().parent
    candidates = [
        here / ".env",
        here.parent / ".env",
        here.parent / ".env.local",
        Path.cwd() / ".env",
        Path.cwd() / ".env.local",
    ]
    for env_path in candidates:
        if not env_path.exists():
            continue
        try:
            for raw_line in env_path.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip("'").strip('"')
                if key:
                    os.environ.setdefault(key, value)
        except Exception:
            pass


# ──────────────────────────────────────────────────────────────────────────
# Supabase REST 헬퍼 (naver-rank-main.py 와 동일 패턴)
# ──────────────────────────────────────────────────────────────────────────
def _supabase_headers(service_key: str, profile: str | None = None) -> dict:
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    if profile:
        headers["Accept-Profile"] = profile
        headers["Content-Profile"] = profile
    return headers


def fetch_hospitals(supabase_url: str, service_key: str) -> list[dict]:
    """smartplace_review_url 이 채워진 병원 목록. COLLECT_HOSPITAL_ID 지정 시 그 병원만."""
    params = {
        "select": "id,name,smartplace_review_url",
        "smartplace_review_url": "not.is.null",
    }
    target = os.getenv("COLLECT_HOSPITAL_ID", "").strip()
    if target:
        params["id"] = f"eq.{target}"
    url = f"{supabase_url.rstrip('/')}/rest/v1/hospitals?{urlencode(params)}"
    req = Request(url, headers=_supabase_headers(service_key, profile="core"), method="GET")
    with urlopen(req, timeout=30) as resp:
        rows = json.loads(resp.read().decode("utf-8"))
    out = []
    for r in rows:
        review_url = (r.get("smartplace_review_url") or "").strip()
        if review_url:
            out.append({"id": r.get("id"), "name": r.get("name"), "review_url": review_url})
    return out


def fetch_competitors(supabase_url: str, service_key: str, hospital_id: str) -> list[dict]:
    """그 병원의 경쟁병원 중 smartplace_review_url 이 설정된 것(슬롯별). 리뷰 갯수 비교 대상."""
    params = {
        "select": "slot,name,smartplace_review_url",
        "hospital_id": f"eq.{hospital_id}",
        "smartplace_review_url": "not.is.null",
        "is_active": "eq.true",
        "order": "slot.asc",
    }
    url = f"{supabase_url.rstrip('/')}/rest/v1/analytics_hospital_competitors?{urlencode(params)}"
    req = Request(url, headers=_supabase_headers(service_key, profile="analytics"), method="GET")
    out = []
    try:
        with urlopen(req, timeout=20) as resp:
            rows = json.loads(resp.read().decode("utf-8"))
        for r in rows:
            review_url = (r.get("smartplace_review_url") or "").strip()
            slot = r.get("slot")
            if review_url and slot:
                out.append({"slot": int(slot), "name": r.get("name") or "", "review_url": review_url})
    except Exception:
        pass
    return out


def fetch_last_review_date(
    supabase_url: str, service_key: str, hospital_id: str, competitor_slot: int | None = None
) -> str | None:
    """DB에 이미 수집된 그 (병원[, 경쟁슬롯]) 리뷰 중 가장 최신 review_date (YYYY-MM-DD). 없으면 None(=최초)."""
    params = {
        "select": "review_date",
        "hospital_id": f"eq.{hospital_id}",
        "competitor_slot": ("eq." + str(competitor_slot)) if competitor_slot is not None else "is.null",
        "order": "review_date.desc",
        "limit": "1",
    }
    url = f"{supabase_url.rstrip('/')}/rest/v1/analytics_place_reviews?{urlencode(params)}"
    req = Request(url, headers=_supabase_headers(service_key, profile="analytics"), method="GET")
    try:
        with urlopen(req, timeout=20) as resp:
            rows = json.loads(resp.read().decode("utf-8"))
        if rows and rows[0].get("review_date"):
            return str(rows[0]["review_date"])[:10]
    except Exception:
        pass
    return None


def upsert_reviews(supabase_url: str, service_key: str, rows: list[dict]) -> int:
    if not rows:
        return 0
    params = {"on_conflict": "hospital_id,review_id"}
    url = f"{supabase_url.rstrip('/')}/rest/v1/analytics_place_reviews?{urlencode(params)}"
    headers = _supabase_headers(service_key, profile="analytics")
    headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
    # 너무 큰 배치는 나눠서 전송
    total = 0
    for i in range(0, len(rows), 500):
        chunk = rows[i : i + 500]
        req = Request(url, data=json.dumps(chunk).encode("utf-8"), headers=headers, method="POST")
        with urlopen(req, timeout=60):
            pass
        total += len(chunk)
    return total


# ──────────────────────────────────────────────────────────────────────────
# 날짜 파싱: ISO("2024-10-26T05:00:00.000Z") / "2026.05.23." / 상대표현 모두 처리
# 반환: "YYYY-MM-DD"(Asia/Seoul 기준 date) 또는 None
# ──────────────────────────────────────────────────────────────────────────
def parse_review_date(value) -> str | None:
    if not value:
        return None
    s = str(value).strip()
    # 1) ISO 8601 (UTC Z) → KST date
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})", s)
    if m:
        try:
            dt = datetime(
                int(m[1]), int(m[2]), int(m[3]), int(m[4]), int(m[5]), int(m[6]),
                tzinfo=timezone.utc,
            ).astimezone(KST)
            return dt.strftime("%Y-%m-%d")
        except Exception:
            return None
    # 2) "YYYY.MM.DD." / "YYYY.M.D"
    m = re.match(r"^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})", s)
    if m:
        return f"{int(m[1]):04d}-{int(m[2]):02d}-{int(m[3]):02d}"
    # 2b) "YY.M.D"(2자리 연도, 숫자 3개; 예: "25.12.5.금") — 첫 칸이 2자리고 점 3구간
    m = re.match(r"^(\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})", s)
    if m:
        return f"20{int(m[1]):02d}-{int(m[2]):02d}-{int(m[3]):02d}"
    # 3) "M.D" / "M.D." / "M.D.요일"(예: "5.24.일") — 연도 생략 → 올해, 미래면 작년
    m = re.match(r"^(\d{1,2})\.\s*(\d{1,2})\.?\s*[월화수목금토일]?", s)
    if m:
        today = datetime.now(KST)
        y, mo, d = today.year, int(m[1]), int(m[2])
        try:
            cand = datetime(y, mo, d, tzinfo=KST)
            if cand > today + timedelta(days=1):
                cand = datetime(y - 1, mo, d, tzinfo=KST)
            return cand.strftime("%Y-%m-%d")
        except Exception:
            return None
    # 4) 상대표현
    today = datetime.now(KST)
    if "오늘" in s:
        return today.strftime("%Y-%m-%d")
    if "어제" in s:
        return (today - timedelta(days=1)).strftime("%Y-%m-%d")
    if "그제" in s or "그저께" in s:
        return (today - timedelta(days=2)).strftime("%Y-%m-%d")
    m = re.match(r"^(\d+)\s*일\s*전", s)
    if m:
        return (today - timedelta(days=int(m[1]))).strftime("%Y-%m-%d")
    m = re.match(r"^(\d+)\s*주\s*전", s)
    if m:
        return (today - timedelta(days=7 * int(m[1]))).strftime("%Y-%m-%d")
    return None


def extract_place_id(url: str) -> str | None:
    m = re.search(r"/place/(\d+)", url) or re.search(r"/(\d{6,})/review", url) or re.search(r"/(\d{6,})", url)
    return m.group(1) if m else None


# ──────────────────────────────────────────────────────────────────────────
# 리뷰 정규화 — 두 가지 GraphQL 응답 형태를 모두 흡수
#   visitorReviews.items[]      : { id, body, created, rating, author{id,nickname}, nickname }
#   visitorReviewPhotos[]       : { logId|viewId, text, date, rating, author{id,nickname} }  (미디어 리뷰)
# author_id 컬럼에는 "보이는 닉네임"을 넣는다(병원이 알아보는 핸들). 안정 id 들은 metadata 로.
# ──────────────────────────────────────────────────────────────────────────
def _author_fields(item: dict) -> tuple[str | None, dict]:
    author = item.get("author") or {}
    nickname = item.get("nickname") or author.get("nickname")
    meta = {
        "author_object_id": author.get("objectId"),
        "author_id_raw": author.get("id"),
    }
    return (nickname, {k: v for k, v in meta.items() if v})


def normalize_visitor_review(item: dict) -> dict | None:
    rid = item.get("id")
    if not rid:
        return None
    body = (item.get("body") or "").strip()
    created_date = parse_review_date(item.get("created"))   # 작성일
    visited_date = parse_review_date(item.get("visited"))   # 방문일
    review_date = created_date or visited_date
    if not review_date:
        return None
    visit_date = visited_date or created_date               # UI 기준(방문일 우선, 없으면 작성일)
    nickname, meta = _author_fields(item)
    meta["source"] = "visitorReviews"
    meta["raw_created"] = item.get("created")   # 원본 날짜 문자열(파싱 검증·디버그용)
    meta["raw_visited"] = item.get("visited")
    return {
        "review_id": f"vr:{rid}",
        "author_id": nickname,
        "review_date": review_date,   # 작성일 — 수집/증분 기준
        "visit_date": visit_date,     # 방문일 — UI 집계 기준
        "content": body or None,
        "rating": item.get("rating"),
        "metadata": meta,
    }


def normalize_photo_review(item: dict) -> dict | None:
    text = (item.get("text") or "").strip()
    date_key = parse_review_date(item.get("date"))
    if not date_key:
        return None
    raw_id = item.get("logId") or item.get("viewId")
    if not raw_id:
        sig = f"{text[:60]}|{date_key}|{(item.get('author') or {}).get('id')}"
        raw_id = hashlib.md5(sig.encode("utf-8")).hexdigest()
    nickname, meta = _author_fields(item)
    meta["source"] = "visitorReviewPhotos"
    return {
        "review_id": f"ph:{raw_id}",
        "author_id": nickname,
        "review_date": date_key,
        "content": text or None,
        "rating": item.get("rating"),
        "metadata": meta,
    }


# ──────────────────────────────────────────────────────────────────────────
# Playwright 수집
# ──────────────────────────────────────────────────────────────────────────
def collect_reviews_for_hospital(hospital: dict, cutoff_date: str) -> list[dict]:
    from playwright.sync_api import sync_playwright  # noqa: PLC0415

    review_url = hospital["review_url"]
    place_id = extract_place_id(review_url)
    headless = os.getenv("REVIEW_HEADLESS", "1").strip().lower() not in ("0", "false", "no")
    debug = os.getenv("REVIEW_DEBUG", "0").strip().lower() not in ("0", "false", "no", "")
    max_scrolls = int(os.getenv("REVIEW_MAX_SCROLLS", "150"))
    print(f"   (headless={headless}, place_id={place_id})")

    collected: dict[str, dict] = {}     # review_id -> row
    content_sigs: set[str] = set()      # 동일 리뷰가 두 소스에서 중복 적재되는 것 방지
    diag = {"gql": 0}                   # 가로챈 graphql 응답 수

    def add(row: dict | None) -> None:
        if not row:
            return
        rid = row["review_id"]
        if rid in collected:
            # 같은 리뷰 재등장 — 본문/별점 없던 것(includeContent=false 응답)을 보강
            if not collected[rid].get("content") and row.get("content"):
                collected[rid]["content"] = row["content"]
            if collected[rid].get("rating") is None and row.get("rating") is not None:
                collected[rid]["rating"] = row["rating"]
            return
        sig = f"{(row.get('author_id') or '')}|{row['review_date']}|{(row.get('content') or '')[:40]}"
        if sig in content_sigs:
            return  # 다른 id 지만 동일 내용 → 중복
        collected[rid] = row
        content_sigs.add(sig)

    def handle_response(response) -> None:
        if GRAPHQL_HOST_HINT not in response.url:
            return
        diag["gql"] += 1
        try:
            data = response.json()
        except Exception:
            if debug:
                print(f"      [gql] non-JSON status={response.status} url={response.url[:70]}")
            return
        payloads = data if isinstance(data, list) else [data]
        if debug:
            keys = [list(((p or {}).get('data') or {}).keys()) for p in payloads]
            print(f"      [gql] status={response.status} dataKeys={keys}")
        for p in payloads:
            d = (p or {}).get("data") or {}
            vr = d.get("visitorReviews")
            if isinstance(vr, dict):
                for it in vr.get("items") or []:
                    add(normalize_visitor_review(it))
            fr = d.get("followingReviews")
            if isinstance(fr, dict):
                for it in fr.get("reviews") or []:
                    add(normalize_visitor_review(it))
            # visitorReviewPhotos(사진·영상 갤러리)는 수집 안 함 —
            # 커서 목록(getVisitorReviews)이 사진 리뷰까지 "정확한 작성일"로 전부 가져오고,
            # 갤러리의 date 는 미디어 날짜라 작성일과 달라 중복·오날짜 행을 만든다.

    # 페이지가 실제로 보내는 getVisitorReviews 요청 변수를 "세트별로" 캡처(진짜 페이지네이션 필드 파악용)
    captured = {"sets": [], "ops": []}

    def handle_request(request) -> None:
        if GRAPHQL_HOST_HINT not in request.url:
            return
        try:
            pd = request.post_data
        except Exception:
            return
        if not pd:
            return
        try:
            arr = json.loads(pd)
        except Exception:
            return
        if not isinstance(arr, list):
            arr = [arr]
        for op in arr:
            if not isinstance(op, dict):
                continue
            captured["ops"].append(op.get("operationName"))
            q = op.get("query") or ""
            if "visitorReviews(" in q and op.get("variables"):
                s = json.dumps(op.get("variables"), ensure_ascii=False, sort_keys=True)
                if s not in captured["sets"]:
                    captured["sets"].append(s)

    # 봇 탐지 회피: 기본은 이미 떠 있는 진짜 Chrome(CDP)에 붙는다(순위 매크로와 동일).
    use_cdp = os.getenv("REVIEW_USE_DEBUG_CHROME", "1").strip().lower() not in ("0", "false", "no")
    debug_port = int(os.getenv("REVIEW_CHROME_PORT") or os.getenv("CHROME_DEBUGGING_PORT") or "9222")

    with sync_playwright() as pw:
        own_context = True
        cdp_ok = False
        if use_cdp:
            endpoint = f"http://127.0.0.1:{debug_port}"
            try:
                browser = pw.chromium.connect_over_cdp(endpoint)
                cdp_ok = True
            except Exception:
                # 그 포트 Chrome 이 안 떠 있으면 에러로 죽지 말고 자체 헤드리스로 폴백.
                print(
                    f"   ⚠️ CDP 연결 실패({endpoint}) → 헤드리스 브라우저로 폴백 "
                    f"(원치 않으면 그 포트로 Chrome 을 띄우거나, CDP 강제는 REVIEW_USE_DEBUG_CHROME=0)"
                )
            if cdp_ok:
                had_contexts = bool(browser.contexts)
                context = browser.contexts[0] if had_contexts else browser.new_context()
                own_context = not had_contexts
                print(f"   (CDP 실 Chrome 연결: {endpoint})")
        if not cdp_ok:
            browser = pw.chromium.launch(headless=headless)
            context = browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
                ),
                locale="ko-KR",
            )
            own_context = True

        page = context.new_page()
        page.on("request", handle_request)
        page.on("response", handle_response)
        page.goto(review_url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(1500)

        # map.naver.com 이면 리뷰가 pcmap iframe 안에 "비동기로" 뜬다(처음엔 about:blank).
        # iframe URL 이 채워질 때까지 폴링 대기 후, 그 리뷰 페이지로 직접 이동해
        # 중첩 iframe 을 없애고 스크롤/더보기 페이지네이션을 단순화한다.
        # ⚠️ map URL 에 placePath=/review 가 들어있어 "/review" 로는 판정 불가 → pcmap 도메인으로 판정.
        if "pcmap.place.naver.com" not in (page.url or ""):
            review_frame_url = None
            for _ in range(24):  # 최대 ~12초 대기
                for f in page.frames:
                    u = f.url or ""
                    if "pcmap.place.naver.com" in u and "/review" in u:
                        review_frame_url = u
                        break
                if review_frame_url:
                    break
                page.wait_for_timeout(500)
            if review_frame_url:
                if debug:
                    print(f"      리뷰 iframe 발견 → 직접 이동: {review_frame_url[:80]}")
                try:
                    page.goto(review_frame_url, wait_until="domcontentloaded", timeout=60000)
                    page.wait_for_timeout(2500)
                except Exception as e:
                    if debug:
                        print(f"      직접 이동 실패: {e}")
            elif debug:
                print("      리뷰 iframe 을 찾지 못함(폴링 타임아웃)")

        if debug:
            try:
                print(f"      page.title={page.title()!r}")
            except Exception:
                pass
            print(f"      page.url={(page.url or '')[:80]}")
            print(f"      frames={[(f.url or '')[:60] for f in page.frames]}")
            print(f"      [req] 관측 op들: {list(dict.fromkeys(captured.get('ops') or []))}")

        # 작업 프레임: 리뷰가 메인이면 main_frame, 아직 iframe 안이면 그 프레임.
        target_frame = page.main_frame
        if "pcmap.place.naver.com" not in (page.url or ""):
            for f in page.frames:
                u = f.url or ""
                if "pcmap.place.naver.com" in u and "/review" in u:
                    target_frame = f
                    break

        # ── 본문 리뷰 목록: 스크롤 무한로딩이 잘 안 먹어서, 안 막힌 실브라우저 컨텍스트에서
        #    getVisitorReviews GraphQL 을 페이지 단위로 직접 호출(replay)해 전부 가져온다. ──
        business_type = "pet"
        m = re.search(r"pcmap\.place\.naver\.com/([^/]+)/\d+", page.url or "")
        if m:
            business_type = m.group(1)

        # 페이지가 보낸 getVisitorReviews 요청에서 컨텍스트 변수(bookingBusinessId, cidList 등)를 추출해 base 로 재사용.
        base_vars = None
        for s in (captured.get("sets") or []):
            try:
                v = (json.loads(s) or {}).get("input")
            except Exception:
                continue
            if isinstance(v, dict) and v.get("bookingBusinessId") and str(v.get("businessId")) == str(place_id):
                base_vars = {k: v[k] for k in v if k != "after"}
                break

        api_res = None
        try:
            api_res = page.evaluate(
                _GET_VISITOR_REVIEWS_JS,
                {
                    "businessId": str(place_id),
                    "businessType": business_type,
                    "base": base_vars,
                    "cutoff": cutoff_date,
                    "maxPages": int(os.getenv("REVIEW_MAX_PAGES", "200")),
                },
            )
            api_items = (api_res or {}).get("items") or []
            if debug:
                print(f"      [api] after-cursor replay → {len(api_items)}건 "
                      f"(total={(api_res or {}).get('total')}, pages={(api_res or {}).get('pages')}, "
                      f"base={'페이지변수' if base_vars else '기본'})")
                fails = [it.get("created") for it in api_items
                         if not parse_review_date(it.get("created") or it.get("visited"))]
                print(f"      [api] 날짜파싱 실패 {len(fails)}건, 샘플 created: {fails[:12]}")
            for it in api_items:
                add(normalize_visitor_review(it))
        except Exception as e:
            if debug:
                print(f"      [api] replay 실패: {e}")

        # API replay 가 cutoff(6개월)까지 닿았는지 확인 → 부족하면 '펼쳐서 더보기' 클릭으로 보강
        def _oldest_body():
            return min(
                (r["review_date"] for r in collected.values()
                 if (r.get("metadata") or {}).get("source") == "visitorReviews"),
                default=None,
            )
        ob = _oldest_body()
        total_reported = (api_res or {}).get("total")
        api_count = len((api_res or {}).get("items") or [])
        reached_cutoff = ob is not None and ob <= cutoff_date
        got_all = bool(total_reported) and api_count >= total_reported
        need_more = not (reached_cutoff or got_all)
        if debug:
            print(f"      [api] 본문최古={ob} total={total_reported} 받음={api_count} "
                  f"→ 클릭 보강 {'필요' if need_more else '불필요(스킵)'}")

        # ── "펼쳐서 더 보기" 버튼을 반복 클릭해 다음 페이지를 로드 → 응답 인터셉트로 수집 ──
        #    (page 파라미터가 안 먹어서 API replay 로는 30건이 한계. 실제 리스트는 이 버튼으로 늘어난다.)
        more_texts = ["펼쳐서 더보기", "리뷰 더보기"]
        stagnant = 0
        for i in range(max_scrolls if need_more else 0):
            before = len(collected)
            try:
                page.mouse.move(700, 500)
                page.mouse.wheel(0, 5000)
            except Exception:
                pass
            page.wait_for_timeout(700)
            clicked = False
            for t in more_texts:
                try:
                    loc = target_frame.get_by_text(t, exact=True)
                    n = loc.count()
                    if n > 0 and loc.last.is_visible():
                        loc.last.scroll_into_view_if_needed(timeout=1500)
                        loc.last.click(timeout=2000)
                        clicked = True
                        break
                except Exception:
                    pass
            page.wait_for_timeout(1300 if clicked else 600)
            after = len(collected)
            # cutoff 판정은 본문 리뷰(visitorReviews, 최신→과거 순)만으로. 사진 리뷰는 시간순이 아니라 제외.
            oldest_body = min(
                (r["review_date"] for r in collected.values()
                 if (r.get("metadata") or {}).get("source") == "visitorReviews"),
                default=None,
            )
            if debug and (i < 5 or after != before):
                print(f"      [more] iter {i}: clicked={clicked} 수집 {before}→{after} 본문최古={oldest_body}")
            if oldest_body and oldest_body < cutoff_date:
                break
            stagnant = stagnant + 1 if after == before else 0
            if stagnant >= 10:
                break

        if debug:
            sets = captured.get("sets") or []
            print(f"      [req] 캡처된 getVisitorReviews 변수 세트 {len(sets)}종:")
            for s in sets[:10]:
                print("         ", s[:340])
            with_body = sum(1 for r in collected.values() if r.get("content"))
            print(f"      [수집] 누적 {len(collected)}건 (본문 있는 것 {with_body}건)")

        # 진단: graphql 응답 0개면 봇 차단/페이지 미로딩, >0인데 0건이면 응답 구조 문제
        if debug or not collected:
            try:
                page.screenshot(path="scripts/_review_debug.png")
                Path("scripts/_review_debug.html").write_text(
                    target_frame.content(), encoding="utf-8"
                )
                title = ""
                try:
                    title = page.title()
                except Exception:
                    pass
                print(
                    f"      [debug] graphql응답={diag['gql']}개, 수집={len(collected)}건, "
                    f"title={title!r}\n"
                    f"      [debug] 스크린샷/HTML 저장: scripts/_review_debug.png, _review_debug.html"
                )
            except Exception as e:
                print(f"      [debug] 진단 저장 실패: {e}")

        # 정리: 내가 연 탭만 닫고, CDP 모드면 사용자의 기존 컨텍스트/탭은 건드리지 않는다.
        try:
            page.close()
        except Exception:
            pass
        if own_context:
            try:
                context.close()
            except Exception:
                pass
        try:
            browser.close()
        except Exception:
            pass

    # cutoff 이내만 + place_id 메타 부착
    rows = []
    for r in collected.values():
        if r["review_date"] < cutoff_date:
            continue
        r["metadata"]["place_id"] = place_id
        rows.append(r)
    return rows


# ──────────────────────────────────────────────────────────────────────────
def main() -> None:
    load_local_env_files()
    supabase_url = os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        print("❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.")
        sys.exit(1)

    if len(sys.argv) > 1 and sys.argv[1].strip():
        os.environ["COLLECT_HOSPITAL_ID"] = sys.argv[1].strip()

    collected_at = datetime.now(timezone.utc).isoformat()
    force_full = os.getenv("REVIEW_FULL", "0").strip().lower() not in ("0", "false", "no", "")
    force_since = os.getenv("REVIEW_SINCE", "").strip()  # YYYY-MM-DD 강제 지정

    hospitals = fetch_hospitals(supabase_url, service_key)
    if not hospitals:
        print("ℹ️ smartplace_review_url 이 설정된 병원이 없습니다.")
        return

    print(f"🏥 대상 병원 {len(hospitals)}곳")
    grand_total = 0
    for h in hospitals:
        # 증분: DB에 마지막 수집일이 있으면 그 이후만, 없으면(최초) 전체.
        if force_since:
            cutoff_date, mode = force_since, f"지정({force_since} 이후)"
        elif force_full:
            cutoff_date, mode = "2000-01-01", "전체(강제)"
        else:
            last_date = fetch_last_review_date(supabase_url, service_key, h["id"])
            cutoff_date = last_date or "2000-01-01"
            mode = f"증분({last_date} 이후)" if last_date else "전체(최초)"
        print(f"\n→ {h['name']} ({h['id']}) · {mode}")
        try:
            reviews = collect_reviews_for_hospital(h, cutoff_date)
        except Exception as exc:
            print(f"  ⚠️ 수집 실패: {exc}")
            continue
        rows = [
            {
                "hospital_id": h["id"],
                "review_id": r["review_id"],
                "author_id": r["author_id"],
                "review_date": r["review_date"],
                "visit_date": r.get("visit_date"),
                "content": r["content"],
                "rating": r["rating"],
                "metadata": r["metadata"],
                "collected_at": collected_at,
                # sentiment 은 보내지 않음 → null(미분류). 레이블링 잡이 채운다.
            }
            for r in reviews
        ]
        n = upsert_reviews(supabase_url, service_key, rows)
        print(f"  ✅ {n}건 upsert")
        grand_total += n

        # 경쟁병원 리뷰(월별 갯수 비교용) — 본문/감성 없이 날짜만, competitor_slot 태그로 owner 하위에 저장.
        competitors = fetch_competitors(supabase_url, service_key, h["id"])
        for comp in competitors:
            if force_since:
                c_cutoff = force_since
            elif force_full:
                c_cutoff = "2000-01-01"
            else:
                c_last = fetch_last_review_date(supabase_url, service_key, h["id"], comp["slot"])
                c_cutoff = c_last or "2000-01-01"
            print(f"  ⚔️ 경쟁 {comp['slot']}. {comp['name']}")
            try:
                c_reviews = collect_reviews_for_hospital(
                    {"id": h["id"], "name": comp["name"], "review_url": comp["review_url"]}, c_cutoff
                )
            except Exception as exc:
                print(f"     ⚠️ 경쟁 수집 실패: {exc}")
                continue
            c_rows = [
                {
                    "hospital_id": h["id"],
                    "review_id": f"c{comp['slot']}_{r['review_id']}",
                    "review_date": r["review_date"],
                    "competitor_slot": comp["slot"],
                    "collected_at": collected_at,
                    # content/sentiment 없음(갯수만 필요) → 경쟁사 본문은 저장하지 않음
                }
                for r in c_reviews
            ]
            cn = upsert_reviews(supabase_url, service_key, c_rows)
            print(f"     ✅ {cn}건")
            grand_total += cn

    print(f"\n완료 — 총 {grand_total}건 upsert")


if __name__ == "__main__":
    main()
