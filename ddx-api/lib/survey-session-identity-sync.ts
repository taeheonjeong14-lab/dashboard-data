import { prisma } from '@/lib/prisma';
import {
  calculatePetAgeCeilFromYearsMonths,
  calculatePetAgeCeilFromBirthday,
  deriveBirthdayFromAgeAtKstJan1,
} from '@/lib/pet-age';

function trimmed(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function hasValue(value: string | null | undefined): boolean {
  return trimmed(value).length > 0;
}

function isGuardianNameQuestion(q: { text: string; type: string }): boolean {
  return q.type === 'short_text' && q.text.trim() === '보호자 성명';
}

function isPetNameQuestion(q: { text: string; type: string }): boolean {
  return q.type === 'short_text' && q.text.trim() === '반려동물 이름';
}

function isContactPhoneQuestion(q: { type: string }): boolean {
  return q.type === 'phone';
}

function isPetBirthdayQuestion(q: { type: string }): boolean {
  return q.type === 'pet_birthday';
}

type PetBirthdayAnswer = {
  unknownBirthday?: boolean;
  date?: string;
  approximateYears?: string;
  approximateMonths?: string;
};

function parsePetBirthdayAnswer(raw: unknown): PetBirthdayAnswer | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const legacyApprox = typeof o.approximateAge === 'string' ? o.approximateAge.trim() : '';
  const legacyYears = legacyApprox.match(/\d+/)?.[0] ?? '';
  return {
    unknownBirthday: o.unknownBirthday === true,
    date: typeof o.date === 'string' ? o.date.trim() : '',
    approximateYears: typeof o.approximateYears === 'string' ? o.approximateYears.trim() : legacyYears,
    approximateMonths: typeof o.approximateMonths === 'string' ? o.approximateMonths.trim() : '',
  };
}

function toNonNegativeInt(input: string | undefined): number {
  if (!input) return 0;
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/**
 * 설문 답변(SurveyAnswer)에만 있는 신원·연락처를 SurveySession 컬럼에 반영한다.
 * 신원/연락처는 기존 값이 있을 때 덮어쓰지 않고,
 * 생일/나이는 pet_birthday 답변이 있으면 항상 최신 답변 기준으로 반영한다.
 */
export async function syncSurveySessionIdentityFields(sessionId: string): Promise<void> {
  const session = await prisma.surveySession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      patientName: true,
      guardianName: true,
      contact: true,
      petBirthday: true,
      petAge: true,
      questions: { select: { id: true, text: true, type: true } },
      answers: { select: { questionInstanceId: true, answerText: true, answerJson: true } },
    },
  });

  if (!session) return;

  let guardianAnswer: string | null = null;
  let petAnswer: string | null = null;
  let contactAnswer: string | null = null;
  let petBirthdayAnswer: PetBirthdayAnswer | null = null;

  for (const q of session.questions) {
    const a = session.answers.find((x) => x.questionInstanceId === q.id);
    const val = trimmed(a?.answerText ?? undefined);
    if (isPetBirthdayQuestion(q)) {
      const parsed = parsePetBirthdayAnswer(a?.answerJson);
      if (parsed) petBirthdayAnswer = parsed;
      continue;
    }
    if (!val) continue;
    if (isGuardianNameQuestion(q)) guardianAnswer = val;
    if (isPetNameQuestion(q)) petAnswer = val;
    if (isContactPhoneQuestion(q)) contactAnswer = val;
  }

  const data: {
    guardianName?: string;
    patientName?: string;
    contact?: string;
    petBirthday?: Date | null;
    petAge?: number | null;
  } = {};
  if (!hasValue(session.guardianName) && guardianAnswer) data.guardianName = guardianAnswer;
  if (!hasValue(session.patientName) && petAnswer) data.patientName = petAnswer;
  if (!hasValue(session.contact) && contactAnswer) data.contact = contactAnswer;

  if (petBirthdayAnswer) {
    if (!petBirthdayAnswer.unknownBirthday && petBirthdayAnswer.date) {
      const birthday = new Date(`${petBirthdayAnswer.date}T00:00:00+09:00`);
      if (!Number.isNaN(birthday.getTime())) {
        data.petBirthday = birthday;
        data.petAge = calculatePetAgeCeilFromBirthday(birthday);
      }
    } else if (petBirthdayAnswer.unknownBirthday) {
      const years = toNonNegativeInt(petBirthdayAnswer.approximateYears);
      const months = toNonNegativeInt(petBirthdayAnswer.approximateMonths);
      const age = calculatePetAgeCeilFromYearsMonths(years, months);
      if (age != null) {
        const birthday = deriveBirthdayFromAgeAtKstJan1(age);
        if (birthday) {
          data.petBirthday = birthday;
          data.petAge = age;
        }
      }
    }
  }

  if (Object.keys(data).length === 0) return;

  await prisma.surveySession.update({
    where: { id: sessionId },
    data,
  });
}
