"""
네이버 블로그 순위 확인 도구
- 키워드 목록 + 타깃 블로그 ID 입력
- 아래 세 곳에서만 블로그 순위 확인:
  1) 통합검색 → 검색결과 섹션
  2) 통합검색 → 반려동물 인기글 섹션
  3) 통합검색 상단 → 블로그 탭 (블로그 전용 페이지)
- 플레이스(스마트플레이스) 순위: 통합검색 플레이스 섹션에서 상호명으로 순위 확인 (광고 제외, 2·3페이지까지)

엑셀 입·출력 (여러 블로그 × 각자 키워드 한 번에):
- 입력 파일 (input.xlsx) — 두 종류 시트 사용 가능:

  [시트1] 블로그 순위용 (첫 시트 / 활성 시트)
    - 1행: A열 "블로그 ID", B열 "키워드" (헤더)
    - 2행부터: 한 행 = (블로그 ID, 확인할 키워드). 블로그 ID 비우면 위 행 값 유지
    예시:
      |   A (블로그 ID)  |   B (키워드)    |
      |------------------|-----------------|
    1 | 블로그 ID        | 키워드          |
    2 | jd_ah            | 은평구동물병원   |
    3 | jd_ah            | 수색동물병원     |
    4 |                  | 강아지미용       |  ← jd_ah와 동일

  [시트2] 플레이스 순위용 — 시트 이름 반드시 "플레이스"
    - 1행: A열 "키워드", B열 "상호명" (헤더)
    - 2행부터: 한 행 = (검색할 키워드, 찾을 매장 상호명). 둘 다 필수
    예시:
      |   A (키워드)   |   B (상호명)     |
      |----------------|------------------|
    1 | 키워드         | 상호명           |
    2 | 마포 동물병원  | 힐링동물병원 & 건강검진센터 |
    3 | 은평구 동물병원 | 정든동물병원     |

  - 블로그만 쓰려면 첫 시트만 채우면 됨. 플레이스만 쓰려면 "플레이스" 시트만 채우면 됨. 둘 다 채우면 두 순위 모두 실행.
  - input.xlsx가 없으면 main.py 상단 TARGET_BLOG_ID, KEYWORDS만 사용 (블로그만).

- 출력 (output.xlsx):
  - 시트 "순위결과": 블로그 순위 (블로그 ID, 키워드, 검색결과, 반려동물 인기글, 일반 검색, 블로그(탭), 노출URL, 비고)
  - 시트 "플레이스 순위": 플레이스 순위 (키워드, 상호명, 순위, 비고) — 입력에 "플레이스" 시트가 있을 때만 생성

- 실행: python main.py [입력엑셀] [출력엑셀]
"""

import time
import re
import os
import json
from contextlib import suppress
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import quote, urlparse, parse_qs, unquote, urlencode
from urllib.request import Request, urlopen
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
import openpyxl

# 타깃 블로그 ID (예: blog.naver.com/여기부분)
TARGET_BLOG_ID = "jd_ah"

# 확인할 키워드 목록
KEYWORDS = [
    "은평구동물병원",
    "수색동물병원",
    "상암동동물병원",
    "가좌동동물병원"
]

SECTION_SPECS = [
    ("검색결과", "검색결과_URL", "integrated", "blog_rank_integrated"),
    ("반려동물 인기글", "반려동물 인기글_URL", "pet_popular", "blog_rank_pet_popular"),
    ("일반 검색", "일반 검색_URL", "general", "blog_rank_general"),
    ("블로그(탭)", "블로그(탭)_URL", "tab", "blog_rank_tab"),
]


def normalize_blog_id(blog_id: str) -> str:
    """블로그 ID만 추출 (URL일 수 있음)."""
    s = blog_id.strip()
    m = re.search(r"blog\.naver\.com/([^/?]+)", s)
    if m:
        return m.group(1)
    return s.split("/")[-1] if "/" in s else s


def _normalize_blog_exposed_url(href: str, element=None) -> str | None:
    """
    카드 내 링크에서 실제 블로그 글 URL을 반환한다.
    - /p/crd/rd?...&u=https%3A%2F%2Fblog.naver.com%2Fjd_ah%2F224168368743 형태면 u 파라미터 디코딩
    - a 태그의 cru 속성에 실제 URL이 있으면 우선 사용 (네이버 카드에서 자주 사용)
    - 이미 https://blog.naver.com/... 형태면 그대로 사용 (쿼리 제거하여 글 주소만)
    """
    if not href or not href.strip():
        return None
    href = href.strip()
    # 1) cru 속성에 실제 노출 URL이 있는 경우 (예: cru="https://blog.naver.com/jd_ah/224168368743")
    if element:
        try:
            cru = element.get_attribute("cru")
            if cru and "blog.naver.com" in cru:
                return cru.strip()
        except Exception:
            pass
    # 2) 이미 직접 blog URL인 경우 (쿼리 제거)
    if "blog.naver.com" in href and (href.startswith("http://") or href.startswith("https://")):
        return href.split("?")[0].split("#")[0]
    # 3) 리다이렉트 URL에서 u= 파라미터로 실제 URL이 있는 경우
    if "u=" in href or "u%3D" in href or "u%3d" in href:
        try:
            parsed = urlparse(href)
            qs = parse_qs(parsed.query)
            for key in ("u", "U"):
                if key in qs and qs[key]:
                    raw = qs[key][0]
                    decoded = unquote(raw)
                    if "blog.naver.com" in decoded:
                        return decoded.split("?")[0].split("#")[0]
        except Exception:
            pass
    return href


# 글 주소 형태: https://blog.naver.com/아이디/글번호 (숫자로 끝)
_RE_BLOG_POST_URL = re.compile(r"https?://blog\.naver\.com/[^/]+/\d+", re.I)


def _get_best_blog_post_url_from_card(card, target_id: str) -> str | None:
    """
    카드 안에서 우리 블로그(target_id)로 가는 링크 중 '글 주소'(blog.naver.com/ID/숫자)를 우선 반환.
    반려동물 인기글·블로그 탭처럼 직접 href와 리다이렉트가 섞여 있어도 구체적인 URL을 골라준다.
    """
    candidates: list[str] = []
    for a in card.query_selector_all('a[href*="blog.naver.com"], a[cru*="blog.naver.com"], a[href*="/p/crd/rd"], a[href*="u="]'):
        href = (a.get_attribute("href") or "").strip()
        cru = (a.get_attribute("cru") or "").strip()
        url = None
        if cru and "blog.naver.com" in cru and target_id in cru:
            url = cru.split("?")[0].split("#")[0]
        if not url and href:
            url = _normalize_blog_exposed_url(href, a)
        if url and target_id in url and url not in candidates:
            candidates.append(url)
    # 글 주소 형태(blog.naver.com/ID/숫자)가 있으면 그걸 우선
    for u in candidates:
        if _RE_BLOG_POST_URL.search(u):
            return u
    return candidates[0] if candidates else None


def count_cards(page, container_selector: str, card_selector: str) -> int:
    """컨테이너 내의 카드 개수를 반환한다."""
    try:
        container = page.query_selector(container_selector)
        if not container:
            return 0
        cards = container.query_selector_all(card_selector)
        return len(cards)
    except Exception:
        return 0


def find_rank_in_cards(
    page, container_selector: str, card_selector: str, target_id: str, max_cards: int | None = None
) -> tuple[int | None, str | None]:
    """
    결과 '카드'(항목) 단위로 순위를 센다.
    - container 안에서 card_selector에 맞는 모든 카드를 DOM 순서대로 1, 2, 3...
    - 우리 블로그(blog.naver.com + target_id) 링크가 들어 있는 첫 번째 카드의 (순위, 노출 URL) 반환.
    - max_cards가 지정되면 해당 개수까지만 확인한다.
    """
    try:
        container = page.query_selector(container_selector)
        if not container:
            return None, None

        cards = container.query_selector_all(card_selector)
        if not cards:
            cards = container.query_selector_all('.fds-web-doc-root, [data-template-id="webItem"]')
        if max_cards is not None:
            cards = cards[:max_cards]

        for rank, card in enumerate(cards, 1):
            exposed_url: str | None = None

            links = card.query_selector_all('a[href*="blog.naver.com"]')
            for link in links:
                href = link.get_attribute("href") or ""
                if not href:
                    continue
                if "blog.naver.com" in href:
                    blog_id_match = re.search(r'blog\.naver\.com/([^/?]+)', href)
                    if blog_id_match and blog_id_match.group(1) == target_id:
                        return rank, _get_best_blog_post_url_from_card(card, target_id) or _normalize_blog_exposed_url(href, link) or href
                    if target_id in href:
                        return rank, _get_best_blog_post_url_from_card(card, target_id) or _normalize_blog_exposed_url(href, link) or href

            # 반려동물 인기글/블로그 탭: href에 blog가 인코딩되어 있거나 cru에만 있는 경우
            links_cru = card.query_selector_all('a[cru*="blog.naver.com"]')
            for link in links_cru:
                cru = link.get_attribute("cru") or ""
                if cru and target_id in cru and "blog.naver.com" in cru:
                    return rank, _get_best_blog_post_url_from_card(card, target_id) or cru.strip().split("?")[0].split("#")[0]

            links_rd = card.query_selector_all('a[href*="/p/crd/rd"], a[href*="u="]')
            for link in links_rd:
                href = link.get_attribute("href") or ""
                if not href:
                    continue
                normalized = _normalize_blog_exposed_url(href, link)
                if normalized and target_id in normalized:
                    return rank, _get_best_blog_post_url_from_card(card, target_id) or normalized

            links_in = card.query_selector_all('a[href*="in.naver.com"]')
            for link in links_in:
                href = link.get_attribute("href") or ""
                if not href:
                    continue
                in_match = re.search(r'in\.naver\.com/([^/?]+)', href)
                if in_match and in_match.group(1) == target_id:
                    return rank, _get_best_blog_post_url_from_card(card, target_id) or href

            card_html = card.inner_html() or ""
            if f"blog.naver.com/{target_id}" in card_html or f"in.naver.com/{target_id}" in card_html or target_id in card_html:
                best = _get_best_blog_post_url_from_card(card, target_id)
                if best:
                    return rank, best
                exposed_url = None
                first_blog = card.query_selector('a[href*="blog.naver.com"]')
                if first_blog:
                    h = first_blog.get_attribute("href")
                    exposed_url = _normalize_blog_exposed_url(h, first_blog) if h else None
                if not exposed_url:
                    first_cru = card.query_selector('a[cru*="blog.naver.com"]')
                    if first_cru:
                        cru = first_cru.get_attribute("cru")
                        if cru and target_id in cru:
                            exposed_url = cru.strip().split("?")[0].split("#")[0]
                if not exposed_url:
                    first_rd = card.query_selector('a[href*="/p/crd/rd"], a[href*="u="]')
                    if first_rd:
                        exposed_url = _normalize_blog_exposed_url(first_rd.get_attribute("href"), first_rd)
                if not exposed_url:
                    first_in = card.query_selector('a[href*="in.naver.com"]')
                    if first_in:
                        exposed_url = first_in.get_attribute("href")
                return rank, exposed_url or None

        return None, None
    except Exception as e:
        print(f"find_rank_in_cards 오류: {e}")
        return None, None


def _blog_tab_rank_fallback(page, target_id: str) -> tuple[int | None, str | None]:
    """블로그 탭 페이지에서 카드 구조를 못 찾을 때, 블로그 링크 순서로 순위·노출 URL 반환. 최대 20개까지만 확인. 글 주소 형태 우선."""
    try:
        container = page.query_selector("body")
        if not container:
            return None, None
        # 우리 블로그 링크만 수집 (직접 href + cru + 리다이렉트)
        candidates: list[tuple[int, str]] = []
        seen_urls: set[str] = set()
        for a in container.query_selector_all('a[href*="blog.naver.com"], a[cru*="blog.naver.com"], a[href*="/p/crd/rd"], a[href*="u="]'):
            href = a.get_attribute("href") or ""
            cru = (a.get_attribute("cru") or "").strip()
            url = None
            if cru and "blog.naver.com" in cru and target_id in cru:
                url = cru.split("?")[0].split("#")[0]
            if not url and href:
                url = _normalize_blog_exposed_url(href, a)
            if not url or target_id not in url or url in seen_urls:
                continue
            seen_urls.add(url)
            # 순위 = 지금까지 우리 블로그 URL 개수 (1부터)
            rank = len(candidates) + 1
            if rank > 20:
                break
            candidates.append((rank, url))
        if not candidates:
            return None, None
        # 글 주소 형태(blog.naver.com/ID/숫자)가 있으면 그걸 우선
        for r, u in candidates:
            if _RE_BLOG_POST_URL.search(u):
                return r, u
        return candidates[0][0], candidates[0][1]
    except Exception:
        return None, None


# --- 세 곳의 컨테이너 + 카드(결과 항목) 셀렉터 ---
# 순위 = "몇 번째 카드" (블로그/카페/인플루언서 등 섞여 있어도 카드 순서로 셈)

# 1) 통합검색 → 검색결과 섹션 (한 카드 = 한 결과: 블로그 or 카페 or 인플루언서 등)
# 진짜 "검색결과" 블록은 data-meta-area="web_gen", 노출 시에만 data-slog-visible="true"
SELECTOR_SEARCH_RESULT = [
    '#main_pack div[data-meta-area="web_gen"]',
]
CARD_SEARCH_RESULT = '.fds-web-doc-root'  # 검색결과 한 건 = 한 카드

# 2) 통합검색 → 반려동물 인기글 섹션 (한 카드 = 한 인기글 항목)
# 진짜 "반려동물 인기글"은 data-meta-area="ugB_bsR". kwL_ssT는 "함께 보면 좋은" 섹션이라 제외.
SELECTOR_PET_POPULAR = [
    '#main_pack [data-meta-area="ugB_bsR"]',
    '#main_pack .fds-ugc-single-intention-item-list',
]
# 더보기 클릭 후 열리는 레이어 안의 리스트 컨테이너 (스크롤 시 여기에 항목이 추가됨)
SELECTOR_PET_POPULAR_LAYER = [
    '.bridge_content._lb_open_target [data-meta-area="ugB_bsR"]',
    '.pack_group._lb_content_root [data-meta-area="ugB_bsR"]',
    '.bridge_content._lb_open_target .fds-ugc-single-intention-item-list',
]
CARD_PET_POPULAR = '[data-template-id="ugcItem"]'  # 인기글 한 건 = 한 카드

# 3) 블로그 탭 버튼 + 블로그 탭 페이지에서의 카드
SELECTOR_BLOG_TAB = 'a.tab[href*="tab.blog.all"]'
# 블로그 탭 페이지: 한 카드 = 한 블로그 결과 (직접 href 예: href="https://blog.naver.com/jd_ah/224143308359")
# 새 구조: section.sp_nblog 안에 [data-template-id="ugcItem"] 또는 ul.lst_view > ugcItem
SELECTOR_BLOG_TAB_CONTAINER = [
    '#main_pack section.sp_nblog',  # sds-comps 등 새 DOM에서 카드가 section 직하위에 있을 수 있음
    '#main_pack section.sp_nblog .api_subject_bx ul.lst_view',
    '#main_pack section.sp_nblog ul.lst_view',
    '#main_pack ul.lst_view',
]
CARD_BLOG_TAB = '[data-template-id="ugcItem"]'  # 블로그 탭 페이지의 각 블로그 결과 카드

# 4) 통합검색 → 일반 검색(통합 재정렬 rrB_bdR): 웹·리뷰·영상 혼합, 1/2/3... 페이지네이션
SELECTOR_GENERAL_SEARCH = [
    '#main_pack .spw_rerank[data-collection="rrB_bdR"]',
    '#main_pack [data-slog-container="rrB_bdR"]',
]
# 한 항목 = 한 블록 (data-fender-root + data-meta-area="rrB_bdR")
CARD_GENERAL_SEARCH = 'div[data-fender-root="true"][data-meta-area="rrB_bdR"]'

# --- 플레이스(스마트플레이스) 섹션: 광고 vs 일반 구분 ---
# 일반 예시: data-nmb_vcl-doc-id="31992363", 링크는 map.naver.com, 광고 라벨 없음
# 광고 예시: data-nmb_vcle-doc-id="1331794732_nad-a001-06-...", 링크는 ader.naver.com, "광고" 라벨 있음
#
# | 구분              | 일반 스마트플레이스        | 광고                          |
# |-------------------|----------------------------|-------------------------------|
# | doc-id 속성 이름  | data-nmb_vcl-doc-id        | data-nmb_vcle-doc-id (e 있음) |
# | doc-id 값         | 숫자만 (예: 31992363)     | _nad- 포함 (예: 1331794732_nad-a001-06-...) |
# | 링크 도메인       | map.naver.com              | ader.naver.com                |
# | 광고 라벨         | 없음                       | span.place_blind "광고", SVG place_ad_label_* |


def is_place_card_ad(card) -> bool:
    """
    플레이스 리스트의 한 항목(li)이 광고인지 여부를 판별한다.
    - 일반: data-nmb_vcl-doc-id (숫자만), map.naver.com 링크, 광고 라벨 없음
    - 광고: data-nmb_vcle-doc-id 또는 doc-id 값에 _nad- 포함, ader.naver.com 링크, "광고" 라벨
    card: Playwright ElementHandle (ul.zPw6U > li.c1sly 등)
    """
    try:
        # 1) 속성 이름이 nmb_vcle-doc-id 이면 광고 (일반은 nmb_vcl-doc-id)
        if card.get_attribute("data-nmb_vcle-doc-id"):
            return True
        # 2) data-nmb_vcl-doc-id 값에 _nad- 가 포함되면 광고
        doc_id = card.get_attribute("data-nmb_vcl-doc-id") or ""
        if "_nad-" in doc_id:
            return True
        # 3) 카드 내부에 ader.naver.com 링크가 있으면 광고 (일반은 map.naver.com만 사용)
        if card.query_selector('a[href*="ader.naver.com"]'):
            return True
        # 4) "광고" 라벨 요소가 있으면 광고 (place_ad_label SVG 또는 place_blind "광고")
        if card.query_selector(".place_ad_label_border, .place_ad_label_text"):
            return True
        blind = card.query_selector('span.place_blind')
        if blind and (blind.inner_text() or "").strip() == "광고":
            return True
        return False
    except Exception:
        return False


# 플레이스 섹션: #place-main-section-root → ul.zPw6U → li (광고 제외 후 순위 카운트)
SELECTOR_PLACE_CONTAINER = [
    "#place-main-section-root ul.zPw6U",
    "#place-main-section-root ul[class*='zPw6U']",
    "ul.zPw6U",
]
# 한 항목: li.c1sly 또는 data-nmb_vcl-doc-id / data-nmb_vcle-doc-id
CARD_PLACE = "li.c1sly"


def _normalize_store_name(s: str) -> str:
    """상호명 비교용: 공백 정리, &/&amp; 통일."""
    if not s:
        return ""
    s = (s or "").strip().replace("&amp;", "&").replace("&", " ")
    return " ".join(s.split())


def find_place_rank_in_page(page, container_selector: str, store_name: str) -> tuple[int | None, str | None]:
    """
    플레이스 리스트가 있는 페이지에서 '상호명'과 일치하는 항목의 순위(1부터)와 노출 URL을 반환.
    광고(li)는 순위에서 제외하고, 일반 항목만 1, 2, 3... 카운트.
    """
    try:
        ul = page.query_selector(container_selector)
        if not ul:
            return None, None
        items = ul.query_selector_all(CARD_PLACE)
        if not items:
            items = ul.query_selector_all("li[data-nmb_vcl-doc-id], li[data-nmb_vcle-doc-id]")
        target = _normalize_store_name(store_name)
        rank = 0
        for li in items:
            if is_place_card_ad(li):
                continue
            rank += 1
            name_el = li.query_selector("span.jVsoy")
            name = (name_el.inner_text() or "").strip() if name_el else ""
            if _normalize_store_name(name) == target or (target in _normalize_store_name(name)) or (name and target in name):
                return rank, None  # 플레이스는 URL 수집하지 않음
        return None, None
    except Exception:
        return None, None


def get_place_rank_with_pagination(page, keyword: str, store_name: str, integrated_url: str) -> tuple[int | None, str | None]:
    """
    통합검색 페이지에서 플레이스 섹션을 찾고, 상호명이 일치할 때까지
    현재 페이지 → 다음 페이지 순으로 순위를 찾는다. 광고 제외.
    """
    try:
        container_sel = None
        for sel in SELECTOR_PLACE_CONTAINER:
            if page.query_selector(sel):
                container_sel = sel
                break
        if not container_sel:
            return None, None

        total_rank_offset = 0  # 이전 페이지까지의 (광고 제외) 개수

        while True:
            rank_on_page, url = find_place_rank_in_page(page, container_sel, store_name)
            if rank_on_page is not None:
                return total_rank_offset + rank_on_page, url

            # 현재 페이지의 광고 제외 일반 항목 개수만큼 오프셋 증가
            ul = page.query_selector(container_sel)
            if not ul:
                break
            items = ul.query_selector_all(CARD_PLACE) or ul.query_selector_all("li[data-nmb_vcl-doc-id], li[data-nmb_vcle-doc-id]")
            for li in items:
                if not is_place_card_ad(li):
                    total_rank_offset += 1

            next_btn = page.query_selector('div.cmm_pgs.x5Efp a.cmm_pg_next:not([aria-disabled="true"])')
            if not next_btn:
                break
            next_btn.click()
            page.wait_for_load_state("domcontentloaded", timeout=10000)
            page.wait_for_timeout(300)
            container_sel = None
            for sel in SELECTOR_PLACE_CONTAINER:
                if page.query_selector(sel):
                    container_sel = sel
                    break
            if not container_sel:
                break
        return None, None
    except Exception:
        return None, None


def _is_truthy_env(name: str) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return False
    return str(raw).strip().lower() in {"1", "true", "yes", "y", "on"}


def create_browser_session(playwright, *, headless: bool = True, use_debug_chrome: bool = False, debug_port: int = 9222):
    """
    브라우저 세션 생성:
    - 기본: 독립 Chromium launch
    - CDP 모드: 디버깅 Chrome에 접속
    """
    if use_debug_chrome:
        endpoint = f"http://127.0.0.1:{debug_port}"
        try:
            browser = playwright.chromium.connect_over_cdp(endpoint)
        except Exception as e:
            raise RuntimeError(
                f"디버깅 Chrome(CDP) 연결 실패: {endpoint}. "
                f"Chrome을 --remote-debugging-port={debug_port}로 실행했는지 확인하세요."
            ) from e

        context = browser.contexts[0] if browser.contexts else browser.new_context()

        def cleanup():
            # CDP 모드에서는 기존 사용중인 Chrome 전체 종료를 피한다.
            with suppress(Exception):
                context.close()
            with suppress(Exception):
                browser.close()

        return browser, context, cleanup

    browser = playwright.chromium.launch(headless=headless)
    context = browser.new_context(
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )

    def cleanup():
        with suppress(Exception):
            context.close()
        with suppress(Exception):
            browser.close()

    return browser, context, cleanup


def check_place_ranking(
    keyword: str,
    store_name: str,
    headless: bool = True,
    use_debug_chrome: bool = False,
    debug_port: int = 9222,
) -> dict:
    """
    키워드로 네이버 검색 후 플레이스 섹션에서 상호명이 일치하는 항목의 순위를 찾는다.
    광고는 순위에서 제외하며, 2·3페이지까지 페이지네이션한다.
    """
    encoded_kw = quote(keyword)
    integrated_url = f"https://search.naver.com/search.naver?query={encoded_kw}"
    out = {"keyword": keyword, "store_name": store_name, "rank": None, "url": None, "error": None}

    with sync_playwright() as p:
        browser, context, cleanup = create_browser_session(
            p,
            headless=headless,
            use_debug_chrome=use_debug_chrome,
            debug_port=debug_port,
        )
        try:
            page = context.new_page()
            page.goto(integrated_url, wait_until="domcontentloaded", timeout=15000)
            page.wait_for_timeout(400)
            out["rank"], out["url"] = get_place_rank_with_pagination(page, keyword, store_name, integrated_url)
        except PlaywrightTimeout:
            out["error"] = "페이지 로드 시간 초과"
        except Exception as e:
            out["error"] = str(e)
        finally:
            cleanup()
    return out


def try_click_more_and_find_rank_blog_tab(
    page, container_selector: str, card_selector: str, more_button_selector: str, target_id: str
) -> tuple[int | None, str | None]:
    """
    블로그 탭 "더보기" 버튼을 반복 클릭하여 추가 결과에서 순위를 찾는다.
    최대 20개 카드까지만 확인. 반환: (순위, 노출 URL).
    """
    try:
        max_cards = 20
        current_count = count_cards(page, container_selector, card_selector)
        if current_count >= max_cards:
            return find_rank_in_cards(page, container_selector, card_selector, target_id, max_cards)
        
        # "더보기" 버튼을 반복 클릭하면서 20개까지 확인
        while current_count < max_cards:
            more_button = page.query_selector(more_button_selector)
            if not more_button:
                # 더보기 버튼이 없으면 현재까지의 결과에서만 확인
                break
            
            # 버튼 클릭
            more_button.click()
            page.wait_for_timeout(200)  # 추가 결과 로드 대기
            
            # 카드 수 다시 확인
            new_count = count_cards(page, container_selector, card_selector)
            
            # 카드가 추가되지 않았으면 중단
            if new_count == current_count:
                break
            
            current_count = new_count
            
            if current_count >= max_cards:
                break
        return find_rank_in_cards(page, container_selector, card_selector, target_id, max_cards)
    except Exception:
        return None, None


def try_click_more_and_find_rank_search_result(
    page, more_button_selector: str, target_id: str
) -> int | None:
    """
    검색결과 "더보기" 버튼 클릭 후 페이지 이동하여 추가 결과에서 순위를 찾는다.
    검색결과 "더보기"는 페이지 이동이므로, 새 페이지에서 web_lis 컨테이너를 찾아야 함.
    2페이지의 맨 위 카드부터 1번으로 카운트한다.
    최대 20개 카드까지만 확인한다. 2페이지에 20개가 안 나오면 3페이지로 넘어간다.
    """
    try:
        max_cards = 20
        
        # "더보기" 버튼 찾기 — 여러 셀렉터 시도 (키워드별 DOM 구조 차이 대응)
        clicked = False
        more_button = page.query_selector(more_button_selector)
        if more_button:
            more_button.click()
            clicked = True
        if not clicked:
            for fallback_sel in [
                '#main_pack a[data-heatmap-target=".more2"]',
                'a[data-heatmap-target=".more2"]',
                '[data-meta-area="web_gen"] a[data-heatmap-target=".more2"]',
            ]:
                more_button = page.query_selector(fallback_sel)
                if more_button:
                    more_button.click()
                    clicked = True
                    break
        if not clicked:
            # 텍스트로 찾기 (검색결과 더보기)
            loc = page.locator('a:has-text("검색결과 더보기")')
            if loc.count() > 0:
                loc.first.click()
                clicked = True
        if not clicked:
            return None, None

        # 2페이지 로드 대기
        page.wait_for_load_state("domcontentloaded", timeout=15000)
        page.wait_for_timeout(200)  # 추가 결과 로드 대기

        # 새 페이지에서 web_lis 컨테이너 찾기 (검색결과 전용 페이지, 2페이지)
        # 여러 셀렉터 시도
        container_sel = None
        for sel in [
            '#main_pack div[data-meta-area="web_lis"]',
            '#main_pack [data-meta-area="web_lis"]',
            'div[data-meta-area="web_lis"]',
        ]:
            container = page.query_selector(sel)
            if container:
                container_sel = sel
                break
        
        if not container_sel:
            return None, None

        # 컨테이너가 나타날 때까지 대기
        try:
            page.wait_for_selector(container_sel, timeout=10000)
        except:
            pass
        
        # 카드들이 로드될 때까지 추가 대기
        page.wait_for_timeout(200)
        
        # 카드가 실제로 로드되었는지 확인
        cards = page.query_selector_all(f'{container_sel} {CARD_SEARCH_RESULT}')
        if not cards:
            # 대체 셀렉터로 카드 찾기
            cards = page.query_selector_all(f'{container_sel} .fds-web-doc-root')
        if not cards:
            # 추가 대기 후 다시 시도
            page.wait_for_timeout(200)
            cards = page.query_selector_all(f'{container_sel} {CARD_SEARCH_RESULT}')
        
        rank, url = find_rank_in_cards(page, container_sel, CARD_SEARCH_RESULT, target_id, max_cards)
        if rank is not None:
            return rank, url

        page2_count = count_cards(page, container_sel, CARD_SEARCH_RESULT)
        remaining_cards = max_cards - page2_count
        if page2_count < max_cards and remaining_cards > 0:
            page3_button = page.query_selector('a[href*="page=3"], .paging a:has-text("3"), .paging a.next')
            if page3_button:
                page3_button.click()
                page.wait_for_load_state("domcontentloaded", timeout=15000)
                page.wait_for_timeout(200)
                rank_on_page3, url_on_page3 = find_rank_in_cards(
                    page, container_sel, CARD_SEARCH_RESULT, target_id, remaining_cards
                )
                if rank_on_page3 is not None:
                    return page2_count + rank_on_page3, url_on_page3
        return None, None
    except Exception:
        return None, None


def try_click_more_and_find_rank_pet_popular(
    page, container_selector: str, card_selector: str, more_button_selector: str, target_id: str
) -> tuple[int | None, str | None]:
    """
    반려동물 인기글 "더보기" 클릭 후, 레이어가 열리면 레이어 내 리스트를 기준으로
    스크롤(마우스 휠)로 추가 로드되는 카드까지 확인한다. 최대 20개 카드까지만 확인.
    """
    try:
        max_cards = 20

        current_count = count_cards(page, container_selector, card_selector)
        if current_count >= max_cards:
            return find_rank_in_cards(page, container_selector, card_selector, target_id, max_cards)

        # 1) "더보기" 버튼 클릭 → 레이어(모달) 열림
        more_button = page.query_selector(more_button_selector)
        if more_button:
            more_button.click()
            page.wait_for_timeout(200)

        # 2) 레이어가 열렸다면 레이어 안의 리스트 컨테이너를 사용 (스크롤 시 여기에 항목 추가됨)
        effective_selector = container_selector
        layer_container = None
        for layer_sel in SELECTOR_PET_POPULAR_LAYER:
            el = page.query_selector(layer_sel)
            if el:
                effective_selector = layer_sel
                layer_container = el
                break
        if layer_container is None:
            layer_container = page.query_selector(container_selector)

        current_count = count_cards(page, effective_selector, card_selector)

        # 3) 스크롤 반복 — 레이어는 마우스 휠/스크롤에 반응해 추가 로드
        if layer_container:
            no_change_count = 0
            scroll_round = 0
            while current_count < max_cards and no_change_count < 4 and scroll_round < 15:
                prev_count = current_count
                scroll_round += 1
                try:
                    box = layer_container.bounding_box()
                    if box:
                        # 레이어 영역 중앙에서 마우스 휠로 스크롤 (무한스크롤 트리거)
                        cx = box["x"] + box["width"] / 2
                        cy = box["y"] + min(200, box["height"] / 2)
                        page.mouse.move(cx, cy)
                        for _ in range(3):
                            page.mouse.wheel(0, 400)
                            page.wait_for_timeout(75)
                    page.evaluate("window.scrollBy(0, 350)")
                    page.wait_for_timeout(50)
                    layer_container.evaluate("el => { el.scrollTop = el.scrollHeight; }")
                    page.wait_for_timeout(50)
                except Exception:
                    pass
                current_count = count_cards(page, effective_selector, card_selector)
                if current_count > prev_count:
                    no_change_count = 0
                else:
                    no_change_count += 1

        return find_rank_in_cards(page, effective_selector, card_selector, target_id, max_cards)
    except Exception:
        return None, None


def try_find_rank_general_search(
    page, target_id: str, integrated_url: str
) -> tuple[int | None, bool, str | None]:
    """
    일반 검색(rrB_bdR) 섹션에서 순위를 찾는다. 1페이지에서 먼저 확인하고,
    없으면 2페이지로 넘어가며 최대 20개 항목까지만 확인한다.
    반환: (순위 또는 None, 섹션 존재 여부, 노출 URL 또는 None)
    """
    max_cards = 20
    container_sel = None
    for sel in SELECTOR_GENERAL_SEARCH:
        if page.query_selector(sel):
            container_sel = sel
            break
    if not container_sel:
        return None, False, None

    try:
        rank, url = find_rank_in_cards(
            page, container_sel, CARD_GENERAL_SEARCH, target_id, max_cards=max_cards
        )
        if rank is not None:
            return rank, True, url

        count = count_cards(page, container_sel, CARD_GENERAL_SEARCH)
        if count >= max_cards:
            return None, True, None

        # 2페이지로 이동 시도 (start=11 또는 페이지 번호 2 링크)
        next_link = page.query_selector(
            'a[href*="start=11"], .spw_rerank a[href*="start="], '
            '.paging a:has-text("2"), a.pg_next, [data-collection="rrB_bdR"] a[href*="start="]'
        )
        if not next_link and page.locator('a:has-text("2")').count() > 0:
            next_link = page.locator('a:has-text("2")').first
        if not next_link:
            return None, True, None
        try:
            next_link.click()
        except Exception:
            return None, True, None

        page.wait_for_load_state("domcontentloaded", timeout=15000)
        page.wait_for_timeout(200)
        container_sel = None
        for sel in SELECTOR_GENERAL_SEARCH:
            if page.query_selector(sel):
                container_sel = sel
                break
        if not container_sel:
            return None, True, None

        remaining = max_cards - count
        rank_on_page, url_on_page = find_rank_in_cards(
            page, container_sel, CARD_GENERAL_SEARCH, target_id, max_cards=remaining
        )
        if rank_on_page is not None:
            return count + rank_on_page, True, url_on_page
        return None, True, None
    except Exception:
        return None, True, None


def _close_pet_popular_layer_if_open(page) -> None:
    """
    반려동물 인기글 "더보기"로 연 레이어가 열려 있으면 닫는다.
    일반 검색(rrB_bdR)은 배경(통합검색 본문)에 있으므로, 레이어를 닫아야 탐색 가능.
    """
    try:
        # 1) Escape 키로 레이어 닫기 시도 (대부분의 모달/레이어 공통)
        page.keyboard.press("Escape")
        page.wait_for_timeout(50)
        # 2) 레이어 전용 닫기 버튼 클릭 시도 (네이버 LayerBridge 등)
        for close_sel in [
            'button[aria-label="닫기"]',
            '[class*="close"]',
            '._lb_close',
            '.layer_close',
            '.bridge_content ~ button',
            '.spw_rerank .btn_close',
            'a[role="button"]:has-text("닫기")',
        ]:
            btn = page.query_selector(close_sel)
            if btn:
                try:
                    btn.click()
                    page.wait_for_timeout(50)
                    break
                except Exception:
                    pass
        # 3) 백드롭(딤) 클릭으로 레이어 닫기 시도
        backdrop = page.query_selector('.bridge_backdrop, .layer_backdrop, [class*="backdrop"]')
        if backdrop:
            try:
                backdrop.click()
                page.wait_for_timeout(50)
            except Exception:
                pass
    except Exception:
        pass


def get_three_section_ranks(page, target_id: str, integrated_url: str) -> dict[str, int | None]:
    """
    통합검색(전체 탭) 페이지에서 순서대로:
    1) 검색결과: 통합검색 내 순위 먼저 확인 → 없으면 더보기 클릭 후 2페이지에서 20등까지 확인 → 1페이지로 복귀
    2) 반려동물 인기글: 통합검색 내 순위 먼저 확인 → 없으면 더보기 클릭 후 20등까지 확인 → (레이어 열렸으면) 레이어 닫기
    3) 일반 검색(rrB_bdR): 1페이지에서 확인 → 없으면 2페이지까지 최대 20개 확인
    블로그(탭)은 check_naver_ranking에서 별도 처리.
    """
    result: dict[str, int | None] = {}

    # --- 1) 검색결과: 통합검색 내 순위 먼저 → 없으면 더보기 후 2페이지에서 20등까지 ---
    result["검색결과"] = None
    result["검색결과_URL"] = None
    search_result_exists = False
    page.wait_for_timeout(200)
    try:
        page.wait_for_selector('#main_pack a[data-heatmap-target=".more2"]', state="visible", timeout=8000)
    except Exception:
        try:
            page.locator('a:has-text("검색결과 더보기")').first.wait_for(state="visible", timeout=3000)
        except Exception:
            pass
    for sel in SELECTOR_SEARCH_RESULT:
        container = page.query_selector(sel)
        if container:
            search_result_exists = True
            result["검색결과"], result["검색결과_URL"] = find_rank_in_cards(
                page, sel, CARD_SEARCH_RESULT, target_id
            )
            if result["검색결과"] is None:
                more_button_sel = f'{sel} a[data-heatmap-target=".more2"]'
                result["검색결과"], result["검색결과_URL"] = try_click_more_and_find_rank_search_result(
                    page, more_button_sel, target_id
                )
            break
    if not search_result_exists:
        if page.query_selector('a[data-heatmap-target=".more2"]') or page.locator('a:has-text("검색결과 더보기")').count() > 0:
            search_result_exists = True
            result["검색결과"], result["검색결과_URL"] = find_rank_in_cards(
                page, SELECTOR_SEARCH_RESULT[0], CARD_SEARCH_RESULT, target_id
            )
            if result["검색결과"] is None:
                result["검색결과"], result["검색결과_URL"] = try_click_more_and_find_rank_search_result(
                    page, 'a[data-heatmap-target=".more2"]', target_id
                )
    result["_검색결과_섹션있음"] = search_result_exists

    # 더보기를 눌렀다면 2페이지에 있으므로 1페이지(통합검색)로 복귀
    if search_result_exists:
        page.goto(integrated_url, wait_until="domcontentloaded", timeout=15000)
        page.wait_for_timeout(200)

    # --- 2) 반려동물 인기글 ---
    result["반려동물 인기글"] = None
    result["반려동물 인기글_URL"] = None
    pet_exists = False
    for sel in SELECTOR_PET_POPULAR:
        container = page.query_selector(sel)
        if container:
            pet_exists = True
            result["반려동물 인기글"], result["반려동물 인기글_URL"] = find_rank_in_cards(
                page, sel, CARD_PET_POPULAR, target_id
            )
            if result["반려동물 인기글"] is None:
                more_button_sel = f'{sel} a[data-heatmap-target=".more"]'
                result["반려동물 인기글"], result["반려동물 인기글_URL"] = try_click_more_and_find_rank_pet_popular(
                    page, sel, CARD_PET_POPULAR, more_button_sel, target_id
                )
            break
    result["_반려동물_섹션있음"] = pet_exists

    # 반려동물 인기글 "더보기" 레이어가 열려 있으면 닫기 → 일반 검색은 배경 페이지에서 탐색
    _close_pet_popular_layer_if_open(page)

    # --- 3) 일반 검색(rrB_bdR) ---
    result["일반 검색"] = None
    result["일반 검색_URL"] = None
    general_rank, general_exists, general_url = try_find_rank_general_search(page, target_id, integrated_url)
    result["일반 검색"] = general_rank
    result["일반 검색_URL"] = general_url
    result["_일반검색_섹션있음"] = general_exists
    # 일반 검색에서 2페이지로 갔을 수 있으므로 통합검색 1페이지로 복귀
    if general_exists:
        page.goto(integrated_url, wait_until="domcontentloaded", timeout=15000)
        page.wait_for_timeout(200)

    result["_페이지이동됨"] = False
    return result


def check_naver_ranking(
    keyword: str,
    target_blog_id: str,
    headless: bool = True,
    use_debug_chrome: bool = False,
    debug_port: int = 9222,
) -> dict:
    """
    1) 통합검색(전체 탭) → 검색결과 / 반려동물 인기글 섹션에서 순위 수집
    2) 상단 lnb에서 '블로그' 탭 클릭 → 블로그 탭 페이지에서 순위 수집
    """
    target_id = normalize_blog_id(target_blog_id)
    encoded_kw = quote(keyword)
    integrated_url = f"https://search.naver.com/search.naver?query={encoded_kw}"
    out = {"keyword": keyword, "error": None, "sections": {}}

    with sync_playwright() as p:
        browser, context, cleanup = create_browser_session(
            p,
            headless=headless,
            use_debug_chrome=use_debug_chrome,
            debug_port=debug_port,
        )
        try:
            page = context.new_page()

            # 1) 통합검색: 검색결과 더보기 → 순위 확인 → 1페이지 복귀 → 반려동물 인기글 더보기 → 순위 확인
            page.goto(integrated_url, wait_until="domcontentloaded", timeout=15000)
            page.wait_for_timeout(200)
            out["sections"] = get_three_section_ranks(page, target_id, integrated_url)

            # 2) 상단 lnb에서 블로그 탭 클릭 후 해당 페이지에서 순위 수집 (카드 단위)
            # 검색결과 "더보기"를 클릭해서 페이지가 이동했어도 블로그 탭은 확인 가능
            blog_tab_loc = page.locator(SELECTOR_BLOG_TAB)
            if blog_tab_loc.count() > 0:
                blog_tab_loc.first.click()
                page.wait_for_load_state("domcontentloaded", timeout=15000)
                page.wait_for_timeout(200)
                rank, blog_url = None, None
                for container_sel in SELECTOR_BLOG_TAB_CONTAINER:
                    rank, blog_url = find_rank_in_cards(
                        page, container_sel, CARD_BLOG_TAB, target_id, max_cards=20
                    )
                    if rank is not None:
                        break
                    more_button_sel = f'{container_sel} a[data-heatmap-target=".more"], {container_sel} a.more, {container_sel} button.more'
                    rank, blog_url = try_click_more_and_find_rank_blog_tab(
                        page, container_sel, CARD_BLOG_TAB, more_button_sel, target_id
                    )
                    if rank is not None:
                        break
                if rank is None:
                    rank, blog_url = _blog_tab_rank_fallback(page, target_id)
                out["sections"]["블로그(탭)"] = rank
                out["sections"]["블로그(탭)_URL"] = blog_url
            else:
                out["sections"]["블로그(탭)"] = None
                out["sections"]["블로그(탭)_URL"] = None
        except PlaywrightTimeout:
            out["error"] = "페이지 로드 시간 초과"
        except Exception as e:
            out["error"] = str(e)
        finally:
            cleanup()

    return out


def read_input_excel(path: str) -> list[tuple[str, str]]:
    """엑셀에서 (블로그 ID, 키워드) 쌍 목록을 읽는다. 반드시 첫 번째 시트에서 읽음. A열=블로그 ID, B열=키워드. 빈 블로그 ID는 위 행 값 유지."""
    wb = openpyxl.load_workbook(path, read_only=False)
    ws = wb.worksheets[0]  # 항상 첫 번째 시트 (active가 아니라서 '플레이스' 시트가 선택돼 있어도 블로그는 1번 시트만 사용)
    pairs: list[tuple[str, str]] = []
    last_blog_id = ""
    for row in range(2, (ws.max_row or 0) + 1):
        a = ws.cell(row, 1).value
        b = ws.cell(row, 2).value
        blog_id = (a and str(a).strip()) or last_blog_id
        keyword = (b and str(b).strip()) or ""
        if keyword and keyword.lower() != "키워드":
            if blog_id:
                last_blog_id = blog_id
                pairs.append((blog_id, keyword))
            # 블로그 ID가 비어 있고 last_blog_id도 없으면 첫 행이 헤더만 있는 경우라 스킵
    return pairs


def read_place_input_excel(path: str) -> list[tuple[str, str]]:
    """
    엑셀에서 플레이스 순위 확인용 (키워드, 상호명) 쌍 목록을 읽는다.
    시트 이름이 '플레이스'인 시트에서 A열=키워드, B열=상호명. 시트가 없으면 빈 목록 반환.
    """
    try:
        wb = openpyxl.load_workbook(path, read_only=False)
        if "플레이스" not in wb.sheetnames:
            return []
        ws = wb["플레이스"]
        pairs: list[tuple[str, str]] = []
        for row in range(2, (ws.max_row or 0) + 1):
            a = ws.cell(row, 1).value
            b = ws.cell(row, 2).value
            keyword = (a and str(a).strip()) or ""
            store_name = (b and str(b).strip()) or ""
            if keyword and keyword.lower() != "키워드" and store_name:
                pairs.append((keyword, store_name))
        return pairs
    except Exception:
        return []


def read_blog_input_from_supabase() -> list[tuple[str, str]]:
    """
    Supabase의 analytics.analytics_blog_keyword_targets 에서
    활성화된 (blog_id(account_id), keyword) 쌍을 읽는다.
    """
    supabase_url = os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        raise RuntimeError("DB 입력을 사용하려면 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 필요합니다.")

    params = {
        "select": "account_id,keyword",
        "is_active": "eq.true",
        "order": "account_id.asc,priority.asc,keyword.asc",
    }
    url = f"{supabase_url.rstrip('/')}/rest/v1/analytics_blog_keyword_targets?{urlencode(params)}"
    req = Request(url, headers=_supabase_headers(service_key), method="GET")
    with urlopen(req, timeout=20) as res:
        data = json.loads(res.read().decode("utf-8"))

    pairs: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for row in data or []:
        blog_id = str(row.get("account_id") or "").strip()
        keyword = str(row.get("keyword") or "").strip()
        if not blog_id or not keyword:
            continue
        key = (blog_id, keyword)
        if key in seen:
            continue
        seen.add(key)
        pairs.append(key)
    return pairs


def write_output_excel(
    path: str, results: list[dict], place_results: list[dict] | None = None
) -> None:
    """결과 목록을 엑셀 파일로 저장한다. 순위에 들어온 경우 해당 섹션의 노출 URL 포함. place_results가 있으면 '플레이스 순위' 시트 추가."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "순위결과"
    ws.append([
        "블로그 ID", "키워드",
        "검색결과", "검색결과 노출URL",
        "반려동물 인기글", "반려동물 인기글 노출URL",
        "일반 검색", "일반 검색 노출URL",
        "블로그(탭)", "블로그(탭) 노출URL",
        "비고",
    ])

    def cell_val(sec: dict, key: str) -> str:
        rank = sec.get(key)
        if key == "검색결과" and rank is None:
            return "섹션 없음" if sec.get("_검색결과_섹션있음") is False else "—"
        if key == "반려동물 인기글" and rank is None:
            return "섹션 없음" if sec.get("_반려동물_섹션있음") is False else "—"
        if key == "일반 검색" and rank is None:
            return "섹션 없음" if sec.get("_일반검색_섹션있음") is False else "—"
        if rank is not None:
            return f"{rank}위"
        return "—"

    for r in results:
        blog_id = r.get("blog_id", "")
        kw = r.get("keyword", "")
        err = r.get("error") or ""
        sec = r.get("sections") or {}
        ws.append([
            blog_id,
            kw,
            cell_val(sec, "검색결과"),
            sec.get("검색결과_URL") or "",
            cell_val(sec, "반려동물 인기글"),
            sec.get("반려동물 인기글_URL") or "",
            cell_val(sec, "일반 검색"),
            sec.get("일반 검색_URL") or "",
            cell_val(sec, "블로그(탭)"),
            sec.get("블로그(탭)_URL") or "",
            err,
        ])

    if place_results:
        ws_place = wb.create_sheet("플레이스 순위")
        ws_place.append(["키워드", "상호명", "순위", "비고"])
        for r in place_results:
            rank = r.get("rank")
            ws_place.append([
                r.get("keyword", ""),
                r.get("store_name", ""),
                f"{rank}위" if rank is not None else "—",
                r.get("error") or "",
            ])
    wb.save(path)


def print_result(data: dict) -> None:
    """검색결과, 반려동물 인기글, 일반 검색, 블로그(탭) 네 곳 출력."""
    blog_id = data.get("blog_id", "")
    kw = data["keyword"]
    label = f"{blog_id} / {kw}" if blog_id else kw
    if data["error"]:
        print(f"⚠️ [{label}] 에러: {data['error']}\n")
        return

    sections = data["sections"]
    lines = [f"📌 [{label}]"]

    for key in ["검색결과", "반려동물 인기글", "일반 검색", "블로그(탭)"]:
        rank = sections.get(key)
        # 검색결과 섹션 없음 처리
        if key == "검색결과" and rank is None:
            if sections.get("_검색결과_섹션있음") == False:
                lines.append(f"   • {key}: 섹션 없음")
            else:
                lines.append(f"   • {key}: —")
        # 반려동물 인기글 섹션 없음 처리
        elif key == "반려동물 인기글" and rank is None:
            if sections.get("_반려동물_섹션있음") == False:
                lines.append(f"   • {key}: 섹션 없음")
            else:
                lines.append(f"   • {key}: —")
        # 일반 검색 섹션 없음 처리
        elif key == "일반 검색" and rank is None:
            if sections.get("_일반검색_섹션있음") == False:
                lines.append(f"   • {key}: 섹션 없음")
            else:
                lines.append(f"   • {key}: —")
        # 순위가 있으면 순위 + 노출 URL 표시
        elif rank is not None:
            lines.append(f"   • {key}: {rank}위")
            url = sections.get(
                "검색결과_URL" if key == "검색결과" else "반려동물 인기글_URL" if key == "반려동물 인기글" else "일반 검색_URL" if key == "일반 검색" else "블로그(탭)_URL"
            )
            if url:
                lines.append(f"      → {url}")
        else:
            lines.append(f"   • {key}: —")

    print("\n".join(lines) + "\n")


def _to_kst_date_str() -> str:
    now_utc = datetime.utcnow()
    kst = now_utc + timedelta(hours=9)
    return kst.strftime("%Y-%m-%d")


def _to_rank_value(rank) -> int | None:
    if rank is None:
        return None
    try:
        return int(rank)
    except Exception:
        return None


def _supabase_headers(service_key: str) -> dict:
    return {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }


def _supabase_get_hospital_map(supabase_url: str, service_key: str, blog_ids: list[str]) -> dict:
    cleaned = sorted({str(v).strip() for v in blog_ids if str(v).strip()})
    if not cleaned:
        return {}

    in_values = ",".join(cleaned)
    params = {
        "select": "id,name,naver_blog_id",
        "naver_blog_id": f"in.({in_values})",
    }
    url = f"{supabase_url.rstrip('/')}/rest/v1/hospitals?{urlencode(params)}"
    req = Request(url, headers=_supabase_headers(service_key), method="GET")
    with urlopen(req, timeout=20) as res:
        data = json.loads(res.read().decode("utf-8"))
    out = {}
    for row in data or []:
        blog_id = (row.get("naver_blog_id") or "").strip()
        if not blog_id:
            continue
        out[blog_id] = {
            "hospital_id": str(row.get("id")) if row.get("id") is not None else None,
            "hospital_name": row.get("name"),
        }
    return out


def _build_rank_upsert_payload(results: list[dict], hospital_map: dict, metric_date: str) -> list[dict]:
    payload = []
    collected_at = datetime.utcnow().isoformat() + "Z"
    for item in results:
        blog_id = str(item.get("blog_id") or "").strip()
        keyword = str(item.get("keyword") or "").strip()
        sections = item.get("sections") or {}
        error_msg = item.get("error")
        if not blog_id or not keyword:
            continue

        mapped = hospital_map.get(blog_id) or {}
        hospital_id = mapped.get("hospital_id")
        hospital_name = mapped.get("hospital_name")
        section_ranks: list[int] = []

        for label, url_key, section_key, metric_key in SECTION_SPECS:
            rank_num = _to_rank_value(sections.get(label))
            if rank_num is not None:
                section_ranks.append(rank_num)
                status = "found"
            else:
                if label == "검색결과" and sections.get("_검색결과_섹션있음") is False:
                    status = "section_missing"
                elif label == "반려동물 인기글" and sections.get("_반려동물_섹션있음") is False:
                    status = "section_missing"
                elif label == "일반 검색" and sections.get("_일반검색_섹션있음") is False:
                    status = "section_missing"
                else:
                    status = "not_found"

            payload.append({
                "account_id": blog_id,
                "hospital_id": hospital_id,
                "hospital_name": hospital_name,
                "source": "blog",
                "metric_date": metric_date,
                "metric_key": metric_key,
                "keyword": keyword,
                "section": section_key,
                "rank_value": rank_num,
                "exposed_url": sections.get(url_key),
                "metadata": {
                    "blog_id": blog_id,
                    "keyword": keyword,
                    "section_label": label,
                    "status": status,
                    "error": error_msg,
                },
                "collected_at": collected_at,
            })

        payload.append({
            "account_id": blog_id,
            "hospital_id": hospital_id,
            "hospital_name": hospital_name,
            "source": "blog",
            "metric_date": metric_date,
            "metric_key": "blog_rank_best",
            "keyword": keyword,
            "section": "best",
            "rank_value": min(section_ranks) if section_ranks else None,
            "exposed_url": None,
            "metadata": {
                "blog_id": blog_id,
                "keyword": keyword,
                "status": "found" if section_ranks else "not_found",
                "error": error_msg,
            },
            "collected_at": collected_at,
        })
    return payload


def upload_blog_ranks_to_supabase(results: list[dict], metric_date: str | None = None) -> int:
    supabase_url = os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        print("ℹ️ SUPABASE 환경변수가 없어 DB 업로드를 건너뜁니다.")
        return 0
    if not results:
        return 0

    resolved_metric_date = metric_date or os.getenv("RANK_METRIC_DATE") or _to_kst_date_str()
    hospital_map = _supabase_get_hospital_map(
        supabase_url,
        service_key,
        [str(r.get("blog_id") or "") for r in results],
    )
    payload = _build_rank_upsert_payload(results, hospital_map, resolved_metric_date)
    if not payload:
        return 0

    params = {
        "on_conflict": "account_id,metric_date,keyword,section,metric_key",
    }
    url = f"{supabase_url.rstrip('/')}/rest/v1/analytics_blog_keyword_ranks?{urlencode(params)}"
    headers = _supabase_headers(service_key)
    headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
    req = Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    with urlopen(req, timeout=40):
        pass
    print(f"✅ Supabase 업서트 완료: {len(payload)}건 (metric_date={resolved_metric_date})")
    return len(payload)


def main():
    import sys
    input_path = "input.xlsx"
    output_path = "output.xlsx"
    export_excel = False
    upload_db = True
    metric_date = None
    use_debug_chrome = _is_truthy_env("RANK_USE_DEBUG_CHROME")
    raw_debug_port = os.getenv("CHROME_DEBUGGING_PORT", "9222")
    input_source = os.getenv("RANK_INPUT_SOURCE", "db").strip().lower()
    try:
        debug_port = int(raw_debug_port)
    except ValueError:
        print(f"❌ CHROME_DEBUGGING_PORT 값이 잘못되었습니다: {raw_debug_port}")
        return

    positional = []
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        arg = args[i]
        if arg == "--db-only":
            # Backward compatibility: --db-only means do not write excel.
            export_excel = False
            i += 1
            continue
        if arg == "--no-db":
            upload_db = False
            i += 1
            continue
        if arg == "--export-excel":
            export_excel = True
            i += 1
            continue
        if arg == "--metric-date":
            if i + 1 >= len(args):
                print("❌ --metric-date 다음에 YYYY-MM-DD를 입력하세요.")
                return
            metric_date = args[i + 1]
            i += 2
            continue
        if arg == "--use-debug-chrome":
            use_debug_chrome = True
            i += 1
            continue
        if arg == "--debug-port":
            if i + 1 >= len(args):
                print("❌ --debug-port 다음에 포트 번호를 입력하세요.")
                return
            try:
                debug_port = int(args[i + 1])
            except ValueError:
                print("❌ --debug-port는 숫자여야 합니다. 예: --debug-port 9222")
                return
            i += 2
            continue
        if arg == "--input-source":
            if i + 1 >= len(args):
                print("❌ --input-source 다음에 db 또는 excel 을 입력하세요.")
                return
            input_source = args[i + 1].strip().lower()
            if input_source not in {"db", "excel"}:
                print("❌ --input-source는 db 또는 excel 이어야 합니다.")
                return
            i += 2
            continue
        positional.append(arg)
        i += 1

    if len(positional) >= 1:
        input_path = positional[0]
    if len(positional) >= 2:
        output_path = positional[1]

    if input_source == "db":
        try:
            pairs = read_blog_input_from_supabase()
        except Exception as e:
            print(f"❌ DB 입력 조회 실패: {e}")
            return
        place_pairs: list[tuple[str, str]] = []
    else:
        if Path(input_path).exists():
            pairs = read_input_excel(input_path)
        else:
            target = TARGET_BLOG_ID
            pairs = [(target, kw) for kw in KEYWORDS] if target and KEYWORDS else []
        place_pairs = read_place_input_excel(input_path) if Path(input_path).exists() else []

    if not pairs and not place_pairs:
        if input_source == "db":
            print("❌ 활성화된 키워드 타깃이 없습니다. analytics.analytics_blog_keyword_targets를 확인하세요.")
        else:
            print("❌ 확인할 (블로그 ID, 키워드) 또는 (키워드, 상호명)이 없습니다. input.xlsx를 확인하세요.")
        return
    print(f"ℹ️ 입력 소스: {input_source}")
    if use_debug_chrome:
        print(f"ℹ️ CDP 모드: 디버깅 Chrome 세션 공유 사용 (port={debug_port})")

    results = []
    if pairs:
        print(f"🚀 네이버 블로그 순위 확인 — {len(pairs)}개 조합 (검색결과 / 반려동물 인기글 / 일반 검색 / 블로그(탭))\n")
        for blog_id, kw in pairs:
            if not blog_id or blog_id == "your_blog_id":
                print(f"⚠️ 키워드 '{kw}' 행의 블로그 ID가 비어 있어 스킵합니다.")
                continue
            data = check_naver_ranking(
                kw,
                blog_id,
                use_debug_chrome=use_debug_chrome,
                debug_port=debug_port,
            )
            data["blog_id"] = blog_id
            results.append({
                "blog_id": blog_id,
                "keyword": kw,
                "sections": data.get("sections"),
                "error": data.get("error"),
            })
            print_result(data)
            time.sleep(0.5)

    place_results: list[dict] = []
    if place_pairs:
        print(f"\n🏪 플레이스 순위 확인 — {len(place_pairs)}개 조합 (광고 제외)\n")
        for kw, store in place_pairs:
            data = check_place_ranking(
                kw,
                store,
                use_debug_chrome=use_debug_chrome,
                debug_port=debug_port,
            )
            place_results.append(data)
            err = data.get("error")
            if err:
                print(f"⚠️ [{kw} / {store}] 에러: {err}")
            else:
                rank = data.get("rank")
                print(f"📌 [{kw} / {store}] 플레이스: {rank}위")
            time.sleep(0.5)

    if upload_db and results:
        try:
            upload_blog_ranks_to_supabase(results, metric_date=metric_date)
        except Exception as e:
            print(f"❌ Supabase 업로드 실패: {e}")

    if export_excel:
        write_output_excel(output_path, results, place_results if place_results else None)
        print(f"\n✅ 결과 저장: {output_path}")
    else:
        print("\nℹ️ 기본 모드(DB 직적재)로 엑셀 저장을 건너뜁니다. 필요 시 --export-excel 사용")
    print("✅ 끝.")


if __name__ == "__main__":
    main()
