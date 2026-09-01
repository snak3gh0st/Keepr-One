"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Field, Input, Select } from "@/components/Field";
import { createInsuranceCase } from "./actions";

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

const TOBACCO_OPTIONS = [
  { value: "NO", label: "Nunca fumou" },
  { value: "FORMER", label: "Ex-fumante" },
  { value: "YES", label: "Fumante" },
];

const OBJECTIVE_OPTIONS = [
  { value: "PROTECTION", label: "Proteção" },
  { value: "ACCUMULATION", label: "Acumulação" },
  { value: "RETIREMENT", label: "Aposentadoria" },
  { value: "LEGACY", label: "Legado" },
];

const PRODUCT_OPTIONS = [
  { value: "UNDECIDED", label: "A definir" },
  { value: "TERM", label: "Term" },
  { value: "IUL", label: "IUL (Indexed Universal Life)" },
];

export function NewCaseForm() {
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
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">Entrada do atendimento</p>
      <h2 className="mt-2 text-2xl font-medium tracking-[-0.04em] text-ink">Dados do cliente e objetivo</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
        Comece com o essencial. O restante da operação será organizado dentro da oportunidade.
      </p>
      <form action={handleSubmit} className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Nome">
          <Input name="firstName" required placeholder="Ex: Maria" />
        </Field>

        <Field label="Sobrenome">
          <Input name="lastName" required placeholder="Ex: Silva" />
        </Field>

        <Field label="E-mail">
          <Input name="email" type="email" placeholder="opcional" />
        </Field>

        <Field label="Telefone">
          <Input name="phone" placeholder="opcional" />
        </Field>

        <Field label="Data de nascimento">
          <Input name="dateOfBirth" type="date" />
        </Field>

        <Field label="Estado (US)">
          <Select name="state" required defaultValue="" className="w-full">
            <option value="" disabled>Selecione…</option>
            {US_STATES.map((state) => (
              <option key={state} value={state}>{state}</option>
            ))}
          </Select>
        </Field>

        <Field label="Uso de tabaco">
          <Select name="tobaccoStatus" required defaultValue="NO" className="w-full">
            {TOBACCO_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </Field>

        <Field label="Objetivo">
          <Select name="objective" required defaultValue="PROTECTION" className="w-full">
            {OBJECTIVE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </Field>

        <Field label="Tipo de produto">
          <Select name="productType" required defaultValue="UNDECIDED" className="w-full">
            {PRODUCT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </Field>

        <Field label="Cobertura alvo">
          <Input name="targetCoverage" type="number" step="0.01" min={0} placeholder="opcional" />
        </Field>

        <Field label="Orçamento mensal">
          <Input name="monthlyBudget" type="number" step="0.01" min={0} placeholder="opcional" />
        </Field>

        <div className="flex flex-col gap-3 border-t border-border-steel pt-5 sm:col-span-2 sm:flex-row sm:items-center">
          <Button type="submit" variant="primary" disabled={submitting} className="w-full sm:w-auto">
            {submitting ? "Criando atendimento..." : "Criar atendimento"}
          </Button>
          {message && (
            <p role="alert" className="mt-3 text-sm text-danger">{message}</p>
          )}
        </div>
      </form>
    </div>
  );
}
