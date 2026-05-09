/**
 * Compute a relative file path from one vault path to another.
 *
 * Example:
 *   from = "notes/sub/topic.md"
 *   to   = "papers/reference.pdf"
 *   →    "../../papers/reference.pdf"
 */
export function getRelativePath(from: string, to: string): string {
  const fromParts = from.split('/');
  fromParts.pop(); // discard filename, keep directory
  const toParts = to.split('/');

  // Strip common prefix
  while (
    fromParts.length > 0 &&
    toParts.length > 0 &&
    fromParts[0] === toParts[0]
  ) {
    fromParts.shift();
    toParts.shift();
  }

  const ups = fromParts.map(() => '..').join('/');
  const downs = toParts.join('/');

  if (ups && downs) return `${ups}/${downs}`;
  if (ups) return ups;
  return downs || '.';
}
