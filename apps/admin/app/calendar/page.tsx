import { fetchJson } from "../lib/api";
import {
  card,
  sectionLabel,
  StatusBadge,
  EmptyState,
  ErrorState,
  PageHeader,
  fmtDate,
  tableStyle,
  th,
  td,
} from "../components/ui";
import RequestActions from "./RequestActions";

export const dynamic = "force-dynamic";

interface CalendarItem {
  id: string;
  type: "content_draft" | "publish_request";
  title: string;
  channel: string;
  provider?: string;
  status: string;
  scheduledAt?: string;
  publishedAt?: string;
  remoteUrl?: string;
  contentDraftId?: string;
  publishRequestId?: string;
  createdAt: string;
}

interface PublishRequest {
  id: string;
  status: string;
  scheduledAt: string | null;
}

function mondayOf(dateStr?: string): Date {
  const d = dateStr ? new Date(dateStr) : new Date();
  if (isNaN(d.getTime())) return mondayOf(undefined);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function itemTime(i: CalendarItem): Date {
  return new Date(i.scheduledAt ?? i.publishedAt ?? i.createdAt);
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: { start?: string };
}) {
  const weekStart = mondayOf(searchParams.start);
  const prev = new Date(weekStart);
  prev.setDate(prev.getDate() - 7);
  const next = new Date(weekStart);
  next.setDate(next.getDate() + 7);

  const [week, requests] = await Promise.all([
    fetchJson<CalendarItem[]>(`/calendar/week?start=${iso(weekStart)}`),
    fetchJson<PublishRequest[]>("/publishing/requests"),
  ]);

  if (!week) {
    return <ErrorState message="Backend unreachable — calendar unavailable." />;
  }

  const requestById = new Map((requests ?? []).map((r) => [r.id, r]));

  const days: Date[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const failed = week.filter((i) => i.status === "FAILED");

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle="Week view of drafts and publish requests. Scheduling never bypasses approval or safety checks."
        right={
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <a
              href={`/calendar?start=${iso(prev)}`}
              style={{ fontSize: "0.8rem", color: "#2a5aa0", fontWeight: 600 }}
            >
              ← prev
            </a>
            <span style={{ fontSize: "0.8rem", color: "#555" }}>
              week of {iso(weekStart)}
            </span>
            <a
              href={`/calendar?start=${iso(next)}`}
              style={{ fontSize: "0.8rem", color: "#2a5aa0", fontWeight: 600 }}
            >
              next →
            </a>
          </div>
        }
      />

      {failed.length > 0 && (
        <ErrorState
          message={`${failed.length} failed publication${failed.length === 1 ? "" : "s"} this week — details below.`}
        />
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: "0.5rem",
          marginTop: "0.75rem",
        }}
      >
        {days.map((day) => {
          const dayItems = week
            .filter((i) => iso(itemTime(i)) === iso(day))
            .sort((a, b) => itemTime(a).getTime() - itemTime(b).getTime());
          const isToday = iso(day) === iso(new Date());
          return (
            <div
              key={iso(day)}
              style={{
                ...card,
                padding: "0.6rem",
                minHeight: 140,
                borderColor: isToday ? "#1a1a1a" : undefined,
              }}
            >
              <div
                style={{
                  fontSize: "0.68rem",
                  fontWeight: 700,
                  color: isToday ? "#1a1a1a" : "#888",
                  marginBottom: "0.4rem",
                }}
              >
                {day.toLocaleDateString("en-US", { weekday: "short" })}{" "}
                {day.getDate()}
              </div>
              {dayItems.length === 0 ? (
                <div style={{ fontSize: "0.68rem", color: "#ccc" }}>—</div>
              ) : (
                dayItems.map((i) => (
                  <div
                    key={`${i.type}-${i.id}`}
                    style={{
                      fontSize: "0.7rem",
                      marginBottom: "0.45rem",
                      paddingBottom: "0.45rem",
                      borderBottom: "1px solid #f0f0ee",
                    }}
                  >
                    <div style={{ fontWeight: 600, color: "#333" }}>
                      {i.title.length > 40
                        ? `${i.title.slice(0, 40)}…`
                        : i.title}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: "0.3rem",
                        alignItems: "center",
                        flexWrap: "wrap",
                        marginTop: "0.2rem",
                      }}
                    >
                      <StatusBadge status={i.status} />
                      <span style={{ color: "#999" }}>
                        {i.channel}
                        {i.provider ? ` · ${i.provider}` : ""}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>

      <div style={{ ...sectionLabel, marginTop: "1.25rem" }}>
        All items this week
      </div>
      {week.length === 0 ? (
        <EmptyState
          message="Nothing scheduled or created this week."
          hint="Approve a draft in Content, then create and schedule a publish request."
        />
      ) : (
        <div style={card}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Title</th>
                <th style={th}>Type</th>
                <th style={th}>Channel</th>
                <th style={th}>Status</th>
                <th style={th}>When</th>
                <th style={th}>Link</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {week.map((i) => {
                const req = i.publishRequestId
                  ? requestById.get(i.publishRequestId)
                  : undefined;
                return (
                  <tr key={`${i.type}-${i.id}`}>
                    <td style={td}>{i.title}</td>
                    <td style={td}>
                      {i.type === "publish_request" ? "publish" : "draft"}
                    </td>
                    <td style={td}>
                      {i.channel}
                      {i.provider ? ` · ${i.provider}` : ""}
                    </td>
                    <td style={td}>
                      <StatusBadge status={i.status} />
                    </td>
                    <td style={td}>
                      {fmtDate(i.scheduledAt ?? i.publishedAt ?? i.createdAt)}
                    </td>
                    <td style={td}>
                      {i.remoteUrl ? (
                        <a
                          href={i.remoteUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "#2a5aa0" }}
                        >
                          view ↗
                        </a>
                      ) : i.contentDraftId ? (
                        <a href="/content" style={{ color: "#2a5aa0" }}>
                          open draft
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={td}>
                      {i.publishRequestId && req ? (
                        <RequestActions
                          publishRequestId={i.publishRequestId}
                          status={req.status}
                          scheduledAt={req.scheduledAt}
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
