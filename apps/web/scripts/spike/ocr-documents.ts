// Synthetic document photos for the OCR masking spike (ROADMAP §2 week 6). Spike use only.
// Every number is made up: twelve random digits with a correct Verhoeff check digit, and bank
// account numbers of random digits. Names come from a short list of common Indian names. No
// real card, real number or real design is copied; the images exist only in memory. Some cards
// and letters carry a QR code holding a made-up record with the made-up number, as older
// Aadhaar cards and e-Aadhaar letters do; its layout is invented, not a real format.
import { verhoeffCheckDigit } from '@shakti/domain';
import QRCode from 'qrcode';
import sharp from 'sharp';

export type DocumentKind = 'identity_card' | 'letter' | 'passbook' | 'kyc_form' | 'bill' | 'quote';

export interface SyntheticDocument {
  id: string;
  kind: DocumentKind;
  /** Small, soft, grainy and heavily compressed. */
  hard: boolean;
  font: string;
  rotation: number;
  blur: number;
  noise: number;
  jpegQuality: number;
  width: number;
  layout: string;
  /** Kept in memory for scoring only; never written anywhere. */
  expected: { aadhaar: string[]; bank: string[] };
  /**
   * The QR code drawn on the document, if any: its size and where it landed on the photo (the
   * code's own extent, without its quiet zone). What it holds is not kept.
   */
  qr?: QrPlacement;
  photo: Buffer;
}

export interface QrPlacement {
  /** Modules a side (21 to 177). */
  modules: number;
  /** Side on the unrotated document, in document pixels. */
  side: number;
  /** `record`: text with the number; `dense`: a long run of digits with the number in it. */
  style: 'record' | 'dense';
  /** Bounding box of the code on the photo, in photo pixels. */
  extent: { x0: number; y0: number; x1: number; y1: number };
}

export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const FONTS = [
  'Arial',
  'Times New Roman',
  'Courier New',
  'Georgia',
  'Verdana',
  'Tahoma',
  'Calibri',
  'Segoe UI',
  'Trebuchet MS',
  'Cambria',
];
const FIRST = ['Kavita', 'Ramesh', 'Sunita', 'Mahendra', 'Pooja', 'Suresh', 'Anita', 'Vikram'];
const LAST = ['Sharma', 'Meena', 'Choudhary', 'Rathore', 'Jat', 'Gupta', 'Saini', 'Yadav'];
const VILLAGES = ['Chomu', 'Phagi', 'Bassi', 'Kotputli', 'Shahpura', 'Dudu', 'Sambhar'];

function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.floor(random() * list.length)] as T;
}

function digits(n: number, random: () => number, first = '123456789'): string {
  let out = pick(first.split(''), random);
  while (out.length < n) out += String(Math.floor(random() * 10));
  return out;
}

/** A made-up twelve-digit number that passes the Aadhaar checks. */
export function madeUpAadhaar(random: () => number): string {
  const body = digits(11, random, '23456789');
  return body + verhoeffCheckDigit(body);
}

function madeUpNonAadhaar(random: () => number): string {
  const body = digits(11, random, '23456789');
  const check = Number(verhoeffCheckDigit(body));
  return body + String((check + 3) % 10);
}

const spaced = (d: string) => `${d.slice(0, 4)} ${d.slice(4, 8)} ${d.slice(8)}`;

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface TextLine {
  text: string;
  x: number;
  y: number;
  size: number;
  bold?: boolean;
  anchor?: 'start' | 'middle';
}

interface QrDrawing {
  x: number;
  y: number;
  side: number;
  modules: number;
  /** Dark modules as an SVG path in the code's own module units. */
  path: string;
  style: QrPlacement['style'];
}

interface Layout {
  width: number;
  height: number;
  paper: string;
  lines: TextLine[];
  aadhaar: string[];
  bank: string[];
  layout: string;
  qr?: QrDrawing;
}

/**
 * A QR code holding a made-up record with the made-up number: either readable text or, as the
 * denser codes on newer letters, a long run of digits. The payload lives only inside the drawn
 * path and is dropped here.
 */
function qrDrawing(
  number: string,
  who: ReturnType<typeof person>,
  random: () => number,
  area: { x0: number; y0: number; x1: number; y1: number },
  sides: [number, number],
): QrDrawing {
  const style: QrPlacement['style'] = random() < 0.35 ? 'dense' : 'record';
  let payload: string;
  if (style === 'dense') {
    const before = digits(200 + Math.floor(random() * 500), random);
    const after = digits(100 + Math.floor(random() * 300), random);
    payload = `${before}${number}${after}`;
  } else {
    const filler = Array.from({ length: Math.floor(random() * 220) }, () =>
      pick('ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.split(''), random),
    ).join('');
    payload = `MADE-UP RECORD;uid=${number};name=${who.name};dob=${who.dob};sex=${who.gender[0]};vtc=${who.village};x=${filler}`;
  }
  const { modules } = QRCode.create(payload, {
    errorCorrectionLevel: pick(['L', 'M', 'Q'], random),
  });
  let path = '';
  for (let row = 0; row < modules.size; row++) {
    for (let col = 0; col < modules.size; col++) {
      if (modules.get(row, col)) path += `M${col} ${row}h1v1h-1z`;
    }
  }
  const [minSide, maxSide] = sides;
  const side = Math.round(minSide + random() * (maxSide - minSide));
  const x = Math.round(area.x0 + random() * Math.max(0, area.x1 - area.x0 - side));
  const y = Math.round(area.y0 + random() * Math.max(0, area.y1 - area.y0 - side));
  return { x, y, side, modules: modules.size, path, style };
}

function person(random: () => number) {
  return {
    name: `${pick(FIRST, random)} ${pick(LAST, random)}`,
    dob: `${String(1 + Math.floor(random() * 28)).padStart(2, '0')}/${String(1 + Math.floor(random() * 12)).padStart(2, '0')}/${1950 + Math.floor(random() * 50)}`,
    gender: random() < 0.5 ? 'Female' : 'Male',
    village: pick(VILLAGES, random),
  };
}

function identityCard(random: () => number, variant: number, qrRandom: () => number): Layout {
  const p = person(random);
  const number = madeUpAadhaar(random);
  const size = 30 + Math.floor(random() * 16);
  const numberText = variant % 3 === 2 ? number : spaced(number);
  const lines: TextLine[] = [
    { text: 'Government of India', x: 500, y: 70, size: 30, bold: true, anchor: 'middle' },
    { text: p.name, x: 330, y: 180, size: 28 },
    { text: `DOB: ${p.dob}`, x: 330, y: 230, size: 26 },
    { text: p.gender, x: 330, y: 280, size: 26 },
    { text: numberText, x: 500, y: 470, size, bold: true, anchor: 'middle' },
    { text: 'Aadhaar - Aam Aadmi ka Adhikar', x: 500, y: 560, size: 22, anchor: 'middle' },
  ];
  if (variant % 4 === 3) {
    lines.push({
      text: `VID : ${spaced(digits(12, random))} ${digits(4, random)}`,
      x: 500,
      y: 510,
      size: 20,
      anchor: 'middle',
    });
  }
  // Seven of the twelve cards, both hard ones among them, carry a QR code: on the right, or
  // on the left where a real card has the holder's photo.
  const withQr = variant % 2 === 0 || variant === 9;
  const qr = withQr
    ? qrRandom() < 0.7
      ? qrDrawing(number, p, qrRandom, { x0: 660, y0: 95, x1: 985, y1: 425 }, [130, 300])
      : qrDrawing(number, p, qrRandom, { x0: 30, y0: 100, x1: 320, y1: 430 }, [130, 270])
    : undefined;
  return {
    width: 1000,
    height: 620,
    paper: pick(['#FFFFFF', '#F7F3EA', '#EEF4F7', '#FBF7EF'], random),
    lines,
    aadhaar: [number],
    bank: [],
    layout: `${numberText.includes(' ') ? 'card, spaced' : 'card, unspaced'}${qr ? `, QR ${qr.style}` : ''}`,
    ...(qr ? { qr } : {}),
  };
}

function letter(random: () => number, variant: number, qrRandom: () => number): Layout {
  const p = person(random);
  const number = madeUpAadhaar(random);
  const written =
    variant % 2 === 0 ? number : `${number.slice(0, 4)}-${number.slice(4, 8)}-${number.slice(8)}`;
  // Two of the four letters carry a QR code at the foot of the page, as an e-Aadhaar letter does.
  const qr =
    variant % 2 === 1
      ? qrDrawing(number, p, qrRandom, { x0: 640, y0: 470, x1: 1060, y1: 880 }, [150, 320])
      : undefined;
  return {
    width: 1100,
    height: 900,
    paper: '#FFFFFF',
    lines: [
      { text: 'To the Manager,', x: 80, y: 100, size: 26 },
      { text: 'Subject: Solar pump subsidy application', x: 80, y: 170, size: 26, bold: true },
      { text: `I, ${p.name}, resident of village ${p.village},`, x: 80, y: 250, size: 26 },
      { text: `apply for the solar pump scheme.`, x: 80, y: 295, size: 26 },
      { text: `My Aadhaar number is ${written}.`, x: 80, y: 360, size: 26 },
      { text: `Mobile ${digits(5, random, '6789')} ${digits(5, random)}`, x: 80, y: 425, size: 26 },
      { text: 'Thank you.', x: 80, y: 520, size: 26 },
      { text: p.name, x: 80, y: 600, size: 26 },
    ],
    aadhaar: [number],
    bank: [],
    layout: `${variant % 2 === 0 ? 'letter, unspaced in a sentence' : 'letter, hyphenated'}${qr ? `, QR ${qr.style}` : ''}`,
    ...(qr ? { qr } : {}),
  };
}

function passbook(random: () => number, variant: number): Layout {
  const p = person(random);
  const account = digits(11 + Math.floor(random() * 6), random);
  const label = pick(['Account No', 'A/c No.', 'Savings Account Number', 'A/C No'], random);
  const sameLine = variant % 2 === 0;
  const lines: TextLine[] = [
    { text: 'Rajasthan Gramin Bank', x: 80, y: 90, size: 34, bold: true },
    { text: `Branch: ${p.village}`, x: 80, y: 150, size: 26 },
    { text: `Name: ${p.name}`, x: 80, y: 230, size: 26 },
  ];
  if (sameLine) lines.push({ text: `${label}: ${account}`, x: 80, y: 290, size: 28 });
  else {
    lines.push({ text: label, x: 80, y: 290, size: 26 });
    lines.push({ text: account, x: 80, y: 340, size: 30, bold: true });
  }
  lines.push({ text: `IFSC: RGBA000${digits(4, random)}`, x: 80, y: 400, size: 26 });
  lines.push({ text: `Village ${p.village}`, x: 80, y: 460, size: 26 });
  return {
    width: 1000,
    height: 560,
    paper: '#F4F8FB',
    lines,
    aadhaar: [],
    bank: [account],
    layout: sameLine ? 'passbook, label on the same line' : 'passbook, label above',
  };
}

function kycForm(random: () => number): Layout {
  const p = person(random);
  const number = madeUpAadhaar(random);
  const account = digits(12 + Math.floor(random() * 4), random);
  return {
    width: 1200,
    height: 900,
    paper: '#FFFFFF',
    lines: [
      { text: 'Customer details form', x: 80, y: 90, size: 34, bold: true },
      { text: `Name: ${p.name}`, x: 80, y: 180, size: 26 },
      { text: `Village: ${p.village}`, x: 80, y: 235, size: 26 },
      { text: `Aadhaar No: ${spaced(number)}`, x: 80, y: 300, size: 28 },
      { text: `Bank A/c No: ${account}`, x: 80, y: 365, size: 28 },
      { text: `IFSC: SBIN00${digits(5, random)}`, x: 80, y: 430, size: 26 },
      { text: `Pump: 5 HP submersible, 3.3 kW array`, x: 80, y: 495, size: 26 },
    ],
    aadhaar: [number],
    bank: [account],
    layout: 'form with Aadhaar and bank account',
  };
}

function bill(random: () => number, variant: number): Layout {
  const p = person(random);
  const consumer = madeUpNonAadhaar(random);
  const lines: TextLine[] = [
    { text: 'Jaipur Vidyut Vitran Nigam', x: 80, y: 90, size: 32, bold: true },
    { text: `Consumer No: ${consumer}`, x: 80, y: 170, size: 26 },
    { text: `K Number: ${digits(12, random)}${digits(1, random)}`, x: 80, y: 225, size: 26 },
    { text: `Name: ${p.name}`, x: 80, y: 280, size: 26 },
    { text: `Mobile: ${digits(10, random, '6789')}`, x: 80, y: 335, size: 26 },
    { text: `Bill date: 12-08-2026   Due: 26-08-2026`, x: 80, y: 390, size: 26 },
    { text: `Amount due: Rs 1,24,560.00`, x: 80, y: 445, size: 26 },
  ];
  if (variant % 2 === 1) {
    lines.push({
      text: `Card ${spaced(digits(12, random))} ${digits(4, random)}`,
      x: 80,
      y: 500,
      size: 26,
    });
  }
  return {
    width: 1100,
    height: 600,
    paper: '#FFFDF5',
    lines,
    aadhaar: [],
    bank: [],
    layout: variant % 2 === 1 ? 'bill with a sixteen-digit card number' : 'bill',
  };
}

function quote(random: () => number): Layout {
  const p = person(random);
  return {
    width: 1100,
    height: 700,
    paper: '#FFFFFF',
    lines: [
      { text: 'Quotation QT/2026-27/000412', x: 80, y: 90, size: 32, bold: true },
      { text: `Customer: ${p.name}, ${p.village}`, x: 80, y: 170, size: 26 },
      { text: 'Solar pump set 7.5 HP with 7.5 kW array', x: 80, y: 240, size: 26 },
      { text: `GSTIN 08${digits(10, random)}1Z5`, x: 80, y: 300, size: 26 },
      { text: `Total Rs 3,45,678.00`, x: 80, y: 360, size: 26 },
      { text: `Phone ${digits(10, random, '6789')}`, x: 80, y: 420, size: 26 },
    ],
    aadhaar: [],
    bank: [],
    layout: 'quote',
  };
}

function qrSvg(qr: QrDrawing, dark: string): string {
  const quiet = (qr.side / qr.modules) * 2;
  return `<rect x="${qr.x - quiet}" y="${qr.y - quiet}" width="${qr.side + 2 * quiet}" height="${qr.side + 2 * quiet}" fill="#FFFFFF"/><g transform="translate(${qr.x} ${qr.y}) scale(${qr.side / qr.modules})"><path d="${qr.path}" fill="${dark}" shape-rendering="crispEdges"/></g>`;
}

function svgFor(l: Layout, font: string): string {
  const texts = l.lines
    .map(
      (t) =>
        `<text x="${t.x}" y="${t.y}" font-family="${font}" font-size="${t.size}"${t.bold ? ' font-weight="bold"' : ''}${t.anchor === 'middle' ? ' text-anchor="middle"' : ''} fill="#1A1A1A">${esc(t.text)}</text>`,
    )
    .join('');
  const qr = l.qr ? qrSvg(l.qr, '#1A1A1A') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${l.width}" height="${l.height}"><rect width="100%" height="100%" fill="${l.paper}" rx="18"/>${texts}${qr}</svg>`;
}

/** Only the QR code, black on white, to follow it through the same turns and resizes. */
function qrOnlySvg(l: Layout, qr: QrDrawing): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${l.width}" height="${l.height}"><rect width="100%" height="100%" fill="#FFFFFF"/><rect x="${qr.x}" y="${qr.y}" width="${qr.side}" height="${qr.side}" fill="#000000"/></svg>`;
}

/** Where the code landed on the photo: the same turn, border and resize as the photo. */
async function qrExtent(
  l: Layout,
  qr: QrDrawing,
  rotation: number,
  width: number,
): Promise<QrPlacement['extent']> {
  const { data, info } = await sharp(Buffer.from(qrOnlySvg(l, qr)))
    .rotate(rotation, { background: '#FFFFFF' })
    .extend({ top: 60, bottom: 60, left: 60, right: 60, background: '#FFFFFF' })
    .png()
    .toBuffer({ resolveWithObject: true })
    .then(({ data: png }) =>
      sharp(png).resize(width).grayscale().raw().toBuffer({ resolveWithObject: true }),
    );
  let x0 = info.width;
  let y0 = info.height;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if ((data[y * info.width + x] ?? 255) < 128) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x + 1);
        y1 = Math.max(y1, y + 1);
      }
    }
  }
  return { x0, y0, x1, y1 };
}

async function photograph(
  l: Layout,
  font: string,
  random: () => number,
  hard: boolean,
): Promise<{
  photo: Buffer;
  rotation: number;
  blur: number;
  noise: number;
  quality: number;
  width: number;
  extent?: QrPlacement['extent'];
}> {
  // A hard photo is small, soft, grainy and heavily compressed, as a forwarded phone picture is.
  const rotation = Math.round((random() * 10 - 5) * 10) / 10;
  const blur = hard ? 1.6 + Math.round(random() * 8) / 10 : Math.round(random() * 14) / 10;
  const noise = hard ? 40 + Math.round(random() * 30) : Math.round(random() * 40);
  const quality = hard ? 20 + Math.floor(random() * 15) : 35 + Math.floor(random() * 56);
  const width = hard ? 650 + Math.floor(random() * 200) : 900 + Math.floor(random() * 1500);

  const table = pick(['#6B5B4B', '#8A8F94', '#3F4A3C', '#A38F72'], random);
  let image = sharp(Buffer.from(svgFor(l, font)))
    .rotate(rotation, { background: table })
    .extend({ top: 60, bottom: 60, left: 60, right: 60, background: table });
  const flat = await image.png().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = flat.info;

  const grain = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = Math.floor(random() * 255);
    grain[i * 4] = v;
    grain[i * 4 + 1] = v;
    grain[i * 4 + 2] = v;
    grain[i * 4 + 3] = noise;
  }
  image = sharp(flat.data).composite([
    { input: grain, raw: { width: w, height: h, channels: 4 }, blend: 'over' },
  ]);
  const withGrain = await image.png().toBuffer();
  let final = sharp(withGrain).resize(width);
  if (blur >= 0.3) final = final.blur(blur);
  const photo = await final.jpeg({ quality }).toBuffer();
  const extent = l.qr ? await qrExtent(l, l.qr, rotation, width) : undefined;
  return { photo, rotation, blur, noise, quality, width, ...(extent ? { extent } : {}) };
}

/** About thirty made-up document photos, the same set for the same seed. */
export async function generateDocuments(seed = 2026): Promise<SyntheticDocument[]> {
  const random = seeded(seed);
  // QR codes draw from their own sequence, so the rest of the set stays the same as before.
  const qrRandom = seeded(seed + 1);
  const plans: { kind: DocumentKind; build: () => Layout }[] = [];
  for (let i = 0; i < 12; i++)
    plans.push({ kind: 'identity_card', build: () => identityCard(random, i, qrRandom) });
  for (let i = 0; i < 4; i++)
    plans.push({ kind: 'letter', build: () => letter(random, i, qrRandom) });
  for (let i = 0; i < 4; i++) plans.push({ kind: 'passbook', build: () => passbook(random, i) });
  for (let i = 0; i < 3; i++) plans.push({ kind: 'kyc_form', build: () => kycForm(random) });
  for (let i = 0; i < 4; i++) plans.push({ kind: 'bill', build: () => bill(random, i) });
  for (let i = 0; i < 3; i++) plans.push({ kind: 'quote', build: () => quote(random) });

  const docs: SyntheticDocument[] = [];
  for (const [index, plan] of plans.entries()) {
    const layout = plan.build();
    const font = FONTS[index % FONTS.length] ?? 'Arial';
    const hard = index % 5 === 4;
    const shot = await photograph(layout, font, random, hard);
    docs.push({
      id: `doc-${String(index + 1).padStart(2, '0')}`,
      kind: plan.kind,
      hard,
      font,
      rotation: shot.rotation,
      blur: shot.blur,
      noise: shot.noise,
      jpegQuality: shot.quality,
      width: shot.width,
      layout: layout.layout,
      expected: { aadhaar: layout.aadhaar, bank: layout.bank },
      ...(layout.qr && shot.extent
        ? {
            qr: {
              modules: layout.qr.modules,
              side: layout.qr.side,
              style: layout.qr.style,
              extent: shot.extent,
            },
          }
        : {}),
      photo: shot.photo,
    });
  }
  return docs;
}
