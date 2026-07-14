'use client';

/**
 * admin '글 검수' 메뉴 — 외부 네이버 블로그 글 검수.
 * 링크만 넣으면 서버가 본문을 가져와 3모델 앙상블로 검수한다. 실패 시 본문 붙여넣기 폴백.
 * 지정 병원으로 과금(바른플랜이면 환불). 결과는 공용 AdminBlogReviewResult 로 표시.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import type { BlogReview } from '@dashboard/blog-review-rubric';
import { AnnotatedBlogReview } from '@/components/admin-blog-review-result';

type Hospital = { id: string; name: string };

const input: CSSProperties = { width: '100%', padding: '8px 11px', fontSize: 14, border: '1px solid var(--border)', borderRadius: 8, background: '#fff', color: 'var(--text)', boxSizing: 'border-box' };
const label: CSSProperties = { fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' };
const btnPrimary: CSSProperties = { padding: '9px 16px', fontSize: 14, fontWeight: 700, borderRadius: 8, background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)', cursor: 'pointer' };

export default function AdminBlogReview({ embedded = false }: { embedded?: boolean } = {}) {
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [hospitalId, setHospitalId] = useState('');
  const [url, setUrl] = useState('');
  const [paste, setPaste] = useState(false);
  const [title, setTitle] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [tags, setTags] = useState('');
  const [imageCount, setImageCount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [review, setReview] = useState<BlogReview | null>(null);
  const [post, setPost] = useState<{ title: string; bodyText: string }>({ title: '', bodyText: '' });

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/admin/data/hospitals', { credentials: 'include' });
        const data = (await res.json()) as { hospitals?: Hospital[] };
        setHospitals((data.hospitals ?? []).filter((h) => h.id && h.name));
      } catch {
        /* 병원 목록 없이도 검수는 가능(무과금) */
      }
    })();
  }, []);

  async function run() {
    setLoading(true);
    setError('');
    setReview(null);
    try {
      const payload: Record<string, unknown> = { sourceType: 'external', hospitalId: hospitalId || undefined };
      if (paste) {
        if (!bodyText.trim()) throw new Error('본문을 입력해 주세요.');
        payload.title = title;
        payload.bodyText = bodyText;
        payload.tags = tags.split(',').map((t) => t.trim()).filter(Boolean);
        if (imageCount.trim()) payload.imageCount = Number(imageCount);
      } else {
        if (!url.trim()) throw new Error('네이버 블로그 링크를 입력해 주세요.');
        payload.sourceUrl = url.trim();
      }
      const res = await fetch('/api/admin/case-blog/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { review?: BlogReview; title?: string; bodyText?: string; error?: string; needsPaste?: boolean };
      if (!res.ok) {
        if (data.needsPaste) setPaste(true);
        throw new Error(data.error ?? '검수에 실패했습니다.');
      }
      if (!data.review) throw new Error('검수 결과가 비었습니다.');
      setReview(data.review);
      setPost({ title: data.title ?? title, bodyText: data.bodyText ?? bodyText });
    } catch (e) {
      setError(e instanceof Error ? e.message : '검수에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ maxWidth: 980 }}>
      {embedded ? null : <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px' }}>글 검수</h1>}
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.5 }}>
        네이버 블로그 링크를 넣으면 본문을 가져와 <b>의학적 정확성</b>과 <b>네이버 최적화</b>를 검수합니다. Claude·Grok·Gemini 3개 모델의 공통 지적을 취합합니다.
      </p>

      <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, display: 'grid', gap: 12 }}>
        {!paste ? (
          <div>
            <label style={label}>네이버 블로그 링크</label>
            <input style={input} placeholder="https://blog.naver.com/아이디/글번호" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
        ) : (
          <>
            <div>
              <label style={label}>제목</label>
              <input style={input} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <label style={label}>본문</label>
              <textarea style={{ ...input, minHeight: 200, resize: 'vertical', lineHeight: 1.6 }} value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={label}>태그(쉼표 구분)</label>
                <input style={input} value={tags} onChange={(e) => setTags(e.target.value)} />
              </div>
              <div style={{ width: 120 }}>
                <label style={label}>이미지 수</label>
                <input style={input} type="number" min={0} value={imageCount} onChange={(e) => setImageCount(e.target.value)} />
              </div>
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={label}>과금 병원 (선택 — 바른플랜은 환불)</label>
            <select style={input} value={hospitalId} onChange={(e) => setHospitalId(e.target.value)}>
              <option value="">지정 안 함</option>
              {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
          <button type="button" style={{ ...btnPrimary, opacity: loading ? 0.6 : 1 }} onClick={run} disabled={loading}>
            {loading ? '검수 중…' : '검수하기'}
          </button>
        </div>

        <button type="button" onClick={() => setPaste((v) => !v)} style={{ fontSize: 14, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
          {paste ? '← 링크로 검수' : '링크 대신 본문 직접 붙여넣기'}
        </button>
      </div>

      {error ? <div style={{ marginTop: 12, fontSize: 14, color: '#e5484d', background: '#e5484d14', border: '1px solid #e5484d', borderRadius: 8, padding: '9px 12px' }}>{error}</div> : null}

      {loading ? <div style={{ marginTop: 16, fontSize: 14, color: 'var(--text-muted)' }}>3개 모델로 검수하고 취합하는 중… (수십 초 걸릴 수 있어요)</div> : null}
      </div>

      {review ? <div style={{ marginTop: 18 }}><AnnotatedBlogReview review={review} title={post.title} bodyText={post.bodyText} /></div> : null}
    </div>
  );
}
