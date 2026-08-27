import { fetchJson } from "../lib/api";
import {
  card,
  sectionLabel,
  StatusBadge,
  EmptyState,
  ErrorState,
  PageHeader,
  fmtDate,
} from "../components/ui";
import CreateContentForm from "./CreateContentForm";
import DraftActions from "./DraftActions";

export const dynamic = "force-dynamic";

interface Brief {
  id: string;
  topic: string;
  objective: string;
  channel: string;
  format: string;
  angle: string;
  status: string;
  opportunityId: string | null;
  searchOpportunityId: string | null;
  marketOpportunityId: string | null;
  createdAt: string;
}

interface Draft {
  id: string;
  briefId: string;
  version: number;
  channel: string;
  format: string;
  headline: string | null;
  caption: string | null;
  callToAction: string | null;
  hashtags: string[];
  status: string;
  criticScore: number | null;
  criticEvaluation: { issues?: string[]; passesReview?: boolean } | null;
  approvalId: string | null;
  createdAt: string;
  brief: { topic: string; channel: string } | null;
  publishRequests: Array<{
    id: string;
    provider: string;
    status: string;
    scheduledAt: string | null;
    publication: {
      status: string;
      remoteUrl: string | null;
      publishedAt: string | null;
    } | null;
  }>;
}

const VIEWS = [
  { key: "briefs", label: "Ideas / Briefs" },
  { key: "drafts", label: "Drafts" },
  { key: "review", label: "Awaiting review" },
  { key: "approved", label: "Approved" },
  { key: "published", label: "Published" },
  { key: "failed", label: "Failed" },
] as const;

type ViewKey = (typeof VIEWS)[number]["key"];

function filterDrafts(drafts: Draft[], view: ViewKey): Draft[] {
  switch (view) {
    case "drafts":
      return drafts.filter((d) => d.status === "GENERATED");
    case "review":
      return drafts.filter((d) => d.status === "PENDING_REVIEW");
    case "approved":
      return drafts.filter((d) => d.status === "APPROVED");
    case "published":
      return drafts.filter((d) =>
        d.publishRequests.some((r) => r.publication?.status === "LIVE"),
      );
    case "failed":
      return drafts.filter(
        (d) =>
          d.publishRequests.some(
            (r) => r.status === "FAILED" || r.publication?.status === "FAILED",
          ) || d.status === "REJECTED",
      );
    default:
      return drafts;
  }
}

function DraftCard({ d }: { d: Draft }) {
  const issues = d.criticEvaluation?.issues ?? [];
  const openRequest = d.publishRequests.find(
    (r) => !["FAILED"].includes(r.status) && r.publication?.status !== "FAILED",
  );
  return (
    <div style={{ ...card, padding: "0.9rem 1.1rem" }}>
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>
          {d.headline ?? d.brief?.topic ?? `${d.channel} ${d.format}`}
        </span>
        <StatusBadge status={d.status} />
        <span style={{ fontSize: "0.68rem", color: "#888" }}>
          {d.channel} · {d.format} · v{d.version}
          {d.criticScore != null &&
            ` · critic ${(d.criticScore * 100).toFixed(0)}%`}
        </span>
      </div>
      {d.caption && (
        <p
          style={{
            fontSize: "0.82rem",
            color: "#444",
            marginTop: "0.35rem",
            whiteSpace: "pre-wrap",
          }}
        >
          {d.caption.length > 400 ? `${d.caption.slice(0, 400)}…` : d.caption}
        </p>
      )}
      {d.callToAction && (
        <p style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.3rem" }}>
          CTA: {d.callToAction}
        </p>
      )}
      {d.hashtags.length > 0 && (
        <p
          style={{ fontSize: "0.72rem", color: "#2a5aa0", marginTop: "0.3rem" }}
        >
          {d.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}
        </p>
      )}
      {issues.length > 0 && (
        <ul
          style={{
            fontSize: "0.72rem",
            color: "#8a6d1a",
            marginTop: "0.4rem",
            paddingLeft: "1.1rem",
          }}
        >
          {issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
      {d.publishRequests.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: "0.7rem",
            marginTop: "0.4rem",
            fontSize: "0.72rem",
            color: "#888",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {d.publishRequests.map((r) => (
            <span key={r.id} style={{ display: "flex", gap: "0.3rem" }}>
              {r.provider}:{" "}
              <StatusBadge status={r.publication?.status ?? r.status} />
              {r.scheduledAt && ` scheduled ${fmtDate(r.scheduledAt)}`}
              {r.publication?.remoteUrl && (
                <a
                  href={r.publication.remoteUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#2a5aa0" }}
                >
                  view ↗
                </a>
              )}
            </span>
          ))}
        </div>
      )}
      <DraftActions
        draftId={d.id}
        briefId={d.briefId}
        approvalId={d.approvalId}
        status={d.status}
        channel={d.channel}
        hasOpenPublishRequest={Boolean(openRequest)}
      />
    </div>
  );
}

export default async function ContentPage({
  searchParams,
}: {
  searchParams: { view?: string };
}) {
  const view: ViewKey = (VIEWS.find((v) => v.key === searchParams.view)?.key ??
    "review") as ViewKey;

  const [briefs, drafts] = await Promise.all([
    fetchJson<Brief[]>("/content/briefs"),
    fetchJson<Draft[]>("/content/drafts"),
  ]);

  if (!drafts && !briefs) {
    return (
      <ErrorState message="Backend unreachable — content workspace unavailable." />
    );
  }

  const counts: Record<ViewKey, number> = {
    briefs: briefs?.length ?? 0,
    drafts: filterDrafts(drafts ?? [], "drafts").length,
    review: filterDrafts(drafts ?? [], "review").length,
    approved: filterDrafts(drafts ?? [], "approved").length,
    published: filterDrafts(drafts ?? [], "published").length,
    failed: filterDrafts(drafts ?? [], "failed").length,
  };

  const visible = filterDrafts(drafts ?? [], view);

  return (
    <div>
      <PageHeader
        title="Content"
        subtitle="Drafts move through the M7.8 lifecycle: generate → review → approve → publish request → publish. Nothing publishes without approval."
        right={<CreateContentForm />}
      />

      <div
        style={{
          display: "flex",
          gap: "0.4rem",
          flexWrap: "wrap",
          marginBottom: "1rem",
        }}
      >
        {VIEWS.map((v) => (
          <a
            key={v.key}
            href={`/content?view=${v.key}`}
            style={{
              padding: "0.3rem 0.75rem",
              borderRadius: 6,
              fontSize: "0.78rem",
              fontWeight: 600,
              textDecoration: "none",
              border: "1px solid",
              borderColor: view === v.key ? "#1a1a1a" : "#e0e0dc",
              background: view === v.key ? "#1a1a1a" : "#fff",
              color: view === v.key ? "#fff" : "#555",
            }}
          >
            {v.label} ({counts[v.key]})
          </a>
        ))}
      </div>

      {view === "briefs" ? (
        !briefs || briefs.length === 0 ? (
          <EmptyState
            message="No content briefs."
            hint='Use "Create content" above, the command bar, or Create Content on a market opportunity.'
          />
        ) : (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}
          >
            {briefs.map((b) => (
              <div key={b.id} style={{ ...card, padding: "0.9rem 1.1rem" }}>
                <div
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>
                    {b.topic}
                  </span>
                  <StatusBadge status={b.status} />
                  <span style={{ fontSize: "0.68rem", color: "#888" }}>
                    {b.channel} · {b.format} · {fmtDate(b.createdAt)}
                    {(b.opportunityId ??
                      b.searchOpportunityId ??
                      b.marketOpportunityId) &&
                      " · from market opportunity"}
                  </span>
                </div>
                <p
                  style={{
                    fontSize: "0.8rem",
                    color: "#555",
                    marginTop: "0.3rem",
                  }}
                >
                  {b.objective} — {b.angle}
                </p>
              </div>
            ))}
          </div>
        )
      ) : visible.length === 0 ? (
        <EmptyState
          message={`Nothing in "${VIEWS.find((v) => v.key === view)?.label}".`}
          hint={
            view === "review"
              ? "Drafts appear here when generation completes and creates a pending approval."
              : undefined
          }
        />
      ) : (
        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}
        >
          {visible.map((d) => (
            <DraftCard key={d.id} d={d} />
          ))}
        </div>
      )}

      <div style={{ ...sectionLabel, marginTop: "1.5rem" }}>Creative</div>
      <EmptyState
        message="Creative generation is not configured."
        hint="No AI media provider is integrated. Placeholder images are never generated."
      />
    </div>
  );
}
