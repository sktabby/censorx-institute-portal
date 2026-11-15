/**
 * Installment amounts with auto-balancing.
 *
 * Each installment is either typed by the admin (a string) or automatic (null). Automatic ones
 * share whatever is left of the total equally, in paise, with any leftover paise on the last
 * automatic one — so typed + automatic always add up to the total without anyone doing sums.
 */

const toPaise = (value: string | number | null | undefined) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
};

/** Equal parts in paise, leftover on the last — the same split the server makes. */
export function splitEqually(total: number, count: number): number[] {
  const n = Math.max(1, Math.floor(count) || 1);
  const paise = Math.round(total * 100);
  const base = Math.floor(paise / n);
  return Array.from({ length: n }, (_, index) => (index === n - 1 ? paise - base * (n - 1) : base) / 100);
}

export interface InstallmentAmounts {
  /** What each box shows: typed values as typed, automatic ones worked out. */
  values: string[];
  /** Which installments were typed by hand. */
  typed: boolean[];
  /** Sum of all installments, in rupees. */
  sum: number;
  /** sum − total; 0 when they match. Negative when typed amounts leave too little, etc. */
  gap: number;
  /** True when at least one amount was typed (so the plan is not a plain equal split). */
  isCustom: boolean;
}

/**
 * Works out every installment from the typed ones. `entries` has one item per installment:
 * the typed text, or null for "share the rest automatically".
 */
export function deriveInstallments(total: number, count: number, entries: Array<string | null> | null | undefined): InstallmentAmounts {
  const n = Math.max(1, Math.floor(count) || 1);
  const list = Array.from({ length: n }, (_, index) => entries?.[index] ?? null);
  const typed = list.map((entry) => entry !== null);
  const autoIndexes = typed.map((isTyped, index) => (isTyped ? -1 : index)).filter((index) => index >= 0);

  const typedPaise = list.reduce((sum, entry) => sum + (entry !== null ? toPaise(entry) : 0), 0);
  const leftPaise = Math.max(0, Math.round(total * 100) - typedPaise);
  const base = autoIndexes.length > 0 ? Math.floor(leftPaise / autoIndexes.length) : 0;

  const values = list.map((entry, index) => {
    if (entry !== null) return entry;
    const position = autoIndexes.indexOf(index);
    const paise = position === autoIndexes.length - 1 ? leftPaise - base * (autoIndexes.length - 1) : base;
    return String(paise / 100);
  });

  const sumPaise = values.reduce((sum, value) => sum + toPaise(value), 0);
  return {
    values,
    typed,
    sum: sumPaise / 100,
    gap: (sumPaise - Math.round(total * 100)) / 100,
    isCustom: typed.some(Boolean),
  };
}

/**
 * The entries after the admin types `value` into installment `index`. That installment becomes
 * typed; if every other installment is typed too, the last other one goes back to automatic so
 * it can absorb the difference.
 */
export function typeInstallment(count: number, entries: Array<string | null> | null | undefined, index: number, value: string) {
  const n = Math.max(1, Math.floor(count) || 1);
  const next: Array<string | null> = Array.from({ length: n }, (_, i) => entries?.[i] ?? null);
  next[index] = value;
  if (n > 1 && !next.includes(null)) {
    const balancer = index === n - 1 ? n - 2 : n - 1;
    next[balancer] = null;
  }
  return next;
}
