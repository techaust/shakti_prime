/**
 * Roman-script Hinglish lines for the pronunciation check (ADR 0014, docs/08-design-system.md §11.5): each is
 * spoken by the speech vendor and rated by a listener from the Shakti team. They cover what the
 * voice agent and caller scripts say most and what synthesisers get wrong: pump and solar terms,
 * lakh and crore amounts, model codes, English words inside Hindi sentences, dates and times.
 * Spoken-channel test material only; nothing here is shown on a screen.
 */

export interface PronunciationLine {
  id: string;
  text: string;
  /** What the listener checks. */
  listenFor: string;
}

export const PRONUNCIATION_CHECKLIST: readonly PronunciationLine[] = [
  {
    id: 'greeting',
    text: 'Namaste, main Shakti Supreme se bol rahi hoon. Kya aapke paas do minute hain?',
    listenFor: 'Natural greeting; "Shakti Supreme" said as a brand, not spelt out',
  },
  {
    id: 'pump-hp',
    text: 'Aapke borewell ke liye 5 HP ka submersible pump sahi rahega.',
    listenFor: '"5 HP" as "paanch H P"; "submersible" and "borewell" in Indian English',
  },
  {
    id: 'amount-lakh',
    text: 'Poore system ki keemat 1,25,000 rupaye hai, GST mila kar.',
    listenFor:
      '"ek lakh pachchees hazaar rupaye", never "one hundred twenty-five thousand"; "GST" as letters',
  },
  {
    id: 'amount-crore',
    text: 'Is saal humne 2.5 crore ke solar project lagaye hain.',
    listenFor: '"dhaai crore" or "do point paanch crore"; "solar project" in Indian English',
  },
  {
    id: 'solar-kw',
    text: 'Aapki chhat par 3 kilowatt ka on-grid solar system lag sakta hai.',
    listenFor: '"teen kilowatt"; "on-grid" as one word',
  },
  {
    id: 'subsidy',
    text: 'PM Surya Ghar yojana mein aapko subsidy seedha bank khaate mein milegi.',
    listenFor:
      '"PM" as letters; "Surya Ghar yojana" with Hindi vowels; "subsidy" in Indian English',
  },
  {
    id: 'model-code',
    text: 'Model number SSP-75 stock mein hai, kal dispatch ho jayega.',
    listenFor: '"S S P saat-paanch" or "S S P pachhattar", consistently; "dispatch" clear',
  },
  {
    id: 'date-time',
    text: 'Engineer 14 October ko subah 11 baje site survey ke liye aayenge.',
    listenFor: '"chaudah October"; "gyaarah baje"; "site survey" in Indian English',
  },
  {
    id: 'document-number',
    text: 'Aapka order number SS slash SO slash 2026-27 slash 0042 hai.',
    listenFor: 'Letters as letters, "2026-27" as a financial year, "0042" digit by digit',
  },
  {
    id: 'depth',
    text: 'Paani 250 feet par hai, toh total head lagbhag 300 feet banega.',
    listenFor: '"dhaai sau feet" and "teen sau feet"; "total head" understood',
  },
  {
    id: 'recording-notice',
    text: 'Yeh call quality aur training ke liye record ki ja rahi hai.',
    listenFor: 'Clear and unhurried; this notice is mandatory on every call',
  },
  {
    id: 'handoff',
    text: 'Main aapko hamare sales executive se jod rahi hoon, kripya line par bane rahiye.',
    listenFor: '"sales executive" in Indian English; polite, natural pace',
  },
] as const;
