'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

const DEFAULT_T1 = '환자를 내 아이처럼';
const DEFAULT_T2 = '최고의 진료로 보답하겠습니다';
const CHART_TYPES = [
  { v: 'intovet', l: '인투벳' },
  { v: 'plusvet', l: '플러스벳' },
  { v: 'efriends', l: '이프렌즈' },
  { v: 'woorien_pms', l: '우리엔PMS' },
];
type StepKey = 'intro' | 'nameEn' | 'chart' | 'vetCount' | 'slogan' | 'color' | 'logo' | 'keywords' | 'competitors' | 'review';
const STEPS: StepKey[] = ['intro', 'nameEn', 'chart', 'vetCount', 'slogan', 'color', 'logo', 'keywords', 'competitors', 'review'];

export default function OnboardingPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [hospitalName, setHospitalName] = useState('');
  const [idx, setIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [nameEn, setNameEn] = useState('');
  const [chart, setChart] = useState('');
  const [vetCount, setVetCount] = useState('');
  const [t1, setT1] = useState('');
  const [t2, setT2] = useState('');
  const [color, setColor] = useState('#3182f6');
  const [logoUrl, setLogoUrl] = useState('');
  const [logoBusy, setLogoBusy] = useState(false);
  const [keywords, setKeywords] = useState<string[]>(['']);
  const [competitors, setCompetitors] = useState<string[]>(['']);
  const logoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/onboarding', { credentials: 'include' });
      if (!res.ok) { router.replace('/'); return; }
      const { hospital } = (await res.json()) as { hospital?: Record<string, unknown> };
      if (hospital) {
        if (hospital.onboarding_done === true) { router.replace('/'); return; }
        setHospitalName(String(hospital.name ?? ''));
        setNameEn(String(hospital.name_en ?? ''));
        setChart(String(hospital.chart_type ?? ''));
        setVetCount(hospital.vet_count == null ? '' : String(hospital.vet_count));
        setT1(String(hospital.tagline_line1 ?? ''));
        setT2(String(hospital.tagline_line2 ?? ''));
        if (hospital.brandColor) setColor(String(hospital.brandColor));
        setLogoUrl(String(hospital.logoUrl ?? ''));
      }
      setReady(true);
    })();
  }, [router]);

  const step = STEPS[idx];
  const progress = idx / (STEPS.length - 1);

  const uploadLogo = async (file: File) => {
    setLogoBusy(true); setMsg(null);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch('/api/onboarding/logo', { method: 'POST', credentials: 'include', body: fd });
      const data = (await res.json()) as { ok?: boolean; url?: string; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? '업로드 실패');
      setLogoUrl(data.url ?? '');
    } catch (e) { setMsg(e instanceof Error ? e.message : '업로드 실패'); }
    finally { setLogoBusy(false); }
  };

  const submit = async () => {
    setSaving(true); setMsg(null);
    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name_en: nameEn, chart_type: chart, vet_count: vetCount,
          tagline_line1: t1, tagline_line2: t2, brandColor: color,
          wishKeywords: keywords.map((s) => s.trim()).filter(Boolean),
          wishCompetitors: competitors.map((s) => s.trim()).filter(Boolean),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? '저장 실패');
      router.replace('/');
    } catch (e) { setMsg(e instanceof Error ? e.message : '저장 실패'); setSaving(false); }
  };

  if (!ready) return <div style={box.container}><div style={box.card}><p style={{ color: 'var(--text-muted)' }}>불러오는 중…</p></div></div>;

  const setKw = (i: number, v: string) => setKeywords((a) => a.map((x, j) => (j === i ? v : x)));
  const setCp = (i: number, v: string) => setCompetitors((a) => a.map((x, j) => (j === i ? v : x)));

  return (
    <div style={box.container}>
      <div style={box.card}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <Image src="/logo-login.png" alt="THEHAMM" width={140} height={147} priority style={{ display: 'block', width: 150, height: 'auto', margin: '0 auto' }} />
        </div>
        {step !== 'intro' && (
          <>
            <div style={{ height: 3, background: 'var(--border)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.round(progress * 100)}%`, background: 'var(--accent)', transition: 'width .25s' }} />
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-muted)', margin: '10px 0 18px' }}>{hospitalName} · {idx} / {STEPS.length - 1}</div>
          </>
        )}

        <div key={step} className="stepFade" style={{ display: 'grid', gap: 12, alignContent: 'start', minHeight: 170 }}>
          {step === 'intro' && (
            <div>
              <h2 style={box.h}>환영합니다 🎉</h2>
              <p style={box.p}><b style={{ color: 'var(--text)' }}>{hospitalName}</b>의 병원 정보를 설정할 차례예요. 리포트·블로그 등에 사용되니 몇 가지만 입력해 주세요. (대부분 나중에 설정에서 수정할 수 있어요.)</p>
            </div>
          )}
          {step === 'nameEn' && (<><h2 style={box.h}>병원 영문명</h2><p style={box.p}>리포트 등에 표기될 영문 병원명입니다.</p><input autoFocus style={box.input} value={nameEn} onChange={(e) => setNameEn(e.target.value)} placeholder="e.g. THEHAMM Animal Hospital" /></>)}
          {step === 'chart' && (
            <><h2 style={box.h}>사용 중인 차트(EMR)</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {CHART_TYPES.map((c) => (
                  <button key={c.v || 'none'} type="button" onClick={() => setChart(c.v)} style={chip(chart === c.v)}>{c.l}</button>
                ))}
              </div></>
          )}
          {step === 'vetCount' && (<><h2 style={box.h}>수의사 수</h2><input autoFocus style={box.input} type="number" min={0} value={vetCount} onChange={(e) => setVetCount(e.target.value)} placeholder="예: 3" /></>)}
          {step === 'slogan' && (
            <><h2 style={box.h}>병원 슬로건</h2>
              <p style={box.p}>리포트에 들어갈 문구예요. 비워두면 기본 문구가 사용됩니다. (각 줄 최대 15자)</p>
              <input style={box.input} maxLength={15} value={t1} onChange={(e) => setT1(e.target.value)} placeholder={DEFAULT_T1} />
              <input style={box.input} maxLength={15} value={t2} onChange={(e) => setT2(e.target.value)} placeholder={DEFAULT_T2} />
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>기본값: “{DEFAULT_T1}” / “{DEFAULT_T2}”</p>
            </>
          )}
          {step === 'color' && (
            <><h2 style={box.h}>브랜드 색상</h2><p style={box.p}>리포트·문서에 쓰일 대표 색상입니다.</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 52, height: 40, border: 'none', background: 'none', cursor: 'pointer' }} />
                <input style={{ ...box.input, flex: 1 }} value={color} onChange={(e) => setColor(e.target.value)} placeholder="#3182f6" />
              </div></>
          )}
          {step === 'logo' && (
            <><h2 style={box.h}>병원 로고</h2><p style={box.p}>리포트·문서에 사용할 로고 이미지를 올려주세요. (선택)</p>
              <input ref={logoInput} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); }} />
              <div onClick={() => logoInput.current?.click()} style={{ border: '2px dashed var(--border-strong)', borderRadius: 'var(--radius)', background: 'var(--bg-subtle)', padding: 20, textAlign: 'center', cursor: 'pointer' }}>
                {logoBusy ? '업로드 중…' : logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="logo" style={{ maxHeight: 80, maxWidth: '100%' }} />
                ) : <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>클릭하여 로고 이미지 선택</span>}
              </div>
              {logoUrl && <button type="button" onClick={() => logoInput.current?.click()} style={{ fontSize: 14, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>다른 이미지 선택</button>}
            </>
          )}
          {step === 'keywords' && (
            <><h2 style={box.h}>희망 노출 키워드</h2>
              <p style={box.p}>네이버 포털에서 반드시 우리 병원이 노출되길 희망하시는 키워드가 있으신가요? 최대 5개까지 알려주세요.</p>
              {keywords.map((k, i) => (
                <input key={i} style={box.input} value={k} onChange={(e) => setKw(i, e.target.value)} placeholder={`키워드 ${i + 1}`} />
              ))}
              {keywords.length < 5 && <button type="button" onClick={() => setKeywords((a) => [...a, ''])} style={box.addBtn}>+ 키워드 추가</button>}
            </>
          )}
          {step === 'competitors' && (
            <><h2 style={box.h}>경쟁 병원</h2>
              <p style={box.p}>비교·모니터링을 원하시는 경쟁 병원이 있으신가요? (선택, 최대 5개)</p>
              {competitors.map((c, i) => (
                <input key={i} style={box.input} value={c} onChange={(e) => setCp(i, e.target.value)} placeholder={`경쟁 병원 ${i + 1}`} />
              ))}
              {competitors.length < 5 && <button type="button" onClick={() => setCompetitors((a) => [...a, ''])} style={box.addBtn}>+ 경쟁 병원 추가</button>}
            </>
          )}
          {step === 'review' && (
            <><h2 style={box.h}>입력 내용 확인</h2>
              <div style={{ display: 'grid', gap: 4, fontSize: 14, color: 'var(--text-secondary)' }}>
                <Row k="영문명" v={nameEn} /><Row k="차트" v={CHART_TYPES.find((c) => c.v === chart)?.l ?? '-'} />
                <Row k="수의사 수" v={vetCount} /><Row k="슬로건" v={`${t1 || DEFAULT_T1} / ${t2 || DEFAULT_T2}`} />
                <Row k="브랜드색" v={color} /><Row k="로고" v={logoUrl ? '업로드됨' : '없음'} />
                <Row k="희망 키워드" v={keywords.filter(Boolean).join(', ')} /><Row k="경쟁 병원" v={competitors.filter(Boolean).join(', ')} />
              </div></>
          )}
        </div>

        {msg && <p style={{ color: 'var(--danger)', fontSize: 14, margin: '12px 0 0' }}>{msg}</p>}

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          {idx > 0 && <button type="button" onClick={() => setIdx((i) => i - 1)} style={box.btnSecondary}>이전</button>}
          {step === 'review' ? (
            <button type="button" onClick={() => void submit()} disabled={saving} style={{ ...box.btn, flex: 1, opacity: saving ? 0.6 : 1 }}>{saving ? '저장 중…' : '완료'}</button>
          ) : (
            <button type="button" onClick={() => setIdx((i) => i + 1)} style={{ ...box.btn, flex: 1 }}>{step === 'intro' ? '시작하기' : '다음'}</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div style={{ display: 'flex', gap: 8 }}><span style={{ color: 'var(--text-muted)', minWidth: 80 }}>{k}</span><span style={{ color: 'var(--text)', wordBreak: 'break-all' }}>{v || '—'}</span></div>;
}
function chip(on: boolean): React.CSSProperties {
  return { padding: '9px 16px', fontSize: 14, fontWeight: 600, borderRadius: 999, cursor: 'pointer', border: `1px solid ${on ? 'var(--accent)' : 'var(--border-strong)'}`, background: on ? 'var(--accent-subtle)' : 'var(--bg)', color: on ? 'var(--accent)' : 'var(--text-secondary)' };
}

const box: Record<string, React.CSSProperties> = {
  container: { display: 'flex', minHeight: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-subtle)', padding: 16 },
  card: { width: '100%', maxWidth: 480, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 40, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', margin: '16px 0' },
  h: { margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' },
  p: { margin: '10px 0 4px', fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 },
  input: { width: '100%', padding: '11px 12px', fontSize: 14, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)', outline: 'none', boxSizing: 'border-box' },
  btn: { padding: '12px 16px', fontSize: 14, fontWeight: 700, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer' },
  btnSecondary: { padding: '12px 16px', fontSize: 14, fontWeight: 600, background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)', cursor: 'pointer' },
  addBtn: { padding: '9px', fontSize: 14, fontWeight: 600, color: 'var(--accent)', background: 'var(--bg-subtle)', border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius)', cursor: 'pointer' },
};
