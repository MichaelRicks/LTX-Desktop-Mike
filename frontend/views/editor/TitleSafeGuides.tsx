// Broadcast safe-area guides over the program monitor: the inner 90% of the frame
// is action safe, the inner 80% is title safe. Preview only — nothing here is
// burned into an export; they're for checking a title or a logo won't be clipped
// or crowded on a TV or in a player's chrome.
//
// Percentages of the frame rather than pixels, so they hold at any monitor size
// and in either aspect.

const ACTION_SAFE_INSET = '5%'
const TITLE_SAFE_INSET = '10%'

const label = 'absolute text-[8px] font-medium uppercase tracking-wider px-1 leading-none'

export function TitleSafeGuides() {
  return (
    <div className="absolute inset-0 pointer-events-none">
      <div
        className="absolute border border-dashed border-white/35"
        style={{ left: ACTION_SAFE_INSET, top: ACTION_SAFE_INSET, right: ACTION_SAFE_INSET, bottom: ACTION_SAFE_INSET }}
      >
        <span className={`${label} left-0 -top-3 text-white/45`}>Action safe</span>
      </div>
      <div
        className="absolute border border-white/60"
        style={{ left: TITLE_SAFE_INSET, top: TITLE_SAFE_INSET, right: TITLE_SAFE_INSET, bottom: TITLE_SAFE_INSET }}
      >
        <span className={`${label} left-0 -top-3 text-white/70`}>Title safe</span>
      </div>
    </div>
  )
}
