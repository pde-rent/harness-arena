import { LedgerError, type Account, type AccountType, type CurrencyCode } from "./types";

export const ACCOUNT_SEPARATOR = ":";

const CODE_SEGMENT = /^[a-z0-9][a-z0-9_-]*$/;

export function normalizeCode(code: string): string {
  return code.trim().toLowerCase();
}

export function splitCode(code: string): string[] {
  return normalizeCode(code).split(ACCOUNT_SEPARATOR);
}

export function isValidCode(code: string): boolean {
  const segments = splitCode(code);
  return segments.length > 0 && segments.every((segment) => CODE_SEGMENT.test(segment));
}

export function assertValidCode(code: string): string {
  const normalized = normalizeCode(code);
  if (!isValidCode(normalized)) {
    throw new LedgerError("ACCOUNT_BAD_CODE", `invalid account code: ${code}`);
  }
  return normalized;
}

export function parentCode(code: string): string | undefined {
  const segments = splitCode(code);
  if (segments.length <= 1) return undefined;
  return segments.slice(0, -1).join(ACCOUNT_SEPARATOR);
}

export function ancestorCodes(code: string): string[] {
  const segments = splitCode(code);
  const ancestors: string[] = [];
  for (let length = segments.length - 1; length >= 1; length -= 1) {
    ancestors.push(segments.slice(0, length).join(ACCOUNT_SEPARATOR));
  }
  return ancestors;
}

export function leafName(code: string): string {
  const segments = splitCode(code);
  return segments[segments.length - 1] as string;
}

export function depth(code: string): number {
  return splitCode(code).length;
}

export function isUnder(code: string, prefix: string): boolean {
  const normalizedCode = normalizeCode(code);
  const normalizedPrefix = normalizeCode(prefix);
  if (normalizedPrefix.length === 0) return true;
  return (
    normalizedCode === normalizedPrefix || normalizedCode.startsWith(normalizedPrefix + ACCOUNT_SEPARATOR)
  );
}

export function rootType(code: string): AccountType | undefined {
  const root = splitCode(code)[0];
  switch (root) {
    case "assets":
    case "asset":
      return "asset";
    case "liabilities":
    case "liability":
      return "liability";
    case "equity":
      return "equity";
    case "income":
    case "revenue":
      return "income";
    case "expenses":
    case "expense":
      return "expense";
    default:
      return undefined;
  }
}

export function isDebitNormal(type: AccountType): boolean {
  return type === "asset" || type === "expense";
}

export interface AccountInput {
  readonly code: string;
  readonly name?: string;
  readonly type?: AccountType;
  readonly currency?: CurrencyCode;
}

export class AccountRegistry {
  private readonly accounts = new Map<string, Account>();
  private readonly defaultCurrency: CurrencyCode;

  constructor(defaultCurrency: CurrencyCode = "USD") {
    this.defaultCurrency = defaultCurrency.toUpperCase();
  }

  register(input: AccountInput): Account {
    const code = assertValidCode(input.code);
    if (this.accounts.has(code)) {
      throw new LedgerError("ACCOUNT_DUPLICATE", `account already registered: ${code}`);
    }
    const type = input.type ?? rootType(code);
    if (type === undefined) {
      throw new LedgerError("ACCOUNT_UNKNOWN_TYPE", `cannot infer an account type for: ${code}`);
    }
    const account: Account = {
      code,
      name: input.name ?? leafName(code),
      type,
      currency: (input.currency ?? this.defaultCurrency).toUpperCase(),
    };
    this.accounts.set(code, account);
    return account;
  }

  registerAll(inputs: readonly AccountInput[]): Account[] {
    return inputs.map((input) => this.register(input));
  }

  has(code: string): boolean {
    return this.accounts.has(normalizeCode(code));
  }

  get(code: string): Account | undefined {
    return this.accounts.get(normalizeCode(code));
  }

  require(code: string): Account {
    const account = this.get(code);
    if (account === undefined) {
      throw new LedgerError("ACCOUNT_UNKNOWN", `unknown account: ${code}`);
    }
    return account;
  }

  parentOf(code: string): Account | undefined {
    for (const ancestor of ancestorCodes(code)) {
      const account = this.accounts.get(ancestor);
      if (account !== undefined) return account;
    }
    return undefined;
  }

  childrenOf(code: string): Account[] {
    const prefix = normalizeCode(code);
    const wanted = prefix.length === 0 ? 1 : depth(prefix) + 1;
    return this.list().filter(
      (account) => isUnder(account.code, prefix) && account.code !== prefix && depth(account.code) === wanted,
    );
  }

  descendantsOf(code: string): Account[] {
    const prefix = normalizeCode(code);
    return this.list().filter((account) => isUnder(account.code, prefix) && account.code !== prefix);
  }

  list(): Account[] {
    return [...this.accounts.values()].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  }

  get size(): number {
    return this.accounts.size;
  }
}
