import { redirect } from 'next/navigation';

// 병원 정보·설정은 '병원 관리' 콘솔의 정보·설정 탭으로 통합됐다. 옛 링크·북마크 보존용.
export default function AdminHospitalsAdminPage() {
  redirect('/admin/hospitals');
}
