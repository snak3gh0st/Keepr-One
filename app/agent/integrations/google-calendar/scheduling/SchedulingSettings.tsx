"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/LanguageProvider";

gsap.registerPlugin(useGSAP);

const DAYS = [
  { value: 0, pt: "Domingo", en: "Sunday", shortPt: "Dom", shortEn: "Sun" },
  { value: 1, pt: "Segunda-feira", en: "Monday", shortPt: "Seg", shortEn: "Mon" },
  { value: 2, pt: "Terça-feira", en: "Tuesday", shortPt: "Ter", shortEn: "Tue" },
  { value: 3, pt: "Quarta-feira", en: "Wednesday", shortPt: "Qua", shortEn: "Wed" },
  { value: 4, pt: "Quinta-feira", en: "Thursday", shortPt: "Qui", shortEn: "Thu" },
  { value: 5, pt: "Sexta-feira", en: "Friday", shortPt: "Sex", shortEn: "Fri" },
  { value: 6, pt: "Sábado", en: "Saturday", shortPt: "Sáb", shortEn: "Sat" },
] as const;

const EDITOR_SECTIONS = [
  { id: "public", targetId: "scheduling-public-section", pt: "Página pública", en: "Public page", shortPt: "Página", shortEn: "Page" },
  { id: "meeting", targetId: "scheduling-rules-section", pt: "Reunião", en: "Meeting", shortPt: "Reunião", shortEn: "Meeting" },
  { id: "availability", targetId: "scheduling-hours-section", pt: "Disponibilidade", en: "Availability", shortPt: "Horários", shortEn: "Hours" },
  { id: "publication", targetId: "scheduling-publication-section", pt: "Publicação", en: "Publication", shortPt: "Publicar", shortEn: "Publish" },
] as const;

type EditorSectionId = (typeof EDITOR_SECTIONS)[number]["id"];

type SchedulingWindow = {
  id?: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
};

type SchedulingPageRecord = {
  id: string;
  slug: string;
  enabled: boolean;
  title: string;
  description: string | null;
  durationMinutes: number;
  slotIntervalMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minimumNoticeMinutes: number;
  maximumAdvanceDays: number;
  weeklyWindows: SchedulingWindow[];
};

type SchedulingReadiness = {
  googleConnected: boolean;
  freeBusyGranted: boolean;
  writableDefaultCalendar: boolean;
  confirmationEmailReady: boolean;
  canEnable: boolean;
};

type SchedulingPageResponse = {
  page: SchedulingPageRecord | null;
  readiness: SchedulingReadiness;
  ownerTimeZone: string;
};

type Draft = Omit<SchedulingPageRecord, "id" | "description" | "weeklyWindows"> & {
  description: string;
  weeklyWindows: Array<SchedulingWindow & { clientId: string }>;
};

type Feedback = { kind: "success" | "error"; message: string } | null;

const DEFAULT_READINESS: SchedulingReadiness = {
  googleConnected: false,
  freeBusyGranted: false,
  writableDefaultCalendar: false,
  confirmationEmailReady: false,
  canEnable: false,
};

function clientId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `window-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function defaultWindows() {
  return DAYS.filter((day) => day.value >= 1 && day.value <= 5).map((day) => ({
    clientId: clientId(),
    weekday: day.value,
    startMinute: 9 * 60,
    endMinute: 17 * 60,
  }));
}

function defaultDraft(language: "PT" | "EN" = "PT"): Draft {
  return {
    slug: "",
    enabled: false,
    title: language === "PT" ? "Reunião de 30 minutos" : "30-minute meeting",
    description: language === "PT" ? "Escolha o melhor horário para conversarmos." : "Choose the best time for us to talk.",
    durationMinutes: 30,
    slotIntervalMinutes: 30,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 10,
    minimumNoticeMinutes: 120,
    maximumAdvanceDays: 30,
    weeklyWindows: defaultWindows(),
  };
}

function draftFromPage(page: SchedulingPageRecord | null, language: "PT" | "EN" = "PT"): Draft {
  if (!page) return defaultDraft(language);
  return {
    slug: page.slug,
    enabled: page.enabled,
    title: page.title,
    description: page.description ?? "",
    durationMinutes: page.durationMinutes,
    slotIntervalMinutes: page.slotIntervalMinutes,
    bufferBeforeMinutes: page.bufferBeforeMinutes,
    bufferAfterMinutes: page.bufferAfterMinutes,
    minimumNoticeMinutes: page.minimumNoticeMinutes,
    maximumAdvanceDays: page.maximumAdvanceDays,
    weeklyWindows: page.weeklyWindows.map((window) => ({ ...window, clientId: clientId() })),
  };
}

function draftSignature(draft: Draft) {
  return JSON.stringify({
    slug: draft.slug,
    enabled: draft.enabled,
    title: draft.title,
    description: draft.description,
    durationMinutes: draft.durationMinutes,
    slotIntervalMinutes: draft.slotIntervalMinutes,
    bufferBeforeMinutes: draft.bufferBeforeMinutes,
    bufferAfterMinutes: draft.bufferAfterMinutes,
    minimumNoticeMinutes: draft.minimumNoticeMinutes,
    maximumAdvanceDays: draft.maximumAdvanceDays,
    weeklyWindows: draft.weeklyWindows
      .map(({ weekday, startMinute, endMinute }) => ({ weekday, startMinute, endMinute }))
      .sort((left, right) => left.weekday - right.weekday || left.startMinute - right.startMinute || left.endMinute - right.endMinute),
  });
}

export function minutesToTime(minutes: number) {
  const hours = Math.floor(minutes / 60).toString().padStart(2, "0");
  const remainder = (minutes % 60).toString().padStart(2, "0");
  return `${hours}:${remainder}`;
}

export function timeToMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function validateSchedulingDraft(draft: Draft, language: "PT" | "EN" = "PT") {
  const local = (pt: string, en: string) => language === "PT" ? pt : en;
  const errors: Record<string, string> = {};
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug) || draft.slug.length < 3 || draft.slug.length > 64) {
    errors.slug = local("Use de 3 a 64 caracteres minúsculos, números e hífens.", "Use 3 to 64 lowercase letters, numbers, and hyphens.");
  }
  if (draft.title.trim().length < 1 || draft.title.trim().length > 120) {
    errors.title = local("Informe um título de até 120 caracteres.", "Enter a title up to 120 characters.");
  }
  if (draft.description.length > 1000) errors.description = local("Use no máximo 1.000 caracteres.", "Use no more than 1,000 characters.");
  if (draft.enabled && draft.weeklyWindows.length === 0) {
    errors.weeklyWindows = local("Adicione pelo menos um período disponível antes de publicar.", "Add at least one available period before publishing.");
  }
  for (const day of DAYS) {
    const windows = draft.weeklyWindows
      .filter((window) => window.weekday === day.value)
      .sort((a, b) => a.startMinute - b.startMinute);
    for (let index = 0; index < windows.length; index += 1) {
      const window = windows[index];
      if (window.startMinute >= window.endMinute) {
        errors.weeklyWindows = local(`Revise o horário de ${day.pt.toLowerCase()}.`, `Review the hours for ${day.en}.`);
        break;
      }
      if (index > 0 && windows[index - 1].endMinute > window.startMinute) {
        errors.weeklyWindows = local(`Existem períodos sobrepostos em ${day.pt.toLowerCase()}.`, `There are overlapping periods on ${day.en}.`);
        break;
      }
    }
  }
  return errors;
}

async function responseMessage(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as { message?: string };
    return data.message?.trim() || fallback;
  } catch {
    return fallback;
  }
}

export function SchedulingSettings() {
  const { copy, language } = useI18n();
  const formRef = useRef<HTMLFormElement>(null);
  const navIndicatorRef = useRef<HTMLSpanElement>(null);
  const manualNavigationRef = useRef(false);
  const manualNavigationTimeoutRef = useRef<number | null>(null);
  const [draft, setDraft] = useState<Draft>(() => defaultDraft(language));
  const [persistedLink, setPersistedLink] = useState<{ slug: string; enabled: boolean } | null>(null);
  const [savedSignature, setSavedSignature] = useState<string | null>();
  const [readiness, setReadiness] = useState(DEFAULT_READINESS);
  const [ownerTimeZone, setOwnerTimeZone] = useState("America/New_York");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reloadKey, setReloadKey] = useState(0);
  const [activeSection, setActiveSection] = useState<EditorSectionId>("public");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setLoadFailed(false);
      setFeedback(null);
      try {
        const response = await fetch("/api/agent/scheduling/page", {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(await responseMessage(response, copy("Não foi possível carregar o agendamento.", "Could not load scheduling.")));
        const data = (await response.json()) as SchedulingPageResponse;
        const nextDraft = draftFromPage(data.page, language);
        setDraft(nextDraft);
        setSavedSignature(data.page ? draftSignature(nextDraft) : null);
        setPersistedLink(data.page ? { slug: data.page.slug, enabled: data.page.enabled } : null);
        setReadiness(data.readiness);
        setOwnerTimeZone(data.ownerTimeZone);
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadFailed(true);
        setFeedback({ kind: "error", message: error instanceof Error ? error.message : copy("Não foi possível carregar o agendamento.", "Could not load scheduling.") });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [copy, language, reloadKey]);

  useEffect(() => {
    if (loading || typeof IntersectionObserver === "undefined") return;
    const sections = EDITOR_SECTIONS
      .filter((section) => section.id !== "publication")
      .map((section) => document.getElementById(section.targetId))
      .filter((section): section is HTMLElement => Boolean(section));
    const observer = new IntersectionObserver((entries) => {
      if (manualNavigationRef.current) return;
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => Math.abs(left.boundingClientRect.top) - Math.abs(right.boundingClientRect.top))[0];
      if (!visible) return;
      const next = EDITOR_SECTIONS.find((section) => section.targetId === visible.target.id);
      if (next) setActiveSection(next.id);
    }, { rootMargin: "-180px 0px -55% 0px", threshold: [0, 0.1, 0.4] });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [loading]);

  useEffect(() => () => {
    if (manualNavigationTimeoutRef.current !== null) window.clearTimeout(manualNavigationTimeoutRef.current);
  }, []);

  useGSAP(() => {
    if (!navIndicatorRef.current) return;
    const index = EDITOR_SECTIONS.findIndex((section) => section.id === activeSection);
    const target = { xPercent: Math.max(index, 0) * 100 };
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      gsap.set(navIndicatorRef.current, target);
      return;
    }
    gsap.to(navIndicatorRef.current, {
      ...target,
      duration: 0.22,
      ease: "power4.out",
      overwrite: true,
    });
  }, { scope: formRef, dependencies: [activeSection, loading], revertOnUpdate: true });

  const previewPath = draft.slug ? `/agendar/${draft.slug}` : "/agendar/seu-link";
  const persistedPath = persistedLink?.slug ? `/agendar/${persistedLink.slug}` : null;
  const canShare = Boolean(persistedLink?.enabled && persistedPath);
  const isDirty = savedSignature === null || (typeof savedSignature === "string" && savedSignature !== draftSignature(draft));
  const windowsByDay = useMemo(() => new Map<number, Draft["weeklyWindows"]>(DAYS.map((day) => [
    Number(day.value),
    draft.weeklyWindows
      .filter((window) => window.weekday === day.value)
      .sort((a, b) => a.startMinute - b.startMinute),
  ])), [draft.weeklyWindows]);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setFeedback(null);
    setErrors((current) => ({ ...current, [key]: "" }));
  }

  function goToSection(sectionId: EditorSectionId) {
    const section = EDITOR_SECTIONS.find((item) => item.id === sectionId);
    const target = section ? document.getElementById(section.targetId) : null;
    manualNavigationRef.current = true;
    if (manualNavigationTimeoutRef.current !== null) window.clearTimeout(manualNavigationTimeoutRef.current);
    manualNavigationTimeoutRef.current = window.setTimeout(() => {
      manualNavigationRef.current = false;
      manualNavigationTimeoutRef.current = null;
    }, 800);
    setActiveSection(sectionId);
    target?.scrollIntoView({
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
    target?.focus({ preventScroll: true });
  }

  function addWindow(weekday: number) {
    const current = windowsByDay.get(weekday) ?? [];
    const last = current[current.length - 1];
    const startMinute = last ? Math.min(last.endMinute + 60, 22 * 60) : 9 * 60;
    const endMinute = Math.min(startMinute + 4 * 60, 23 * 60 + 59);
    update("weeklyWindows", [...draft.weeklyWindows, { clientId: clientId(), weekday, startMinute, endMinute }]);
  }

  function removeWindow(id: string) {
    update("weeklyWindows", draft.weeklyWindows.filter((window) => window.clientId !== id));
  }

  function updateWindow(id: string, key: "startMinute" | "endMinute", value: string) {
    const minutes = timeToMinutes(value);
    if (minutes === null) return;
    update("weeklyWindows", draft.weeklyWindows.map((window) => window.clientId === id ? { ...window, [key]: minutes } : window));
  }

  async function copyLink() {
    if (!canShare || !persistedPath) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${persistedPath}`);
      setFeedback({ kind: "success", message: copy("Link copiado.", "Link copied.") });
    } catch {
      setFeedback({ kind: "error", message: copy("Não foi possível copiar. Selecione o endereço manualmente.", "Could not copy the link. Select the address manually.") });
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateSchedulingDraft(draft, language);
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      setFeedback({ kind: "error", message: copy("Revise os campos indicados.", "Review the highlighted fields.") });
      goToSection(nextErrors.slug || nextErrors.title || nextErrors.description ? "public" : "availability");
      window.requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/agent/scheduling/page", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          slug: draft.slug,
          enabled: draft.enabled,
          title: draft.title.trim(),
          description: draft.description.trim() || null,
          durationMinutes: draft.durationMinutes,
          slotIntervalMinutes: draft.slotIntervalMinutes,
          bufferBeforeMinutes: draft.bufferBeforeMinutes,
          bufferAfterMinutes: draft.bufferAfterMinutes,
          minimumNoticeMinutes: draft.minimumNoticeMinutes,
          maximumAdvanceDays: draft.maximumAdvanceDays,
          weeklyWindows: draft.weeklyWindows.map(({ weekday, startMinute, endMinute }) => ({ weekday, startMinute, endMinute })),
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, copy("Não foi possível salvar agora.", "Could not save right now.")));
      const data = (await response.json()) as SchedulingPageResponse;
      const nextDraft = draftFromPage(data.page, language);
      setDraft(nextDraft);
      setSavedSignature(data.page ? draftSignature(nextDraft) : null);
      setPersistedLink(data.page ? { slug: data.page.slug, enabled: data.page.enabled } : null);
      setReadiness(data.readiness);
      setOwnerTimeZone(data.ownerTimeZone);
      setErrors({});
      setFeedback({
        kind: "success",
        message: data.page?.enabled
          ? copy("Link publicado e atualizado.", "Link published and updated.")
          : copy("Configurações salvas.", "Settings saved."),
      });
    } catch (error) {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : copy("Não foi possível salvar agora.", "Could not save right now.") });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="scheduling-settings-loading" role="status"><span />{copy("Carregando configurações…", "Loading settings…")}</div>;
  }

  if (loadFailed) {
    return (
      <div className="scheduling-settings-load-error" role="alert">
        <strong>{copy("Não foi possível abrir esta configuração.", "Could not open these settings.")}</strong>
        <p>{feedback?.message ?? copy("Não foi possível carregar o agendamento.", "Could not load scheduling.")}</p>
        <button type="button" onClick={() => setReloadKey((value) => value + 1)}>{copy("Tentar novamente", "Try again")}</button>
      </div>
    );
  }

  return (
    <div className="scheduling-settings-shell">
      <form ref={formRef} onSubmit={save} noValidate>
        <div className="scheduling-workspace-toolbar">
          <nav className="scheduling-section-nav" aria-label={copy("Seções da configuração", "Settings sections")}>
            <div className="scheduling-section-nav-track">
              {EDITOR_SECTIONS.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  aria-label={copy(section.pt, section.en)}
                  aria-controls={section.targetId}
                  aria-current={activeSection === section.id ? "step" : undefined}
                  onClick={() => goToSection(section.id)}
                >
                  <span className="scheduling-section-nav-label-long" aria-hidden="true">{copy(section.pt, section.en)}</span>
                  <span className="scheduling-section-nav-label-short" aria-hidden="true">{copy(section.shortPt, section.shortEn)}</span>
                </button>
              ))}
              <span ref={navIndicatorRef} className="scheduling-section-nav-indicator" aria-hidden="true" />
            </div>
          </nav>
          <div className="scheduling-toolbar-actions">
            <div aria-live="polite">
              {feedback
                ? <p data-kind={feedback.kind}>{feedback.message}</p>
                : <p>{isDirty ? copy("Alterações não salvas.", "Unsaved changes.") : copy("Tudo salvo.", "Everything is saved.")}</p>}
            </div>
            <button type="submit" disabled={saving || !isDirty}>
              {saving
                ? copy("Salvando…", "Saving…")
                : isDirty
                  ? draft.enabled
                    ? copy("Salvar e publicar", "Save and publish")
                    : copy("Salvar rascunho", "Save draft")
                  : copy("Salvo", "Saved")}
            </button>
          </div>
        </div>

        <div className="scheduling-settings-main">
          <section id="scheduling-public-section" className="scheduling-editor-section" aria-labelledby="scheduling-public-title" tabIndex={-1}>
            <header>
              <div>
                <h2 id="scheduling-public-title">{copy("Página pública", "Public page")}</h2>
                <p>{copy("Defina o conteúdo e o endereço que seu cliente verá.", "Define the content and address your client will see.")}</p>
              </div>
            </header>
            <div className="scheduling-field-grid">
              <label className="scheduling-field scheduling-field-wide">
                <span>{copy("Título", "Title")}</span>
                <input value={draft.title} maxLength={120} onChange={(event) => update("title", event.target.value)} aria-invalid={Boolean(errors.title)} aria-describedby={errors.title ? "scheduling-title-error" : undefined} />
                {errors.title ? <small id="scheduling-title-error" role="alert">{errors.title}</small> : null}
              </label>
              <label className="scheduling-field scheduling-field-wide">
                <span>{copy("Descrição", "Description")}</span>
                <textarea value={draft.description} maxLength={1000} rows={3} onChange={(event) => update("description", event.target.value)} aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? "scheduling-description-error" : undefined} />
                {errors.description ? <small id="scheduling-description-error" role="alert">{errors.description}</small> : <small>{draft.description.length}/1.000</small>}
              </label>
              <label className="scheduling-field scheduling-field-wide">
                <span>{copy("Endereço do link", "Link address")}</span>
                <div className="scheduling-slug-input"><i aria-hidden="true">/agendar/</i><input aria-label={copy("Endereço do link", "Link address")} value={draft.slug} minLength={3} maxLength={64} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(event) => update("slug", event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} aria-invalid={Boolean(errors.slug)} aria-describedby={errors.slug ? "scheduling-slug-error" : "scheduling-slug-hint"} /></div>
                {errors.slug ? <small id="scheduling-slug-error" role="alert">{errors.slug}</small> : <small id="scheduling-slug-hint">{copy("Use um endereço curto e fácil de compartilhar.", "Use a short, easy-to-share address.")}</small>}
              </label>
            </div>
          </section>

          <section id="scheduling-rules-section" className="scheduling-editor-section" aria-labelledby="scheduling-rules-title" tabIndex={-1}>
            <header>
              <div>
                <h2 id="scheduling-rules-title">{copy("Reunião", "Meeting")}</h2>
                <p>{copy("Configure duração, antecedência e intervalos entre compromissos.", "Set duration, notice, and buffers between appointments.")}</p>
              </div>
            </header>
            <div className="scheduling-field-grid scheduling-field-grid-compact">
              <label className="scheduling-field"><span>{copy("Duração", "Duration")}</span><select value={draft.durationMinutes} onChange={(event) => update("durationMinutes", Number(event.target.value))}>{[15, 30, 45, 60, 90].map((value) => <option key={value} value={value}>{copy("{value} minutos", "{value} minutes", { value })}</option>)}</select></label>
              <label className="scheduling-field"><span>{copy("Intervalo entre opções", "Time between slots")}</span><select value={draft.slotIntervalMinutes} onChange={(event) => update("slotIntervalMinutes", Number(event.target.value))}>{[15, 30, 45, 60].map((value) => <option key={value} value={value}>{copy("{value} minutos", "{value} minutes", { value })}</option>)}</select></label>
              <label className="scheduling-field"><span>{copy("Antecedência mínima", "Minimum notice")}</span><select value={draft.minimumNoticeMinutes} onChange={(event) => update("minimumNoticeMinutes", Number(event.target.value))}><option value={0}>{copy("Sem antecedência", "No notice")}</option><option value={60}>{copy("1 hora", "1 hour")}</option><option value={120}>{copy("2 horas", "2 hours")}</option><option value={720}>{copy("12 horas", "12 hours")}</option><option value={1440}>{copy("1 dia", "1 day")}</option><option value={2880}>{copy("2 dias", "2 days")}</option></select></label>
              <label className="scheduling-field"><span>{copy("Agenda aberta por", "Booking window")}</span><select value={draft.maximumAdvanceDays} onChange={(event) => update("maximumAdvanceDays", Number(event.target.value))}>{[7, 14, 30, 60, 90].map((value) => <option key={value} value={value}>{copy("{value} dias", "{value} days", { value })}</option>)}</select></label>
              <label className="scheduling-field"><span>{copy("Preparo antes", "Buffer before")}</span><select value={draft.bufferBeforeMinutes} onChange={(event) => update("bufferBeforeMinutes", Number(event.target.value))}>{[0, 5, 10, 15, 30].map((value) => <option key={value} value={value}>{value === 0 ? copy("Sem intervalo", "No buffer") : copy("{value} minutos", "{value} minutes", { value })}</option>)}</select></label>
              <label className="scheduling-field"><span>{copy("Intervalo depois", "Buffer after")}</span><select value={draft.bufferAfterMinutes} onChange={(event) => update("bufferAfterMinutes", Number(event.target.value))}>{[0, 5, 10, 15, 30].map((value) => <option key={value} value={value}>{value === 0 ? copy("Sem intervalo", "No buffer") : copy("{value} minutos", "{value} minutes", { value })}</option>)}</select></label>
            </div>
          </section>

          <section id="scheduling-hours-section" className="scheduling-editor-section" aria-labelledby="scheduling-hours-title" tabIndex={-1}>
            <header>
              <div>
                <h2 id="scheduling-hours-title">{copy("Disponibilidade", "Availability")}</h2>
                <p>{copy("Defina quando você atende. Os horários usam o fuso {timeZone}.", "Set when you are available. Times use the {timeZone} time zone.", { timeZone: ownerTimeZone })}</p>
              </div>
            </header>
            {errors.weeklyWindows ? <p className="scheduling-section-error" role="alert">{errors.weeklyWindows}</p> : null}
            <div className="scheduling-week-list">
              {DAYS.map((day) => {
                const dayWindows = windowsByDay.get(day.value) ?? [];
                return (
                  <div className="scheduling-day-row" key={day.value}>
                    <div className="scheduling-day-name"><strong>{copy(day.shortPt, day.shortEn)}</strong><span>{copy(day.pt, day.en)}</span></div>
                    <div className="scheduling-day-windows">
                      {dayWindows.length ? dayWindows.map((window, index) => (
                        <div className="scheduling-window-row" key={window.clientId}>
                          <label><span className="sr-only">{copy("Início de {day}, período {period}", "Start of {day}, period {period}", { day: copy(day.pt, day.en), period: index + 1 })}</span><input type="time" step={300} value={minutesToTime(window.startMinute)} onChange={(event) => updateWindow(window.clientId, "startMinute", event.target.value)} /></label>
                          <span aria-hidden="true">{copy("até", "to")}</span>
                          <label><span className="sr-only">{copy("Fim de {day}, período {period}", "End of {day}, period {period}", { day: copy(day.pt, day.en), period: index + 1 })}</span><input type="time" step={300} value={minutesToTime(window.endMinute)} onChange={(event) => updateWindow(window.clientId, "endMinute", event.target.value)} /></label>
                          <button type="button" onClick={() => removeWindow(window.clientId)} aria-label={copy("Remover período de {day}", "Remove period from {day}", { day: copy(day.pt, day.en) })}>×</button>
                        </div>
                      )) : <span className="scheduling-unavailable-day">{copy("Indisponível", "Unavailable")}</span>}
                    </div>
                    <button type="button" className="scheduling-add-window" onClick={() => addWindow(day.value)} aria-label={copy("Adicionar período em {day}", "Add a period on {day}", { day: copy(day.pt, day.en) })}>{copy("Adicionar", "Add")}</button>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <aside id="scheduling-publication-section" className="scheduling-settings-side" aria-labelledby="scheduling-publication-title" tabIndex={-1}>
          <header className="scheduling-publication-header">
            <div>
              <h2 id="scheduling-publication-title">{copy("Publicação", "Publication")}</h2>
              <p>{copy("Revise a conexão e compartilhe quando estiver pronto.", "Review the connection and share when you are ready.")}</p>
            </div>
            <label className="scheduling-publish-toggle">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => update("enabled", event.target.checked)}
                disabled={!readiness.canEnable && !draft.enabled}
              />
              <span aria-hidden="true" />
              {draft.enabled ? copy("Publicado", "Published") : copy("Rascunho", "Draft")}
            </label>
          </header>
          <section className="scheduling-readiness" aria-labelledby="scheduling-readiness-title">
            <div><h3 id="scheduling-readiness-title">{copy("Pronto para publicar", "Ready to publish")}</h3></div>
            <ul>
              <li data-ready={readiness.googleConnected || undefined}><span><i aria-hidden="true" />{copy("Google conectado", "Google connected")}</span><strong>{readiness.googleConnected ? copy("Concluído", "Complete") : copy("Pendente", "Pending")}</strong></li>
              <li data-ready={readiness.freeBusyGranted || undefined}><span><i aria-hidden="true" />{copy("Permissão de disponibilidade", "Availability permission")}</span><strong>{readiness.freeBusyGranted ? copy("Concluído", "Complete") : copy("Pendente", "Pending")}</strong></li>
              <li data-ready={readiness.writableDefaultCalendar || undefined}><span><i aria-hidden="true" />{copy("Calendário padrão gravável", "Writable default calendar")}</span><strong>{readiness.writableDefaultCalendar ? copy("Concluído", "Complete") : copy("Pendente", "Pending")}</strong></li>
              <li data-ready={readiness.confirmationEmailReady || undefined}><span><i aria-hidden="true" />{copy("Confirmação por e-mail", "Email confirmation")}</span><strong>{readiness.confirmationEmailReady ? copy("Concluído", "Complete") : copy("Pendente", "Pending")}</strong></li>
            </ul>
            {!readiness.canEnable ? <>
              <p>{
                readiness.googleConnected && readiness.freeBusyGranted && readiness.writableDefaultCalendar && !readiness.confirmationEmailReady
                  ? copy("O envio de confirmação ainda não está disponível neste ambiente. Solicite a configuração do Resend à administração.", "Confirmation emails are not available in this environment yet. Ask an administrator to configure Resend.")
                  : copy("Conclua as pendências do Google Agenda e do envio de e-mail antes de publicar o link.", "Resolve the Google Calendar and email setup items before publishing the link.")
              }</p>
              {!readiness.googleConnected || !readiness.freeBusyGranted || !readiness.writableDefaultCalendar
                ? <a className="scheduling-readiness-link" href="/agent/integrations/google-calendar">{copy("Revisar conexão Google", "Review Google connection")}</a>
                : null}
            </> : <p>{copy("Sua agenda pode receber reservas.", "Your calendar can accept bookings.")}</p>}
          </section>
          <section className="scheduling-link-preview" aria-labelledby="scheduling-link-title">
            <div><h3 id="scheduling-link-title">{copy("Link do cliente", "Client link")}</h3></div>
            <output>{previewPath}</output>
            {draft.slug !== persistedLink?.slug || draft.enabled !== persistedLink?.enabled ? <p>{copy("Salve as alterações para atualizar o link compartilhável.", "Save your changes to update the shareable link.")}</p> : null}
            <div>
              <button type="button" onClick={copyLink} disabled={!canShare}>{copy("Copiar link publicado", "Copy published link")}</button>
              {canShare && persistedPath ? <a href={persistedPath} target="_blank" rel="noreferrer">{copy("Abrir", "Open")}</a> : null}
            </div>
          </section>
        </aside>
      </form>
    </div>
  );
}
