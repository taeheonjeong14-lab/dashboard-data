import '@fontsource/noto-sans-kr/400.css';
import '@fontsource/noto-sans-kr/500.css';
import '@fontsource/noto-sans-kr/700.css';
import HealthCheckupShareReviewClient from './share-review-client';

export default function HealthCheckupShareReviewPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#ffffff', fontFamily: "'Noto Sans KR', sans-serif" }}>
      <HealthCheckupShareReviewClient />
    </div>
  );
}
