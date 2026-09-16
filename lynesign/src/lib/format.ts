/**
 * Framework-free formatting helpers, safe to import from both server and client
 * components. Kept separate from `@/lib/dashboard` because that module also
 * pulls in the database layer, which must never reach a client bundle.
 */

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;
const KIB = BigInt(1024);

/**
 * Human byte size. Unit selection stays in the bigint domain so a petabyte-scale
 * value never overflows a double before it is scaled down; only the final
 * mantissa is converted to a Number for display.
 */
export function formatBytes(n: bigint | number): string {
  let bytes = typeof n === "bigint" ? n : BigInt(Math.max(0, Math.round(n)));
  if (bytes < BigInt(0)) bytes = BigInt(0);
  if (bytes < KIB) return `${bytes} B`;

  let unit = 0;
  let divisor = BigInt(1);
  while (unit < BYTE_UNITS.length - 1 && bytes / (divisor * KIB) > BigInt(0)) {
    divisor *= KIB;
    unit += 1;
  }

  const value = Number(bytes) / Number(divisor);
  const formatted = value >= 10 || Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
  return `${formatted} ${BYTE_UNITS[unit]}`;
}
