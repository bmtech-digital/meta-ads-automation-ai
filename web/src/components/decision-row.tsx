import Link from "next/link";
import type { AgentDecision, DecisionType } from "@/lib/db/types";
import { relativeHe } from "@/lib/approvals-fmt";

export const DECISION_STYLES: Record<DecisionType, string> = {
  observation: "bg-slate-200 text-slate-800",
  diagnosis: "bg-blue-100 text-blue-800",
  proposal: "bg-green-100 text-green-800",
  rejection: "bg-red-100 text-red-800",
  skip: "bg-gray-100 text-gray-700",
  execution: "bg-purple-100 text-purple-800",
  error: "bg-red-200 text-red-900",
};

export const DECISION_LABEL_HE: Record<DecisionType, string> = {
  observation: "תצפית",
  diagnosis: "אבחון",
  proposal: "הצעה",
  rejection: "דחייה",
  skip: "דילוג",
  execution: "ביצוע",
  error: "שגיאה",
};

export function DecisionRow({
  d,
  showRunLink = true,
  showApprovalLink = false,
}: {
  d: AgentDecision;
  showRunLink?: boolean;
  showApprovalLink?: boolean;
}) {
  return (
    <li className="rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${DECISION_STYLES[d.decision_type]}`}
        >
          {DECISION_LABEL_HE[d.decision_type]}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {d.graph_name}/{d.node_name}
        </span>
        <span className="text-xs text-muted-foreground">
          {relativeHe(d.created_at)}
        </span>
        {d.latency_ms ? (
          <span className="text-xs text-muted-foreground">
            {d.latency_ms}ms
          </span>
        ) : null}
        {d.confidence != null ? (
          <span className="text-xs text-muted-foreground">
            confidence {Math.round(d.confidence * 100)}%
          </span>
        ) : null}
        {d.campaign_id ? (
          <Link
            href={`/campaigns#campaign-${d.campaign_id}`}
            className="text-xs text-primary underline-offset-2 hover:underline"
          >
            קמפיין ↗
          </Link>
        ) : null}
        {showApprovalLink && d.related_approval_id ? (
          <Link
            href={`/approvals/${d.related_approval_id}`}
            className="text-xs text-primary underline-offset-2 hover:underline"
          >
            הצעה ↗
          </Link>
        ) : null}
        {showRunLink && d.run_id ? (
          <Link
            href={`/runs/${d.run_id}`}
            className="text-xs text-primary underline-offset-2 hover:underline"
          >
            ריצה ↗
          </Link>
        ) : null}
      </div>
      <p className="mt-2 text-sm font-medium">{d.summary}</p>
      {d.rationale ? (
        <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
          {d.rationale}
        </p>
      ) : null}
      {d.guardrail_violations && d.guardrail_violations.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {d.guardrail_violations.map((g) => (
            <span
              key={g}
              className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-900"
            >
              🛡 {g}
            </span>
          ))}
        </div>
      ) : null}
      {d.inputs || d.outputs ? (
        <div className="mt-2 flex flex-col gap-2">
          {d.inputs ? (
            <details className="rounded border p-2 text-xs">
              <summary className="cursor-pointer">inputs</summary>
              <pre dir="ltr" className="mt-1 overflow-auto text-left font-mono">
                {JSON.stringify(d.inputs, null, 2)}
              </pre>
            </details>
          ) : null}
          {d.outputs ? (
            <details className="rounded border p-2 text-xs">
              <summary className="cursor-pointer">outputs</summary>
              <pre dir="ltr" className="mt-1 overflow-auto text-left font-mono">
                {JSON.stringify(d.outputs, null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
