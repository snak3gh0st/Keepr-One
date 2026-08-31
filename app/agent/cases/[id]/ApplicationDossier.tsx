"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { useI18n } from "@/components/i18n/LanguageProvider";
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

const fieldClass = "min-h-11 w-full rounded-xl border border-border-steel bg-white px-3 text-sm text-ink outline-none transition focus:border-emerald-700";
const labelClass = "space-y-1 text-xs font-semibold text-ink-muted";

export function ApplicationDossier({
  application,
  addon,
  prospect,
}: {
  application: ApplicationView;
  addon: { entitled: boolean; status: string | null; canAutomate: boolean };
  prospect: ProspectDefaults;
}) {
  const { copy, locale } = useI18n();
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
  const confirmedCurrency = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
  const documentTypeCopy: Record<string, string> = {
    IDENTITY: copy("Identidade", "Identity"),
    AUTHORIZATION: copy("Autorização", "Authorization"),
    FINANCIAL: copy("Financeiro", "Financial"),
    REPLACEMENT: copy("Substituição", "Replacement"),
    OTHER: copy("Outro", "Other"),
  };
  const stateCopy: Record<string, string> = {
    COLLECTING: copy("Reunindo informações", "Collecting information"),
    READY_FOR_REVIEW: copy("Pronto para sua revisão", "Ready for your review"),
    READY_TO_PREPARE: copy("Autorizado para preparar no iGO", "Authorized to prepare in iGO"),
    PREPARING_DRAFT: copy("K-Bot está preparando o rascunho", "K-Bot is preparing the draft"),
    NEEDS_INFORMATION: copy("Falta uma resposta do cliente", "A client answer is missing"),
    DRAFT_READY: copy("Rascunho da National Life pronto", "National Life draft is ready"),
    READY_TO_SUBMIT: copy("Pronto para confirmação final", "Ready for final confirmation"),
    SUBMITTING: copy("Enviando à National Life", "Sending to National Life"),
    SUBMITTED: copy("Enviado à National Life", "Sent to National Life"),
    FAILED: copy("Precisa de atenção", "Needs attention"),
  };

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage(null);
    const payload = {
      version: 1,
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
        ...(form.get("product") ? { product: String(form.get("product")) } : {}),
        ...(numberValue(form.get("faceAmount")) ? { faceAmount: numberValue(form.get("faceAmount")) } : {}),
        ...(form.get("premiumMode") ? { premiumMode: String(form.get("premiumMode")) } : {}),
        ...(numberValue(form.get("plannedPremium")) ? { plannedPremium: numberValue(form.get("plannedPremium")) } : {}),
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
          ? copy("Informações completas. Revise e autorize o K-Bot quando estiver pronto.", "Information complete. Review and authorize K-Bot when you are ready.")
          : copy("Salvei o rascunho. Ainda faltam {count} pontos.", "Draft saved. {count} items are still missing.", { count: result.missing.length }));
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
        setMessage(copy("Documento salvo. Revise-o antes de autorizar o K-Bot.", "Document saved. Review it before authorizing K-Bot."));
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
        setMessage(copy("Revisão concluída. Este conjunto de informações ficou protegido contra alterações silenciosas.", "Review complete. This information set is now protected against silent changes."));
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
        setMessage(copy("K-Bot começou a preparar o rascunho no iGO. Você pode continuar trabalhando.", "K-Bot has started preparing the draft in iGO. You can keep working."));
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-5 rounded-2xl border border-border-steel bg-white/70 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-800">K-Bot Application</p>
          <h3 className="mt-1 text-base font-semibold text-ink">{stateCopy[application.automationState] ?? copy("Preparação do caso", "Case preparation")}</h3>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">{copy("O KeeprOne reúne e revisa os dados primeiro. O K-Bot só entra no iGO depois da sua autorização.", "KeeprOne collects and reviews the information first. K-Bot only enters iGO after your authorization.")}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${addon.entitled ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>
          {addon.entitled ? copy("Add-on ativo", "Add-on active") : copy("Add-on não ativo", "Add-on inactive")}
        </span>
      </div>

      {!addon.entitled ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <div>
            <p>{copy("Você pode organizar o dossiê agora. Para o K-Bot preparar e enviar no iGO, ative o add-on Application.", "You can organize the dossier now. Activate the Application add-on so K-Bot can prepare and send it through iGO.")}</p>
            <p className="mt-1 text-xs text-amber-800">{copy("US$ 9,99/mês por agente · primeiros 14 dias grátis.", "US$9.99/month per agent · first 14 days free.")}</p>
          </div>
          <form action="/api/billing/application-addon/checkout" method="post">
            <Button type="submit" variant="secondary">{copy("Ativar Application", "Activate Application")}</Button>
          </form>
        </div>
      ) : null}

      {application.externalId && Object.keys(confirmedValues).length ? (
        <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-900">{copy("Confirmado no iGO", "Confirmed in iGO")}</p>
              <p className="mt-1 text-sm text-emerald-950">{copy("Rascunho", "Draft")} {application.externalId} · {text(carrierReceipt.carrierStatus, copy("Recebido", "Received"))}</p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-emerald-900">
              {text(confirmedValues.premiumMode) === "MONTHLY" ? copy("Mensal", "Monthly") : copy("Anual", "Annual")}
            </span>
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-xs text-emerald-800">{copy("Cliente", "Client")}</dt><dd className="font-semibold text-emerald-950">{text(confirmedValues.insuredName)}</dd></div>
            <div><dt className="text-xs text-emerald-800">{copy("Produto", "Product")}</dt><dd className="font-semibold text-emerald-950">{text(confirmedValues.product)}</dd></div>
            <div><dt className="text-xs text-emerald-800">{copy("Capital confirmado", "Confirmed face amount")}</dt><dd className="font-semibold text-emerald-950">{confirmedCurrency.format(Number(confirmedValues.faceAmount ?? 0))}</dd></div>
            <div><dt className="text-xs text-emerald-800">{copy("Prêmio confirmado", "Confirmed premium")}</dt><dd className="font-semibold text-emerald-950">{confirmedCurrency.format(Number(confirmedValues.plannedPremium ?? 0))}</dd></div>
          </dl>
          {carrierChanges.length ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-950">{copy("A National Life ajustou {count} informação(ões)", "National Life adjusted {count} item(s)", { count: carrierChanges.length })}</p>
              <ul className="mt-2 space-y-1 text-xs text-amber-900">
                {carrierChanges.map((change, index) => (
                  <li key={`${text(change.field)}-${index}`}>{text(change.field)}: {text(change.requested, "—")} → {text(change.carrier, "—")}</li>
                ))}
              </ul>
            </div>
          ) : <p className="text-xs text-emerald-800">{copy("Os valores conferem com o dossiê enviado.", "The values match the submitted dossier.")}</p>}
        </div>
      ) : null}

      {carrierQuestions.length ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-950">{copy("O iGO precisa de mais {count} resposta(s)", "iGO needs {count} more answer(s)", { count: carrierQuestions.length })}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
            {carrierQuestions.map((question, index) => (
              <li key={`${text(question.label)}-${index}`}>{text(question.label)} <span className="text-amber-700">· {text(question.section)}</span></li>
            ))}
          </ul>
        </div>
      ) : null}

      <form onSubmit={save} className="space-y-5">
        <fieldset disabled={pending} className="space-y-4">
          <legend className="text-sm font-semibold text-ink">{copy("1. Cliente e contato", "1. Client and contact")}</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className={labelClass}>{copy("Nome", "First name")}<input name="firstName" className={fieldClass} defaultValue={text(insured.firstName, fallbackFirstName)} /></label>
            <label className={labelClass}>{copy("Sobrenome", "Last name")}<input name="lastName" className={fieldClass} defaultValue={text(insured.lastName, fallbackLastName.join(" "))} /></label>
            <label className={labelClass}>{copy("Nascimento", "Date of birth")}<input name="birthDate" type="date" className={fieldClass} defaultValue={text(insured.birthDate, prospect.dateOfBirth?.slice(0, 10) ?? "")} /></label>
            <label className={labelClass}>{copy("Sexo conforme a seguradora", "Sex as recorded by the carrier")}<select name="sexAtBirth" className={fieldClass} defaultValue={text(insured.sexAtBirth)}><option value="">{copy("Selecione", "Select")}</option><option value="MALE">{copy("Masculino", "Male")}</option><option value="FEMALE">{copy("Feminino", "Female")}</option></select></label>
            <label className={labelClass}>{copy("E-mail", "Email")}<input name="email" type="email" className={fieldClass} defaultValue={text(insured.email, prospect.email ?? "")} /></label>
            <label className={labelClass}>{copy("Telefone internacional", "International phone")}<input name="phone" placeholder="+13055550123" className={fieldClass} defaultValue={text(insured.phone, prospect.phone ?? "")} /></label>
          </div>
        </fieldset>

        <fieldset disabled={pending} className="space-y-4">
          <legend className="text-sm font-semibold text-ink">{copy("2. Endereço e titularidade", "2. Address and ownership")}</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className={labelClass}>{copy("Endereço", "Address")}<input name="line1" className={fieldClass} defaultValue={text(address.line1)} /></label>
            <label className={labelClass}>{copy("Complemento", "Address line 2")}<input name="line2" className={fieldClass} defaultValue={text(address.line2)} /></label>
            <label className={labelClass}>{copy("Cidade", "City")}<input name="city" className={fieldClass} defaultValue={text(address.city)} /></label>
            <label className={labelClass}>{copy("Estado", "State")}<input name="state" maxLength={2} className={fieldClass} defaultValue={text(address.state, prospect.state ?? "")} /></label>
            <label className={labelClass}>ZIP code<input name="postalCode" className={fieldClass} defaultValue={text(address.postalCode)} /></label>
            <label className={labelClass}>{copy("Relação do titular", "Owner relationship")}<select name="ownerRelationship" className={fieldClass} defaultValue={text(owner.relationship, "SELF")}><option value="SELF">{copy("O próprio segurado", "The insured")}</option><option value="SPOUSE">{copy("Cônjuge", "Spouse")}</option><option value="PARENT">{copy("Pai ou mãe", "Parent")}</option><option value="BUSINESS">{copy("Empresa", "Business")}</option><option value="OTHER">{copy("Outro", "Other")}</option></select></label>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink"><input name="sameAsInsured" type="checkbox" defaultChecked={owner.sameAsInsured !== false} /> {copy("Titular é o próprio segurado", "The insured is also the owner")}</label>
          <label className={labelClass}>{copy("Nome do titular, se diferente", "Owner name, if different")}<input name="ownerFullName" className={fieldClass} defaultValue={text(owner.fullName)} /></label>
        </fieldset>

        <fieldset disabled={pending} className="space-y-4">
          <legend className="text-sm font-semibold text-ink">{copy("3. Beneficiário e cobertura", "3. Beneficiary and coverage")}</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className={labelClass}>{copy("Beneficiário principal", "Primary beneficiary")}<input name="beneficiaryName" className={fieldClass} defaultValue={text(beneficiary.fullName)} /></label>
            <label className={labelClass}>{copy("Relação", "Relationship")}<input name="beneficiaryRelationship" className={fieldClass} defaultValue={text(beneficiary.relationship)} /></label>
            <label className={labelClass}>{copy("Participação %", "Share %")}<input name="beneficiaryShare" type="number" min="0.01" max="100" step="0.01" className={fieldClass} defaultValue={typeof beneficiary.sharePercent === "number" ? beneficiary.sharePercent : 100} /></label>
            <label className={labelClass}>{copy("Produto", "Product")}<select name="product" className={fieldClass} defaultValue={text(coverage.product)}><option value="">{copy("Selecione", "Select")}</option><option value="IUL">IUL</option><option value="TERM">Term</option></select></label>
            <label className={labelClass}>{copy("Capital segurado", "Face amount")}<input name="faceAmount" type="number" min="1" step="0.01" className={fieldClass} defaultValue={typeof coverage.faceAmount === "number" ? coverage.faceAmount : ""} /></label>
            <label className={labelClass}>{copy("Prêmio planejado", "Planned premium")}<input name="plannedPremium" type="number" min="1" step="0.01" className={fieldClass} defaultValue={typeof coverage.plannedPremium === "number" ? coverage.plannedPremium : ""} /></label>
            <label className={labelClass}>{copy("Frequência", "Frequency")}<select name="premiumMode" className={fieldClass} defaultValue={text(coverage.premiumMode, "MONTHLY")}><option value="MONTHLY">{copy("Mensal", "Monthly")}</option><option value="ANNUAL">{copy("Anual", "Annual")}</option></select></label>
          </div>
          <div className="flex flex-wrap gap-5">
            <label className="flex items-center gap-2 text-sm text-ink"><input name="hasExisting" type="checkbox" defaultChecked={existing.hasExisting === true} /> {copy("Já possui seguro de vida", "Has existing life insurance")}</label>
            <label className="flex items-center gap-2 text-sm text-ink"><input name="replacementExpected" type="checkbox" defaultChecked={existing.replacementExpected === true} /> {copy("Pode substituir cobertura existente", "May replace existing coverage")}</label>
          </div>
        </fieldset>

        <fieldset disabled={pending} className="space-y-3">
          <legend className="text-sm font-semibold text-ink">{copy("4. Autorizações", "4. Authorizations")}</legend>
          <label className="flex items-start gap-2 text-sm text-ink"><input name="clientAuthorizedCollection" type="checkbox" defaultChecked={consent.clientAuthorizedCollection === true} className="mt-1" /> {copy("O cliente autorizou a coleta e o uso destas informações para preparar a Application.", "The client authorized the collection and use of this information to prepare the Application.")}</label>
          <label className="flex items-start gap-2 text-sm text-ink"><input name="agentAttestedAccuracy" type="checkbox" defaultChecked={consent.agentAttestedAccuracy === true} className="mt-1" /> {copy("Revisei os dados acima e confirmo que representam as respostas recebidas do cliente.", "I reviewed the information above and confirm it represents the client's answers.")}</label>
        </fieldset>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="secondary" disabled={pending}>{pending ? copy("Salvando…", "Saving…") : copy("Salvar informações", "Save information")}</Button>
          {addon.entitled && application.automationState === "READY_TO_PREPARE" ? (
            <Button type="button" onClick={prepareDraft} disabled={pending}>
              {pending ? copy("Preparando…", "Preparing…") : copy("Preparar rascunho no iGO", "Prepare draft in iGO")}
            </Button>
          ) : null}
        </div>
      </form>

      <div className="space-y-3 border-t border-border-steel pt-5">
        <div>
          <h4 className="text-sm font-semibold text-ink">{copy("5. Documentos", "5. Documents")}</h4>
          <p className="text-xs text-ink-muted">{copy("PDF, PNG ou JPG, até 10 MB. O K-Bot só poderá usar documentos revisados.", "PDF, PNG, or JPG, up to 10 MB. K-Bot can only use reviewed documents.")}</p>
        </div>
        <form onSubmit={upload} className="flex flex-wrap items-end gap-3">
          <label className={labelClass}>{copy("Tipo", "Type")}<select name="type" className={fieldClass}><option value="IDENTITY">{copy("Identidade", "Identity")}</option><option value="AUTHORIZATION">{copy("Autorização", "Authorization")}</option><option value="FINANCIAL">{copy("Financeiro", "Financial")}</option><option value="REPLACEMENT">{copy("Substituição", "Replacement")}</option><option value="OTHER">{copy("Outro", "Other")}</option></select></label>
          <label className={labelClass}>{copy("Arquivo", "File")}<input name="file" type="file" accept="application/pdf,image/png,image/jpeg" required className={fieldClass} /></label>
          <Button type="submit" variant="secondary" disabled={pending}>{copy("Adicionar documento", "Add document")}</Button>
        </form>
        <ul className="space-y-2">
          {application.documents.map((document) => (
            <li key={document.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-steel px-3 py-2 text-sm">
              <span className="text-ink">{document.filename} <small className="text-ink-muted">· {documentTypeCopy[document.type] ?? document.type}</small></span>
              {document.reviewedAt ? <span className="text-xs font-semibold text-emerald-800">{copy("Revisado", "Reviewed")}</span> : (
                <Button variant="secondary" disabled={pending} onClick={() => startTransition(async () => {
                  const result = await reviewKBotApplicationDocument(document.id);
                  if (!result.ok) setMessage(result.message); else router.refresh();
                })}>{copy("Marcar como revisado", "Mark as reviewed")}</Button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {message ? <p role="status" className="text-sm font-medium text-ink">{message}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-steel pt-5">
        <div>
          <p className="text-sm font-semibold text-ink">{copy("Revisão final do dossiê", "Final dossier review")}</p>
          <p className="text-xs text-ink-muted">{copy("Após revisar, qualquer alteração em dados ou documentos exigirá uma nova autorização.", "After review, any change to information or documents will require a new authorization.")}</p>
        </div>
        <Button variant="primary" disabled={pending || !addon.canAutomate || application.automationState !== "READY_FOR_REVIEW"} onClick={reviewDossier}>
          {copy("Revisar e autorizar K-Bot", "Review and authorize K-Bot")}
        </Button>
      </div>
    </div>
  );
}
