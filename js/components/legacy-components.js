import { esc } from './dom-utils.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 4 — COMPONENTS / legacy-components.js
   Every render function from the original single-auditor app,
   moved verbatim behind this file boundary.
   ══════════════════════════════════════════════════════════════ */

export function companyCard(company, items) {
  const totalQty = items.reduce((s, m) => s + m.qty, 0);
  const totalValue = items.reduce((s, m) => s + (m.qty * m.price), 0);
  const card = document.createElement('div');
  card.className = 'company-card';
  card.dataset.action = 'start-audit-session';
  card.dataset.company = company;
  card.innerHTML = `
    <div style="flex:1; min-width:0;">
      <div class="company-card-name">${esc(company)}</div>
      <div class="company-card-meta">${items.length} SKU${items.length !== 1 ? 's' : ''} · ${totalQty.toLocaleString()} units</div>
    </div>
    <div class="company-card-badges">
      <span class="company-items-badge">${items.length} items</span>
      <span class="company-value-badge">Rs ${totalValue.toLocaleString()}</span>
    </div>`;
  return card;
}

export function varianceCellHTML(countedVal, qty, price) {
  if (countedVal === undefined || countedVal === '') return '<span class="diff-zero">—</span>';
  const delta = parseFloat(countedVal) - qty;
  if (delta === 0) return '<span class="diff-zero">0</span>';
  const rupeeDelta = delta * price;
  const sign = delta > 0 ? '+' : '';
  const cls = delta > 0 ? 'diff-pos' : 'diff-neg';
  return `<span class="${cls}">${sign}${delta}</span><div style="font-size:10px; color:var(--grey); margin-top:2px;">${sign}Rs ${Math.abs(rupeeDelta).toLocaleString()}</div>`;
}

export function auditRow(med, trackingKey, countedVal) {
  const tr = document.createElement('tr');
  const sysVal = countedVal !== undefined ? countedVal : '';
  tr.innerHTML = `
    <td style="padding-left:10px;">
      <div style="font-size:13px; font-weight:700; color:var(--navy); line-height:1.3;">${esc(med.name)}</div>
      <div style="font-size:10px; color:var(--grey); margin-top:2px;">${med.code ? esc(med.code) : 'No SKU'} · Rs ${med.price.toLocaleString()}</div>
    </td>
    <td style="text-align:right; font-weight:700; color:var(--navy); font-size:14px;">${med.qty}</td>
    <td style="text-align:right;">
      <input type="number" min="0" step="1" value="${sysVal}" placeholder="-" class="audit-count-input"
        data-item-index-token="${trackingKey}"
        data-input-action="record-count" data-keydown-action="audit-input-enter-next"
        inputmode="decimal" enterkeyhint="next">
    </td>
    <td style="text-align:right; padding-right:10px; font-weight:800;">${varianceCellHTML(sysVal, med.qty, med.price)}</td>
  `;
  return tr;
}

export function historyTimelineEntryHTML(log, brandName) {
  const sign = log.netFinancialImpact < 0 ? '-' : (log.netFinancialImpact > 0 ? '+' : '');
  const badgeCls = log.netFinancialImpact < 0 ? 'val-red' : (log.netFinancialImpact > 0 ? 'val-green' : 'val-grey');
  const dateLabel = (log.date || '') + (log.time ? ' @ ' + log.time : '');
  const safeId = esc(log.id);
  return '<div class="history-date-entry">' +
    '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">' +
      '<label style="display:flex; align-items:center; gap:6px; cursor:pointer;">' +
        '<input type="checkbox" class="custom-checkbox bulk-entry-box" data-entry-id="' + safeId + '" data-company-key="' + esc(brandName) + '" style="width:15px; height:15px; margin:0;">' +
        '<span style="font-size:11px; font-weight:700; color:var(--navy);">' + esc(dateLabel) + '</span>' +
      '</label>' +
      '<span class="val-badge ' + badgeCls + '" style="font-size:10px;">Rs ' + sign + Math.abs(log.netFinancialImpact).toLocaleString() + '</span>' +
    '</div>' +
    '<div style="font-size:11px; color:var(--grey); margin-bottom:2px;">' + esc(log.metricsLabel) + '</div>' +
    '<div style="font-size:10px; color:var(--grey); margin-bottom:6px;">By ' + esc(log.auditor) + '</div>' +
    '<div style="display:flex; gap:6px;">' +
      '<button class="btn btn-primary" style="flex:1; font-size:10px; padding:6px 8px;" data-action="reopen-history-audit" data-entry-id="' + safeId + '">👁 View / Reopen</button>' +
      '<button class="btn" style="flex:1; font-size:10px; padding:6px 8px; background:var(--green); color:var(--white);" data-action="export-history-xlsx" data-entry-id="' + safeId + '">📊 Excel</button>' +
      '<button class="btn btn-gold" style="flex:1; font-size:10px; padding:6px 8px;" data-action="print-history-pdf" data-entry-id="' + safeId + '">🖨 PDF</button>' +
    '</div>' +
  '</div>';
}

export function historyAccordionItem(brandName, companyLogs) {
  const latestLog = companyLogs[0];
  let badge = '<span class="val-badge val-grey">Pending Check</span>';
  let expanded = '<p style="color:var(--grey); font-style:italic; padding:4px 0;">Shelf run tracking unexecuted.</p>';

  if (latestLog) {
    const net = latestLog.netFinancialImpact;
    if (net < 0) badge = '<span class="val-badge val-red">Rs -' + Math.abs(net).toLocaleString() + '</span>';
    else if (net > 0) badge = '<span class="val-badge val-green">Rs +' + net.toLocaleString() + '</span>';
    else badge = '<span class="val-badge val-grey">Rs 0</span>';

    const timeline = companyLogs.map(log => historyTimelineEntryHTML(log, brandName)).join('');
    expanded = '<div style="font-weight:700; color:var(--navy); margin-bottom:8px; font-size:12px;">Audit History (' + companyLogs.length + ' record' + (companyLogs.length > 1 ? 's' : '') + '):</div>' + timeline;
  }

  const parentNode = document.createElement('div');
  parentNode.className = 'history-item';
  parentNode.innerHTML =
    '<div class="history-row-layout">' +
      '<input type="checkbox" class="custom-checkbox bulk-select-box" data-company-key="' + esc(brandName) + '">' +
      '<div class="history-header" data-action="toggle-accordion">' +
        '<div style="max-width:65%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' +
          '<span class="arrow-toggle">&#9658;</span>' +
          '<strong style="color:var(--navy); margin-left:6px; font-size:13px;">' + esc(brandName) + '</strong>' +
        '</div>' +
        '<div>' + badge + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="history-content">' + expanded + '</div>';
  return parentNode;
}

export function pdfRowHTML(m) {
  const discrepancyValue = m.counted - m.qty;
  return `
    <tr>
      <td><strong>${esc(m.name)}</strong><br><span style="font-size:9px; color:#64748B;">${m.code ? esc(m.code) : 'N/A'}</span></td>
      <td style="text-align:right;">Rs ${m.price.toLocaleString()}</td>
      <td style="text-align:right;">${m.qty}</td>
      <td style="text-align:right;">${m.counted}</td>
      <td style="text-align:right; font-weight:700; color:${discrepancyValue < 0 ? '#C0392B' : (discrepancyValue > 0 ? '#00836F' : '#64748B')};">
        ${discrepancyValue > 0 ? '+' : ''}${discrepancyValue}
      </td>
    </tr>`;
}

export function pdfSectionHTML(log, branchName) {
  let shorts = 0, overs = 0, matches = 0;
  (log.items || []).forEach(m => {
    if (m.counted === null || m.counted === undefined) return;
    const d = m.counted - m.qty;
    if (d > 0) overs++; else if (d < 0) shorts++; else matches++;
  });
  const netVal = log.netFinancialImpact;
  const sign = netVal < 0 ? '-' : '';
  const docId = 'FDPP-BT-' + Math.floor(100000 + Math.random() * 900000);
  const rowsHtml = (log.items || []).filter(m => m.counted !== null && m.counted !== undefined).map(pdfRowHTML).join('');

  return `
  <div class="pdf-page-section">
    <div class="pdf-meta-box">
      <div>
        <div class="pdf-brand-title">Fazal Din's Pharma Plus</div>
        <div style="font-size:13px; font-weight:700; color:#475569; margin-top:2px;">Pharmacy Inventory Audit</div>
        <div style="font-size:12px; color:#64748B; margin-top:1px;">Branch Terminal: ${esc(branchName)}</div>
      </div>
      <div style="text-align:right; font-size:12px; color:#475569; line-height:1.5;">
        <div><strong>Document ID:</strong> ${docId}</div>
        <div><strong>Execution Date:</strong> ${esc(log.date || '')}</div>
        <div><strong>Execution Time:</strong> ${esc(log.time || '')}</div>
      </div>
    </div>
    <div style="margin-bottom:20px; font-size:14px; line-height:1.6;">
      <div><strong>Company:</strong> <span style="font-weight:700; color:#0F1F3D;">${esc(log.company)}</span></div>
      <div><strong>Random done by Sales Staff / Pharmacist:</strong> <span style="font-weight:700;">${esc(log.auditor || '')}</span></div>
    </div>
    <div class="pdf-summary-grid">
      <div class="pdf-stat-card" style="border-top: 4px solid var(--red);"><div class="pdf-stat-val" style="color:var(--red);">${shorts}</div><div class="pdf-stat-lbl">Shortage SKUs</div></div>
      <div class="pdf-stat-card" style="border-top: 4px solid var(--green);"><div class="pdf-stat-val" style="color:var(--green);">${overs}</div><div class="pdf-stat-lbl">Surplus SKUs</div></div>
      <div class="pdf-stat-card" style="border-top: 4px solid var(--grey);"><div class="pdf-stat-val">${matches}</div><div class="pdf-stat-lbl">Matched SKUs</div></div>
      <div class="pdf-stat-card" style="border-top: 4px solid var(--gold);"><div class="pdf-stat-val" style="color:var(--navy);">Rs ${sign}${Math.abs(netVal).toLocaleString()}</div><div class="pdf-stat-lbl">Net Financial Delta</div></div>
    </div>
    <table class="pdf-table">
      <thead><tr>
        <th style="width:50%;">Medicine Item Designation</th>
        <th style="text-align:right; width:12%;">Unit Cost</th>
        <th style="text-align:right; width:12%;">System Qty</th>
        <th style="text-align:right; width:12%;">Physical Count</th>
        <th style="text-align:right; width:14%;">Variance Delta</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>`;
}
