"use client";

const TABS = [
  { href: "/website", key: "overview", label: "Overview" },
  { href: "/website/pages", key: "pages", label: "Pages" },
  { href: "/website/issues", key: "issues", label: "Issues" },
  { href: "/website/recommendations", key: "recommendations", label: "Recommendations" },
  { href: "/website/history", key: "history", label: "History" },
  { href: "/website/settings", key: "settings", label: "Settings" },
];

export default function WebsiteTabs({ active }: { active: string }) {
  return (
    <div
      style={{
        display: "flex",
        gap: "0.4rem",
        flexWrap: "wrap",
        marginBottom: "1rem",
        borderBottom: "1px solid #e5e5e5",
        paddingBottom: "0.6rem",
      }}
    >
      {TABS.map((t) => (
        <a
          key={t.key}
          href={t.href}
          style={{
            padding: "0.3rem 0.7rem",
            borderRadius: 6,
            fontSize: "0.78rem",
            fontWeight: 600,
            textDecoration: "none",
            color: active === t.key ? "#fff" : "#444",
            background: active === t.key ? "#1a1a1a" : "#f2f2f0",
          }}
        >
          {t.label}
        </a>
      ))}
    </div>
  );
}
