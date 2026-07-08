import { Repo } from '../repository.js';
import { Store } from '../store.js';
import { Bus } from './bus.js';
import { logAudit } from './audit-log-actions.js';
import { LegacyActions } from './legacy-actions.js';
import { EngagementActions } from './engagement-actions.js';
import { RoundActions } from './round-actions.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS / inventory-actions.js
   The Inventory tab: search/group state over live `products`,
   saved Templates (named product-code lists, local-first +
   best-effort Supabase sync), and launching a Random Audit —
   Individual or Team — from a resolved selection.

   Templates are deliberately dumb storage (just codes). All
   "what does this mean right now" logic happens here, at load
   time, resolved fresh against whatever `products` currently is —
   so a template survives Dropbox/CSV re-syncs and discontinued
   codes without ever going stale.
   ══════════════════════════════════════════════════════════════ */

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'tpl_' + Date.now() + '_' + Math.random().toString(36).slice(2);
}

// ── Search / group UI state ──────────────────────────────
function setInventorySearch(query) {
  Store.setState({ inventorySearchQuery: query || '' });
  Bus.emit('inventory:filterChanged');
}
function setInventoryGroupBy(mode) {
  Store.setState({ inventoryGroupBy: mode });
  Bus.emit('inventory:filterChanged');
}

// ── Row/selection state (checkboxes in the Inventory table) ──
function toggleInventorySelection(code) {
  if (!code) return;
  const { inventorySelectedCodes } = Store.getState();
  const set = new Set(inventorySelectedCodes);
  if (set.has(code)) set.delete(code); else set.add(code);
  Store.setState({ inventorySelectedCodes: [...set] });
  Bus.emit('inventory:selectionChanged');
}
function selectManyForInventory(codes, selected) {
  const { inventorySelectedCodes } = Store.getState();
  const set = new Set(inventorySelectedCodes);
  codes.forEach(c => { if (selected) set.add(c); else set.delete(c); });
  Store.setState({ inventorySelectedCodes: [...set] });
  Bus.emit('inventory:selectionChanged');
}
function clearInventorySelection() {
  Store.setState({ inventorySelectedCodes: [], activeTemplateId: null, resolvedTemplateMatch: null });
  Bus.emit('inventory:selectionChanged');
}

// ── "Load from File" — a plain code list, CSV with a code-ish header,
//    or Candela-style one-code-per-line paste. Deliberately tolerant:
//    if it can't find a header it knows, it just treats every
//    non-empty line/cell as a code. ──
function _parseCodesFromText(text) {
  const rows = text.trim().split(/\r?\n/).filter(r => r.trim() !== '');
  if (rows.length === 0) return [];
  const headerCandidates = ['code', 'product code', 'productcode', 'sku'];
  const firstCells = rows[0].split(',').map(c => c.trim().replace(/"/g, '').toLowerCase());
  const headerIdx = firstCells.findIndex(c => headerCandidates.includes(c));
  if (headerIdx >= 0) {
    return rows.slice(1)
      .map(r => (r.split(',')[headerIdx] || '').trim().replace(/"/g, ''))
      .filter(Boolean);
  }
  // No recognizable header — every cell across every line is a code.
  return rows.flatMap(r => r.split(',').map(c => c.trim().replace(/"/g, ''))).filter(Boolean);
}
async function importCodesFromFile(file) {
  const text = await file.text();
  const codes = _parseCodesFromText(text);
  if (codes.length === 0) { Bus.emit('toast', { msg: 'No product codes found in that file', kind: 'error' }); return; }
  selectManyForInventory(codes, true);
  Bus.emit('toast', { msg: `Loaded ${codes.length.toLocaleString()} code(s) from file`, kind: 'success' });
}

// ── Resolve any code list against CURRENT live inventory ──
// This is what makes a saved template survive a re-sync: nothing about
// "which products" is stored ahead of time, it's recomputed here.
function resolveCodes(codes) {
  const { products } = Store.getState();
  const codeSet = new Set(codes);
  const items = products.filter(p => p.code && codeSet.has(p.code));
  return { items, matched: items.length, total: codes.length };
}

// ── Templates: save / load / delete, local-first + best-effort cloud ──
async function saveSelectionAsTemplate(name) {
  const { inventorySelectedCodes, sbClient, templates } = Store.getState();
  if (!inventorySelectedCodes || inventorySelectedCodes.length === 0) {
    Bus.emit('toast', { msg: 'Select or load at least one product code first', kind: 'error' });
    return null;
  }
  const trimmedName = (name || '').trim();
  if (!trimmedName) { Bus.emit('toast', { msg: 'Give the template a name', kind: 'error' }); return null; }

  const template = { id: uuid(), name: trimmedName, codes: inventorySelectedCodes.slice(), createdAt: Date.now(), updatedAt: Date.now() };
  Repo.saveTemplateLocal(template);
  const newTemplates = [template, ...templates];
  Store.setState({ templates: newTemplates });
  Bus.emit('templates:changed', newTemplates);
  logAudit('template:saved', { templateId: template.id, name: trimmedName, codeCount: template.codes.length });
  Bus.emit('toast', { msg: `Template "${trimmedName}" saved (${template.codes.length} codes)`, kind: 'success' });

  if (sbClient) {
    try { await Repo.insertTemplate(sbClient, template); }
    catch (err) { Bus.emit('toast', { msg: 'Saved locally — cloud sync failed: ' + err.message, kind: 'error' }); }
  }
  return template;
}

async function renameTemplate(id, newName) {
  const { templates, sbClient } = Store.getState();
  const t = templates.find(x => x.id === id);
  if (!t || !newName || !newName.trim()) return;
  t.name = newName.trim();
  t.updatedAt = Date.now();
  Repo.saveTemplateLocal(t);
  Store.setState({ templates: templates.slice() });
  Bus.emit('templates:changed', Store.getState().templates);
  if (sbClient) { try { await Repo.updateTemplate(sbClient, id, { name: t.name, codes: t.codes }); } catch (_) { /* best-effort */ } }
}

async function deleteTemplate(id) {
  const { templates, sbClient, activeTemplateId } = Store.getState();
  if (!confirm('Delete this template? This cannot be undone.')) return;
  Repo.deleteTemplateLocal(id);
  const remaining = templates.filter(t => t.id !== id);
  Store.setState({ templates: remaining, ...(activeTemplateId === id ? { activeTemplateId: null, inventorySelectedCodes: [], resolvedTemplateMatch: null } : {}) });
  Bus.emit('templates:changed', remaining);
  logAudit('template:deleted', { templateId: id });
  Bus.emit('toast', { msg: 'Template deleted', kind: 'success' });
  if (sbClient) { try { await Repo.deleteTemplateRemote(sbClient, id); } catch (_) { /* best-effort */ } }
}

// Loads a saved template into the working selection and resolves it
// against live inventory right now, so the UI can show "14 of 16
// matched — 2 discontinued" immediately.
function loadTemplateIntoSelection(id) {
  const { templates } = Store.getState();
  const t = templates.find(x => x.id === id);
  if (!t) { Bus.emit('toast', { msg: 'Template not found', kind: 'error' }); return; }
  const { matched, total } = resolveCodes(t.codes);
  Store.setState({ inventorySelectedCodes: t.codes.slice(), activeTemplateId: id, resolvedTemplateMatch: { matched, total } });
  Bus.emit('inventory:selectionChanged');
  Bus.emit('templates:loaded', { id, name: t.name, matched, total });
}

// Pulls the cloud copy after a Main Auditor logs in, merging by id
// (cloud row wins on conflict, since it's the shared source of truth
// once online) and writing the merged set back to the local cache.
async function pullCloudTemplates() {
  const { sbClient } = Store.getState();
  if (!sbClient) return;
  try {
    const cloud = await Repo.fetchTemplates(sbClient);
    const local = await Repo.loadTemplates();
    const byId = new Map(local.map(t => [t.id, t]));
    cloud.forEach(t => byId.set(t.id, t));
    const merged = [...byId.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    Repo.replaceAllTemplatesLocal(merged);
    Store.setState({ templates: merged });
    Bus.emit('templates:changed', merged);
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not sync templates: ' + err.message, kind: 'error' });
  }
}

// ── Random Audit launch ──────────────────────────────────
function _sampleRandom(items, sampleSize) {
  const shuffled = items.slice().sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.max(1, Math.min(sampleSize, items.length)));
}

// Individual (single-auditor) — samples straight from the resolved
// selection/template and jumps directly into the audit workspace,
// skipping the manual company-picker screen entirely.
function startIndividualRandomAudit(sampleSize, label) {
  const { inventorySelectedCodes } = Store.getState();
  const { items } = resolveCodes(inventorySelectedCodes);
  if (items.length === 0) { Bus.emit('toast', { msg: 'Nothing in this selection matches current inventory', kind: 'error' }); return; }
  const sample = _sampleRandom(items, sampleSize || 10);
  LegacyActions.startAuditSessionForItems(label || 'Random Audit', sample);
  logAudit('inventory:individualRandomAudit', { itemCount: sample.length, poolSize: items.length, label });
  Bus.emit('nav:goto', 'audit');
  Bus.emit('toast', { msg: `Random audit started — ${sample.length} item(s)`, kind: 'success' });
}

// Team — exact codes only. Creates a template-scoped engagement, then
// immediately opens Round 1, so sub-auditors' assignments only ever
// contain these exact codes (see engagement-actions.js + round-actions.js).
async function startTeamRandomAudit(name) {
  const { inventorySelectedCodes } = Store.getState();
  if (!inventorySelectedCodes || inventorySelectedCodes.length === 0) {
    Bus.emit('toast', { msg: 'Select or load at least one product code first', kind: 'error' });
    return;
  }
  const engagement = await EngagementActions.createEngagement(name, { type: 'template', codes: inventorySelectedCodes.slice() });
  if (!engagement) return;
  const round = await RoundActions.createRound();
  if (!round) return;
  logAudit('inventory:teamRandomAudit', { engagementId: engagement.id, itemCount: round.itemSnapshot.length });
  Bus.emit('nav:goto', 'team');
  Bus.emit('toast', { msg: `Team engagement "${engagement.name}" created — ${round.itemSnapshot.length} item(s), open Team to assign auditors`, kind: 'success' });
}

export const InventoryActions = {
  setInventorySearch, setInventoryGroupBy,
  toggleInventorySelection, selectManyForInventory, clearInventorySelection,
  importCodesFromFile, resolveCodes,
  saveSelectionAsTemplate, renameTemplate, deleteTemplate, loadTemplateIntoSelection, pullCloudTemplates,
  startIndividualRandomAudit, startTeamRandomAudit,
};
