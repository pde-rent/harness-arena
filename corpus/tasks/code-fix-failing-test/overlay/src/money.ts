import { LedgerError, type CurrencyCode, type Money } from "./types";

const DEFAULT_EXPONENT = 2;

const CURRENCY_EXPONENTS: Readonly<Record<string, number>> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CHF: 2,
  JPY: 0,
  KRW: 0,
  BHD: 3,
  KWD: 3,
};

export function currencyExponent(currency: CurrencyCode): number {
  const exponent = CURRENCY_EXPONENTS[currency.toUpperCase()];
  return exponent === undefined ? DEFAULT_EXPONENT : exponent;
}

export function money(amount: number, currency: CurrencyCode): Money {
  if (!Number.isInteger(amount)) {
    throw new LedgerError("MONEY_NOT_INTEGER", `amount must be an integer number of minor units: ${amount}`);
  }
  if (!Number.isSafeInteger(amount)) {
    throw new LedgerError("MONEY_UNSAFE_INTEGER", `amount is outside the safe integer range: ${amount}`);
  }
  if (currency.length === 0) {
    throw new LedgerError("MONEY_NO_CURRENCY", "currency code must not be empty");
  }
  return { amount, currency: currency.toUpperCase() };
}

export function zero(currency: CurrencyCode): Money {
  return money(0, currency);
}

export function isZero(value: Money): boolean {
  return value.amount === 0;
}

export function isNegative(value: Money): boolean {
  return value.amount < 0;
}

export function sameCurrency(a: Money, b: Money): boolean {
  return a.currency === b.currency;
}

export function assertSameCurrency(a: Money, b: Money): void {
  if (!sameCurrency(a, b)) {
    throw new LedgerError("MONEY_CURRENCY_MISMATCH", `currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function sub(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

export function negate(value: Money): Money {
  return money(-value.amount, value.currency);
}

export function abs(value: Money): Money {
  return money(Math.abs(value.amount), value.currency);
}

export function compareMoney(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  return a.amount === b.amount ? 0 : a.amount < b.amount ? -1 : 1;
}

export function sum(values: readonly Money[], currency: CurrencyCode): Money {
  return values.reduce((acc, value) => add(acc, value), zero(currency));
}

export function roundHalfEven(value: number, precision = 0): number {
  if (!Number.isFinite(value)) {
    throw new LedgerError("ROUND_NOT_FINITE", `cannot round a non-finite value: ${value}`);
  }
  if (!Number.isInteger(precision) || precision < 0) {
    throw new LedgerError("ROUND_BAD_PRECISION", `precision must be a non-negative integer: ${precision}`);
  }
  const factor = 10 ** precision;
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const remainder = scaled - floor;
  let rounded: number;
  if (Math.abs(remainder - 0.5) < Number.EPSILON * Math.max(1, Math.abs(scaled))) {
    rounded = floor % 2 === 0 ? floor : floor + 1;
  } else if (remainder > 0.5) {
    rounded = floor + 1;
  } else {
    rounded = floor;
  }
  return rounded / factor;
}

export function mul(value: Money, factor: number): Money {
  if (!Number.isFinite(factor)) {
    throw new LedgerError("MONEY_BAD_FACTOR", `factor must be finite: ${factor}`);
  }
  return money(roundHalfEven(value.amount * factor, 0), value.currency);
}

export function allocate(value: Money, ratios: readonly number[]): Money[] {
  if (ratios.length === 0) {
    throw new LedgerError("ALLOCATE_NO_RATIOS", "at least one ratio is required");
  }
  let total = 0;
  for (const ratio of ratios) {
    if (!Number.isFinite(ratio) || ratio < 0) {
      throw new LedgerError("ALLOCATE_BAD_RATIO", `ratios must be finite and non-negative: ${ratio}`);
    }
    total += ratio;
  }
  if (total <= 0) {
    throw new LedgerError("ALLOCATE_ZERO_TOTAL", "the sum of the ratios must be greater than zero");
  }

  const sign = value.amount < 0 ? -1 : 1;
  const magnitude = Math.abs(value.amount);
  const shares: number[] = [];
  const remainders: { index: number; remainder: number }[] = [];
  let allocated = 0;

  for (let index = 0; index < ratios.length; index += 1) {
    const exact = (magnitude * (ratios[index] as number)) / total;
    const share = Math.floor(exact);
    shares.push(share);
    remainders.push({ index, remainder: exact - share });
    allocated += share;
  }

  let leftover = magnitude - allocated;
  remainders.sort((a, b) => (b.remainder === a.remainder ? b.index - a.index : b.remainder - a.remainder));

  for (let cursor = 0; leftover > 0; cursor += 1, leftover -= 1) {
    const target = remainders[cursor % remainders.length] as { index: number };
    shares[target.index] = (shares[target.index] as number) + 1;
  }

  return shares.map((share) => money(share * sign, value.currency));
}

export function formatMoney(value: Money, options: { withCurrency?: boolean; groupSeparator?: string } = {}): string {
  const withCurrency = options.withCurrency !== false;
  const groupSeparator = options.groupSeparator ?? ",";
  const exponent = currencyExponent(value.currency);
  const negative = value.amount < 0;
  const digits = Math.abs(value.amount).toString().padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = exponent === 0 ? "" : `.${digits.slice(digits.length - exponent)}`;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, groupSeparator);
  const body = `${negative ? "-" : ""}${grouped}${fraction}`;
  return withCurrency ? `${body} ${value.currency}` : body;
}

export function parseMoney(text: string, currency: CurrencyCode): Money {
  const trimmed = text.trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new LedgerError("MONEY_PARSE", `cannot parse money value: ${text}`);
  }
  const exponent = currencyExponent(currency);
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const padded = (fraction + "0".repeat(exponent)).slice(0, exponent);
  const minor = Number(whole) * 10 ** exponent + (exponent === 0 ? 0 : Number(padded));
  return money(negative ? -minor : minor, currency);
}
