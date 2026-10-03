/* ══════════════════════════════════════════════════════════════
   BARCODE / barcode-validation.js  (pure — no DOM, no storage)
   Normalises whatever a scanner emits into ONE canonical string, and
   classifies it. Camera scans and hardware-wedge scans both go through
   normalizeBarcode(), so lookup keys always agree with stored keys.

   Canonical rules:
   - Trim; strip control chars. Never silently alter inner content.
   - GS1 element string starting "01"+14 digits (pharma DataMatrix/GS1-128):
     the GTIN is extracted; lot/expiry are ignored for product identity.
   - Numeric GTINs must pass the mod-10 check digit.
     UPC-A (12) and GTIN-14 with leading 0 are stored as 13-digit EAN-13,
     so the same product can't be registered twice under two spellings.
   - Anything else alphanumeric (Code 128/39 internal labels) is accepted
     upper-cased, 4–48 chars of [A-Z0-9._/-] — matches the DB CHECK.
   ══════════════════════════════════════════════════════════════ */

const DB_FORMAT = /^[A-Za-z0-9._/-]{4,48}$/; // mirrors product_barcodes_barcode_format

function gtinCheckDigitOk(digits) {
  // mod-10, weights 3/1 from the right (excluding the check digit)
  let sum = 0;
  for (let i = digits.length - 2, w = 3; i >= 0; i--, w = 4 - w) sum += Number(digits[i]) * w;
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

function cleanRaw(raw) {
  if (raw === null || raw === undefined) return '';
  // eslint-disable-next-line no-control-regex
  return String(raw).replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, '').trim();
}

// Returns { ok, barcode, type, reason, gs1 }
function normalizeBarcode(raw) {
  let s = cleanRaw(raw);
  if (!s) return { ok: false, reason: 'empty' };

  // GS1 element string, with or without parentheses: (01)GTIN14... or 01GTIN14...
  let gs1 = null;
  const m = s.match(/^\(?01\)?(\d{14})(?:[\s\S]*)$/);
  if (m && (s.length > 16 || s.startsWith('(01)'))) { gs1 = s; s = m[1]; }

  if (/^\d+$/.test(s)) {
    if (![8, 12, 13, 14].includes(s.length)) return { ok: false, reason: 'bad_length' };
    if (!gtinCheckDigitOk(s)) return { ok: false, reason: 'bad_checksum' };
    if (s.length === 12) return { ok: true, barcode: '0' + s, type: 'ean13', gs1 };           // UPC-A -> EAN-13
    if (s.length === 14) {
      return s[0] === '0' ? { ok: true, barcode: s.slice(1), type: 'ean13', gs1 }              // GTIN-14 w/ leading 0
                          : { ok: true, barcode: s, type: 'gtin14', gs1 };                      // case/carton level
    }
    return { ok: true, barcode: s, type: s.length === 8 ? 'ean8' : 'ean13', gs1 };
  }

  const alnum = s.toUpperCase();
  if (!DB_FORMAT.test(alnum)) return { ok: false, reason: 'bad_characters' };
  return { ok: true, barcode: alnum, type: 'code128', gs1: null };
}

const REASON_TEXT = {
  empty: 'No barcode detected',
  bad_length: 'Barcode length is not valid (expected 8, 12, 13 or 14 digits)',
  bad_checksum: 'Barcode check digit is wrong — rescan',
  bad_characters: 'Barcode has unsupported characters or length',
};
function invalidReasonText(reason) { return REASON_TEXT[reason] || 'Invalid barcode'; }

const STATUSES = ['unverified', 'verified', 'conflict', 'disabled'];
const SCAN_TYPES = ['identify', 'count', 'recount', 'verification'];
const SCAN_RESULTS = ['matched', 'unknown', 'conflict', 'duplicate', 'disabled'];

export const BarcodeValidation = {
  normalizeBarcode, invalidReasonText, gtinCheckDigitOk,
  DB_FORMAT, STATUSES, SCAN_TYPES, SCAN_RESULTS,
};
