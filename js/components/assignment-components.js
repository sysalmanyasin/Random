import { esc } from './dom-utils.js';
import { countingProgressBarHTML } from './counting-components.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 4 — COMPONENTS / assignment-components.js
   Blueprint §Assignment Engine — pure render only.
   Manual rebalance is implemented as "move to…" selects rather
   than drag targets, since this is a phone-width chat surface —
   same underlying action (AssignmentActions.manualMoveCompany /
   manualMoveItem), just a tap-friendly control instead of a drag.
   ══════════════════════════════════════════════════════════════ */

const STATUS_BADGE = {
  assigned: 'val-grey', counting: 'val-gold',
  submitted: 'val-green', revoked: 'val-red',
};

export function auditorChip(staffMember, selected) {
  const chip = document.createElement('label');
  chip.className = 'auditor-chip' + (selected ? ' selected' : '');
  chip.innerHTML = `
    <input type="checkbox" class="custom-checkbox" data-action="toggle-auditor-select" data-auditor-id="${esc(staffMember.id)}" ${selected ? 'checked' : ''}>
    <span>${esc(staffMember.name)}</span>`;
  return chip;
}

// roundState: the current state of the round this assignment belongs to.
// Move to… selects are only shown while the round is still in 'draft' —
// once locked/counting, companies are committed and cannot be redistributed.
export function assignmentCard(assignment, allAssignments, roundState, groupByCompany) {
  const card = document.createElement('div');
  card.className = 'card assignment-card';
  const unitLabel = assignment.unit === 'company'
    ? assignment.companies.map(esc).join(', ') || '—'
    : assignment.items.length + ' item line(s) across ' + assignment.companies.length + ' company(ies)';

  const totalItems = assignment.items.length;
  const counted = Math.min(assignment.progressCount || 0, totalItems);
  const pct = totalItems > 0 ? Math.round((counted / totalItems) * 100) : 0;
  // Only meaningful once counting has actually started — an "assigned" but
  // untouched assignment showing "0 / N" reads as a stall, not useful info.
  const showProgress = assignment.status === 'counting' || assignment.status === 'submitted';

  const canMove = !roundState || roundState === 'draft';

  const moveOptions = canMove
    ? allAssignments
        .filter(a => a.id !== assignment.id && a.status !== 'revoked')
        .map(a => `<option value="${esc(a.id)}">${esc(a.auditorName)}</option>`).join('')
    : '';

  const itemMoveRow = (it) => `
        <div class="movable-row">
          <span>${esc(it.company)} · ${esc(it.name)}</span>
          ${canMove ? `<select class="settings-input move-target-select" data-change-action="move-target-selected" data-move-kind="item" data-move-value="${esc(it.itemKey)}" data-from-assignment="${esc(assignment.id)}" style="margin:0; width:auto; font-size:11px; padding:4px 6px;"><option value="">Move to…</option>${moveOptions}</select>` : ''}
        </div>`;

  let movableRows;
  if (assignment.unit === 'company') {
    movableRows = assignment.companies.map(c => `
        <div class="movable-row">
          <span>${esc(c)}</span>
          ${canMove ? `<select class="settings-input move-target-select" data-change-action="move-target-selected" data-move-kind="company" data-move-value="${esc(c)}" data-from-assignment="${esc(assignment.id)}" style="margin:0; width:auto; font-size:11px; padding:4px 6px;"><option value="">Move to…</option>${moveOptions}</select>` : ''}
        </div>`).join('');
  } else if (groupByCompany) {
    // Grouped view — one heading per company, all its items listed
    // underneath, in place of the flat 12-item-capped list.
    const byCompany = new Map();
    assignment.items.forEach(it => {
      const key = it.company || 'Unassigned';
      if (!byCompany.has(key)) byCompany.set(key, []);
      byCompany.get(key).push(it);
    });
    movableRows = [...byCompany.keys()].sort().map(companyName => {
      const items = byCompany.get(companyName);
      return `
        <div style="font-size:11px; font-weight:800; color:var(--navy); margin:8px 0 2px;">${esc(companyName)} <span style="font-weight:600; color:var(--grey);">· ${items.length} item(s)</span></div>
        ${items.map(itemMoveRow).join('')}`;
    }).join('');
  } else {
    movableRows = assignment.items.slice(0, 12).map(itemMoveRow).join('')
      + (assignment.items.length > 12 ? `<div style="font-size:11px; color:var(--grey); padding:4px 0;">+ ${assignment.items.length - 12} more item(s)</div>` : '');
  }

  card.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
      <div>
        <div style="font-weight:800; color:var(--navy); font-size:13px;">${esc(assignment.auditorName)}</div>
        <div style="font-size:11px; color:var(--grey); margin-top:2px;">${unitLabel}</div>
      </div>
      <span class="val-badge ${STATUS_BADGE[assignment.status] || 'val-grey'}">${esc(assignment.status)}</span>
    </div>
    ${showProgress ? countingProgressBarHTML({ counted, total: totalItems, pct }) : ''}
    <div style="font-size:11px; color:var(--grey); margin-bottom:6px;">Visible the moment they log in — no link to send for this.</div>
    <div class="movable-rows-wrap">${movableRows}</div>
    <div style="display:flex; gap:6px; margin-top:10px; flex-wrap:wrap;">
      ${assignment.status === 'submitted' ? `<button class="btn" style="flex:1; background:var(--light); color:var(--text);" data-action="reopen-assignment" data-assignment-id="${esc(assignment.id)}">↺ Reopen for editing</button>` : ''}
      ${assignment.status === 'counting' || assignment.status === 'assigned' ? `<button class="btn" style="flex:1; background:var(--red); color:#fff;" data-action="open-force-submit" data-assignment-id="${esc(assignment.id)}">⚠️ Force Submit</button>` : ''}
      ${assignment.status !== 'revoked' ? `<button class="btn" style="flex:1; background:var(--light); color:var(--text);" data-action="open-reassign" data-assignment-id="${esc(assignment.id)}">↪ Reassign</button>` : ''}
      <button class="btn btn-danger" style="flex:1;" data-action="revoke-assignment" data-assignment-id="${esc(assignment.id)}">Revoke</button>
    </div>
  `;
  return card;
}

// ── Reassign modal ──────────────────────────────────────────────
// One tap per staff member (no dropdown+confirm two-step) since the
// staff roster on a real audit team is short — matches the button-list
// style already used by forceSubmitModalHTML for its own binary choice.
export function reassignModalHTML(assignment, staffList, mainAuditor) {
  if (!assignment) return '';
  const candidates = (staffList || []).filter(s => s.role === 'sub').slice();
  const rows = candidates.map(s => `
      <button class="btn btn-block" style="text-align:left; background:var(--light); color:var(--navy); margin-bottom:6px;"
        data-action="confirm-reassign" data-assignment-id="${esc(assignment.id)}"
        data-new-auditor-id="${esc(s.id)}" data-new-auditor-name="${esc(s.name)}">
        ${esc(s.name)}${s.id === assignment.auditorId ? ' <span style="font-weight:400; color:var(--grey); font-size:11px;">(current — reopens for them)</span>' : ''}
      </button>`).join('');
  const selfRow = mainAuditor ? `
      <button class="btn btn-block" style="text-align:left; background:var(--light); color:var(--navy); margin-bottom:6px;"
        data-action="confirm-reassign" data-assignment-id="${esc(assignment.id)}"
        data-new-auditor-id="${esc(mainAuditor.id)}" data-new-auditor-name="${esc(mainAuditor.name)}">
        ${esc(mainAuditor.name)} <span style="font-weight:400; color:var(--grey); font-size:11px;">(yourself)</span>
      </button>` : '';
  return `
    <h3 class="modal-title" style="margin-bottom:8px;">Reassign ${esc(assignment.auditorName)}'s assignment</h3>
    <div style="font-size:12.5px; color:var(--grey); margin-bottom:12px;">
      Item list and inventory cutoff stay exactly as they are. Counts already entered are kept as a starting point for whoever picks it up next — nothing is wiped. ${esc(assignment.auditorName)} loses access the moment you pick someone else.
    </div>
    <div style="max-height:40vh; overflow:auto; margin-bottom:8px;">${rows}${selfRow || ''}</div>
    <button class="sort-btn btn-block" data-action="close-reassign">Cancel</button>`;
}

export function splitPreviewHTML(preview) {
  const isItem = preview.unit === 'item';
  const rows = preview.rows.map(r => `
    <div class="movable-row">
      <span><strong>${esc(r.staffName)}</strong><br><span style="font-size:10px; color:var(--grey);">${r.companies.map(esc).join(', ') || '— none —'}</span></span>
      <span class="val-badge val-grey">${r.itemCount} item(s)</span>
    </div>`).join('');
  const emptyWarning = preview.rows.some(r => r.itemCount === 0)
    ? `<div style="font-size:11px; color:var(--red); margin-top:8px;">⚠️ At least one staff member would get 0 items with this split — add fewer staff, or use manual rebalance after confirming.</div>`
    : '';
  const totalLabel = isItem
    ? `${preview.totalCompanies} item${preview.totalCompanies === 1 ? '' : 's'}`
    : `${preview.totalCompanies} compan${preview.totalCompanies === 1 ? 'y' : 'ies'}`;
  return `
    <div class="card-title">Preview — ${totalLabel} across ${preview.rows.length} staff member(s)</div>
    <div class="card">
      ${rows}
      ${emptyWarning}
      <div style="display:flex; gap:8px; margin-top:10px;">
        <button class="btn btn-primary" style="flex:1;" data-action="confirm-split-preview">✅ Confirm Split</button>
        <button class="btn" style="flex:1; background:var(--light); color:var(--text);" data-action="cancel-split-preview">Cancel</button>
      </div>
    </div>`;
}

export function noAssignmentsEmptyState() {
  const div = document.createElement('div');
  div.className = 'card';
  div.style.textAlign = 'center';
  div.style.padding = '24px 16px';
  div.innerHTML = `<div style="font-weight:700; color:var(--navy);">No assignments yet.</div><div style="font-size:12px; color:var(--grey); margin-top:4px;">Select staff, then auto-split or assign yourself.</div>`;
  return div;
}
