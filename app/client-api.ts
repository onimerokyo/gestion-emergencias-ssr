import { createClient, type User } from "@supabase/supabase-js";

const SUPABASE_URL = "https://inyijvmvtpuubcatjmgq.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_dBGW11mjPDLT714h9SOg-g_iBysphVX";
const PRIMARY_ADMIN_EMAIL = "marcelo.ulloa@mop.gov.cl";
const EMAIL_SENDER = "emergenciasdoh@gmail.com";
const EMAIL_RECIPIENT = "marcelo.ulloa@mop.gov.cl";
const CHILE_TIME_ZONE = "America/Santiago";

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "gestion-emergencias-ssr-auth",
    },
  },
);

type AppRole = "admin" | "reporter" | "viewer";

type RawSystem = {
  id?: string;
  official_code: string;
  name: string;
  province?: string;
  comuna?: string;
};

type RawEvent = {
  id: number;
  event_type: string;
  comment?: string | null;
  display_status?: string | null;
  to_status?: "active" | "resolved" | null;
  actor_name?: string | null;
  created_at: string;
};

type RawIncident = {
  id: string;
  code: string;
  category: string;
  priority: "critical" | "high" | "medium" | "low";
  description: string;
  affected_connections: number;
  affected_at_report?: number | null;
  water_status: string;
  electrical_status: string;
  status: "active" | "resolved";
  workflow_status?: string | null;
  assigned_to_name?: string | null;
  reported_by_name: string;
  informed_by_name?: string | null;
  occurred_at?: string | null;
  reported_at: string;
  resolved_at?: string | null;
  created_at: string;
  updated_at: string;
  systems: RawSystem | RawSystem[];
  incident_events?: RawEvent[];
};

type RawReport = {
  id: string;
  report_date: string;
  report_time: string;
  scope: string;
  generated_by_name: string;
  generated_at: string;
  payload: unknown[];
};

type RawComment = {
  id: string;
  comment: string;
  author_name: string;
  created_at: string;
  systems: { official_code: string } | Array<{ official_code: string }>;
};

const INCIDENT_SELECT = [
  "id,code,category,priority,description,affected_connections,affected_at_report",
  "water_status,electrical_status,status,workflow_status,assigned_to_name",
  "reported_by_name,informed_by_name,occurred_at,reported_at,resolved_at,created_at,updated_at",
  "systems!inner(id,official_code,name,province,comuna)",
  "incident_events(id,event_type,comment,display_status,to_status,actor_name,created_at)",
].join(",");

export function assetUrl(path: string) {
  const base = import.meta.env.BASE_URL || "/";
  return `${base}${path.replace(/^\//, "")}`;
}

export async function apiFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  try {
    const path = new URL(input, window.location.origin).pathname.replace(
      /\/+$/,
      "",
    );
    const method = (init.method || "GET").toUpperCase();

    if (path.endsWith("/api/auth/session") && method === "GET") {
      return json({ user: await requireUser() });
    }
    if (path.endsWith("/api/auth/bootstrap") && method === "GET") {
      return json({
        configured: true,
        required: false,
        email: PRIMARY_ADMIN_EMAIL,
      });
    }
    if (path.endsWith("/api/auth/bootstrap") && method === "POST") {
      return json(
        { error: "La cuenta administradora principal ya fue creada." },
        409,
      );
    }
    if (path.endsWith("/api/auth/login") && method === "POST") {
      const body = bodyJson(init);
      const { data, error } = await supabase.auth.signInWithPassword({
        email: text(body.email).toLowerCase(),
        password: String(body.password ?? ""),
      });
      if (error || !data.user) {
        return json(
          { error: "La cuenta o la contraseña no son válidas." },
          401,
        );
      }
      const user = mapUser(data.user);
      if (!user.active) {
        await supabase.auth.signOut();
        return json({ error: "Esta cuenta se encuentra deshabilitada." }, 403);
      }
      return json({ user });
    }
    if (path.endsWith("/api/auth/logout") && method === "POST") {
      await supabase.auth.signOut();
      return json({ ok: true });
    }
    if (path.endsWith("/api/auth/password") && method === "POST") {
      const user = await requireUser();
      const body = bodyJson(init);
      const password = String(body.password ?? "");
      if (password.length < 12) {
        return json(
          { error: "La contraseña debe contener al menos 12 caracteres." },
          400,
        );
      }
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      await callAdminFunction({ action: "clear-must-change", userId: user.id });
      return json({ ok: true });
    }

    if (path.endsWith("/api/incidents/photos") && method === "POST") {
      return handlePhotos(init);
    }
    if (path.endsWith("/api/incidents")) {
      return handleIncidents(method, init);
    }
    if (path.endsWith("/api/reports")) {
      return handleReports(method, init);
    }
    if (path.endsWith("/api/system-comments")) {
      return handleComments(method, init);
    }
    if (path.endsWith("/api/users")) {
      return handleUsers(method, init);
    }
    if (path.endsWith("/api/email/status") && method === "GET") {
      await requireUser();
      return json({
        configured: true,
        provider: "Gmail API",
        sender: EMAIL_SENDER,
        recipient: EMAIL_RECIPIENT,
        missingConfiguration: 0,
      });
    }
    if (path.endsWith("/api/email/send") && method === "POST") {
      return handleEmail(init);
    }

    return json({ error: "Ruta no disponible." }, 404);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "No fue posible completar la operación.";
    const status = /No autorizado|sesión/i.test(message) ? 401 : 500;
    return json({ error: message }, status);
  }
}

async function handleIncidents(method: string, init: RequestInit) {
  const user = await requireUser();
  if (method === "GET") {
    const { data, error } = await supabase
      .from("incidents")
      .select(INCIDENT_SELECT)
      .order("reported_at", { ascending: false });
    if (error) throw error;
    return json({ incidents: (data ?? []).map((row) => mapIncident(row as unknown as RawIncident)) });
  }
  if (user.role === "viewer") {
    return json({ error: "Tu perfil es solo de consulta." }, 403);
  }
  const body = bodyJson(init);
  if (method === "POST") {
    const systemCode = text(body.systemCode);
    const description = text(body.description);
    const category = text(body.category);
    if (!systemCode || !category || description.length < 5) {
      return json(
        { error: "Completa sistema, categoría y descripción." },
        400,
      );
    }
    const { data: found, error: systemError } = await supabase
      .from("systems")
      .select("id,official_code,name,province,comuna")
      .eq("official_code", systemCode)
      .limit(1)
      .maybeSingle();
    if (systemError) throw systemError;
    if (!found?.id) return json({ error: "El sistema SSR no existe." }, 404);
    const affected = Math.max(0, number(body.affected));
    const { data, error } = await supabase
      .from("incidents")
      .insert({
        system_id: found.id,
        category,
        priority: priorityToDatabase(text(body.priority)),
        description,
        affected_connections: affected,
        affected_at_report: affected,
        water_status: text(body.water) || "Sin información",
        electrical_status: text(body.electricity) || "Sin información",
        workflow_status: "Reportado",
        reported_by: user.id,
        reported_by_name: user.name,
        informed_by_name: text(body.informedBy) || user.name,
        occurred_at: nullableDate(text(body.occurredAt)),
        sectors: text(body.sectors) || null,
        support_required: text(body.support) || null,
        internal_notes: text(body.notes) || null,
        latitude: nullableNumber(body.latitude),
        longitude: nullableNumber(body.longitude),
      })
      .select(INCIDENT_SELECT)
      .single();
    if (error) throw error;
    return json({ incident: mapIncident(data as unknown as RawIncident) }, 201);
  }
  if (method === "PATCH") {
    const id = text(body.id);
    const comment = text(body.comment);
    const nextStatus = text(body.nextStatus);
    if (!id || comment.length < 3 || !isWorkflowStatus(nextStatus)) {
      return json({ error: "Ingresa un seguimiento válido." }, 400);
    }
    const resolving = nextStatus === "Resuelto" || nextStatus === "Cerrado";
    if (resolving && user.role !== "admin") {
      return json(
        { error: "Solo un administrador puede resolver la alerta." },
        403,
      );
    }
    if (resolving) {
      const { error } = await supabase
        .from("incidents")
        .update({
          status: "resolved",
          workflow_status: nextStatus,
          resolution_comment: comment,
          resolved_by: user.id,
          resolved_by_name: user.name,
          affected_connections: 0,
          water_status: "Normal",
          electrical_status: "Normal",
        })
        .eq("id", id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("incident_events").insert({
        incident_id: id,
        event_type: "status_update",
        comment,
        display_status: nextStatus,
        actor_id: user.id,
        actor_name: user.name,
      });
      if (error) throw error;
    }
    const { data, error } = await supabase
      .from("incidents")
      .select(INCIDENT_SELECT)
      .eq("id", id)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return json({ error: "El incidente no existe." }, 404);
    return json({ incident: mapIncident(data as unknown as RawIncident) });
  }
  return json({ error: "Método no permitido." }, 405);
}

async function handlePhotos(init: RequestInit) {
  const user = await requireUser();
  if (user.role === "viewer") {
    return json({ error: "Tu perfil es solo de consulta." }, 403);
  }
  if (!(init.body instanceof FormData)) {
    return json({ error: "No se recibieron fotografías." }, 400);
  }
  const incidentId = String(init.body.get("incidentId") ?? "").trim();
  const files = init.body
    .getAll("photos")
    .filter((value): value is File => value instanceof File)
    .slice(0, 4);
  if (!incidentId || !files.length) {
    return json({ error: "No se recibieron fotografías." }, 400);
  }
  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  const uploaded: string[] = [];
  for (const file of files) {
    if (!allowed.has(file.type) || file.size > 8 * 1024 * 1024) {
      return json(
        {
          error:
            "Cada fotografía debe ser JPG, PNG o WebP y pesar menos de 8 MB.",
        },
        400,
      );
    }
    const extension =
      file.type === "image/png"
        ? "png"
        : file.type === "image/webp"
          ? "webp"
          : "jpg";
    const storagePath = `${incidentId}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from("incident-photos")
      .upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      });
    if (uploadError) throw uploadError;
    const { error: attachmentError } = await supabase
      .from("incident_attachments")
      .insert({
        incident_id: incidentId,
        storage_path: storagePath,
        file_name: file.name || `fotografia.${extension}`,
        mime_type: file.type,
        file_size: file.size,
        uploaded_by: user.id,
        uploaded_by_name: user.name,
      });
    if (attachmentError) throw attachmentError;
    uploaded.push(storagePath);
  }
  return json({ ok: true, uploaded }, 201);
}

async function handleReports(method: string, init: RequestInit) {
  const user = await requireUser();
  if (method === "GET") {
    const { data, error } = await supabase
      .from("report_snapshots")
      .select(
        "id,report_date,report_time,scope,generated_by_name,generated_at,payload",
      )
      .order("generated_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return json({ reports: (data ?? []).map((row) => mapReport(row as RawReport)) });
  }
  if (method === "POST") {
    if (user.role === "viewer") {
      return json({ error: "Tu perfil es solo de consulta." }, 403);
    }
    const body = bodyJson(init);
    if (
      !body.id ||
      !body.reportDate ||
      !body.reportTime ||
      !body.scope ||
      !Array.isArray(body.incidents)
    ) {
      return json({ error: "El informe está incompleto." }, 400);
    }
    const { data, error } = await supabase
      .from("report_snapshots")
      .insert({
        id: body.id,
        report_date: body.reportDate,
        report_time: body.reportTime,
        scope: body.scope,
        generated_by: user.id,
        generated_by_name: user.name,
        payload: body.incidents,
      })
      .select(
        "id,report_date,report_time,scope,generated_by_name,generated_at,payload",
      )
      .single();
    if (error) throw error;
    return json({ report: mapReport(data as RawReport) }, 201);
  }
  return json({ error: "Método no permitido." }, 405);
}

async function handleComments(method: string, init: RequestInit) {
  const user = await requireUser();
  if (method === "GET") {
    const { data, error } = await supabase
      .from("system_comments")
      .select("id,comment,author_name,created_at,systems!inner(official_code)")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    return json({ comments: (data ?? []).map((row) => mapComment(row as unknown as RawComment)) });
  }
  if (method === "POST") {
    if (user.role === "viewer") {
      return json({ error: "Tu perfil es solo de consulta." }, 403);
    }
    const body = bodyJson(init);
    const systemCode = text(body.systemCode);
    const comment = text(body.comment);
    if (!systemCode || comment.length < 3) {
      return json({ error: "Ingresa un comentario válido." }, 400);
    }
    const { data: system, error: systemError } = await supabase
      .from("systems")
      .select("id")
      .eq("official_code", systemCode)
      .limit(1)
      .maybeSingle();
    if (systemError) throw systemError;
    if (!system) return json({ error: "El sistema no existe." }, 404);
    const { data, error } = await supabase
      .from("system_comments")
      .insert({
        system_id: system.id,
        comment,
        author_id: user.id,
        author_name: user.name,
      })
      .select("id,comment,author_name,created_at,systems!inner(official_code)")
      .single();
    if (error) throw error;
    return json({ comment: mapComment(data as unknown as RawComment) }, 201);
  }
  return json({ error: "Método no permitido." }, 405);
}

async function handleUsers(method: string, init: RequestInit) {
  const user = await requireUser();
  if (user.role !== "admin") return json({ error: "No autorizado." }, 401);
  if (method === "GET") {
    const result = await callAdminFunction({ action: "list" });
    return json({ users: (result.users ?? []).map((item: User) => mapUser(item)) });
  }
  const body = bodyJson(init);
  if (method === "POST") {
    const result = await callAdminFunction({ action: "create", ...body });
    return json({ user: mapUser(result.user as User) }, 201);
  }
  if (method === "PATCH") {
    const { userId, ...changes } = body;
    const result = await callAdminFunction({
      action: "update",
      userId,
      ...changes,
    });
    return json({ user: mapUser(result.user as User) });
  }
  return json({ error: "Método no permitido." }, 405);
}

async function handleEmail(init: RequestInit) {
  const user = await requireUser();
  const body = bodyJson(init);
  const eventMap: Record<string, string> = {
    "Nueva falla": "created",
    "Falla resuelta": "resolved",
    "Invitación de usuario": "invitation",
    "Prueba de conexión": "test",
  };
  const event = eventMap[text(body.event)];
  if (!event) return json({ ok: false, error: "Tipo de aviso no permitido." }, 400);
  const result = await callEdgeFunction("send-gmail-notification", {
    event,
    incident_id: body.incidentId,
    recipient: body.recipient,
    user_name: body.userName,
    role: body.role,
    actor: text(body.actor) || user.name,
  });
  return json({ ok: true, id: result.message_id ?? result.id });
}

async function callAdminFunction(body: Record<string, unknown>) {
  return callEdgeFunction("admin-users", body);
}

async function callEdgeFunction(
  name: string,
  body: Record<string, unknown>,
): Promise<Record<string, any>> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("No autorizado. Inicia sesión nuevamente.");
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok) {
    throw new Error(result.error || "No fue posible completar la operación.");
  }
  return result;
}

async function requireUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error("No autorizado. Inicia sesión nuevamente.");
  }
  const user = mapUser(data.user);
  if (!user.active) {
    await supabase.auth.signOut();
    throw new Error("Esta cuenta se encuentra deshabilitada.");
  }
  return user;
}

function mapUser(raw: User) {
  const app = raw.app_metadata ?? {};
  const metadata = raw.user_metadata ?? {};
  const role = isRole(app.role) ? app.role : "viewer";
  const email = raw.email?.toLowerCase() ?? "";
  return {
    id: raw.id,
    email,
    name: text(metadata.name) || email || "Usuario DOH",
    role,
    active: app.active !== false,
    mustChangePassword: app.must_change_password === true,
    jobTitle: text(metadata.job_title) || "Funcionario DOH",
    unit: text(metadata.unit) || "Subdirección Regional SSR",
    region: text(metadata.region) || "La Araucanía",
    createdAt: raw.created_at ?? "",
    lastSignInAt: raw.last_sign_in_at ?? null,
  };
}

function mapIncident(raw: RawIncident) {
  const system = Array.isArray(raw.systems) ? raw.systems[0] : raw.systems;
  const events = [...(raw.incident_events ?? [])].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const followUps = events
    .filter((event) => event.event_type !== "report_created")
    .map((event) => ({
      id: `SEG-${event.id}`,
      text: event.comment || "Actualización registrada",
      author: event.actor_name || "Usuario DOH",
      createdAt: formatChile(event.created_at),
      status:
        event.display_status ||
        (event.to_status === "resolved"
          ? raw.workflow_status || "Resuelto"
          : "En gestión"),
    }));
  const latestEvent = events.at(-1)?.created_at;
  const workflow =
    raw.status === "resolved"
      ? raw.workflow_status || "Resuelto"
      : [...events].reverse().find((event) => event.display_status)
          ?.display_status ||
        raw.workflow_status ||
        "Reportado";
  return {
    id: raw.id,
    code: raw.code,
    system: system?.name || "Sistema SSR",
    systemCode: system?.official_code || "",
    category: raw.category,
    description: raw.description,
    status: workflow,
    priority: priorityFromDatabase(raw.priority),
    water: raw.water_status,
    electricity: raw.electrical_status,
    affected: raw.affected_connections,
    affectedAtReport:
      raw.affected_at_report ?? raw.affected_connections,
    reportedBy: raw.informed_by_name || raw.reported_by_name,
    enteredBy: raw.reported_by_name,
    updatedAt: formatChileTime(latestEvent || raw.updated_at),
    createdAt: formatChile(raw.occurred_at || raw.reported_at || raw.created_at),
    responsible: raw.assigned_to_name || "Por asignar",
    resolvedAt: raw.resolved_at || undefined,
    followUps,
  };
}

function mapReport(raw: RawReport) {
  return {
    id: raw.id,
    reportDate: raw.report_date,
    reportTime: raw.report_time.slice(0, 5),
    scope: raw.scope,
    generatedAt: `${formatChile(raw.generated_at)} · horario de Chile`,
    generatedBy: raw.generated_by_name,
    incidents: raw.payload,
  };
}

function mapComment(raw: RawComment) {
  const system = Array.isArray(raw.systems) ? raw.systems[0] : raw.systems;
  return {
    id: raw.id,
    systemCode: system?.official_code ?? "",
    text: raw.comment,
    author: raw.author_name,
    createdAt: `${formatChile(raw.created_at)} · horario de Chile`,
  };
}

function bodyJson(init: RequestInit): Record<string, any> {
  if (typeof init.body !== "string") return {};
  try {
    return JSON.parse(init.body) as Record<string, any>;
  } catch {
    return {};
  }
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function priorityToDatabase(value: string) {
  if (value === "Crítica") return "critical";
  if (value === "Alta") return "high";
  if (value === "Baja") return "low";
  return "medium";
}

function priorityFromDatabase(value: RawIncident["priority"]) {
  if (value === "critical") return "Crítica";
  if (value === "high") return "Alta";
  if (value === "low") return "Baja";
  return "Media";
}

function isWorkflowStatus(value: string) {
  return [
    "Reportado",
    "En revisión",
    "En gestión",
    "En monitoreo",
    "Resuelto",
    "Cerrado",
  ].includes(value);
}

function isRole(value: unknown): value is AppRole {
  return value === "admin" || value === "reporter" || value === "viewer";
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown) {
  const parsed = Number(value);
  return value === "" || value == null || !Number.isFinite(parsed)
    ? null
    : parsed;
}

function nullableDate(value: string) {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/,
  );
  if (!match) return null;
  const desired = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  const guess = new Date(desired);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHILE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(guess);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);
  const rendered = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
  );
  return new Date(desired + (desired - rendered)).toISOString();
}

function formatChile(value: string) {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: CHILE_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function formatChileTime(value: string) {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: CHILE_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}
