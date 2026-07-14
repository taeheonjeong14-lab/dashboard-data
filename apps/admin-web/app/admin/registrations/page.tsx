import { redirect } from 'next/navigation';

// '병원 심사'는 '병원 관리' 콘솔로 통합됐다(좌측 목록의 '심사 대기' 섹션). 옛 링크·북마크 보존용.
export default function AdminRegistrationsPage() {
  redirect('/admin/hospitals');
}
