/**
 * ffmpeg expression over time variable `tVar` that holds the first/last key's
 * value outside the keyed range and eases between neighbours with smoothstep —
 * the same curve the Reframe editor and the Video Editor preview draw.
 * Contains commas: callers must single-quote it inside a filter.
 */
export function keyframeExpr(keys: Array<{ t: number; v: number }>, tVar = 't'): string {
  const n = (x: number) => x.toFixed(4)
  const sorted = [...keys].sort((a, b) => a.t - b.t)
  let expr = n(sorted[sorted.length - 1].v)
  for (let i = sorted.length - 2; i >= 0; i--) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (b.t - a.t <= 0) continue
    const s = `((${tVar}-${n(a.t)})/${n(b.t - a.t)})`
    const seg = `${n(a.v)}+(${n(b.v - a.v)})*${s}*${s}*(3-2*${s})`
    expr = `if(lt(${tVar},${n(b.t)}),${seg},${expr})`
  }
  return `if(lt(${tVar},${n(sorted[0].t)}),${n(sorted[0].v)},${expr})`
}
