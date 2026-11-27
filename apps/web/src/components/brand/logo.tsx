import {
  LOGO_VIEWBOX,
  MARK_LOWER,
  MARK_SMALL_LOWER,
  MARK_SMALL_UPPER,
  MARK_UPPER,
  WORD_DOTS,
  WORD_PRIME,
  WORD_SHAKTI,
} from './logo-paths';

/**
 * The Shakti Prime logo, the Spark S with its wordmark, drawn inline in the theme's tokens so it
 * follows light, dark and higher contrast with no second file and no script: `--brand` for the
 * upper half and "Prime", `--brand-deep` for the lower half. `markOnly` draws the Spark S alone;
 * `small` draws it with the wider spark made for sizes under 32 px. Its size comes from the
 * caller's height class.
 */
export function Logo({
  label,
  className,
  markOnly = false,
  small = false,
}: {
  /** The accessible name, the product name from the catalogue. */
  label: string;
  className?: string;
  markOnly?: boolean;
  /** For a mark drawn under 32 px: the spark is cut wider so it still shows. */
  small?: boolean;
}) {
  const alone = markOnly || small;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={alone ? '0 0 48 48' : LOGO_VIEWBOX}
      role="img"
      aria-label={label}
      className={className}
    >
      <path className="fill-brand" d={small ? MARK_SMALL_UPPER : MARK_UPPER} />
      <path className="fill-brand-deep" d={small ? MARK_SMALL_LOWER : MARK_LOWER} />
      {alone ? null : (
        <>
          <path className="fill-text" d={WORD_SHAKTI} />
          <path className="fill-brand" d={WORD_PRIME} />
          <path className="fill-brand" d={WORD_DOTS} />
        </>
      )}
    </svg>
  );
}
