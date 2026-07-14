import { redirect } from 'next/navigation';

// 글 검수는 '블로그 도구' 콘솔(/admin/blog-tools)의 탭으로 합쳐졌다.
export default function AdminBlogReviewPage() {
  redirect('/admin/blog-tools?tab=review');
}
