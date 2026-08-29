/** FNV-1a, 32-bit. Used only as a memory-flat prefilter bucket — collisions are
 *  harmless because pass 2 re-groups on the exact normalised string. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
