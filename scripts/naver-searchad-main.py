"""
네이버 검색광고(SearchAd) 병원별 수집기

- 입력: core.hospitals (searchad_* 컬럼, searchad_is_active=true)
- 출력: analytics.analytics_searchad_daily_metrics (일별 캠페인 + 광고그룹 단위 성과)
- 기본 기간: (hospital_id, customer_id)별 DB max(metric_date) 다음날 ~ KST 어제(D-1).
  해당 조합에 행이 없으면 KST 어제 포함 30일(환경변수 SEARCHAD_METRICS_INITIAL_DAYS로 변경 가능).
- SEARCHAD_METRIC_DATE 가 설정되면 위 증분을 끄고 해당 날짜만 수집(디버그/재처리용).
- SEARCHAD_METRIC_START / SEARCHAD_METRIC_END 가 둘 다 설정되면 증분/청크를 끄고
  그 구간(시작~끝, 포함)만 수집(admin 화면에서 기간 지정 수집용). 하루는 시작=끝.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import http.client
import io
import json
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen


def load_local_env_files() -> None:
    project_root = Path(__file__).resolve().parents[1]
    for env_name in (".env", ".env.local"):
        env_path = project_root / env_name
        if not env_path.exists():
            continue
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("'").strip('"')
            if key:
                os.environ.setdefault(key, value)


def _to_kst_date_str(delta_days: int = -1) -> str:
    kst = timezone(timedelta(hours=9))
    return (datetime.now(kst) + timedelta(days=delta_days)).strftime("%Y-%m-%d")


INITIAL_BACKFILL_DAYS = 30


def _add_days_ymd(ymd: str, delta: int) -> str:
    base = datetime.strptime(ymd[:10], "%Y-%m-%d")
    return (base + timedelta(days=delta)).strftime("%Y-%m-%d")


def _iter_dates_inclusive(start: str, end: str):
    a = datetime.strptime(start[:10], "%Y-%m-%d").date()
    b = datetime.strptime(end[:10], "%Y-%m-%d").date()
    d = a
    while d <= b:
        yield d.strftime("%Y-%m-%d")
        d += timedelta(days=1)


def fetch_max_searchad_metric_date(
    supabase_url: str,
    service_key: str,
    hospital_id: str,
    customer_id: str,
) -> str | None:
    params = {
        "select": "metric_date",
        "hospital_id": f"eq.{hospital_id}",
        "customer_id": f"eq.{customer_id}",
        "order": "metric_date.desc",
        "limit": "1",
    }
    url = f"{supabase_url.rstrip('/')}/rest/v1/analytics_searchad_daily_metrics?{urlencode(params)}"
    req = Request(url, headers=_supabase_headers(service_key, profile="analytics"), method="GET")
    with _urlopen_with_retry(req, timeout=20) as res:
        rows = json.loads(res.read().decode("utf-8"))
    if not rows:
        return None
    raw = rows[0].get("metric_date")
    if raw is None:
        return None
    s = str(raw).strip()
    return s[:10] if s else None


def compute_searchad_metric_range(
    max_metric_date: str | None,
    end_date: str,
    initial_days: int,
) -> tuple[str, str] | None:
    end = end_date.strip()[:10]
    if not max_metric_date or not str(max_metric_date).strip():
        start = _add_days_ymd(end, -(initial_days - 1))
    else:
        start = _add_days_ymd(str(max_metric_date).strip()[:10], 1)
    if start > end:
        return None
    return (start, end)


def _supabase_headers(service_key: str, profile: str | None = None) -> dict[str, str]:
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    if profile:
        headers["Accept-Profile"] = profile
        headers["Content-Profile"] = profile
    return headers


def _xor_decrypt(cipher_text: str, passphrase: str) -> str:
    raw = base64.b64decode(cipher_text.encode("utf-8"))
    key = hashlib.sha256(passphrase.encode("utf-8")).digest()
    plain = bytes(raw[i] ^ key[i % len(key)] for i in range(len(raw)))
    return plain.decode("utf-8")


def resolve_searchad_secret(stored_value: str) -> str:
    value = (stored_value or "").strip()
    if not value:
        return ""
    if not value.startswith("enc::"):
        # 하위 호환: 기존 평문 저장값이 있을 수 있음
        return value
    cipher_text = value.replace("enc::", "", 1)
    passphrase = os.getenv("SEARCHAD_SECRET_PASSPHRASE", "").strip()
    if not passphrase:
        raise RuntimeError("enc:: 형식 secret_key_encrypted 복호화를 위해 SEARCHAD_SECRET_PASSPHRASE가 필요합니다.")
    return _xor_decrypt(cipher_text, passphrase)


def fetch_active_accounts(
    supabase_url: str,
    service_key: str,
    hospital_id: str | None = None,
) -> list[dict[str, Any]]:
    # primary source: core.hospitals
    params = {
        "select": "id,searchad_customer_id,searchad_api_license,searchad_secret_key_encrypted,searchad_is_active",
        "searchad_is_active": "eq.true",
        "order": "id.asc",
    }
    if hospital_id:
        params["id"] = f"eq.{hospital_id}"
    url = f"{supabase_url.rstrip('/')}/rest/v1/hospitals?{urlencode(params)}"
    req = Request(url, headers=_supabase_headers(service_key, profile="core"), method="GET")
    try:
        with _urlopen_with_retry(req, timeout=20) as res:
            rows = json.loads(res.read().decode("utf-8")) or []
            mapped = []
            for r in rows:
                hid = str(r.get("id") or "").strip()
                customer_id = str(r.get("searchad_customer_id") or "").strip()
                api_license = str(r.get("searchad_api_license") or "").strip()
                secret = str(r.get("searchad_secret_key_encrypted") or "").strip()
                if not hid or not customer_id or not api_license or not secret:
                    continue
                mapped.append(
                    {
                        "hospital_id": hid,
                        "customer_id": customer_id,
                        "api_license": api_license,
                        "secret_key_encrypted": secret,
                    }
                )
            return mapped
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        raise RuntimeError(
            "core.hospitals SearchAd 계정 조회 실패: "
            f"status={e.code}, body={body[:500]}."
        ) from e


def build_searchad_headers(method: str, uri: str, api_license: str, secret_key: str, customer_id: str) -> dict[str, str]:
    timestamp = str(int(time.time() * 1000))
    message = f"{timestamp}.{method}.{uri}"
    signature = base64.b64encode(hmac.new(secret_key.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).digest()).decode(
        "utf-8"
    )
    return {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Timestamp": timestamp,
        "X-API-KEY": api_license,
        "X-Customer": customer_id,
        "X-Signature": signature,
    }


HTTP_MAX_ATTEMPTS = 4  # 최초 시도 + 재시도 (일시적 오류 한정)
RETRYABLE_STATUS = (429, 500, 502, 503, 504)


def _backoff_sleep(attempt: int) -> None:
    # 1 → 2 → 4 → 8초, 상한 10초
    time.sleep(min(2 ** attempt, 10))


def _urlopen_with_retry(req: Request, timeout: int, attempts: int = HTTP_MAX_ATTEMPTS):
    """Supabase REST 호출용 — 네트워크 오류(DNS ENOTFOUND 등)·일시적 5xx/429를 백오프 재시도.

    영구 오류(4xx 대부분)는 즉시 올린다. 반환값은 urlopen 응답(호출부에서 with로 사용)."""
    last_err: Exception | None = None
    for attempt in range(attempts):
        try:
            return urlopen(req, timeout=timeout)
        except HTTPError as e:
            if e.code in RETRYABLE_STATUS and attempt < attempts - 1:
                last_err = e
                _backoff_sleep(attempt)
                continue
            raise
        except OSError as e:  # URLError(=DNS/연결 실패)도 OSError 하위
            last_err = e
            if attempt < attempts - 1:
                _backoff_sleep(attempt)
                continue
            raise
    if last_err is not None:
        raise last_err
    raise RuntimeError("unreachable")


# SearchAd API 호출은 keep-alive 영속 연결을 host별로 재사용한다.
# (호출마다 새 연결을 열면 호출 수만큼 DNS 조회가 일어나 리졸버가 과부하 → getaddrinfo ENOTFOUND.
#  연결을 재사용하면 DNS 조회는 host당 사실상 처음 1번이 된다.)
_searchad_conns: dict[str, http.client.HTTPSConnection] = {}


def _searchad_connection(base_url: str) -> tuple[http.client.HTTPSConnection, str]:
    host = urlsplit(base_url.rstrip("/")).netloc
    conn = _searchad_conns.get(host)
    if conn is None:
        conn = http.client.HTTPSConnection(host, timeout=60)
        _searchad_conns[host] = conn
    return conn, host


def _searchad_reset(host: str) -> None:
    conn = _searchad_conns.pop(host, None)
    if conn is not None:
        try:
            conn.close()
        except Exception:
            pass


def searchad_get(
    base_url: str,
    uri: str,
    params: dict[str, str],
    api_license: str,
    secret_key: str,
    customer_id: str,
) -> Any:
    query = urlencode(params)
    path = f"{uri}?{query}" if query else uri
    url = f"{base_url.rstrip('/')}{uri}"
    last_err: Exception | None = None
    for attempt in range(HTTP_MAX_ATTEMPTS):
        # 재시도마다 타임스탬프(서명)를 새로 생성한다. 재연결 지연으로 옛 타임스탬프를 재사용하면
        # 네이버가 403 invalid-timestamp("Request has expired")로 거절하기 때문.
        headers = build_searchad_headers("GET", uri, api_license, secret_key, customer_id)
        conn, host = _searchad_connection(base_url)
        try:
            conn.request("GET", path, headers=headers)
            res = conn.getresponse()
            body = res.read().decode("utf-8")  # 연결 재사용을 위해 본문을 끝까지 읽는다
            status = res.status
            if status >= 400:
                # 일시적 오류만 재시도: 5xx/429, 그리고 403 invalid-timestamp(서명 만료).
                retryable = status in RETRYABLE_STATUS or (status == 403 and "invalid-timestamp" in body)
                if retryable and attempt < HTTP_MAX_ATTEMPTS - 1:
                    _backoff_sleep(attempt)
                    continue
                raise HTTPError(url, status, body, res.headers, io.BytesIO(body.encode("utf-8")))
            return json.loads(body) if body else {}
        except HTTPError:
            raise
        except (http.client.HTTPException, OSError) as e:
            # 연결 단절/네트워크 오류: 연결을 닫고 백오프 후 재시도.
            last_err = e
            _searchad_reset(host)
            if attempt < HTTP_MAX_ATTEMPTS - 1:
                _backoff_sleep(attempt)
                continue
            raise
    if last_err is not None:
        raise last_err
    return {}


def fetch_campaigns(base_url: str, api_license: str, secret_key: str, customer_id: str) -> list[dict[str, Any]]:
    data = searchad_get(
        base_url,
        "/ncc/campaigns",
        {},
        api_license,
        secret_key,
        customer_id,
    )
    return data if isinstance(data, list) else []


def fetch_adgroups(
    base_url: str,
    api_license: str,
    secret_key: str,
    customer_id: str,
    campaign_id: str,
) -> list[dict[str, Any]]:
    data = searchad_get(
        base_url,
        "/ncc/adgroups",
        {"nccCampaignId": campaign_id},
        api_license,
        secret_key,
        customer_id,
    )
    return data if isinstance(data, list) else []


def fetch_campaign_stats(
    base_url: str,
    api_license: str,
    secret_key: str,
    customer_id: str,
    campaign_id: str,
    metric_date: str,
) -> dict[str, Any]:
    time_range = json.dumps({"since": metric_date, "until": metric_date}, separators=(",", ":"))
    # SearchAd stats 필드: 전환건수는 convCnt가 아니라 ccnt를 사용
    fields = json.dumps(["impCnt", "clkCnt", "salesAmt", "ccnt", "ctr", "cpc"], separators=(",", ":"))
    data = searchad_get(
        base_url,
        "/stats",
        {
            "ids": campaign_id,
            "fields": fields,
            "timeRange": time_range,
        },
        api_license,
        secret_key,
        customer_id,
    )
    if isinstance(data, list) and data:
        return data[0] if isinstance(data[0], dict) else {}
    if isinstance(data, dict):
        return data
    return {}


def fetch_keywords(
    base_url: str,
    api_license: str,
    secret_key: str,
    customer_id: str,
    adgroup_id: str,
) -> list[dict[str, Any]]:
    data = searchad_get(
        base_url,
        "/ncc/keywords",
        {"nccAdgroupId": adgroup_id},
        api_license,
        secret_key,
        customer_id,
    )
    return data if isinstance(data, list) else []


def fetch_adgroup_stats(
    base_url: str,
    api_license: str,
    secret_key: str,
    customer_id: str,
    adgroup_id: str,
    metric_date: str,
) -> dict[str, Any]:
    time_range = json.dumps({"since": metric_date, "until": metric_date}, separators=(",", ":"))
    fields = json.dumps(["impCnt", "clkCnt", "salesAmt", "ccnt", "ctr", "cpc"], separators=(",", ":"))
    data = searchad_get(
        base_url,
        "/stats",
        {
            "ids": adgroup_id,
            "fields": fields,
            "timeRange": time_range,
        },
        api_license,
        secret_key,
        customer_id,
    )
    if isinstance(data, list) and data:
        return data[0] if isinstance(data[0], dict) else {}
    if isinstance(data, dict):
        return data
    return {}


def fetch_keyword_stats(
    base_url: str,
    api_license: str,
    secret_key: str,
    customer_id: str,
    keyword_id: str,
    metric_date: str,
) -> dict[str, Any]:
    time_range = json.dumps({"since": metric_date, "until": metric_date}, separators=(",", ":"))
    fields = json.dumps(["impCnt", "clkCnt", "salesAmt", "ccnt", "ctr", "cpc"], separators=(",", ":"))
    data = searchad_get(
        base_url,
        "/stats",
        {
            "ids": keyword_id,
            "fields": fields,
            "timeRange": time_range,
        },
        api_license,
        secret_key,
        customer_id,
    )
    if isinstance(data, list) and data:
        return data[0] if isinstance(data[0], dict) else {}
    if isinstance(data, dict):
        return data
    return {}


def _to_num(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def _normalize_stats_record(stats: dict[str, Any]) -> dict[str, Any]:
    if isinstance(stats, dict):
        data = stats.get("data")
        if isinstance(data, list) and data and isinstance(data[0], dict):
            return data[0]
        return stats
    return {}


def build_metric_row(
    hospital_id: str,
    customer_id: str,
    campaign_id: str,
    campaign_name: str | None,
    adgroup_id: str,
    adgroup_name: str | None,
    keyword_id: str,
    keyword_name: str | None,
    metric_date: str,
    stats: dict[str, Any],
    campaign_type: str | None = None,
) -> dict[str, Any]:
    stat = _normalize_stats_record(stats)
    return {
        "metric_date": metric_date,
        "hospital_id": hospital_id,
        "customer_id": customer_id,
        "campaign_id": campaign_id,
        "campaign_name": campaign_name,
        "campaign_type": campaign_type,
        "adgroup_id": adgroup_id,
        "adgroup_name": adgroup_name,
        "keyword_id": keyword_id,
        "keyword_name": keyword_name,
        "impressions": int(_to_num(stat.get("impCnt")) or 0),
        "clicks": int(_to_num(stat.get("clkCnt")) or 0),
        "cost": _to_num(stat.get("salesAmt")),
        "conversions": _to_num(stat.get("ccnt")),
        "conversion_value": None,
        "raw_payload": stats or {},
        "collected_at": datetime.now(timezone.utc).isoformat(),
    }


def upsert_daily_metrics(supabase_url: str, service_key: str, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    params = {"on_conflict": "metric_date,customer_id,campaign_id,adgroup_id,keyword_id"}
    url = f"{supabase_url.rstrip('/')}/rest/v1/analytics_searchad_daily_metrics?{urlencode(params)}"
    headers = _supabase_headers(service_key, profile="analytics")
    headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
    req = Request(url, data=json.dumps(rows).encode("utf-8"), headers=headers, method="POST")
    with _urlopen_with_retry(req, timeout=40):
        pass
    return len(rows)


def update_last_synced_at(supabase_url: str, service_key: str, hospital_id: str, customer_id: str) -> None:
    now_iso = datetime.now(timezone.utc).isoformat()
    params = {"id": f"eq.{hospital_id}"}
    url = f"{supabase_url.rstrip('/')}/rest/v1/hospitals?{urlencode(params)}"
    body = {"searchad_last_synced_at": now_iso}
    headers = _supabase_headers(service_key, profile="core")
    req = Request(url, data=json.dumps(body).encode("utf-8"), headers=headers, method="PATCH")
    try:
        with _urlopen_with_retry(req, timeout=20):
            return
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        raise RuntimeError(
            "core.hospitals searchad_last_synced_at 갱신 실패: "
            f"status={e.code}, body={body[:500]}."
        ) from e


def collect_one_account(
    searchad_base_url: str,
    metric_date: str,
    account: dict[str, Any],
) -> list[dict[str, Any]]:
    hospital_id = str(account.get("hospital_id") or "").strip()
    customer_id = str(account.get("customer_id") or "").strip()
    api_license = str(account.get("api_license") or "").strip()
    secret_key = resolve_searchad_secret(str(account.get("secret_key_encrypted") or "").strip())
    if not hospital_id or not customer_id or not api_license or not secret_key:
        raise RuntimeError("hospital_id/customer_id/api_license/secret_key_encrypted 값이 비어 있습니다.")

    campaigns = fetch_campaigns(searchad_base_url, api_license, secret_key, customer_id)
    rows: list[dict[str, Any]] = []
    for campaign in campaigns:
        campaign_id = str(campaign.get("nccCampaignId") or campaign.get("id") or "").strip()
        campaign_name = str(campaign.get("name") or "").strip() or None
        campaign_type = str(campaign.get("campaignTp") or "").strip() or None
        if not campaign_id:
            continue
        try:
            stats = fetch_campaign_stats(
                searchad_base_url,
                api_license,
                secret_key,
                customer_id,
                campaign_id,
                metric_date,
            )
            rows.append(
                build_metric_row(
                    hospital_id=hospital_id,
                    customer_id=customer_id,
                    campaign_id=campaign_id,
                    campaign_name=campaign_name,
                    adgroup_id="",
                    adgroup_name=None,
                    keyword_id="",
                    keyword_name=None,
                    metric_date=metric_date,
                    stats=stats,
                    campaign_type=campaign_type,
                )
            )
        except Exception as e:
            print(f"⚠️ campaign 통계 조회 실패: hospital_id={hospital_id} customer_id={customer_id} campaign_id={campaign_id} err={e}")
            continue

        adgroups = fetch_adgroups(searchad_base_url, api_license, secret_key, customer_id, campaign_id)
        for adgroup in adgroups:
            adgroup_id = str(adgroup.get("nccAdgroupId") or adgroup.get("id") or "").strip()
            adgroup_name = str(adgroup.get("name") or "").strip() or None
            if not adgroup_id:
                continue
            try:
                adgroup_stats = fetch_adgroup_stats(
                    searchad_base_url,
                    api_license,
                    secret_key,
                    customer_id,
                    adgroup_id,
                    metric_date,
                )
                rows.append(
                    build_metric_row(
                        hospital_id=hospital_id,
                        customer_id=customer_id,
                        campaign_id=campaign_id,
                        campaign_name=campaign_name,
                        adgroup_id=adgroup_id,
                        adgroup_name=adgroup_name,
                        keyword_id="",
                        keyword_name=None,
                        metric_date=metric_date,
                        stats=adgroup_stats,
                        campaign_type=campaign_type,
                    )
                )
            except Exception as e:
                print(
                    "⚠️ adgroup 통계 조회 실패: "
                    f"hospital_id={hospital_id} customer_id={customer_id} campaign_id={campaign_id} "
                    f"adgroup_id={adgroup_id} err={e}"
                )

            keywords = fetch_keywords(searchad_base_url, api_license, secret_key, customer_id, adgroup_id)
            for keyword in keywords:
                keyword_id = str(keyword.get("nccKeywordId") or keyword.get("id") or "").strip()
                keyword_name = str(keyword.get("keyword") or "").strip() or None
                if not keyword_id:
                    continue
                try:
                    time.sleep(0.05)  # rate limit 여유
                    keyword_stats = fetch_keyword_stats(
                        searchad_base_url,
                        api_license,
                        secret_key,
                        customer_id,
                        keyword_id,
                        metric_date,
                    )
                    rows.append(
                        build_metric_row(
                            hospital_id=hospital_id,
                            customer_id=customer_id,
                            campaign_id=campaign_id,
                            campaign_name=campaign_name,
                            adgroup_id=adgroup_id,
                            adgroup_name=adgroup_name,
                            keyword_id=keyword_id,
                            keyword_name=keyword_name,
                            metric_date=metric_date,
                            stats=keyword_stats,
                            campaign_type=campaign_type,
                        )
                    )
                except Exception as e:
                    print(
                        "⚠️ keyword 통계 조회 실패: "
                        f"hospital_id={hospital_id} customer_id={customer_id} campaign_id={campaign_id} "
                        f"adgroup_id={adgroup_id} keyword_id={keyword_id} err={e}"
                    )
    return rows


def main() -> None:
    load_local_env_files()
    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    searchad_base_url = os.getenv("SEARCHAD_API_BASE_URL", "https://api.searchad.naver.com").strip()
    force_metric_date = os.getenv("SEARCHAD_METRIC_DATE", "").strip()
    target_hospital_id = os.getenv("COLLECT_HOSPITAL_ID", "").strip()
    # 사용자 지정 기간(admin 화면). 둘 다 있으면 증분/청크를 끄고 이 구간만 수집.
    range_start = os.getenv("SEARCHAD_METRIC_START", "").strip()[:10]
    range_end = os.getenv("SEARCHAD_METRIC_END", "").strip()[:10]
    explicit_range: tuple[str, str] | None = None
    if range_start and range_end:
        if range_start > range_end:
            raise RuntimeError(
                f"SEARCHAD_METRIC_START({range_start})가 SEARCHAD_METRIC_END({range_end})보다 늦습니다."
            )
        explicit_range = (range_start, range_end)
    try:
        initial_days = int(os.getenv("SEARCHAD_METRICS_INITIAL_DAYS", str(INITIAL_BACKFILL_DAYS)).strip())
    except ValueError:
        initial_days = INITIAL_BACKFILL_DAYS
    if initial_days < 1:
        initial_days = INITIAL_BACKFILL_DAYS

    if not supabase_url or not service_key:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 필요합니다.")

    accounts = fetch_active_accounts(supabase_url, service_key, hospital_id=target_hospital_id or None)
    if not accounts:
        print("ℹ️ 활성 SearchAd 계정이 없습니다. core.hospitals 의 searchad_* 및 searchad_is_active 를 확인하세요.")
        return

    end_date_kst = _to_kst_date_str(-1)
    total_rows = 0
    for account in accounts:
        hospital_id = str(account.get("hospital_id") or "").strip()
        customer_id = str(account.get("customer_id") or "").strip()
        try:
            if force_metric_date:
                print(
                    f"🔎 SearchAd 수집(단일일 SEARCHAD_METRIC_DATE): hospital_id={hospital_id} "
                    f"customer_id={customer_id} metric_date={force_metric_date}"
                )
                rows = collect_one_account(searchad_base_url, force_metric_date, account)
                inserted = upsert_daily_metrics(supabase_url, service_key, rows)
                update_last_synced_at(supabase_url, service_key, hospital_id, customer_id)
                total_rows += inserted
                print(f"✅ SearchAd 수집 완료: hospital_id={hospital_id} upsert_rows={inserted}")
                continue

            if explicit_range:
                # 사용자 지정 기간: 증분/청크 없이 이 구간만 그대로 수집.
                start_d, end_d = explicit_range
                print(
                    f"🔎 SearchAd 수집 구간(지정): hospital_id={hospital_id} customer_id={customer_id} "
                    f"{start_d} ~ {end_d} (KST, 사용자 지정 기간)"
                )
            else:
                max_d = fetch_max_searchad_metric_date(supabase_url, service_key, hospital_id, customer_id)
                span = compute_searchad_metric_range(max_d, end_date_kst, initial_days)
                if span is None:
                    print(
                        f"ℹ️ SearchAd 이미 최신: hospital_id={hospital_id} customer_id={customer_id} "
                        f"KST end={end_date_kst} DB max={max_d or '(없음)'}"
                    )
                    continue
                start_d, end_d = span
                # 백필 청크: 1회 실행 처리량을 SEARCHAD_MAX_DAYS_PER_RUN(일)로 제한.
                # 오래된 날짜부터 채우고, 반복 실행하면 DB max가 전진해 점진적으로 따라잡는다.
                # (0/미설정이면 제한 없음 — 한 번에 전 구간 처리)
                try:
                    max_days_per_run = int(os.getenv("SEARCHAD_MAX_DAYS_PER_RUN", "0").strip() or "0")
                except ValueError:
                    max_days_per_run = 0
                chunked = False
                if max_days_per_run > 0:
                    capped_end = _add_days_ymd(start_d, max_days_per_run - 1)
                    if capped_end < end_d:
                        end_d = capped_end
                        chunked = True
                print(
                    f"🔎 SearchAd 수집 구간: hospital_id={hospital_id} customer_id={customer_id} "
                    f"{start_d} ~ {end_d} (KST, DB max={max_d or '없음'})"
                    + (f" [청크 {max_days_per_run}일/실행 — 반복 실행 필요]" if chunked else "")
                )
            account_inserted = 0
            all_days = list(_iter_dates_inclusive(start_d, end_d))
            total_days = len(all_days)
            for i, d in enumerate(all_days):
                # 진단용 타이밍: API 수집 시간과 upsert 시간을 하루 단위로 분리 측정.
                # 날이 갈수록 api 초가 늘면 throttling, 처음부터 균일하면 원래 그 정도.
                t0 = time.monotonic()
                rows = collect_one_account(searchad_base_url, d, account)
                t1 = time.monotonic()
                inserted = upsert_daily_metrics(supabase_url, service_key, rows)
                t2 = time.monotonic()
                account_inserted += inserted
                print(
                    f"⏱️ {d} ({i + 1}/{total_days}) — {len(rows)}행 "
                    f"· api {t1 - t0:.1f}s · upsert {t2 - t1:.1f}s",
                    flush=True,
                )
                print(
                    "__PROGRESS__ "
                    + json.dumps(
                        {"step": "searchad", "hospital_id": hospital_id, "done": i + 1, "total": total_days, "label": d},
                        separators=(",", ":"),
                    ),
                    flush=True,
                )
            update_last_synced_at(supabase_url, service_key, hospital_id, customer_id)
            total_rows += account_inserted
            print(f"✅ SearchAd 수집 완료: hospital_id={hospital_id} upsert_rows={account_inserted}")
        except HTTPError as e:
            body = e.read().decode("utf-8", errors="ignore")
            print(f"❌ SearchAd HTTP 실패: hospital_id={hospital_id} status={e.code} body={body[:500]}")
        except Exception as e:
            # 진단: 연결/포트 고갈이면 reason에 WinError 코드(10055 ENOBUFS, 10048 EADDRINUSE,
            # 10060 ETIMEDOUT 등)가 나온다. 에러 타입과 reason을 함께 남긴다.
            reason = getattr(e, "reason", None)
            print(
                f"❌ SearchAd 수집 실패: hospital_id={hospital_id} "
                f"err={type(e).__name__}: {e}"
                + (f" reason={reason!r}" if reason is not None else "")
            )

    print(f"\n✅ SearchAd 전체 처리 완료: total_upsert_rows={total_rows}")


if __name__ == "__main__":
    main()
