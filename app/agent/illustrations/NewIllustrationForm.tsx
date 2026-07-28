"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { Field, Input, Select } from "@/components/Field";
import { createIllustrationRequest } from "./new/actions";

type QuoteResult = {
  firstName: string
  lastName: string
  dateOfBirth: string
  age: number
  tobaccoStatus: "YES" | "NO" | "FORMER"
}

type Message =
  | {
      ok: true
      text: string
      insured: QuoteResult
      coverageAmount: number
      ageBand: string
      tobaccoFactor: number
      quotes: Array<{
        productCode: "TERM_15" | "TERM_20" | "TERM_30" | "IUL"
        productLabel: string
        formulaLabel: string
        basePremium: number
        tobaccoFactor: number
        premium: number
      }>
      calculatedAt: string
    }
  | {
      ok: false
      text: string
    }

export function NewIllustrationForm() {
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  async function handleSubmit(formData: FormData) {
    setSubmitting(true);
    setMessage(null);

    const result = await createIllustrationRequest(formData);
    if (result.ok) {
      const text = "Cotações de mercado geradas internamente para este cliente."
      setMessage({
        ok: true,
        text,
        insured: result.insured,
        coverageAmount: result.coverageAmount,
        ageBand: result.ageBand,
        tobaccoFactor: result.tobaccoFactor,
        quotes: result.quotes,
        calculatedAt: result.calculatedAt,
      });
    } else {
      setMessage({ ok: false, text: result.message });
    }

    setSubmitting(false);
  }

  const currency = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(value)

  return (
    <div className="module-main-surface">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">Simulação orientada</p>
      <h2 className="mt-2 text-2xl font-medium tracking-[-0.04em] text-ink">Informações para ilustração</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
        Reúna os dados do cliente e compare as opções sem sair do fluxo de atendimento.
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
        <Field label="Idade">
          <Input name="age" type="number" min={0} max={120} required placeholder="38" />
        </Field>
        <Field label="Informação tabagista">
          <Select name="tobaccoStatus" required className="w-full">
            <option value="">Selecione...</option>
            <option value="NO">Não fumante</option>
            <option value="YES">Fumante</option>
            <option value="FORMER">Ex-fumante</option>
          </Select>
        </Field>

        <div className="border-t border-border-steel pt-5 sm:col-span-2">
          <Button type="submit" variant="primary" disabled={submitting} className="w-full sm:w-auto">
            {submitting ? "Calculando..." : "Calcular ilustração"}
          </Button>
        </div>
      </form>

      {message && (
        <div className="mt-4 space-y-2">
          <p role="alert" className={`text-sm ${message.ok ? "text-success" : "text-danger"}`}>
            {message.text}
          </p>
          {message.ok && (
            <>
              <div className="rounded-2xl border border-border-steel bg-panel/55 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">
                    Cálculo interno • Sem envio para parceiro
                  </p>
                  <p className="text-xs text-ink-muted">
                    Cobertura-base: {currency(message.coverageAmount)} (referência fixa por simulação)
                  </p>
                </div>
                <div className="mt-3 text-xs text-ink-muted">
                  <p>Nome: {message.insured.firstName} {message.insured.lastName}</p>
                  <p>DOB: {message.insured.dateOfBirth}</p>
                  <p>Idade: {message.insured.age} anos</p>
                  <p>Faixa etária: {message.ageBand}</p>
                  <p>Tabagismo: {message.insured.tobaccoStatus === "YES" ? "Fumante" : message.insured.tobaccoStatus === "FORMER" ? "Ex-fumante" : "Não fumante"} x {message.tobaccoFactor}</p>
                  <p>Gerado em: {new Date(message.calculatedAt).toLocaleString("pt-BR")}</p>
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-border-steel text-left text-xs uppercase tracking-[0.1em] text-ink-muted">
                        <th className="pb-2 pr-3 font-medium">Produto</th>
                        <th className="pb-2 pr-3 font-medium">Fórmula de mercado</th>
                        <th className="pb-2 pr-3 font-medium">Prêmio base</th>
                        <th className="pb-2 font-medium">Prêmio com tabaco</th>
                      </tr>
                    </thead>
                    <tbody>
                      {message.quotes.map((quote) => (
                        <tr key={quote.productCode} className="border-b border-border-steel/70 last:border-b-0">
                          <td className="py-2 pr-3 text-sm font-medium text-ink">{quote.productLabel}</td>
                          <td className="py-2 pr-3 text-xs text-ink-muted">{quote.formulaLabel}</td>
                          <td className="py-2 pr-3 text-sm text-ink">{currency(quote.basePremium)}</td>
                          <td className="py-2 text-sm font-semibold text-ink">{currency(quote.premium)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
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
