/** A number's quality as Integration Health shows it and `whatsapp.quality_low` reads it. */
export type QualityRating = 'green' | 'yellow' | 'red' | 'unknown';

/**
 * A number's quality as Meta's last `phone_number_quality_update` left it: flagged is low (red), a
 * downgrade medium (yellow), unflagged or an upgrade high (green); anything else is not known.
 */
export function qualityRating(event: string | null): QualityRating {
  switch (event?.toUpperCase()) {
    case 'FLAGGED':
      return 'red';
    case 'DOWNGRADE':
      return 'yellow';
    case 'UNFLAGGED':
    case 'UPGRADE':
      return 'green';
    default:
      return 'unknown';
  }
}
