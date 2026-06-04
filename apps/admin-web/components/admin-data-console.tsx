'use client';

import { useEffect, useState } from 'react';
import {
  buildPreview,
  collapseRowsForDedupeUpload,
  fileToSha256,
  parseIntoVetWorkbook,
  parseWoorienPmsWorkbook,
  parseEFriendsFile,
} from '@dashboard/chart-ingest';
import { formatSupabaseError } from '@/lib/format-supabase-error';

const CHART_TYPES = [
  { value: 'intovet', label: 'IntoVet' },
  { value: 'woorien_pms', label: 'Woorien PMS' },
  { value: 'efriends', label: 'eFriends' },
];
const INTO_VET_AMOUNT_COLUMNS = ['BS', 'CB', 'CC'];

const CHART_TYPE_HELP: Record<string, string[]> = {
  common: [
    '차트 종류마다 원천 데이터 구조가 달라 지표 해석 기준이 다를 수 있습니다.',
    '특히 방문수(visit_count) 기준은 차트 종류별로 다를 수 있으니 아래 안내를 확인하세요.',
  ],
  intovet: [
    'IntoVet: 방문수는 (일자 + 고객 + 환자) unique 기준으로 집계합니다.',
    '미상(고객명/환자명 누락) 행은 매출에는 포함되지만 방문/신규고객에는 제외됩니다.',
  ],
  woorien_pms: [
    'Woorien PMS: 방문수는 (일자 + 고객 + 환자) unique 기준으로 집계합니다.',
    'Woorien PMS 중복 덮어쓰기: (일자 + 보호자 + 환자 + 진료내용(F열))이 같으면 최신 업로드 데이터로 치환됩니다.',
    '미상(고객명/환자명 누락) 행은 매출에는 포함되지만 방문/신규고객에는 제외됩니다.',
  ],
  efriends: [
    'eFriends: 보호자 1명이 여러 환자를 보유하는 경우 실제 방문 환자 특정이 어려울 수 있습니다.',
    'eFriends 중복 덮어쓰기: (일자 + 고객명(H컬럼 해석 결과) + 청구서번호(G열))이 같으면 최신 업로드 데이터로 치환됩니다.',
    '따라서 eFriends의 방문수는 환자 구분 없이 (일자 + 고객) 기준으로만 해석하는 것을 권장합니다.',
    'H컬럼 괄호 안 환자명은 참고용이며, KPI 방문 구분 기준으로 강제 사용하지 않습니다.',
    '동명이인(고객명 동일) 구분을 위해, 보유 환자 목록 유사도 기반으로 고객을 분리/병합할 수 있습니다(서버 재빌드에서 처리).',
    '[RETAIL SALES] 행은 미상과 동일하게 매출만 포함하고 방문/신규고객에서는 제외합니다.',
  ],
};

const EMPTY_FORM = {
  id: '',
  name: '',
  name_en: '',
  code: '',
  phone: '',
  address: '',
  addressDetail: '',
  logoUrl: '',
  brandColor: '',
  director_name_ko: '',
  seal_url: '',
  tagline_line1: '',
  tagline_line2: '',
  blog_intro: '',
  blog_outro: '',
  naver_blog_id: '',
  smartplace_stat_url: '',
  debug_port: '',
  blog_keywords_text: '',
  place_keywords_text: '',
  searchad_customer_id: '',
  searchad_api_license: '',
  searchad_secret_key_encrypted: '',
  googleads_customer_id: '',
  googleads_refresh_token_encrypted: '',
};

type AdminDataConsoleMode = 'all' | 'performance' | 'hospitals';

export default function AdminDataConsole({ mode = 'all' }: { mode?: AdminDataConsoleMode }) {
  const showUpload = mode === 'all' || mode === 'performance';
  const showHospitals = mode === 'all' || mode === 'hospitals';
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [hospitals, setHospitals] = useState<
    { id: string; name?: string; naver_blog_id?: string; smartplace_stat_url?: string; debug_port?: number | null }[]
  >([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [hospitalForm, setHospitalForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState('');
  const [selectedHospitalId, setSelectedHospitalId] = useState('');
  const [selectedChartType, setSelectedChartType] = useState(CHART_TYPES[0].value);
  const [selectedIntoVetAmountColumn, setSelectedIntoVetAmountColumn] = useState('BS');
  const [uploadSnapshot, setUploadSnapshot] = useState<{ name: string; bytes: ArrayBuffer } | null>(
    null,
  );
  const [preview, setPreview] = useState<
    (ReturnType<typeof buildPreview> & { estimatedDbRowsAfterDedupe?: number }) | null
  >(null);
  const [previewRows, setPreviewRows] = useState<unknown[]>([]);
  const [previewErrors, setPreviewErrors] = useState<unknown[]>([]);
  const [uploadResult, setUploadResult] = useState<Record<string, unknown> | null>(null);
  const [serverEnv, setServerEnv] = useState<{ serviceRoleConfigured?: boolean } | null>(null);

  const chartHelp = CHART_TYPE_HELP[selectedChartType] || [];

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/admin/data/env');
        const data = await res.json();
        if (res.ok) setServerEnv(data);
      } catch {
        /* ignore */
      }
    })();
    void refreshAll();
  }, []);

  async function refreshAll() {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/admin/data/hospitals');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '조회 실패');
      const rows = data.hospitals || [];
      setHospitals(rows);
      setMessage(
        rows.length === 0
          ? '조회는 성공했지만 병원이 0건입니다. core.hospitals·스키마 노출을 확인하세요.'
          : `데이터를 새로고침했습니다. (${rows.length}건)`,
      );
    } catch (e) {
      setMessage(`조회 실패: ${formatSupabaseError(e)}`);
      setHospitals([]);
    } finally {
      setLoading(false);
    }
  }

  function openCreateModal() {
    setEditingId('');
    setHospitalForm(EMPTY_FORM);
    setIsModalOpen(true);
  }

  async function openEditModal(row: { id: string }) {
    setEditingId(String(row.id || ''));
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(`/api/admin/data/hospitals/${encodeURIComponent(String(row.id))}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '실패');
      setHospitalForm(data.form);
      setIsModalOpen(true);
    } catch (e) {
      setMessage(`수정 데이터 조회 실패: ${formatSupabaseError(e)}`);
    } finally {
      setLoading(false);
    }
  }

  function closeModal() {
    setIsModalOpen(false);
    setEditingId('');
    setHospitalForm(EMPTY_FORM);
  }

  async function saveHospital(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/admin/data/hospitals/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editingId, hospitalForm }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '저장 실패');
      setMessage('병원 정보를 저장했습니다.');
      closeModal();
      await refreshAll();
    } catch (e2) {
      setMessage(`병원 저장 실패: ${formatSupabaseError(e2)}`);
    } finally {
      setLoading(false);
    }
  }

  async function uploadHospitalAsset(assetType: 'logo' | 'seal', file: File | undefined) {
    const hospitalId = String(editingId || hospitalForm.id || '').trim();
    if (!hospitalId) {
      setMessage('신규 병원은 먼저 저장해 hospital_id를 만든 뒤 로고/도장 업로드가 가능합니다.');
      return;
    }
    if (!file) return;

    setLoading(true);
    setMessage('');
    try {
      const form = new FormData();
      form.set('asset_type', assetType);
      form.set('file', file);
      const res = await fetch(`/api/admin/data/hospitals/${encodeURIComponent(hospitalId)}/assets`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '업로드 실패');

      const nextUrl = String(data.url || '');
      if (assetType === 'logo') {
        setHospitalForm((f) => ({ ...f, logoUrl: nextUrl }));
      } else {
        setHospitalForm((f) => ({ ...f, seal_url: nextUrl }));
      }
      setMessage(`${assetType === 'logo' ? '로고' : '도장'} 업로드 완료`);
    } catch (e) {
      setMessage(`자산 업로드 실패: ${formatSupabaseError(e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function onBuildPreview() {
    if (!selectedHospitalId) {
      setMessage('업로드할 병원을 먼저 선택해 주세요.');
      return;
    }
    if (!selectedChartType) {
      setMessage('차트 종류를 먼저 선택해 주세요.');
      return;
    }
    if (!uploadSnapshot) {
      setMessage('업로드 파일을 선택해 주세요.');
      return;
    }
    setLoading(true);
    setMessage('');
    setUploadResult(null);
    try {
      let parsed;
      if (selectedChartType === 'intovet') {
        parsed = await parseIntoVetWorkbook(uploadSnapshot.bytes, selectedHospitalId, {
          amountColumn: selectedIntoVetAmountColumn,
        });
      } else if (selectedChartType === 'woorien_pms') {
        parsed = await parseWoorienPmsWorkbook(uploadSnapshot.bytes, selectedHospitalId);
      } else if (selectedChartType === 'efriends') {
        parsed = await parseEFriendsFile(uploadSnapshot, selectedHospitalId);
      } else {
        throw new Error(`아직 지원하지 않는 차트 종류입니다: ${selectedChartType}`);
      }
      const collapsed = collapseRowsForDedupeUpload(
        parsed.chartType || selectedChartType,
        parsed.rows,
      );
      const p = buildPreview(parsed.rows, parsed.errors);
      const previewObj = {
        ...p,
        estimatedDbRowsAfterDedupe: collapsed.length,
      };
      setPreview(previewObj);
      setPreviewRows(parsed.rows);
      setPreviewErrors(parsed.errors);
      setMessage(
        `미리보기 완료: 정상 ${parsed.rows.length}행 (dedupe 반영 시 DB raw 예상 ${collapsed.length}행) / 오류 ${parsed.errors.length}행`,
      );
    } catch (e) {
      setMessage(`미리보기 실패: ${formatSupabaseError(e)}`);
      setPreview(null);
      setPreviewRows([]);
      setPreviewErrors([]);
    } finally {
      setLoading(false);
    }
  }

  async function onUploadConfirm() {
    if (!selectedHospitalId || !selectedChartType || !uploadSnapshot) return;
    if (!previewRows.length && !previewErrors.length) {
      setMessage('먼저 미리보기를 실행해 주세요.');
      return;
    }
    setLoading(true);
    setMessage('');
    setUploadResult(null);
    try {
      const fileHash = await fileToSha256(uploadSnapshot.bytes);
      const res = await fetch('/api/admin/data/chart-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hospitalId: selectedHospitalId,
          chartType: selectedChartType,
          sourceFileName: uploadSnapshot.name,
          sourceFileHash: fileHash,
          parsedRows: previewRows,
          parseErrors: previewErrors,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || '업로드 실패');
      setUploadResult(result);
      setMessage('업로드가 완료되었습니다.');
      setPreview(null);
      setPreviewRows([]);
      setPreviewErrors([]);
      setUploadSnapshot(null);
    } catch (e) {
      setMessage(`업로드 실패: ${formatSupabaseError(e)}`);
    } finally {
      setLoading(false);
    }
  }

  const srOk = serverEnv?.serviceRoleConfigured;

  return (
    <div className="adminLegacyPage">
      <p className="adminLegacyEnvCheck">
        서버 Service Role: {srOk === true ? 'OK' : srOk === false ? 'MISSING (Vercel에 SUPABASE_SERVICE_ROLE_KEY)' : '…'}
      </p>
      <div className="adminLegacyActions">
        <button type="button" className="adminLegacySecondaryBtn" onClick={() => void refreshAll()} disabled={loading}>
          새로고침
        </button>
        {showHospitals ? (
          <button type="button" className="adminLegacyPrimaryBtn" onClick={openCreateModal} disabled={loading}>
            + 병원 추가
          </button>
        ) : null}
      </div>
      <div className="adminLegacyStatus">{loading ? '처리 중...' : message || '준비'}</div>
      {showUpload ? (
        <section className="adminLegacyPanel">
        <h2>병원 실적 업로드</h2>
        <div className="adminLegacyUploadGrid">
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
          {selectedChartType === 'intovet' && (
            <label>
              IntoVet 금액 컬럼
              <select
                value={selectedIntoVetAmountColumn}
                onChange={(e) => {
                  setSelectedIntoVetAmountColumn(e.target.value);
                  setPreview(null);
                  setPreviewRows([]);
                  setPreviewErrors([]);
                  setUploadResult(null);
                }}
                disabled={loading}
              >
                {INTO_VET_AMOUNT_COLUMNS.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div style={{ gridColumn: '1 / -1', fontSize: 12, opacity: 0.85, lineHeight: 1.4 }}>
            <div>
              <strong>차트별 기준 안내</strong>
            </div>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
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
              onChange={(e) => {
                const file = e.target.files?.[0];
                setPreview(null);
                setPreviewRows([]);
                setPreviewErrors([]);
                setUploadResult(null);
                if (!file) {
                  setUploadSnapshot(null);
                  return;
                }
                void (async () => {
                  try {
                    const bytes = await file.arrayBuffer();
                    setUploadSnapshot({ name: file.name, bytes });
                  } catch (err) {
                    setUploadSnapshot(null);
                    setMessage(`파일을 읽지 못했습니다: ${formatSupabaseError(err)}`);
                  }
                })();
              }}
              disabled={loading}
            />
          </label>
          <div className="adminLegacyUploadActions">
            <button type="button" className="adminLegacySecondaryBtn" onClick={() => void onBuildPreview()} disabled={loading}>
              미리보기
            </button>
            <button
              type="button"
              className="adminLegacyPrimaryBtn"
              onClick={() => void onUploadConfirm()}
              disabled={loading || (!previewRows.length && !previewErrors.length)}
            >
              업로드 확정
            </button>
          </div>
        </div>
        {preview && (
          <div className="adminLegacySummaryBox">
            <div>
              기간: {preview.startDate || '-'} ~ {preview.endDate || '-'}
            </div>
            <div>정상 행: {preview.totalRows}</div>
            <div>오류 행: {preview.errorRows}</div>
            <div>예상 매출 합계: {preview.estimatedSalesAmount.toLocaleString()}</div>
            <div>예상 진료건수(unique customer+patient/day): {preview.uniqueVisitCount}</div>
            {'estimatedDbRowsAfterDedupe' in preview && preview.estimatedDbRowsAfterDedupe != null && (
              <div style={{ marginTop: 4 }}>
                dedupe 후 DB raw 예상 행 수: <strong>{String(preview.estimatedDbRowsAfterDedupe)}</strong>
              </div>
            )}
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>
              <strong>방문 집계 기준</strong>: {chartHelp[0] || '차트별 안내를 확인하세요.'}
            </div>
            {previewErrors.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <strong>오류 행 상세 (최대 20개)</strong>
                <ul>
                  {previewErrors.slice(0, 20).map((err: unknown, idx: number) => {
                    const row = err as { source_row_no?: number; error_message?: string; error_code?: string };
                    return (
                      <li key={`${row.source_row_no ?? 'na'}-${idx}`}>
                        {`row ${row.source_row_no ?? '?'}: ${row.error_message || row.error_code || 'UNKNOWN_ERROR'}`}
                      </li>
                    );
                  })}
                </ul>
                {previewErrors.length > 20 && <div>...외 {previewErrors.length - 20}건</div>}
              </div>
            )}
          </div>
        )}
        {uploadResult && (
          <div className="adminLegacySummaryBox">
            <div>run_id: {String(uploadResult.runId ?? '')}</div>
            <div>DB raw 적재 행: {String(uploadResult.importedRows ?? '')}</div>
            <div>오류 행: {String(uploadResult.errorRows ?? '')}</div>
            <div>신규 고객 마스터 추가: {String(uploadResult.customerInserted ?? 0)}</div>
            <div>고객 마스터 업데이트: {String(uploadResult.customerUpdated ?? 0)}</div>
            <div>고객-환자 링크 추가: {String(uploadResult.customerPatientLinkInserted ?? 0)}</div>
            <div>고객-환자 링크 업데이트: {String(uploadResult.customerPatientLinkUpdated ?? 0)}</div>
            <div>영향 일자 수: {String(uploadResult.affectedDays ?? '')}</div>
          </div>
        )}
        </section>
      ) : null}
      {showHospitals ? (
        <section className="adminLegacyPanel">
        <h2>병원 목록 ({hospitals.length})</h2>
        <div className="adminLegacyTableWrap">
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
                  <td className="adminLegacyMonoCell">{h.id}</td>
                  <td>{h.name}</td>
                  <td className="adminLegacyMonoCell">{h.naver_blog_id || '-'}</td>
                  <td className="adminLegacyUrlCell">{h.smartplace_stat_url || '-'}</td>
                  <td className="adminLegacyMonoCell">{h.debug_port ?? '-'}</td>
                  <td>
                    <button type="button" className="adminLegacySmallBtn" onClick={() => void openEditModal(h)}>
                      수정
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </section>
      ) : null}

      {showHospitals && isModalOpen && (
        <div className="adminLegacyModalBackdrop" onClick={closeModal} role="presentation">
          <div className="adminLegacyModalCard" onClick={(e) => e.stopPropagation()} role="dialog">
            <h3>{editingId ? '병원 정보 수정' : '병원 추가'}</h3>
            <form onSubmit={saveHospital} className="adminLegacyModalForm">
              {editingId && (
                <input placeholder="hospital_id" value={hospitalForm.id} disabled readOnly />
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
                placeholder="name_en (영문 병원명)"
                value={hospitalForm.name_en}
                onChange={(e) => setHospitalForm((f) => ({ ...f, name_en: e.target.value }))}
              />
              <input
                placeholder="code (병원 코드)"
                value={hospitalForm.code}
                onChange={(e) => setHospitalForm((f) => ({ ...f, code: e.target.value }))}
              />
              <input
                placeholder="phone (전화번호)"
                value={hospitalForm.phone}
                onChange={(e) => setHospitalForm((f) => ({ ...f, phone: e.target.value }))}
              />
              <input
                placeholder="address (병원 주소)"
                value={hospitalForm.address}
                onChange={(e) => setHospitalForm((f) => ({ ...f, address: e.target.value }))}
              />
              <input
                placeholder="addressDetail (병원 상세주소)"
                value={hospitalForm.addressDetail}
                onChange={(e) => setHospitalForm((f) => ({ ...f, addressDetail: e.target.value }))}
              />
              <input
                placeholder="logoUrl (병원 로고 URL)"
                value={hospitalForm.logoUrl}
                readOnly
                disabled
              />
              <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                로고 파일 업로드 (png/jpg/jpeg/webp/svg)
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,.svg"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    void uploadHospitalAsset('logo', file);
                  }}
                  disabled={loading}
                />
              </label>
              <input
                placeholder="brandColor (병원 BI 컬러, 예: #0ea5e9)"
                value={hospitalForm.brandColor}
                onChange={(e) => setHospitalForm((f) => ({ ...f, brandColor: e.target.value }))}
              />
              <input
                placeholder="director_name_ko (대표원장 이름)"
                value={hospitalForm.director_name_ko}
                onChange={(e) => setHospitalForm((f) => ({ ...f, director_name_ko: e.target.value }))}
              />
              <input
                placeholder="seal_url (대표원장 도장 URL)"
                value={hospitalForm.seal_url}
                readOnly
                disabled
              />
              <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                도장 파일 업로드 (png/jpg/jpeg/webp/svg)
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,.svg"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    void uploadHospitalAsset('seal', file);
                  }}
                  disabled={loading}
                />
              </label>
              <input
                placeholder="tagline_line1 (병원 슬로건 첫번째 줄)"
                value={hospitalForm.tagline_line1}
                onChange={(e) => setHospitalForm((f) => ({ ...f, tagline_line1: e.target.value }))}
              />
              <input
                placeholder="tagline_line2 (병원 슬로건 두번째 줄)"
                value={hospitalForm.tagline_line2}
                onChange={(e) => setHospitalForm((f) => ({ ...f, tagline_line2: e.target.value }))}
              />
              <textarea
                rows={3}
                placeholder="blog_intro (블로그 인트로)"
                value={hospitalForm.blog_intro}
                onChange={(e) => setHospitalForm((f) => ({ ...f, blog_intro: e.target.value }))}
              />
              <textarea
                rows={3}
                placeholder="blog_outro (블로그 아웃트로)"
                value={hospitalForm.blog_outro}
                onChange={(e) => setHospitalForm((f) => ({ ...f, blog_outro: e.target.value }))}
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
                placeholder={'예시:\n일산동물병원\n고양동물병원'}
                value={hospitalForm.blog_keywords_text}
                onChange={(e) => setHospitalForm((f) => ({ ...f, blog_keywords_text: e.target.value }))}
              />
              <h4>플레이스 키워드 (한 줄에 키워드 1개)</h4>
              <textarea
                rows={4}
                placeholder={'예시:\n일산동물병원\n고양동물병원'}
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
              <div className="adminLegacyModalActions">
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
