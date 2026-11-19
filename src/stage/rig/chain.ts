export interface Pt { x: number; y: number }

/** Link lengths: head, shoulders, hips, six tail nodes. LINKS[0] is unused (head is the anchor). */
export const LINKS = [0, 15, 22, 8, 8, 8, 8, 8, 7];

/** A chain laid out straight behind the head, opposite to `heading` (radians). */
export function createChain(head: Pt, heading: number): Pt[] {
  const dx = Math.cos(heading);
  const dy = Math.sin(heading);
  const nodes: Pt[] = [{ x: head.x, y: head.y }];
  let dist = 0;
  for (let i = 1; i < LINKS.length; i++) {
    dist += LINKS[i];
    nodes.push({ x: head.x - dx * dist, y: head.y - dy * dist });
  }
  return nodes;
}

/** Pull each node to its link length from the previous one. `stretch` scales links 1 and 2 only. */
export function followChain(nodes: Pt[], stretch: number): void {
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1];
    const c = nodes[i];
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    const ds = LINKS[i] * (i <= 2 ? stretch : 1);
    c.x = a.x + (dx / l) * ds;
    c.y = a.y + (dy / l) * ds;
  }
}
