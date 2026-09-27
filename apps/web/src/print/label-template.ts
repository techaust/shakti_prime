// QR product labels for serials, bins and packages (BLUEPRINT §8 inventory), one label per
// page at the label stock's exact size, as thermal label printers expect. Light theme only.
import { printCopy } from './copy';
import { html, trusted } from './html';
import { qrSvg } from './qr';
import { baseCss } from './styles';

export type LabelSize = '50x25' | '100x50';

export interface LabelPrint {
  entityName: string;
  itemName: string;
  itemCode: string;
  serial: string;
  /** What the QR code carries, such as the serial number's lookup link. */
  qrPayload: string;
}

export const LABEL_SIZES: Record<LabelSize, { widthMm: number; heightMm: number }> = {
  '50x25': { widthMm: 50, heightMm: 25 },
  '100x50': { widthMm: 100, heightMm: 50 },
};

// Label text is set in points for the printed size; the smallest is 6.5 pt (about 2.3 mm
// cap height), readable on a 203 dpi thermal print.
const css: Record<LabelSize, string> = {
  '50x25': `
@page{size:50mm 25mm;margin:0;}
.label{width:50mm;height:25mm;padding:1.5mm;display:flex;gap:1.5mm;align-items:center;overflow:hidden;break-after:page;}
.label .qr svg{width:21mm;height:21mm;display:block;}
.label .text{min-width:0;display:flex;flex-direction:column;gap:0.6mm;}
.label .name{font-size:7pt;line-height:8.5pt;font-weight:590;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.label .field{font-size:6.5pt;line-height:7.5pt;}
.label .field span{display:block;color:var(--text-muted);}
.label .field b{font-weight:590;font-variant-numeric:tabular-nums;}
.label .entity,.label .scan{display:none;}
`,
  '100x50': `
@page{size:100mm 50mm;margin:0;}
.label{width:100mm;height:50mm;padding:3mm;display:flex;gap:3mm;align-items:center;overflow:hidden;break-after:page;}
.label .qr svg{width:40mm;height:40mm;display:block;}
.label .qr .scan{font-size:7pt;line-height:8pt;text-align:center;margin-top:0.8mm;color:var(--text-muted);}
.label .text{min-width:0;display:flex;flex-direction:column;gap:1.5mm;}
.label .entity{font-size:8pt;line-height:10pt;color:var(--text-muted);}
.label .name{font-size:11pt;line-height:13pt;font-weight:590;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.label .field{font-size:9pt;line-height:11pt;}
.label .field span{display:block;color:var(--text-muted);font-size:7.5pt;line-height:9pt;}
.label .field b{font-weight:590;font-variant-numeric:tabular-nums;}
`,
};

/** One HTML document holding every label, one per page. */
export async function renderLabelsHtml(labels: LabelPrint[], size: LabelSize): Promise<string> {
  const t = printCopy();
  const codes = await Promise.all(labels.map((l) => qrSvg(l.qrPayload)));
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta
          http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:"
        />
        <style>
          ${trusted(baseCss())}${trusted(css[size])}
        </style>
      </head>
      <body>
        ${labels.map(
          (label, i) =>
            html`<div class="label">
              <div class="qr">
                ${trusted(codes[i] ?? '')}
                <div class="scan">${t('label.scan')}</div>
              </div>
              <div class="text">
                <div class="entity">${label.entityName}</div>
                <div class="name">${label.itemName}</div>
                <div class="field"><span>${t('label.item')}</span><b>${label.itemCode}</b></div>
                <div class="field"><span>${t('label.serial')}</span><b>${label.serial}</b></div>
              </div>
            </div>`,
        )}
      </body>
    </html>`.value;
}
