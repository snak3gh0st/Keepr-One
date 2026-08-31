"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useEffect, useMemo, useRef, useState } from "react";

gsap.registerPlugin(useGSAP);

const DAYS = [
  { value: 0, label: "Domingo", short: "Dom" },
  { value: 1, label: "Segunda-feira", short: "Seg" },
  { value: 2, label: "Terça-feira", short: "Ter" },
  { value: 3, label: "Quarta-feira", short: "Qua" },
  { value: 4, label: "Quinta-feira", short: "Qui" },
  { value: 5, label: "Sexta-feira", short: "Sex" },
  { value: 6, label: "Sábado", short: "Sáb" },
] as const;

const EDITOR_SECTIONS = [
  { id: "public", targetId: "scheduling-public-section", label: "Página pública", shortLabel: "Página" },
  { id: "meeting", targetId: "scheduling-rules-section", label: "Reunião", shortLabel: "Reunião" },
  { id: "availability", targetId: "scheduling-hours-section", label: "Disponibilidade", shortLabel: "Horários" },
  { id: "publication", targetId: "scheduling-publication-section", label: "Publicação", shortLabel: "Publicar" },
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

function defaultDraft(): Draft {
  return {
    slug: "",
    enabled: false,
    title: "Reunião de 30 minutos",
    description: "Escolha o melhor horário para conversarmos.",
    durationMinutes: 30,
    slotIntervalMinutes: 30,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 10,
    minimumNoticeMinutes: 120,
    maximumAdvanceDays: 30,
    weeklyWindows: defaultWindows(),
  };
}

function draftFromPage(page: SchedulingPageRecord | null): Draft {
  if (!page) return defaultDraft();
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

export function validateSchedulingDraft(draft: Draft) {
  const errors: Record<string, string> = {};
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug) || draft.slug.length < 3 || draft.slug.length > 64) {
    errors.slug = "Use de 3 a 64 caracteres minúsculos, números e hífens.";
  }
  if (draft.title.trim().length < 1 || draft.title.trim().length > 120) {
    errors.title = "Informe um título de até 120 caracteres.";
  }
  if (draft.description.length > 1000) errors.description = "Use no máximo 1.000 caracteres.";
  if (draft.enabled && draft.weeklyWindows.length === 0) {
    errors.weeklyWindows = "Adicione pelo menos um período disponível antes de publicar.";
  }
  for (const day of DAYS) {
    const windows = draft.weeklyWindows
      .filter((window) => window.weekday === day.value)
      .sort((a, b) => a.startMinute - b.startMinute);
    for (let index = 0; index < windows.length; index += 1) {
      const window = windows[index];
      if (window.startMinute >= window.endMinute) {
        errors.weeklyWindows = `Revise o horário de ${day.label.toLowerCase()}.`;
        break;
      }
      if (index > 0 && windows[index - 1].endMinute > window.startMinute) {
        errors.weeklyWindows = `Existem períodos sobrepostos em ${day.label.toLowerCase()}.`;
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
  const formRef = useRef<HTMLFormElement>(null);
  const navIndicatorRef = useRef<HTMLSpanElement>(null);
  const manualNavigationRef = useRef(false);
  const manualNavigationTimeoutRef = useRef<number | null>(null);
  const [draft, setDraft] = useState<Draft>(() => defaultDraft());
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
        if (!response.ok) throw new Error(await responseMessage(response, "Não foi possível carregar o agendamento."));
        const data = (await response.json()) as SchedulingPageResponse;
        const nextDraft = draftFromPage(data.page);
        setDraft(nextDraft);
        setSavedSignature(data.page ? draftSignature(nextDraft) : null);
        setPersistedLink(data.page ? { slug: data.page.slug, enabled: data.page.enabled } : null);
        setReadiness(data.readiness);
        setOwnerTimeZone(data.ownerTimeZone);
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadFailed(true);
        setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Não foi possível carregar o agendamento." });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [reloadKey]);

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
      setFeedback({ kind: "success", message: "Link copiado." });
    } catch {
      setFeedback({ kind: "error", message: "Não foi possível copiar. Selecione o endereço manualmente." });
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateSchedulingDraft(draft);
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      setFeedback({ kind: "error", message: "Revise os campos indicados." });
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
      if (!response.ok) throw new Error(await responseMessage(response, "Não foi possível salvar agora."));
      const data = (await response.json()) as SchedulingPageResponse;
      const nextDraft = draftFromPage(data.page);
      setDraft(nextDraft);
      setSavedSignature(data.page ? draftSignature(nextDraft) : null);
      setPersistedLink(data.page ? { slug: data.page.slug, enabled: data.page.enabled } : null);
      setReadiness(data.readiness);
      setOwnerTimeZone(data.ownerTimeZone);
      setErrors({});
      setFeedback({ kind: "success", message: data.page?.enabled ? "Link publicado e atualizado." : "Configurações salvas." });
    } catch (error) {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Não foi possível salvar agora." });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="scheduling-settings-loading" role="status"><span />Carregando configurações…</div>;
  }

  if (loadFailed) {
    return (
      <div className="scheduling-settings-load-error" role="alert">
        <strong>Não foi possível abrir esta configuração.</strong>
        <p>{feedback?.message ?? "Não foi possível carregar o agendamento."}</p>
        <button type="button" onClick={() => setReloadKey((value) => value + 1)}>Tentar novamente</button>
      </div>
    );
  }

  return (
    <div className="scheduling-settings-shell">
      <form ref={formRef} onSubmit={save} noValidate>
        <div className="scheduling-workspace-toolbar">
          <nav className="scheduling-section-nav" aria-label="Seções da configuração">
            <div className="scheduling-section-nav-track">
              {EDITOR_SECTIONS.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  aria-label={section.label}
                  aria-controls={section.targetId}
                  aria-current={activeSection === section.id ? "step" : undefined}
                  onClick={() => goToSection(section.id)}
                >
                  <span className="scheduling-section-nav-label-long" aria-hidden="true">{section.label}</span>
                  <span className="scheduling-section-nav-label-short" aria-hidden="true">{section.shortLabel}</span>
                </button>
              ))}
              <span ref={navIndicatorRef} className="scheduling-section-nav-indicator" aria-hidden="true" />
            </div>
          </nav>
          <div className="scheduling-toolbar-actions">
            <div aria-live="polite">
              {feedback
                ? <p data-kind={feedback.kind}>{feedback.message}</p>
                : <p>{isDirty ? "Alterações não salvas." : "Tudo salvo."}</p>}
            </div>
            <button type="submit" disabled={saving || !isDirty}>
              {saving ? "Salvando…" : isDirty ? draft.enabled ? "Salvar e publicar" : "Salvar rascunho" : "Salvo"}
            </button>
          </div>
        </div>

        <div className="scheduling-settings-main">
          <section id="scheduling-public-section" className="scheduling-editor-section" aria-labelledby="scheduling-public-title" tabIndex={-1}>
            <header>
              <div>
                <h2 id="scheduling-public-title">Página pública</h2>
                <p>Defina o conteúdo e o endereço que seu cliente verá.</p>
              </div>
            </header>
            <div className="scheduling-field-grid">
              <label className="scheduling-field scheduling-field-wide">
                <span>Título</span>
                <input value={draft.title} maxLength={120} onChange={(event) => update("title", event.target.value)} aria-invalid={Boolean(errors.title)} aria-describedby={errors.title ? "scheduling-title-error" : undefined} />
                {errors.title ? <small id="scheduling-title-error" role="alert">{errors.title}</small> : null}
              </label>
              <label className="scheduling-field scheduling-field-wide">
                <span>Descrição</span>
                <textarea value={draft.description} maxLength={1000} rows={3} onChange={(event) => update("description", event.target.value)} aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? "scheduling-description-error" : undefined} />
                {errors.description ? <small id="scheduling-description-error" role="alert">{errors.description}</small> : <small>{draft.description.length}/1.000</small>}
              </label>
              <label className="scheduling-field scheduling-field-wide">
                <span>Endereço do link</span>
                <div className="scheduling-slug-input"><i aria-hidden="true">/agendar/</i><input aria-label="Endereço do link" value={draft.slug} minLength={3} maxLength={64} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(event) => update("slug", event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} aria-invalid={Boolean(errors.slug)} aria-describedby={errors.slug ? "scheduling-slug-error" : "scheduling-slug-hint"} /></div>
                {errors.slug ? <small id="scheduling-slug-error" role="alert">{errors.slug}</small> : <small id="scheduling-slug-hint">Use um endereço curto e fácil de compartilhar.</small>}
              </label>
            </div>
          </section>

          <section id="scheduling-rules-section" className="scheduling-editor-section" aria-labelledby="scheduling-rules-title" tabIndex={-1}>
            <header>
              <div>
                <h2 id="scheduling-rules-title">Reunião</h2>
                <p>Configure duração, antecedência e intervalos entre compromissos.</p>
              </div>
            </header>
            <div className="scheduling-field-grid scheduling-field-grid-compact">
              <label className="scheduling-field"><span>Duração</span><select value={draft.durationMinutes} onChange={(event) => update("durationMinutes", Number(event.target.value))}>{[15, 30, 45, 60, 90].map((value) => <option key={value} value={value}>{value} minutos</option>)}</select></label>
              <label className="scheduling-field"><span>Intervalo entre opções</span><select value={draft.slotIntervalMinutes} onChange={(event) => update("slotIntervalMinutes", Number(event.target.value))}>{[15, 30, 45, 60].map((value) => <option key={value} value={value}>{value} minutos</option>)}</select></label>
              <label className="scheduling-field"><span>Antecedência mínima</span><select value={draft.minimumNoticeMinutes} onChange={(event) => update("minimumNoticeMinutes", Number(event.target.value))}><option value={0}>Sem antecedência</option><option value={60}>1 hora</option><option value={120}>2 horas</option><option value={720}>12 horas</option><option value={1440}>1 dia</option><option value={2880}>2 dias</option></select></label>
              <label className="scheduling-field"><span>Agenda aberta por</span><select value={draft.maximumAdvanceDays} onChange={(event) => update("maximumAdvanceDays", Number(event.target.value))}>{[7, 14, 30, 60, 90].map((value) => <option key={value} value={value}>{value} dias</option>)}</select></label>
              <label className="scheduling-field"><span>Preparo antes</span><select value={draft.bufferBeforeMinutes} onChange={(event) => update("bufferBeforeMinutes", Number(event.target.value))}>{[0, 5, 10, 15, 30].map((value) => <option key={value} value={value}>{value === 0 ? "Sem intervalo" : `${value} minutos`}</option>)}</select></label>
              <label className="scheduling-field"><span>Intervalo depois</span><select value={draft.bufferAfterMinutes} onChange={(event) => update("bufferAfterMinutes", Number(event.target.value))}>{[0, 5, 10, 15, 30].map((value) => <option key={value} value={value}>{value === 0 ? "Sem intervalo" : `${value} minutos`}</option>)}</select></label>
            </div>
          </section>

          <section id="scheduling-hours-section" className="scheduling-editor-section" aria-labelledby="scheduling-hours-title" tabIndex={-1}>
            <header>
              <div>
                <h2 id="scheduling-hours-title">Disponibilidade</h2>
                <p>Defina quando você atende. Os horários usam o fuso {ownerTimeZone}.</p>
              </div>
            </header>
            {errors.weeklyWindows ? <p className="scheduling-section-error" role="alert">{errors.weeklyWindows}</p> : null}
            <div className="scheduling-week-list">
              {DAYS.map((day) => {
                const dayWindows = windowsByDay.get(day.value) ?? [];
                return (
                  <div className="scheduling-day-row" key={day.value}>
                    <div className="scheduling-day-name"><strong>{day.short}</strong><span>{day.label}</span></div>
                    <div className="scheduling-day-windows">
                      {dayWindows.length ? dayWindows.map((window, index) => (
                        <div className="scheduling-window-row" key={window.clientId}>
                          <label><span className="sr-only">Início de {day.label}, período {index + 1}</span><input type="time" step={300} value={minutesToTime(window.startMinute)} onChange={(event) => updateWindow(window.clientId, "startMinute", event.target.value)} /></label>
                          <span aria-hidden="true">até</span>
                          <label><span className="sr-only">Fim de {day.label}, período {index + 1}</span><input type="time" step={300} value={minutesToTime(window.endMinute)} onChange={(event) => updateWindow(window.clientId, "endMinute", event.target.value)} /></label>
                          <button type="button" onClick={() => removeWindow(window.clientId)} aria-label={`Remover período de ${day.label}`}>×</button>
                        </div>
                      )) : <span className="scheduling-unavailable-day">Indisponível</span>}
                    </div>
                    <button type="button" className="scheduling-add-window" onClick={() => addWindow(day.value)} aria-label={`Adicionar período em ${day.label}`}>Adicionar</button>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <aside id="scheduling-publication-section" className="scheduling-settings-side" aria-labelledby="scheduling-publication-title" tabIndex={-1}>
          <header className="scheduling-publication-header">
            <div>
              <h2 id="scheduling-publication-title">Publicação</h2>
              <p>Revise a conexão e compartilhe quando estiver pronto.</p>
            </div>
            <label className="scheduling-publish-toggle">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => update("enabled", event.target.checked)}
                disabled={!readiness.canEnable && !draft.enabled}
              />
              <span aria-hidden="true" />
              {draft.enabled ? "Publicado" : "Rascunho"}
            </label>
          </header>
          <section className="scheduling-readiness" aria-labelledby="scheduling-readiness-title">
            <div><h3 id="scheduling-readiness-title">Pronto para publicar</h3></div>
            <ul>
              <li data-ready={readiness.googleConnected || undefined}><span><i aria-hidden="true" />Google conectado</span><strong>{readiness.googleConnected ? "Concluído" : "Pendente"}</strong></li>
              <li data-ready={readiness.freeBusyGranted || undefined}><span><i aria-hidden="true" />Permissão de disponibilidade</span><strong>{readiness.freeBusyGranted ? "Concluído" : "Pendente"}</strong></li>
              <li data-ready={readiness.writableDefaultCalendar || undefined}><span><i aria-hidden="true" />Calendário padrão gravável</span><strong>{readiness.writableDefaultCalendar ? "Concluído" : "Pendente"}</strong></li>
              <li data-ready={readiness.confirmationEmailReady || undefined}><span><i aria-hidden="true" />Confirmação por e-mail</span><strong>{readiness.confirmationEmailReady ? "Concluído" : "Pendente"}</strong></li>
            </ul>
            {!readiness.canEnable ? <>
              <p>{
                readiness.googleConnected && readiness.freeBusyGranted && readiness.writableDefaultCalendar && !readiness.confirmationEmailReady
                  ? "O envio de confirmação ainda não está disponível neste ambiente. Solicite a configuração do Resend à administração."
                  : "Conclua as pendências do Google Agenda e do envio de e-mail antes de publicar o link."
              }</p>
              {!readiness.googleConnected || !readiness.freeBusyGranted || !readiness.writableDefaultCalendar
                ? <a className="scheduling-readiness-link" href="/agent/integrations/google-calendar">Revisar conexão Google</a>
                : null}
            </> : <p>Sua agenda pode receber reservas.</p>}
          </section>
          <section className="scheduling-link-preview" aria-labelledby="scheduling-link-title">
            <div><h3 id="scheduling-link-title">Link do cliente</h3></div>
            <output>{previewPath}</output>
            {draft.slug !== persistedLink?.slug || draft.enabled !== persistedLink?.enabled ? <p>Salve as alterações para atualizar o link compartilhável.</p> : null}
            <div>
              <button type="button" onClick={copyLink} disabled={!canShare}>Copiar link publicado</button>
              {canShare && persistedPath ? <a href={persistedPath} target="_blank" rel="noreferrer">Abrir</a> : null}
            </div>
          </section>
        </aside>
      </form>
    </div>
  );
}
