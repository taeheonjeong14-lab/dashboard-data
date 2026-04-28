import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { buildPreview, executeChartUpload } from "./lib/chartUpload";
import { fileToSha256, parseIntoVetWorkbook } from "./lib/intovet";
import { parseWoorienPmsWorkbook } from "./lib/woorienPms";
import { parseEFriendsFile } from "./lib/efriends";

function cleanEnv(value) {
  if (typeof value !== "string") return "";
  // Remove BOM, trim whitespace, and strip wrapping quotes.
  const v = value.replace(/^\uFEFF/, "").trim();
  return v.replace(/^['"]|['"]$/g, "").trim();
}

/** Supabase/PostgREST errors often only show "Bad Request" in .message; details carry the real cause. */
function formatSupabaseError(err) {
  if (err == null) return "Unknown error";
  if (typeof err === "string") return err;
  const msg = err.message || String(err);
  const extra = [err.details, err.hint, err.code].filter(Boolean).join(" | ");
  return extra ? `${msg} (${extra})` : msg;
}

const supabaseUrl = cleanEnv(import.meta.env.VITE_SUPABASE_URL);
const supabaseKey = cleanEnv(import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY);

const supabase =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
    : null;

const CHART_TYPES = [
  { value: "intovet", label: "IntoVet" },
  { value: "woorien_pms", label: "Woorien PMS" },
  { value: "efriends", label: "eFriends" },
];

const CHART_TYPE_HELP = {
  common: [
    "차트 종류마다 원천 데이터 구조가 달라 지표 해석 기준이 다를 수 있습니다.",
    "특히 방문수(visit_count) 기준은 차트 종류별로 다를 수 있으니 아래 안내를 확인하세요.",
  ],
  intovet: [
    "IntoVet: 방문수는 (일자 + 고객 + 환자) unique 기준으로 집계합니다.",
    "미상(고객명/환자명 누락) 행은 매출에는 포함되지만 방문/신규고객에는 제외됩니다.",
  ],
  woorien_pms: [
    "Woorien PMS: 방문수는 (일자 + 고객 + 환자) unique 기준으로 집계합니다.",
    "미상(고객명/환자명 누락) 행은 매출에는 포함되지만 방문/신규고객에는 제외됩니다.",
  ],
  efriends: [
    "eFriends: 보호자 1명이 여러 환자를 보유하는 경우 실제 방문 환자 특정이 어려울 수 있습니다.",
    "따라서 eFriends의 방문수는 환자 구분 없이 (일자 + 고객) 기준으로만 해석하는 것을 권장합니다.",
    "H컬럼 괄호 안 환자명은 참고용이며, KPI 방문 구분 기준으로 강제 사용하지 않습니다.",
    "동명이인(고객명 동일) 구분을 위해, 보유 환자 목록 유사도 기반으로 고객을 분리/병합할 수 있습니다(서버 재빌드에서 처리).",
    "[RETAIL SALES] 행은 미상과 동일하게 매출만 포함하고 방문/신규고객에서는 제외합니다.",
  ],
};

const EMPTY_FORM = {
  id: "",
  name: "",
  naver_blog_id: "",
  smartplace_stat_url: "",
  debug_port: "",
  blog_keywords_text: "",
  place_keywords_text: "",
  searchad_customer_id: "",
  searchad_api_license: "",
  searchad_secret_key_encrypted: "",
  googleads_customer_id: "",
  googleads_refresh_token_encrypted: "",
};

function createHospitalId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for older runtime environments.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function upsertHospitalWithCompat(basePayload) {
  const nowIso = new Date().toISOString();
  const candidates = [
    basePayload,
    { ...basePayload, updatedAt: nowIso },
    { ...basePayload, createdAt: nowIso, updatedAt: nowIso },
    { ...basePayload, updated_at: nowIso },
    { ...basePayload, created_at: nowIso, updated_at: nowIso },
  ];

  let lastError = null;
  for (const payload of candidates) {
    const { error } = await supabase
      .schema("core")
      .from("hospitals")
      .upsert(payload, { onConflict: "id" });
    if (!error) return;

    lastError = error;
    const msg = String(error?.message || "");
    // Timestamp column mismatch is common across older schema variants.
    if (!/(createdAt|updatedAt|created_at|updated_at|null value in column)/i.test(msg)) {
      throw error;
    }
  }

  if (lastError) throw lastError;
}

function App() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [hospitals, setHospitals] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [hospitalForm, setHospitalForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState("");
  const [selectedHospitalId, setSelectedHospitalId] = useState("");
  const [selectedChartType, setSelectedChartType] = useState(CHART_TYPES[0].value);
  const [uploadFile, setUploadFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewRows, setPreviewRows] = useState([]);
  const [previewErrors, setPreviewErrors] = useState([]);
  const [uploadResult, setUploadResult] = useState(null);
  const chartHelp = CHART_TYPE_HELP[selectedChartType] || [];

  useEffect(() => {
    void refreshAll();
  }, []);

  async function refreshAll() {
    if (!supabase) {
      setMessage("VITE_SUPABASE_URL / VITE_SUPABASE_SERVICE_ROLE_KEY 설정이 필요합니다.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const h = await supabase
        .schema("core")
        .from("hospitals")
        .select("id,name,naver_blog_id,smartplace_stat_url,debug_port")
        .order("name", { ascending: true });
      if (h.error) throw h.error;
      setHospitals(h.data || []);
      setMessage("데이터를 새로고침했습니다.");
    } catch (e) {
      setMessage(`조회 실패: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  }

  function openCreateModal() {
    setEditingId("");
    setHospitalForm(EMPTY_FORM);
    setIsModalOpen(true);
  }

  function parseKeywordLines(text) {
    return String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({ keyword: line }))
      .filter((x) => x.keyword);
  }

  function buildKeywordText(rows) {
    return (rows || []).map((r) => `${r.keyword}`).join("\n");
  }

  async function openEditModal(row) {
    setEditingId(String(row.id || ""));
    setLoading(true);
    setMessage("");
    const base = {
      id: String(row.id || ""),
      name: row.name || "",
      naver_blog_id: row.naver_blog_id || "",
      smartplace_stat_url: row.smartplace_stat_url || "",
      debug_port: row.debug_port == null ? "" : String(row.debug_port),
      blog_keywords_text: "",
      place_keywords_text: "",
      searchad_customer_id: "",
      searchad_api_license: "",
      searchad_secret_key_encrypted: "",
      googleads_customer_id: "",
      googleads_refresh_token_encrypted: "",
    };
    try {
      const [bt, pt, sa, ga] = await Promise.all([
        supabase
          .schema("analytics")
          .from("analytics_blog_keyword_targets")
          .select("keyword")
          .eq("hospital_id", String(row.id))
          .eq("is_active", true),
        supabase
          .schema("analytics")
          .from("analytics_place_keyword_targets")
          .select("keyword")
          .eq("hospital_id", String(row.id))
          .eq("is_active", true),
        supabase
          .schema("analytics")
          .from("analytics_searchad_accounts")
          .select("customer_id,api_license,secret_key_encrypted,is_active")
          .eq("hospital_id", String(row.id))
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .schema("analytics")
          .from("analytics_googleads_accounts")
          .select("customer_id,refresh_token_encrypted,is_active")
          .eq("hospital_id", String(row.id))
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (bt.error) throw bt.error;
      if (pt.error) throw pt.error;
      if (sa.error) throw sa.error;
      if (ga.error) throw ga.error;

      base.blog_keywords_text = buildKeywordText(bt.data || []);
      base.place_keywords_text = buildKeywordText(pt.data || []);
      if (sa.data) {
        base.searchad_customer_id = sa.data.customer_id || "";
        base.searchad_api_license = sa.data.api_license || "";
        base.searchad_secret_key_encrypted = sa.data.secret_key_encrypted || "";
      }
      if (ga.data) {
        base.googleads_customer_id = ga.data.customer_id || "";
        base.googleads_refresh_token_encrypted = ga.data.refresh_token_encrypted || "";
      }
      setHospitalForm(base);
      setIsModalOpen(true);
    } catch (e) {
      setMessage(`수정 데이터 조회 실패: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  }

  function closeModal() {
    setIsModalOpen(false);
    setEditingId("");
    setHospitalForm(EMPTY_FORM);
  }

  async function saveHospital(e) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const hospitalId = editingId || createHospitalId();
      const payload = {
        id: hospitalId,
        name: hospitalForm.name.trim(),
        naver_blog_id: hospitalForm.naver_blog_id.trim() || null,
        smartplace_stat_url: hospitalForm.smartplace_stat_url.trim() || null,
        debug_port: hospitalForm.debug_port ? Number(hospitalForm.debug_port) : null,
      };
      await upsertHospitalWithCompat(payload);

      const resolvedHospitalId = String(hospitalId || payload.id || "").trim();
      if (!resolvedHospitalId) {
        throw new Error("hospital_id를 확인할 수 없습니다.");
      }

      const blogKeywords = parseKeywordLines(hospitalForm.blog_keywords_text);
      for (const item of blogKeywords) {
        const { error: btErr } = await supabase
          .schema("analytics")
          .from("analytics_blog_keyword_targets")
          .upsert(
            {
              hospital_id: resolvedHospitalId,
              account_id: (hospitalForm.naver_blog_id || "").trim(),
              keyword: item.keyword,
              is_active: true,
              source: "admin-ui",
            },
            { onConflict: "account_id,keyword" }
          );
        if (btErr) throw btErr;
      }

      const placeKeywords = parseKeywordLines(hospitalForm.place_keywords_text);
      for (const item of placeKeywords) {
        const { error: ptErr } = await supabase
          .schema("analytics")
          .from("analytics_place_keyword_targets")
          .upsert(
            {
              hospital_id: resolvedHospitalId,
              keyword: item.keyword,
              is_active: true,
              source: "admin-ui",
            },
            { onConflict: "hospital_id,keyword" }
          );
        if (ptErr) throw ptErr;
      }

      if (
        hospitalForm.searchad_customer_id.trim() &&
        hospitalForm.searchad_api_license.trim() &&
        hospitalForm.searchad_secret_key_encrypted.trim()
      ) {
        const { error: saErr } = await supabase
          .schema("analytics")
          .from("analytics_searchad_accounts")
          .upsert(
            {
              hospital_id: resolvedHospitalId,
              customer_id: hospitalForm.searchad_customer_id.trim(),
              api_license: hospitalForm.searchad_api_license.trim(),
              secret_key_encrypted: hospitalForm.searchad_secret_key_encrypted.trim(),
              is_active: true,
            },
            { onConflict: "hospital_id,customer_id" }
          );
        if (saErr) throw saErr;
      }

      if (hospitalForm.googleads_customer_id.trim()) {
        const { error: gaErr } = await supabase
          .schema("analytics")
          .from("analytics_googleads_accounts")
          .upsert(
            {
              hospital_id: resolvedHospitalId,
              customer_id: hospitalForm.googleads_customer_id.trim().replace(/-/g, ""),
              refresh_token_encrypted: hospitalForm.googleads_refresh_token_encrypted.trim() || null,
              is_active: true,
            },
            { onConflict: "hospital_id,customer_id" }
          );
        if (gaErr) throw gaErr;
      }

      setMessage("병원 정보를 저장했습니다.");
      closeModal();
      await refreshAll();
    } catch (e2) {
      setMessage(`병원 저장 실패: ${e2.message || e2}`);
    } finally {
      setLoading(false);
    }
  }

  async function onBuildPreview() {
    if (!supabase) {
      setMessage("VITE_SUPABASE_URL / VITE_SUPABASE_SERVICE_ROLE_KEY 설정이 필요합니다.");
      return;
    }
    if (!selectedHospitalId) {
      setMessage("업로드할 병원을 먼저 선택해 주세요.");
      return;
    }
    if (!selectedChartType) {
      setMessage("차트 종류를 먼저 선택해 주세요.");
      return;
    }
    if (!uploadFile) {
      setMessage("업로드 파일을 선택해 주세요.");
      return;
    }
    setLoading(true);
    setMessage("");
    setUploadResult(null);
    try {
      let parsed;
      if (selectedChartType === "intovet") {
        parsed = await parseIntoVetWorkbook(uploadFile, selectedHospitalId);
      } else if (selectedChartType === "woorien_pms") {
        parsed = await parseWoorienPmsWorkbook(uploadFile, selectedHospitalId);
      } else if (selectedChartType === "efriends") {
        parsed = await parseEFriendsFile(uploadFile, selectedHospitalId);
      } else {
        throw new Error(`아직 지원하지 않는 차트 종류입니다: ${selectedChartType}`);
      }
      const p = buildPreview(parsed.rows, parsed.errors);
      setPreview(p);
      setPreviewRows(parsed.rows);
      setPreviewErrors(parsed.errors);
      setMessage(`미리보기 완료: 정상 ${parsed.rows.length}행 / 오류 ${parsed.errors.length}행`);
    } catch (e) {
      setMessage(`미리보기 실패: ${e.message || e}`);
      setPreview(null);
      setPreviewRows([]);
      setPreviewErrors([]);
    } finally {
      setLoading(false);
    }
  }

  async function onUploadConfirm() {
    if (!supabase || !selectedHospitalId || !selectedChartType || !uploadFile) return;
    if (!previewRows.length && !previewErrors.length) {
      setMessage("먼저 미리보기를 실행해 주세요.");
      return;
    }
    setLoading(true);
    setMessage("");
    setUploadResult(null);
    try {
      const fileHash = await fileToSha256(uploadFile);
      const result = await executeChartUpload({
        supabase,
        hospitalId: selectedHospitalId,
        chartType: selectedChartType,
        sourceFileName: uploadFile.name,
        sourceFileHash: fileHash,
        parsedRows: previewRows,
        parseErrors: previewErrors,
      });
      setUploadResult(result);
      setMessage("업로드가 완료되었습니다.");
      setPreview(null);
      setPreviewRows([]);
      setPreviewErrors([]);
      setUploadFile(null);
    } catch (e) {
      setMessage(`업로드 실패: ${formatSupabaseError(e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <header className="topHeader">
        <h1>Dashboard Data Admin (Local)</h1>
        <p>병원 목록 조회/추가/수정</p>
        <p className="envCheck">
          env check: URL={supabaseUrl ? "OK" : "MISSING"} / KEY={supabaseKey ? "OK" : "MISSING"}
        </p>
      </header>
      <div className="actions">
        <button className="secondaryBtn" onClick={() => void refreshAll()} disabled={loading}>
          새로고침
        </button>
        <button className="primaryBtn" onClick={openCreateModal} disabled={loading}>
          + 병원 추가
        </button>
      </div>
      <div className="status">{loading ? "처리 중..." : message || "준비"}</div>
      <section className="panel">
        <h2>병원 실적 업로드</h2>
        <div className="uploadGrid">
          <label>
            병원 선택
            <select
              value={selectedHospitalId}
              onChange={(e) => setSelectedHospitalId(e.target.value)}
              disabled={loading}
            >
              <option value="">병원을 선택하세요</option>
              {hospitals.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} ({h.id})
                </option>
              ))}
            </select>
          </label>
          <label>
            차트 종류
            <select
              value={selectedChartType}
              onChange={(e) => {
                setSelectedChartType(e.target.value);
                setPreview(null);
                setPreviewRows([]);
                setPreviewErrors([]);
                setUploadResult(null);
              }}
              disabled={loading}
            >
              {CHART_TYPES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <div style={{ gridColumn: "1 / -1", fontSize: 12, opacity: 0.85, lineHeight: 1.4 }}>
            <div>
              <strong>차트별 기준 안내</strong>
            </div>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {CHART_TYPE_HELP.common.map((t, i) => (
                <li key={`common-${i}`}>{t}</li>
              ))}
              {chartHelp.map((t, i) => (
                <li key={`chart-${i}`}>{t}</li>
              ))}
            </ul>
          </div>
          <label>
            업로드 파일
            <input
              type="file"
              accept=".xls,.xlsx,.csv"
              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              disabled={loading}
            />
          </label>
          <div className="uploadActions">
            <button className="secondaryBtn" onClick={() => void onBuildPreview()} disabled={loading}>
              미리보기
            </button>
            <button
              className="primaryBtn"
              onClick={() => void onUploadConfirm()}
              disabled={loading || (!previewRows.length && !previewErrors.length)}
            >
              업로드 확정
            </button>
          </div>
        </div>
        {preview && (
          <div className="summaryBox">
            <div>기간: {preview.startDate || "-"} ~ {preview.endDate || "-"}</div>
            <div>정상 행: {preview.totalRows}</div>
            <div>오류 행: {preview.errorRows}</div>
            <div>예상 매출 합계: {preview.estimatedSalesAmount.toLocaleString()}</div>
            <div>예상 진료건수(unique customer+patient/day): {preview.uniqueVisitCount}</div>
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>
              <strong>방문 집계 기준</strong>: {chartHelp[0] || "차트별 안내를 확인하세요."}
            </div>
            {previewErrors.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <strong>오류 행 상세 (최대 20개)</strong>
                <ul>
                  {previewErrors.slice(0, 20).map((err, idx) => (
                    <li key={`${err.source_row_no || "na"}-${idx}`}>
                      {`row ${err.source_row_no ?? "?"}: ${err.error_message || err.error_code || "UNKNOWN_ERROR"}`}
                    </li>
                  ))}
                </ul>
                {previewErrors.length > 20 && (
                  <div>...외 {previewErrors.length - 20}건</div>
                )}
              </div>
            )}
          </div>
        )}
        {uploadResult && (
          <div className="summaryBox">
            <div>run_id: {uploadResult.runId}</div>
            <div>적재 행: {uploadResult.importedRows}</div>
            <div>오류 행: {uploadResult.errorRows}</div>
            <div>신규 고객 마스터 추가: {uploadResult.customerInserted ?? 0}</div>
            <div>고객 마스터 업데이트: {uploadResult.customerUpdated ?? 0}</div>
            <div>고객-환자 링크 추가: {uploadResult.customerPatientLinkInserted ?? 0}</div>
            <div>고객-환자 링크 업데이트: {uploadResult.customerPatientLinkUpdated ?? 0}</div>
            <div>영향 일자 수: {uploadResult.affectedDays}</div>
          </div>
        )}
      </section>
      <section className="panel">
        <h2>병원 목록 ({hospitals.length})</h2>
        <div className="tableWrap">
          <table>
          <thead>
            <tr>
              <th>id</th>
              <th>병원명</th>
              <th>blog_id</th>
              <th>smartplace_url</th>
              <th>debug_port</th>
              <th>수정</th>
            </tr>
          </thead>
          <tbody>
            {hospitals.map((h) => (
              <tr key={h.id}>
                <td className="monoCell">{h.id}</td>
                <td>{h.name}</td>
                <td className="monoCell">{h.naver_blog_id || "-"}</td>
                <td className="urlCell">{h.smartplace_stat_url || "-"}</td>
                <td className="monoCell">{h.debug_port ?? "-"}</td>
                <td>
                  <button className="smallBtn" onClick={() => openEditModal(h)}>
                    수정
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      </section>

      {isModalOpen && (
        <div className="modalBackdrop" onClick={closeModal}>
          <div className="modalCard" onClick={(e) => e.stopPropagation()}>
            <h3>{editingId ? "병원 정보 수정" : "병원 추가"}</h3>
            <form onSubmit={saveHospital} className="modalForm">
              {editingId && (
                <input
                  placeholder="hospital_id"
                  value={hospitalForm.id}
                  disabled
                />
              )}
              <input
                placeholder="병원명"
                required
                value={hospitalForm.name}
                onChange={(e) => setHospitalForm((f) => ({ ...f, name: e.target.value }))}
              />
              <input
                placeholder="naver_blog_id"
                value={hospitalForm.naver_blog_id}
                onChange={(e) => setHospitalForm((f) => ({ ...f, naver_blog_id: e.target.value }))}
              />
              <input
                placeholder="smartplace_stat_url"
                value={hospitalForm.smartplace_stat_url}
                onChange={(e) => setHospitalForm((f) => ({ ...f, smartplace_stat_url: e.target.value }))}
              />
              <input
                placeholder="debug_port (예:7003)"
                value={hospitalForm.debug_port}
                onChange={(e) => setHospitalForm((f) => ({ ...f, debug_port: e.target.value }))}
              />
              <h4>블로그 키워드 (한 줄에 키워드 1개)</h4>
              <textarea
                rows={5}
                placeholder={"예시:\n일산동물병원\n고양동물병원"}
                value={hospitalForm.blog_keywords_text}
                onChange={(e) => setHospitalForm((f) => ({ ...f, blog_keywords_text: e.target.value }))}
              />
              <h4>플레이스 키워드 (한 줄에 키워드 1개)</h4>
              <textarea
                rows={4}
                placeholder={"예시:\n일산동물병원\n고양동물병원"}
                value={hospitalForm.place_keywords_text}
                onChange={(e) => setHospitalForm((f) => ({ ...f, place_keywords_text: e.target.value }))}
              />
              <h4>SearchAd 계정 (선택)</h4>
              <input
                placeholder="customer_id"
                value={hospitalForm.searchad_customer_id}
                onChange={(e) => setHospitalForm((f) => ({ ...f, searchad_customer_id: e.target.value }))}
              />
              <input
                placeholder="api_license"
                value={hospitalForm.searchad_api_license}
                onChange={(e) => setHospitalForm((f) => ({ ...f, searchad_api_license: e.target.value }))}
              />
              <input
                placeholder="secret_key_encrypted (enc::... 또는 평문)"
                value={hospitalForm.searchad_secret_key_encrypted}
                onChange={(e) =>
                  setHospitalForm((f) => ({ ...f, searchad_secret_key_encrypted: e.target.value }))
                }
              />
              <h4>Google Ads 계정 (선택)</h4>
              <input
                placeholder="googleads_customer_id (예: 123-456-7890)"
                value={hospitalForm.googleads_customer_id}
                onChange={(e) => setHospitalForm((f) => ({ ...f, googleads_customer_id: e.target.value }))}
              />
              <input
                placeholder="googleads_refresh_token_encrypted (평문 또는 enc::...)"
                value={hospitalForm.googleads_refresh_token_encrypted}
                onChange={(e) =>
                  setHospitalForm((f) => ({ ...f, googleads_refresh_token_encrypted: e.target.value }))
                }
              />
              <div className="modalActions">
                <button type="button" onClick={closeModal}>
                  취소
                </button>
                <button type="submit" disabled={loading}>
                  저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
