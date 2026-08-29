"use client";

const TABS = [
  { href: "/whatsapp", key: "inbox", label: "Inbox" },
  { href: "/whatsapp/broadcasts", key: "broadcasts", label: "Broadcasts" },
  { href: "/whatsapp/automations", key: "automations", label: "Automations" },
  { href: "/whatsapp/abandoned-carts", key: "carts", label: "Abandoned Carts" },
  { href: "/whatsapp/templates", key: "templates", label: "Templates" },
  { href: "/whatsapp/connection", key: "connection", label: "Connection" },
];

export default function WhatsAppTabs({ active }: { active: string }) {
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
