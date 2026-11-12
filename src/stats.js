export function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

export function mean(values) {
  if (values.length === 0) return 0;
  return sum(values) / values.length;
}

/**
 * Gini coefficient of a non-negative distribution.
 * 0 = perfect equality, 1 = one actor holds everything.
 */
export function gini(values) {
  const clean = values.map((value) => Math.max(0, Number(value) || 0));
  const total = sum(clean);
  if (clean.length === 0 || total === 0) return 0;
  const sorted = [...clean].sort((a, b) => a - b);
  const n = sorted.length;
  let cumulative = 0;
  for (let i = 0; i < n; i += 1) {
    cumulative += (i + 1) * sorted[i];
  }
  return (2 * cumulative) / (n * total) - (n + 1) / n;
}

/**
 * Herfindahl-Hirschman index of shares that sum to one.
 * 1 / HHI is the effective number of participants.
 */
export function hhi(shares) {
  return sum(shares.map((share) => share ** 2));
}

export function topShare(values) {
  const total = sum(values);
  if (total === 0) return 0;
  return Math.max(...values) / total;
}

export function formatBtc(value, digits = 2) {
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatPct(value, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}
