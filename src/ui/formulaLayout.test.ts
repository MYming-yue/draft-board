import { describe, expect, it } from "vitest";
import {
  CARD_CHROME_X,
  CARD_CHROME_Y,
  clampFormulaScale,
  formulaBoxFromNatural,
  formulaScaleFromCardW,
} from "./formulaLayout";

describe("formulaLayout 纯公式卡几何", () => {
  it("scale=1 时外框 = 字形 + chrome，小于默认 240 宽", () => {
    const box = formulaBoxFromNatural({ w: 80, h: 30 }, 1);
    expect(box.w).toBe(80 + CARD_CHROME_X);
    expect(box.h).toBe(30 + CARD_CHROME_Y);
    expect(box.scale).toBe(1);
    expect(box.fontSize).toBe(14);
    expect(box.w).toBeLessThan(240);
  });

  it("缩放后可由卡宽反推 scale（chrome 不参与比例）", () => {
    const nat = { w: 100, h: 40 };
    const box = formulaBoxFromNatural(nat, 2);
    expect(box.w).toBe(100 * 2 + CARD_CHROME_X);
    expect(box.h).toBe(40 * 2 + CARD_CHROME_Y);
    expect(formulaScaleFromCardW(nat.w, box.w)).toBe(2);
  });

  it("scale 夹在 0.5–6", () => {
    expect(clampFormulaScale(0.1)).toBe(0.5);
    expect(clampFormulaScale(9)).toBe(6);
    expect(formulaScaleFromCardW(100, CARD_CHROME_X + 100 * 9)).toBe(6);
    expect(formulaScaleFromCardW(100, CARD_CHROME_X + 100 * 0.2)).toBe(0.5);
  });
});
