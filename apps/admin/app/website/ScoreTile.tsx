import { card, sectionLabel } from "../components/ui";

/**
 * A single measured Lighthouse category score.
 *
 * Colour follows Lighthouse's own published bands so the reading matches what
 * the owner sees in Chrome. A null score renders as "—", never as 0 — an
 * unmeasured category must not look like a terrible one.
 */
export default function ScoreTile({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  const color =
    value == null
      ? "#888"
      : value >= 90
        ? "#1a7a3d"
        : value >= 50
          ? "#8a6d1a"
          : "#a02a2a";

  return (
    <div style={{ ...card, padding: "0.9rem 1.1rem", minWidth: 150, flex: 1 }}>
      <div style={{ ...sectionLabel, marginBottom: "0.35rem" }}>{label}</div>
      <div style={{ fontSize: "1.7rem", fontWeight: 700, color }}>
        {value == null ? "—" : Math.round(value)}
      </div>
      <div style={{ fontSize: "0.72rem", color: "#888", marginTop: "0.2rem" }}>
        {value == null ? "not measured" : "measured"}
      </div>
    </div>
  );
}
