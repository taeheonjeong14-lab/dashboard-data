import { redirect } from 'next/navigation';

// 사전문진은 '문진·접수' 콘솔(/admin/forms)의 탭으로 합쳐졌다.
export default function AdminPreConsultationPage() {
  redirect('/admin/forms');
}
