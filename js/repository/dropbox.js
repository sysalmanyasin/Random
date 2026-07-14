/* ══════════════════════════════════════════════════════════════
   FLOOR 1 — REPOSITORY / dropbox.js
   The only module that talks to the Dropbox network API.
   Pull-only: inventory.json is downloaded, never written back —
   the old pharma_audit_sync.json push channel (and, before that,
   the pairing-link folder layout) is gone; multi-auditor data lives
   in Supabase (repository/supabase.js) instead.
   ══════════════════════════════════════════════════════════════ */

function buildDropboxClient(token) {
  if (typeof Dropbox === 'undefined') return null;
  return new Dropbox.Dropbox({ accessToken: token });
}

async function dropboxDownloadJSON(client, path) {
  const res = await client.filesDownload({ path });
  const fileBlob = (res.result && res.result.fileBlob) || res.fileBlob;
  const text = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = e => resolve(e.target.result);
    r.onerror = reject;
    r.readAsText(fileBlob);
  });
  return JSON.parse(text);
}

async function dropboxExchangePkceCode(appKey, code, verifier, redirectUri) {
  const body = new URLSearchParams({
    code, grant_type: 'authorization_code', client_id: appKey,
    code_verifier: verifier, redirect_uri: redirectUri,
  });
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error('Token exchange failed: ' + res.status);
  return res.json();
}

export const DropboxRepo = {
  buildDropboxClient, dropboxDownloadJSON, dropboxExchangePkceCode,
};
