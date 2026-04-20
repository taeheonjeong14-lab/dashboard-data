"""
네이버 검색광고(SearchAd) 병원별 수집기

- 입력: analytics.analytics_searchad_accounts (활성 계정)
- 출력: analytics.analytics_searchad_daily_metrics (일별 캠페인 + 광고그룹 단위 성과)
- 기본 기간: KST 기준 전일(D-1)
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urlencode
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
    params = {
        "select": "hospital_id,customer_id,api_license,secret_key_encrypted",
        "is_active": "eq.true",
        "order": "hospital_id.asc,customer_id.asc",
    }
    if hospital_id:
        params["hospital_id"] = f"eq.{hospital_id}"
    url = f"{supabase_url.rstrip('/')}/rest/v1/analytics_searchad_accounts?{urlencode(params)}"
    req = Request(url, headers=_supabase_headers(service_key, profile="analytics"), method="GET")
    try:
        with urlopen(req, timeout=20) as res:
            return json.loads(res.read().decode("utf-8")) or []
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        raise RuntimeError(
            "analytics_searchad_accounts 조회 실패: "
            f"status={e.code}, body={body[:500]}. "
            "schema.sql 또는 20260416183000_analytics_searchad_tables.sql 반영 여부를 확인하세요."
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


def searchad_get(
    base_url: str,
    uri: str,
    params: dict[str, str],
    api_license: str,
    secret_key: str,
    customer_id: str,
) -> Any:
    query = urlencode(params)
    url = f"{base_url.rstrip('/')}{uri}"
    if query:
        url = f"{url}?{query}"
    headers = build_searchad_headers("GET", uri, api_license, secret_key, customer_id)
    req = Request(url, headers=headers, method="GET")
    with urlopen(req, timeout=30) as res:
        body = res.read().decode("utf-8")
    return json.loads(body) if body else {}


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
    metric_date: str,
    stats: dict[str, Any],
) -> dict[str, Any]:
    stat = _normalize_stats_record(stats)
    return {
        "metric_date": metric_date,
        "hospital_id": hospital_id,
        "customer_id": customer_id,
        "campaign_id": campaign_id,
        "campaign_name": campaign_name,
        "adgroup_id": adgroup_id,
        "adgroup_name": adgroup_name,
        "keyword_id": "",
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
    with urlopen(req, timeout=40):
        pass
    return len(rows)


def update_last_synced_at(supabase_url: str, service_key: str, hospital_id: str, customer_id: str) -> None:
    now_iso = datetime.now(timezone.utc).isoformat()
    params = {
        "hospital_id": f"eq.{hospital_id}",
        "customer_id": f"eq.{customer_id}",
    }
    url = f"{supabase_url.rstrip('/')}/rest/v1/analytics_searchad_accounts?{urlencode(params)}"
    body = {"last_synced_at": now_iso}
    headers = _supabase_headers(service_key, profile="analytics")
    req = Request(url, data=json.dumps(body).encode("utf-8"), headers=headers, method="PATCH")
    with urlopen(req, timeout=20):
        pass


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
                    metric_date=metric_date,
                    stats=stats,
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
                        metric_date=metric_date,
                        stats=adgroup_stats,
                    )
                )
            except Exception as e:
                print(
                    "⚠️ adgroup 통계 조회 실패: "
                    f"hospital_id={hospital_id} customer_id={customer_id} campaign_id={campaign_id} "
                    f"adgroup_id={adgroup_id} err={e}"
                )
    return rows


def main() -> None:
    load_local_env_files()
    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    searchad_base_url = os.getenv("SEARCHAD_API_BASE_URL", "https://api.searchad.naver.com").strip()
    metric_date = os.getenv("SEARCHAD_METRIC_DATE", _to_kst_date_str(-1)).strip()
    target_hospital_id = os.getenv("COLLECT_HOSPITAL_ID", "").strip()

    if not supabase_url or not service_key:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 필요합니다.")

    accounts = fetch_active_accounts(supabase_url, service_key, hospital_id=target_hospital_id or None)
    if not accounts:
        print("ℹ️ 활성 SearchAd 계정이 없습니다. analytics.analytics_searchad_accounts를 확인하세요.")
        return

    total_rows = 0
    for account in accounts:
        hospital_id = str(account.get("hospital_id") or "").strip()
        customer_id = str(account.get("customer_id") or "").strip()
        print(f"🔎 SearchAd 수집 시작: hospital_id={hospital_id} customer_id={customer_id} metric_date={metric_date}")
        try:
            rows = collect_one_account(searchad_base_url, metric_date, account)
            inserted = upsert_daily_metrics(supabase_url, service_key, rows)
            update_last_synced_at(supabase_url, service_key, hospital_id, customer_id)
            total_rows += inserted
            print(f"✅ SearchAd 수집 완료: hospital_id={hospital_id} upsert_rows={inserted}")
        except HTTPError as e:
            body = e.read().decode("utf-8", errors="ignore")
            print(f"❌ SearchAd HTTP 실패: hospital_id={hospital_id} status={e.code} body={body[:500]}")
        except Exception as e:
            print(f"❌ SearchAd 수집 실패: hospital_id={hospital_id} err={e}")

    print(f"\n✅ SearchAd 전체 처리 완료: total_upsert_rows={total_rows}")


if __name__ == "__main__":
    main()
