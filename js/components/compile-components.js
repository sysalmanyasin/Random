import { esc } from './dom-utils.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 4 — COMPONENTS / compile-components.js
   Blueprint §Compilation Engine + §Difference Engine — pure render.
   ══════════════════════════════════════════════════════════════ */

export function submissionStatusRow(entry) {
  const div = document.createElement('div');
  div.className = 'movable-row';
  div.innerHTML = `
    <span>${esc(entry.assignment.auditorName)} (${entry.assignment.items.length} item lines)</span>
    <span class="val-badge ${entry.submitted ? 'val-green' : 'val-grey'}">${entry.submitted ? 'Submitted' : 'Pending'}</span>`;
  return div;
}

export function missingAssignmentsWarningHTML(missing) {
  return `
    <div class="card" style="border:2px solid var(--gold); background:#FFF9EC;">
      <div style="font-weight:800; color:var(--navy); font-size:13px; margin-bottom:6px;">⚠️ ${missing.length} assignment(s) haven't submitted yet</div>
      <div style="font-size:11px; color:var(--grey); margin-bottom:10px;">${missing.map(a => esc(a.auditorName)).join(', ')}</div>
      <button class="btn btn-gold btn-block" data-action="compile-with-missing" style="font-size:12px; padding:10px;">Compile Anyway (missing = uncounted)</button>
    </div>`;
}

// Financial-impact severity bands for the variance table's left border.
// Quantity direction (over/short, via diff-pos/diff-neg) tells you WHICH
// WAY something is wrong; it says nothing about HOW MUCH it matters — a
// -1 unit variance on a Rs 50,000 item and a -1 unit variance on a Rs 5
// item read identically without this. Thresholds are intentionally
// coarse (three bands) so the eye can triage a long list at a glance
// rather than needing to read every rupee figure to know where to look
// first. Tune these two numbers if a pharmacy's typical basket differs.
const VARIANCE_SEVERITY_HIGH = 5000;   // Rs — flagged red, look at these first
const VARIANCE_SEVERITY_MED  = 500;    // Rs — flagged amber
function _varianceSeverityClass(impactRs) {
  const abs = Math.abs(impactRs);
  if (abs >= VARIANCE_SEVERITY_HIGH) return 'variance-sev-high';
  if (abs >= VARIANCE_SEVERITY_MED) return 'variance-sev-med';
  return 'variance-sev-low';
}

export function varianceRowHTML(row) {
  const delta = row.countedQty - row.systemQty;
  const cls = delta > 0 ? 'diff-pos' : (delta < 0 ? 'diff-neg' : 'diff-zero');
  const impactRs = delta * (row.price || 0);
  const sevCls = _varianceSeverityClass(impactRs);
  return `
    <tr class="${sevCls}">
      <td style="padding-left:10px;"><strong>${esc(row.name)}</strong><br><span style="font-size:10px; color:var(--grey);">${esc(row.company)} · Rs ${Math.abs(impactRs).toLocaleString()} impact</span></td>
      <td style="text-align:right;">${row.systemQty}</td>
      <td style="text-align:right;">${row.countedQty}</td>
      <td style="text-align:right; padding-right:10px;" class="${cls}">${delta > 0 ? '+' : ''}${delta}</td>
    </tr>`;
}

export function compileSummaryCardHTML(compiled) {
  return `
    <div class="card">
      <div style="font-weight:800; color:var(--navy); font-size:14px; margin-bottom:4px;">Compiled ${new Date(compiled.compiledAt).toLocaleString('en-PK')}</div>
      <div style="font-size:12px; color:var(--grey);">${compiled.mergedItems.length} item lines · ${compiled.variances.length} variance(s)${compiled.compiledWithMissing ? ' · compiled with missing assignment(s)' : ''}</div>
    </div>`;
}
