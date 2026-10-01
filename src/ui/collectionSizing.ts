import type { BoardNode, Op } from "../model";
import { CARD_CHROME_X, conceptBoxFromNatural, formulaBoxFromNatural, measureConceptNatural, measureFormulaNatural } from "./formulaLayout";
import { pureFormulaKind } from "./markdown";

/** 统一核心宽度，保留各自比例。备注字号不随之放大。 */
export function uniformCoreWidthOps(nodes: BoardNode[], targetWidth: number): Op[] {
  return nodes.flatMap((n): Op[] => {
    if (n.type === "image") {
      const w = Math.max(90, Math.min(1200, targetWidth));
      return [{ op: "resizeNode", nodeId: n.id, before: null, after: { w, h: n.h ? n.h * w / n.w : null } }];
    }
    const formula = pureFormulaKind(n.markdown ?? "");
    const natural = formula ? measureFormulaNatural(n.markdown ?? "") : measureConceptNatural(n.markdown ?? "");
    if (!natural) return [];
    const box = (formula ? formulaBoxFromNatural : conceptBoxFromNatural)(natural, (targetWidth - CARD_CHROME_X) / natural.w);
    return [{ op: "resizeNode", nodeId: n.id, before: null, after: { w: box.w, h: formula ? box.h : null, coreScale: formula ? null : box.scale } }];
  });
}
