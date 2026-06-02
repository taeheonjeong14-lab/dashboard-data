/**
 * vet-report `health-systems-report-sheet.tsx` 데모 블록과 동일 구조(titleKo/titleEn·행 라벨).
 * 클라이언트 parseHealthSystemsBlocksFromUnknown 과 패리티 유지.
 */

export type HealthSystemsImageSlot = {
  src?: string;
  alt?: string;
  caption?: string;
  rotationDeg?: number;
};

export type HealthSystemsReportBlock =
  | {
      variant: 'rows';
      titleKo: string;
      titleEn: string;
      rows: Array<{ label: string; content: string }>;
      compact?: boolean;
      /** 이 장기의 질환 소개 후보 목록(3·4p). 본문은 admin 토글 ON 시 생성. 페이지당 enabled 1개만 박스로 렌더. */
      diseaseOptions?: { name: string; body: string; enabled: boolean }[];
    }
  | {
      variant: 'images';
      titleKo: string;
      titleEn: string;
      images: [HealthSystemsImageSlot, HealthSystemsImageSlot, HealthSystemsImageSlot];
    }
  | {
      variant: 'images4';
      titleKo: string;
      titleEn: string;
      images: [
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
      ];
    }
  | {
      variant: 'imagesGrid2x3';
      titleKo: string;
      titleEn: string;
      images: [
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
      ];
    }
  | {
      variant: 'imagesGrid3x3';
      titleKo: string;
      titleEn: string;
      images: [
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
      ];
    }
  | {
      /** 확진 질환 소개 박스(3·4p, 페이지당 1개). 패키지 시트 타입과 패리티 유지. */
      variant: 'diseaseInfo';
      name: string;
      body: string;
    };

export const IMAGE_STRIP_CAPTION_PLACEHOLDER = '플레이스홀더 — 이미지 캡션';

function emptyImageStrip(
  captions: [string, string, string] = [
    IMAGE_STRIP_CAPTION_PLACEHOLDER,
    IMAGE_STRIP_CAPTION_PLACEHOLDER,
    IMAGE_STRIP_CAPTION_PLACEHOLDER,
  ],
): [HealthSystemsImageSlot, HealthSystemsImageSlot, HealthSystemsImageSlot] {
  return [{ caption: captions[0] }, { caption: captions[1] }, { caption: captions[2] }];
}

function emptyImageFour(): [
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
] {
  const c = IMAGE_STRIP_CAPTION_PLACEHOLDER;
  return [{ caption: c }, { caption: c }, { caption: c }, { caption: c }];
}

function emptyImageSix(): [
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
] {
  const c = IMAGE_STRIP_CAPTION_PLACEHOLDER;
  return [
    { caption: c },
    { caption: c },
    { caption: c },
    { caption: c },
    { caption: c },
    { caption: c },
  ];
}

function emptyImageNine(): [
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
] {
  const c = IMAGE_STRIP_CAPTION_PLACEHOLDER;
  return [
    { caption: c },
    { caption: c },
    { caption: c },
    { caption: c },
    { caption: c },
    { caption: c },
    { caption: c },
    { caption: c },
    { caption: c },
  ];
}

export const DEMO_HEALTH_SYSTEMS_BLOCKS_ALL: HealthSystemsReportBlock[] = [
  {
    variant: 'rows',
    titleKo: '순환기&호흡기',
    titleEn: 'Circulatory & Respiratory Systems',
    rows: [
      {
        label: '주요 진단 내용',
        content: '플레이스홀더 — 혈압·청진 등 검진 요약이 이 칸에 들어갑니다.',
      },
      {
        label: '시사점',
        content: '플레이스홀더 — 보호자 안내.',
      },
    ],
  },
  {
    variant: 'rows',
    titleKo: '소화기',
    titleEn: 'Digestive System',
    rows: [
      {
        label: '주요 진단 내용',
        content: '플레이스홀더 — 소화기 관련 검진 요약.',
      },
      {
        label: '시사점',
        content: '플레이스홀더 — 급여·재검 등 안내.',
      },
    ],
  },
  {
    variant: 'rows',
    titleKo: '내분비계',
    titleEn: 'Endocrine System',
    rows: [
      {
        label: '주요 진단 내용',
        content: '플레이스홀더 — 호르몬·대사·부신·갑상선 등 관련 소견.',
      },
      {
        label: '시사점',
        content: '플레이스홀더 — 관찰·재검 안내.',
      },
    ],
  },
  {
    variant: 'rows',
    titleKo: '신장 및 비뇨기계',
    titleEn: 'Kidney & Urinary System',
    rows: [
      {
        label: '주요 진단 내용',
        content: '플레이스홀더 — 신장·요로·방광 등 검진 요약.',
      },
      {
        label: '시사점',
        content: '플레이스홀더 — 음수·배뇨·검사 수치 안내.',
      },
    ],
  },
  {
    variant: 'rows',
    titleKo: '간담도계',
    titleEn: 'Hepatobiliary System',
    rows: [
      {
        label: '주요 진단 내용',
        content: '플레이스홀더 — 간·담도 관련 검진 요약.',
      },
      {
        label: '시사점',
        content: '플레이스홀더 — 관찰·재검 안내.',
      },
    ],
  },
  {
    variant: 'rows',
    titleKo: '근골격계',
    titleEn: 'Musculoskeletal System',
    rows: [
      {
        label: '주요 진단 내용',
        content: '플레이스홀더 — 관절·보행·근육·골격 검진 요약.',
      },
      {
        label: '시사점',
        content: '플레이스홀더 — 활동량·보행 관찰 안내.',
      },
    ],
  },
];

export const DEMO_HEALTH_SYSTEMS_BLOCKS: HealthSystemsReportBlock[] = DEMO_HEALTH_SYSTEMS_BLOCKS_ALL.slice(0, 3);

export const DEMO_HEALTH_SYSTEMS_PAGE_B_BLOCKS: HealthSystemsReportBlock[] = DEMO_HEALTH_SYSTEMS_BLOCKS_ALL.slice(3, 6);

export const DEMO_HEALTH_DENTAL_SKIN_BLOCKS: HealthSystemsReportBlock[] = [
  {
    variant: 'rows',
    titleKo: '치과 및 안과',
    titleEn: 'Dental & Ophthalmology',
    rows: [
      {
        label: '주요 진단 내용',
        content: '플레이스홀더 — 치아·구강·안과 검진 요약.',
      },
      {
        label: '시사점',
        content: '플레이스홀더 — 구강 위생·눈 분비물 등 안내.',
      },
    ],
  },
  {
    variant: 'imagesGrid2x3',
    titleKo: '',
    titleEn: '',
    images: emptyImageSix(),
  },
  {
    variant: 'rows',
    titleKo: '피부와 외이도',
    titleEn: 'Skin & External Ear Canal',
    rows: [
      {
        label: '주요 진단 내용',
        content: '플레이스홀더 — 피부·외이도 검진 요약.',
      },
      {
        label: '시사점',
        content: '플레이스홀더 — 긁음·발적·악취 등 관찰 안내.',
      },
    ],
  },
  {
    variant: 'images',
    titleKo: '',
    titleEn: '',
    images: emptyImageStrip(),
  },
];

export const DEMO_RADIOLOGY_ULTRASOUND_BLOCKS: HealthSystemsReportBlock[] = [
  {
    variant: 'rows',
    titleKo: '방사선 검사',
    titleEn: 'X-ray',
    compact: true,
    rows: [
      {
        label: '검사 결과 해석',
        content: '플레이스홀더 — 방사선 검사 결과 해석.',
      },
    ],
  },
  {
    variant: 'images4',
    titleKo: '',
    titleEn: '',
    images: emptyImageFour(),
  },
  {
    variant: 'rows',
    titleKo: '초음파 검사',
    titleEn: 'Ultrasonography',
    compact: true,
    rows: [
      {
        label: '검사 결과 해석',
        content: '플레이스홀더 — 초음파 검사 결과 해석.',
      },
    ],
  },
  {
    variant: 'imagesGrid3x3',
    titleKo: '',
    titleEn: '',
    images: emptyImageNine(),
  },
];
