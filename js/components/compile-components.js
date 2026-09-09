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

// `opts` (optional): { canSuggest, canCorrect } — either one shows the
// same pencil icon, opening the Suggest Correction modal (see
// engagement-pages.js data-action="open-suggest-correction"). canSuggest
// is for a Deputy/Sub (goes to Main's Pending Corrections queue);
// canCorrect is for the Main Auditor themselves (same modal, but the
// page passes isMain through so the modal auto-approves on submit
// instead of queuing). Deliberately NOT restricted to items the caller
// was personally assigned — anyone with either flag may suggest/apply
// an edit on any item in the compiled round (see schema.sql,
// variance_edit_suggestions RLS).
export function varianceRowHTML(row, opts) {
  const canSuggest = !!(opts && (opts.canSuggest || opts.canCorrect));
  const delta = row.countedQty - row.systemQty;
  const cls = delta > 0 ? 'diff-pos' : (delta < 0 ? 'diff-neg' : 'diff-zero');
  const impactRs = delta * (row.price || 0);
  const sevCls = _varianceSeverityClass(impactRs);
  // correctedBy/correctedAt are set on a merged row once an approved
  // suggestion has actually been folded in by a recompile (see
  // compile-actions.js buildMergedItems) — this tag only ever appears
  // post-recompile, never the moment a suggestion is merely approved.
  const correctedTag = row.correctedBy ? `<br><span style="font-size:10px; color:var(--green-ink, #15803d); font-weight:700;">✓ corrected by ${esc(row.correctedBy)}</span>` : '';
  // opts.suggestion — the single open (pending/approved, never rejected)
  // suggestion for this itemKey, if any (see engagement-pages.js
  // _latestOpenSuggestionByItemKey). Shown directly on the item so
  // BOTH the Deputy who sent it and the Main Auditor reviewing it see
  // the same status on the same row, on any device, without opening
  // the separate Pending Corrections queue — that queue still exists
  // for Main's approve/reject actions, this is just visibility.
  const suggestion = opts && opts.suggestion;
  const suggestionTag = !suggestion ? '' : (suggestion.status === 'pending'
    ? `<br><span style="font-size:10px; color:var(--gold-ink, #b45309); font-weight:700;">⏳ Pending: ${suggestion.previousCountedQty} → ${suggestion.suggestedQty} · sent by ${esc(suggestion.suggestedByName)}</span>`
    : `<br><span style="font-size:10px; color:var(--green-ink, #15803d); font-weight:700;">✅ Approved: ${suggestion.previousCountedQty} → ${suggestion.suggestedQty} — recompile to apply</span>`);
  const suggestBtn = canSuggest
    ? `<button type="button" class="variance-suggest-btn" data-action="open-suggest-correction" data-item-key="${esc(row.itemKey)}" title="Suggest a correction" aria-label="Suggest a correction for ${esc(row.name)}">✏️</button>`
    : '';
  return `
    <tr class="${sevCls}">
      <td style="padding-left:10px;"><strong>${esc(row.name)}</strong><br><span style="font-size:10px; color:var(--grey);">${esc(row.company)} · Rs ${Math.abs(impactRs).toLocaleString()} impact</span>${correctedTag}${suggestionTag}</td>
      <td style="text-align:right;">${row.systemQty}</td>
      <td style="text-align:right;">${row.countedQty}</td>
      <td style="text-align:right; padding-right:10px;" class="${cls}">${delta > 0 ? '+' : ''}${delta}${suggestBtn}</td>
    </tr>`;
}

// ── Suggest Correction modal (Deputy/Sub, or Main Auditor) ─────
// `opts` (optional): { liveQty, isMain }.
// liveQty — the CURRENT live-inventory qty for this SKU (see
// variance-edit-actions.js liveQtyForRow), shown as a reference under
// the recount field. It's the frozen `row.systemQty` above that's
// actually compared against on submit — liveQty is informational only,
// so stock movement since the round's cutoff doesn't get silently
// mistaken for a counting error. null/undefined (no matching code in
// live inventory) simply omits the line rather than showing a
// misleading zero.
// isMain — Main Auditor filing their own correction: same modal, but
// the submit button applies it immediately (auto-approved) instead of
// queuing it for Main's own later approval. See engagement-pages.js
// 'submit-suggest-correction' + suggestVarianceEdit's autoApprove arg.
export function suggestCorrectionModalHTML(row, opts) {
  if (!row) return '';
  const liveQty = opts && opts.liveQty;
  const hasLive = liveQty !== undefined && liveQty !== null;
  const liveDiffers = hasLive && liveQty !== row.systemQty;
  const isMain = !!(opts && opts.isMain);
  const liveQtyHTML = hasLive ? `
    <div style="margin-bottom:12px;">
      <div style="font-size:10px; color:var(--grey);">Live system qty (right now)</div>
      <div style="font-weight:800; color:${liveDiffers ? 'var(--red, #b91c1c)' : 'var(--navy)'};">${liveQty}${liveDiffers ? ` <span style="font-size:10px; font-weight:600; color:var(--grey);">(system moved since this round's cutoff of ${row.systemQty})</span>` : ''}</div>
    </div>` : '';
  return `
    <h3 class="modal-title" style="margin-bottom:4px;">Suggest a correction</h3>
    <div style="font-size:12.5px; color:var(--grey); margin-bottom:12px;">${esc(row.name)} — ${esc(row.company)}</div>
    <div style="display:flex; gap:16px; margin-bottom:12px;">
      <div><div style="font-size:10px; color:var(--grey);">System</div><div style="font-weight:800; color:var(--navy);">${row.systemQty}</div></div>
      <div><div style="font-size:10px; color:var(--grey);">Current counted</div><div style="font-weight:800; color:var(--navy);">${row.countedQty}</div></div>
    </div>
    <label style="display:block; font-size:11px; font-weight:700; color:var(--navy); margin-bottom:4px;">Your recount</label>
    <input type="number" id="suggest-qty-input" class="search-input" style="width:100%; margin-bottom:10px;" value="${row.countedQty}" inputmode="decimal">
    ${liveQtyHTML}
    <label style="display:block; font-size:11px; font-weight:700; color:var(--navy); margin-bottom:4px;">Reason (recommended)</label>
    <textarea id="suggest-reason-input" class="search-input" style="width:100%; min-height:60px; margin-bottom:12px; resize:vertical;" placeholder="e.g. recounted, found 2 more on shelf B4"></textarea>
    ${isMain ? `<div style="font-size:10.5px; color:var(--grey); margin-bottom:8px;">You're Main Auditor — this applies immediately, no approval step.</div>` : ''}
    <div style="display:flex; gap:8px;">
      <button class="btn btn-primary" style="flex:1;" data-action="submit-suggest-correction" data-item-key="${esc(row.itemKey)}" data-auto-approve="${isMain ? '1' : '0'}">${isMain ? 'Apply Correction' : 'Send to Main Auditor'}</button>
      <button class="sort-btn" style="flex:1;" data-action="close-suggest-correction">Cancel</button>
    </div>`;
}

// ── Correction Sent / Applied confirmation popup ────────────────
// Shown in place of the Suggest Correction modal right after a
// successful submit — a plain toast is easy to miss, and both a
// Deputy and a Main Auditor benefit from seeing exactly what was just
// recorded (old → new qty, reason, and whether it's still awaiting
// approval or was applied immediately) before the overlay closes.
export function correctionSentModalHTML(details) {
  if (!details) return '';
  const delta = details.suggestedQty - details.previousCountedQty;
  const cls = delta > 0 ? 'diff-pos' : (delta < 0 ? 'diff-neg' : 'diff-zero');
  const statusLine = details.isMain
    ? `✅ Applied immediately — recompile the round to fold it into the report.`
    : `⏳ Sent to Main Auditor for approval.`;
  return `
    <h3 class="modal-title" style="margin-bottom:4px;">${details.isMain ? 'Correction applied' : 'Correction sent'}</h3>
    <div style="font-size:12.5px; color:var(--grey); margin-bottom:12px;">${esc(details.name)} — ${esc(details.company)}</div>
    <div style="background:var(--light); border-radius:10px; padding:10px 12px; margin-bottom:14px;">
      <div style="font-size:11px; font-weight:700; color:${details.isMain ? 'var(--green-ink, #15803d)' : 'var(--gold-ink, #b45309)'}; margin-bottom:6px;">${statusLine}</div>
      <div style="font-size:13px;"><span style="color:var(--grey);">${details.previousCountedQty} → </span><strong>${details.suggestedQty}</strong>
        <span class="${cls}" style="font-weight:800; margin-left:6px;">${delta > 0 ? '+' : ''}${delta}</span></div>
      ${details.reason ? `<div style="font-size:11.5px; color:var(--text); margin-top:6px;">"${esc(details.reason)}"</div>` : ''}
    </div>
    <button class="btn btn-primary btn-block" data-action="close-suggest-correction">Done</button>`;
}

// ── Pending Corrections queue (Main Auditor's approve/reject list) ──
// Pure render — takes the already-loaded `suggestions` array (Store.suggestions,
// filtered to this round by the caller) plus lookup data the row itself
// doesn't carry (nothing extra needed today, kept for symmetry with the
// rest of this file's pure-render functions).
// `opts` (optional): { products } — the live inventory list, used only
// to look up each suggestion's CURRENT live qty (by company+code) so
// Main Auditor can see whether stock has moved since the suggestion was
// filed, alongside the frozen previousCountedQty → suggestedQty figures
// already on the suggestion row itself. Purely a display lookup, done
// fresh each render — never stored on the suggestion.
export function suggestionQueueHTML(suggestions, opts) {
  const products = (opts && opts.products) || null;
  const pending = (suggestions || []).filter(s => s.status === 'pending');
  if (pending.length === 0) {
    return `<div style="font-size:12px; color:var(--grey); text-align:center; padding:10px;">No pending corrections.</div>`;
  }
  const rows = pending.map(s => {
    const delta = s.suggestedQty - s.previousCountedQty;
    const live = products && s.code ? products.find(p => p.company === s.company && p.code === s.code) : null;
    const liveHTML = live ? `<div style="font-size:10px; color:var(--grey);">Live system qty right now: <strong style="color:var(--navy);">${live.qty}</strong></div>` : '';
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
      ${liveHTML}
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
