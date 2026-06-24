'use client';

import { useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * 비밀번호 입력란 + 표시/숨기기(눈 아이콘) 토글.
 * 기존 <input type="password" .../> 를 그대로 대체한다(type 은 내부에서 관리).
 * style 은 그대로 전달하고 아이콘 자리만큼 우측 패딩을 더한다.
 */
export function PasswordInput({ style, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input {...props} type={show ? 'text' : 'password'} style={{ ...style, paddingRight: 40 }} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        tabIndex={-1}
        aria-label={show ? '비밀번호 숨기기' : '비밀번호 표시'}
        title={show ? '비밀번호 숨기기' : '비밀번호 표시'}
        style={{
          position: 'absolute',
          right: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          padding: 0,
          border: 'none',
          background: 'transparent',
          color: 'var(--text-muted, #94a3b8)',
          cursor: 'pointer',
          lineHeight: 0,
        }}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
