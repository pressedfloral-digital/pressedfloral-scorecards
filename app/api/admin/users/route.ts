import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { adminProfileToRow, normalizeAdminUserPayload, type AdminManagedUser } from "../../../../lib/adminUsers";
import { profileFromRow } from "../../../../lib/supabase";

export const runtime = "nodejs";

type AdminContext =
  | { ok: true; client: SupabaseClient; callerId: string }
  | { ok: false; response: NextResponse };

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin.ok) return admin.response;

  const usersResult = await admin.client.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersResult.error) return jsonError(usersResult.error.message, 500);

  const profilesResult = await admin.client.from("manager_profiles").select("*");
  if (profilesResult.error) return jsonError(profilesResult.error.message, 500);

  const profiles = new Map<string, Record<string, any>>();
  for (const row of profilesResult.data || []) profiles.set(String(row.id), row);

  return NextResponse.json({
    users: usersResult.data.users.map((user) => mapManagedUser(user, profiles.get(user.id)))
  });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin.ok) return admin.response;

  const payload = normalizeAdminUserPayload(await readJson(request), { requireEmail: true });
  if (!payload.ok) return jsonError(payload.error, 400);

  const existingResult = await admin.client.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (existingResult.error) return jsonError(existingResult.error.message, 500);
  const existing = existingResult.data.users.find((user) => user.email?.toLowerCase() === payload.value.email);

  const isResend = request.nextUrl.searchParams.get("resend") === "true";
  if (existing && !isResend) return jsonError("A user with that email already exists.", 409);

  // For resends on already-confirmed users, send a password reset email instead of a new invite.
  if (isResend && existing) {
    const isConfirmed = !!(existing.confirmed_at || existing.email_confirmed_at || existing.last_sign_in_at);
    if (isConfirmed) {
      const { error: resetError } = await admin.client.auth.resetPasswordForEmail(payload.value.email!, {
        redirectTo: `${request.nextUrl.origin}/accept-invite`
      });
      if (resetError) return jsonError(resetError.message, 400);
      return NextResponse.json({ message: "Password reset email sent." });
    }
  }

  const inviteResult = await admin.client.auth.admin.inviteUserByEmail(payload.value.email!, {
    redirectTo: `${request.nextUrl.origin}/accept-invite`,
    data: { scorecards_role: payload.value.role }
  });
  if (inviteResult.error) {
    const status = inviteResult.error.message.toLowerCase().includes("already") ? 409 : 400;
    return jsonError(inviteResult.error.message, status);
  }

  const user = inviteResult.data.user;
  if (!user) return jsonError("Supabase did not return an invited user.", 500);

  const profileResult = await admin.client
    .from("manager_profiles")
    .upsert(adminProfileToRow(user.id, payload.value), { onConflict: "id" })
    .select()
    .single();
  if (profileResult.error) return jsonError(profileResult.error.message, 500);

  return NextResponse.json({ user: mapManagedUser(user, profileResult.data) }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin.ok) return admin.response;

  const action = request.nextUrl.searchParams.get("action");

  // Deactivate / reactivate — ban or unban without touching profile data
  if (action === "deactivate" || action === "reactivate") {
    const body = await readJson(request) as Record<string, unknown> | null;
    const targetId = typeof body?.id === "string" ? body.id : null;
    if (!targetId) return jsonError("User id is required.", 400);
    if (targetId === admin.callerId) return jsonError("You cannot deactivate your own account.", 400);

    const banDuration = action === "deactivate" ? "876000h" : "none";
    const updateResult = await admin.client.auth.admin.updateUserById(targetId, { ban_duration: banDuration });
    if (updateResult.error) return jsonError(updateResult.error.message, 400);

    const profileResult = await admin.client.from("manager_profiles").select("*").eq("id", targetId).maybeSingle();
    return NextResponse.json({ user: mapManagedUser(updateResult.data.user, profileResult.data ?? undefined) });
  }

  const payload = normalizeAdminUserPayload(await readJson(request), { requireId: true });
  if (!payload.ok) return jsonError(payload.error, 400);
  const targetId = payload.value.id!;

  if (targetId === admin.callerId && payload.value.role !== "admin") {
    return jsonError("You cannot remove your own admin access.", 400);
  }

  if (payload.value.role !== "admin") {
    const otherAdmins = await admin.client
      .from("manager_profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .neq("id", targetId);
    if (otherAdmins.error) return jsonError(otherAdmins.error.message, 500);
    if ((otherAdmins.count ?? 0) === 0) return jsonError("At least one admin must remain.", 400);
  }

  const targetResult = await admin.client.auth.admin.getUserById(targetId);
  if (targetResult.error || !targetResult.data.user) return jsonError("User not found.", 404);

  // Update email in Auth if it changed
  let authUser = targetResult.data.user;
  const newEmail = payload.value.email?.toLowerCase();
  if (newEmail && newEmail !== authUser.email?.toLowerCase()) {
    const emailUpdate = await admin.client.auth.admin.updateUserById(targetId, { email: newEmail });
    if (emailUpdate.error) return jsonError(emailUpdate.error.message, 400);
    authUser = emailUpdate.data.user;
  }

  // Clearing every alias has to write an empty list, which is only safe once the column exists.
  const existingProfile = await admin.client.from("manager_profiles").select("*").eq("id", targetId).maybeSingle();
  const includeAliases = !!existingProfile.data && "linked_name_aliases" in existingProfile.data;

  const profileResult = await admin.client
    .from("manager_profiles")
    .upsert(adminProfileToRow(targetId, payload.value, { includeAliases }), { onConflict: "id" })
    .select()
    .single();
  if (profileResult.error) return jsonError(profileResult.error.message, 500);

  return NextResponse.json({ user: mapManagedUser(authUser, profileResult.data) });
}

export async function DELETE(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin.ok) return admin.response;

  const targetId = request.nextUrl.searchParams.get("id");
  if (!targetId) return jsonError("User id is required.", 400);
  if (targetId === admin.callerId) return jsonError("You cannot delete your own account.", 400);

  // Delete auth user. Profile row intentionally kept as orphan so historical
  // scorecard reviewer references remain intact.
  const { error } = await admin.client.auth.admin.deleteUser(targetId);
  if (error) return jsonError(error.message, 400);

  return NextResponse.json({ id: targetId });
}

async function requireAdmin(request: NextRequest): Promise<AdminContext> {
  let client: SupabaseClient;
  try {
    client = serviceClient();
  } catch (error) {
    return { ok: false, response: jsonError(error instanceof Error ? error.message : "Supabase admin client is not configured.", 500) };
  }
  const token = bearerToken(request);
  if (!token) return { ok: false, response: jsonError("Sign in to manage users.", 401) };

  const userResult = await client.auth.getUser(token);
  const user = userResult.data.user;
  if (userResult.error || !user) return { ok: false, response: jsonError("Invalid session.", 401) };

  const profileResult = await client.from("manager_profiles").select("role").eq("id", user.id).maybeSingle();
  if (profileResult.error) return { ok: false, response: jsonError(profileResult.error.message, 500) };
  if (profileResult.data?.role !== "admin") return { ok: false, response: jsonError("Admin access required.", 403) };

  return { ok: true, client, callerId: user.id };
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

function bearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization") || "";
  const [scheme, token] = authorization.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : "";
}

async function readJson(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function mapManagedUser(user: Record<string, any>, profileRow?: Record<string, any>): AdminManagedUser {
  const email = String(user.email || "");
  const profile = profileRow
    ? profileFromRow(email, profileRow)
    : { id: String(user.id), email, role: "user" as const, departments: [], locations: [] };
  const bannedUntil = user.banned_until ? new Date(user.banned_until) : null;
  const isDeactivated = bannedUntil !== null && bannedUntil > new Date();
  return {
    ...profile,
    email,
    hasProfile: !!profileRow,
    status: isDeactivated ? "deactivated" : user.last_sign_in_at || user.confirmed_at || user.email_confirmed_at ? "active" : user.invited_at ? "invited" : "unconfirmed",
    deactivatedAt: isDeactivated ? user.banned_until : undefined,
    invitedAt: user.invited_at || undefined,
    confirmedAt: user.confirmed_at || user.email_confirmed_at || undefined,
    lastSignInAt: user.last_sign_in_at || undefined,
    createdAt: user.created_at || undefined
  };
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}
