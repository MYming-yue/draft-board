export function cardReferences(boardId, cards) {
  if (!boardId || !cards?.length) return '';
  const escape = text => String(text).replace(/[\[\]\\]/g, '\\$&').replace(/[\r\n]/g, ' ');
  return '\n\n关联卡片：' + cards.map(card =>
    `[${escape(card.title || card.id)}](dsh-board://${encodeURIComponent(boardId)}/${encodeURIComponent(card.id)})`).join('、');
}
