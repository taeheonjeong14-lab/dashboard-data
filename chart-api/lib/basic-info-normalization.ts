export type CanonicalSpecies = '개' | '고양이';

type AliasMap = Record<string, string>;

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

const SPECIES_ALIASES: Record<string, CanonicalSpecies> = {
  개: '개',
  강아지: '개',
  견: '개',
  canine: '개',
  dog: '개',
  k9: '개',
  고양이: '고양이',
  묘: '고양이',
  냥이: '고양이',
  feline: '고양이',
  cat: '고양이',
};

const DOG_BREED_ALIASES: AliasMap = {
  믹스견: '믹스견',
  믹스: '믹스견',
  혼종: '믹스견',
  잡종: '믹스견',
  mixeddog: '믹스견',
  mixedbreed: '믹스견',
  maltese: '말티즈',
  말티즈: '말티즈',
  poodle: '푸들',
  toypoodle: '푸들',
  miniaturepoodle: '푸들',
  standardpoodle: '푸들',
  푸들: '푸들',
  토이푸들: '푸들',
  포메라니안: '포메라니안',
  pomeranian: '포메라니안',
  시츄: '시츄',
  시추: '시츄',
  shihtzu: '시츄',
  치와와: '치와와',
  chihuahua: '치와와',
  요크셔테리어: '요크셔테리어',
  yorkshireterrier: '요크셔테리어',
  요키: '요크셔테리어',
  진돗개: '진돗개',
  진도: '진돗개',
  jindo: '진돗개',
  웰시코기: '웰시코기',
  welshcorgi: '웰시코기',
  corgi: '웰시코기',
  골든리트리버: '골든리트리버',
  goldenretriever: '골든리트리버',
  라브라도리트리버: '라브라도리트리버',
  labradorretriever: '라브라도리트리버',
  프렌치불독: '프렌치불독',
  frenchbulldog: '프렌치불독',
  비숑프리제: '비숑프리제',
  비숑: '비숑프리제',
  bichonfrise: '비숑프리제',
  슈나우저: '슈나우저',
  schnauzer: '슈나우저',
  비글: '비글',
  beagle: '비글',
};

const CAT_BREED_ALIASES: AliasMap = {
  코리안숏헤어: '코리안숏헤어',
  코숏: '코리안숏헤어',
  'korean short hair': '코리안숏헤어',
  'korean shorthair': '코리안숏헤어',
  'korean short-hair': '코리안숏헤어',
  koreanorthair: '코리안숏헤어',
  koreanshorthair: '코리안숏헤어',
  ksh: '코리안숏헤어',
  믹스묘: '믹스묘',
  잡종묘: '믹스묘',
  mixedcat: '믹스묘',
  domesticshorthair: '믹스묘',
  dsh: '믹스묘',
  페르시안: '페르시안',
  persian: '페르시안',
  러시안블루: '러시안블루',
  russianblue: '러시안블루',
  샴: '샴',
  siamese: '샴',
  브리티시숏헤어: '브리티시숏헤어',
  britishshorthair: '브리티시숏헤어',
  스코티시폴드: '스코티시폴드',
  scottishfold: '스코티시폴드',
  노르웨이숲고양이: '노르웨이숲고양이',
  노르웨이숲: '노르웨이숲고양이',
  norwegianforestcat: '노르웨이숲고양이',
  랙돌: '랙돌',
  ragdoll: '랙돌',
  벵갈: '벵갈',
  bengal: '벵갈',
  메인쿤: '메인쿤',
  mainecoon: '메인쿤',
};

function normalizeSpeciesInternal(value: string | null | undefined): CanonicalSpecies | null {
  if (!value) return null;
  const key = normalizeToken(value);
  if (!key) return null;
  return SPECIES_ALIASES[key] ?? null;
}

function normalizeBreedInternal(
  value: string | null | undefined,
  species: CanonicalSpecies | null,
): string | null {
  if (!value || !species) return null;
  const key = normalizeToken(value);
  if (!key) return null;
  const aliases = species === '개' ? DOG_BREED_ALIASES : CAT_BREED_ALIASES;
  return aliases[key] ?? null;
}

export function normalizeBasicInfoSpeciesBreed(input: {
  species: string | null;
  breed: string | null;
}): {
  species: string | null;
  breed: string | null;
  speciesCanonical: CanonicalSpecies | null;
  breedCanonical: string | null;
} {
  const speciesRaw = input.species?.trim() || null;
  const breedRaw = input.breed?.trim() || null;
  const speciesCanonical = normalizeSpeciesInternal(speciesRaw);
  const breedCanonical = normalizeBreedInternal(breedRaw, speciesCanonical);
  return {
    species: speciesCanonical ?? speciesRaw,
    breed: breedCanonical ?? breedRaw,
    speciesCanonical,
    breedCanonical,
  };
}

export function needsSpeciesNormalization(value: string | null | undefined): boolean {
  const raw = value?.trim() || '';
  if (!raw) return false;
  return normalizeSpeciesInternal(raw) == null;
}

export function needsBreedNormalization(input: {
  species: string | null | undefined;
  breed: string | null | undefined;
}): boolean {
  const breed = input.breed?.trim() || '';
  if (!breed) return false;
  const speciesCanonical = normalizeSpeciesInternal(input.species ?? null);
  if (!speciesCanonical) return false;
  return normalizeBreedInternal(breed, speciesCanonical) == null;
}

export function canonicalSpeciesList(): CanonicalSpecies[] {
  return ['개', '고양이'];
}
