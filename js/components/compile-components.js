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

// `opts` (optional): { canSuggest, canReconcile }.
// canSuggest shows a pencil icon that opens the Suggest Correction
// modal (see engagement-pages.js data-action="open-suggest-correction")
// — proposes a new COUNTED qty. canReconcile shows a separate ⚖ icon
// that opens the Reconcile Variance modal (data-action="open-reconcile")
// — proposes overriding the FROZEN system qty instead, for when a
// variance is explained by real inventory movement rather than a bad
// count (see variance-edit-actions.js suggestReconciliation /
// reconcileVarianceAsMain). Neither is restricted to items the caller
// was personally assigned — a Deputy/Sub (or Main) may act on any item
// in the compiled round (see schema.sql, variance_edit_suggestions RLS).
export function varianceRowHTML(row, opts) {
  const canSuggest = !!(opts && opts.canSuggest);
  const canReconcile = !!(opts && opts.canReconcile);
  const delta = row.countedQty - row.systemQty;
  const cls = delta > 0 ? 'diff-pos' : (delta < 0 ? 'diff-neg' : 'diff-zero');
  const impactRs = delta * (row.price || 0);
  const sevCls = _varianceSeverityClass(impactRs);
  // correctedBy/correctedAt are set on a merged row once an approved
  // suggestion has actually been folded in by a recompile (see
  // compile-actions.js buildMergedItems) — this tag only ever appears
  // post-recompile, never the moment a suggestion is merely approved.
  const correctedTag = row.correctedBy ? `<br><span style="font-size:10px; color:var(--green-ink, #15803d); font-weight:700;">✓ corrected by ${esc(row.correctedBy)}</span>` : '';
  // reconciledBy is the equivalent tag for an approved reconciliation —
  // shows the pre-reconciliation systemQty so the change is visible on
  // the row itself, not just buried in the audit log.
  const reconciledTag = row.reconciledBy ? `<br><span style="font-size:10px; color:var(--blue-ink, #1d4ed8); font-weight:700;">⚖ reconciled by ${esc(row.reconciledBy)} (was ${row.originalSystemQty})</span>` : '';
  const suggestBtn = canSuggest
    ? `<button type="button" class="variance-suggest-btn" data-action="open-suggest-correction" data-item-key="${esc(row.itemKey)}" title="Suggest a correction" aria-label="Suggest a correction for ${esc(row.name)}">✏️</button>`
    : '';
  const reconcileBtn = canReconcile
    ? `<button type="button" class="variance-suggest-btn" data-action="open-reconcile" data-item-key="${esc(row.itemKey)}" title="Reconcile variance" aria-label="Reconcile variance for ${esc(row.name)}">⚖️</button>`
    : '';
  return `
    <tr class="${sevCls}">
      <td style="padding-left:10px;"><strong>${esc(row.name)}</strong><br><span style="font-size:10px; color:var(--grey);">${esc(row.company)} · Rs ${Math.abs(impactRs).toLocaleString()} impact</span>${correctedTag}${reconciledTag}</td>
      <td style="text-align:right;">${row.systemQty}</td>
      <td style="text-align:right;">${row.countedQty}</td>
      <td style="text-align:right; padding-right:10px;" class="${cls}">${delta > 0 ? '+' : ''}${delta}${suggestBtn}${reconcileBtn}</td>
    </tr>`;
}

// ── Suggest Correction modal (Deputy/Sub) ──────────────────────
// `live` (optional): { qty, syncedAt } — the CURRENT system qty for this
// item, resolved fresh against Store.products (see engagement-pages.js
// open-suggest-correction, which runs the same fresh-inventory sync
// gate as every other audit-launch/refresh point — see
// legacy-actions.js ensureFreshInventoryForAudit) right before this
// modal opens. `row.systemQty` stays what it always was: the frozen
// qty from when the round's item snapshot was taken (compile-actions.js
// buildMergedItems) — that's still the correct number for computing
// this round's variance, so it's kept as a small secondary line
// whenever it disagrees with the live figure, rather than silently
// replaced. If the code no longer resolves against live inventory
// (e.g. discontinued) `live` is omitted and this falls back to the
// frozen figure exactly as before.
export function suggestCorrectionModalHTML(row, live) {
  if (!row) return '';
  const hasLive = live && Number.isFinite(live.qty);
  const displayQty = hasLive ? live.qty : row.systemQty;
  const staleNote = hasLive && live.qty !== row.systemQty
    ? `<div style="font-size:9.5px; color:var(--grey); margin-top:2px;">was ${row.systemQty} at round start</div>` : '';
  return `
    <h3 class="modal-title" style="margin-bottom:4px;">Suggest a correction</h3>
    <div style="font-size:12.5px; color:var(--grey); margin-bottom:12px;">${esc(row.name)} — ${esc(row.company)}</div>
    <div style="display:flex; gap:16px; margin-bottom:12px;">
      <div><div style="font-size:10px; color:var(--grey);">System${hasLive ? ' (live)' : ''}</div><div style="font-weight:800; color:var(--navy);">${displayQty}</div>${staleNote}</div>
      <div><div style="font-size:10px; color:var(--grey);">Current counted</div><div style="font-weight:800; color:var(--navy);">${row.countedQty}</div></div>
    </div>
    <label style="display:block; font-size:11px; font-weight:700; color:var(--navy); margin-bottom:4px;">Your recount</label>
    <input type="number" id="suggest-qty-input" class="search-input" style="width:100%; margin-bottom:10px;" value="${row.countedQty}" inputmode="decimal">
    <label style="display:block; font-size:11px; font-weight:700; color:var(--navy); margin-bottom:4px;">Reason (recommended)</label>
    <textarea id="suggest-reason-input" class="search-input" style="width:100%; min-height:60px; margin-bottom:12px; resize:vertical;" placeholder="e.g. recounted, found 2 more on shelf B4"></textarea>
    <div style="display:flex; gap:8px;">
      <button class="btn btn-primary" style="flex:1;" data-action="submit-suggest-correction" data-item-key="${esc(row.itemKey)}">Send to Main Auditor</button>
      <button class="sort-btn" style="flex:1;" data-action="close-suggest-correction">Cancel</button>
    </div>`;
}

// ── Reconcile Variance modal (Deputy/Sub suggest, or Main self-approve) ──
// Unlike suggestCorrectionModalHTML above (proposes a new COUNTED
// qty), this proposes overriding the round's FROZEN system qty for
// this one item with its current live figure — for when the variance
// is explained by real inventory movement since the round began (a
// transfer, a late invoice entry), not a bad count. The physical count
// is never touched here. `isMain` only changes the button label/copy:
// a Main Auditor's submit is self-approved immediately (see
// engagement-pages.js submit-reconcile-variance), a Deputy/Sub's goes
// to the pending queue like a normal correction.
export function reconcileModalHTML(row, live, isMain) {
  if (!row) return '';
  const liveQty = (live && Number.isFinite(live.qty)) ? live.qty : row.systemQty;
  const previewVariance = liveQty - row.countedQty;
  const previewCls = previewVariance > 0 ? 'diff-pos' : (previewVariance < 0 ? 'diff-neg' : 'diff-zero');
  const currentCls = row.variance > 0 ? 'diff-pos' : (row.variance < 0 ? 'diff-neg' : 'diff-zero');
  return `
    <h3 class="modal-title" style="margin-bottom:4px;">Reconcile variance</h3>
    <div style="font-size:12.5px; color:var(--grey); margin-bottom:10px;">${esc(row.name)} — ${esc(row.company)}</div>
    <div style="font-size:11px; color:var(--grey); background:var(--light-bg, #f5f6fa); border-radius:8px; padding:8px 10px; margin-bottom:12px;">This replaces this item's round-start system qty with its current live figure. Use it only when the variance is genuinely explained by inventory movement since the round began — not as a way to adjust a count.</div>
    <div style="display:flex; gap:14px; margin-bottom:10px;">
      <div><div style="font-size:10px; color:var(--grey);">Round-start system</div><div style="font-weight:800; color:var(--navy);">${row.systemQty}</div></div>
      <div><div style="font-size:10px; color:var(--grey);">Live system now</div><div style="font-weight:800; color:var(--navy);">${liveQty}</div></div>
      <div><div style="font-size:10px; color:var(--grey);">Physical count</div><div style="font-weight:800; color:var(--navy);">${row.countedQty}</div></div>
    </div>
    <div style="font-size:11.5px; color:var(--grey); margin-bottom:12px;">Variance would change from <strong class="${currentCls}">${row.variance > 0 ? '+' : ''}${row.variance}</strong> to <strong class="${previewCls}">${previewVariance > 0 ? '+' : ''}${previewVariance}</strong></div>
    <label style="display:block; font-size:11px; font-weight:700; color:var(--navy); margin-bottom:4px;">Reason (required)</label>
    <textarea id="reconcile-reason-input" class="search-input" style="width:100%; min-height:60px; margin-bottom:12px; resize:vertical;" placeholder="e.g. 3 units transferred to Branch 2 on 4 Sep, invoice #123"></textarea>
    <div style="display:flex; gap:8px;">
      <button class="btn btn-primary" style="flex:1;" data-action="submit-reconcile-variance" data-item-key="${esc(row.itemKey)}" data-live-qty="${liveQty}">${isMain ? 'Approve & Apply' : 'Send to Main Auditor'}</button>
      <button class="sort-btn" style="flex:1;" data-action="close-suggest-correction">Cancel</button>
    </div>`;
}

// ── Pending Corrections queue (Main Auditor's approve/reject list) ──
// Pure render — takes the already-loaded `suggestions` array (Store.suggestions,
// filtered to this round by the caller) plus lookup data the row itself
// doesn't carry (nothing extra needed today, kept for symmetry with the
// rest of this file's pure-render functions).
export function suggestionQueueHTML(suggestions) {
  const pending = (suggestions || []).filter(s => s.status === 'pending');
  if (pending.length === 0) {
    return `<div style="font-size:12px; color:var(--grey); text-align:center; padding:10px;">No pending corrections.</div>`;
  }
  const rows = pending.map(s => {
    const delta = s.suggestedQty - s.previousCountedQty;
    return `
    <div class="movable-row" style="align-items:flex-start; flex-direction:column; gap:6px;">
      <div style="width:100%; display:flex; justify-content:space-between; gap:8px;">
        <div>
          <strong>${esc(s.name)}</strong><br>
          <span style="font-size:10px; color:var(--grey);">${esc(s.company)} · suggested by ${esc(s.suggestedByName)}</span>
        </div>
        <div style="text-align:right; white-space:nowrap;">
          <span style="font-size:11px; color:var(--grey);">${s.previousCountedQty} → </span><strong>${s.suggestedQty}</strong>
          <div style="font-size:10px; font-weight:700;" class="${delta > 0 ? 'diff-pos' : (delta < 0 ? 'diff-neg' : 'diff-zero')}">${delta > 0 ? '+' : ''}${delta}</div>
        </div>
      </div>
      ${s.reason ? `<div style="font-size:11px; color:var(--text); background:var(--light); padding:6px 8px; border-radius:8px; width:100%;">"${esc(s.reason)}"</div>` : ''}
      <div style="display:flex; gap:8px; width:100%;">
        <button class="btn btn-primary" style="flex:1; font-size:11px; padding:8px;" data-action="approve-suggestion" data-suggestion-id="${esc(s.id)}">✅ Approve</button>
        <button class="btn btn-danger" style="flex:1; font-size:11px; padding:8px;" data-action="reject-suggestion" data-suggestion-id="${esc(s.id)}">✕ Reject</button>
      </div>
    </div>`;
  }).join('');
  return rows;
}

// Product Search result row — one product's count in one specific
// round, tappable to jump straight into that round's workspace (see
// engagement-pages.js data-action="open-round-from-search"). Reuses
// the same severity-band border as the live Variance Report table
// (varianceRowHTML above) so a big-impact historical count still
// stands out at a glance, plus a "not verified" marker since a
// product-history lookup is exactly the place someone might mistake
// an uncounted/auto-matched row for a real physical count.
export function productSearchResultRowHTML(row) {
  const cls = row.variance > 0 ? 'diff-pos' : (row.variance < 0 ? 'diff-neg' : 'diff-zero');
  const sevCls = _varianceSeverityClass(row.valueVariance);
  const verifiedNote = !row.missing ? '' : (row.autoMatched ? ' · not counted (auto-matched)' : ' · not counted');
  return `
    <div class="movable-row ${sevCls}" style="cursor:pointer; align-items:flex-start;" data-action="open-round-from-search" data-round-id="${esc(row.roundId)}" role="button" tabindex="0">
      <div style="flex:1; min-width:0;">
        <div style="font-weight:800; color:var(--navy); font-size:12px;">${esc(row.name)}</div>
        <div style="font-size:10px; color:var(--grey); margin-top:2px;">${esc(row.company)}${row.code ? ' · ' + esc(row.code) : ''} · ${esc(row.roundLabel)}${row.auditorName ? ' · ' + esc(row.auditorName) : ''}${verifiedNote}</div>
      </div>
      <div style="text-align:right; white-space:nowrap; margin-left:10px;">
        <div style="font-size:12px;"><span style="color:var(--grey);">${row.systemQty} → </span><strong>${row.countedQty}</strong></div>
        <div class="${cls}" style="font-size:11px; font-weight:800;">${row.variance > 0 ? '+' : ''}${row.variance}${row.valueVariance ? ' · Rs ' + Math.abs(row.valueVariance).toLocaleString() : ''}</div>
      </div>
    </div>`;
}

export function compileSummaryCardHTML(compiled) {
  return `
    <div class="card">
      <div style="font-weight:800; color:var(--navy); font-size:14px; margin-bottom:4px;">Compiled ${new Date(compiled.compiledAt).toLocaleString('en-PK')}</div>
      <div style="font-size:12px; color:var(--grey);">${compiled.mergedItems.length} item lines · ${compiled.variances.length} variance(s)${compiled.compiledWithMissing ? ' · compiled with missing assignment(s)' : ''}</div>
    </div>`;
}
