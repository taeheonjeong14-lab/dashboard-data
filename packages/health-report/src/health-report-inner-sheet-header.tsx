"use client";

import "./health-report-inner-sheet-header.css";
import { useCallback, useState } from "react";
import type { CSSProperties } from "react";

export type HealthReportInnerSheetHeaderProps = {
  hospitalLogoSrc?: string;
  hospitalLogoAlt?: string;
  /** 로고 alt 기본값 */
  hospitalNameKo?: string;
  /** 로고 없을 때 우측에 표시(장기계통 등). 요약 시트는 보통 생략 → 빈 영역 */
  brandNameFallback?: { ko: string; en?: string };
};

function PlusMark() {
  return (
    <svg className="hra-inner-header__mark" viewBox="0 0 32 32" aria-hidden>
      <g fill="none" stroke="currentColor" strokeLinecap="square" strokeWidth={9}>
        <line x1="16" y1="7" x2="16" y2="25" />
        <line x1="7" y1="16" x2="25" y2="16" />
      </g>
    </svg>
  );
}

export function HealthReportInnerSheetHeader({
  hospitalLogoSrc,
  hospitalLogoAlt = "",
  hospitalNameKo = "",
  brandNameFallback,
}: HealthReportInnerSheetHeaderProps) {
  const src = hospitalLogoSrc?.trim();
  const ko = brandNameFallback?.ko?.trim();
  const en = brandNameFallback?.en?.trim();
  const showFallback = !src && !!ko;
  const [autoScale, setAutoScale] = useState(1);

  const handleLogoLoad = useCallback((img: HTMLImageElement) => {
    const run = async () => {
      try {
        const naturalW = img.naturalWidth || 0;
        const naturalH = img.naturalHeight || 0;
        if (naturalW < 2 || naturalH < 2) {
          setAutoScale(1);
          return;
        }

        // Scan a downscaled bitmap for effective (non-margin) content bounds.
        const maxSample = 384;
        const sampleW = Math.max(1, Math.round((naturalW / Math.max(naturalW, naturalH)) * maxSample));
        const sampleH = Math.max(1, Math.round((naturalH / Math.max(naturalW, naturalH)) * maxSample));
        const canvas = document.createElement("canvas");
        canvas.width = sampleW;
        canvas.height = sampleH;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          setAutoScale(1);
          return;
        }
        ctx.clearRect(0, 0, sampleW, sampleH);
        ctx.drawImage(img, 0, 0, sampleW, sampleH);
        const { data } = ctx.getImageData(0, 0, sampleW, sampleH);

        const idx = (x: number, y: number) => (y * sampleW + x) * 4;
        let minX = sampleW;
        let minY = sampleH;
        let maxX = -1;
        let maxY = -1;
        for (let y = 0; y < sampleH; y += 1) {
          for (let x = 0; x < sampleW; x += 1) {
            const i = idx(x, y);
            const a = data[i + 3] ?? 0;
            // Transparent padding trimming: alpha-only detection is robust for logos
            // regardless of foreground color (e.g. black marks on transparent background).
            if (a < 12) continue;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }

        if (maxX < 0 || maxY < 0) {
          setAutoScale(1);
          return;
        }

        const boxW = maxX - minX + 1;
        const boxH = maxY - minY + 1;
        const contentRatio = Math.max(boxW / sampleW, boxH / sampleH);
        if (contentRatio >= 0.8) {
          setAutoScale(1);
          return;
        }

        const targetRatio = 0.9;
        const scaleRaw = targetRatio / Math.max(0.25, contentRatio);
        const scale = Math.max(1, Math.min(1.45, Number(scaleRaw.toFixed(3))));
        setAutoScale(scale);
      } catch {
        // CORS/canvas taint or decode failures should silently fall back.
        setAutoScale(1);
      }
    };
    void run();
  }, []);

  return (
    <header className="hra-inner-header">
      <div aria-hidden>
        <PlusMark />
      </div>
      <div className="hra-inner-header__brand">
        {src ? (
          <img
            className="hra-inner-header__logo"
            src={src}
            alt={hospitalLogoAlt || hospitalNameKo || "병원 로고"}
            crossOrigin="anonymous"
            decoding="async"
            style={{ "--hra-logo-auto-scale": `${autoScale}` } as CSSProperties}
            onLoad={(ev) => handleLogoLoad(ev.currentTarget)}
          />
        ) : showFallback ? (
          <div className="hra-inner-header__fallback">
            <div className="hra-inner-header__fallback-ko">{ko}</div>
            {en ? <div className="hra-inner-header__fallback-en">{en}</div> : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}
