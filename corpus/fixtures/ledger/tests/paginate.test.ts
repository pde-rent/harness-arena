import { describe, expect, test } from "bun:test";
import { emptyPage, mapPage, pageCount, pages, paginate, totalPagesFor } from "../src/paginate";
import { LedgerError } from "../src/types";

const items = [1, 2, 3, 4, 5, 6, 7];

describe("paginate", () => {
  test("page 1 returns the first pageSize items", () => {
    const page = paginate(items, { page: 1, pageSize: 3 });
    expect(page.items).toEqual([1, 2, 3]);
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(3);
    expect(page.total).toBe(7);
    expect(page.totalPages).toBe(3);
    expect(page.hasPrev).toBe(false);
    expect(page.hasNext).toBe(true);
  });

  test("middle pages report both neighbours", () => {
    const page = paginate(items, { page: 2, pageSize: 3 });
    expect(page.items).toEqual([4, 5, 6]);
    expect(page.hasPrev).toBe(true);
    expect(page.hasNext).toBe(true);
  });

  test("the last page holds the remainder", () => {
    const page = paginate(items, { page: 3, pageSize: 3 });
    expect(page.items).toEqual([7]);
    expect(page.hasNext).toBe(false);
    expect(page.hasPrev).toBe(true);
  });

  test("an exactly divisible list has no trailing empty page", () => {
    const page = paginate([1, 2, 3, 4], { page: 2, pageSize: 2 });
    expect(page.totalPages).toBe(2);
    expect(page.items).toEqual([3, 4]);
    expect(page.hasNext).toBe(false);
  });

  test("pages past the end are empty but still described", () => {
    const page = paginate(items, { page: 9, pageSize: 3 });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(7);
    expect(page.totalPages).toBe(3);
    expect(page.hasNext).toBe(false);
    expect(page.hasPrev).toBe(true);
  });

  test("empty input yields exactly one empty page (totalPages === 1)", () => {
    const page = paginate([], { page: 1, pageSize: 10 });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.totalPages).toBe(1);
    expect(page.hasNext).toBe(false);
    expect(page.hasPrev).toBe(false);
    expect(emptyPage<number>(10)).toEqual(page);
  });

  test("a pageSize larger than the input returns everything", () => {
    const page = paginate(items, { page: 1, pageSize: 100 });
    expect(page.items).toEqual(items);
    expect(page.totalPages).toBe(1);
    expect(page.hasNext).toBe(false);
  });

  test("rejects non-positive or fractional page arguments", () => {
    expect(() => paginate(items, { page: 0, pageSize: 3 })).toThrow(LedgerError);
    expect(() => paginate(items, { page: 1.5, pageSize: 3 })).toThrow(/1-based/);
    expect(() => paginate(items, { page: 1, pageSize: 0 })).toThrow(/positive integer/);
  });

  test("does not alias the source array", () => {
    const source = [1, 2, 3];
    const page = paginate(source, { page: 1, pageSize: 3 });
    source.push(4);
    expect(page.items).toEqual([1, 2, 3]);
  });
});

describe("helpers", () => {
  test("totalPagesFor and pageCount agree", () => {
    expect(totalPagesFor(0, 10)).toBe(1);
    expect(totalPagesFor(10, 10)).toBe(1);
    expect(totalPagesFor(11, 10)).toBe(2);
    expect(pageCount(items, 2)).toBe(4);
  });

  test("mapPage keeps the envelope", () => {
    const page = mapPage(paginate(items, { page: 1, pageSize: 2 }), (value) => value * 10);
    expect(page.items).toEqual([10, 20]);
    expect(page.total).toBe(7);
    expect(page.totalPages).toBe(4);
  });

  test("pages() walks every page exactly once", () => {
    const walked = [...pages(items, 3)];
    expect(walked.map((page) => page.items)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect([...pages([], 3)].map((page) => page.items)).toEqual([[]]);
  });
});
