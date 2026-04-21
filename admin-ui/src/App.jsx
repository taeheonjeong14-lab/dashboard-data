import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

function cleanEnv(value) {
  if (typeof value !== "string") return "";
  // Remove BOM, trim whitespace, and strip wrapping quotes.
  const v = value.replace(/^\uFEFF/, "").trim();
  return v.replace(/^['"]|['"]$/g, "").trim();
}

const supabaseUrl = cleanEnv(import.meta.env.VITE_SUPABASE_URL);
const supabaseKey = cleanEnv(import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY);

const supabase =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
    : null;

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
    };
    try {
      const [bt, pt, sa] = await Promise.all([
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
      ]);
      if (bt.error) throw bt.error;
      if (pt.error) throw pt.error;
      if (sa.error) throw sa.error;

      base.blog_keywords_text = buildKeywordText(bt.data || []);
      base.place_keywords_text = buildKeywordText(pt.data || []);
      if (sa.data) {
        base.searchad_customer_id = sa.data.customer_id || "";
        base.searchad_api_license = sa.data.api_license || "";
        base.searchad_secret_key_encrypted = sa.data.secret_key_encrypted || "";
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

      setMessage("병원 정보를 저장했습니다.");
      closeModal();
      await refreshAll();
    } catch (e2) {
      setMessage(`병원 저장 실패: ${e2.message || e2}`);
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
