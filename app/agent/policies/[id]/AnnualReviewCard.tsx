"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { scheduleAnnualReview, completeAnnualReview } from "./actions";
import { useI18n } from "@/components/i18n/LanguageProvider";

type Review = { id: string; dueAt: string; completedAt: string | null; notes: string | null };

export function AnnualReviewCard({ policyId, reviews }: { policyId: string; reviews: Review[] }) {
  const { copy, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const open = reviews.find((r) => !r.completedAt);
  const done = reviews.filter((r) => r.completedAt);
  const overdue = open != null && new Date(open.dueAt) < new Date();

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setMessage(null);
    start(async () => {
      const result = await fn();
      if (result.ok) { setNotes(""); router.refresh(); }
      else setMessage(result.message ?? copy("Erro.", "Error."));
    });
  }

  return (
    <section className="module-main-surface">
      <h2 className="text-base font-semibold text-ink">{copy("Revisão anual", "Annual review")}</h2>

      {open ? (
        <div className="mt-3 space-y-3">
          <p className={`text-sm ${overdue ? "text-danger" : "text-ink"}`}>
            {overdue ? copy("Atrasada — vencia", "Overdue — due") : copy("Próxima revisão", "Next review")} {new Date(open.dueAt).toLocaleDateString(locale)}
          </p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={copy("Notas da revisão (cobertura, beneficiários, mudanças)…", "Review notes (coverage, beneficiaries, changes)…")}
            rows={3}
            className="w-full rounded border border-border-steel bg-paper px-3 py-2 text-sm text-ink"
          />
          <Button
            variant="primary"
            disabled={pending}
            onClick={() => run(() => completeAnnualReview(open.id, notes))}
          >
            {copy("Concluir revisão", "Complete review")}
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-ink-muted">{copy("Nenhuma revisão agendada. Agende a próxima revisão anual desta apólice.", "No review scheduled. Schedule this policy's next annual review.")}</p>
          <Button variant="secondary" disabled={pending} onClick={() => run(() => scheduleAnnualReview(policyId))}>
            {copy("Agendar revisão anual", "Schedule annual review")}
          </Button>
        </div>
      )}

      {message && <p role="alert" className="mt-3 text-sm text-danger">{message}</p>}

      {done.length > 0 && (
        <ul className="mt-4 divide-y divide-border-steel border-t border-border-steel">
          {done.map((r) => (
            <li key={r.id} className="py-2.5">
              <p className="text-xs font-medium text-ink">
                <span className="text-success">✓</span> {new Date(r.completedAt!).toLocaleDateString(locale)}
              </p>
              {r.notes && <p className="text-xs text-ink-muted">{r.notes}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
