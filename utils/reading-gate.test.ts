import { describe, expect, it } from "vitest";
import { isRead, requirementFrom, scrollPercent } from "./reading-gate";

describe("requirementFrom", () => {
  it("asks for nothing while the setting is off, whatever its values", () => {
    expect(
      requirementFrom({
        readingRequired: false,
        readMinSeconds: 30,
        readMinScrollPercent: 80,
      }),
    ).toBeNull();
    expect(requirementFrom(null)).toBeNull();
  });

  it("asks for nothing when both conditions are at zero", () => {
    expect(
      requirementFrom({
        readingRequired: true,
        readMinSeconds: 0,
        readMinScrollPercent: 0,
      }),
    ).toBeNull();
  });

  it("clamps what it is given to what a page can show", () => {
    expect(
      requirementFrom({
        readingRequired: true,
        readMinSeconds: -5,
        readMinScrollPercent: 150,
      }),
    ).toEqual({ minSeconds: 0, minScrollPercent: 100 });
  });
});

describe("isRead", () => {
  const requirement = { minSeconds: 30, minScrollPercent: 80 };

  it("needs both the time and the scroll", () => {
    expect(
      isRead({ visibleMs: 31_000, maxScrollPercent: 50 }, requirement),
    ).toBe(false);
    expect(
      isRead({ visibleMs: 5_000, maxScrollPercent: 100 }, requirement),
    ).toBe(false);
    expect(
      isRead({ visibleMs: 30_000, maxScrollPercent: 80 }, requirement),
    ).toBe(true);
  });

  it("drops a condition set to zero", () => {
    expect(
      isRead(
        { visibleMs: 0, maxScrollPercent: 90 },
        { minSeconds: 0, minScrollPercent: 80 },
      ),
    ).toBe(true);
  });
});

describe("scrollPercent", () => {
  it("measures the bottom of the viewport against the page", () => {
    expect(scrollPercent(0, 1000, 10_000)).toBe(10);
    expect(scrollPercent(9000, 1000, 10_000)).toBe(100);
  });

  it("counts a page that does not scroll as read all the way down", () => {
    // A paged reader showing one image: a scroll it cannot make must not
    // keep the chapter from ever counting.
    expect(scrollPercent(0, 1000, 800)).toBe(100);
  });
});
