"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import {
  reviewKBotApplicationDocument,
  reviewKBotApplicationDossier,
  prepareKBotApplicationDraft,
  saveKBotApplicationDossier,
  uploadKBotApplicationDocument,
} from "./actions";

type ApplicationView = {
  id: string;
  automationState: string;
  dossier: unknown;
  dossierHash: string | null;
  reviewedAt: string | null;
  externalId: string | null;
  carrierReceipt: unknown;
  documents: Array<{ id: string; type: string; filename: string; reviewedAt: string | null }>;
};

type ProspectDefaults = {
  name: string;
  email: string | null;
  phone: string | null;
  state: string | null;
  dateOfBirth: string | null;
};

type IllustrationOption = {
  id: string;
  kind: string;
  productName: string | null;
};

const TERM_PRODUCTS = [
  "LSW 10-G", "LSW 15-G", "LSW 20-G", "LSW 30-G", "LSW ART",
  "NL 10-G", "NL 15-G", "NL 20-G", "NL 30-G", "NL ART",
] as const;

const IUL_PRODUCTS = [
  "2019 PeakLife NL",
  "FlexLife (25)(LSW)",
  "RapidProtect (LSW)",
  "RapidProtect NL",
  "SummitLife (LSW)",
] as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: FormDataEntryValue | null): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

const STATE_COPY: Record<string, string> = {
  COLLECTING: "Reunindo informações",
  READY_FOR_REVIEW: "Pronto para sua revisão",
  READY_TO_PREPARE: "Autorizado para preparar no iGO",
  PREPARING_DRAFT: "K-Bot está preparando o rascunho",
  NEEDS_INFORMATION: "Falta uma resposta do cliente",
  DRAFT_READY: "Rascunho da National Life pronto",
  READY_TO_SUBMIT: "Pronto para confirmação final",
  SUBMITTING: "Enviando à National Life",
  SUBMITTED: "Enviado à National Life",
  FAILED: "Precisa de atenção",
};

const fieldClass = "min-h-11 w-full rounded-xl border border-border-steel bg-white px-3 text-sm text-ink outline-none transition focus:border-emerald-700";
const labelClass = "space-y-1 text-xs font-semibold text-ink-muted";

export function ApplicationDossier({
  application,
  addon,
  prospect,
  illustrations,
}: {
  application: ApplicationView;
  addon: { entitled: boolean; status: string | null; canAutomate: boolean };
  prospect: ProspectDefaults;
  illustrations: IllustrationOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const dossier = record(application.dossier);
  const insured = record(dossier.insured);
  const address = record(dossier.address);
  const owner = record(dossier.owner);
  const coverage = record(dossier.coverage);
  const existing = record(dossier.existingCoverage);
  const consent = record(dossier.consent);
  const carrierReceipt = record(application.carrierReceipt);
  const confirmedValues = record(carrierReceipt.confirmedValues);
  const carrierProgress = text(carrierReceipt.progress);
  const carrierChanges = Array.isArray(carrierReceipt.changes)
    ? carrierReceipt.changes.map(record).filter((change) => text(change.field))
    : [];
  const carrierQuestions = Array.isArray(carrierReceipt.missingQuestions)
    ? carrierReceipt.missingQuestions.map(record).filter((question) => text(question.label))
    : [];
  const beneficiary = Array.isArray(dossier.beneficiaries)
    ? record(dossier.beneficiaries[0])
    : {};
  const [fallbackFirstName, ...fallbackLastName] = prospect.name.trim().split(/\s+/);
  const [productFamily, setProductFamily] = useState(text(coverage.family, text(coverage.product)));

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const family = String(form.get("family") ?? "");
    const termDuration = String(form.get("termDuration") ?? "");
    setMessage(null);
    const payload = {
      version: 2,
      insured: {
        firstName: String(form.get("firstName") ?? "").trim(),
        lastName: String(form.get("lastName") ?? "").trim(),
        ...(form.get("birthDate") ? { birthDate: String(form.get("birthDate")) } : {}),
        ...(form.get("sexAtBirth") ? { sexAtBirth: String(form.get("sexAtBirth")) } : {}),
        ...(form.get("email") ? { email: String(form.get("email")).trim() } : {}),
        ...(form.get("phone") ? { phone: String(form.get("phone")).trim() } : {}),
      },
      address: {
        ...(form.get("line1") ? { line1: String(form.get("line1")).trim() } : {}),
        ...(form.get("line2") ? { line2: String(form.get("line2")).trim() } : {}),
        ...(form.get("city") ? { city: String(form.get("city")).trim() } : {}),
        ...(form.get("state") ? { state: String(form.get("state")).trim().toUpperCase() } : {}),
        ...(form.get("postalCode") ? { postalCode: String(form.get("postalCode")).trim() } : {}),
      },
      owner: {
        sameAsInsured: form.get("sameAsInsured") === "on",
        relationship: String(form.get("ownerRelationship") ?? "SELF"),
        ...(form.get("ownerFullName") ? { fullName: String(form.get("ownerFullName")).trim() } : {}),
      },
      beneficiaries: form.get("beneficiaryName") ? [{
        fullName: String(form.get("beneficiaryName")).trim(),
        relationship: String(form.get("beneficiaryRelationship") ?? "").trim(),
        sharePercent: numberValue(form.get("beneficiaryShare")) ?? 0,
      }] : [],
      coverage: {
        ...(family ? { family } : {}),
        ...(form.get("carrierProduct") ? { carrierProduct: String(form.get("carrierProduct")) } : {}),
        ...(family === "TERM" && termDuration ? { termDuration } : {}),
        ...(form.get("issueState") ? { issueState: String(form.get("issueState")).trim().toUpperCase() } : {}),
        ...(form.get("applicationType") ? { applicationType: String(form.get("applicationType")) } : {}),
        ...(form.get("illustrationId") ? { illustrationId: String(form.get("illustrationId")) } : {}),
        ...(numberValue(form.get("faceAmount")) ? { faceAmount: numberValue(form.get("faceAmount")) } : {}),
        ...(form.get("premiumMode") ? { premiumMode: String(form.get("premiumMode")) } : {}),
        ...(numberValue(form.get("plannedPremium")) ? { plannedPremium: numberValue(form.get("plannedPremium")) } : {}),
      },
      agent: {
        ...(form.get("carrierNumber") ? { carrierNumber: String(form.get("carrierNumber")).trim() } : {}),
      },
      existingCoverage: {
        hasExisting: form.get("hasExisting") === "on",
        replacementExpected: form.get("replacementExpected") === "on",
      },
      consent: {
        clientAuthorizedCollection: form.get("clientAuthorizedCollection") === "on",
        agentAttestedAccuracy: form.get("agentAttestedAccuracy") === "on",
      },
    };
    startTransition(async () => {
      const result = await saveKBotApplicationDossier(application.id, payload);
      if (!result.ok) setMessage(result.message);
      else {
        setMessage(result.ready
          ? "Informações completas. Revise e autorize o K-Bot quando estiver pronto."
          : `Salvei o rascunho. Ainda faltam ${result.missing.length} pontos.`);
        router.refresh();
      }
    });
  }

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.set("applicationId", application.id);
    setMessage(null);
    startTransition(async () => {
      const result = await uploadKBotApplicationDocument(form);
      if (!result.ok) setMessage(result.message);
      else {
        setMessage("Documento salvo. Revise-o antes de autorizar o K-Bot.");
        router.refresh();
      }
    });
  }

  function reviewDossier() {
    setMessage(null);
    startTransition(async () => {
      const result = await reviewKBotApplicationDossier(application.id);
      if (!result.ok) setMessage(result.message);
      else {
        setMessage("Revisão concluída. Este conjunto de informações ficou protegido contra alterações silenciosas.");
        router.refresh();
      }
    });
  }

  function prepareDraft() {
    setMessage(null);
    startTransition(async () => {
      const result = await prepareKBotApplicationDraft(application.id);
      if (!result.ok) setMessage(result.message);
      else {
        setMessage("K-Bot começou a preparar o rascunho no iGO. Você pode continuar trabalhando.");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-5 rounded-2xl border border-border-steel bg-white/70 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-800">K-Bot Application</p>
          <h3 className="mt-1 text-base font-semibold text-ink">{STATE_COPY[application.automationState] ?? "Preparação do caso"}</h3>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">O KeeprOne reúne e revisa os dados primeiro. O K-Bot só entra no iGO depois da sua autorização.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${addon.entitled ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>
          {addon.entitled ? "Add-on ativo" : "Add-on não ativo"}
        </span>
      </div>

      {!addon.entitled ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <div>
            <p>Você pode organizar o dossiê agora. Para o K-Bot preparar e enviar no iGO, ative o add-on Application.</p>
            <p className="mt-1 text-xs text-amber-800">US$ 12,99/mês por agente · primeiros 14 dias grátis.</p>
          </div>
          <form action="/api/billing/application-addon/checkout" method="post">
            <Button type="submit" variant="secondary">Ativar Application</Button>
          </form>
        </div>
      ) : null}

      {application.externalId && Object.keys(confirmedValues).length ? (
        <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-900">Lido de volta do iGO</p>
              <p className="mt-1 text-sm text-emerald-950">Rascunho {application.externalId} · {text(carrierReceipt.carrierStatus, "Recebido")}</p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-emerald-900">
              {carrierProgress === "DRAFT_READY"
                ? (text(confirmedValues.premiumMode) === "MONTHLY" ? "Mensal" : "Anual")
                : "Rascunho parcial"}
            </span>
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-xs text-emerald-800">Cliente</dt><dd className="font-semibold text-emerald-950">{text(confirmedValues.insuredName)}</dd></div>
            <div><dt className="text-xs text-emerald-800">Produto</dt><dd className="font-semibold text-emerald-950">{text(confirmedValues.carrierProduct, text(confirmedValues.family))}{text(confirmedValues.termDuration) ? ` · ${text(confirmedValues.termDuration)}` : ""}</dd></div>
            <div><dt className="text-xs text-emerald-800">Capital confirmado</dt><dd className="font-semibold text-emerald-950">{typeof confirmedValues.faceAmount === "number" ? `US$ ${confirmedValues.faceAmount.toLocaleString("en-US")}` : "Ainda não preenchido no iGO"}</dd></div>
            <div><dt className="text-xs text-emerald-800">Prêmio confirmado</dt><dd className="font-semibold text-emerald-950">{typeof confirmedValues.plannedPremium === "number" ? `US$ ${confirmedValues.plannedPremium.toLocaleString("en-US")}` : "Ainda não preenchido no iGO"}</dd></div>
          </dl>
          {carrierChanges.length ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-950">A National Life ajustou {carrierChanges.length} informação(ões)</p>
              <ul className="mt-2 space-y-1 text-xs text-amber-900">
                {carrierChanges.map((change, index) => (
                  <li key={`${text(change.field)}-${index}`}>{text(change.field)}: {text(change.requested, "—")} → {text(change.carrier, "—")}</li>
                ))}
              </ul>
            </div>
          ) : <p className="text-xs text-emerald-800">Os valores conferem com o dossiê enviado.</p>}
        </div>
      ) : null}

      {carrierQuestions.length ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-950">O iGO precisa de mais {carrierQuestions.length} resposta(s)</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
            {carrierQuestions.map((question, index) => (
              <li key={`${text(question.label)}-${index}`}>{text(question.label)} <span className="text-amber-700">· {text(question.section)}</span></li>
            ))}
          </ul>
        </div>
      ) : null}

      <form onSubmit={save} className="space-y-5">
        <fieldset disabled={pending} className="space-y-4">
          <legend className="text-sm font-semibold text-ink">1. Cliente e contato</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className={labelClass}>Nome<input name="firstName" className={fieldClass} defaultValue={text(insured.firstName, fallbackFirstName)} /></label>
            <label className={labelClass}>Sobrenome<input name="lastName" className={fieldClass} defaultValue={text(insured.lastName, fallbackLastName.join(" "))} /></label>
            <label className={labelClass}>Nascimento<input name="birthDate" type="date" className={fieldClass} defaultValue={text(insured.birthDate, prospect.dateOfBirth?.slice(0, 10) ?? "")} /></label>
            <label className={labelClass}>Sexo conforme a seguradora<select name="sexAtBirth" className={fieldClass} defaultValue={text(insured.sexAtBirth)}><option value="">Selecione</option><option value="MALE">Masculino</option><option value="FEMALE">Feminino</option></select></label>
            <label className={labelClass}>E-mail<input name="email" type="email" className={fieldClass} defaultValue={text(insured.email, prospect.email ?? "")} /></label>
            <label className={labelClass}>Telefone internacional<input name="phone" placeholder="+13055550123" className={fieldClass} defaultValue={text(insured.phone, prospect.phone ?? "")} /></label>
          </div>
        </fieldset>

        <fieldset disabled={pending} className="space-y-4">
          <legend className="text-sm font-semibold text-ink">2. Endereço e titularidade</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className={labelClass}>Endereço<input name="line1" className={fieldClass} defaultValue={text(address.line1)} /></label>
            <label className={labelClass}>Complemento<input name="line2" className={fieldClass} defaultValue={text(address.line2)} /></label>
            <label className={labelClass}>Cidade<input name="city" className={fieldClass} defaultValue={text(address.city)} /></label>
            <label className={labelClass}>Estado<input name="state" maxLength={2} className={fieldClass} defaultValue={text(address.state, prospect.state ?? "")} /></label>
            <label className={labelClass}>ZIP code<input name="postalCode" className={fieldClass} defaultValue={text(address.postalCode)} /></label>
            <label className={labelClass}>Relação do titular<select name="ownerRelationship" className={fieldClass} defaultValue={text(owner.relationship, "SELF")}><option value="SELF">O próprio segurado</option><option value="SPOUSE">Cônjuge</option><option value="PARENT">Pai ou mãe</option><option value="BUSINESS">Empresa</option><option value="OTHER">Outro</option></select></label>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink"><input name="sameAsInsured" type="checkbox" defaultChecked={owner.sameAsInsured !== false} /> Titular é o próprio segurado</label>
          <label className={labelClass}>Nome do titular, se diferente<input name="ownerFullName" className={fieldClass} defaultValue={text(owner.fullName)} /></label>
        </fieldset>

        <fieldset disabled={pending} className="space-y-4">
          <legend className="text-sm font-semibold text-ink">3. Beneficiário e cobertura</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className={labelClass}>Beneficiário principal<input name="beneficiaryName" className={fieldClass} defaultValue={text(beneficiary.fullName)} /></label>
            <label className={labelClass}>Relação<input name="beneficiaryRelationship" className={fieldClass} defaultValue={text(beneficiary.relationship)} /></label>
            <label className={labelClass}>Participação %<input name="beneficiaryShare" type="number" min="0.01" max="100" step="0.01" className={fieldClass} defaultValue={typeof beneficiary.sharePercent === "number" ? beneficiary.sharePercent : 100} /></label>
            <label className={labelClass}>Família do produto<select name="family" className={fieldClass} value={productFamily} onChange={(event) => setProductFamily(event.target.value)}><option value="">Selecione</option><option value="IUL">IUL</option><option value="TERM">Term</option></select></label>
            <label className={labelClass}>Produto exato no iGO<select name="carrierProduct" className={fieldClass} defaultValue={text(coverage.carrierProduct)}><option value="">Selecione</option>{(productFamily === "TERM" ? TERM_PRODUCTS : IUL_PRODUCTS).map((product) => <option key={product} value={product}>{product}</option>)}</select></label>
            {productFamily === "TERM" ? <label className={labelClass}>Prazo do Term<select name="termDuration" className={fieldClass} defaultValue={text(coverage.termDuration)}><option value="">Selecione</option><option value="10-G">10 anos</option><option value="15-G">15 anos</option><option value="20-G">20 anos</option><option value="30-G">30 anos</option><option value="ART">ART</option></select></label> : null}
            <label className={labelClass}>Estado da proposta<input name="issueState" maxLength={2} className={fieldClass} defaultValue={text(coverage.issueState, text(address.state, prospect.state ?? ""))} /></label>
            <label className={labelClass}>Tipo de Application<select name="applicationType" className={fieldClass} defaultValue={text(coverage.applicationType, "FULL")}><option value="FULL">Application completa</option><option value="TERM_CONVERSION">Conversão de Term</option></select></label>
            <label className={labelClass}>Illustration revisada<select name="illustrationId" className={fieldClass} defaultValue={text(coverage.illustrationId)}><option value="">Selecione</option>{illustrations.filter((illustration) => illustration.kind !== "PRELIMINARY").map((illustration) => <option key={illustration.id} value={illustration.id}>{illustration.productName ?? "Illustration oficial"}</option>)}</select></label>
            <label className={labelClass}>Número do agente na National Life<input name="carrierNumber" className={fieldClass} defaultValue={text(record(dossier.agent).carrierNumber)} /></label>
            <label className={labelClass}>Capital segurado<input name="faceAmount" type="number" min="1" step="0.01" className={fieldClass} defaultValue={typeof coverage.faceAmount === "number" ? coverage.faceAmount : ""} /></label>
            <label className={labelClass}>Prêmio planejado<input name="plannedPremium" type="number" min="1" step="0.01" className={fieldClass} defaultValue={typeof coverage.plannedPremium === "number" ? coverage.plannedPremium : ""} /></label>
            <label className={labelClass}>Frequência<select name="premiumMode" className={fieldClass} defaultValue={text(coverage.premiumMode, "MONTHLY")}><option value="MONTHLY">Mensal</option><option value="ANNUAL">Anual</option></select></label>
          </div>
          <div className="flex flex-wrap gap-5">
            <label className="flex items-center gap-2 text-sm text-ink"><input name="hasExisting" type="checkbox" defaultChecked={existing.hasExisting === true} /> Já possui seguro de vida</label>
            <label className="flex items-center gap-2 text-sm text-ink"><input name="replacementExpected" type="checkbox" defaultChecked={existing.replacementExpected === true} /> Pode substituir cobertura existente</label>
          </div>
        </fieldset>

        <fieldset disabled={pending} className="space-y-3">
          <legend className="text-sm font-semibold text-ink">4. Autorizações</legend>
          <label className="flex items-start gap-2 text-sm text-ink"><input name="clientAuthorizedCollection" type="checkbox" defaultChecked={consent.clientAuthorizedCollection === true} className="mt-1" /> O cliente autorizou a coleta e o uso destas informações para preparar a Application.</label>
          <label className="flex items-start gap-2 text-sm text-ink"><input name="agentAttestedAccuracy" type="checkbox" defaultChecked={consent.agentAttestedAccuracy === true} className="mt-1" /> Revisei os dados acima e confirmo que representam as respostas recebidas do cliente.</label>
        </fieldset>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Salvando…" : "Salvar informações"}</Button>
          {addon.entitled && application.automationState === "READY_TO_PREPARE" ? (
            <Button type="button" onClick={prepareDraft} disabled={pending}>
              {pending ? "Preparando…" : "Preparar rascunho no iGO"}
            </Button>
          ) : null}
        </div>
      </form>

      <div className="space-y-3 border-t border-border-steel pt-5">
        <div>
          <h4 className="text-sm font-semibold text-ink">5. Documentos</h4>
          <p className="text-xs text-ink-muted">PDF, PNG ou JPG, até 10 MB. O K-Bot só poderá usar documentos revisados.</p>
        </div>
        <form onSubmit={upload} className="flex flex-wrap items-end gap-3">
          <label className={labelClass}>Tipo<select name="type" className={fieldClass}><option value="IDENTITY">Identidade</option><option value="AUTHORIZATION">Autorização</option><option value="FINANCIAL">Financeiro</option><option value="REPLACEMENT">Substituição</option><option value="OTHER">Outro</option></select></label>
          <label className={labelClass}>Arquivo<input name="file" type="file" accept="application/pdf,image/png,image/jpeg" required className={fieldClass} /></label>
          <Button type="submit" variant="secondary" disabled={pending}>Adicionar documento</Button>
        </form>
        <ul className="space-y-2">
          {application.documents.map((document) => (
            <li key={document.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-steel px-3 py-2 text-sm">
              <span className="text-ink">{document.filename} <small className="text-ink-muted">· {document.type}</small></span>
              {document.reviewedAt ? <span className="text-xs font-semibold text-emerald-800">Revisado</span> : (
                <Button variant="secondary" disabled={pending} onClick={() => startTransition(async () => {
                  const result = await reviewKBotApplicationDocument(document.id);
                  if (!result.ok) setMessage(result.message); else router.refresh();
                })}>Marcar como revisado</Button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {message ? <p role="status" className="text-sm font-medium text-ink">{message}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-steel pt-5">
        <div>
          <p className="text-sm font-semibold text-ink">Revisão final do dossiê</p>
          <p className="text-xs text-ink-muted">Após revisar, qualquer alteração em dados ou documentos exigirá uma nova autorização.</p>
        </div>
        <Button variant="primary" disabled={pending || !addon.canAutomate || application.automationState !== "READY_FOR_REVIEW"} onClick={reviewDossier}>
          Revisar e autorizar K-Bot
        </Button>
      </div>
    </div>
  );
}
