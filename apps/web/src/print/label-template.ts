// QR labels for serials, bins and packages (docs/03-roadmap-appendix/phase3.md §7.4, question 9
// (a)), one label per page at the label stock's exact size, as thermal label printers expect.
// Light theme only. The QR code carries `SP1:<kind>:<id>` (`labelPayload()` in @shakti/domain),
// so a scan opens the record whatever its name or code says by then.
import type { LabelSize } from '@shakti/contracts';
import { printCopy } from './copy';
import { html, trusted, type Html } from './html';
import { qrSvg } from './qr';
import { baseCss, type TemplateOptions } from './styles';

/** A serial's label: its company, item, SKU and serial number. */
export interface SerialLabelPrint {
  kind: 'serial';
  qrPayload: string;
  companyName: string;
  itemName: string;
  sku: string;
  serialNo: string;
}

/** A bin's label: its code large, for reading across an aisle, and its hub. */
export interface BinLabelPrint {
  kind: 'bin';
  qrPayload: string;
  hubName: string;
  hubCode: string;
  binCode: string;
}

/** A dispatch package's label (D2): the dispatch, the package's place in it, where it goes. */
export interface PackageLabelPrint {
  kind: 'package';
  qrPayload: string;
  hubName: string;
  dispatchNo: string;
  packageNo: number;
  packageCount: number;
  customerName: string;
  place: string;
}

export type LabelPrint = SerialLabelPrint | BinLabelPrint | PackageLabelPrint;

/** The label stock in millimetres, by size. */
export const LABEL_STOCK: Record<LabelSize, { widthMm: number; heightMm: number }> = {
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
.label .text{min-width:0;display:flex;flex-direction:column;gap:0.5mm;}
.label .over{font-size:6.5pt;line-height:7.5pt;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.label .name{font-size:7pt;line-height:8.5pt;font-weight:590;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.label.bin .name{font-size:13pt;line-height:15pt;-webkit-line-clamp:2;overflow-wrap:anywhere;}
.label .field{font-size:6.5pt;line-height:7.5pt;}
.label .field span{display:block;color:var(--text-muted);}
.label .field b{font-weight:590;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;}
`,
  '100x50': `
@page{size:100mm 50mm;margin:0;}
.label{width:100mm;height:50mm;padding:3mm;display:flex;gap:3mm;align-items:center;overflow:hidden;break-after:page;}
.label .qr svg{width:40mm;height:40mm;display:block;}
.label .text{min-width:0;display:flex;flex-direction:column;gap:1.5mm;}
.label .over{font-size:8pt;line-height:10pt;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.label .name{font-size:11pt;line-height:13pt;font-weight:590;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.label.bin .name{font-size:24pt;line-height:27pt;overflow-wrap:anywhere;}
.label .field{font-size:9pt;line-height:11pt;}
.label .field span{display:block;color:var(--text-muted);font-size:7.5pt;line-height:9pt;}
.label .field b{font-weight:590;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;}
`,
};

function field(name: string, value: string): Html {
  return html`<div class="field"><span>${name}</span><b>${value}</b></div>`;
}

/** The words of one label beside its code. */
function labelText(label: LabelPrint): Html {
  const t = printCopy();
  switch (label.kind) {
    case 'serial':
      return html`<div class="over">${label.companyName}</div>
        <div class="name">${label.itemName}</div>
        ${field(t('label.item'), label.sku)} ${field(t('label.serial'), label.serialNo)}`;
    case 'bin':
      return html`<div class="over">${label.hubName}</div>
        <div class="name">${label.binCode}</div>
        ${field(t('label.hub'), label.hubCode)}`;
    case 'package':
      return html`<div class="over">${label.hubName}</div>
        <div class="name">${label.customerName}</div>
        ${field(t('label.dispatch'), label.dispatchNo)}
        ${field(
          t('label.package'),
          t('label.packageOf', { n: label.packageNo, count: label.packageCount }),
        )}
        ${field(t('label.place'), label.place)}`;
  }
}

/** One HTML document holding every label, one per page, in the order given. */
export async function renderLabelsHtml(
  labels: readonly LabelPrint[],
  size: LabelSize,
  options: TemplateOptions = {},
): Promise<string> {
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
          ${trusted(baseCss(options))}${trusted(css[size])}
        </style>
      </head>
      <body>
        ${labels.map(
          (label, i) =>
            html`<div class="label ${label.kind}">
              <div class="qr">${trusted(codes[i] ?? '')}</div>
              <div class="text">${labelText(label)}</div>
            </div>`,
        )}
      </body>
    </html>`.value;
}
