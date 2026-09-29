// Default company figures live in public/defaults.json so they can be updated
// without touching code. FALLBACK_DEFAULTS is only used until that file loads
// (or if it can't be loaded).

export interface Defaults {
  asOf: string;
  btcHoldings: number;
  basicShares: number; // basic shares, not diluted
  usdReserve: number; // $ millions
  debt: number; // $ millions (all indebtedness)
  preferredStock: number; // $ millions
  alertThreshold: number;
}

export const FALLBACK_DEFAULTS: Defaults = {
  asOf: '2026-09-29',
  btcHoldings: 847666,
  basicShares: 421978000,
  usdReserve: 6021,
  debt: 6714,
  preferredStock: 14134,
  alertThreshold: 1.14,
};

const NUMERIC_FIELDS = ['btcHoldings', 'basicShares', 'usdReserve', 'debt', 'preferredStock', 'alertThreshold'] as const;

export async function loadDefaults(): Promise<Defaults> {
  const response = await fetch(`${import.meta.env.BASE_URL}defaults.json`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();

  const defaults: Defaults = { ...FALLBACK_DEFAULTS, asOf: String(data?.asOf ?? '') };
  for (const field of NUMERIC_FIELDS) {
    const value = Number(data?.[field]);
    if (Number.isFinite(value) && value >= 0) {
      defaults[field] = value;
    } else {
      console.warn(`defaults.json: invalid or missing "${field}", using built-in value`);
    }
  }
  return defaults;
}
