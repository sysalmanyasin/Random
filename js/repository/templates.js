/* ══════════════════════════════════════════════════════════════
   FLOOR 1 — REPOSITORY / templates.js
   Saved audit templates (named product-code lists) from the
   Inventory tab — local-first, same pattern as products/history.
   Best-effort synced to Supabase's audit_templates table by
   repository/supabase.js; this file is the offline source of truth.
   ══════════════════════════════════════════════════════════════ */
import { DbCore } from './db.js';

function saveTemplateLocal(template) { DbCore.put('templates', template); }
function deleteTemplateLocal(id) { DbCore.remove('templates', id); }
function loadTemplates() { return DbCore.getAll('templates'); }
// Used after a cloud pull to reconcile the local cache with whatever
// Supabase returned (cloud wins on conflict — see inventory-actions.js).
function replaceAllTemplatesLocal(templates) { DbCore.clearStore('templates'); DbCore.putAll('templates', templates); }

export const TemplatesRepo = {
  saveTemplateLocal, deleteTemplateLocal, loadTemplates, replaceAllTemplatesLocal,
};
