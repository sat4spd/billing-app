// Number / currency / date formatting with Hindi (Devanagari) and English numerals.

const HINDI_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];

export function toHindiDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => HINDI_DIGITS[Number(d)]);
}

export function toEnglishDigits(input: string): string {
  return input.replace(/[०-९]/g, (d) => String(HINDI_DIGITS.indexOf(d)));
}

export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Indian grouping: 3,800 / 1,25,000 ; keeps paise only when non-zero. */
export function formatAmount(value: number | string | null | undefined, opts: { decimals?: 'auto' | 0 | 2 } = {}): string {
  const n = Number(value ?? 0);
  const mode = opts.decimals ?? 'auto';
  const hasPaise = Math.abs(round2(n) - Math.trunc(round2(n))) > 0.0001;
  const fd = mode === 'auto' ? (hasPaise ? 2 : 0) : mode;
  return n.toLocaleString('en-IN', { minimumFractionDigits: fd, maximumFractionDigits: fd });
}

export type NumeralStyle = 'hindi' | 'english';

export function money(value: number | string | null | undefined, style: NumeralStyle = 'english', symbol = '₹'): string {
  const s = `${symbol}${formatAmount(value)}`;
  return style === 'hindi' ? toHindiDigits(s) : s;
}

/** "₹ ३,८०० (₹ 3,800)" — customer facing dual numerals. */
export function moneyDual(value: number | string | null | undefined, symbol = '₹'): string {
  return `${symbol} ${toHindiDigits(formatAmount(value))} (${symbol} ${formatAmount(value)})`;
}

export function qty(value: number | string, style: NumeralStyle = 'english'): string {
  const n = Number(value);
  const s = Number.isInteger(n) ? String(n) : n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
  return style === 'hindi' ? toHindiDigits(s) : s;
}

const TZ = 'Asia/Kolkata';

export function formatDate(d: string | Date, style: NumeralStyle = 'english'): string {
  const s = new Date(d).toLocaleDateString('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
  return style === 'hindi' ? toHindiDigits(s) : s;
}

export function formatTime(d: string | Date, style: NumeralStyle = 'english'): string {
  const s = new Date(d).toLocaleTimeString('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true });
  return style === 'hindi' ? toHindiDigits(s) : s;
}

export function formatDateTime(d: string | Date, style: NumeralStyle = 'english'): string {
  return `${formatDate(d, style)} ${formatTime(d, style)}`;
}

/** yyyy-mm-dd of "today" in shop timezone. */
export function todayISO(offsetDays = 0): string {
  const now = new Date(Date.now() + offsetDays * 86400000);
  return now.toLocaleDateString('en-CA', { timeZone: TZ });
}

/** Start of an IST day as a UTC ISO string, for range queries. */
export function istDayStart(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00+05:30`).toISOString();
}
/** Exclusive end (start of the next IST day). */
export function istDayEnd(isoDate: string): string {
  return new Date(new Date(`${isoDate}T00:00:00+05:30`).getTime() + 86400000).toISOString();
}

// ---- Amount in words (Indian system) — Hindi and English -------------------
const EN_ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const EN_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function en2(n: number): string {
  if (n < 20) return EN_ONES[n];
  return `${EN_TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + EN_ONES[n % 10] : ''}`;
}
function en3(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  return [h ? `${EN_ONES[h]} Hundred` : '', r ? en2(r) : ''].filter(Boolean).join(' ');
}

export function amountInWordsEn(value: number): string {
  let n = Math.floor(Math.abs(value));
  const paise = Math.round((Math.abs(value) - n) * 100);
  if (n === 0 && paise === 0) return 'Zero Rupees Only';
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${en3(crore)} Crore`);
  if (lakh) parts.push(`${en2(lakh)} Lakh`);
  if (thousand) parts.push(`${en2(thousand)} Thousand`);
  if (n) parts.push(en3(n));
  let s = `${parts.join(' ')} Rupees`;
  if (paise) s += ` and ${en2(paise)} Paise`;
  return `${s} Only`;
}

// Hindi numbers 0-99 are irregular, so they are listed explicitly.
const HI_0_99 = ('शून्य एक दो तीन चार पाँच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस ' +
  'बीस इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस तीस इकतीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस ' +
  'सैंतीस अड़तीस उनतालीस चालीस इकतालीस बयालीस तैंतालीस चवालीस पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास पचास ' +
  'इक्यावन बावन तिरपन चौवन पचपन छप्पन सत्तावन अट्ठावन उनसठ साठ इकसठ बासठ तिरसठ चौंसठ पैंसठ छियासठ सड़सठ ' +
  'अड़सठ उनहत्तर सत्तर इकहत्तर बहत्तर तिहत्तर चौहत्तर पचहत्तर छिहत्तर सतहत्तर अठहत्तर उन्यासी अस्सी इक्यासी ' +
  'बयासी तिरासी चौरासी पचासी छियासी सत्तासी अट्ठासी नवासी नब्बे इक्यानबे बानबे तिरानबे चौरानबे पंचानबे छियानबे ' +
  'सत्तानबे अट्ठानबे निन्यानबे').split(' ');

export function amountInWordsHi(value: number): string {
  let n = Math.floor(Math.abs(value));
  const paise = Math.round((Math.abs(value) - n) * 100);
  if (n === 0 && paise === 0) return 'शून्य रुपये मात्र';
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const hundred = Math.floor(n / 100); n %= 100;
  if (crore) parts.push(`${crore < 100 ? HI_0_99[crore] : amountInWordsHi(crore).replace(' रुपये मात्र', '')} करोड़`);
  if (lakh) parts.push(`${HI_0_99[lakh]} लाख`);
  if (thousand) parts.push(`${HI_0_99[thousand]} हज़ार`);
  if (hundred) parts.push(`${HI_0_99[hundred]} सौ`);
  if (n) parts.push(HI_0_99[n]);
  let s = `${parts.join(' ')} रुपये`;
  if (paise) s += ` ${HI_0_99[paise]} पैसे`;
  return `${s} मात्र`;
}
