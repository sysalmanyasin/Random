import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal SheetJS stand-in: records what would be written to disk.
const written = [];
globalThis.XLSX = {
  utils: {
    book_new: () => ({ sheets: [] }),
    aoa_to_sheet: (rows) => ({ rows }),
    book_append_sheet: (wb, ws, name) => wb.sheets.push({ name, ws }),
  },
  writeFile: (wb, filename) => written.push({ wb, filename }),
};

const { Actions } = await import('../js/actions.js');

function rwc(num, suffix, variances) {
  return {
    round: { id: 'r' + num + (suffix || ''), roundNumber: num, roundSuffix: suffix || '' },
    compiled: { roundId: 'r' + num, variances, crossRoundConflicts: [] },
  };
}
const v = (code, name, sys, cnt) => ({ itemKey: code, code, name, company: 'ACME', price: 10, systemQty: sys, countedQty: cnt, auditorName: 'Ali', missing: false });

test('all rounds → single sheet, grand total, duplicate flag, plain filename', () => {
  written.length = 0;
  const data = [rwc(1, '', [v('A', 'Alpha', 5, 3), v('B', 'Beta', 2, 2)]), rwc(2, '', [v('A', 'Alpha', 5, 4)])];
  Actions.exportCombinedVarianceReportXLSX(data, { scopeLabel: 'All Rounds', engagementName: 'Oct 2026' });
  assert.equal(written.length, 1);
  assert.equal(written[0].filename, 'CombinedVarianceReport_Oct_2026.xlsx');
  const sheet = written[0].wb.sheets[0];
  assert.equal(sheet.name, 'Combined Variance — All Rounds');
  assert.equal(sheet.ws['!cols'].length, 13);
  const rows = sheet.ws.rows;
  const total = rows.find(r => r[0] === 'GRAND TOTAL');
  assert.equal(total[6], -2 + 0 + -1);          // qty variance
  assert.equal(total[7], -30);                   // value variance
  const alphaRows = rows.filter(r => r[1] === 'Alpha');
  assert.equal(alphaRows.length, 2);
  assert.ok(alphaRows.every(r => r[9] === 'Yes')); // duplicate flag
});

test('selected rounds → distinct filename and sheet name', () => {
  written.length = 0;
  const data = [rwc(3, '', [v('A', 'Alpha', 5, 3)]), rwc(7, '', [v('B', 'Beta', 2, 1)])];
  Actions.exportCombinedVarianceReportXLSX(data, { scopeLabel: 'Round 3, Round 7', engagementName: 'Oct 2026' });
  assert.equal(written[0].filename, 'CombinedVarianceReport_Oct_2026_2Rounds_R3-R7.xlsx');
  assert.equal(written[0].wb.sheets[0].name, 'Combined Variance');
});
