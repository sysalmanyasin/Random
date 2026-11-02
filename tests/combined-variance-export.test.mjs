import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Load the REAL vendored SheetJS (+style) build the app ships, and capture
// the workbook instead of touching disk.
const src = fs.readFileSync(new URL('../js/vendor/xlsx-js-style.min.js', import.meta.url), 'utf8');
const sandbox = { console, Buffer, module: undefined, require: undefined };
vm.createContext(sandbox);
vm.runInContext(src + '\n;this.XLSX = XLSX;', sandbox);
const written = [];
const XLSX = sandbox.XLSX;
XLSX.writeFile = (wb, filename) => written.push({ wb, filename });
globalThis.XLSX = XLSX;

const { Actions } = await import('../js/actions.js');

function rwc(num, suffix, variances) {
  return {
    round: { id: 'r' + num + (suffix || ''), roundNumber: num, roundSuffix: suffix || '' },
    compiled: { roundId: 'r' + num, variances, crossRoundConflicts: [] },
  };
}
const v = (code, name, sys, cnt) => ({ itemKey: code, code, name, company: 'ACME', price: 10, systemQty: sys, countedQty: cnt, auditorName: 'Ali', missing: false });
const aoa = (ws) => XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true });

test('all rounds → Summary + Combined + one sheet per round, styled', () => {
  written.length = 0;
  const data = [rwc(1, '', [v('A', 'Alpha', 5, 3), v('B', 'Beta', 2, 2)]), rwc(2, '', [v('A', 'Alpha', 5, 4)])];
  Actions.exportCombinedVarianceReportXLSX(data, { scopeLabel: 'All Rounds', engagementName: 'Oct 2026' });
  const { wb, filename } = written[0];
  assert.equal(filename, 'CombinedVarianceReport_Oct_2026.xlsx');
  assert.deepEqual([...wb.SheetNames], ['Summary', 'Combined — All Rounds', 'Round 1', 'Round 2']);

  // Combined sheet: totals + duplicate flag
  const comb = aoa(wb.Sheets['Combined — All Rounds']);
  const total = comb.find(r => r[0] === 'GRAND TOTAL');
  assert.equal(total[6], -3);
  assert.equal(total[7], -30);
  assert.equal(comb.filter(r => r[1] === 'Alpha').length, 2);

  // Per-round sheets hold only their own lines
  assert.equal(aoa(wb.Sheets['Round 1']).filter(r => r[1]).filter(r => ['Alpha', 'Beta'].includes(r[1])).length, 2);
  assert.equal(aoa(wb.Sheets['Round 2']).filter(r => r[1] === 'Alpha').length, 1);

  // Summary sheet numbers
  const sum = aoa(wb.Sheets['Summary']);
  const r1 = sum.find(r => r[0] === 'Round 1');
  assert.deepEqual([...r1.slice(1, 5)], [2, -2, -20, 1]);

  // Styling really made it into the workbook: navy bold header + autofilter + col widths
  const ws = wb.Sheets['Combined — All Rounds'];
  const hdrRef = Object.keys(ws).find(k => ws[k].v === 'Product Code');
  assert.equal(ws[hdrRef].s.fill.fgColor.rgb, '1B3A6B');
  assert.equal(ws[hdrRef].s.font.bold, true);
  assert.ok(ws['!autofilter'].ref.startsWith('A'));
  assert.equal(ws['!cols'].length, 13);

  // The file must actually serialise to a valid xlsx and read back with styles
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const back = XLSX.read(buf, { type: 'buffer', cellStyles: true });
  assert.equal(back.SheetNames.length, 4);
});

test('selected rounds → distinct filename, sheet names unique and ≤31 chars', () => {
  written.length = 0;
  const data = [rwc(3, '', [v('A', 'Alpha', 5, 3)]), rwc(7, 'A', [v('B', 'Beta', 2, 1)])];
  Actions.exportCombinedVarianceReportXLSX(data, { scopeLabel: 'Round 3, Round 7A', engagementName: 'Oct 2026' });
  assert.equal(written[0].filename, 'CombinedVarianceReport_Oct_2026_2Rounds_R3-R7A.xlsx');
  const names = written[0].wb.SheetNames;
  assert.deepEqual([...names], ['Summary', 'Combined', 'Round 3', 'Round 7A']);
  assert.ok(names.every(n => n.length <= 31));
});

test('46 rounds → 48 sheets with no name collisions', () => {
  written.length = 0;
  const data = Array.from({ length: 46 }, (_, i) => rwc(i + 1, '', [v('A', 'Alpha', 5, 3)]));
  Actions.exportCombinedVarianceReportXLSX(data, { scopeLabel: 'All Rounds', engagementName: 'Oct 2026' });
  const names = written[0].wb.SheetNames;
  assert.equal(names.length, 48);
  assert.equal(new Set(names.map(n => n.toLowerCase())).size, 48);
});
