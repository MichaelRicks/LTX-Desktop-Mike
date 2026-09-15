interface RixLogoProps {
  className?: string
}

/**
 * "RiX" app wordmark (RiX Desktop Studio Pro). The R and X are width-locked text
 * (textLength) so it renders identically across fonts, and the lowercase "i" is a
 * custom mark — a rounded stem with a dot — to give it a bit of identity. Single
 * color via currentColor, so it inherits the caller's text color (e.g. text-white)
 * and scales to the caller's height (h-5 w-auto). Swap for a richer asset later.
 */
export function RixLogo({ className = 'h-6' }: RixLogoProps) {
  const font = "'Segoe UI', system-ui, -apple-system, sans-serif"
  return (
    <svg
      className={className}
      viewBox="0 0 62 32"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="RiX"
      fill="none"
    >
      <text x="0" y="26" textLength="22" lengthAdjust="spacingAndGlyphs" fontFamily={font} fontWeight="800" fontSize="30" fill="currentColor">R</text>
      {/* custom lowercase "i": stem + dot */}
      <rect x="27" y="11" width="6" height="15" rx="3" fill="currentColor" />
      <circle cx="30" cy="6" r="3.4" fill="currentColor" />
      <text x="38" y="26" textLength="22" lengthAdjust="spacingAndGlyphs" fontFamily={font} fontWeight="800" fontSize="30" fill="currentColor">X</text>
    </svg>
  )
}
