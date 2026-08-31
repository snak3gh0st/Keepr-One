"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { uploadPolicyDocument } from "./actions";
import { useI18n } from "@/components/i18n/LanguageProvider";

export function PolicyUploadForm({
  policyId,
  documentKind,
  label,
  pendingLabel,
}: {
  policyId: string;
  documentKind: "DOCUMENT" | "ILLUSTRATION";
  label: string;
  pendingLabel: string;
}) {
  const { copy } = useI18n();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <form
      action={async (formData: FormData) => {
        setSubmitting(true);
        setMessage(null);
        try {
          const result = await uploadPolicyDocument(formData);
          if (!result.ok) setMessage(result.message);
        } finally {
          setSubmitting(false);
        }
      }}
      className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border-steel p-4"
    >
      <input type="hidden" name="policyId" value={policyId} />
      <input type="hidden" name="documentKind" value={documentKind} />
      <input
        type="file"
        aria-label={copy("Selecionar arquivo", "Select file")}
        name="file"
        accept=".pdf,.png,.jpg,.jpeg"
        required
        disabled={submitting}
        className="text-sm text-ink-muted file:mr-3 file:rounded-md file:border-0 file:bg-teal-pale file:px-3 file:py-2 file:text-sm file:font-semibold file:text-teal disabled:opacity-50"
      />
      <Button type="submit" variant="secondary" disabled={submitting}>
        {submitting ? pendingLabel : label}
      </Button>
      {message && <p role="alert" className="w-full text-sm text-danger">{message}</p>}
    </form>
  );
}
