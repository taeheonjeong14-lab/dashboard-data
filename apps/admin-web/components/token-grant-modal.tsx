'use client';

import { useState } from 'react';
import { Modal, PrimaryButton } from '@/components/ui/admin-ui';

// 관리자 토큰 지급 모달 — 토큰 수 + 메모(사유).
//
// 메모는 billing.token_ledger.note 에만 남는 '관리자 전용' 기록이다. 병원은 토큰 내역을
// core.my_usage_overview RPC 로만 보고, 그 RPC 는 note 를 내려주지 않는다. 따라서 메모 문구는
// hospital-web 어디에도 노출되지 않는다 — 병원에 보일 문구를 쓰는 칸이 아니라, 왜 지급했는지
// 우리가 나중에 확인하기 위한 내부 기록칸이다. (내역 표시도 admin 화면에서만 한다.)
export function TokenGrantModal({
  hospitalName,
  currentBalance,
  allowNegative = false,
  busy = false,
  error,
  onClose,
  onSubmit,
}: {
  hospitalName: string;
  currentBalance: number;
  /** 음수 입력(차감)을 허용할지. 사용량 화면은 허용, 병원 관리 화면은 지급만. */
  allowNegative?: boolean;
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (tokens: number, note: string) => void;
}) {
  const [amount, setAmount] = useState('1000');
  const [note, setNote] = useState('');
  const [localError, setLocalError] = useState('');

  function submit() {
    const tokens = Math.trunc(Number(amount.trim()));
    if (!Number.isFinite(tokens) || tokens === 0) {
      setLocalError(allowNegative ? '0이 아닌 정수를 입력하세요.' : '지급 토큰 수는 양의 정수여야 합니다.');
      return;
    }
    if (!allowNegative && tokens < 0) {
      setLocalError('지급 토큰 수는 양의 정수여야 합니다.');
      return;
    }
    setLocalError('');
    onSubmit(tokens, note.trim());
  }

  const shown = localError || error || '';

  return (
    <Modal title="토큰 지급" onClose={onClose} width={480}>
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>
        <b style={{ color: 'var(--text)' }}>{hospitalName}</b> · 현재 잔액{' '}
        {Math.round(currentBalance).toLocaleString()} 토큰
      </div>

      <label style={labelStyle}>
        토큰 수{allowNegative ? ' (음수면 차감)' : ''}
        <input
          type="text"
          inputMode={allowNegative ? 'text' : 'numeric'}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          autoFocus
          style={inputStyle}
        />
      </label>

      <label style={labelStyle}>
        메모 (사유)
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="예: 프로모션 지급 / 장애 보상 / 계약 협의분"
          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
        />
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>
          관리자만 볼 수 있습니다. 병원 화면에는 표시되지 않습니다.
        </span>
      </label>

      {shown ? (
        <div style={{ marginTop: 4, marginBottom: 12, fontSize: 13, color: 'var(--danger)' }}>{shown}</div>
      ) : null}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          style={{
            padding: '9px 16px', fontSize: 14, fontWeight: 600, borderRadius: 'var(--radius)',
            border: '1px solid var(--border-strong)', background: 'var(--bg)', color: 'var(--text-secondary)',
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          취소
        </button>
        <PrimaryButton onClick={submit} disabled={busy}>
          {busy ? '처리 중…' : '지급'}
        </PrimaryButton>
      </div>
    </Modal>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6,
  fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 14,
};

const inputStyle: React.CSSProperties = {
  padding: '9px 11px', fontSize: 14, fontWeight: 400, color: 'var(--text)',
  background: 'var(--bg)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)',
  fontFamily: 'inherit',
};
