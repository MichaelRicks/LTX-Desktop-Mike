/**
 * Turn a generation prompt into a short, filesystem-friendly SUBJECT for auto-naming
 * saved assets — e.g. "A toy robot sitting on a shelf. It jumps down..." -> "toy-robot",
 * "cinematic shot of an alien creature" -> "alien-creature".
 *
 * Deliberately a fast, model-free heuristic so it runs instantly at save time: take the
 * first clause, drop leading articles / framing words (photo of, shot of, cinematic…),
 * and keep the opening noun phrase up to the first preposition / connective / action verb.
 * It won't be perfect — the occasional miss is a quick rename in the library — but it turns
 * the hashed dump into human-readable names for the common case with zero cost.
 */

// Leading words that are framing/quality noise, not the subject.
const LEADING_FILLER = new Set([
  'a', 'an', 'the', 'this', 'my', 'of',
  'photo', 'photograph', 'picture', 'image', 'render', 'rendering', 'shot',
  'closeup', 'close-up', 'cinematic', 'portrait', 'scene', 'view',
])

// Words that end the subject noun phrase: prepositions + common connectives/copulas.
const BOUNDARY = new Set([
  'on', 'in', 'at', 'with', 'under', 'over', 'near', 'by', 'from', 'into', 'onto',
  'through', 'above', 'below', 'beside', 'against', 'around', 'atop', 'amid', 'inside',
  'and', 'or', 'that', 'which', 'while', 'as', 'to', 'for', 'is', 'are', 'was', 'were',
])

const MAX_WORDS = 3
const MAX_LEN = 48

export function deriveSubject(prompt: string | null | undefined, fallback = 'gen'): string {
  const firstClause = (prompt ?? '').toLowerCase().split(/[.,;:!?\n]|—|--/)[0] ?? ''
  const words = firstClause
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  let i = 0
  while (i < words.length && LEADING_FILLER.has(words[i])) i++

  const subject: string[] = []
  for (; i < words.length && subject.length < MAX_WORDS; i++) {
    const w = words[i]
    if (BOUNDARY.has(w)) break
    // An -ing action verb ends the phrase, but only once we already have a noun head —
    // so "king" / "viking" as the subject itself survive.
    if (subject.length > 0 && /[a-z]{3,}ing$/.test(w)) break
    subject.push(w)
  }

  const name = subject
    .join('-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_LEN)
    .replace(/-+$/g, '')
  return name || fallback
}
