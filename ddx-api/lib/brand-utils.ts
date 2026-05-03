function hexToHsl(hex: string): [number, number, number] {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16) / 255;
  const g = parseInt(c.substring(2, 4), 16) / 255;
  const b = parseInt(c.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * Math.max(0, Math.min(1, color))).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function generatePalette(hex: string): Record<number, string> {
  const [h, s] = hexToHsl(hex);
  return {
    50:  hslToHex(h, Math.min(s, 100), 97),
    100: hslToHex(h, Math.min(s, 100), 93),
    200: hslToHex(h, Math.min(s, 95), 85),
    300: hslToHex(h, Math.min(s, 90), 73),
    400: hslToHex(h, Math.min(s, 85), 58),
    500: hex,
    600: hslToHex(h, Math.min(s + 5, 100), 38),
    700: hslToHex(h, Math.min(s + 5, 100), 30),
    800: hslToHex(h, Math.min(s + 5, 100), 23),
    900: hslToHex(h, Math.min(s + 5, 100), 18),
    950: hslToHex(h, Math.min(s + 10, 100), 10),
  };
}
