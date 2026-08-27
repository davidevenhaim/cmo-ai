import "./globals.css";
import type { Metadata } from "next";
import Nav from "./components/Nav";
import CommandBar from "./components/CommandBar";

export const metadata: Metadata = {
  title: "AI CMO — Luminesce",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header
          style={{
            borderBottom: "1px solid #e5e5e5",
            background: "#fff",
          }}
        >
          <div
            style={{
              maxWidth: 1100,
              margin: "0 auto",
              padding: "0 2rem",
              display: "flex",
              alignItems: "center",
              gap: "1.5rem",
            }}
          >
            <a
              href="/today"
              style={{
                fontWeight: 800,
                fontSize: "0.9rem",
                color: "#1a1a1a",
                textDecoration: "none",
                whiteSpace: "nowrap",
              }}
            >
              AI CMO
            </a>
            <Nav />
          </div>
        </header>
        <main
          style={{ maxWidth: 1100, margin: "0 auto", padding: "1.5rem 2rem" }}
        >
          <CommandBar />
          {children}
        </main>
      </body>
    </html>
  );
}
