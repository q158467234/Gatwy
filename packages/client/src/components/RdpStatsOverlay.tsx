import type { OverlayLevel, OverlayLine } from '../services/rdpLiveStats';

const LEVEL_CLASS: Record<OverlayLevel, string> = {
  ok: 'text-white',
  warn: 'text-yellow-300',
  bad: 'text-red-400',
};

/**
 * Connection statistics over the top-left corner of an RDP session. It ignores the pointer, so the
 * desktop underneath stays usable, and it is not part of the canvas, so recordings leave it out.
 */
export function RdpStatsOverlay({ lines }: { lines: OverlayLine[] }) {
  if (lines.length === 0) return null;
  return (
    <div
      className="absolute left-2 top-2 z-10 pointer-events-none select-none rounded bg-black/60 px-2 py-1 font-mono text-[11px] leading-[1.45] text-white shadow"
      aria-hidden="true"
    >
      {lines.map((line, i) => (
        <div key={i} className="whitespace-pre">
          {line.label && <span className="text-white/60 mr-2">{line.label}</span>}
          {line.parts.map((part, j) => (
            <span key={j} className={LEVEL_CLASS[part.level ?? 'ok']}>
              {j > 0 && <span className="text-white/40">{line.label ? '  ' : ' · '}</span>}
              {part.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
