import { esc } from './dom-utils.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 4 — COMPONENTS / round-components.js
   Blueprint §Round Management — pure render only.
   ══════════════════════════════════════════════════════════════ */

const STATE_LABEL = {
  draft: 'Draft', locked: 'Locked', counting: 'Counting',
  compiled: 'Compiled', final: 'Final',
};
const STATE_BADGE = {
  draft: 'val-grey', locked: 'val-navy', counting: 'val-gold',
  compiled: 'val-green', final: 'val-green',
};

// `individualInfo` (optional): { auditorName, companies, templateName, topCompanies, totalValue }
// — passed only for rounds inside an Individual Assignments pool (see
// IndividualActions.summarizeIndividualRounds), where each round is
// one auditor's self-pick and the plain round meta alone doesn't say
// who picked what. Renders an extra strip: Auditor name, then either
// — Template name + total value (when the pick came from a saved
//   Template — the company breakdown is exactly what the template
//   name is meant to replace, so it's deliberately omitted here), or
// — the company(ies) picked + top 3 by counted value (qty × price),
//   for a direct company pick with no template to summarize it.
// `netVariance` (optional): signed rupee total across the round's
// compiled variances (Σ (countedQty - systemQty) × price) — positive
// means counted stock nets out ABOVE system, negative means BELOW.
// Only meaningful once the round has been compiled at least once, so
// callers pass `null`/`undefined` for draft/locked/counting rounds.
// `auditorProgress` (optional): { submitted, total } across the
// round's non-revoked assignments — the same "Auditor Progress" count
// the Dashboard tab shows, surfaced here so the Main Auditor doesn't
// have to leave the Rounds list to see who's submitted. Callers pass
// `null`/`undefined` for a round with no assignments yet (draft).
export function roundCard(round, isLatest, individualInfo, netVariance, auditorProgress) {
  const card = document.createElement('div');
  card.className = 'company-card';
  card.dataset.action = 'open-round';
  card.dataset.roundId = round.id;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  const label = round.roundNumber + (round.roundSuffix || '');
  const hasNetVariance = netVariance !== null && netVariance !== undefined;
  const netVarianceHTML = hasNetVariance ? `
    <div class="company-card-meta" style="margin-top:2px;">
      📉 Net value variance:
      <span class="${netVariance > 0 ? 'diff-pos' : (netVariance < 0 ? 'diff-neg' : 'diff-zero')}" style="font-weight:700;">
        ${netVariance > 0 ? '+' : ''}Rs ${Math.round(netVariance).toLocaleString()}
      </span>
    </div>` : '';
  const hasAuditorProgress = auditorProgress && auditorProgress.total > 0;
  const allSubmitted = hasAuditorProgress && auditorProgress.submitted === auditorProgress.total;
  const auditorProgressHTML = hasAuditorProgress ? `
    <div class="company-card-meta" style="margin-top:2px;">
      👥 Auditor Progress:
      <span style="font-weight:700; color:${allSubmitted ? 'var(--green-ink, #15803d)' : 'var(--navy)'};">
        ${auditorProgress.submitted}/${auditorProgress.total} submitted
      </span>
    </div>` : '';
  const individualStrip = individualInfo ? `
    <div class="round-card-individual-strip" style="margin-top:6px; padding-top:6px; border-top:1px dashed var(--border, #e2e2e2);">
      <div style="font-size:11px; color:var(--navy); font-weight:700;">👤 ${esc(individualInfo.auditorName || 'Unknown auditor')}</div>
      ${individualInfo.templateName ? `
      <div style="font-size:10.5px; color:var(--grey); margin-top:2px;">📋 Template: <strong>${esc(individualInfo.templateName)}</strong></div>
      <div style="font-size:10.5px; color:var(--grey); margin-top:2px;">💰 Total value: Rs ${Math.round(individualInfo.totalValue || 0).toLocaleString()}</div>
      ` : `
      <div style="font-size:10.5px; color:var(--grey); margin-top:2px;">
        ${individualInfo.companies && individualInfo.companies.length
          ? '🏢 ' + individualInfo.companies.map(esc).join(', ')
          : 'No company scope recorded'}
      </div>
      ${individualInfo.topCompanies && individualInfo.topCompanies.length ? `
      <div style="font-size:10.5px; color:var(--grey); margin-top:2px;">
        📊 Top by value: ${individualInfo.topCompanies.map(t => esc(t.company) + ' (Rs ' + Math.round(t.value).toLocaleString() + ')').join(' · ')}
      </div>` : ''}
      `}
    </div>` : '';
  card.innerHTML = `
    <div style="flex:1; min-width:0;">
      <div class="company-card-name">Round ${label} ${isLatest ? '(current)' : ''}</div>
      <div class="company-card-meta">Unit: ${round.unit === 'company' ? 'Company-level' : 'Company + Item'} · Created ${new Date(round.createdAt).toLocaleDateString('en-PK')}</div>
      ${netVarianceHTML}
      ${auditorProgressHTML}
      ${individualStrip}
    </div>
    <div class="company-card-badges">
      <span class="val-badge ${STATE_BADGE[round.state] || 'val-grey'}">${STATE_LABEL[round.state] || round.state}</span>
      <button type="button" class="round-card-delete-btn" data-action="delete-round" data-round-id="${round.id}" title="Delete Round ${label}" aria-label="Delete Round ${label}" style="border:none; background:none; color:var(--red-ink, #b91c1c); font-size:15px; padding:2px 4px; cursor:pointer; line-height:1;">🗑️</button>
    </div>`;
  return card;
}

export function roundStateStrip(round) {
  const order = ['draft', 'locked', 'counting', 'compiled', 'final'];
  const idx = order.indexOf(round.state);
  return `
    <div class="round-state-strip">
      ${order.map((s, i) => `<span class="round-state-dot ${i <= idx ? 'active' : ''}" title="${STATE_LABEL[s]}"></span>`).join('')}
    </div>
    <div style="text-align:center; font-size:11px; font-weight:700; color:var(--navy); margin-top:4px;">${STATE_LABEL[round.state]}</div>
  `;
}

export function noRoundsEmptyState() {
  const div = document.createElement('div');
  div.className = 'card';
  div.style.textAlign = 'center';
  div.style.padding = '30px 16px';
  div.innerHTML = `<span style="font-size:36px;">🔁</span><div style="font-weight:700; margin-top:8px; color:var(--navy);">No rounds started.</div><div style="font-size:12px; color:var(--grey); margin-top:4px;">Create Round 1 to begin counting.</div>`;
  return div;
}
