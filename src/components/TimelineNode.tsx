import { Check } from 'lucide-react';

/**
 * The status dot and the connector between dots, shared by both phase timelines —
 * mission phases on the home screen (`PhaseTimeline` in LowerSections.tsx) and learning
 * path phases in Power Up (`PathTimeline.tsx`). The two used to carry a copy each, with
 * the rail's offset hand-tuned per file; both were off-centre, in different directions.
 *
 * ── Why the connector is per-row, not one rail down the list ──────────────────
 * A single absolutely-positioned rail has to guess where the first and last dot centres
 * are, and that guess breaks the moment a row is taller than its dot (a phase with a
 * description, a wrapped title). Instead each row draws the segment *below* its own dot:
 * it starts at that dot's centre and overshoots the row's bottom edge by exactly the
 * list's flex `gap` plus half a dot, which lands it on the next dot's centre whatever
 * the rows in between are doing. Horizontal centring is likewise derived from
 * `NODE_SIZE` rather than typed in, so the line cannot drift off the dots again.
 *
 * What a caller has to hold up its end of:
 *   - the row is `position: relative` and `align-items: flex-start`
 *   - the node is the row's first child, with no left or top offset of its own
 *   - the last row gets no connector (nothing below it to reach)
 */

export type PhaseStatus = 'pending' | 'live' | 'completed';

export const PHASE_COLORS: Record<PhaseStatus, string> = {
  pending: 'rgba(255,255,255,0.25)',
  live: 'var(--accent)',
  completed: '#34D399',
};

/** Dot diameter. The connector centres itself on this, so the two agree by construction. */
export const NODE_SIZE = 18;

const RAIL_COLOR = 'rgba(255,255,255,0.10)';

export function TimelineNode({ status, disabled, interactive = true, title, onClick }: {
  status: PhaseStatus;
  disabled?: boolean;
  /** False for a read-only timeline — the dot still renders, it just isn't a control. */
  interactive?: boolean;
  title?: string;
  onClick?: () => void;
}) {
  const color = PHASE_COLORS[status];
  const pending = status === 'pending';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !interactive}
      title={title}
      style={{
        // Above the connector so the line reads as passing behind the dot, not over it.
        position: 'relative',
        zIndex: 1,
        width: NODE_SIZE,
        height: NODE_SIZE,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        padding: 0,
        cursor: interactive && !disabled ? 'pointer' : 'default',
        background: pending ? '#14141a' : color,
        border: `1.5px solid ${pending ? 'rgba(255,255,255,0.25)' : color}`,
        boxShadow: status === 'live' ? `0 0 9px -1px ${color}` : undefined,
      }}
    >
      {status === 'completed' && <Check className="w-2.5 h-2.5" style={{ color: 'rgba(0,0,0,0.8)' }} />}
    </button>
  );
}

/**
 * The segment from this row's dot down to the next one. `gap` must be the flex gap of
 * the list holding the rows — that is the distance the line has to cross before it
 * reaches the next row's top edge, and another half-dot puts it on that dot's centre.
 */
export function TimelineConnector({ gap }: { gap: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: NODE_SIZE / 2,
        transform: 'translateX(-50%)',
        top: NODE_SIZE / 2,
        bottom: -(gap + NODE_SIZE / 2),
        width: 1,
        background: RAIL_COLOR,
        pointerEvents: 'none',
      }}
    />
  );
}

/**
 * For the line of text sitting beside a node. The row is top-aligned so the connector's
 * geometry stays constant; this puts a one-line label back on the dot's centre without
 * giving that up.
 */
export const nodeAlignedLine: React.CSSProperties = {
  minHeight: NODE_SIZE,
  display: 'flex',
  alignItems: 'center',
};
