// Money shown to users must come from data: anything missing or non-finite renders as a dash.
export function formatMoney(value, { sign = '' } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const text = Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const prefix = value < 0 ? '-' : sign;
  return `${prefix}$${text}`;
}
