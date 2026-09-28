import type { DesignCopy } from './component-gallery';

/** A4 at 96 px to the inch: 210 by 297 mm. */
const A4 = { width: 794, height: 1123 };
/** The 100 by 50 mm label at 96 px to the inch. */
const LABEL = { width: 378, height: 189 };

/**
 * One printed document shown at a reduced size: the template's own HTML in a sandboxed frame
 * (no script runs, nothing it names is fetched), drawn at full size and scaled down, so the page
 * breaks and measures are the printed ones. A frame is its own document, so the page's theme and
 * contrast never reach it: printed documents are always light (DESIGN.md §1 rule 6).
 */
function PrintFrame({
  title,
  srcDoc,
  size,
  scale,
}: {
  title: string;
  srcDoc: string;
  size: { width: number; height: number };
  scale: number;
}) {
  return (
    <figure className="flex flex-col gap-2">
      <div
        className="border-border-strong shadow-1 overflow-hidden rounded-sm border"
        style={{ width: size.width * scale, height: size.height * scale }}
      >
        <iframe
          title={title}
          srcDoc={srcDoc}
          sandbox=""
          loading="lazy"
          tabIndex={-1}
          className="origin-top-left border-0"
          style={{ width: size.width, height: size.height, transform: `scale(${String(scale)})` }}
        />
      </div>
      <figcaption className="text-text-muted text-xs">{title}</figcaption>
    </figure>
  );
}

/**
 * The print preview of the design review (DESIGN.md §6 Print templates, §10): the quotation and
 * the large QR label as the templates render them, filled in with the print spike's made-up
 * details. On screen the viewer's own font stands in for the embedded Inter of the printed file.
 */
export function PrintPreview({
  copy,
  quoteHtml,
  labelHtml,
}: {
  copy: DesignCopy;
  quoteHtml: string;
  labelHtml: string;
}) {
  return (
    <section
      aria-labelledby="design-print"
      className="theme-light bg-bg text-text border-border flex min-w-0 flex-col gap-4 rounded-xl border p-4 sm:p-6"
    >
      <div className="flex flex-col gap-1">
        <h2 id="design-print" className="text-h2 tracking-[-0.01em]">
          {copy.print}
        </h2>
        <p className="text-text-muted text-sm">{copy.printIntro}</p>
      </div>
      <div className="flex flex-wrap items-start gap-6">
        <PrintFrame title={copy.printQuote} srcDoc={quoteHtml} size={A4} scale={0.38} />
        <PrintFrame title={copy.printLabel} srcDoc={labelHtml} size={LABEL} scale={0.8} />
      </div>
    </section>
  );
}
