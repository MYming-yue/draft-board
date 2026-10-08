export const GREEK = [
  ..."α:alpha β:beta γ:gamma δ:delta ε:epsilon ζ:zeta η:eta θ:theta ι:iota κ:kappa λ:lambda μ:mu ν:nu ξ:xi ο:omicron π:pi ρ:rho σ:sigma τ:tau υ:upsilon φ:phi χ:chi ψ:psi ω:omega".split(" "),
  ..."Α:Alpha Β:Beta Γ:Gamma Δ:Delta Ε:Epsilon Ζ:Zeta Η:Eta Θ:Theta Ι:Iota Κ:Kappa Λ:Lambda Μ:Mu Ν:Nu Ξ:Xi Ο:Omicron Π:Pi Ρ:Rho Σ:Sigma Τ:Tau Υ:Upsilon Φ:Phi Χ:Chi Ψ:Psi Ω:Omega ϵ:varepsilon ϑ:vartheta ϖ:varpi ϱ:varrho ς:varsigma ϕ:varphi ∇:nabla（梯度算子）".split(" "),
].map(entry => { const [symbol, name] = entry.split(":"); return { symbol, name }; });
export const GREEK_HISTORY_KEY = "draft-board.greek-recent.v1";
let recent: string[] = [];
export function readGreekHistory(): string[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(GREEK_HISTORY_KEY) ?? "[]");
    recent = Array.isArray(data) ? [...new Set(data.filter((s): s is string => typeof s === "string" && GREEK.some(g => g.symbol === s)))] : [];
  } catch { /* 存储不可用时保留当前会话记录。 */ }
  return recent;
}
export function rememberGreek(symbol: string): string[] {
  recent = [symbol, ...readGreekHistory().filter(s => s !== symbol)];
  try { localStorage.setItem(GREEK_HISTORY_KEY, JSON.stringify(recent)); } catch { /* 不阻止编辑。 */ }
  return recent;
}
export function sortedGreek(history: string[]) {
  return [...GREEK].sort((a, b) => {
    const rank = (s: string) => history.includes(s) ? history.indexOf(s) : history.length;
    return rank(a.symbol) - rank(b.symbol);
  });
}
