"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { scheduleAnnualReview, completeAnnualReview } from "./actions";

type Review = { id: string; dueAt: string; completedAt: string | null; notes: string | null };

export function AnnualReviewCard({ policyId, reviews }: { policyId: string; reviews: Review[] }) {
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
      else setMessage(result.message ?? "Erro.");
    });
  }

  return (
    <section className="rounded-md border border-border-steel bg-paper p-5">
      <h2 className="text-base font-semibold text-ink">Revisão anual</h2>

      {open ? (
        <div className="mt-3 space-y-3">
          <p className={`text-sm ${overdue ? "text-danger" : "text-ink"}`}>
            {overdue ? "Atrasada — vencia" : "Próxima revisão"} {new Date(open.dueAt).toLocaleDateString("pt-BR")}
          </p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notas da revisão (cobertura, beneficiários, mudanças)…"
            rows={3}
            className="w-full rounded border border-border-steel bg-paper px-3 py-2 text-sm text-ink"
          />
          <Button
            variant="primary"
            disabled={pending}
            onClick={() => run(() => completeAnnualReview(open.id, notes))}
          >
            Concluir revisão
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-ink-muted">Nenhuma revisão agendada. Agende a próxima revisão anual desta apólice.</p>
          <Button variant="secondary" disabled={pending} onClick={() => run(() => scheduleAnnualReview(policyId))}>
            Agendar revisão anual
          </Button>
        </div>
      )}

      {message && <p role="alert" className="mt-3 text-sm text-danger">{message}</p>}

      {done.length > 0 && (
        <ul className="mt-4 divide-y divide-border-steel border-t border-border-steel">
          {done.map((r) => (
            <li key={r.id} className="py-2.5">
              <p className="text-xs font-medium text-ink">
                <span className="text-success">✓</span> {new Date(r.completedAt!).toLocaleDateString("pt-BR")}
              </p>
              {r.notes && <p className="text-xs text-ink-muted">{r.notes}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
