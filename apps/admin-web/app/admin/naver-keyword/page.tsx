import { redirect } from 'next/navigation';

// 네이버 검색량은 '블로그 도구' 콘솔(/admin/blog-tools)의 탭으로 합쳐졌다.
export default function AdminNaverKeywordPage() {
  redirect('/admin/blog-tools');
}
