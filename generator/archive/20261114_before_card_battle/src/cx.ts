/** class の名前をつなぐ(空・false・null は飛ばす) */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}
