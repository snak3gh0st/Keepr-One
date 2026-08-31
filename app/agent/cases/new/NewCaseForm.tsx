"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Field, Input, Select } from "@/components/Field";
import { createInsuranceCase } from "./actions";
import { useI18n } from "@/components/i18n/LanguageProvider";

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

export function NewCaseForm() {
  const { copy } = useI18n();
  const tobaccoOptions = [
    { value: "NO", label: copy("Nunca fumou", "Never smoked") },
    { value: "FORMER", label: copy("Ex-fumante", "Former smoker") },
    { value: "YES", label: copy("Fumante", "Smoker") },
  ];
  const objectiveOptions = [
    { value: "PROTECTION", label: copy("Proteção", "Protection") },
    { value: "ACCUMULATION", label: copy("Acumulação", "Accumulation") },
    { value: "RETIREMENT", label: copy("Aposentadoria", "Retirement") },
    { value: "LEGACY", label: copy("Legado", "Legacy") },
  ];
  const productOptions = [
    { value: "UNDECIDED", label: copy("A definir", "Undecided") },
    { value: "TERM", label: "Term" },
    { value: "IUL", label: "IUL (Indexed Universal Life)" },
  ];
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setSubmitting(true);
    setMessage(null);

    const result = await createInsuranceCase(formData);
    if (result.ok) {
      router.push(`/agent/cases/${result.caseId}`);
      return;
    }
    setMessage(result.message);
    setSubmitting(false);
  }

  return (
    <div className="module-main-surface">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">{copy("Entrada do atendimento", "Case intake")}</p>
      <h2 className="mt-2 text-2xl font-medium tracking-[-0.04em] text-ink">{copy("Dados do cliente e objetivo", "Client details and objective")}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
        {copy("Comece com o essencial. O restante da operação será organizado dentro da oportunidade.", "Start with the essentials. The rest of the work will be organized within the opportunity.")}
      </p>
      <form action={handleSubmit} className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label={copy("Nome", "First name")}>
          <Input name="firstName" required placeholder={copy("Ex: Maria", "E.g. Maria")} />
        </Field>

        <Field label={copy("Sobrenome", "Last name")}>
          <Input name="lastName" required placeholder={copy("Ex: Silva", "E.g. Silva")} />
        </Field>

        <Field label={copy("E-mail", "Email")}>
          <Input name="email" type="email" placeholder={copy("opcional", "optional")} />
        </Field>

        <Field label={copy("Telefone", "Phone")}>
          <Input name="phone" placeholder={copy("opcional", "optional")} />
        </Field>

        <Field label={copy("Data de nascimento", "Date of birth")}>
          <Input name="dateOfBirth" type="date" />
        </Field>

        <Field label={copy("Estado (US)", "State (US)")}>
          <Select name="state" required defaultValue="" className="w-full">
            <option value="" disabled>{copy("Selecione…", "Select…")}</option>
            {US_STATES.map((state) => (
              <option key={state} value={state}>{state}</option>
            ))}
          </Select>
        </Field>

        <Field label={copy("Uso de tabaco", "Tobacco use")}>
          <Select name="tobaccoStatus" required defaultValue="NO" className="w-full">
            {tobaccoOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </Field>

        <Field label={copy("Objetivo", "Objective")}>
          <Select name="objective" required defaultValue="PROTECTION" className="w-full">
            {objectiveOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </Field>

        <Field label={copy("Tipo de produto", "Product type")}>
          <Select name="productType" required defaultValue="UNDECIDED" className="w-full">
            {productOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </Field>

        <Field label={copy("Cobertura alvo", "Target coverage")}>
          <Input name="targetCoverage" type="number" step="0.01" min={0} placeholder={copy("opcional", "optional")} />
        </Field>

        <Field label={copy("Orçamento mensal", "Monthly budget")}>
          <Input name="monthlyBudget" type="number" step="0.01" min={0} placeholder={copy("opcional", "optional")} />
        </Field>

        <div className="flex flex-col gap-3 border-t border-border-steel pt-5 sm:col-span-2 sm:flex-row sm:items-center">
          <Button type="submit" variant="primary" disabled={submitting} className="w-full sm:w-auto">
            {submitting ? copy("Criando atendimento...", "Creating case...") : copy("Criar atendimento", "Create case")}
          </Button>
          {message && (
            <p role="alert" className="mt-3 text-sm text-danger">{message}</p>
          )}
        </div>
      </form>
    </div>
  );
}
