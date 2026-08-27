"use client";

import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/today", label: "Today" },
  { href: "/content", label: "Content" },
  { href: "/calendar", label: "Calendar" },
  { href: "/market", label: "Market" },
  { href: "/revenue", label: "Revenue" },
  { href: "/customers", label: "Customers" },
  { href: "/analytics", label: "Analytics" },
  { href: "/connections", label: "Connections" },
  { href: "/settings", label: "Settings" },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav
      style={{
        display: "flex",
        gap: "0.25rem",
        flexWrap: "wrap",
        padding: "0.6rem 0",
      }}
    >
      {LINKS.map(({ href, label }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <a
            key={href}
            href={href}
            style={{
              padding: "0.35rem 0.8rem",
              borderRadius: 6,
              fontSize: "0.8rem",
              fontWeight: 600,
              textDecoration: "none",
              color: active ? "#fff" : "#444",
              background: active ? "#1a1a1a" : "transparent",
            }}
          >
            {label}
          </a>
        );
      })}
    </nav>
  );
}
