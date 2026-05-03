'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useAuth } from './auth-context';
import { generatePalette } from './brand-utils';

type BrandInfo = {
  logoUrl: string | null;
  brandColor: string;
};

const DEFAULT_BRAND: BrandInfo = { logoUrl: null, brandColor: '#10B981' };

const BrandContext = createContext<BrandInfo>(DEFAULT_BRAND);

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [brand, setBrand] = useState<BrandInfo>(DEFAULT_BRAND);

  const fetchBrand = useCallback(() => {
    if (!user?.id) { setBrand(DEFAULT_BRAND); return; }
    const email = user.email ? encodeURIComponent(user.email) : '';
    const uid = encodeURIComponent(user.id);
    fetch(`/api/hospitals/me?userId=${uid}&email=${email}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.hospital) {
          setBrand({
            logoUrl: data.hospital.logoUrl || null,
            brandColor: data.hospital.brandColor || '#10B981',
          });
        } else {
          setBrand(DEFAULT_BRAND);
        }
      })
      .catch(() => setBrand(DEFAULT_BRAND));
  }, [user?.id, user?.email]);

  useEffect(() => { fetchBrand(); }, [fetchBrand]);

  useEffect(() => {
    const root = document.documentElement;
    const palette = generatePalette(brand.brandColor);
    root.style.setProperty('--brand-50', palette[50]);
    root.style.setProperty('--brand-100', palette[100]);
    root.style.setProperty('--brand-200', palette[200]);
    root.style.setProperty('--brand-300', palette[300]);
    root.style.setProperty('--brand-400', palette[400]);
    root.style.setProperty('--brand-500', palette[500]);
    root.style.setProperty('--brand-600', palette[600]);
    root.style.setProperty('--brand-700', palette[700]);
    root.style.setProperty('--brand-800', palette[800]);
    root.style.setProperty('--brand-900', palette[900]);
    root.style.setProperty('--brand-950', palette[950]);
  }, [brand.brandColor]);

  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

export function useBrand() { return useContext(BrandContext); }
