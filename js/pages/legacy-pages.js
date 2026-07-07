import { Store } from '../store.js';
import { Actions, Bus } from '../actions.js';
import { Components } from '../components.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 5 — PAGES / legacy-pages.js
   Every render function + Bus subscription from the original
   single-auditor app's Pages module, moved verbatim. The one
   change: the giant click/input/change switch statements are now
   handler *maps* returned from initLegacyPages(), so the shared
   event-delegation.js module (Floor 5) can merge them with the
   new pages' maps and still attach only one listener per event
   type to #app, exactly like before.
   ══════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);

function toast(message, kind = 'success') { Bus.emit('toast', { msg: message, kind }); }

// ── Navigation (shared — every page module calls this to switch tabs) ──
export function executeViewNavigation(viewIdentifierToken) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const pageEl = $('page-' + viewIdentifierToken);
  if (pageEl) pageEl.classList.add('active');
  const tabNode = $('tab-' + viewIdentifierToken);
  if (tabNode) tabNode.classList.add('active');

  if (viewIdentifierToken === 'audit') {
    const { products, activeCompany } = Store.getState();
    const populated = products.length > 0;
    $('empty-state-fallback').style.display = populated ? 'none' : 'block';
    $('audit-configuration-wrapper').style.display = (populated && !activeCompany) ? 'block' : 'none';
    $('action-header-sync-btn').style.display = activeCompany ? 'block' : 'none';
    if (populated && !activeCompany) renderCompanyList();
  } else {
    $('action-header-sync-btn').style.display = 'none';
  }
  Bus.emit('view:activated', viewIdentifierToken);
}

// ── Font scale widget ──
function applyFontScaleAdjustment(scaleValue, buttonElement) {
  const zoomMap = { '100%': 1, '112%': 1.12, '125%': 1.25 };
  $('app').style.zoom = zoomMap[scaleValue] || 1;
  document.querySelectorAll('.font-btn').forEach(btn => btn.classList.remove('active'));
  buttonElement.classList.add('active');
}

// ── Hardware share (peer-to-peer JSON handoff) ──
function invokeNativeHardwareShare() {
  const { activeCompany, counts, activeItems } = Store.getState();
  if (!activeCompany) { toast('No active data map selected', 'error'); return; }
  const packagePayload = {
    syncIdentityToken: 'FAZAL_DIN_CORE_SYNC', company: activeCompany,
    counts, timestamp: Date.now(), referenceProducts: activeItems
  };
  const serializedString = JSON.stringify(packagePayload, null, 2);
  const dataBlob = new Blob([serializedString], { type: 'application/json' });
  const sharingFile = new File([dataBlob], `AUDIT_${activeCompany.replace(/\s+/g, '_')}.json`, { type: 'application/json' });

  if (navigator.canShare && navigator.canShare({ files: [sharingFile] })) {
    navigator.share({ files: [sharingFile], title: `Fazal Din Stock Sync — ${activeCompany}`, text: `Progress tracking manifest for ${activeCompany}.` })
      .then(() => toast('Share terminal active!'))
      .catch(() => fallbackDownloadMechanic(dataBlob, activeCompany));
  } else {
    fallbackDownloadMechanic(dataBlob, activeCompany);
  }
}
function fallbackDownloadMechanic(blobData, activeCompany) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blobData);
  a.download = `SYNC-PACK-${activeCompany.replace(/\s+/g, '_')}.json`;
  a.click();
  toast('Export pack downloaded locally!');
}

function ingestSharedHardwarePackage(inputElement) {
  const file = inputElement.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const externalObject = JSON.parse(e.target.result);
      Actions.ingestSharedHardwarePackage(externalObject);
    } catch (err) {
      toast('Parsing engine crashed on data read', 'error');
    }
  };
  reader.readAsText(file);
  inputElement.value = '';
}

// ── Import inventory (CSV / Dropbox) ──
function handleMasterCSVFile(element) {
  const file = element.files[0];
  if (!file) return;
  Actions.importCSVFile(file).catch(() => toast('File interpretation aborted', 'error'));
  element.value = '';
}
function fetchInventoryFromDropbox() { Actions.importInventoryFromDropbox(false); }

Bus.on('products:changed', () => {
  const { products } = Store.getState();
  $('file-status-report').style.display = 'block';
  $('file-status-report').innerHTML = `✅ Dataset Storage Online: ${products.length.toLocaleString()} Operational Items`
    + ` <button data-action="navigate" data-view="audit" style="margin-left:10px; background:var(--navy); color:white; border:none; border-radius:20px; padding:5px 12px; font-size:12px; font-weight:700; cursor:pointer;">→ Start Auditing</button>`;
  renderCompanyList();
  renderHistoryPage();
});

Bus.on('branding:changed', ({ branchName }) => {
  const headerEl = $('header-branch-label');
  const pdfEl = $('pdf-branch-label');
  const settingsInput = $('settings-branch-name');
  if (headerEl) headerEl.textContent = branchName;
  if (pdfEl) pdfEl.textContent = branchName;
  if (settingsInput) settingsInput.value = branchName;
});

Bus.on('nav:goto', (page) => executeViewNavigation(page));

Bus.on('dbxInventoryFetch:start', () => {
  $('dbx-fetch-btn').disabled = true;
  $('dbx-fetch-status').textContent = 'Connecting to Dropbox…';
  $('dbx-fetch-status').style.color = 'var(--grey)';
  const bg = $('dbx-bar-bg'); if (bg) bg.style.display = 'block';
  const fill = $('dbx-bar-fill'); if (fill) fill.style.width = '50%';
});
Bus.on('dbxInventoryFetch:success', ({ count, fetchedAt }) => {
  $('dbx-fetch-btn').disabled = false;
  $('dbx-fetch-status').textContent = '✓ ' + count.toLocaleString() + ' products loaded';
  $('dbx-fetch-status').style.color = 'var(--green)';
  const fill = $('dbx-bar-fill'); if (fill) { fill.style.width = '100%'; fill.style.background = 'var(--green)'; }
  updateLastFetchedLabel(fetchedAt);
  setTimeout(() => { const bg = $('dbx-bar-bg'); if (bg) bg.style.display = 'none'; }, 1800);
});
Bus.on('dbxInventoryFetch:error', ({ msg }) => {
  $('dbx-fetch-btn').disabled = false;
  const bg = $('dbx-bar-bg'); if (bg) bg.style.display = 'none';
  const isMissing = msg.includes('not_found') || msg.includes('409') || msg.includes('404');
  $('dbx-fetch-status').textContent = isMissing ? '✗ No inventory on Dropbox yet — run POS-SYNC first' : '✗ ' + msg;
  $('dbx-fetch-status').style.color = 'var(--red)';
});
Bus.on('dbxInventoryFetch:lastKnown', ({ fetchedAt }) => updateLastFetchedLabel(fetchedAt));
function updateLastFetchedLabel(ts) {
  const el = $('dbx-last-fetched');
  const lbl = $('dbx-last-fetched-time');
  if (!el || !lbl) return;
  const d = new Date(ts);
  lbl.textContent = d.toLocaleDateString('en-PK', { day: '2-digit', month: 'short' }) + ' @ ' + d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  el.style.display = 'block';
}
Bus.on('inventoryHub:changed', updateInventorySyncHubVisibility);
Bus.on('settings:dropboxStatusChanged', updateInventorySyncHubVisibility);
function updateInventorySyncHubVisibility() {
  const linked = !!(Actions.getDropboxToken() && Store.getState().dbxClient);
  const notEl = $('inv-not-linked');
  const yesEl = $('inv-linked');
  if (notEl) notEl.style.display = linked ? 'none' : 'block';
  if (yesEl) yesEl.style.display = linked ? 'block' : 'none';
}

// ── Company list (Verify Stock tab) ──
function renderCompanyList() {
  const container = $('company-cards-list');
  if (!container) return;
  const { products, companySortAscending } = Store.getState();
  const query = ($('company-search-input')?.value || '').toLowerCase().trim();
  let companies = [...new Set(products.map(m => m.company))];
  if (query) companies = companies.filter(c => c.toLowerCase().includes(query));
  companies.sort((a, b) => companySortAscending ? a.localeCompare(b) : b.localeCompare(a));

  if (companies.length === 0) {
    container.innerHTML = '<div style="text-align:center; color:var(--grey); padding:30px 0; font-size:13px; font-style:italic;">No companies found.</div>';
    return;
  }
  container.innerHTML = '';
  companies.forEach(company => {
    const items = products.filter(m => m.company === company);
    container.appendChild(Components.companyCard(company, items));
  });

  const selectionMenu = $('manufacturer-dropdown-selector');
  if (selectionMenu) {
    const uniqueCompanies = [...new Set(products.map(m => m.company))].sort();
    selectionMenu.innerHTML = '<option value="">— Select Manufacturer Brand —</option>';
    uniqueCompanies.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      selectionMenu.appendChild(opt);
    });
  }
}
function toggleCompanySortOrder() {
  Actions.toggleCompanySortOrder();
  const lbl = $('company-sort-label');
  if (lbl) lbl.textContent = Store.getState().companySortAscending ? 'A-Z' : 'Z-A';
  renderCompanyList();
}
Bus.on('companyList:sortChanged', renderCompanyList);

// ── Audit workspace ──
Bus.on('audit:sessionStarted', ({ company, reopenedLabel }) => {
  $('empty-state-fallback').style.display = 'none';
  $('audit-configuration-wrapper').style.display = 'none';
  $('audit-workspace-area').style.display = 'block';
  $('audit-metrics-bar').style.display = 'block';
  $('action-header-sync-btn').style.display = 'block';
  $('label-active-company').textContent = reopenedLabel || company;
  $('shelf-search-input').value = '';
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('filter-btn-active'));
  const allBtn = $('filter-btn-all');
  if (allBtn) allBtn.classList.add('filter-btn-active');
  executeViewNavigation('audit');
  renderAuditTableBody();
  calculateRuntimeFinancialMetrics();
});

Bus.on('audit:sessionEnded', () => {
  $('audit-workspace-area').style.display = 'none';
  $('audit-metrics-bar').style.display = 'none';
  $('action-header-sync-btn').style.display = 'none';
  $('audit-configuration-wrapper').style.display = 'block';
  const sel = $('manufacturer-dropdown-selector'); if (sel) sel.value = '';
  $('shelf-search-input').value = '';
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('filter-btn-active'));
  const allBtn = $('filter-btn-all');
  if (allBtn) allBtn.classList.add('filter-btn-active');
  executeViewNavigation('audit');
});

function toggleRuntimeSortOrder() {
  Actions.toggleSortOrder();
  $('sort-order-label').textContent = Store.getState().sortAscending ? 'A-Z' : 'Z-A';
  renderAuditTableBody();
}
Bus.on('audit:sortChanged', () => {
  $('sort-order-label').textContent = Store.getState().sortAscending ? 'A-Z' : 'Z-A';
  renderAuditTableBody();
});

function setAuditFilter(mode) {
  Actions.setAuditFilter(mode);
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('filter-btn-active'));
  const btn = $('filter-btn-' + mode);
  if (btn) btn.classList.add('filter-btn-active');
}
Bus.on('audit:filterChanged', renderAuditTableBody);
Bus.on('audit:bulkMarked', () => { renderAuditTableBody(); calculateRuntimeFinancialMetrics(); });

export function handleAuditInputKeydown(event, inputEl) {
  if (event.key === 'Enter') {
    event.preventDefault();
    const allInputs = Array.from(document.querySelectorAll('#table-body-runtime-rows input[type="number"]'));
    const idx = allInputs.indexOf(inputEl);
    if (idx >= 0 && idx < allInputs.length - 1) { allInputs[idx + 1].focus(); allInputs[idx + 1].select(); }
  }
}
export function highlightAuditRow(inputEl) {
  document.querySelectorAll('.audit-row-focused').forEach(r => r.classList.remove('audit-row-focused'));
  const row = inputEl.closest('tr');
  if (row) { row.classList.add('audit-row-focused'); row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}
export function unhighlightAuditRow(inputEl) {
  const row = inputEl.closest('tr');
  if (row) row.classList.remove('audit-row-focused');
}

function processKeyboardInputRegistration(inputFieldNode) {
  const executionIndex = parseInt(inputFieldNode.dataset.itemIndexToken);
  const clearTextPayload = inputFieldNode.value.trim();
  Actions.recordCount(executionIndex, clearTextPayload);

  const newVal = Store.getState().counts[executionIndex];
  if (clearTextPayload !== '' && newVal !== undefined && String(newVal) !== clearTextPayload) {
    inputFieldNode.value = newVal;
  }

  const { activeItems, counts } = Store.getState();
  const med = activeItems[executionIndex];
  const varianceColumnCell = inputFieldNode.parentElement.nextElementSibling;
  varianceColumnCell.innerHTML = Components.varianceCellHTML(counts[executionIndex], med.qty, med.price);

  calculateRuntimeFinancialMetrics();
}

function renderAuditTableBody() {
  const { activeItems, counts, sortAscending, auditFilterMode } = Store.getState();
  const searchToken = $('shelf-search-input').value.toLowerCase().trim();
  const outputTableNode = $('table-body-runtime-rows');
  outputTableNode.innerHTML = '';

  let mapping = activeItems.map((product, innerIndexValue) => ({ product, innerIndexValue }));

  if (searchToken) {
    mapping = mapping.filter(w => w.product.name.toLowerCase().includes(searchToken) || (w.product.code && w.product.code.toLowerCase().includes(searchToken)));
  }
  if (auditFilterMode !== 'all') {
    mapping = mapping.filter(w => {
      const counted = counts[w.innerIndexValue];
      if (auditFilterMode === 'unverified') return counted === undefined;
      if (counted === undefined) return false;
      const delta = counted - w.product.qty;
      if (auditFilterMode === 'shorts') return delta < 0;
      if (auditFilterMode === 'overs') return delta > 0;
      return true;
    });
  }
  mapping.sort((a, b) => sortAscending ? a.product.name.localeCompare(b.product.name) : b.product.name.localeCompare(a.product.name));

  if (mapping.length === 0) {
    outputTableNode.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--grey); padding:24px; font-weight:600;">No matching items found.</td></tr>`;
    return;
  }
  mapping.forEach(node => {
    outputTableNode.appendChild(Components.auditRow(node.product, node.innerIndexValue, counts[node.innerIndexValue]));
  });
}

function calculateRuntimeFinancialMetrics() {
  const { activeItems, counts } = Store.getState();
  let shortCount = 0, overCount = 0, matchingCount = 0, remainingCount = 0, net = 0, rsShort = 0, rsOver = 0;
  activeItems.forEach((med, i) => {
    const v = counts[i];
    if (v === undefined) { remainingCount++; return; }
    const delta = v - med.qty;
    net += delta * med.price;
    if (delta > 0) { overCount++; rsOver += delta * med.price; }
    else if (delta < 0) { shortCount++; rsShort += Math.abs(delta * med.price); }
    else matchingCount++;
  });

  $('metric-short').textContent = shortCount;
  $('metric-over').textContent = overCount;
  $('metric-match').textContent = matchingCount;
  $('metric-rem').textContent = remainingCount;
  $('metric-short-rs').textContent = rsShort > 0 ? `Rs ${rsShort.toLocaleString()}` : '';
  $('metric-over-rs').textContent = rsOver > 0 ? `Rs ${rsOver.toLocaleString()}` : '';

  const badge = $('live-net-impact-badge');
  const prefix = net < 0 ? '-' : '';
  badge.textContent = `Net Impact: Rs ${prefix}${Math.abs(net).toLocaleString()}`;
  badge.className = 'val-badge ' + (net < 0 ? 'val-red' : (net > 0 ? 'val-green' : 'val-grey'));

  const totalItems = activeItems.length;
  const countedItems = totalItems - remainingCount;
  const pct = totalItems > 0 ? Math.round((countedItems / totalItems) * 100) : 0;
  $('progress-label').textContent = `${countedItems} / ${totalItems} counted (${pct}%)`;
  $('progress-fill').style.width = pct + '%';
}

// ── Sign-off / export workflow ──
function openExportConfigOverlay() { $('export-modal-overlay').style.display = 'flex'; }
function closeExportConfigOverlay() { $('export-modal-overlay').style.display = 'none'; }

function guardedSignoff(channelId) {
  const { activeItems, counts } = Store.getState();
  const remaining = activeItems.filter((_, i) => counts[i] === undefined).length;
  if (remaining > 0) {
    if (!confirm(`⚠️ ${remaining} item${remaining > 1 ? 's' : ''} still unverified.\n\nProceed with partial audit anyway?`)) return;
  }
  processFinalSignoffWorkflow(channelId);
}

function processFinalSignoffWorkflow(channelId) {
  const auditorName = (prompt('Staff Name (for this record):', '') || '').trim() || 'Duty Pharmacist';
  const isolate = $('checkbox-variance-isolation').checked;
  closeExportConfigOverlay();
  Actions.signOffAudit(channelId, auditorName, isolate);
}

Bus.on('audit:signedOff', ({ entry, channelId, isolateDiscrepanciesOnly }) => {
  if (channelId === 'save') {
    toast('Saved to History — ' + entry.company);
    postAuditWorkflowAutoProgression(entry.company);
    return;
  }
  if (channelId === 'pdf') {
    renderPrintableReport(entry, isolateDiscrepanciesOnly);
    window.print();
    postAuditWorkflowAutoProgression(entry.company);
  } else if (channelId === 'whatsapp') {
    const signSymbol = entry.netFinancialImpact < 0 ? '-' : '';
    let msg = `*Fazal Din's Pharma Plus (${Actions.getBranchName()})*\n*Stock Verification Statement Summary*\n\n*🏢 Brand Domain:* ${entry.company}\n*👤 Authorized By:* ${entry.auditor}\n*🕒 Time execution:* ${entry.date} @ ${entry.time}\n*💰 Balance Shift evaluation:* Rs ${signSymbol}${Math.abs(entry.netFinancialImpact).toLocaleString()}\n*📈 Status Metrics:* ${entry.metricsLabel}\n─────────────────────────\n`;
    (entry.items || []).forEach(m => {
      if (m.counted === null || m.counted === undefined) return;
      const variation = m.counted - m.qty;
      if (isolateDiscrepanciesOnly && variation === 0) return;
      const sign = variation > 0 ? '+' : '';
      msg += `• *${m.name}*\n  Sys Val: ${m.qty} | Verified Count: ${m.counted} [Variance Delta: ${sign}${variation}]\n`;
    });
    shareAuditPDFToWhatsApp(entry, isolateDiscrepanciesOnly, msg);
    postAuditWorkflowAutoProgression(entry.company);
  }
});

function renderPrintableReport(entry, isolateDiscrepanciesOnly) {
  let shorts = 0, overs = 0, matches = 0;
  (entry.items || []).forEach(m => {
    if (m.counted === null || m.counted === undefined) return;
    const d = m.counted - m.qty;
    if (d > 0) overs++; else if (d < 0) shorts++; else matches++;
  });

  $('pdf-doc-id').textContent = 'FDPP-BT-' + Math.floor(100000 + Math.random() * 900000);
  $('pdf-branch-label').textContent = Actions.getBranchName();
  $('pdf-timestamp-date').textContent = entry.date;
  $('pdf-timestamp-time').textContent = entry.time;
  $('pdf-target-company').textContent = entry.company;
  $('pdf-signoff-pharmacist').textContent = entry.auditor;
  $('pdf-stat-short').textContent = shorts;
  $('pdf-stat-over').textContent = overs;
  $('pdf-stat-match').textContent = matches;

  const sign = entry.netFinancialImpact < 0 ? '-' : '';
  $('pdf-stat-impact').textContent = `Rs ${sign}${Math.abs(entry.netFinancialImpact).toLocaleString()}`;

  const injector = $('pdf-table-body-injector');
  injector.innerHTML = '';
  (entry.items || []).forEach(m => {
    if (m.counted === null || m.counted === undefined) return;
    const d = m.counted - m.qty;
    if (isolateDiscrepanciesOnly && d === 0) return;
    const tr = document.createElement('tr');
    tr.innerHTML = Components.pdfRowHTML(m).replace(/<\/?tr>/g, '');
    injector.appendChild(tr);
  });
}

let _originalReportCanvasHTML = null;
function printSelectedAuditsCombinedPDF() {
  const entryBoxes = document.querySelectorAll('.bulk-entry-box:checked');
  if (entryBoxes.length === 0) { toast('Select audit records first (tick the checkboxes inside each company)', 'error'); return; }
  const { history } = Store.getState();
  const selectedLogs = [];
  entryBoxes.forEach(box => {
    const log = history.find(l => l.id === box.dataset.entryId);
    if (log && log.items && log.items.length > 0) selectedLogs.push(log);
  });
  if (selectedLogs.length === 0) { toast('No item-level data available for selected records', 'error'); return; }

  const canvas = $('printable-report-canvas');
  if (_originalReportCanvasHTML === null) _originalReportCanvasHTML = canvas.innerHTML;
  canvas.innerHTML = selectedLogs.map(log => Components.pdfSectionHTML(log, Actions.getBranchName())).join('');
  window.print();
  setTimeout(() => { canvas.innerHTML = _originalReportCanvasHTML; }, 500);
}

async function shareAuditPDFToWhatsApp(entry, isolateDiscrepanciesOnly, textMessage) {
  renderPrintableReport(entry, isolateDiscrepanciesOnly);
  if (navigator.canShare && navigator.share) {
    try {
      const reportHtml = $('printable-report-canvas').outerHTML;
      const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Audit Report</title></head><body>${reportHtml}</body></html>`;
      const blob = new Blob([fullHtml], { type: 'text/html' });
      const file = new File([blob], `Audit_${entry.company.replace(/\s+/g, '_')}_${entry.date.replace(/\s+/g, '_')}.html`, { type: 'text/html' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Audit Report', text: textMessage });
        return;
      }
    } catch (err) { /* fall through to text share */ }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(textMessage)}`, '_blank');
  toast('Tip: use Print PDF then share the saved PDF file for an attachment.');
}

function postAuditWorkflowAutoProgression(justCompletedCompany) {
  const selectElement = $('manufacturer-dropdown-selector');
  const validArrayKeys = Array.from(selectElement.options).map(o => o.value).filter(Boolean);
  const positionMatchIndex = validArrayKeys.indexOf(justCompletedCompany) + 1;

  setTimeout(() => {
    if (positionMatchIndex < validArrayKeys.length) {
      const next = validArrayKeys[positionMatchIndex];
      if (confirm(`Audit complete for ${justCompletedCompany}.\n\nAdvance to next manufacturer automatically?\n👉 Next: "${next}"`)) {
        Actions.startAuditSession(next);
      } else {
        Actions.abandonActiveSession();
      }
    } else {
      alert('🏁 Sequence complete! All stored manufacturer profiles verified.');
      Actions.abandonActiveSession();
    }
  }, 1000);
}

// ── History page ──
function renderHistoryPage() {
  const targetOutputDiv = $('history-accordion-container');
  if (!targetOutputDiv) return;
  const { history, products } = Store.getState();

  const companiesFromHistory = [...new Set((history || []).map(l => l.company))].sort();
  const companiesFromProducts = [...new Set(products.map(m => m.company))].sort();
  const allBrands = [...new Set([...companiesFromHistory, ...companiesFromProducts])].sort();

  if (allBrands.length === 0) {
    targetOutputDiv.innerHTML = '<span style="color:var(--grey); font-style:italic; padding:10px; display:block;">No audit history yet.</span>';
    return;
  }

  const searchToken = ($('history-search-input')?.value || '').toLowerCase().trim();
  const fromEl = $('history-filter-from');
  const toEl = $('history-filter-to');
  const fromVal = fromEl && fromEl.value ? new Date(fromEl.value + 'T00:00:00').getTime() : null;
  const toVal = toEl && toEl.value ? new Date(toEl.value + 'T23:59:59').getTime() : null;

  const filteredLogs = history.filter(l => {
    const ts = l.timestamp || 0;
    if (fromVal !== null && ts < fromVal) return false;
    if (toVal !== null && ts > toVal) return false;
    return true;
  });

  const filteredBrands = searchToken ? allBrands.filter(b => b.toLowerCase().includes(searchToken)) : allBrands;
  targetOutputDiv.innerHTML = '';
  if (filteredBrands.length === 0) {
    targetOutputDiv.innerHTML = '<span style="color:var(--grey); font-style:italic; padding:10px; display:block;">No results match your search.</span>';
    return;
  }

  filteredBrands.forEach(brandName => {
    const companyLogs = filteredLogs.filter(l => l.company === brandName).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    targetOutputDiv.appendChild(Components.historyAccordionItem(brandName, companyLogs));
  });
}
Bus.on('history:changed', renderHistoryPage);
function clearHistoryFilters() {
  $('history-filter-from').value = '';
  $('history-filter-to').value = '';
  renderHistoryPage();
}

function toggleSelectAllHistory(masterCheckbox) {
  document.querySelectorAll('.bulk-entry-box').forEach(box => { box.checked = masterCheckbox.checked; });
  document.querySelectorAll('.bulk-select-box').forEach(box => { box.checked = masterCheckbox.checked; });
}

function exportHistoryEntryXLSX(entryId) {
  const { history } = Store.getState();
  const log = history.find(l => l.id === entryId);
  if (!log) { toast('Record not found', 'error'); return; }
  if (!log.items || log.items.length === 0) { toast('No item-level data stored for this record', 'error'); return; }
  const rows = [['Product Name', 'SKU', 'Price (Rs)', 'System Qty', 'Counted Qty', 'Variance', 'Value Impact (Rs)']];
  log.items.forEach(m => {
    const counted = m.counted;
    const variance = (counted !== null && counted !== undefined) ? counted - m.qty : '';
    const impact = (counted !== null && counted !== undefined) ? ((counted - m.qty) * m.price) : '';
    rows.push([m.name, m.code || '', m.price, m.qty, counted !== null && counted !== undefined ? counted : '', variance, impact !== '' ? Number(impact.toFixed(2)) : '']);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(log.company));
  XLSX.writeFile(wb, 'Audit_' + log.company.replace(/\s+/g, '_') + '_' + (log.date || '').replace(/\s+/g, '_') + '.xlsx');
  toast('Excel file exported successfully');
}

function printHistoryEntryPDF(entryId) {
  const { history } = Store.getState();
  const log = history.find(l => l.id === entryId);
  if (!log) { toast('Record not found', 'error'); return; }
  if (!log.items || log.items.length === 0) { toast('No item-level data stored for this record', 'error'); return; }
  renderPrintableReport(log, false);
  window.print();
}

function dispatchSelectedAuditsViaWhatsApp() {
  const checkboxes = document.querySelectorAll('.bulk-select-box:checked');
  if (checkboxes.length === 0) { toast('No ledger elements selected', 'error'); return; }
  const { history } = Store.getState();
  let msg = `*📋 FAZAL DIN'S PHARMA PLUS — CONSOLIDATED AUDIT*\n*Terminal:* ${Actions.getBranchName()}\n*Total Sub-Ledgers Bundled:* ${checkboxes.length}\n─────────────────────────\n\n`;
  checkboxes.forEach(box => {
    const parentKey = box.dataset.companyKey;
    const record = history.find(log => log.company === parentKey);
    if (record) {
      const sign = record.netFinancialImpact > 0 ? '+' : '';
      msg += `*🏢 Manufacturer:* ${record.company}\n*👤 Sign-Off:* ${record.auditor}\n*📈 Summary Metrics:* ${record.metricsLabel}\n*💰 Valuation Balance:* Rs ${sign}${record.netFinancialImpact.toLocaleString()}\n*🕒 Complete Date:* ${record.date} @ ${record.time}\n─────────────────────────\n`;
    }
  });
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}

function purgeSelectedAuditsFromLedger() {
  const entryBoxes = document.querySelectorAll('.bulk-entry-box:checked');
  const companyBoxes = document.querySelectorAll('.bulk-select-box:checked');
  if (entryBoxes.length === 0 && companyBoxes.length === 0) { toast('Select layout lines to drop', 'error'); return; }
  const totalCount = entryBoxes.length > 0 ? entryBoxes.length : companyBoxes.length;
  const unitLabel = entryBoxes.length > 0 ? 'audit record(s)' : 'manufacturer(s)';
  if (!confirm(`⚠️ Permanently scrub (${totalCount}) ${unitLabel} from disk?`)) return;

  if (entryBoxes.length > 0) {
    Actions.purgeHistoryEntries(Array.from(entryBoxes).map(b => b.dataset.entryId));
  } else {
    Actions.purgeHistoryByCompanies(Array.from(companyBoxes).map(b => b.dataset.companyKey));
  }
}

function exportAllHistoryXLSX() {
  const { history } = Store.getState();
  if (history.length === 0) { toast('No history records to export', 'error'); return; }
  const wb = XLSX.utils.book_new();
  const usedNames = {};
  history.slice().sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)).forEach(log => {
    const rows = [['Product Name', 'SKU', 'Price (Rs)', 'System Qty', 'Counted Qty', 'Variance', 'Value Impact (Rs)']];
    (log.items || []).forEach(m => {
      const counted = m.counted;
      const variance = (counted !== null && counted !== undefined) ? counted - m.qty : '';
      const impact = (counted !== null && counted !== undefined) ? ((counted - m.qty) * m.price) : '';
      rows.push([m.name, m.code || '', m.price, m.qty, counted !== null && counted !== undefined ? counted : '', variance, impact !== '' ? Number(impact.toFixed(2)) : '']);
    });
    if ((log.items || []).length === 0) {
      rows.push(['(No item-level data stored for this record)', '', '', '', '', '', '']);
      rows.push(['Summary:', log.metricsLabel || '', '', '', '', '', '']);
      rows.push(['Net Impact (Rs):', log.netFinancialImpact, '', '', '', '', '']);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    let baseName = sanitizeSheetName(log.company + ' ' + (log.date || ''));
    let finalName = baseName;
    let counter = 2;
    while (usedNames[finalName]) {
      finalName = sanitizeSheetName(baseName.slice(0, 25) + '_' + counter);
      counter++;
    }
    usedNames[finalName] = true;
    XLSX.utils.book_append_sheet(wb, ws, finalName);
  });
  XLSX.writeFile(wb, 'AllAudits_Combined_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  toast('Combined Excel workbook exported');
}

function sanitizeSheetName(name) {
  return String(name || 'Sheet').replace(/[:\\\/\?\*\[\]]/g, '').slice(0, 31) || 'Sheet';
}

// ── PIN gate ──
let pinBuffer = '';
function openSettingsPinGate() {
  pinBuffer = '';
  updatePinDots();
  $('pin-error').textContent = '';
  $('pin-gate-overlay').style.display = 'flex';
}
function closePinGate() {
  pinBuffer = '';
  updatePinDots();
  $('pin-gate-overlay').style.display = 'none';
}
function pinKeyPress(key) {
  if (key === 'back') { pinBuffer = pinBuffer.slice(0, -1); updatePinDots(); $('pin-error').textContent = ''; return; }
  if (pinBuffer.length >= 4) return;
  pinBuffer += key;
  updatePinDots();
  if (pinBuffer.length === 4) {
    if (Actions.verifyPin(pinBuffer)) {
      closePinGate();
      executeViewNavigation('settings');
    } else {
      $('pin-error').textContent = '❌ Incorrect PIN';
      setTimeout(() => { pinBuffer = ''; updatePinDots(); $('pin-error').textContent = ''; }, 900);
    }
  }
}
function updatePinDots() {
  for (let i = 0; i < 4; i++) {
    const dot = $('pd' + i);
    if (dot) dot.classList.toggle('filled', i < pinBuffer.length);
  }
}

// ── Settings page ──
function saveBranchName() { Actions.saveBranchName($('settings-branch-name').value); }
function saveSettingsPin() {
  const currentEl = $('settings-pin-current');
  const newEl = $('settings-pin-new');
  const confirmEl = $('settings-pin-confirm');
  const ok = Actions.saveSettingsPin(currentEl.value.trim(), newEl.value.trim(), confirmEl.value.trim());
  if (ok) { currentEl.value = ''; newEl.value = ''; confirmEl.value = ''; }
}
function saveDropboxAppKey() { Actions.saveDropboxAppKey($('settings-dropbox-key').value); }

function importConnectionToken() {
  $('conn-import-row').style.display = 'block';
  $('conn-link-row').style.display = 'none';
  $('conn-token-row').style.display = 'none';
  $('conn-token-input').value = '';
  setTimeout(() => $('conn-token-input').focus(), 100);
}
function cancelImportToken() {
  $('conn-import-row').style.display = 'none';
  const linked = !!Actions.getDropboxToken();
  $('conn-link-row').style.display = linked ? 'none' : 'block';
  $('conn-token-row').style.display = linked ? 'block' : 'none';
}
async function exportConnectionToken() {
  const pin = prompt('Set a 4-digit PIN to protect this token:\n(Receiving device will need this PIN)');
  if (!pin || pin.length < 4) { toast('PIN must be at least 4 digits', 'error'); return; }
  const b64 = await Actions.exportConnectionToken(pin);
  if (b64) prompt('Connection token (also copied to clipboard):\nShare this + your PIN with the other device.', b64);
}
async function applyImportedToken() {
  const b64 = $('conn-token-input').value.trim();
  if (!b64) { toast('Paste a connection token first', 'error'); return; }
  const pin = prompt('Enter the PIN set by the exporting device:');
  if (!pin) return;
  await Actions.applyImportedToken(b64, pin);
  $('conn-token-input').value = '';
  cancelImportToken();
}

Bus.on('cloud:state', ({ state, text }) => {
  const bar = $('cloud-sync-bar');
  const lbl = $('cloud-bar-text');
  if (bar) bar.className = 'state-' + state;
  if (lbl) lbl.textContent = text;
});

Bus.on('settings:dropboxStatusChanged', () => {
  const el = $('settings-dropbox-status');
  const dot = $('conn-dot');
  if (!el) return;
  const keyInput = $('settings-dropbox-key');
  if (keyInput) keyInput.value = Actions.getEffectiveDropboxAppKey();

  const linked = !!Actions.getDropboxToken();
  if (linked) {
    el.textContent = 'Connected securely'; el.style.color = 'var(--green)';
    if (dot) { dot.style.background = 'var(--green)'; dot.style.boxShadow = '0 0 5px var(--green)'; }
  } else {
    el.textContent = 'Not linked'; el.style.color = 'var(--grey)';
    if (dot) { dot.style.background = 'var(--grey)'; dot.style.boxShadow = 'none'; }
  }
  const autosyncToggle = $('settings-autosync-toggle');
  if (autosyncToggle) autosyncToggle.checked = Actions.isAutoSyncEnabled();

  const linkRow = $('conn-link-row');
  const tokenRow = $('conn-token-row');
  const importRow = $('conn-import-row');
  if (linkRow) linkRow.style.display = linked ? 'none' : 'block';
  if (tokenRow) tokenRow.style.display = linked ? 'block' : 'none';
  if (importRow) importRow.style.display = 'none';
});
Bus.on('settings:autoSyncRejected', () => {
  const t = $('settings-autosync-toggle');
  if (t) t.checked = false;
});

// ── PWA install banner ──
function initPwaInstallBanner() {
  let deferredInstallPrompt = null;
  const banner = $('pwa-install-banner');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (!Actions.isPwaInstallDismissed()) {
      setTimeout(() => banner && banner.classList.add('visible'), 2000);
    }
  });

  window.addEventListener('appinstalled', () => {
    banner && banner.classList.remove('visible');
    deferredInstallPrompt = null;
  });

  return {
    install() {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.then(() => {
        deferredInstallPrompt = null;
        banner && banner.classList.remove('visible');
      });
    },
    dismiss() {
      banner && banner.classList.remove('visible');
      Actions.dismissPwaInstall();
    },
  };
}

/* ── Handler maps, consumed by pages/event-delegation.js ── */
export function initLegacyPages() {
  const pwaBanner = initPwaInstallBanner();

  const clickHandlers = {
    'noop': () => {},
    'cloud-bar-tapped': () => Actions.cloudBarTapped(),
    'hardware-share': () => invokeNativeHardwareShare(),
    'font-scale': (el) => applyFontScaleAdjustment(el.dataset.scale, el),
    'goto-settings-pin-gate': () => { executeViewNavigation('settings'); openSettingsPinGate(); },
    'fetch-dropbox-inventory': () => fetchInventoryFromDropbox(),
    'trigger-file-input': (el) => { const t = $(el.dataset.target); if (t) t.click(); },
    'mark-remaining-match-legacy': () => Actions.markAllRemainingAsMatch(),
    'set-audit-filter': (el) => setAuditFilter(el.dataset.mode),
    'toggle-runtime-sort': () => toggleRuntimeSortOrder(),
    'toggle-company-sort': () => toggleCompanySortOrder(),
    'open-export-overlay': () => openExportConfigOverlay(),
    'close-export-overlay': () => closeExportConfigOverlay(),
    'abandon-session': () => Actions.abandonActiveSession(),
    'clear-history-filters': () => clearHistoryFilters(),
    'toggle-accordion': (el) => { const item = el.closest('.history-item'); if (item) item.classList.toggle('open'); },
    'reopen-history-audit': (el) => Actions.reopenHistoryAudit(el.dataset.entryId),
    'export-history-xlsx': (el) => exportHistoryEntryXLSX(el.dataset.entryId),
    'print-history-pdf': (el) => printHistoryEntryPDF(el.dataset.entryId),
    'start-audit-session': (el) => Actions.startAuditSession(el.dataset.company),
    'dispatch-whatsapp': () => dispatchSelectedAuditsViaWhatsApp(),
    'purge-selected': () => purgeSelectedAuditsFromLedger(),
    'print-combined-pdf': () => printSelectedAuditsCombinedPDF(),
    'export-all-xlsx': () => exportAllHistoryXLSX(),
    'save-branch-name': () => saveBranchName(),
    'save-settings-pin': () => saveSettingsPin(),
    'unlink-dropbox': () => Actions.unlinkDropbox(),
    'save-dropbox-key': () => saveDropboxAppKey(),
    'import-connection-token': () => importConnectionToken(),
    'export-connection-token': () => exportConnectionToken(),
    'apply-imported-token': () => applyImportedToken(),
    'cancel-import-token': () => cancelImportToken(),
    'export-full-backup': () => Actions.exportFullBackup(),
    'navigate': (el) => executeViewNavigation(el.dataset.view),
    'open-pin-gate': () => openSettingsPinGate(),
    'close-pin-gate': () => closePinGate(),
    'pin-key': (el) => pinKeyPress(el.dataset.key),
    'guarded-signoff': (el) => guardedSignoff(el.dataset.channel),
    'pwa-install': () => pwaBanner.install(),
    'pwa-dismiss': () => pwaBanner.dismiss(),
  };

  const inputHandlers = {
    'record-count': (el) => processKeyboardInputRegistration(el),
    'filter-audit-table': () => renderAuditTableBody(),
    'filter-company-list': () => renderCompanyList(),
    'filter-history': () => renderHistoryPage(),
  };

  const changeHandlers = {
    'filter-history': () => renderHistoryPage(),
    'toggle-select-all-history': (el) => toggleSelectAllHistory(el),
    'toggle-autosync': (el) => Actions.toggleAutoSync(el.checked),
    'ingest-hardware-package': (el) => ingestSharedHardwarePackage(el),
    'handle-csv-file': (el) => handleMasterCSVFile(el),
    'restore-backup': (el) => { const file = el.files[0]; if (file) Actions.restoreFullBackup(file); el.value = ''; },
  };

  const keydownHandlers = {
    'audit-input-enter-next': (e, el) => handleAuditInputKeydown(e, el),
  };

  return { clickHandlers, inputHandlers, changeHandlers, keydownHandlers };
}
