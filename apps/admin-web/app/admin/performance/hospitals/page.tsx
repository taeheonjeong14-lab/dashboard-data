'use client';

/** 병원별 데이터 진입 — 첫 병원 상세로 보낸다(좌측 레일에서 병원을 바꾼다). */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type HospitalRow = { id: string; name?: string };

export default function AdminPerformanceHospitalsEntry() {
  const router = useRouter();
  const [message, setMessage] = useState('병원 목록을 불러오는 중…');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/data/hospitals', { credentials: 'include' })
      .then((r) => r.json())
      .then((data: { hospitals?: HospitalRow[] }) => {
        if (cancelled) return;
        const list = Array.isArray(data.hospitals) ? data.hospitals : [];
        if (list.length === 0) {
          setMessage('등록된 병원이 없습니다. 병원 관리에서 먼저 등록하세요.');
          return;
        }
        router.replace(`/admin/performance/${list[0].id}/sales`);
      })
      .catch(() => {
        if (!cancelled) setMessage('병원 목록을 불러오지 못했습니다.');
      });
    return () => { cancelled = true; };
  }, [router]);

  return (
    <div className="adminMainSingleGutter">
      <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>{message}</p>
    </div>
  );
}
