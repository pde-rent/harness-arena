import { LedgerError, type Page, type PageRequest } from "./types";

export function totalPagesFor(total: number, pageSize: number): number {
  return total === 0 ? 1 : Math.ceil(total / pageSize);
}

export function paginate<T>(items: readonly T[], request: PageRequest): Page<T> {
  const { page, pageSize } = request;
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new LedgerError("PAGE_BAD_SIZE", `pageSize must be a positive integer: ${pageSize}`);
  }
  if (!Number.isInteger(page) || page < 1) {
    throw new LedgerError("PAGE_BAD_NUMBER", `page must be a positive integer (1-based): ${page}`);
  }
  const total = items.length;
  const totalPages = totalPagesFor(total, pageSize);
  const start = (page - 1) * pageSize;
  const slice = start >= total ? [] : items.slice(start, start + pageSize);
  return {
    items: slice,
    page,
    pageSize,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

export function emptyPage<T>(pageSize: number): Page<T> {
  return paginate<T>([], { page: 1, pageSize });
}

export function mapPage<T, U>(source: Page<T>, transform: (value: T, index: number) => U): Page<U> {
  return { ...source, items: source.items.map(transform) };
}

export function pageCount<T>(items: readonly T[], pageSize: number): number {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new LedgerError("PAGE_BAD_SIZE", `pageSize must be a positive integer: ${pageSize}`);
  }
  return totalPagesFor(items.length, pageSize);
}

export function* pages<T>(items: readonly T[], pageSize: number): Generator<Page<T>> {
  const last = pageCount(items, pageSize);
  for (let page = 1; page <= last; page += 1) {
    yield paginate(items, { page, pageSize });
  }
}
