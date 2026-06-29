'use client';

import { useCallback, useEffect, useState } from 'react';

// 병원별 카카오 채널/템플릿 편집 — 자체 로드/저장(병원 관리 폼과 독립).
// 채널(발신프로필키·발신번호)이 비어 있으면 그 병원은 회사 기본 채널로 폴백 발송된다.

type Tpl = { template_code: string; emphasis_title: string; body: string; buttons: string; active: boolean };
const EMPTY_TPL: Tpl = { template_code: '', emphasis_title: '', body: '', buttons: '', active: true };

const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '-0.02em' };
const input: React.CSSProperties = { width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' };
const area: React.CSSProperties = { ...input, minHeight: 90, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 };
const card: React.CSSProperties = { padding: 14, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-raised)', display: 'grid', gap: 10 };

function Field({ children, text, hint }: { children: React.ReactNode; text: string; hint?: string }) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={label}>{text}{hint ? <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> — {hint}</span> : null}</span>
      {children}
    </label>
  );
}

function tplFromApi(raw: Record<string, unknown> | null): Tpl {
  if (!raw) return { ...EMPTY_TPL };
  return {
    template_code: String(raw.template_code ?? ''),
    emphasis_title: String(raw.emphasis_title ?? ''),
    body: String(raw.body ?? ''),
    buttons: raw.buttons != null ? JSON.stringify(raw.buttons, null, 2) : '',
    active: raw.active === false ? false : true,
  };
}

export function HospitalKakaoSection({ hospitalId }: { hospitalId: string }) {
  const [senderKey, setSenderKey] = useState('');
  const [senderPhone, setSenderPhone] = useState('');
  const [channelActive, setChannelActive] = useState(true);
  const [survey, setSurvey] = useState<Tpl>({ ...EMPTY_TPL });
  const [report, setReport] = useState<Tpl>({ ...EMPTY_TPL });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async (id: string) => {
    setLoading(true); setMsg('');
    try {
      const res = await fetch(`/api/admin/data/hospitals/${encodeURIComponent(id)}/kakao`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '조회 실패');
      setSenderKey(String(data.channel?.sender_key ?? ''));
      setSenderPhone(String(data.channel?.sender_phone ?? ''));
      setChannelActive(data.channel?.active === false ? false : true);
      setSurvey(tplFromApi(data.templates?.survey ?? null));
      setReport(tplFromApi(data.templates?.report ?? null));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '조회 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (hospitalId) void load(hospitalId); }, [hospitalId, load]);

  const save = async () => {
    setLoading(true); setMsg('');
    // 버튼 JSON 파싱(비어 있으면 null). 잘못되면 저장 중단.
    const parseButtons = (s: string, name: string): unknown => {
      const t = s.trim();
      if (!t) return null;
      try { return JSON.parse(t); } catch { throw new Error(`${name} 버튼 JSON 형식이 올바르지 않습니다.`); }
    };
    try {
      const payload = {
        channel: { sender_key: senderKey, sender_phone: senderPhone, active: channelActive },
        templates: {
          survey: { template_code: survey.template_code, body: survey.body, emphasis_title: survey.emphasis_title, buttons: parseButtons(survey.buttons, '사전문진'), active: survey.active },
          report: { template_code: report.template_code, body: report.body, emphasis_title: report.emphasis_title, buttons: parseButtons(report.buttons, '리포트'), active: report.active },
        },
      };
      const res = await fetch(`/api/admin/data/hospitals/${encodeURIComponent(hospitalId)}/kakao`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '저장 실패');
      setMsg('저장 완료');
      await load(hospitalId);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setLoading(false);
    }
  };

  if (!hospitalId) {
    return <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>병원을 먼저 저장한 뒤 카카오 채널을 설정할 수 있습니다.</p>;
  }

  const tplEditor = (title: string, vars: string, tpl: Tpl, set: (t: Tpl) => void) => (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <b style={{ fontSize: 13 }}>{title}</b>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={tpl.active} onChange={(e) => set({ ...tpl, active: e.target.checked })} /> 사용
        </label>
      </div>
      <Field text="템플릿 코드"><input style={input} value={tpl.template_code} onChange={(e) => set({ ...tpl, template_code: e.target.value })} placeholder="예: UI_9061" /></Field>
      <Field text="강조 제목" hint="강조표기형 주제목(변수 사용 가능)"><input style={input} value={tpl.emphasis_title} onChange={(e) => set({ ...tpl, emphasis_title: e.target.value })} /></Field>
      <Field text="본문" hint={`승인 템플릿과 글자까지 일치. 변수: ${vars}`}><textarea style={area} value={tpl.body} onChange={(e) => set({ ...tpl, body: e.target.value })} /></Field>
      <Field text="버튼(JSON)" hint={`예: [{"type":"AC","name":"채널 추가"},{"type":"WL","name":"바로가기","linkMo":"...#{token}..."}]`}>
        <textarea style={{ ...area, minHeight: 70, fontFamily: 'monospace', fontSize: 12 }} value={tpl.buttons} onChange={(e) => set({ ...tpl, buttons: e.target.value })} />
      </Field>
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
        발신프로필키·발신번호를 비워 두면 이 병원은 <b>회사 기본 채널</b>로 발송됩니다(폴백). 템플릿은 병원 채널에 등록·승인된 것과 코드·본문이 정확히 일치해야 합니다.
      </p>

      <div style={card}>
        <b style={{ fontSize: 13 }}>발신 채널</b>
        <Field text="발신프로필키 (senderkey)"><input style={input} value={senderKey} onChange={(e) => setSenderKey(e.target.value)} /></Field>
        <Field text="발신번호"><input style={input} value={senderPhone} onChange={(e) => setSenderPhone(e.target.value)} placeholder="01012345678" /></Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={channelActive} onChange={(e) => setChannelActive(e.target.checked)} /> 채널 사용(끄면 회사 기본 채널로 폴백)
        </label>
      </div>

      {tplEditor('사전문진 템플릿', '#{병원명} #{예약일} #{token} #{surveyUrl}', survey, setSurvey)}
      {tplEditor('리포트 템플릿', '#{환자명} #{검진일} #{병원명} #{token} #{reportUrl}', report, setReport)}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" onClick={() => void save()} disabled={loading}
          style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: loading ? 'default' : 'pointer' }}>
          {loading ? '처리 중…' : '카카오 설정 저장'}
        </button>
        {msg && <span style={{ fontSize: 12.5, color: msg.includes('완료') ? 'var(--text-secondary)' : 'var(--danger, #dc2626)' }}>{msg}</span>}
      </div>
    </div>
  );
}
