import { describe, expect, it } from "vitest";
import {
  isReadAction,
  normalizeStatus,
  numberAtLeastZero,
  parseCookies,
  requiredString,
  validIsoDate,
  validPin,
  validRequestId,
  validTime
} from "../src/lib";

describe("request validation", () => {
  it("accepts only four-digit PINs", () => {
    expect(validPin("0123")).toBe(true);
    expect(validPin("123")).toBe(false);
    expect(validPin("12a3")).toBe(false);
  });

  it("accepts safe idempotency keys", () => {
    expect(validRequestId("01HZY_TEST_1234")).toBe(true);
    expect(validRequestId("bad key")).toBe(false);
  });

  it("validates dates and times strictly", () => {
    expect(validIsoDate("2026-08-14")).toBe(true);
    expect(validIsoDate("2026-02-30")).toBe(false);
    expect(validTime("23:59")).toBe(true);
    expect(validTime("24:00")).toBe(false);
  });

  it("normalizes admin request state", () => {
    expect(normalizeStatus("Approved")).toBe("approved");
    expect(() => normalizeStatus("done")).toThrow();
  });

  it("rejects empty strings and negative numbers", () => {
    expect(() => requiredString(" ", "Name")).toThrow();
    expect(() => numberAtLeastZero(-1, "Rate")).toThrow();
  });

  it("identifies reads and parses cookies", () => {
    expect(isReadAction("Get Admin Dashboard")).toBe(true);
    expect(isReadAction("Clock In")).toBe(false);
    expect(parseCookies("a=1; triumph_admin=token").triumph_admin).toBe("token");
  });
});
