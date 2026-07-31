"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { Field, Input, Select } from "@/components/Field";
import {
  DEATH_BENEFIT_OPTIONS,
  GENDERS,
  ISSUE_STATES,
  RATE_CLASSES,
  SOLVE_TYPES,
  STRATEGIES,
} from "@/lib/national-life/rapid-solve";
import { QUOTE_DISCLAIMER } from "@/lib/national-life/quote-disclaimer";
import { requestCarrierQuote } from "./new/actions";
import { useRapidSolveQuote } from "./useRapidSolveQuote";

const currency = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);

// Which side of the illustration the carrier solves for decides whether the
// amount field is a face amount or a premium — the carrier sends both in the
// same field, keyed by this.
const AMOUNT_LABELS: Record<string, string> = {
  [SOLVE_TYPES.SPECIFY_AMOUNT]: "Capital segurado",
  [SOLVE_TYPES.PREMIUM_DEATH_BENEFIT_FOCUS]: "Prêmio mensal",
  [SOLVE_TYPES.PREMIUM_ACCUMULATION_FOCUS]: "Prêmio mensal",
};

export function NewIllustrationForm() {
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [solveType, setSolveType] = useState<string>(SOLVE_TYPES.SPECIFY_AMOUNT);

  const { status, error: pollError } = useRapidSolveQuote(jobId);

  async function handleSubmit(formData: FormData) {
    setSubmitting(true);
    setSubmitError(null);
    setJobId(null);

    const result = await requestCarrierQuote(formData);
    if (result.ok) {
      setJobId(result.jobId);
    } else {
      setSubmitError(result.message);
    }

    setSubmitting(false);
  }

  return (
    <div className="module-main-surface">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">
        National Life • Rapid Solve
      </p>
      <h2 className="mt-2 text-2xl font-medium tracking-[-0.04em] text-ink">
        Cotação de IUL
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
        Os valores vêm da própria seguradora. O Rapid Solve cota apenas o produto de IUL —
        Term não é cotado por este portal.
      </p>

      <form action={handleSubmit} className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Nome">
          <Input name="firstName" required placeholder="Maria" />
        </Field>
        <Field label="Sobrenome">
          <Input name="lastName" required placeholder="Silva" />
        </Field>
        <Field label="Data de nascimento (DOB)">
          <Input name="dateOfBirth" type="date" required />
        </Field>
        <Field label="Estado de emissão">
          <Select name="issueState" required defaultValue="" className="w-full">
            <option value="" disabled>
              Selecione...
            </option>
            {ISSUE_STATES.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sexo">
          <Select name="gender" required defaultValue="" className="w-full">
            <option value="" disabled>
              Selecione...
            </option>
            <option value={GENDERS.FEMALE}>Feminino</option>
            <option value={GENDERS.MALE}>Masculino</option>
          </Select>
        </Field>
        {/* The carrier has two classes and no former-smoker value, so this is
            the agent's underwriting call rather than something derived from a
            tobacco question. */}
        <Field label="Classe de risco">
          <Select name="rateClass" required defaultValue="" className="w-full">
            <option value="" disabled>
              Selecione...
            </option>
            <option value={RATE_CLASSES.STANDARD_NON_TOBACCO}>Standard não-tabagista</option>
            <option value={RATE_CLASSES.STANDARD_TOBACCO}>Standard tabagista</option>
          </Select>
        </Field>
        <Field label="O que a seguradora deve calcular">
          <Select
            name="solveType"
            required
            className="w-full"
            value={solveType}
            onChange={(event) => setSolveType(event.target.value)}
          >
            <option value={SOLVE_TYPES.SPECIFY_AMOUNT}>
              Informo o capital, quero o prêmio
            </option>
            <option value={SOLVE_TYPES.PREMIUM_DEATH_BENEFIT_FOCUS}>
              Informo o prêmio, foco em benefício por morte
            </option>
            <option value={SOLVE_TYPES.PREMIUM_ACCUMULATION_FOCUS}>
              Informo o prêmio, foco em acúmulo
            </option>
          </Select>
        </Field>
        <Field label={AMOUNT_LABELS[solveType] ?? "Valor"}>
          <Input name="amount" type="number" min={1} step="0.01" required placeholder="250000" />
        </Field>
        <Field label="Opção de benefício por morte">
          <Select name="deathBenefitOption" required defaultValue="" className="w-full">
            <option value="" disabled>
              Selecione...
            </option>
            <option value={DEATH_BENEFIT_OPTIONS.LEVEL}>A — nivelado</option>
            <option value={DEATH_BENEFIT_OPTIONS.INCREASING}>B — crescente</option>
          </Select>
        </Field>
        <Field label="Estratégia de índice">
          <Select name="strategy" required defaultValue="" className="w-full">
            <option value="" disabled>
              Selecione...
            </option>
            <option value={STRATEGIES.CAP_FOCUS}>S&P 500 — foco em teto</option>
            <option value={STRATEGIES.PAR_FOCUS}>S&P 500 — foco em participação</option>
            <option value={STRATEGIES.ONE_PERCENT_FLOOR}>S&P 500 — piso de 1%</option>
          </Select>
        </Field>

        <div className="border-t border-border-steel pt-5 sm:col-span-2">
          <Button
            type="submit"
            variant="primary"
            disabled={submitting || status?.state === "PENDING"}
            className="w-full sm:w-auto"
          >
            {submitting
              ? "Enviando..."
              : status?.state === "PENDING"
                ? "Aguardando a seguradora..."
                : "Cotar na National Life"}
          </Button>
        </div>
      </form>

      {submitError && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {submitError}
        </p>
      )}

      {pollError && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {pollError}
        </p>
      )}

      {status?.state === "PENDING" && !pollError && (
        <p className="mt-4 text-sm text-ink-muted">
          A cotação foi enviada para a National Life. A resposta aparece aqui assim que chegar.
        </p>
      )}

      {/* A refusal is the carrier's own sentence and belongs on screen. It is
          not an error in the app, and it is not a quote either. */}
      {status?.state === "ANSWERED" && !status.quote.ok && (
        <p role="alert" className="mt-4 text-sm text-danger">
          A seguradora não cotou: {status.quote.message}
        </p>
      )}

      {status?.state === "UNAVAILABLE" && (
        <p role="alert" className="mt-4 text-sm text-danger">
          Não foi possível obter a cotação ({status.safeErrorCode}). Nenhum valor foi calculado.
        </p>
      )}

      {status?.state === "ANSWERED" && status.quote.ok && (
        <div className="mt-4 space-y-2">
          <div className="rounded-2xl border border-border-steel bg-panel/55 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink">Cotação da National Life</p>
              <p className="text-xs text-ink-muted">Produto de IUL • prêmio mensal</p>
            </div>

            {/* The carrier's own condition, which an agent has to accept on its
                site before it will quote. Reproduced here because our screen
                shows the same number without asking, and the restriction
                travels with the number rather than with the checkbox. */}
            <p className="mt-3 border-l-2 border-border-steel pl-3 text-xs leading-5 text-ink-muted">
              {QUOTE_DISCLAIMER}
            </p>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse">
                <tbody>
                  <tr className="border-b border-border-steel/70">
                    <td className="py-2 pr-3 text-sm text-ink-muted">Capital segurado</td>
                    <td className="py-2 text-sm font-semibold text-ink">
                      {currency(status.quote.faceAmount)}
                    </td>
                  </tr>
                  <tr className="border-b border-border-steel/70">
                    <td className="py-2 pr-3 text-sm text-ink-muted">Prêmio mensal</td>
                    <td className="py-2 text-sm font-semibold text-ink">
                      {currency(status.quote.monthlyPremium)}
                    </td>
                  </tr>
                  <tr className="border-b border-border-steel/70">
                    <td className="py-2 pr-3 text-sm text-ink-muted">Prêmio anual</td>
                    <td className="py-2 text-sm font-semibold text-ink">
                      {currency(status.quote.annualPremium)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-3 text-sm text-ink-muted">Lapso projetado</td>
                    <td className="py-2 text-sm font-semibold text-ink">
                      {/* The carrier sends 0 for "does not lapse", which the
                          parser turns into null so it never prints as year zero. */}
                      {status.quote.lapseYear === null
                        ? "Não lapsa"
                        : `Ano ${status.quote.lapseYear}`}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <p>
            <Link href="/agent/policies" className="text-sm text-ink-muted hover:text-ink">
              Voltar para apólices
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
