"use client";

import {
  ChangeEvent,
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  regionalSystems,
  type RegionalSystem,
} from "./araucania-systems";
import { apiFetch, assetUrl } from "./client-api";

type Role = "admin" | "reporter" | "viewer";
type View = "home" | "incidents" | "systems" | "reports" | "users";
type IncidentViewFilter = "Iniciados" | "En gestión" | "Resueltos";
type Priority = "Baja" | "Media" | "Alta" | "Crítica";
type IncidentStatus =
  | "Reportado"
  | "En revisión"
  | "En gestión"
  | "En monitoreo"
  | "Resuelto"
  | "Cerrado";

type SystemSSR = RegionalSystem;

type IncidentFollowUp = {
  id: string;
  text: string;
  author: string;
  createdAt: string;
  status: IncidentStatus;
  eventType?: string;
};

type IncidentAttachment = {
  id: string;
  url: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadedBy: string;
  createdAt: string;
};

type Incident = {
  id: string;
  code: string;
  system: string;
  systemCode: string;
  category: string;
  description: string;
  status: IncidentStatus;
  priority: Priority;
  water: string;
  electricity: string;
  affected: number;
  affectedAtReport?: number;
  reportedBy: string;
  enteredBy: string;
  updatedAt: string;
  createdAt: string;
  responsible: string;
  resolvedAt?: string;
  sectors?: string;
  support?: string;
  notes?: string;
  latitude?: number;
  longitude?: number;
  attachments?: IncidentAttachment[];
  followUps?: IncidentFollowUp[];
};

type IncidentPhotoDraft = {
  file: File;
  preview: string;
};

type ReportSnapshot = {
  id: string;
  reportDate: string;
  reportTime: string;
  scope: string;
  generatedAt: string;
  generatedBy: string;
  incidents: Incident[];
  executiveSummary?: string;
  observations?: string;
};

type SystemComment = {
  id: string;
  systemCode: string;
  text: string;
  author: string;
  createdAt: string;
};

type ManagedUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  jobTitle?: string;
  unit?: string;
  region?: string;
  active: boolean;
  createdAt: string;
  lastAccess?: string;
  invitationStatus?: "No enviada" | "Pendiente de envío" | "Enviada";
  mustChangePassword?: boolean;
};

type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  jobTitle: string;
  unit: string;
  region: string;
  createdAt: string;
  lastSignInAt: string | null;
};

type AuthStatus =
  | "loading"
  | "bootstrap"
  | "signedOut"
  | "signedIn"
  | "configuration";

type NotificationQueueItem = {
  id: string;
  incidentCode?: string;
  system: string;
  event:
    | "Nueva falla"
    | "Falla resuelta"
    | "Invitación de usuario"
    | "Prueba de conexión";
  actor: string;
  recipient: string;
  createdAt: string;
  status:
    | "Enviando"
    | "Enviado"
    | "Pendiente de configuración"
    | "Error";
  messageId?: string;
  error?: string;
};

type EmailNotificationInput = {
  incidentId?: string;
  incidentCode?: string;
  system: string;
  event: NotificationQueueItem["event"];
  actor: string;
  recipient?: string;
  commune?: string;
  category?: string;
  description?: string;
  priority?: string;
  resolution?: string;
  userName?: string;
  role?: string;
};

type EmailConnectionStatus = {
  configured: boolean;
  provider: "Gmail API";
  sender: string;
  recipient: string;
  missingConfiguration: number;
};

type Draft = {
  systemCode: string;
  occurredAt: string;
  category: string;
  priority: Priority;
  description: string;
  informedBy: string;
  water: string;
  electricity: string;
  affected: string;
  sectors: string;
  urgent: boolean;
  support: string;
  notes: string;
  latitude: string;
  longitude: string;
};

const systems: SystemSSR[] = regionalSystems;

const RESOLVED_OPERATIONAL_MS = 7 * 24 * 60 * 60 * 1000;
const RESOLVED_HISTORY_MS = 30 * 24 * 60 * 60 * 1000;
const NOTIFICATION_RECIPIENT = "marcelo.ulloa@mop.gov.cl";
const NOTIFICATION_SENDER = "emergenciasdoh@gmail.com";
const NOTIFICATION_QUEUE_KEY = "ssr-notification-queue";
const NOTIFICATION_QUEUE_EVENT = "ssr-notification-queue-updated";
const CHILE_TIME_ZONE = "America/Santiago";
const INTERNAL_REFERENCE_TIMES = ["09:00", "12:00", "15:00", "19:00"];
const PEOPLE_PER_CONNECTION = 4;
const APP_VERSION = "1.3";

function chileDateTimeParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHILE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

function formatChileDateTime(value = new Date()) {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: CHILE_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
}

function userInitials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function readNotificationQueue(): NotificationQueueItem[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(
      window.localStorage.getItem(NOTIFICATION_QUEUE_KEY) ?? "[]",
    ) as NotificationQueueItem[];
  } catch {
    window.localStorage.removeItem(NOTIFICATION_QUEUE_KEY);
    return [];
  }
}

function saveNotificationQueue(items: NotificationQueueItem[]) {
  window.localStorage.setItem(
    NOTIFICATION_QUEUE_KEY,
    JSON.stringify(items.slice(0, 100)),
  );
  window.dispatchEvent(new Event(NOTIFICATION_QUEUE_EVENT));
}

async function sendEmailNotification(
  input: EmailNotificationInput,
): Promise<NotificationQueueItem> {
  const item: NotificationQueueItem = {
    id: `MAIL-${Date.now()}-${input.incidentCode ?? input.event}`,
    incidentCode: input.incidentCode,
    system: input.system,
    event: input.event,
    actor: input.actor,
    recipient: input.recipient ?? NOTIFICATION_RECIPIENT,
    createdAt: new Date().toLocaleString("es-CL", {
      timeZone: CHILE_TIME_ZONE,
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    status: "Enviando",
  };
  saveNotificationQueue([item, ...readNotificationQueue()]);

  let updated: NotificationQueueItem;
  try {
    const response = await apiFetch("/api/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const result = (await response.json()) as {
      ok?: boolean;
      id?: string;
      code?: string;
      error?: string;
    };
    updated = {
      ...item,
      status: result.ok
        ? "Enviado"
        : result.code === "GMAIL_NOT_CONFIGURED"
          ? "Pendiente de configuración"
          : "Error",
      messageId: result.id,
      error: result.ok ? undefined : result.error,
    };
  } catch {
    updated = {
      ...item,
      status: "Error",
      error: "No fue posible contactar el servicio de correo.",
    };
  }

  saveNotificationQueue(
    readNotificationQueue().map((queued) =>
      queued.id === item.id ? updated : queued,
    ),
  );
  return updated;
}

const categoryGroups = [
  {
    label: "Operación e infraestructura",
    options: [
      "Interrupción del suministro de agua",
      "Falla eléctrica externa",
      "Falla eléctrica interna",
      "Falla de bomba",
      "Falla de generador",
      "Falla de tablero o automatización",
      "Rotura de matriz o impulsión",
      "Problema de captación",
      "Problema de estanque",
      "Calidad del agua",
      "Combustible",
      "Infraestructura",
    ],
  },
  {
    label: "Crisis financiera",
    options: [
      "Crisis financiera · quiebra o insolvencia",
      "Crisis financiera · deudas morosas",
      "Crisis financiera · corte por deuda",
      "Crisis financiera · otra situación",
    ],
  },
  {
    label: "Crisis comunitaria",
    options: [
      "Crisis comunitaria · protesta o movilización",
      "Crisis comunitaria · toma u ocupación",
      "Crisis comunitaria · conflicto interno",
      "Crisis comunitaria · otra situación",
    ],
  },
  { label: "Otros", options: ["Otro"] },
];

const roleData: Record<
  Role,
  { name: string; label: string; initials: string; email: string }
> = {
  admin: {
    name: "Marcelo Ulloa",
    label: "Administrador DOH",
    initials: "MU",
    email: "marcelo.ulloa@mop.gov.cl",
  },
  reporter: {
    name: "Usuario Reportante",
    label: "Reportante DOH",
    initials: "UR",
    email: "reportante.ssr@mop.gov.cl",
  },
  viewer: {
    name: "Usuario Consulta",
    label: "Consulta DOH",
    initials: "UC",
    email: "consulta.ssr@mop.gov.cl",
  },
};

const emptyDraft: Draft = {
  systemCode: "",
  occurredAt: "",
  category: "",
  priority: "Media",
  description: "",
  informedBy: "",
  water: "Sin información",
  electricity: "Sin información",
  affected: "",
  sectors: "",
  urgent: false,
  support: "",
  notes: "",
  latitude: "",
  longitude: "",
};

const navItems: { id: View; label: string; short: string; icon: string }[] = [
  { id: "home", label: "Inicio", short: "Inicio", icon: "⌂" },
  { id: "incidents", label: "Incidentes", short: "Reportes", icon: "!" },
  { id: "systems", label: "Sistemas SSR", short: "SSR", icon: "◉" },
  { id: "reports", label: "Informes", short: "Informes", icon: "▤" },
  { id: "users", label: "Usuarios", short: "Usuarios", icon: "◎" },
];

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-CL").format(value);
}

function estimatedPeople(connections: number) {
  return Math.max(0, connections || 0) * PEOPLE_PER_CONNECTION;
}

type PdfImage = {
  dataUrl: string;
  width: number;
  height: number;
};

async function attachmentToPdfImage(
  attachment: IncidentAttachment,
): Promise<PdfImage> {
  if (!attachment.url) {
    throw new Error(`La fotografía ${attachment.fileName} no tiene una URL válida.`);
  }

  const response = await fetch(attachment.url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`No fue posible descargar ${attachment.fileName}.`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () =>
        reject(new Error(`No fue posible procesar ${attachment.fileName}.`));
      element.src = objectUrl;
    });
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    if (!sourceWidth || !sourceHeight) {
      throw new Error(`La fotografía ${attachment.fileName} no tiene dimensiones válidas.`);
    }

    const maxPixelDimension = 1800;
    const reduction = Math.min(
      1,
      maxPixelDimension / Math.max(sourceWidth, sourceHeight),
    );
    const width = Math.max(1, Math.round(sourceWidth * reduction));
    const height = Math.max(1, Math.round(sourceHeight * reduction));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error(`No fue posible preparar ${attachment.fileName}.`);
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    return {
      dataUrl: canvas.toDataURL("image/jpeg", 0.86),
      width,
      height,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function incidentOperationalStage(incident: Incident): IncidentViewFilter {
  if (isResolvedIncident(incident)) return "Resueltos";
  if (incident.status === "Reportado" || incident.status === "En revisión") {
    return "Iniciados";
  }
  return "En gestión";
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .trim();
}

function systemSearchText(system: SystemSSR) {
  return normalizeSearchText(
    `${system.name} ${system.commune} ${system.province} ${system.code}`,
  );
}

function priorityClass(priority: Priority) {
  return `priority priority-${priority.toLowerCase().replace("í", "i")}`;
}

function statusClass(status: IncidentStatus) {
  return `status-dot status-${status.toLowerCase().replaceAll(" ", "-").replace("ó", "o")}`;
}

function roleLabel(role: Role) {
  if (role === "admin") return "Administrador";
  if (role === "reporter") return "Reportante";
  return "Consulta";
}

function notificationStatusClass(status: NotificationQueueItem["status"]) {
  if (status === "Enviado") return "sent";
  if (status === "Error") return "error";
  if (status === "Enviando") return "sending";
  return "pending";
}

function isResolvedIncident(incident: Incident) {
  return incident.status === "Resuelto" || incident.status === "Cerrado";
}

function resolvedAge(incident: Incident, now = Date.now()) {
  if (!isResolvedIncident(incident)) return 0;
  const resolvedTime = incident.resolvedAt
    ? new Date(incident.resolvedAt).getTime()
    : now;
  return Number.isFinite(resolvedTime) ? now - resolvedTime : Number.POSITIVE_INFINITY;
}

function isWithinOperationalResolution(incident: Incident, now = Date.now()) {
  return resolvedAge(incident, now) <= RESOLVED_OPERATIONAL_MS;
}

function isWithinResolvedHistory(incident: Incident, now = Date.now()) {
  return resolvedAge(incident, now) <= RESOLVED_HISTORY_MS;
}

function resolutionFollowUp(incident: Incident) {
  return [...(incident.followUps ?? [])]
    .reverse()
    .find(
      (followUp) =>
        followUp.status === "Resuelto" || followUp.status === "Cerrado",
    );
}

export default function EmergencyApp() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [authUser, setAuthUser] = useState<AuthenticatedUser | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [bootstrapEmail, setBootstrapEmail] = useState(
    "marcelo.ulloa@mop.gov.cl",
  );
  const role: Role = authUser?.role ?? "viewer";
  const [view, setView] = useState<View>("home");
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("Todas");
  const [incidentStatusFilter, setIncidentStatusFilter] =
    useState<IncidentViewFilter>("Iniciados");
  const [online, setOnline] = useState(
    () => (typeof navigator === "undefined" ? true : navigator.onLine),
  );
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [draft, setDraft] = useState<Draft>(() => {
    if (typeof window === "undefined") return emptyDraft;
    const savedDraft = window.localStorage.getItem("ssr-report-draft");
    if (!savedDraft) return emptyDraft;
    try {
      return JSON.parse(savedDraft) as Draft;
    } catch {
      window.localStorage.removeItem("ssr-report-draft");
      return emptyDraft;
    }
  });
  const [photos, setPhotos] = useState<IncidentPhotoDraft[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [toast, setToast] = useState("");
  const [installEvent, setInstallEvent] = useState<Event | null>(null);
  const [generatedReports, setGeneratedReports] = useState<ReportSnapshot[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);

  useEffect(() => {
    let active = true;
    apiFetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("NO_SESSION");
        return response.json() as Promise<{ user: AuthenticatedUser }>;
      })
      .then(({ user }) => {
        if (!active) return;
        setAuthUser(user);
        setAuthStatus("signedIn");
      })
      .catch(async () => {
        try {
          const response = await apiFetch("/api/auth/bootstrap", {
            cache: "no-store",
          });
          const status = (await response.json()) as {
            configured?: boolean;
            required?: boolean;
            email?: string;
          };
          if (!active) return;
          if (status.email) {
            setBootstrapEmail(status.email);
            setLoginEmail(status.email);
          }
          setAuthStatus(
            status.required
              ? "bootstrap"
              : status.configured
                ? "signedOut"
                : "configuration",
          );
        } catch {
          if (active) setAuthStatus("configuration");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (authStatus !== "signedIn") return;
    let active = true;
    Promise.all([
      apiFetch("/api/incidents", { cache: "no-store" }).then(async (response) => {
        const result = (await response.json()) as { incidents?: Incident[]; error?: string };
        if (!response.ok || !result.incidents) throw new Error(result.error || "No fue posible cargar los incidentes.");
        return result.incidents;
      }),
      apiFetch("/api/reports", { cache: "no-store" }).then(async (response) => {
        const result = (await response.json()) as { reports?: ReportSnapshot[]; error?: string };
        if (!response.ok || !result.reports) throw new Error(result.error || "No fue posible cargar los informes.");
        return result.reports;
      }),
    ])
      .then(([incidentRows, reportRows]) => {
        if (!active) return;
        setIncidents(incidentRows.filter((incident) => isWithinResolvedHistory(incident)));
        setGeneratedReports(reportRows);
      })
      .catch((error) => {
        if (active) setToast(error instanceof Error ? error.message : "No fue posible sincronizar los datos.");
      });
    return () => { active = false; };
  }, [authStatus]);

  useEffect(() => {
    const onlineHandler = () => setOnline(true);
    const offlineHandler = () => setOnline(false);
    const installHandler = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event);
    };
    window.addEventListener("online", onlineHandler);
    window.addEventListener("offline", offlineHandler);
    window.addEventListener("beforeinstallprompt", installHandler);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register(assetUrl("sw.js")).catch(() => undefined);
    }
    return () => {
      window.removeEventListener("online", onlineHandler);
      window.removeEventListener("offline", offlineHandler);
      window.removeEventListener("beforeinstallprompt", installHandler);
    };
  }, []);

  useEffect(() => {
    if (!draft.systemCode && !draft.description) return;
    window.localStorage.setItem("ssr-report-draft", JSON.stringify(draft));
  }, [draft]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const pruneExpiredResolved = () => {
      setIncidents((current) => {
        const next = current.filter((incident) =>
          isWithinResolvedHistory(incident),
        );
        if (next.length === current.length) return current;
        return next;
      });
    };
    const interval = window.setInterval(pruneExpiredResolved, 60 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, []);

  const user = authUser
    ? {
        name: authUser.name,
        label: roleData[role].label,
        initials: userInitials(authUser.name),
        email: authUser.email,
      }
    : roleData.viewer;
  const activeIncidents = incidents.filter(
    (incident) => !isResolvedIncident(incident),
  );
  const resolvedHistory = incidents.filter(
    (incident) =>
      isResolvedIncident(incident) && isWithinResolvedHistory(incident),
  );
  const incidentStageCounts: Record<IncidentViewFilter, number> = {
    Iniciados: incidents.filter(
      (incident) => incidentOperationalStage(incident) === "Iniciados",
    ).length,
    "En gestión": incidents.filter(
      (incident) => incidentOperationalStage(incident) === "En gestión",
    ).length,
    Resueltos: incidents.filter(
      (incident) =>
        incidentOperationalStage(incident) === "Resueltos" &&
        isWithinOperationalResolution(incident),
    ).length,
  };
  const filteredIncidents = (() => {
    const normalized = search.trim().toLowerCase();
    return incidents.filter((incident) => {
      const matchesText =
        !normalized ||
        incident.code.toLowerCase().includes(normalized) ||
        incident.system.toLowerCase().includes(normalized) ||
        incident.category.toLowerCase().includes(normalized);
      const matchesPriority =
        priorityFilter === "Todas" || incident.priority === priorityFilter;
      const matchesStatus =
        incidentOperationalStage(incident) === incidentStatusFilter &&
        (incidentStatusFilter !== "Resueltos" ||
          isWithinOperationalResolution(incident));
      return matchesText && matchesPriority && matchesStatus;
    });
  })();

  const totalAffected = activeIncidents.reduce(
    (total, incident) => total + incident.affected,
    0,
  );
  const criticalCount = activeIncidents.filter(
    (incident) => incident.priority === "Crítica",
  ).length;
  const withoutWater = activeIncidents.filter(
    (incident) => incident.water === "Interrumpido" || incident.water === "Parcial",
  ).length;
  const withoutPower = activeIncidents.filter(
    (incident) => incident.electricity === "Sin suministro de red",
  ).length;

  async function login(event: FormEvent) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError("");
    try {
      const response = await apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const result = (await response.json()) as {
        user?: AuthenticatedUser;
        error?: string;
      };
      if (!response.ok || !result.user) {
        throw new Error(result.error || "No fue posible iniciar sesión.");
      }
      setAuthUser(result.user);
      setAuthStatus("signedIn");
      setLoginPassword("");
      setView("home");
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : "No fue posible iniciar sesión.",
      );
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setAuthUser(null);
    setAuthStatus("signedOut");
    setView("home");
  }

  function navigate(target: View) {
    if (target === "users" && role !== "admin") return;
    setView(target);
  }

  function openWizard() {
    if (role === "viewer") return;
    const currentChileTime = chileDateTimeParts();
    setDraft((current) => ({
      ...current,
      occurredAt: current.occurredAt || `${currentChileTime.date}T${currentChileTime.time}`,
    }));
    setWizardStep(1);
    setWizardOpen(true);
  }

  function closeWizard() {
    setWizardOpen(false);
  }

  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function nextStep() {
    if (
      wizardStep === 1 &&
      (!draft.systemCode || !draft.category || !draft.description.trim())
    ) {
      setToast("Completa el sistema, la categoría y la descripción.");
      return;
    }
    setWizardStep((step) => Math.min(3, step + 1));
  }

  function handlePhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).slice(0, 4);
    setPhotos((current) => {
      current.forEach((photo) => URL.revokeObjectURL(photo.preview));
      return files.map((file) => ({ file, preview: URL.createObjectURL(file) }));
    });
  }

  function requestLocation() {
    if (!navigator.geolocation) {
      setToast("La ubicación no está disponible en este dispositivo.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        updateDraft("latitude", position.coords.latitude.toFixed(6));
        updateDraft("longitude", position.coords.longitude.toFixed(6));
        setToast("Ubicación incorporada al reporte.");
      },
      () => setToast("Puedes continuar sin compartir tu ubicación."),
      { enableHighAccuracy: true, timeout: 9000 },
    );
  }

  function queueEmailNotification(
    incident: Incident,
    event: NotificationQueueItem["event"],
    actor: string,
    resolution?: string,
  ) {
    const systemRecord = systems.find(
      (item) => item.code === incident.systemCode,
    );
    void sendEmailNotification({
      incidentId: incident.id,
      incidentCode: incident.code,
      system: incident.system,
      event,
      actor,
      commune: systemRecord?.commune,
      category: incident.category,
      description: incident.description,
      priority: incident.priority,
      resolution,
    });
  }

  async function submitReport() {
    const system = systems.find((item) => item.code === draft.systemCode);
    if (!system) return;
    setToast("Registrando falla…");
    try {
      const response = await apiFetch("/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemCode: draft.systemCode,
          category: draft.category,
          priority: draft.priority,
          description: draft.description,
          affected: draft.affected,
          water: draft.water,
          electricity: draft.electricity,
          informedBy: draft.informedBy,
          occurredAt: draft.occurredAt,
          sectors: draft.sectors,
          support: draft.support,
          notes: draft.notes,
          latitude: draft.latitude,
          longitude: draft.longitude,
        }),
      });
      const result = (await response.json()) as { incident?: Incident; error?: string };
      if (!response.ok || !result.incident) throw new Error(result.error || "No fue posible registrar la falla.");
      let incident = result.incident;
      if (photos.length) {
        const photoData = new FormData();
        photoData.set("incidentId", incident.id);
        photos.forEach((photo) => photoData.append("photos", photo.file));
        const photoResponse = await apiFetch("/api/incidents/photos", { method: "POST", body: photoData });
        if (!photoResponse.ok) {
          const photoResult = (await photoResponse.json()) as { error?: string };
          setToast(`La falla quedó registrada, pero las fotografías no se guardaron: ${photoResult.error ?? "error de carga"}`);
        } else {
          const refreshedResponse = await apiFetch("/api/incidents", {
            cache: "no-store",
          });
          const refreshed = (await refreshedResponse.json()) as {
            incidents?: Incident[];
          };
          incident =
            refreshed.incidents?.find((item) => item.id === incident.id) ??
            incident;
        }
      }
      setIncidents((current) => [incident, ...current]);
      queueEmailNotification(incident, "Nueva falla", user.name);
      setDraft(emptyDraft);
      photos.forEach((photo) => URL.revokeObjectURL(photo.preview));
      setPhotos([]);
      window.localStorage.removeItem("ssr-report-draft");
      setWizardOpen(false);
      setIncidentStatusFilter("Iniciados");
      setView("incidents");
      setToast(`Falla ${incident.code} registrada y sincronizada.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "No fue posible registrar la falla.");
    }
  }

  async function downloadIncidentPdf(incident: Incident) {
    try {
      setToast("Preparando informe y registro fotográfico…");
      let reportIncident = incident;
      if (incident.attachments?.length) {
        try {
          const refreshedResponse = await apiFetch("/api/incidents", {
            cache: "no-store",
          });
          const refreshed = (await refreshedResponse.json()) as {
            incidents?: Incident[];
          };
          reportIncident =
            refreshed.incidents?.find((item) => item.id === incident.id) ??
            incident;
        } catch {
          // Si la actualización falla, todavía se intentan usar los enlaces vigentes.
        }
      }

      const attachments = reportIncident.attachments ?? [];
      const [{ jsPDF }, logoResponse] = await Promise.all([
        import("jspdf"),
        fetch(assetUrl("mop-institucional.png")),
      ]);
      if (!logoResponse.ok) {
        throw new Error("No fue posible cargar la imagen institucional.");
      }
      const logoBlob = await logoResponse.blob();
      const logoDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(logoBlob);
      });
      const photoResults = await Promise.allSettled(
        attachments.map(async (attachment) => ({
          attachment,
          image: await attachmentToPdfImage(attachment),
        })),
      );
      const availablePhotos = photoResults.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const unavailablePhotoCount = attachments.length - availablePhotos.length;
      if (attachments.length && !availablePhotos.length) {
        throw new Error(
          "No fue posible incorporar la fotografía. Actualiza la página e intenta nuevamente.",
        );
      }

      const system = systems.find(
        (item) => item.code === reportIncident.systemCode,
      );
      const document = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });
      const pageWidth = document.internal.pageSize.getWidth();
      const margin = 16;
      const contentWidth = pageWidth - margin * 2;
      let y = 16;

      const ensureSpace = (height: number) => {
        if (y + height <= 279) return;
        document.addPage();
        y = 18;
      };
      const writeWrapped = (
        text: string,
        options?: { size?: number; color?: [number, number, number] },
      ) => {
        const size = options?.size ?? 9;
        const lines = document.splitTextToSize(text || "—", contentWidth);
        document.setFont("helvetica", "normal");
        document.setFontSize(size);
        document.setTextColor(...(options?.color ?? [52, 75, 92]));
        ensureSpace(lines.length * 4.8 + 2);
        document.text(lines, margin, y);
        y += lines.length * 4.8 + 2;
      };
      const sectionTitle = (title: string) => {
        ensureSpace(13);
        document.setDrawColor(201, 219, 229);
        document.line(margin, y, pageWidth - margin, y);
        y += 7;
        document.setFont("helvetica", "bold");
        document.setFontSize(9);
        document.setTextColor(0, 112, 169);
        document.text(title.toUpperCase(), margin, y);
        y += 6;
      };
      const field = (
        label: string,
        value: string,
        x: number,
        width: number,
        rowY: number,
      ) => {
        document.setFillColor(247, 250, 252);
        document.setDrawColor(218, 229, 236);
        document.roundedRect(x, rowY, width, 19, 2, 2, "FD");
        document.setFont("helvetica", "normal");
        document.setFontSize(6.7);
        document.setTextColor(96, 119, 135);
        document.text(label, x + 3, rowY + 5);
        document.setFont("helvetica", "bold");
        document.setFontSize(8.4);
        document.setTextColor(24, 49, 70);
        const lines = document.splitTextToSize(value || "—", width - 6);
        document.text(lines.slice(0, 2), x + 3, rowY + 11);
      };

      document.addImage(logoDataUrl, "PNG", margin, y, 78, 32.7);
      document.setFont("helvetica", "bold");
      document.setFontSize(15);
      document.setTextColor(18, 49, 73);
      document.text("INFORME INDIVIDUAL", pageWidth - margin, y + 7, {
        align: "right",
      });
      document.setFontSize(11);
      document.setTextColor(0, 112, 169);
      document.text("FALLA EN SISTEMA SSR", pageWidth - margin, y + 14, {
        align: "right",
      });
      document.setFont("helvetica", "normal");
      document.setFontSize(7.5);
      document.setTextColor(91, 112, 128);
      document.text(reportIncident.code, pageWidth - margin, y + 21, {
        align: "right",
      });
      y += 39;

      document.setFillColor(0, 112, 169);
      document.rect(margin, y, contentWidth, 1.8, "F");
      y += 10;
      document.setFont("helvetica", "bold");
      document.setFontSize(17);
      document.setTextColor(18, 49, 73);
      document.text(
        document.splitTextToSize(reportIncident.system, contentWidth),
        margin,
        y,
      );
      y += 10;
      document.setFontSize(10);
      document.setTextColor(70, 96, 116);
      document.text(reportIncident.category, margin, y);
      y += 8;

      const gap = 4;
      const half = (contentWidth - gap) / 2;
      field("Región", "La Araucanía", margin, half, y);
      field("Comuna", system?.commune ?? "Sin información", margin + half + gap, half, y);
      y += 23;
      field("Estado", reportIncident.status, margin, half, y);
      field("Prioridad", reportIncident.priority, margin + half + gap, half, y);
      y += 23;
      field("Estado del agua", reportIncident.water, margin, half, y);
      field("Estado eléctrico", reportIncident.electricity, margin + half + gap, half, y);
      y += 23;
      field(
        "Arranques afectados",
        formatNumber(reportIncident.affected),
        margin,
        half,
        y,
      );
      field(
        "Personas afectadas (estimación)",
        formatNumber(estimatedPeople(reportIncident.affected)),
        margin + half + gap,
        half,
        y,
      );
      y += 23;
      field("Responsable actual", reportIncident.responsible, margin, half, y);
      field("Sectores afectados", reportIncident.sectors || "Sin información", margin + half + gap, half, y);
      y += 25;

      sectionTitle("Situación informada");
      writeWrapped(reportIncident.description, { size: 9.5 });

      if (
        reportIncident.support ||
        reportIncident.notes ||
        reportIncident.latitude != null
      ) {
        sectionTitle("Antecedentes complementarios");
        writeWrapped(
          [
            reportIncident.support
              ? `Apoyo requerido: ${reportIncident.support}`
              : "",
            reportIncident.notes
              ? `Observaciones técnicas: ${reportIncident.notes}`
              : "",
            reportIncident.latitude != null &&
            reportIncident.longitude != null
              ? `Coordenadas: ${reportIncident.latitude}, ${reportIncident.longitude}`
              : "",
          ]
            .filter(Boolean)
            .join("\n"),
          { size: 8.5 },
        );
      }

      if (availablePhotos.length) {
        const photoCards = availablePhotos.map(({ attachment, image }, index) => {
          const maxImageWidth = contentWidth - 6;
          const maxImageHeight = 92;
          const scale = Math.min(
            maxImageWidth / image.width,
            maxImageHeight / image.height,
          );
          const imageWidth = image.width * scale;
          const imageHeight = image.height * scale;
          const caption = `Fotografía ${index + 1} · ${attachment.fileName}\n${attachment.uploadedBy} · ${attachment.createdAt}`;
          const captionLines = document.splitTextToSize(
            caption,
            contentWidth - 8,
          ) as string[];
          return {
            attachment,
            image,
            imageWidth,
            imageHeight,
            captionLines,
            height: imageHeight + captionLines.length * 3.7 + 9,
          };
        });

        ensureSpace(13 + photoCards[0].height);
        sectionTitle("Registro fotográfico");
        photoCards.forEach((photo) => {
          ensureSpace(photo.height + 4);
          document.setFillColor(247, 250, 252);
          document.setDrawColor(218, 229, 236);
          document.roundedRect(
            margin,
            y,
            contentWidth,
            photo.height,
            2,
            2,
            "FD",
          );
          const imageX = margin + (contentWidth - photo.imageWidth) / 2;
          document.addImage(
            photo.image.dataUrl,
            "JPEG",
            imageX,
            y + 3,
            photo.imageWidth,
            photo.imageHeight,
            undefined,
            "FAST",
          );
          document.setFont("helvetica", "normal");
          document.setFontSize(7.2);
          document.setTextColor(82, 105, 122);
          document.text(
            photo.captionLines,
            margin + 4,
            y + photo.imageHeight + 7,
          );
          y += photo.height + 4;
        });
        if (unavailablePhotoCount) {
          writeWrapped(
            unavailablePhotoCount === 1
              ? "1 fotografía no pudo incorporarse al documento."
              : `${unavailablePhotoCount} fotografías no pudieron incorporarse al documento.`,
            { size: 7.5, color: [154, 83, 24] },
          );
        }
      }

      sectionTitle("Trazabilidad");
      const events = [
        {
          title: "Reporte ingresado",
          detail: `Por ${reportIncident.enteredBy} · ${reportIncident.createdAt}`,
        },
        ...(reportIncident.followUps ?? []).map((followUp) => ({
          title:
            followUp.status === "Resuelto"
              ? "Alerta cerrada"
              : `Seguimiento · ${followUp.status}`,
          detail: `${followUp.text}\nPor ${followUp.author} · ${followUp.createdAt}`,
        })),
      ];
      events.forEach((event) => {
        ensureSpace(17);
        document.setFillColor(
          event.title === "Alerta cerrada" ? 22 : 0,
          event.title === "Alerta cerrada" ? 129 : 126,
          event.title === "Alerta cerrada" ? 100 : 188,
        );
        document.circle(margin + 1.5, y - 1.2, 1.5, "F");
        document.setFont("helvetica", "bold");
        document.setFontSize(8.5);
        document.setTextColor(24, 49, 70);
        document.text(event.title, margin + 7, y);
        y += 4.5;
        const lines = document.splitTextToSize(event.detail, contentWidth - 7);
        document.setFont("helvetica", "normal");
        document.setFontSize(7.5);
        document.setTextColor(92, 113, 128);
        document.text(lines, margin + 7, y);
        y += lines.length * 4 + 5;
      });

      sectionTitle("Antecedentes del registro");
      writeWrapped(
        `Reportado por: ${reportIncident.reportedBy}\nIngresado por: ${reportIncident.enteredBy}\nCódigo del sistema: ${reportIncident.systemCode}\nProvincia: ${system?.province ?? "Sin información"}`,
        { size: 8.5 },
      );

      const generatedAt = new Date().toLocaleString("es-CL", {
        timeZone: CHILE_TIME_ZONE,
        dateStyle: "long",
        timeStyle: "short",
      });
      const pageCount = document.getNumberOfPages();
      for (let page = 1; page <= pageCount; page += 1) {
        document.setPage(page);
        document.setFont("helvetica", "normal");
        document.setFontSize(7);
        document.setTextColor(105, 124, 138);
        document.text(
          `Informe generado por ${user.name} · ${generatedAt}`,
          margin,
          289,
        );
        document.text(`Página ${page} de ${pageCount}`, pageWidth - margin, 289, {
          align: "right",
        });
      }

      const safeSystemName = reportIncident.system
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase();
      document.save(
        `informe-falla-${reportIncident.code}-${safeSystemName}.pdf`,
      );
      setToast(
        availablePhotos.length
          ? `Informe ${reportIncident.code} descargado con ${availablePhotos.length} fotografía${availablePhotos.length === 1 ? "" : "s"}.`
          : `Informe ${reportIncident.code} descargado en PDF.`,
      );
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "No fue posible generar el informe. Intenta nuevamente.",
      );
    }
  }

  async function addIncidentFollowUp(
    incidentCode: string,
    text: string,
    nextStatus: IncidentStatus,
  ) {
    const currentIncident = incidents.find((item) => item.code === incidentCode);
    if (!currentIncident) return;
    setToast("Guardando seguimiento…");
    try {
      const response = await apiFetch("/api/incidents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: currentIncident.id, comment: text.trim(), nextStatus }),
      });
      const result = (await response.json()) as { incident?: Incident; error?: string };
      if (!response.ok || !result.incident) throw new Error(result.error || "No fue posible guardar el seguimiento.");
      setIncidents((current) => current.map((incident) => incident.id === result.incident!.id ? result.incident! : incident));
      setSelectedIncident(result.incident);
      if (nextStatus === "Resuelto" || nextStatus === "Cerrado") {
        queueEmailNotification(result.incident, "Falla resuelta", user.name, text.trim());
      }
      setToast(nextStatus === "Resuelto" || nextStatus === "Cerrado" ? "Alerta resuelta y sincronizada." : "Seguimiento guardado en el historial.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "No fue posible guardar el seguimiento.");
    }
  }

  function downloadReportCsv(
    reportIncidents: Incident[],
    reportDate: string,
    reportTime: string,
  ) {
    const rows = [
      [
        "Código",
        "SSR",
        "Provincia",
        "Comuna",
        "Categoría",
        "Estado",
        "Prioridad",
        "Agua",
        "Electricidad",
        "Arranques afectados",
        "Personas afectadas (estimación)",
        "Sectores afectados",
        "Apoyo requerido",
        "Observaciones técnicas",
        "Latitud",
        "Longitud",
        "Responsable",
        "Reportado por",
        "Ingresado por",
        "Actualización",
      ],
      ...reportIncidents.map((incident) => {
        const system = systems.find((item) => item.code === incident.systemCode);
        return [
          incident.code,
          incident.system,
          system?.province ?? "",
          system?.commune ?? "",
          incident.category,
          incident.status,
          incident.priority,
          incident.water,
          incident.electricity,
          String(incident.affected),
          String(estimatedPeople(incident.affected)),
          incident.sectors ?? "",
          incident.support ?? "",
          incident.notes ?? "",
          incident.latitude == null ? "" : String(incident.latitude),
          incident.longitude == null ? "" : String(incident.longitude),
          incident.responsible,
          incident.reportedBy,
          incident.enteredBy,
          incident.updatedAt,
        ];
      }),
    ];
    const csv = rows
      .map((row) =>
        row.map((value) => `"${value.replaceAll('"', '""')}"`).join(";"),
      )
      .join("\n");
    const blob = new Blob([`\uFEFF${csv}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `informe-ssr-${reportDate}-${reportTime.replace(":", "")}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setToast(`Informe emitido a las ${reportTime} descargado en CSV.`);
  }

  function downloadResolvedHistoryCsv(history: Incident[]) {
    const rows = [
      [
        "Código",
        "SSR",
        "Provincia",
        "Comuna",
        "Categoría",
        "Prioridad",
        "Reportado por",
        "Ingresado por",
        "Fecha de ingreso",
        "Arranques afectados al reportar",
        "Personas afectadas al reportar (estimación)",
        "Fecha de resolución",
        "Resuelto por",
        "Cómo se resolvió",
      ],
      ...history.map((incident) => {
        const system = systems.find((item) => item.code === incident.systemCode);
        const resolution = resolutionFollowUp(incident);
        return [
          incident.code,
          incident.system,
          system?.province ?? "",
          system?.commune ?? "",
          incident.category,
          incident.priority,
          incident.reportedBy,
          incident.enteredBy,
          incident.createdAt,
          String(incident.affectedAtReport ?? incident.affected),
          String(
            estimatedPeople(incident.affectedAtReport ?? incident.affected),
          ),
          resolution?.createdAt ??
            (incident.resolvedAt
              ? new Date(incident.resolvedAt).toLocaleString("es-CL", {
                  timeZone: CHILE_TIME_ZONE,
                })
              : ""),
          resolution?.author ?? "",
          resolution?.text ?? "",
        ];
      }),
    ];
    const csv = rows
      .map((row) =>
        row.map((value) => `"${value.replaceAll('"', '""')}"`).join(";"),
      )
      .join("\n");
    const blob = new Blob([`\uFEFF${csv}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "historico-fallas-resueltas-ultimos-30-dias.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    setToast("Histórico de fallas resueltas descargado en CSV.");
  }

  async function generateReport(
    reportDate: string,
    reportTime: string,
    reportIncidents: Incident[],
    scope: string,
    executiveSummary: string,
    observations: string,
  ) {
    const versions = generatedReports.filter(
      (report) =>
        report.reportDate === reportDate && report.reportTime === reportTime,
    ).length;
    const compactDate = reportDate.replaceAll("-", "");
    const compactTime = reportTime.replace(":", "");
    const snapshot: ReportSnapshot = {
      id: `INF-${compactDate}-${compactTime}-V${versions + 1}`,
      reportDate,
      reportTime,
      scope,
      generatedAt: `${formatChileDateTime()} · horario de Chile`,
      generatedBy: user.name,
      incidents: reportIncidents.map((incident) => ({ ...incident })),
      executiveSummary: executiveSummary.trim(),
      observations: observations.trim(),
    };
    try {
      const response = await apiFetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: snapshot.id,
          reportDate,
          reportTime,
          scope,
          incidents: snapshot.incidents,
          executiveSummary: snapshot.executiveSummary,
          observations: snapshot.observations,
        }),
      });
      const result = (await response.json()) as { report?: ReportSnapshot; error?: string };
      if (!response.ok || !result.report) throw new Error(result.error || "No fue posible respaldar el informe.");
      setGeneratedReports((current) => [result.report!, ...current]);
      setToast(`Informe ${result.report.id} generado y respaldado.`);
      return result.report.id;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "No fue posible respaldar el informe.");
      return "";
    }
  }

  async function downloadSituationPdf(
    reportIncidents: Incident[],
    reportDate: string,
    reportTime: string,
    scope: string,
    generatedBy: string,
    executiveSummary: string,
    observations: string,
  ) {
    try {
      const { jsPDF } = await import("jspdf");
      const document = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageWidth = document.internal.pageSize.getWidth();
      const margin = 14;
      const widths = [70, 28, 45, 30, 48, 28];
      const labels = ["Sistema SSR", "Comuna", "Situación", "Agua", "Electricidad", "Arranques"];
      let y = 18;
      const drawTitle = () => {
        document.setTextColor(0, 96, 151);
        document.setFont("helvetica", "bold");
        document.setFontSize(15);
        document.text("INFORME DE SITUACIÓN SSR", margin, y);
        document.setFontSize(8);
        document.setTextColor(86, 109, 126);
        document.text(`${scope} · ${reportDate} · ${reportTime} h · horario de Chile`, margin, y + 7);
        document.text(`Preparado por ${generatedBy}`, pageWidth - margin, y + 7, { align: "right" });
        y += 16;
      };
      const drawTableHeader = () => {
        document.setFillColor(0, 112, 169);
        document.rect(margin, y, widths.reduce((sum, width) => sum + width, 0), 9, "F");
        document.setTextColor(255, 255, 255);
        document.setFont("helvetica", "bold");
        document.setFontSize(7.2);
        let x = margin;
        labels.forEach((label, index) => {
          document.text(label, x + 2, y + 5.8);
          x += widths[index];
        });
        y += 9;
      };
      drawTitle();
      const totalAffected = reportIncidents.reduce((total, incident) => total + incident.affected, 0);
      document.setFillColor(231, 243, 251);
      document.roundedRect(margin, y, pageWidth - margin * 2, 13, 2, 2, "F");
      document.setTextColor(19, 54, 76);
      document.setFontSize(9);
      document.text(`${reportIncidents.length} incidentes activos`, margin + 5, y + 8);
      document.text(`${new Set(reportIncidents.map((incident) => incident.systemCode)).size} sistemas afectados`, margin + 70, y + 8);
      document.text(`${formatNumber(totalAffected)} arranques afectados`, margin + 145, y + 8);
      y += 18;
      const narrative = [
        executiveSummary.trim()
          ? `Resumen ejecutivo: ${executiveSummary.trim()}`
          : "",
        observations.trim() ? `Observaciones: ${observations.trim()}` : "",
      ].filter(Boolean);
      if (narrative.length) {
        document.setTextColor(52, 75, 92);
        document.setFont("helvetica", "normal");
        document.setFontSize(7.5);
        const narrativeLines = document
          .splitTextToSize(narrative.join("\n"), pageWidth - margin * 2)
          .slice(0, 8);
        document.text(narrativeLines, margin, y);
        y += narrativeLines.length * 4 + 4;
      }
      drawTableHeader();
      reportIncidents.forEach((incident, rowIndex) => {
        if (y > 184) {
          document.addPage();
          y = 18;
          drawTitle();
          drawTableHeader();
        }
        const system = systems.find((item) => item.code === incident.systemCode);
        const values = [incident.system, system?.commune ?? "—", incident.category, incident.water, incident.electricity, formatNumber(incident.affected)];
        const lines = values.map((value, index) => document.splitTextToSize(value, widths[index] - 4).slice(0, 2));
        const height = Math.max(10, ...lines.map((item) => item.length * 4 + 3));
        const shade = rowIndex % 2 === 0 ? 255 : 248;
        document.setFillColor(shade, rowIndex % 2 === 0 ? 255 : 251, rowIndex % 2 === 0 ? 255 : 252);
        document.rect(margin, y, widths.reduce((sum, width) => sum + width, 0), height, "F");
        document.setDrawColor(222, 232, 238);
        document.line(margin, y + height, margin + widths.reduce((sum, width) => sum + width, 0), y + height);
        document.setTextColor(37, 61, 79);
        document.setFont("helvetica", "normal");
        document.setFontSize(7);
        let x = margin;
        lines.forEach((cell, index) => {
          document.text(cell, x + 2, y + 4.5);
          x += widths[index];
        });
        y += height;
      });
      if (!reportIncidents.length) {
        document.setTextColor(90, 112, 128);
        document.text("Sin incidentes activos al momento de la emisión.", margin + 2, y + 8);
      }
      document.save(`informe-situacion-ssr-${reportDate}-${reportTime.replace(":", "")}.pdf`);
      setToast(`Informe emitido a las ${reportTime} descargado en PDF.`);
    } catch {
      setToast("No fue posible generar el PDF. Intenta nuevamente.");
    }
  }

  async function installApp() {
    if (!installEvent) {
      setToast("Abre el menú del navegador y elige «Instalar aplicación».");
      return;
    }
    const promptEvent = installEvent as Event & { prompt: () => Promise<void> };
    await promptEvent.prompt();
    setInstallEvent(null);
  }

  if (authStatus === "loading") {
    return (
      <main className="login-page auth-loading-page">
        <section className="login-panel">
          <div className="login-card auth-loading-card">
            <span className="access-chip"><i /> Acceso interno DOH</span>
            <h2>Preparando acceso seguro</h2>
            <p className="muted">Verificando la sesión de la plataforma…</p>
          </div>
        </section>
      </main>
    );
  }

  if (authStatus === "bootstrap") {
    return (
      <AdminBootstrap
        email={bootstrapEmail}
        onCreated={(createdUser) => {
          setAuthUser(createdUser);
          setAuthStatus("signedIn");
          setView("home");
        }}
      />
    );
  }

  if (authStatus === "configuration") {
    return (
      <main className="login-page">
        <section className="login-brand">
          <div className="login-brand-inner">
            <InstitutionalBrand light />
            <div className="brand-copy">
              <span className="eyebrow light">Gestión regional · La Araucanía</span>
              <h1>Gestión de Emergencias SSR</h1>
              <p>La plataforma está preparada. Falta activar el acceso de cuentas.</p>
            </div>
          </div>
        </section>
        <section className="login-panel">
          <div className="login-card">
            <span className="access-chip"><i /> Configuración protegida</span>
            <h2>Activación pendiente</h2>
            <p className="muted">
              La conexión de usuarios todavía requiere la clave privada del
              servidor. No se habilitó ningún registro público.
            </p>
            <AppCredit context="login" />
          </div>
        </section>
      </main>
    );
  }

  if (authStatus === "signedOut") {
    return (
      <main className="login-page">
        <section className="login-brand">
          <div className="login-brand-inner">
            <InstitutionalBrand light />
            <div className="brand-copy">
              <span className="eyebrow light">Gestión regional · La Araucanía</span>
              <h1>Gestión de Emergencias SSR</h1>
              <p>
                Reportes, seguimiento y trazabilidad para una respuesta DOH más
                rápida en terreno.
              </p>
            </div>
            <div className="brand-feature-grid" aria-label="Funciones principales">
              <div>
                <span>01</span>
                <strong>Reporte en terreno</strong>
                <small>Fotografías, ubicación y afectación</small>
              </div>
              <div>
                <span>02</span>
                <strong>Seguimiento íntegro</strong>
                <small>Responsables y línea de tiempo</small>
              </div>
              <div>
                <span>03</span>
                <strong>Informes abiertos</strong>
                <small>Emisión libre con respaldo e historial</small>
              </div>
            </div>
          </div>
        </section>

        <section className="login-panel">
          <div className="login-card">
            <div className="mobile-brand">
              <InstitutionalBrand />
            </div>
            <span className="access-chip">
              <i />
              Acceso interno DOH · v{APP_VERSION}
            </span>
            <h2>Acceso funcionarios DOH</h2>
            <p className="muted">
              Ingresa con tu cuenta institucional. No existe registro público.
            </p>
            <form onSubmit={login}>
              <label>
                Correo institucional
                <input
                  type="email"
                  placeholder="nombre@mop.gov.cl"
                  autoComplete="email"
                  value={loginEmail}
                  onChange={(event) => setLoginEmail(event.target.value)}
                  required
                />
              </label>
              <label>
                Contraseña
                <div className="password-field">
                  <input
                    type="password"
                    placeholder="Ingresa tu contraseña"
                    autoComplete="current-password"
                    value={loginPassword}
                    onChange={(event) => setLoginPassword(event.target.value)}
                    required
                  />
                  <span aria-hidden>◉</span>
                </div>
              </label>
              {authError && <p className="auth-error">{authError}</p>}
              <button className="primary-button full" type="submit" disabled={authBusy}>
                {authBusy ? "Verificando…" : "Ingresar a la aplicación"}
              </button>
            </form>
            <p className="password-help">
              Si olvidaste tu contraseña, un administrador puede restablecerla
              desde el menú Usuarios.
            </p>
            <p className="security-note">
              Acceso controlado · La actividad queda registrada
            </p>
            <AppCredit context="login" />
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <InstitutionalBrand />
        <div className="product-name">
          <span>Gestión de</span>
          <strong>Emergencias SSR</strong>
          <small>La Araucanía · Versión {APP_VERSION}</small>
        </div>
        <nav aria-label="Navegación principal">
          {navItems
            .filter((item) => item.id !== "users" || role === "admin")
            .map((item) => (
              <button
                type="button"
                key={item.id}
                className={view === item.id ? "active" : ""}
                onClick={() => navigate(item.id)}
              >
                <span>{item.icon}</span>
                {item.label}
                {item.id === "incidents" && <b>{activeIncidents.length}</b>}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="install-button" type="button" onClick={installApp}>
            <span>↓</span>
            Instalar aplicación
          </button>
          <div className={`connection ${online ? "online" : "offline"}`}>
            <i />
            {online ? "Conectado" : "Sin conexión"}
          </div>
          <button className="sidebar-profile" type="button" onClick={signOut}>
            <span className="avatar avatar-admin">{user.initials}</span>
            <span>
              <strong>{user.name}</strong>
              <small>{user.label}</small>
            </span>
            <b>↗</b>
          </button>
          <AppCredit compact />
        </div>
      </aside>

      <div className="app-content">
        <header className="topbar">
          <div className="topbar-brand">
            <div className="mini-logo">DOH</div>
            <span>Emergencias SSR</span>
          </div>
          <div className="topbar-actions">
            <div className={`connection compact ${online ? "online" : "offline"}`}>
              <i />
              {online ? "En línea" : "Sin señal"}
            </div>
            <button className="avatar avatar-admin" type="button" onClick={signOut}>
              {user.initials}
            </button>
          </div>
        </header>

        <main className="main-content">
          {view === "home" && (
            <Dashboard
              role={role}
              user={user}
              incidents={incidents}
              activeIncidents={activeIncidents}
              criticalCount={criticalCount}
              withoutWater={withoutWater}
              withoutPower={withoutPower}
              totalAffected={totalAffected}
              openWizard={openWizard}
              openIncident={setSelectedIncident}
              navigate={navigate}
            />
          )}
          {view === "incidents" && (
            <IncidentsView
              role={role}
              incidents={filteredIncidents}
              search={search}
              setSearch={setSearch}
              priorityFilter={priorityFilter}
              setPriorityFilter={setPriorityFilter}
              statusFilter={incidentStatusFilter}
              setStatusFilter={setIncidentStatusFilter}
              stageCounts={incidentStageCounts}
              openWizard={openWizard}
              openIncident={setSelectedIncident}
            />
          )}
          {view === "systems" && (
            <SystemsView
              incidents={incidents}
              canComment={role !== "viewer"}
            />
          )}
          {view === "reports" && (
            <ReportsView
              incidents={incidents}
              activeIncidents={activeIncidents}
              resolvedHistory={resolvedHistory}
              generatedReports={generatedReports}
              user={user}
              downloadCsv={downloadReportCsv}
              downloadResolvedHistory={downloadResolvedHistoryCsv}
              generateReport={generateReport}
              downloadPdf={downloadSituationPdf}
              openIncident={setSelectedIncident}
            />
          )}
          {view === "users" && role === "admin" && (
            <UsersView currentUser={authUser!} />
          )}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Navegación móvil">
        {navItems
          .filter((item) => item.id !== "users")
          .slice(0, 4)
          .map((item) => (
            <button
              type="button"
              key={item.id}
              className={view === item.id ? "active" : ""}
              onClick={() => navigate(item.id)}
            >
              <span>{item.icon}</span>
              <small>{item.short}</small>
            </button>
          ))}
      </nav>

      {wizardOpen && (
        <ReportWizard
          step={wizardStep}
          draft={draft}
          incidents={incidents}
          photos={photos}
          updateDraft={updateDraft}
          handlePhotos={handlePhotos}
          requestLocation={requestLocation}
          close={closeWizard}
          back={() => setWizardStep((step) => Math.max(1, step - 1))}
          next={nextStep}
          submit={submitReport}
          user={user}
        />
      )}

      {selectedIncident && (
        <IncidentDetail
          incident={selectedIncident}
          close={() => setSelectedIncident(null)}
          canFollowUp={role !== "viewer"}
          canResolve={role === "admin"}
          addFollowUp={addIncidentFollowUp}
          downloadReport={downloadIncidentPdf}
        />
      )}

      {authUser?.mustChangePassword && (
        <PasswordChange
          onChanged={() =>
            setAuthUser((current) =>
              current ? { ...current, mustChangePassword: false } : current,
            )
          }
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function AdminBootstrap({
  email,
  onCreated,
}: {
  email: string;
  onCreated: (user: AuthenticatedUser) => void;
}) {
  const [name, setName] = useState("Marcelo Andrés Ulloa Solís");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function createAdministrator(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 12) {
      setError("La contraseña debe contener al menos 12 caracteres.");
      return;
    }
    if (password !== confirmation) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      const response = await apiFetch("/api/auth/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });
      const result = (await response.json()) as {
        user?: AuthenticatedUser;
        error?: string;
      };
      if (!response.ok || !result.user) {
        throw new Error(result.error || "No fue posible crear la cuenta.");
      }
      onCreated(result.user);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "No fue posible crear la cuenta.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page bootstrap-page">
      <section className="login-brand">
        <div className="login-brand-inner">
          <InstitutionalBrand light />
          <div className="brand-copy">
            <span className="eyebrow light">Configuración inicial protegida</span>
            <h1>Crea tu cuenta principal</h1>
            <p>
              Esta cuenta será la administradora permanente. Desde ella podrás
              crear, habilitar, suspender y asignar perfiles a otros usuarios.
            </p>
          </div>
          <div className="brand-feature-grid" aria-label="Controles de acceso">
            <div><span>01</span><strong>Sin registro público</strong><small>Solo el administrador crea cuentas</small></div>
            <div><span>02</span><strong>Perfiles definidos</strong><small>Administrador, reportante y consulta</small></div>
            <div><span>03</span><strong>Control inmediato</strong><small>Habilitar o suspender accesos</small></div>
          </div>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-card bootstrap-card">
          <span className="access-chip"><i /> Cuenta principal DOH</span>
          <h2>Administrador inicial</h2>
          <p className="muted">
            Define tu contraseña aquí. No se mostrará ni se enviará por correo.
          </p>
          <form onSubmit={createAdministrator}>
            <label>
              Nombre completo
              <input value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
            <label>
              Correo institucional
              <input type="email" value={email} readOnly aria-readonly="true" />
            </label>
            <label>
              Contraseña principal
              <div className="password-field">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={12}
                  autoComplete="new-password"
                  required
                />
                <button
                  className="password-visibility"
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? "Ocultar" : "Ver"}
                </button>
              </div>
            </label>
            <label>
              Confirmar contraseña
              <input
                type={showPassword ? "text" : "password"}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                minLength={12}
                autoComplete="new-password"
                required
              />
            </label>
            <small className="password-rules">
              Mínimo 12 caracteres. Se recomienda combinar mayúsculas,
              minúsculas, números y símbolos.
            </small>
            {error && <p className="auth-error">{error}</p>}
            <button className="primary-button full" type="submit" disabled={busy}>
              {busy ? "Creando cuenta…" : "Crear cuenta principal"}
            </button>
          </form>
          <AppCredit context="login" />
        </div>
      </section>
    </main>
  );
}

function PasswordChange({ onChanged }: { onChanged: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 12) {
      setError("La contraseña debe contener al menos 12 caracteres.");
      return;
    }
    if (password !== confirmation) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      const response = await apiFetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error || "No fue posible cambiar la contraseña.");
      }
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No fue posible cambiar la contraseña.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop auth-modal" role="dialog" aria-modal="true">
      <form className="panel password-change-card" onSubmit={submit}>
        <span className="eyebrow">Primer ingreso</span>
        <h2>Define tu contraseña personal</h2>
        <p>
          La cuenta fue creada con una clave temporal. Antes de continuar debes
          reemplazarla por una contraseña personal.
        </p>
        <label>
          Nueva contraseña
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={12}
            autoComplete="new-password"
            required
          />
        </label>
        <label>
          Confirmar contraseña
          <input
            type="password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            minLength={12}
            autoComplete="new-password"
            required
          />
        </label>
        {error && <p className="auth-error">{error}</p>}
        <button className="primary-button full" type="submit" disabled={busy}>
          {busy ? "Actualizando…" : "Guardar nueva contraseña"}
        </button>
      </form>
    </div>
  );
}

function InstitutionalBrand({ light = false }: { light?: boolean }) {
  return (
    <div className={`institutional-brand ${light ? "brand-light" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={assetUrl("mop-institucional.png")}
        alt="Ministerio de Obras Públicas, Gobierno de Chile. Trabajando para usted."
      />
      <span>Dirección de Obras Hidráulicas</span>
    </div>
  );
}

function AppCredit({
  compact = false,
  context = "default",
}: {
  compact?: boolean;
  context?: "default" | "login";
}) {
  return (
    <div
      className={`app-credit ${compact ? "compact" : ""} ${
        context === "login" ? "login-credit" : ""
      }`}
    >
      <span className="developer-monogram" aria-hidden>
        MUS
      </span>
      <span className="developer-identity">
        <small>Diseño y desarrollo</small>
        <strong>Marcelo Andrés Ulloa Solís</strong>
        {!compact && <em>Ingeniero Eléctrico</em>}
        <a href="mailto:marcelo.ulloa@mop.gov.cl">
          marcelo.ulloa@mop.gov.cl
        </a>
      </span>
      {!compact && (
        <span className="developer-rights">
          © 2026 Marcelo Andrés Ulloa Solís · Todos los derechos reservados.
        </span>
      )}
    </div>
  );
}

function Dashboard({
  role,
  user,
  incidents,
  activeIncidents,
  criticalCount,
  withoutWater,
  withoutPower,
  totalAffected,
  openWizard,
  openIncident,
  navigate,
}: {
  role: Role;
  user: (typeof roleData)[Role];
  incidents: Incident[];
  activeIncidents: Incident[];
  criticalCount: number;
  withoutWater: number;
  withoutPower: number;
  totalAffected: number;
  openWizard: () => void;
  openIncident: (incident: Incident) => void;
  navigate: (view: View) => void;
}) {
  const today = new Intl.DateTimeFormat("es-CL", {
    timeZone: CHILE_TIME_ZONE,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date());
  const chileHour = Number(
    new Intl.DateTimeFormat("es-CL", {
      timeZone: CHILE_TIME_ZONE,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date()),
  );
  const greeting = chileHour < 12 ? "Buenos días" : chileHour < 19 ? "Buenas tardes" : "Buenas noches";
  const affectedSystemCodes = new Set(
    activeIncidents.map((incident) => incident.systemCode),
  );
  const criticalSystemCodes = new Set(
    activeIncidents
      .filter((incident) => incident.priority === "Crítica")
      .map((incident) => incident.systemCode),
  );
  const affectedSystems = affectedSystemCodes.size;
  const clearSystems = Math.max(0, systems.length - affectedSystems);
  const trackingSystems = Math.max(
    0,
    affectedSystems - criticalSystemCodes.size,
  );
  const clearPercent = (clearSystems / systems.length) * 100;
  const trackingPercent =
    ((clearSystems + trackingSystems) / systems.length) * 100;

  return (
    <>
      <section className="page-heading">
        <div>
          <span className="eyebrow">{today}</span>
          <h1>{greeting}, {user.name.split(" ")[0]}</h1>
          <p>
            {role === "viewer"
              ? "Consulta el estado actualizado de los sistemas de La Araucanía."
              : "Este es el estado operativo regional de los sistemas SSR."}
          </p>
        </div>
        {role !== "viewer" && (
          <button className="primary-button" type="button" onClick={openWizard}>
            <span>＋</span>
            Nuevo reporte
          </button>
        )}
      </section>

      <section className="cutoff-banner">
        <div className="cutoff-time">
          <span>INFORME</span>
          <strong>Libre</strong>
        </div>
        <div>
          <strong>Emite un estado operativo cuando sea necesario</strong>
          <p>
            {activeIncidents.length} incidentes activos · 316 sistemas bajo
            cobertura regional
          </p>
        </div>
        <button type="button" onClick={() => navigate("reports")}>
          Generar informe <span>→</span>
        </button>
      </section>

      <section className="metrics-grid">
        <MetricCard
          label="Incidentes activos"
          value={activeIncidents.length}
          note="Actualización continua"
          tone="blue"
          icon="!"
        />
        <MetricCard
          label="Prioridad crítica"
          value={criticalCount}
          note="Requiere seguimiento"
          tone="red"
          icon="↑"
        />
        <MetricCard
          label="Sistemas con afectación"
          value={withoutWater}
          note={`${withoutPower} sin suministro eléctrico`}
          tone="amber"
          icon="◒"
        />
        <MetricCard
          label="Arranques afectados"
          value={formatNumber(totalAffected)}
          note={`≈ ${formatNumber(estimatedPeople(totalAffected))} personas`}
          tone="teal"
          icon="⌁"
        />
      </section>

      <section className="dashboard-grid">
        <div className="panel main-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Atención prioritaria</span>
              <h2>Incidentes activos</h2>
            </div>
            <button type="button" onClick={() => navigate("incidents")}>
              Ver todos <span>→</span>
            </button>
          </div>
          <div className="incident-list compact-list">
            {activeIncidents.slice(0, 4).map((incident) => (
              <IncidentRow
                key={incident.code}
                incident={incident}
                onClick={() => openIncident(incident)}
              />
            ))}
            {!activeIncidents.length && (
              <div className="empty-state dashboard-empty">
                <span>✓</span>
                <strong>No existen incidentes activos</strong>
                <p>Los sistemas reportados como normalizados ya no aparecen aquí.</p>
              </div>
            )}
          </div>
        </div>

        <aside className="right-column">
          <div className="panel distribution-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Cobertura regional</span>
                <h2>Estado general</h2>
              </div>
            </div>
            <div className="donut-wrap">
              <div
                className="donut"
                style={{
                  background: `conic-gradient(var(--teal) 0 ${clearPercent}%, var(--amber) ${clearPercent}% ${trackingPercent}%, var(--red) ${trackingPercent}% 100%)`,
                }}
              >
                <div>
                  <strong>{systems.length}</strong>
                  <span>SSR</span>
                </div>
              </div>
              <div className="legend">
                <span>
                  <i className="normal" /> Sin incidentes <b>{clearSystems}</b>
                </span>
                <span>
                  <i className="attention" /> En seguimiento{" "}
                  <b>{trackingSystems}</b>
                </span>
                <span>
                  <i className="critical" /> Crítico{" "}
                  <b>{criticalSystemCodes.size}</b>
                </span>
              </div>
            </div>
          </div>
          <div className="panel activity-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Trazabilidad</span>
                <h2>Actividad reciente</h2>
              </div>
            </div>
            <div className="activity-list">
              {incidents.slice(0, 3).map((incident) => (
                <div key={incident.code}>
                  <span
                    className={`activity-icon ${
                      incident.status === "Resuelto" ||
                      incident.status === "Cerrado"
                        ? "green"
                        : "blue"
                    }`}
                  >
                    {incident.status === "Resuelto" ||
                    incident.status === "Cerrado"
                      ? "✓"
                      : "↗"}
                  </span>
                  <p>
                    <strong>{incident.enteredBy}</strong>{" "}
                    {incident.status === "Resuelto" ||
                    incident.status === "Cerrado"
                      ? "cerró"
                      : "registró"}{" "}
                    {incident.code}
                    <small>Actualizado {incident.updatedAt}</small>
                  </p>
                </div>
              ))}
              {!incidents.length && (
                <div className="activity-empty">
                  <span className="activity-icon green">✓</span>
                  <p>
                    <strong>Sin actividad registrada</strong>
                    <small>Los nuevos reportes aparecerán en este panel.</small>
                  </p>
                </div>
              )}
            </div>
          </div>
        </aside>
      </section>
    </>
  );
}

function MetricCard({
  label,
  value,
  note,
  tone,
  icon,
}: {
  label: string;
  value: string | number;
  note: string;
  tone: string;
  icon: string;
}) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <div className="metric-top">
        <span>{label}</span>
        <i>{icon}</i>
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function IncidentRow({
  incident,
  onClick,
}: {
  incident: Incident;
  onClick: () => void;
}) {
  const resolved = isResolvedIncident(incident);
  const resolution = resolutionFollowUp(incident);
  const actor = resolved
    ? resolution?.author ?? incident.enteredBy
    : incident.enteredBy;
  return (
    <button className="incident-row" type="button" onClick={onClick}>
      <span className={statusClass(incident.status)} />
      <span className="incident-main">
        <span className="incident-code">
          {incident.code}
        </span>
        <strong>{incident.system}</strong>
        <small>{incident.category}</small>
      </span>
      <span className="incident-impact">
        <small>Afectación</small>
        <strong>{formatNumber(incident.affected)} arranques</strong>
        <em>≈ {formatNumber(estimatedPeople(incident.affected))} personas</em>
      </span>
      <span className={priorityClass(incident.priority)}>
        {incident.priority}
      </span>
      <span className="incident-time">
        <small>{resolved ? "Resolvió" : "Ingresó"}</small>
        <strong>{actor}</strong>
        <em>{incident.updatedAt}</em>
      </span>
      <b className="row-arrow">›</b>
    </button>
  );
}

function IncidentsView({
  role,
  incidents,
  search,
  setSearch,
  priorityFilter,
  setPriorityFilter,
  statusFilter,
  setStatusFilter,
  stageCounts,
  openWizard,
  openIncident,
}: {
  role: Role;
  incidents: Incident[];
  search: string;
  setSearch: (value: string) => void;
  priorityFilter: string;
  setPriorityFilter: (value: string) => void;
  statusFilter: IncidentViewFilter;
  setStatusFilter: (value: IncidentViewFilter) => void;
  stageCounts: Record<IncidentViewFilter, number>;
  openWizard: () => void;
  openIncident: (incident: Incident) => void;
}) {
  return (
    <>
      <section className="page-heading">
        <div>
          <span className="eyebrow">Gestión operativa</span>
          <h1>Incidentes</h1>
          <p>Consulta y seguimiento regional de los reportes operativos.</p>
        </div>
        {role !== "viewer" && (
          <button className="primary-button" type="button" onClick={openWizard}>
            <span>＋</span>
            Nuevo reporte
          </button>
        )}
      </section>
      <section className="panel filters-panel">
        <label className="search-box">
          <span>⌕</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por código, sistema o categoría"
          />
        </label>
        <label>
          Prioridad
          <select
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value)}
          >
            <option>Todas</option>
            <option>Crítica</option>
            <option>Alta</option>
            <option>Media</option>
            <option>Baja</option>
          </select>
        </label>
      </section>
      <section className="incident-stage-tabs" aria-label="Etapas de los reportes">
        {(
          [
            ["Iniciados", "Recién ingresados o en revisión"],
            ["En gestión", "Con acciones o seguimiento registrado"],
            ["Resueltos", "Histórico operativo de los últimos 7 días"],
          ] as Array<[IncidentViewFilter, string]>
        ).map(([stage, description]) => (
          <button
            key={stage}
            type="button"
            className={statusFilter === stage ? "active" : ""}
            onClick={() => setStatusFilter(stage)}
          >
            <span>{stageCounts[stage]}</span>
            <div>
              <strong>{stage}</strong>
              <small>{description}</small>
            </div>
          </button>
        ))}
      </section>
      <section className="panel incidents-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Resultados</span>
            <h2>
              {incidents.length}{" "}
              {statusFilter === "Resueltos"
                ? "incidentes resueltos"
                : statusFilter === "Iniciados"
                  ? "reportes iniciados"
                  : "reportes en gestión"}
            </h2>
          </div>
        </div>
        <div className="incident-list">
          {incidents.map((incident) => (
            <IncidentRow
              key={incident.code}
              incident={incident}
              onClick={() => openIncident(incident)}
            />
          ))}
          {!incidents.length && (
            <div className="empty-state">
              <span>⌕</span>
              <strong>
                {statusFilter === "Iniciados"
                  ? "No existen reportes iniciados"
                  : statusFilter === "En gestión"
                    ? "No existen reportes en gestión"
                    : "No existen incidentes resueltos en los últimos 7 días"}
              </strong>
              <p>
                {search || priorityFilter !== "Todas"
                  ? "Prueba con otra palabra o limpia los filtros aplicados."
                  : statusFilter === "Iniciados"
                    ? "Cada nueva situación reportada aparecerá automáticamente aquí."
                    : statusFilter === "En gestión"
                      ? "Los reportes pasarán a esta etapa cuando se registre una gestión."
                      : "Los incidentes resueltos se retiran después de siete días."}
              </p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function SystemsView({
  incidents,
  canComment,
}: {
  incidents: Incident[];
  canComment: boolean;
}) {
  const [systemSearch, setSystemSearch] = useState("");
  const [provinceFilter, setProvinceFilter] = useState("Todas");
  const [communeFilter, setCommuneFilter] = useState("Todas");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [page, setPage] = useState(1);
  const [comments, setComments] = useState<SystemComment[]>([]);
  const [selectedSystem, setSelectedSystem] = useState<SystemSSR | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const pageSize = 24;

  useEffect(() => {
    let active = true;
    apiFetch("/api/system-comments", { cache: "no-store" })
      .then(async (response) => {
        const result = (await response.json()) as { comments?: SystemComment[] };
        return response.ok ? result.comments ?? [] : [];
      })
      .then((rows) => { if (active) setComments(rows); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const activeBySystem = useMemo(() => {
    const index = new Map<string, Incident[]>();
    incidents
      .filter(
        (incident) =>
          incident.status !== "Resuelto" && incident.status !== "Cerrado",
      )
      .forEach((incident) => {
        index.set(incident.systemCode, [
          ...(index.get(incident.systemCode) ?? []),
          incident,
        ]);
      });
    return index;
  }, [incidents]);
  const provinces = [...new Set(systems.map((system) => system.province))].sort(
    (a, b) => a.localeCompare(b, "es"),
  );
  const communes = [
    ...new Set(
      systems
        .filter(
          (system) =>
            provinceFilter === "Todas" || system.province === provinceFilter,
        )
        .map((system) => system.commune),
    ),
  ].sort((a, b) => a.localeCompare(b, "es"));
  const normalizedSearch = normalizeSearchText(systemSearch);
  const filteredSystems = systems.filter((system) => {
    const systemIncidents = activeBySystem.get(system.code) ?? [];
    const critical = systemIncidents.some(
      (incident) => incident.priority === "Crítica",
    );
    const systemStatus = critical
      ? "Crítico"
      : systemIncidents.length
        ? "En seguimiento"
        : "Sin incidentes";
    const matchesText =
      !normalizedSearch ||
      systemSearchText(system).includes(normalizedSearch);
    return (
      matchesText &&
      (provinceFilter === "Todas" || system.province === provinceFilter) &&
      (communeFilter === "Todas" || system.commune === communeFilter) &&
      (statusFilter === "Todos" || systemStatus === statusFilter)
    );
  });
  const totalPages = Math.max(1, Math.ceil(filteredSystems.length / pageSize));
  const visibleSystems = filteredSystems.slice(
    (page - 1) * pageSize,
    page * pageSize,
  );
  const totalConnections = systems.reduce(
    (total, system) => total + system.connections,
    0,
  );
  const activeSystemCount = activeBySystem.size;

  function resetPage() {
    setPage(1);
  }

  function closeComments() {
    setSelectedSystem(null);
    setCommentDraft("");
  }

  async function saveComment() {
    if (!selectedSystem || !commentDraft.trim()) return;
    const response = await apiFetch("/api/system-comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemCode: selectedSystem.code, comment: commentDraft.trim() }),
    });
    const result = (await response.json()) as { comment?: SystemComment; error?: string };
    if (!response.ok || !result.comment) return;
    setComments((current) => [result.comment!, ...current]);
    setCommentDraft("");
  }

  return (
    <>
      <section className="page-heading">
        <div>
          <span className="eyebrow">Base oficial regional</span>
          <h1>Sistemas SSR de La Araucanía</h1>
          <p>
            Consulta territorial de 316 sistemas en Cautín y Malleco.
          </p>
        </div>
      </section>
      <section className="regional-summary" aria-label="Resumen regional">
        <article>
          <small>Sistemas oficiales</small>
          <strong>{formatNumber(systems.length)}</strong>
          <span>Base regional</span>
        </article>
        <article>
          <small>Comunas representadas</small>
          <strong>{new Set(systems.map((system) => system.commune)).size}</strong>
          <span>2 provincias</span>
        </article>
        <article>
          <small>Arranques registrados</small>
          <strong>{formatNumber(totalConnections)}</strong>
          <span>Cobertura total</span>
        </article>
        <article>
          <small>Con incidentes activos</small>
          <strong>{activeSystemCount}</strong>
          <span>Seguimiento vigente</span>
        </article>
      </section>
      <section className="panel systems-filters">
        <label className="search-box systems-search">
          <span>⌕</span>
          <input
            value={systemSearch}
            onChange={(event) => {
              setSystemSearch(event.target.value);
              resetPage();
            }}
            placeholder="Buscar por sistema, código o comuna"
          />
        </label>
        <label>
          Provincia
          <select
            value={provinceFilter}
            onChange={(event) => {
              setProvinceFilter(event.target.value);
              setCommuneFilter("Todas");
              resetPage();
            }}
          >
            <option>Todas</option>
            {provinces.map((province) => (
              <option key={province}>{province}</option>
            ))}
          </select>
        </label>
        <label>
          Comuna
          <select
            value={communeFilter}
            onChange={(event) => {
              setCommuneFilter(event.target.value);
              resetPage();
            }}
          >
            <option>Todas</option>
            {communes.map((commune) => (
              <option key={commune}>{commune}</option>
            ))}
          </select>
        </label>
        <label>
          Estado
          <select
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value);
              resetPage();
            }}
          >
            <option>Todos</option>
            <option>Sin incidentes</option>
            <option>En seguimiento</option>
            <option>Crítico</option>
          </select>
        </label>
      </section>
      <div className="systems-result-bar">
        <strong>{formatNumber(filteredSystems.length)} sistemas</strong>
        <span>
          {provinceFilter === "Todas" ? "Toda La Araucanía" : provinceFilter}
          {communeFilter !== "Todas" ? ` · ${communeFilter}` : ""}
        </span>
      </div>
      <section className="system-grid">
        {visibleSystems.map((system) => {
          const systemIncidents = activeBySystem.get(system.code) ?? [];
          const systemComments = comments.filter(
            (comment) => comment.systemCode === system.code,
          );
          const critical = systemIncidents.some(
            (incident) => incident.priority === "Crítica",
          );
          return (
            <article className="system-card" key={system.code}>
              <div className="system-card-top">
                <span
                  className={`system-status ${critical ? "critical" : systemIncidents.length ? "attention" : "normal"}`}
                >
                  <i />
                  {critical
                    ? "Crítico"
                    : systemIncidents.length
                      ? "En seguimiento"
                      : "Sin incidentes"}
                </span>
                <small>{system.code}</small>
              </div>
              <h2>{system.name}</h2>
              <p className="system-territory">
                {system.commune} <span>·</span> {system.province}
              </p>
              <div className="system-numbers">
                <span>
                  <small>Arranques</small>
                  <strong>{formatNumber(system.connections)}</strong>
                </span>
                <span>
                  <small>Incidentes activos</small>
                  <strong>{systemIncidents.length}</strong>
                </span>
              </div>
              <div className="system-capabilities">
                <span>Clasificación {system.classification}</span>
                <span>Generador {system.generator}</span>
              </div>
              <button
                className="system-comments-button"
                type="button"
                onClick={() => setSelectedSystem(system)}
              >
                <span>◌</span>
                {systemComments.length
                  ? `${systemComments.length} comentario${systemComments.length === 1 ? "" : "s"}`
                  : "Agregar comentario"}
                <b>→</b>
              </button>
            </article>
          );
        })}
        {!visibleSystems.length && (
          <div className="empty-state system-empty">
            <span>⌕</span>
            <strong>No encontramos sistemas</strong>
            <p>Prueba con otra búsqueda o limpia los filtros territoriales.</p>
          </div>
        )}
      </section>
      {totalPages > 1 && (
        <nav className="systems-pagination" aria-label="Páginas de sistemas">
          <button
            type="button"
            disabled={page === 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            ← Anterior
          </button>
          <span>
            Página <strong>{page}</strong> de {totalPages}
          </span>
          <button
            type="button"
            disabled={page === totalPages}
            onClick={() =>
              setPage((current) => Math.min(totalPages, current + 1))
            }
          >
            Siguiente →
          </button>
        </nav>
      )}
      {selectedSystem && (
        <SystemCommentsModal
          system={selectedSystem}
          comments={comments.filter(
            (comment) => comment.systemCode === selectedSystem.code,
          )}
          commentDraft={commentDraft}
          setCommentDraft={setCommentDraft}
          saveComment={saveComment}
          close={closeComments}
          canComment={canComment}
        />
      )}
    </>
  );
}

function SystemCommentsModal({
  system,
  comments,
  commentDraft,
  setCommentDraft,
  saveComment,
  close,
  canComment,
}: {
  system: SystemSSR;
  comments: SystemComment[];
  commentDraft: string;
  setCommentDraft: (value: string) => void;
  saveComment: () => void;
  close: () => void;
  canComment: boolean;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="system-comments-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Comentarios de ${system.name}`}
      >
        <header>
          <div>
            <span className="eyebrow">Observaciones internas</span>
            <h2>{system.name}</h2>
            <p>
              {system.commune} · {system.province} · {system.code}
            </p>
          </div>
          <button type="button" onClick={close} aria-label="Cerrar comentarios">
            ×
          </button>
        </header>

        {canComment && (
          <div className="system-comment-compose">
            <label htmlFor="system-comment">
              Nuevo comentario
              <textarea
                id="system-comment"
                value={commentDraft}
                onChange={(event) => setCommentDraft(event.target.value)}
                placeholder="Escribe una observación operativa, antecedente pendiente o acción de seguimiento..."
                maxLength={700}
              />
            </label>
            <div>
              <small>{commentDraft.length}/700 caracteres</small>
              <button
                className="primary-button"
                type="button"
                onClick={saveComment}
                disabled={!commentDraft.trim()}
              >
                Guardar comentario
              </button>
            </div>
          </div>
        )}

        <div className="system-comments-history">
          <div className="system-comments-history-title">
            <strong>Historial de comentarios</strong>
            <span>{comments.length}</span>
          </div>
          {comments.map((comment) => (
            <article key={comment.id}>
              <span className="avatar avatar-admin">
                {comment.author
                  .split(" ")
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join("")}
              </span>
              <div>
                <strong>{comment.author}</strong>
                <small>{comment.createdAt}</small>
                <p>{comment.text}</p>
              </div>
            </article>
          ))}
          {!comments.length && (
            <div className="system-comments-empty">
              <span>◌</span>
              <strong>Sin comentarios registrados</strong>
              <p>Las observaciones internas del sistema aparecerán aquí.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function ReportsView({
  incidents,
  activeIncidents,
  resolvedHistory,
  generatedReports,
  user,
  downloadCsv,
  downloadResolvedHistory,
  generateReport,
  downloadPdf,
  openIncident,
}: {
  incidents: Incident[];
  activeIncidents: Incident[];
  resolvedHistory: Incident[];
  generatedReports: ReportSnapshot[];
  user: (typeof roleData)[Role];
  downloadCsv: (
    reportIncidents: Incident[],
    reportDate: string,
    reportTime: string,
  ) => void;
  downloadResolvedHistory: (history: Incident[]) => void;
  generateReport: (
    reportDate: string,
    reportTime: string,
    reportIncidents: Incident[],
    scope: string,
    executiveSummary: string,
    observations: string,
  ) => Promise<string>;
  downloadPdf: (
    reportIncidents: Incident[],
    reportDate: string,
    reportTime: string,
    scope: string,
    generatedBy: string,
    executiveSummary: string,
    observations: string,
  ) => Promise<void>;
  openIncident: (incident: Incident) => void;
}) {
  const initialChileTime = chileDateTimeParts();
  const [reportDate, setReportDate] = useState(initialChileTime.date);
  const [reportTime, setReportTime] = useState(initialChileTime.time);
  const [liveChileTime, setLiveChileTime] = useState(new Date());
  const [provinceFilter, setProvinceFilter] = useState("Todas");
  const [communeFilter, setCommuneFilter] = useState("Todas");
  const [selectedReportId, setSelectedReportId] = useState("");
  const [executiveSummary, setExecutiveSummary] = useState("");
  const [observations, setObservations] = useState("");
  const provinces = [...new Set(systems.map((system) => system.province))].sort(
    (a, b) => a.localeCompare(b, "es"),
  );
  const communes = [
    ...new Set(
      systems
        .filter(
          (system) =>
            provinceFilter === "Todas" || system.province === provinceFilter,
        )
        .map((system) => system.commune),
    ),
  ].sort((a, b) => a.localeCompare(b, "es"));
  const selectedSnapshot = generatedReports.find(
    (report) => report.id === selectedReportId,
  );
  const territorialIncidents = activeIncidents.filter((incident) => {
    const system = systems.find((item) => item.code === incident.systemCode);
    if (!system) return false;
    const matchesProvince =
      provinceFilter === "Todas" || system.province === provinceFilter;
    const matchesCommune =
      communeFilter === "Todas" || system.commune === communeFilter;
    return matchesProvince && matchesCommune;
  });
  const previewIncidents = selectedSnapshot?.incidents ?? territorialIncidents;
  const scope =
    communeFilter !== "Todas"
      ? `Comuna de ${communeFilter}`
      : provinceFilter !== "Todas"
        ? `Provincia de ${provinceFilter}`
        : "Región de La Araucanía";
  const affected = previewIncidents.reduce(
    (total, incident) => total + incident.affected,
    0,
  );
  const representedSystems = new Set(
    previewIncidents.map((incident) => incident.systemCode),
  ).size;
  const critical = previewIncidents.filter(
    (incident) => incident.priority === "Crítica",
  ).length;
  const waterAffected = previewIncidents.filter(
    (incident) =>
      incident.water === "Parcial" || incident.water === "Interrumpido",
  ).length;
  const latestReports = generatedReports.slice(0, 6);
  const selectedSnapshotIndex = selectedSnapshot
    ? generatedReports.findIndex((report) => report.id === selectedSnapshot.id)
    : -1;
  const comparisonSnapshot = selectedSnapshot
    ? generatedReports[selectedSnapshotIndex + 1]
    : generatedReports[0];
  const currentCodes = new Set(previewIncidents.map((incident) => incident.code));
  const previousCodes = new Set(
    comparisonSnapshot?.incidents.map((incident) => incident.code) ?? [],
  );
  const newSincePrevious = previewIncidents.filter(
    (incident) => !previousCodes.has(incident.code),
  ).length;
  const resolvedSincePrevious = (comparisonSnapshot?.incidents ?? []).filter(
    (incident) => !currentCodes.has(incident.code),
  ).length;
  const previousAffected = (comparisonSnapshot?.incidents ?? []).reduce(
    (total, incident) => total + incident.affected,
    0,
  );
  const affectedVariation = affected - previousAffected;

  useEffect(() => {
    const refreshClock = () => {
      const now = new Date();
      setLiveChileTime(now);
      if (!selectedReportId) {
        const parts = chileDateTimeParts(now);
        setReportDate(parts.date);
        setReportTime(parts.time);
      }
    };
    refreshClock();
    const interval = window.setInterval(refreshClock, 30_000);
    return () => window.clearInterval(interval);
  }, [selectedReportId]);

  async function generateAndSelect() {
    const issued = chileDateTimeParts();
    setReportDate(issued.date);
    setReportTime(issued.time);
    const id = await generateReport(
      issued.date,
      issued.time,
      territorialIncidents,
      scope,
      executiveSummary,
      observations,
    );
    if (id) setSelectedReportId(id);
  }

  function selectTerritory(
    province: string,
    commune: string = "Todas",
  ) {
    setProvinceFilter(province);
    setCommuneFilter(commune);
    setSelectedReportId("");
    setExecutiveSummary("");
    setObservations("");
  }

  return (
    <>
      <section className="page-heading reports-heading">
        <div>
          <span className="eyebrow">Centro de informes operativos</span>
          <h1>Informe de situación SSR</h1>
          <p>
            Consolida y emite un respaldo regional en el momento que lo
            necesites.
          </p>
        </div>
        <button
          className="primary-button report-generate-main"
          type="button"
          onClick={generateAndSelect}
        >
          <span>＋</span>
          {selectedSnapshot ? "Emitir nueva versión" : "Generar informe"}
        </button>
      </section>

      <section className="report-command" aria-label="Configuración del informe">
        <div className="report-live-clock">
          <span>Fecha y hora de emisión</span>
          <strong>
            {selectedSnapshot
              ? `${selectedSnapshot.reportDate} · ${selectedSnapshot.reportTime}`
              : formatChileDateTime(liveChileTime)}
          </strong>
          <small>Horario oficial de Chile · America/Santiago</small>
        </div>
        <label className="report-territory-field">
          <span>Provincia</span>
          <select
            value={provinceFilter}
            onChange={(event) => selectTerritory(event.target.value)}
          >
            <option>Todas</option>
            {provinces.map((province) => (
              <option key={province}>{province}</option>
            ))}
          </select>
        </label>
        <label className="report-territory-field">
          <span>Comuna</span>
          <select
            value={communeFilter}
            onChange={(event) => {
              setCommuneFilter(event.target.value);
              setSelectedReportId("");
              setExecutiveSummary("");
              setObservations("");
            }}
          >
            <option>Todas</option>
            {communes.map((commune) => (
              <option key={commune}>{commune}</option>
            ))}
          </select>
        </label>
        <div className="report-version">
          <span>Alcance y versión</span>
          <strong>{selectedSnapshot?.id ?? "Vista previa sin emitir"}</strong>
          <small>
            {selectedSnapshot
              ? `${selectedSnapshot.scope} · ${selectedSnapshot.generatedAt}`
              : `${scope} · preparado por ${user.name}`}
          </small>
        </div>
        <div className="report-reference-times">
          <span>Cortes referenciales internos</span>
          <div>
            {INTERNAL_REFERENCE_TIMES.map((time) => (
              <small key={time}>{time}</small>
            ))}
          </div>
          <p>No restringen la generación del informe.</p>
        </div>
      </section>

      <section className="report-comparison" aria-label="Cambios desde el informe anterior">
        <div>
          <span className="eyebrow">Evolución</span>
          <strong>
            {comparisonSnapshot
              ? `Comparación con ${comparisonSnapshot.id}`
              : "Primer informe del período"}
          </strong>
        </div>
        <article>
          <small>Nuevos</small>
          <strong>+{newSincePrevious}</strong>
        </article>
        <article>
          <small>Resueltos</small>
          <strong>{resolvedSincePrevious}</strong>
        </article>
        <article>
          <small>Variación de arranques</small>
          <strong>
            {affectedVariation > 0 ? "+" : ""}
            {formatNumber(affectedVariation)}
          </strong>
        </article>
      </section>

      <section className="report-kpis" aria-label="Resumen del informe">
        <article>
          <span className="report-kpi-icon blue">!</span>
          <div>
            <small>Incidentes activos</small>
            <strong>{previewIncidents.length}</strong>
            <em>{critical} de prioridad crítica</em>
          </div>
        </article>
        <article>
          <span className="report-kpi-icon amber">◒</span>
          <div>
            <small>Sistemas afectados</small>
            <strong>{representedSystems}</strong>
            <em>{waterAffected} con afectación de agua</em>
          </div>
        </article>
        <article>
          <span className="report-kpi-icon teal">⌁</span>
          <div>
            <small>Arranques afectados</small>
            <strong>{formatNumber(affected)}</strong>
            <em>≈ {formatNumber(estimatedPeople(affected))} personas</em>
          </div>
        </article>
        <article>
          <span className="report-kpi-icon slate">↗</span>
          <div>
            <small>Última actualización</small>
            <strong>{previewIncidents[0]?.updatedAt ?? "—"}</strong>
            <em>{previewIncidents[0]?.system ?? "Sin incidentes"}</em>
          </div>
        </article>
      </section>

      <section className="reports-workspace">
        <aside className="report-builder panel">
          <header>
            <span className="eyebrow">Composición del informe</span>
            <h2>Contenido del informe</h2>
            <p>
              El documento se construye con el estado vigente de los reportes
              activos para el territorio seleccionado.
            </p>
          </header>
          <div className="report-narratives">
            <label>
              Resumen ejecutivo
              <textarea
                rows={4}
                value={executiveSummary}
                onChange={(event) => setExecutiveSummary(event.target.value)}
                placeholder="Describe brevemente la situación regional, principales afectaciones y necesidades de coordinación."
              />
            </label>
            <label>
              Observaciones del informe
              <textarea
                rows={4}
                value={observations}
                onChange={(event) => setObservations(event.target.value)}
                placeholder="Agrega antecedentes, limitaciones de la información o acciones pendientes."
              />
            </label>
          </div>
          <div className="report-checklist">
            <span><i>✓</i> Resumen ejecutivo</span>
            <span><i>✓</i> Estado del agua y energía</span>
            <span><i>✓</i> Arranques afectados</span>
            <span><i>✓</i> Gestión y responsables</span>
            <span><i>✓</i> Hora de actualización</span>
            <span><i>✓</i> Identificación del emisor</span>
          </div>
          <div className="report-builder-note">
            <span>RESPALDO</span>
            <div>
              <strong>
                {selectedSnapshot ? "Informe emitido" : "Vista previa dinámica"}
              </strong>
              <small>
                {selectedSnapshot
                  ? "La versión queda conservada en el historial."
                  : "Genera el informe para conservar una copia del estado."}
              </small>
            </div>
          </div>
          <div className="report-export-actions">
            <button
              className="primary-button full"
              type="button"
              onClick={generateAndSelect}
            >
              {selectedSnapshot ? "Emitir nueva versión" : "Generar y respaldar"}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                downloadCsv(previewIncidents, reportDate, reportTime)
              }
            >
              <span>↓</span> Descargar Excel/CSV
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void downloadPdf(
                previewIncidents,
                reportDate,
                reportTime,
                selectedSnapshot?.scope ?? scope,
                selectedSnapshot?.generatedBy ?? user.name,
                selectedSnapshot?.executiveSummary ?? executiveSummary,
                selectedSnapshot?.observations ?? observations,
              )}
            >
              <span>↓</span> Descargar PDF
            </button>
          </div>
        </aside>

        <article className="official-report" id="official-report">
          <header className="official-report-header">
            <InstitutionalBrand />
            <div>
              <span>REPORTE OPERATIVO</span>
              <strong>Gestión de Emergencias SSR</strong>
              <small>Dirección de Obras Hidráulicas · La Araucanía</small>
            </div>
          </header>
          <div className="official-report-title">
            <div>
              <span>INFORME DE SITUACIÓN</span>
              <h2>
                Emitido a las {selectedSnapshot?.reportTime ?? reportTime}
              </h2>
              <p>
                {selectedSnapshot?.scope ?? scope} ·{" "}
                {new Date(
                  `${selectedSnapshot?.reportDate ?? reportDate}T12:00:00`,
                ).toLocaleDateString("es-CL", {
                  timeZone: CHILE_TIME_ZONE,
                  weekday: "long",
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </p>
            </div>
            <div className="report-document-code">
              <small>IDENTIFICADOR</small>
              <strong>
                {selectedSnapshot?.id ??
                  `PREV-${reportDate.replaceAll("-", "")}-${reportTime.replace(":", "")}`}
              </strong>
              <span className={selectedSnapshot ? "issued" : ""}>
                {selectedSnapshot ? "EMITIDO" : "VISTA PREVIA"}
              </span>
            </div>
          </div>
          <div className="official-summary-strip">
            <div><small>Incidentes</small><strong>{previewIncidents.length}</strong></div>
            <div><small>Sistemas</small><strong>{representedSystems}</strong></div>
            <div><small>Arranques</small><strong>{formatNumber(affected)}</strong></div>
            <div><small>Personas estimadas</small><strong>{formatNumber(estimatedPeople(affected))}</strong></div>
            <div><small>Críticos</small><strong>{critical}</strong></div>
          </div>
          {(selectedSnapshot?.executiveSummary ?? executiveSummary) && (
            <section className="official-report-narrative">
              <span className="eyebrow">Resumen ejecutivo</span>
              <p>{selectedSnapshot?.executiveSummary ?? executiveSummary}</p>
            </section>
          )}
          {(selectedSnapshot?.observations ?? observations) && (
            <section className="official-report-narrative observations">
              <span className="eyebrow">Observaciones</span>
              <p>{selectedSnapshot?.observations ?? observations}</p>
            </section>
          )}
          <section className="official-report-section">
            <div className="official-section-heading">
              <span>01</span>
              <div>
                <strong>Resumen de sistemas afectados</strong>
                <small>Estado consolidado al momento seleccionado</small>
              </div>
            </div>
            <div className="official-incident-table" role="table">
              <div className="official-table-head" role="row">
                <span role="columnheader">Sistema / situación</span>
                <span role="columnheader">Agua</span>
                <span role="columnheader">Electricidad</span>
                <span role="columnheader">Afectación</span>
                <span role="columnheader">Gestión</span>
              </div>
              {previewIncidents.map((incident) => (
                <button
                  className="official-table-row"
                  type="button"
                  role="row"
                  key={incident.code}
                  onClick={() => openIncident(incident)}
                >
                  <span className="official-system-cell" role="cell">
                    <i className={statusClass(incident.status)} />
                    <span>
                      <strong>{incident.system}</strong>
                      <small>
                        {systems.find(
                          (system) => system.code === incident.systemCode,
                        )?.commune ?? "La Araucanía"}{" "}
                        · {incident.code} · {incident.category}
                      </small>
                    </span>
                  </span>
                  <span role="cell">{incident.water}</span>
                  <span role="cell">{incident.electricity}</span>
                  <span role="cell">
                    <strong>{formatNumber(incident.affected)}</strong>
                    <small>
                      arranques · ≈ {formatNumber(estimatedPeople(incident.affected))} personas
                    </small>
                  </span>
                  <span role="cell">
                    <strong>{incident.status}</strong>
                    <small>{incident.responsible}</small>
                  </span>
                </button>
              ))}
              {!previewIncidents.length && (
                <div className="official-empty">
                  Sin incidentes activos al momento de emitir el informe.
                </div>
              )}
            </div>
          </section>
          <section className="official-report-section report-observations">
            <div className="official-section-heading">
              <span>02</span>
              <div>
                <strong>Observaciones del informe</strong>
                <small>Información para coordinación operativa</small>
              </div>
            </div>
            <p>
              {selectedSnapshot?.observations ||
                observations ||
                "Se mantiene seguimiento sobre los sistemas informados. Los antecedentes corresponden a los registros operativos disponibles al momento de emitir el informe."}
            </p>
          </section>
          <footer className="official-report-footer">
            <div>
              <small>Preparado por</small>
              <strong>{selectedSnapshot?.generatedBy ?? user.name}</strong>
              <span>Dirección de Obras Hidráulicas</span>
            </div>
            <div>
              <small>Fecha de emisión</small>
              <strong>{selectedSnapshot?.generatedAt ?? "Vista previa no emitida"}</strong>
              <span>Registro operativo regional</span>
            </div>
          </footer>
        </article>
      </section>

      <section className="panel resolved-history">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Respaldo mensual</span>
            <h2>Histórico de fallas resueltas</h2>
            <p>Registros cerrados durante los últimos 30 días.</p>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={() => downloadResolvedHistory(resolvedHistory)}
            disabled={!resolvedHistory.length}
          >
            <span>↓</span> Descargar histórico CSV
          </button>
        </div>
        <div className="resolved-history-list">
          {resolvedHistory.map((incident) => {
            const resolution = resolutionFollowUp(incident);
            const system = systems.find(
              (item) => item.code === incident.systemCode,
            );
            return (
              <button
                type="button"
                key={incident.code}
                onClick={() => openIncident(incident)}
              >
                <span className="history-file-icon">✓</span>
                <span>
                  <small>{incident.code}</small>
                  <strong>{incident.system}</strong>
                  <em>
                    {system?.commune ?? "La Araucanía"} · {incident.category}
                  </em>
                </span>
                <span>
                  <small>Ingresó</small>
                  <strong>{incident.enteredBy}</strong>
                </span>
                <span>
                  <small>Resolvió</small>
                  <strong>{resolution?.author ?? "Sin registro"}</strong>
                </span>
                <span>
                  <small>Resolución</small>
                  <strong>{resolution?.createdAt ?? "Fecha no disponible"}</strong>
                  <em>{resolution?.text ?? "Sin comentario de resolución"}</em>
                </span>
                <b>›</b>
              </button>
            );
          })}
          {!resolvedHistory.length && (
            <div className="resolved-history-empty">
              Aún no hay fallas resueltas dentro del período de 30 días.
            </div>
          )}
        </div>
      </section>

      <section className="panel report-history">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Trazabilidad operativa</span>
            <h2>Historial de informes emitidos</h2>
          </div>
          <span className="history-count">{generatedReports.length} versiones</span>
        </div>
        <div className="report-history-list">
          {latestReports.map((report) => {
            const reportAffected = report.incidents.reduce(
              (total, incident) => total + incident.affected,
              0,
            );
            return (
              <article key={report.id}>
                <span className="history-file-icon">▤</span>
                <div>
                  <strong>Emitido a las {report.reportTime}</strong>
                  <small>{report.id}</small>
                </div>
                <div>
                  <small>Territorio</small>
                  <strong>{report.scope}</strong>
                </div>
                <div>
                  <small>Contenido</small>
                  <strong>
                    {report.incidents.length} incidentes ·{" "}
                    {formatNumber(reportAffected)} arranques
                  </strong>
                </div>
                <span className="history-date">{report.generatedAt}</span>
                <button
                  type="button"
                  onClick={() => {
                    setReportDate(report.reportDate);
                    setReportTime(report.reportTime);
                    setExecutiveSummary(report.executiveSummary ?? "");
                    setObservations(report.observations ?? "");
                    setSelectedReportId(report.id);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  Abrir
                </button>
              </article>
            );
          })}
        </div>
        <footer>
          {incidents.length} registros operativos disponibles.
        </footer>
      </section>
    </>
  );
}

function managedUserFromAuth(user: AuthenticatedUser): ManagedUser {
  const createdDate = user.createdAt ? new Date(user.createdAt) : null;
  const lastAccess = user.lastSignInAt ? new Date(user.lastSignInAt) : null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    jobTitle: user.jobTitle,
    unit: user.unit,
    region: user.region,
    active: user.active,
    createdAt:
      createdDate && Number.isFinite(createdDate.getTime())
        ? formatChileDateTime(createdDate)
        : "Sin registro",
    lastAccess:
      lastAccess && Number.isFinite(lastAccess.getTime())
        ? formatChileDateTime(lastAccess)
        : "Sin ingreso",
    invitationStatus: "Enviada",
    mustChangePassword: user.mustChangePassword,
  };
}

function UsersView({ currentUser }: { currentUser: AuthenticatedUser }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [notifications, setNotifications] = useState<NotificationQueueItem[]>(
    readNotificationQueue,
  );
  const [emailConnection, setEmailConnection] =
    useState<EmailConnectionStatus>({
      configured: false,
      provider: "Gmail API",
      sender: NOTIFICATION_SENDER,
      recipient: NOTIFICATION_RECIPIENT,
      missingConfiguration: 3,
    });
  const [checkingEmail, setCheckingEmail] = useState(true);
  const [sendingTest, setSendingTest] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [unit, setUnit] = useState("Subdirección Regional SSR");
  const [region, setRegion] = useState("La Araucanía");
  const [newRole, setNewRole] = useState<Role>("reporter");
  const [message, setMessage] = useState("");
  const [loadingUsers, setLoadingUsers] = useState(true);

  useEffect(() => {
    let active = true;
    const refreshNotifications = () =>
      setNotifications(readNotificationQueue());
    window.addEventListener(
      NOTIFICATION_QUEUE_EVENT,
      refreshNotifications,
    );
    Promise.allSettled([
      apiFetch("/api/email/status", { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error("status unavailable");
        return response.json() as Promise<EmailConnectionStatus>;
      }),
      apiFetch("/api/users", { cache: "no-store" }).then(async (response) => {
        const result = (await response.json()) as {
          users?: AuthenticatedUser[];
          error?: string;
        };
        if (!response.ok || !result.users) {
          throw new Error(result.error || "No fue posible cargar las cuentas.");
        }
        return result.users;
      }),
    ]).then(([emailResult, usersResult]) => {
      if (!active) return;
      if (emailResult.status === "fulfilled") {
        setEmailConnection(emailResult.value);
      } else {
        setEmailConnection((current) => ({ ...current, configured: false }));
      }
      if (usersResult.status === "fulfilled") {
        setUsers(usersResult.value.map(managedUserFromAuth));
      } else {
        setMessage(usersResult.reason instanceof Error ? usersResult.reason.message : "No fue posible cargar las cuentas.");
      }
      setCheckingEmail(false);
      setLoadingUsers(false);
    });

    return () => {
      active = false;
      window.removeEventListener(
        NOTIFICATION_QUEUE_EVENT,
        refreshNotifications,
      );
    };
  }, []);

  function saveUsers(next: ManagedUser[]) {
    setUsers(next);
  }

  function initials(value: string) {
    return value
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("");
  }

  async function createUser(event: FormEvent) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (name.trim().length < 3 || !normalizedEmail.includes("@")) {
      setMessage("Completa un nombre y un correo institucional válido.");
      return;
    }
    if (users.some((item) => item.email.toLowerCase() === normalizedEmail)) {
      setMessage("Ese correo ya está registrado.");
      return;
    }
    if (temporaryPassword.length < 12) {
      setMessage("La contraseña temporal debe contener al menos 12 caracteres.");
      return;
    }
    if (temporaryPassword !== passwordConfirmation) {
      setMessage("Las contraseñas temporales no coinciden.");
      return;
    }
    setMessage("Creando cuenta…");
    const response = await apiFetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        email: normalizedEmail,
        password: temporaryPassword,
        role: newRole,
        jobTitle: jobTitle.trim(),
        unit: unit.trim(),
        region: region.trim(),
      }),
    });
    const result = (await response.json()) as {
      user?: AuthenticatedUser;
      error?: string;
    };
    if (!response.ok || !result.user) {
      setMessage(result.error || "No fue posible crear la cuenta.");
      return;
    }
    saveUsers([
      { ...managedUserFromAuth(result.user), invitationStatus: "Pendiente de envío" },
      ...users,
    ]);
    setName("");
    setEmail("");
    setTemporaryPassword("");
    setPasswordConfirmation("");
    setJobTitle("");
    setUnit("Subdirección Regional SSR");
    setRegion("La Araucanía");
    setNewRole("reporter");
    setMessage("Usuario creado correctamente.");
    setShowCreate(false);
  }

  async function toggleUser(userId: string) {
    const selected = users.find((item) => item.id === userId);
    if (!selected) return;
    setMessage(`${selected.active ? "Suspendiendo" : "Habilitando"} cuenta…`);
    const response = await apiFetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        email: selected.email,
        active: !selected.active,
      }),
    });
    const result = (await response.json()) as { user?: AuthenticatedUser; error?: string };
    if (!response.ok || !result.user) {
      setMessage(result.error || "No fue posible actualizar la cuenta.");
      return;
    }
    saveUsers(
      users.map((item) =>
        item.id === userId ? { ...item, active: result.user!.active } : item,
      ),
    );
    setMessage(result.user.active ? "Cuenta habilitada correctamente." : "Cuenta suspendida correctamente.");
  }

  async function updateUserRole(userId: string, nextRole: Role) {
    const selected = users.find((item) => item.id === userId);
    if (!selected) return;
    setMessage("Actualizando perfil…");
    const response = await apiFetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, email: selected.email, role: nextRole }),
    });
    const result = (await response.json()) as { user?: AuthenticatedUser; error?: string };
    if (!response.ok || !result.user) {
      setMessage(result.error || "No fue posible actualizar el perfil.");
      return;
    }
    saveUsers(
      users.map((item) =>
        item.id === userId ? { ...item, role: result.user!.role } : item,
      ),
    );
    setMessage("Perfil actualizado correctamente.");
  }

  async function queueInvitation(userId: string) {
    const invitedUser = users.find((item) => item.id === userId);
    if (!invitedUser) return;
    setMessage(`Enviando invitación a ${invitedUser.email}…`);
    const notification = await sendEmailNotification({
      event: "Invitación de usuario",
      system: "Gestión de Emergencias SSR",
      actor: "Marcelo Andrés Ulloa Solís",
      recipient: invitedUser.email,
      userName: invitedUser.name,
      role: roleLabel(invitedUser.role),
    });
    if (notification.status === "Enviado") {
      saveUsers(
        users.map((item) =>
          item.id === userId ? { ...item, invitationStatus: "Enviada" } : item,
        ),
      );
      setMessage(`Invitación enviada correctamente a ${invitedUser.email}.`);
      return;
    }
    saveUsers(
      users.map((item) =>
        item.id === userId
          ? { ...item, invitationStatus: "Pendiente de envío" }
          : item,
      ),
    );
    setMessage(
      notification.status === "Pendiente de configuración"
        ? "La invitación quedó pendiente hasta autorizar la cuenta Gmail."
        : `No fue posible enviar la invitación: ${notification.error ?? "revisa la conexión."}`,
    );
  }

  async function sendTestEmail() {
    setSendingTest(true);
    setMessage("Enviando correo de prueba…");
    const notification = await sendEmailNotification({
      event: "Prueba de conexión",
      system: "Gestión de Emergencias SSR",
      actor: "Marcelo Andrés Ulloa Solís",
    });
    setSendingTest(false);
    setMessage(
      notification.status === "Enviado"
        ? `Prueba enviada desde ${emailConnection.sender} a ${emailConnection.recipient}.`
        : notification.error ?? "No fue posible enviar el correo de prueba.",
    );
  }

  const activeUsers = users.filter((item) => item.active).length;
  const roleCounts = {
    admin: users.filter((item) => item.role === "admin").length,
    reporter: users.filter((item) => item.role === "reporter").length,
    viewer: users.filter((item) => item.role === "viewer").length,
  };

  return (
    <>
      <section className="page-heading">
        <div>
          <span className="eyebrow">Acceso controlado</span>
          <h1>Usuarios DOH</h1>
          <p>Administra perfiles internos sin habilitar registro público.</p>
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={() => {
            setShowCreate((current) => !current);
            setMessage("");
          }}
        >
          <span>＋</span>
          Crear usuario
        </button>
      </section>

      {showCreate && (
        <form className="panel user-create-panel" onSubmit={createUser}>
          <div>
            <span className="eyebrow">Nuevo acceso interno</span>
            <h2>Crear usuario DOH</h2>
            <p>El administrador define el perfil inicial y puede ajustarlo después.</p>
          </div>
          <label>
            Nombre completo
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ej.: Marcelo Andrés Ulloa Solís"
              autoFocus
            />
          </label>
          <label>
            Correo institucional
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="nombre@mop.gov.cl"
            />
          </label>
          <label>
            Cargo o función
            <input
              value={jobTitle}
              onChange={(event) => setJobTitle(event.target.value)}
              placeholder="Ej.: Profesional SSR"
            />
          </label>
          <label>
            Unidad
            <input
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
            />
          </label>
          <label>
            Región
            <input
              value={region}
              onChange={(event) => setRegion(event.target.value)}
            />
          </label>
          <label>
            Contraseña temporal
            <input
              type="password"
              value={temporaryPassword}
              onChange={(event) => setTemporaryPassword(event.target.value)}
              minLength={12}
              autoComplete="new-password"
              placeholder="Mínimo 12 caracteres"
              required
            />
          </label>
          <label>
            Confirmar contraseña
            <input
              type="password"
              value={passwordConfirmation}
              onChange={(event) => setPasswordConfirmation(event.target.value)}
              minLength={12}
              autoComplete="new-password"
              required
            />
          </label>
          <label>
            Perfil
            <select
              value={newRole}
              onChange={(event) => setNewRole(event.target.value as Role)}
            >
              <option value="admin">Administrador</option>
              <option value="reporter">Reportante</option>
              <option value="viewer">Consulta</option>
            </select>
          </label>
          <button className="primary-button" type="submit">
            Crear y habilitar cuenta
          </button>
        </form>
      )}
      {message && <p className="admin-feedback">{message}</p>}

      <section className="user-role-summary" aria-label="Resumen de perfiles">
        <article>
          <span className="avatar avatar-admin">AD</span>
          <div><small>Administradores</small><strong>{roleCounts.admin}</strong></div>
        </article>
        <article>
          <span className="avatar avatar-reporter">RE</span>
          <div><small>Reportantes</small><strong>{roleCounts.reporter}</strong></div>
        </article>
        <article>
          <span className="avatar avatar-viewer">CO</span>
          <div><small>Consulta</small><strong>{roleCounts.viewer}</strong></div>
        </article>
      </section>

      <section className="panel users-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Gestión regional</span>
            <h2>{activeUsers} usuarios activos</h2>
          </div>
          <small>{users.length} perfiles registrados</small>
        </div>
        {loadingUsers && (
          <div className="users-loading">Cargando cuentas habilitadas…</div>
        )}
        {!loadingUsers && users.map((item) => (
          <div className="user-row" key={item.email}>
            <span className={`avatar avatar-${item.role}`}>
              {initials(item.name)}
            </span>
            <span className="user-identity">
              <strong>{item.name}</strong>
              <small>{item.email}</small>
              <em>{item.jobTitle ?? "Funcionario DOH"}</em>
            </span>
            <label className="user-role-field">
              <small>Perfil</small>
              <select
                value={item.role}
                onChange={(event) =>
                  updateUserRole(item.id, event.target.value as Role)
                }
                disabled={item.email === currentUser.email}
                aria-label={`Perfil de ${item.name}`}
              >
                <option value="admin">Administrador</option>
                <option value="reporter">Reportante</option>
                <option value="viewer">Consulta</option>
              </select>
            </label>
            <span className="user-access">
              <small>{item.unit ?? "Subdirección Regional SSR"}</small>
              <strong>{item.region ?? "La Araucanía"}</strong>
              <em>Último acceso: {item.lastAccess ?? "Sin registro"}</em>
            </span>
            <span className="user-account-state">
              <span className={`active-badge ${item.active ? "" : "inactive"}`}>
                <i /> {item.active ? "Activo" : "Inactivo"}
              </span>
              {item.mustChangePassword && (
                <span className="temporary-password-badge">Clave temporal</span>
              )}
            </span>
            <span className="user-actions">
              <button
                className="user-invite"
                type="button"
                onClick={() => queueInvitation(item.id)}
                disabled={item.email === currentUser.email}
              >
                {item.invitationStatus === "Enviada"
                  ? "Enviar aviso"
                  : item.invitationStatus === "Pendiente de envío"
                    ? "Invitación pendiente"
                    : "Enviar invitación"}
              </button>
              <button
                className="user-toggle"
                type="button"
                onClick={() => toggleUser(item.id)}
                disabled={item.email === currentUser.email}
                aria-label={`${item.active ? "Desactivar" : "Activar"} a ${item.name}`}
              >
                {item.active ? "Suspender" : "Activar"}
              </button>
            </span>
          </div>
        ))}
        <footer className="users-note">
          Los perfiles se administran desde este panel. La activación del acceso
          individual y sus atributos quedará asociada al servicio de
          autenticación.
        </footer>
      </section>

      <section className="admin-grid">
        <article className="panel permissions-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Control de acceso</span>
              <h2>Permisos por perfil</h2>
            </div>
          </div>
          <div className="permission-list">
            <div>
              <span className="avatar avatar-admin">AD</span>
              <p>
                <strong>Administrador</strong>
                <small>
                  Acceso total. Crea usuarios, cambia perfiles, asigna
                  responsables, modifica incidentes, registra soluciones,
                  cierra alertas y descarga informes.
                </small>
              </p>
            </div>
            <div>
              <span className="avatar avatar-reporter">RE</span>
              <p>
                <strong>Reportante</strong>
                <small>
                  Consulta sistemas, crea reportes, adjunta fotografías y
                  ubicación, y agrega seguimientos. No administra usuarios ni
                  cierra incidentes.
                </small>
              </p>
            </div>
            <div>
              <span className="avatar avatar-viewer">CO</span>
              <p>
                <strong>Consulta</strong>
                <small>
                  Visualiza sistemas, incidentes e informes y puede
                  descargarlos, sin botones de edición.
                </small>
              </p>
            </div>
          </div>
        </article>

        <article className="panel notification-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Avisos automáticos</span>
              <h2>Correo de notificación</h2>
            </div>
            <span
              className={`provider-status ${
                emailConnection.configured ? "connected" : "pending"
              }`}
            >
              {checkingEmail
                ? "Comprobando"
                : emailConnection.configured
                  ? "Gmail conectado"
                  : "Autorización pendiente"}
            </span>
          </div>
          <div className="notification-destination">
            <small>Cuenta remitente</small>
            <a href={`mailto:${emailConnection.sender}`}>
              {emailConnection.sender}
            </a>
            <small>Destinatario de alertas</small>
            <a href={`mailto:${emailConnection.recipient}`}>
              {emailConnection.recipient}
            </a>
            <p>Eventos: nueva falla y falla resuelta.</p>
            {!checkingEmail && !emailConnection.configured && (
              <p className="connection-note">
                La programación está lista. Falta autorizar esta cuenta en
                Google para habilitar los envíos reales.
              </p>
            )}
            <button
              className="test-email-button"
              type="button"
              onClick={sendTestEmail}
              disabled={!emailConnection.configured || sendingTest}
            >
              {sendingTest ? "Enviando prueba…" : "Enviar correo de prueba"}
            </button>
          </div>
          <div className="notification-queue">
            <strong>{notifications.length} avisos registrados</strong>
            {notifications.slice(0, 3).map((item) => (
              <div key={item.id}>
                <span>
                  {item.event}
                  <small>{item.system} · por {item.actor}</small>
                </span>
                <b
                  className={`delivery-status status-${notificationStatusClass(item.status)}`}
                >
                  {item.status}
                </b>
              </div>
            ))}
            {!notifications.length && (
              <small>
                Los próximos envíos y su resultado aparecerán aquí.
              </small>
            )}
          </div>
        </article>
      </section>

      <section className="panel about-panel">
        <div>
          <span className="eyebrow">Acerca de la aplicación</span>
          <h2>Gestión de Emergencias SSR</h2>
          <p>
            Herramienta para el registro, seguimiento, resolución e informes de
            fallas en Sistemas Sanitarios Rurales.
          </p>
          <span className="version-badge">Versión {APP_VERSION} · Operativa</span>
        </div>
        <AppCredit />
      </section>
    </>
  );
}

function ReportWizard({
  step,
  draft,
  incidents,
  photos,
  updateDraft,
  handlePhotos,
  requestLocation,
  close,
  back,
  next,
  submit,
  user,
}: {
  step: number;
  draft: Draft;
  incidents: Incident[];
  photos: IncidentPhotoDraft[];
  updateDraft: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  handlePhotos: (event: ChangeEvent<HTMLInputElement>) => void;
  requestLocation: () => void;
  close: () => void;
  back: () => void;
  next: () => void;
  submit: () => void | Promise<void>;
  user: (typeof roleData)[Role];
}) {
  const selectedSystem = systems.find(
    (system) => system.code === draft.systemCode,
  );
  const [systemQuery, setSystemQuery] = useState(
    () => selectedSystem?.name ?? "",
  );
  const [systemSearchOpen, setSystemSearchOpen] = useState(false);
  const [activeSystemResult, setActiveSystemResult] = useState(0);
  const normalizedSystemQuery = normalizeSearchText(systemQuery);
  const matchingSystems = useMemo(() => {
    if (!normalizedSystemQuery) return systems.slice(0, 8);
    return systems
      .filter((system) => systemSearchText(system).includes(normalizedSystemQuery))
      .sort((left, right) => {
        const leftName = normalizeSearchText(left.name);
        const rightName = normalizeSearchText(right.name);
        const leftStarts = leftName.startsWith(normalizedSystemQuery) ? 0 : 1;
        const rightStarts = rightName.startsWith(normalizedSystemQuery) ? 0 : 1;
        return leftStarts - rightStarts || left.name.localeCompare(right.name, "es");
      })
      .slice(0, 8);
  }, [normalizedSystemQuery]);
  const selectedSystemIncidents = useMemo(
    () =>
      incidents.filter(
        (incident) =>
          incident.systemCode === draft.systemCode &&
          !isResolvedIncident(incident),
      ),
    [draft.systemCode, incidents],
  );

  function chooseSystem(system: SystemSSR) {
    updateDraft("systemCode", system.code);
    setSystemQuery(system.name);
    setSystemSearchOpen(false);
    setActiveSystemResult(0);
  }

  function clearSystem() {
    updateDraft("systemCode", "");
    setSystemQuery("");
    setSystemSearchOpen(true);
    setActiveSystemResult(0);
  }

  function handleSystemSearchKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
  ) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSystemSearchOpen(true);
      setActiveSystemResult((current) =>
        Math.min(current + 1, Math.max(0, matchingSystems.length - 1)),
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSystemResult((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter" && systemSearchOpen) {
      const result = matchingSystems[activeSystemResult];
      if (result) {
        event.preventDefault();
        chooseSystem(result);
      }
    } else if (event.key === "Escape") {
      setSystemSearchOpen(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="wizard" role="dialog" aria-modal="true">
        <header className="wizard-header">
          <div>
            <span className="eyebrow">Nuevo reporte · Versión {APP_VERSION}</span>
            <h2>
              {step === 1
                ? "Identificación"
                : step === 2
                  ? "Afectación"
                  : "Evidencia y envío"}
            </h2>
          </div>
          <button type="button" onClick={close} aria-label="Cerrar">
            ×
          </button>
        </header>
        <div className="wizard-progress">
          {[1, 2, 3].map((number) => (
            <div
              key={number}
              className={number <= step ? "complete" : ""}
              aria-current={number === step ? "step" : undefined}
            >
              <span>{number < step ? "✓" : number}</span>
              <small>
                {number === 1
                  ? "Identificación"
                  : number === 2
                    ? "Afectación"
                    : "Evidencia"}
              </small>
            </div>
          ))}
        </div>

        <div className="wizard-body">
          {step === 1 && (
            <div className="form-grid">
              <div className="form-field wide system-search-field">
                <label className="field-label" htmlFor="system-search">
                  Sistema SSR <b>*</b>
                </label>
                <div
                  className="system-combobox"
                  onBlur={(event) => {
                    const nextTarget = event.relatedTarget as Node | null;
                    if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
                      setSystemSearchOpen(false);
                    }
                  }}
                >
                  <div className="system-search-control">
                    <span aria-hidden>⌕</span>
                    <input
                      id="system-search"
                      role="combobox"
                      aria-autocomplete="list"
                      aria-expanded={systemSearchOpen}
                      aria-controls="system-search-results"
                      aria-activedescendant={
                        systemSearchOpen && matchingSystems[activeSystemResult]
                          ? `system-result-${matchingSystems[activeSystemResult].code}`
                          : undefined
                      }
                      autoComplete="off"
                      value={systemQuery}
                      onFocus={() => setSystemSearchOpen(true)}
                      onChange={(event) => {
                        setSystemQuery(event.target.value);
                        if (draft.systemCode) updateDraft("systemCode", "");
                        setSystemSearchOpen(true);
                        setActiveSystemResult(0);
                      }}
                      onKeyDown={handleSystemSearchKeyDown}
                      placeholder="Escribe el nombre, comuna o código SSR"
                    />
                    {systemQuery && (
                      <button
                        className="system-search-clear"
                        type="button"
                        onClick={clearSystem}
                        aria-label="Limpiar sistema seleccionado"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  {systemSearchOpen && (
                    <div
                      className="system-search-results"
                      id="system-search-results"
                      role="listbox"
                      aria-label="Sistemas SSR encontrados"
                    >
                      {matchingSystems.map((system, index) => {
                        const activeCount = incidents.filter(
                          (incident) =>
                            incident.systemCode === system.code &&
                            !isResolvedIncident(incident),
                        ).length;
                        return (
                          <button
                            id={`system-result-${system.code}`}
                            className={
                              index === activeSystemResult ? "active" : ""
                            }
                            type="button"
                            role="option"
                            aria-selected={index === activeSystemResult}
                            key={system.code}
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => setActiveSystemResult(index)}
                            onClick={() => chooseSystem(system)}
                          >
                            <span>
                              <strong>{system.name}</strong>
                              <small>
                                {system.commune} · {system.province} · {system.code}
                              </small>
                            </span>
                            <span
                              className={
                                activeCount ? "with-incidents" : "clear"
                              }
                            >
                              {activeCount
                                ? `${activeCount} activo${activeCount === 1 ? "" : "s"}`
                                : "Sin incidentes"}
                            </span>
                          </button>
                        );
                      })}
                      {!matchingSystems.length && (
                        <div className="system-search-empty">
                          <strong>No encontramos coincidencias</strong>
                          <small>
                            Prueba con otra parte del nombre, comuna o código.
                          </small>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {selectedSystem && (
                  <div className="selected-system-card">
                    <span className="selected-system-check">✓</span>
                    <span>
                      <strong>{selectedSystem.name}</strong>
                      <small>
                        {selectedSystem.commune} · {selectedSystem.province} ·{" "}
                        {selectedSystem.code}
                      </small>
                    </span>
                    <button type="button" onClick={clearSystem}>
                      Cambiar
                    </button>
                  </div>
                )}
                {!!selectedSystemIncidents.length && (
                  <div className="active-incident-warning" role="status">
                    <span>!</span>
                    <p>
                      <strong>
                        Este sistema ya tiene {selectedSystemIncidents.length}{" "}
                        incidente
                        {selectedSystemIncidents.length === 1
                          ? " activo"
                          : "s activos"}
                        .
                      </strong>
                      Verifica que el nuevo reporte corresponda a una falla
                      diferente para evitar duplicados.
                    </p>
                  </div>
                )}
              </div>
              <label>
                Fecha y hora de ocurrencia
                <input
                  type="datetime-local"
                  value={draft.occurredAt}
                  onChange={(event) =>
                    updateDraft("occurredAt", event.target.value)
                  }
                />
              </label>
              <label>
                Prioridad preliminar
                <select
                  value={draft.priority}
                  onChange={(event) =>
                    updateDraft("priority", event.target.value as Priority)
                  }
                >
                  <option>Baja</option>
                  <option>Media</option>
                  <option>Alta</option>
                  <option>Crítica</option>
                </select>
              </label>
              <label className="wide">
                Categoría <b>*</b>
                <select
                  value={draft.category}
                  onChange={(event) => updateDraft("category", event.target.value)}
                >
                  <option value="">Selecciona una categoría</option>
                  {categoryGroups.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.options.map((category) => (
                        <option key={category}>{category}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="wide">
                Descripción detallada <b>*</b>
                <textarea
                  rows={4}
                  value={draft.description}
                  onChange={(event) =>
                    updateDraft("description", event.target.value)
                  }
                  placeholder="Describe qué ocurrió, desde cuándo y cualquier antecedente relevante…"
                />
                <small>{draft.description.length}/1.000 caracteres</small>
              </label>
              <label className="wide">
                Nombre de quien informó
                <input
                  value={draft.informedBy}
                  onChange={(event) =>
                    updateDraft("informedBy", event.target.value)
                  }
                  placeholder={`Si es diferente de ${user.name}`}
                />
              </label>
            </div>
          )}

          {step === 2 && (
            <div className="form-grid">
              <label>
                Estado del suministro de agua
                <select
                  value={draft.water}
                  onChange={(event) => updateDraft("water", event.target.value)}
                >
                  <option>Normal</option>
                  <option>Parcial</option>
                  <option>Interrumpido</option>
                  <option>Sin información</option>
                </select>
              </label>
              <label>
                Estado eléctrico
                <select
                  value={draft.electricity}
                  onChange={(event) =>
                    updateDraft("electricity", event.target.value)
                  }
                >
                  <option>Normal</option>
                  <option>Sin suministro de red</option>
                  <option>Operando con generador</option>
                  <option>Falla eléctrica interna</option>
                  <option>Sin información</option>
                </select>
              </label>
              <label>
                Arranques estimados afectados
                <input
                  type="number"
                  min="0"
                  max={selectedSystem?.connections}
                  value={draft.affected}
                  onChange={(event) =>
                    updateDraft("affected", event.target.value)
                  }
                  placeholder={`Máximo ${selectedSystem?.connections ?? 0}`}
                />
                <small className="people-estimate">
                  ≈ {formatNumber(estimatedPeople(Number(draft.affected) || 0))}{" "}
                  personas afectadas · criterio de {PEOPLE_PER_CONNECTION} habitantes por arranque
                </small>
              </label>
              <label>
                Sectores afectados
                <input
                  value={draft.sectors}
                  onChange={(event) => updateDraft("sectors", event.target.value)}
                  placeholder="Ej.: sector norte y camino principal"
                />
              </label>
              <label className="wide urgent-box">
                <input
                  type="checkbox"
                  checked={draft.urgent}
                  onChange={(event) => updateDraft("urgent", event.target.checked)}
                />
                <span>
                  <strong>Requiere apoyo urgente</strong>
                  <small>
                    Marca esta opción si existe riesgo de continuidad del servicio.
                  </small>
                </span>
              </label>
              <label className="wide">
                Tipo de apoyo requerido
                <input
                  value={draft.support}
                  onChange={(event) => updateDraft("support", event.target.value)}
                  placeholder="Generador, combustible, apoyo técnico u otro"
                />
              </label>
              <label className="wide">
                Observaciones técnicas
                <textarea
                  rows={3}
                  value={draft.notes}
                  onChange={(event) => updateDraft("notes", event.target.value)}
                  placeholder="Equipos involucrados, alarmas, mediciones u otros datos…"
                />
              </label>
            </div>
          )}

          {step === 3 && (
            <div className="evidence-layout">
              <div>
                <span className="field-title">Fotografías de respaldo</span>
                <label className="photo-uploader">
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    onChange={handlePhotos}
                  />
                  <span>＋</span>
                  <strong>Tomar o seleccionar fotografías</strong>
                  <small>Máximo 4 imágenes · Compresión automática</small>
                </label>
                {!!photos.length && (
                  <div className="photo-grid">
                    {photos.map((photo, index) => (
                      <div key={photo.preview}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo.preview} alt={`Vista previa ${index + 1}`} />
                        <span>{index + 1}</span>
                      </div>
                    ))}
                  </div>
                )}
                <span className="field-title location-title">
                  Ubicación opcional
                </span>
                <button
                  className="location-button"
                  type="button"
                  onClick={requestLocation}
                >
                  <span>◎</span>
                  {draft.latitude
                    ? `${draft.latitude}, ${draft.longitude}`
                    : "Incorporar ubicación actual"}
                </button>
              </div>
              <aside className="report-summary-card">
                <span className="eyebrow">Resumen del reporte</span>
                <h3>{selectedSystem?.name || "Sistema por seleccionar"}</h3>
                <dl>
                  <div>
                    <dt>Categoría</dt>
                    <dd>{draft.category || "—"}</dd>
                  </div>
                  <div>
                    <dt>Prioridad</dt>
                    <dd>
                      <span className={priorityClass(draft.priority)}>
                        {draft.priority}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Estado del agua</dt>
                    <dd>{draft.water}</dd>
                  </div>
                  <div>
                    <dt>Estado eléctrico</dt>
                    <dd>{draft.electricity}</dd>
                  </div>
                  <div>
                    <dt>Arranques afectados</dt>
                    <dd>{draft.affected || "0"}</dd>
                  </div>
                  <div>
                    <dt>Personas afectadas</dt>
                    <dd>
                      ≈ {formatNumber(estimatedPeople(Number(draft.affected) || 0))}
                    </dd>
                  </div>
                  <div>
                    <dt>Ingresado por</dt>
                    <dd>{user.name}</dd>
                  </div>
                </dl>
                <p>{draft.description}</p>
              </aside>
            </div>
          )}
        </div>

        <footer className="wizard-footer">
          <span>
            <i /> Borrador guardado automáticamente
          </span>
          <div>
            {step > 1 && (
              <button className="secondary-button" type="button" onClick={back}>
                Atrás
              </button>
            )}
            {step < 3 ? (
              <button className="primary-button" type="button" onClick={next}>
                Continuar <span>→</span>
              </button>
            ) : (
              <button className="primary-button" type="button" onClick={submit}>
                Registrar reporte
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}

function IncidentDetail({
  incident,
  close,
  canFollowUp,
  canResolve,
  addFollowUp,
  downloadReport,
}: {
  incident: Incident;
  close: () => void;
  canFollowUp: boolean;
  canResolve: boolean;
  addFollowUp: (
    incidentCode: string,
    text: string,
    nextStatus: IncidentStatus,
  ) => void;
  downloadReport: (incident: Incident) => Promise<void>;
}) {
  const [actionMode, setActionMode] = useState<"followup" | "resolve" | null>(
    null,
  );
  const [followUpText, setFollowUpText] = useState("");
  const [nextStatus, setNextStatus] = useState<IncidentStatus>(incident.status);
  const [validationMessage, setValidationMessage] = useState("");
  const isResolved =
    incident.status === "Resuelto" || incident.status === "Cerrado";

  function openAction(mode: "followup" | "resolve") {
    setActionMode(mode);
    setFollowUpText("");
    setValidationMessage("");
    setNextStatus(mode === "resolve" ? "Resuelto" : incident.status);
  }

  function submitFollowUp(event: FormEvent) {
    event.preventDefault();
    if (followUpText.trim().length < 10) {
      setValidationMessage("El comentario debe tener al menos 10 caracteres.");
      return;
    }
    addFollowUp(
      incident.code,
      followUpText,
      actionMode === "resolve" ? "Resuelto" : nextStatus,
    );
    setActionMode(null);
    setFollowUpText("");
    setValidationMessage("");
  }

  return (
    <div className="modal-backdrop detail-backdrop" role="presentation">
      <section className="incident-detail" role="dialog" aria-modal="true">
        <header>
          <div>
            <span className="incident-code">
              {incident.code}
            </span>
            <h2>{incident.system}</h2>
            <p>{incident.category}</p>
          </div>
          <button type="button" onClick={close} aria-label="Cerrar">
            ×
          </button>
        </header>
        <div className="detail-status-row">
          <span className={priorityClass(incident.priority)}>
            {incident.priority}
          </span>
          <span className="state-pill">
            <i className={statusClass(incident.status)} />
            {incident.status}
          </span>
        </div>
        <div className="detail-body">
          <section>
            <span className="eyebrow">Situación informada</span>
            <p className="detail-description">{incident.description}</p>
            <div className="detail-metrics">
              <div>
                <small>Estado del agua</small>
                <strong>{incident.water}</strong>
              </div>
              <div>
                <small>Estado eléctrico</small>
                <strong>{incident.electricity}</strong>
              </div>
              <div>
                <small>Arranques afectados</small>
                <strong>{formatNumber(incident.affected)}</strong>
              </div>
              <div>
                <small>Personas afectadas</small>
                <strong>≈ {formatNumber(estimatedPeople(incident.affected))}</strong>
              </div>
              <div>
                <small>Responsable actual</small>
                <strong>{incident.responsible}</strong>
              </div>
            </div>
            {(incident.sectors ||
              incident.support ||
              incident.notes ||
              (incident.latitude != null && incident.longitude != null)) && (
              <div className="incident-extra-data">
                {incident.sectors && (
                  <p><small>Sectores afectados</small><strong>{incident.sectors}</strong></p>
                )}
                {incident.support && (
                  <p><small>Apoyo requerido</small><strong>{incident.support}</strong></p>
                )}
                {incident.notes && (
                  <p><small>Observaciones técnicas</small><strong>{incident.notes}</strong></p>
                )}
                {incident.latitude != null && incident.longitude != null && (
                  <a
                    href={`https://www.google.com/maps?q=${incident.latitude},${incident.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ver ubicación registrada ↗
                  </a>
                )}
              </div>
            )}
          </section>
          <section className="timeline-section">
            <span className="eyebrow">Historial inalterable</span>
            <div className="timeline">
              <div>
                <i />
                <p>
                  <strong>Reporte ingresado</strong>
                  <span>
                    Por {incident.enteredBy} · {incident.createdAt}
                  </span>
                </p>
              </div>
              <div>
                <i />
                <p>
                  <strong>Estado inicial “Reportado”</strong>
                  <span>Registro de apertura del incidente</span>
                </p>
              </div>
              {!!incident.attachments?.length && (
                <div className="timeline-photo-event">
                  <i />
                  <div>
                    <p>
                      <strong>Fotografías incorporadas</strong>
                      <span>
                        {incident.attachments.length} archivo
                        {incident.attachments.length === 1 ? "" : "s"} disponible
                        {incident.attachments.length === 1 ? "" : "s"} en la trazabilidad
                      </span>
                    </p>
                    <div className="trace-photo-grid">
                      {incident.attachments.map((attachment) => (
                        <a
                          key={attachment.id}
                          href={attachment.url}
                          target="_blank"
                          rel="noreferrer"
                          title={`Abrir ${attachment.fileName}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={attachment.url} alt={attachment.fileName} />
                          <span>
                            {attachment.uploadedBy} · {attachment.createdAt}
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {(incident.followUps ?? []).map((followUp) => (
                <div
                  key={followUp.id}
                  className={
                    followUp.status === "Resuelto" ? "timeline-resolved" : ""
                  }
                >
                  <i />
                  <p>
                    <strong>
                      {followUp.eventType === "photo_added"
                        ? "Registro fotográfico actualizado"
                        : followUp.status === "Resuelto"
                        ? "Alerta resuelta"
                        : `Seguimiento · ${followUp.status}`}
                    </strong>
                    <span>{followUp.text}</span>
                    <span>
                      Por {followUp.author} · {followUp.createdAt}
                    </span>
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
        {actionMode && (
          <form
            className={`followup-composer ${
              actionMode === "resolve" ? "resolve-composer" : ""
            }`}
            onSubmit={submitFollowUp}
          >
              <div>
                <span className="eyebrow">
                  {actionMode === "resolve"
                    ? "Cerrar alerta"
                    : "Nuevo seguimiento"}
                </span>
                <strong>
                  {actionMode === "resolve"
                    ? "Explica cómo se resolvió la falla"
                    : "Agrega un antecedente al historial"}
                </strong>
                {actionMode === "resolve" && (
                  <small>
                    Al guardar, este SSR dejará de mostrarse con alerta activa.
                  </small>
                )}
              </div>
              {actionMode === "followup" && (
                <label>
                  Estado del reporte
                  <select
                    value={nextStatus}
                    onChange={(event) =>
                      setNextStatus(event.target.value as IncidentStatus)
                    }
                  >
                    <option>Reportado</option>
                    <option>En revisión</option>
                    <option>En gestión</option>
                    <option>En monitoreo</option>
                  </select>
                </label>
              )}
              <label>
                {actionMode === "resolve"
                  ? "Comentario de resolución *"
                  : "Detalle del seguimiento"}
                <textarea
                  rows={3}
                  value={followUpText}
                  onChange={(event) => {
                    setFollowUpText(event.target.value);
                    setValidationMessage("");
                  }}
                  placeholder={
                    actionMode === "resolve"
                      ? "Ej.: suministro normalizado y sistema operando sin novedades."
                      : "Describe la gestión realizada, respuesta recibida o situación actual."
                  }
                  autoFocus
                />
              </label>
              {validationMessage && (
                <p className="form-error">{validationMessage}</p>
              )}
              <div className="followup-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setActionMode(null)}
                >
                  Cancelar
                </button>
                <button
                  className={
                    actionMode === "resolve"
                      ? "resolve-confirm-button"
                      : "primary-button"
                  }
                  type="submit"
                >
                  {actionMode === "resolve"
                    ? "Guardar y cerrar alerta"
                    : "Guardar seguimiento"}
                </button>
              </div>
          </form>
        )}
        <footer>
          <span>
            Reportado por <strong>{incident.reportedBy}</strong>
          </span>
          <div className="detail-footer-actions">
            <button
              className="download-incident-button"
              type="button"
              onClick={() => void downloadReport(incident)}
            >
              ↓ Descargar informe
            </button>
            {isResolved ? (
              <span className="resolved-indicator">✓ Sin alerta activa</span>
            ) : (
              <>
                {canResolve && (
                  <button
                    className="resolve-button"
                    type="button"
                    onClick={() => openAction("resolve")}
                  >
                    Cerrar alerta
                  </button>
                )}
                {canFollowUp && (
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => openAction("followup")}
                  >
                    Agregar seguimiento
                  </button>
                )}
              </>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
