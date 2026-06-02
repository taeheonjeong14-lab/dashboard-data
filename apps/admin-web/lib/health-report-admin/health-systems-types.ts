/** Mirrors chart-api `health-systems-demo-blocks` discriminated unions for payload + parser parity. */

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
    };
