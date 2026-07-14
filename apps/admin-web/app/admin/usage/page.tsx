import { redirect } from 'next/navigation';

// '토큰 관리'는 '병원 관리' 콘솔의 토큰 탭으로 통합됐다. 옛 링크·북마크 보존용.
export default function AdminUsagePage() {
  redirect('/admin/hospitals');
}
