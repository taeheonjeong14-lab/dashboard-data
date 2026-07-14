import { redirect } from 'next/navigation';

// 초진 접수는 '문진·접수' 콘솔(/admin/forms)의 탭으로 합쳐졌다.
export default function AdminIntakePage() {
  redirect('/admin/forms?tab=intake');
}
