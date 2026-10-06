import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "Server not configured." }, { status: 500 });

  const authorization = request.headers.get("authorization") || "";
  const [scheme, token] = authorization.split(" ");
  const bearerToken = scheme?.toLowerCase() === "bearer" && token ? token : "";
  if (!bearerToken) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const client = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // Verify the caller's session
  const { data: { user }, error: authError } = await client.auth.getUser(bearerToken);
  if (authError || !user) return NextResponse.json({ error: "Invalid session." }, { status: 401 });

  // Return profiles of managers who list this user as their supervisor
  const { data, error } = await client
    .from("manager_profiles")
    // "*" rather than a column list so this keeps working before linked_name_aliases exists.
    .select("*")
    .eq("supervisor_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Resolve the caller's own reviewer (their supervisor) — the person any scorecard the caller
  // submits (their own, or a direct report's) routes to for review/approval. Used to show
  // "submitted to <name> for review" on Pending Review cards in Team Scorecards.
  let reviewer: { id: string; name: string | null; email: string } | null = null;
  const { data: ownProfile } = await client
    .from("manager_profiles")
    .select("supervisor_id")
    .eq("id", user.id)
    .maybeSingle();
  const ownSupervisorId = ownProfile?.supervisor_id;
  if (ownSupervisorId) {
    const { data: supervisorProfile } = await client
      .from("manager_profiles")
      .select("id, email, linked_employee_name")
      .eq("id", ownSupervisorId)
      .maybeSingle();
    if (supervisorProfile) {
      reviewer = {
        id: String(supervisorProfile.id),
        name: typeof supervisorProfile.linked_employee_name === "string" && supervisorProfile.linked_employee_name.trim()
          ? supervisorProfile.linked_employee_name.trim()
          : null,
        email: supervisorProfile.email,
      };
    }
  }

  // Also walk the full reporting chain below this user (direct reports, their reports, etc.) so
  // callers can tell "is this reviewer somewhere under me" — used to let a manager approve/return
  // a subordinate's assigned scorecard when that subordinate (the direct reviewer) is unavailable.
  // Capped at 10 levels as a defensive guard against a cyclic supervisor_id graph.
  const descendantIds = new Set<string>();
  let frontier = [user.id];
  for (let depth = 0; depth < 10 && frontier.length > 0; depth++) {
    const { data: children, error: childError } = await client
      .from("manager_profiles")
      .select("id")
      .in("supervisor_id", frontier);
    if (childError) break;
    const newIds = (children || []).map((c) => String(c.id)).filter((id) => !descendantIds.has(id));
    newIds.forEach((id) => descendantIds.add(id));
    frontier = newIds;
  }

  const profiles = (data || []).map((row) => ({
    id: row.id,
    role: row.role,
    departments: row.departments,
    locations: row.locations,
    linked_employee_name: row.linked_employee_name,
    linked_name_aliases: row.linked_name_aliases ?? [],
    supervisor_id: row.supervisor_id,
    company_goals_grant: row.company_goals_grant
  }));
  return NextResponse.json({ profiles, descendantIds: Array.from(descendantIds), reviewer });
}
