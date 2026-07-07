// ══════════════════════════════════════════════════════════════
// supabase/admin-actions/index.ts
// Deploy with: supabase functions deploy admin-actions
// Requires these secrets set on the Supabase project (Dashboard →
// Edge Functions → Secrets, or `supabase secrets set`):
//   SUPABASE_URL              (auto-provided by Supabase)
//   SUPABASE_SERVICE_ROLE_KEY (Dashboard → Project Settings → API)
//
// This is the ONLY place in the entire system that ever touches the
// service-role key. The browser app never sees it — it only ever
// calls this function with the caller's normal login token, and this
// function checks that caller is a Main Auditor before doing anything.
//
// Actions handled: createStaff · resetPin · setBlocked · promoteToMain
// (setAccessExpiry does NOT need this function — it's just a normal
// table update the Main Auditor's own RLS policy already allows.)
// ══════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function phoneToInternalEmail(phone: string) {
  const digitsOnly = phone.replace(/\D/g, "");
  return `${digitsOnly}@staff.internal`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const callerToken = authHeader.replace("Bearer ", "");
    if (!callerToken) return json({ error: "Missing auth token" }, 401);

    // Admin client — service role, full power, never leaves this function.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Verify the caller and that they are a Main Auditor — using their
    // OWN token, not the service role, so we know exactly who's asking.
    const { data: callerUser, error: callerErr } = await admin.auth.getUser(callerToken);
    if (callerErr || !callerUser?.user) return json({ error: "Invalid session" }, 401);

    const { data: callerStaffRow, error: staffErr } = await admin
      .from("staff")
      .select("role")
      .eq("id", callerUser.user.id)
      .single();
    if (staffErr || callerStaffRow?.role !== "main") {
      return json({ error: "Only a Main Auditor can perform this action" }, 403);
    }

    const body = await req.json();
    const { action } = body;

    if (action === "createStaff") {
      const { name, phone, pin, role } = body;
      if (!name || !phone || !pin) return json({ error: "name, phone, and pin are required" }, 400);
      if (!/^\d{4,8}$/.test(pin)) return json({ error: "PIN must be 4-8 digits" }, 400);

      const email = phoneToInternalEmail(phone);
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password: pin,
        email_confirm: true,
        user_metadata: { name, phone },
      });
      if (createErr) return json({ error: createErr.message }, 400);

      const { error: insertErr } = await admin.from("staff").insert({
        id: created.user.id,
        name,
        phone,
        role: role === "main" ? "main" : "sub",
      });
      if (insertErr) {
        // Roll back the auth user if the staff-table insert failed
        // (e.g. duplicate phone number), so we don't leave an orphan login.
        await admin.auth.admin.deleteUser(created.user.id);
        return json({ error: insertErr.message }, 400);
      }

      return json({ ok: true, staffId: created.user.id });
    }

    if (action === "resetPin") {
      const { staffId, newPin } = body;
      if (!staffId || !newPin) return json({ error: "staffId and newPin are required" }, 400);
      if (!/^\d{4,8}$/.test(newPin)) return json({ error: "PIN must be 4-8 digits" }, 400);
      const { error } = await admin.auth.admin.updateUserById(staffId, { password: newPin });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "setBlocked") {
      const { staffId, blocked } = body;
      if (!staffId) return json({ error: "staffId is required" }, 400);
      const { data: targetRow } = await admin.from("staff").select("role").eq("id", staffId).single();
      if (targetRow?.role === "main") return json({ error: "Main Auditor accounts cannot be blocked" }, 403);
      const { error } = await admin.auth.admin.updateUserById(staffId, {
        ban_duration: blocked ? "876000h" : "none", // ~100 years, effectively indefinite until unblocked
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "deleteStaff") {
      const { staffId } = body;
      if (!staffId) return json({ error: "staffId is required" }, 400);
      const { data: targetRow } = await admin.from("staff").select("role").eq("id", staffId).single();
      if (targetRow?.role === "main") return json({ error: "Main Auditor accounts cannot be deleted" }, 403);
      const { error } = await admin.auth.admin.deleteUser(staffId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "promoteToMain") {
      const { staffId } = body;
      if (!staffId) return json({ error: "staffId is required" }, 400);
      const { error } = await admin.from("staff").update({ role: "main" }).eq("id", staffId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "Unknown action: " + action }, 400);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
