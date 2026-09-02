"use client";

import { useState } from "react";
import { createCommissionPlan } from "./actions";
import { Field, Input, Select } from "@/components/Field";
import { Button } from "@/components/Button";
import { RANKS } from "@/lib/ranks";
import { useI18n } from "@/components/i18n/LanguageProvider";

export function NewPlanForm() {
  const { copy } = useI18n();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleSubmit(formData: FormData) {
    setSubmitting(true);
    setMessage(null);
    const result = await createCommissionPlan(formData);
    setSubmitting(false);
    setMessage(
      result.ok
        ? { ok: true, text: copy("Plano salvo.", "Plan saved.") }
        : { ok: false, text: result.message },
    );
  }

  return (
    <div>
      <form action={handleSubmit} className="flex flex-wrap items-end gap-3">
        <Field label={copy('Cargo', 'Rank')}>
          <Select name="rank" required className="w-40" defaultValue="">
            <option value="" disabled>
              {copy('Selecione…', 'Select…')}
            </option>
            {RANKS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={copy('Nível', 'Level')}>
          <Input name="downlineLevel" type="number" min={1} placeholder="1" required className="w-24" />
        </Field>
        <Field label={copy('% sobrecomissão', '% override')}>
          <Input
            name="overridePercent"
            type="number"
            step="0.01"
            min={0}
            max={100}
            placeholder={copy('10,00', '10.00')}
            required
            className="w-28"
          />
        </Field>
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? copy("Salvando…", "Saving…") : copy("Salvar", "Save")}
        </Button>
      </form>
      {message && (
        <p role="alert" className={`mt-2 text-sm ${message.ok ? "text-success" : "text-danger"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
