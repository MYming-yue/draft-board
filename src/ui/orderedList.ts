/** Find the next sibling number in the contiguous list at the insertion point. */
export function orderedListSnippet(value: string, start: number, end: number) {
  const before = value.slice(0, start);
  const lines = before.split("\n");
  const current = lines.at(-1)!;
  const indent = current.match(/^\s*/)?.[0] ?? "";
  let number = 1;
  let listIndent = indent;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (i === lines.length - 1 && !line.trim()) continue;
    const match = /^(\s*)(\d+)\.\s/.exec(line);
    if (match) {
      if (current.trim() || !current || match[1].length <= indent.length) {
        number = Number(match[2]) + 1;
        listIndent = match[1];
        break;
      }
    } else if (!line.trim() || !/^\s+\S/.test(line)) break;
  }
  const prefix = `${current.trim() ? "\n" + listIndent : listIndent.slice(indent.length)}${number}. `;
  const selected = value.slice(start, end) || "列表项";
  return { text: prefix + selected, cur: prefix.length, curEnd: prefix.length + selected.length };
}
