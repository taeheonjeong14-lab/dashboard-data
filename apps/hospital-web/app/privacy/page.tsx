import type { CSSProperties } from 'react';

// 개인정보처리방침 (공개 전문) — 사전문진·초진 접수증 동의 화면의 "전문 보기" 링크 대상.
// 병원(개인정보처리자)과 주식회사 바른반려연구소(수탁자)의 공동 안내. 시행일 2026.7.1.
export const metadata = { title: '개인정보처리방침' };

const COMPANY = '주식회사 바른반려연구소';
const COMPANY_ADDR = '서울특별시 서초구 남부순환로 2497, 604호';
const DPO_NAME = '정태헌 (대표이사)';
const DPO_EMAIL = 'taeheon.jeong@babanlabs.com';
const EFFECTIVE = '2026년 7월 1일';

const wrap: CSSProperties = { maxWidth: 760, margin: '0 auto', padding: '40px 20px 80px', color: '#1f2937', fontSize: 15, lineHeight: 1.75, fontFamily: '"Pretendard","Pretendard Variable",-apple-system,BlinkMacSystemFont,system-ui,sans-serif', wordBreak: 'keep-all' };
const h1: CSSProperties = { fontSize: 24, fontWeight: 700, margin: '0 0 4px' };
const h2: CSSProperties = { fontSize: 17, fontWeight: 700, margin: '28px 0 8px' };
const p: CSSProperties = { margin: '0 0 8px' };
const li: CSSProperties = { margin: '0 0 4px' };

export default function PrivacyPolicyPage() {
  return (
    <main style={wrap}>
      <h1 style={h1}>개인정보처리방침</h1>
      <p style={{ ...p, color: '#6b7280', fontSize: 13 }}>시행일: {EFFECTIVE}</p>

      <p style={{ ...p, marginTop: 16 }}>
        동물병원(이하 “병원”)과 {COMPANY}(이하 “회사”)는 정보주체의 개인정보를 중요하게 생각하며 「개인정보 보호법」 등 관계 법령을 준수합니다.
        병원과 회사는 사전문진·진료 접수 등 서비스 제공을 위해 아래와 같이 개인정보를 처리하며, 본 방침을 통해 그 내용을 안내합니다.
      </p>

      <h2 style={h2}>1. 처리하는 개인정보 항목</h2>
      <ul>
        <li style={li}>보호자: 성명, 연락처(휴대전화번호), 주소</li>
        <li style={li}>반려동물: 이름, 종/품종, 성별·중성화 여부, 생년월일 또는 나이</li>
        <li style={li}>진료 관련: 증상·내원 사유, 과거 병력, 예방접종·기생충 예방 이력, 생활·환경 정보, 보호자가 작성·제출한 내용</li>
        <li style={li}>(마케팅 수신 동의 시) 휴대전화번호</li>
      </ul>

      <h2 style={h2}>2. 개인정보의 처리 목적</h2>
      <p style={p}>진단·치료·입원, 진료 및 검사 예약·조회 및 일정 고지, 원무 서비스, 사전문진 기반 진료 준비 및 AI 진료 보조에 이용합니다. 마케팅 수신에 동의하신 경우 이벤트·혜택 안내 등 마케팅 메시지 발송에 이용합니다.</p>

      <h2 style={h2}>3. 개인정보의 보유 및 이용 기간</h2>
      <p style={p}>서비스 제공 종료 또는 동의 철회 시까지 보유·이용합니다. 다만 「수의사법」 등 관계 법령에 보존 의무가 있는 경우 해당 기간 동안 보관합니다. (수의사법령상 진료부 등: 1년)</p>

      <h2 style={h2}>4. 개인정보의 제3자 제공</h2>
      <p style={p}>정보주체의 별도 동의가 있거나 법령에 근거가 있는 경우를 제외하고는 개인정보를 제3자에게 제공하지 않습니다.</p>

      <h2 style={h2}>5. 개인정보 처리의 위탁</h2>
      <p style={p}>원활한 서비스 제공을 위해 아래와 같이 개인정보 처리를 위탁합니다.</p>
      <ul>
        <li style={li}>수탁자: {COMPANY}</li>
        <li style={li}>위탁 업무: 사전문진·진료정보의 저장·분석 및 AI 기반 진료 보조 처리</li>
      </ul>

      <h2 style={h2}>6. 정보주체의 권리·의무 및 행사 방법</h2>
      <p style={p}>정보주체는 언제든지 개인정보 열람·정정·삭제·처리정지 및 동의 철회를 요구할 수 있으며, 아래 개인정보 보호책임자에게 요청하시면 지체 없이 조치합니다.</p>

      <h2 style={h2}>7. 개인정보의 파기</h2>
      <p style={p}>보유기간 경과 또는 처리 목적 달성 시 지체 없이 파기합니다. 전자적 파일은 복구 불가능한 방법으로 영구 삭제하며, 출력물은 분쇄 또는 소각합니다.</p>

      <h2 style={h2}>8. 개인정보의 안전성 확보 조치</h2>
      <p style={p}>접근권한 관리, 접속기록 보관·점검, 개인정보의 암호화, 내부관리계획 수립·시행 등 관계 법령에 따른 안전성 확보 조치를 시행합니다.</p>

      <h2 style={h2}>9. 개인정보 보호책임자</h2>
      <ul>
        <li style={li}>병원: 해당 병원의 대표원장 (병원 관련 문의는 내원하신 병원으로 하실 수 있습니다.)</li>
        <li style={li}>회사: {DPO_NAME} / 이메일 {DPO_EMAIL} / 주소 {COMPANY_ADDR}</li>
      </ul>

      <h2 style={h2}>10. 권익침해 구제 방법</h2>
      <p style={p}>개인정보 분쟁 또는 침해에 대해 아래 기관에 상담·조정을 신청할 수 있습니다. 개인정보분쟁조정위원회(1833-6972), 개인정보침해신고센터(118), 대검찰청(1301), 경찰청(182).</p>

      <h2 style={h2}>11. 처리방침의 변경</h2>
      <p style={p}>본 방침은 시행일부터 적용되며, 내용 변경 시 변경 사항을 공지합니다.</p>
    </main>
  );
}
