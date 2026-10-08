// QR codes for print, drawn as SVG so they stay sharp at any printer resolution. Dark modules
// use the light theme's text colour on its background colour (docs/08-design-system.md §2): near-black on
// white, which every scanner reads.
import QRCode from 'qrcode';
import { lightColor } from './styles';

/** Medium error correction: survives a scuffed or partly covered label. */
const LEVEL = 'M';

export async function qrSvg(payload: string): Promise<string> {
  return QRCode.toString(payload, {
    type: 'svg',
    errorCorrectionLevel: LEVEL,
    margin: 0,
    color: { dark: lightColor('text'), light: lightColor('bg') },
  });
}

/** The module grid the SVG draws, row by row (true = dark), for checking a rendered code. */
export function qrMatrix(payload: string): boolean[][] {
  const { modules } = QRCode.create(payload, { errorCorrectionLevel: LEVEL });
  const rows: boolean[][] = [];
  for (let y = 0; y < modules.size; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < modules.size; x++) row.push(modules.get(y, x) === 1);
    rows.push(row);
  }
  return rows;
}
