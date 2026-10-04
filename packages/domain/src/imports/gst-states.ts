/**
 * The two-digit GST state codes (the first two digits of every GSTIN, CBIC's list), by the names
 * the India Post directory and people's spreadsheets give the states and union territories. The
 * codes are statutory and public, not a client's choice; the PIN code import turns the directory's
 * state name into the code `pin_codes.state_code` and `customer_sites.state_code` store.
 */
const STATE_CODES: Readonly<Record<string, string>> = {
  jammuandkashmir: '01',
  himachalpradesh: '02',
  punjab: '03',
  chandigarh: '04',
  uttarakhand: '05',
  uttaranchal: '05',
  haryana: '06',
  delhi: '07',
  nctofdelhi: '07',
  rajasthan: '08',
  uttarpradesh: '09',
  bihar: '10',
  sikkim: '11',
  arunachalpradesh: '12',
  nagaland: '13',
  manipur: '14',
  mizoram: '15',
  tripura: '16',
  meghalaya: '17',
  assam: '18',
  westbengal: '19',
  jharkhand: '20',
  odisha: '21',
  orissa: '21',
  chhattisgarh: '22',
  chattisgarh: '22',
  madhyapradesh: '23',
  gujarat: '24',
  dadraandnagarhavelianddamananddiu: '26',
  dadraandnagarhaveli: '26',
  damananddiu: '26',
  maharashtra: '27',
  karnataka: '29',
  goa: '30',
  lakshadweep: '31',
  kerala: '32',
  tamilnadu: '33',
  puducherry: '34',
  pondicherry: '34',
  andamanandnicobarislands: '35',
  andamanandnicobar: '35',
  telangana: '36',
  andhrapradesh: '37',
  ladakh: '38',
};

/** A state's name as the list keys it: lower case, letters only, `&` read as `and`, no leading `the`. */
function stateKey(name: string): string {
  return name
    .toLowerCase()
    .replaceAll('&', 'and')
    .replace(/[^a-z]+/g, '')
    .replace(/^the/, '');
}

/**
 * The GST state code of a state named in a file, or of a code written as one (`8` or `08`);
 * undefined for anything else, which the preview reports as an unknown state.
 */
export function gstStateCode(value: string): string | undefined {
  const trimmed = value.trim();
  if (/^[0-9]{1,2}$/.test(trimmed)) {
    const code = trimmed.padStart(2, '0');
    return Object.values(STATE_CODES).includes(code) ? code : undefined;
  }
  return STATE_CODES[stateKey(trimmed)];
}
