export function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
}

export function moneyCompact(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return abs >= 1_000_000 ? `${sign}$${(abs / 1_000_000).toFixed(2)}M` : `${sign}$${Math.round(abs / 1000)}K`;
}

export function pct1(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
