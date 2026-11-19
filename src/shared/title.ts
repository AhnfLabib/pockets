// Tab titles as Pockets shows them: without the unread count some sites put in front ("(3) YouTube").

const LEADING_COUNT = /^\s*(?:\(\s*\d[\d,.]*\+?\s*\)|\[\s*\d[\d,.]*\+?\s*\])\s*/;

/**
 * `title` without a leading count in parentheses or brackets ("(3) ", "(12+) ", "[2] "), trimmed. A title that is
 * only a count ("(3)") is kept as it was rather than shown empty.
 */
export function cleanTitle(title: string): string {
  if (typeof title !== 'string') return title;
  const cleaned = title.replace(LEADING_COUNT, '').trim();
  return cleaned || title.trim() || title;
}
