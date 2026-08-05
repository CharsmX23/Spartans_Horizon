import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, X, Trash2, CheckCircle2, Circle, ChevronUp, ChevronDown, ChevronRight,
  BookMarked, Sparkles, Clock, Users, Lock, Camera, Loader2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import {
  LearningPath, LearningModule, LearningTask, ProofType, PROOF_TYPES,
  loadPaths, createPath, deletePath,
  createModule, updateModule, deleteModule,
  createTask, deleteTask,
  setTaskDone, reorder, pathProgress,
} from '../lib/learning';
import { verifyProof, validateProofFile } from '../lib/proof';
import PathTimeline from './PathTimeline';

/**
 * Power Up — manual CRUD over learning paths, modules, and tasks.
 *
 * Paths are built by hand (syllabus generation is still Phase 4). Tasks can be ticked
 * two ways: manually, or by submitting a photo that the `verify-proof` Edge Function
 * judges with Gemini — a passing verdict ticks the task server-side via set_task_done().
 *
 * Squadmates' paths are visible but read-only. RLS and the column grants enforce that;
 * the UI only reflects it.
 */

const PROOF_COLORS: Record<ProofType, string> = {
  text: '#38BDF8',
  link: '#A78BFA',
  photo: '#F5A524',
};

const panel: React.CSSProperties = {
  background: 'rgba(255,255,255,0.045)',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: 16,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: 10,
  padding: '8px 10px',
  color: '#fff',
  fontSize: 13,
  outline: 'none',
};

type Run = (action: () => Promise<{ error: string | null }>) => Promise<boolean>;

export default function PowerUpPage() {
  const { user } = useAuth();
  const myId = user?.id ?? null;

  const [paths, setPaths] = useState<LearningPath[]>([]);
  const [owners, setOwners] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showNewPath, setShowNewPath] = useState(false);
  // Which path has its timeline pulled open. One at a time, so the list stays scannable.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addingModuleTo, setAddingModuleTo] = useState<string | null>(null);
  const [editingModule, setEditingModule] = useState<string | null>(null);
  const [addingTaskTo, setAddingTaskTo] = useState<string | null>(null);

  // Photo-proof verification. The pending task is held only long enough to attach the
  // picked file to it; the image itself never leaves this call chain.
  const proofInputRef = useRef<HTMLInputElement>(null);
  const pendingTask = useRef<LearningTask | null>(null);
  const [verifyingTaskId, setVerifyingTaskId] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<{ passed: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data, error: loadError } = await loadPaths();
    if (loadError) {
      setError(loadError);
      setLoading(false);
      return;
    }
    const rows = data ?? [];
    setPaths(rows);
    setSelectedId((current) =>
      current && rows.some((p) => p.id === current) ? current : rows[0]?.id ?? null,
    );

    // Squadmates' usernames, for attribution on shared paths.
    const otherIds = [...new Set(rows.map((p) => p.user_id))].filter((id) => id !== myId);
    if (otherIds.length > 0) {
      const { data: people } = await supabase.from('users').select('id, username').in('id', otherIds);
      if (people) setOwners(Object.fromEntries(people.map((p) => [p.id, p.username as string])));
    }
    setLoading(false);
  }, [myId]);

  useEffect(() => { void load(); }, [load]);

  /** Every mutation funnels through here so failures surface instead of dying silently. */
  const run = useCallback<Run>(async (action) => {
    setBusy(true);
    setError(null);
    const { error: actionError } = await action();
    if (actionError) setError(actionError);
    else await load();
    setBusy(false);
    return !actionError;
  }, [load]);

  const selected = useMemo(
    () => paths.find((p) => p.id === selectedId) ?? null,
    [paths, selectedId],
  );
  const isOwner = selected?.user_id === myId;

  /** Opens the picker for a task; the file lands in handleProofSelected below. */
  const startProof = useCallback((task: LearningTask) => {
    pendingTask.current = task;
    setVerdict(null);
    setError(null);
    proofInputRef.current?.click();
  }, []);

  async function handleProofSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const task = pendingTask.current;
    // Reset immediately so picking the same file twice still fires onChange.
    if (proofInputRef.current) proofInputRef.current.value = '';
    if (!file || !task) return;

    const invalid = validateProofFile(file);
    if (invalid) { setError(invalid); return; }

    setVerifyingTaskId(task.id);
    const result = await verifyProof({
      file,
      context: task.label,
      kind: 'task',
      taskId: task.id,
    });
    setVerifyingTaskId(null);
    pendingTask.current = null;

    if (!result.ok) { setError(result.message); return; }

    const passed = result.verdict.verdict === 'progress';
    setVerdict({ passed, text: result.verdict.evaluation_text });
    // The Edge Function already ticked it via set_task_done(); reload to reflect that.
    if (passed && result.verdict.task_confirmed) await load();
  }

  if (loading) {
    return <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, padding: 24 }}>Loading paths…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h1 style={{ color: '#fff', fontSize: 22, fontWeight: 700, margin: 0 }}>Power Up</h1>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 3 }}>
            Build a learning path by hand — modules, tasks, and the proof each one needs.
          </p>
        </div>
        <button
          onClick={() => setShowNewPath(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
            borderRadius: 11, background: 'var(--accent)', color: '#fff',
            fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', flexShrink: 0,
          }}
        >
          <Plus className="w-4 h-4" /> New Path
        </button>
      </header>

      {error && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          fontSize: 12, color: '#fca5a5', background: 'rgba(239,68,68,0.10)',
          border: '1px solid rgba(239,68,68,0.30)', borderRadius: 10, padding: '8px 12px',
        }}>
          <span style={{ flex: 1 }}>{error}</span>
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {verdict && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, borderRadius: 10,
          padding: '10px 12px',
          color: verdict.passed ? '#86efac' : '#fca5a5',
          background: verdict.passed ? 'rgba(52,211,153,0.10)' : 'rgba(239,68,68,0.10)',
          border: `1px solid ${verdict.passed ? 'rgba(52,211,153,0.30)' : 'rgba(239,68,68,0.30)'}`,
        }}>
          <span style={{ flex: 1 }}>
            <strong>{verdict.passed ? 'Proof accepted — task ticked.' : 'Proof rejected.'}</strong>{' '}
            {verdict.text}
          </span>
          <button
            onClick={() => setVerdict(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* One picker for every task; the image is read in memory and never stored. */}
      <input
        ref={proofInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleProofSelected}
      />

      {showNewPath && (
        <NewPathForm
          busy={busy}
          onCancel={() => setShowNewPath(false)}
          onSubmit={async (values) => {
            const ok = await run(async () => {
              const { data, error: createError } = await createPath(values);
              // Selected but not expanded: every path starts collapsed, including a
              // brand new one. Opening the timeline is always a deliberate press.
              if (data) setSelectedId(data.id);
              return { error: createError };
            });
            if (ok) setShowNewPath(false);
          }}
        />
      )}

      {paths.length === 0 && !showNewPath && (
        <div style={{ ...panel, padding: 40, textAlign: 'center' }}>
          <BookMarked className="w-8 h-8" style={{ color: 'rgba(255,255,255,0.25)', margin: '0 auto 12px' }} />
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 15, fontWeight: 600 }}>No learning paths yet</div>
          <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: 4 }}>
            Create one to start tracking modules and tasks.
          </p>
        </div>
      )}

      {paths.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {paths.map((p) => (
            <PathRow
              key={p.id}
              path={p}
              active={p.id === selectedId}
              mine={p.user_id === myId}
              ownerName={owners[p.user_id]}
              expanded={expandedId === p.id}
              onSelect={() => setSelectedId(p.id)}
              onToggle={() => setExpandedId((current) => (current === p.id ? null : p.id))}
            />
          ))}
        </div>
      )}

      {selected && (
        <PathDetail
          key={selected.id}
          path={selected}
          isOwner={!!isOwner}
          ownerName={owners[selected.user_id]}
          busy={busy}
          run={run}
          addingModuleTo={addingModuleTo}
          setAddingModuleTo={setAddingModuleTo}
          editingModule={editingModule}
          setEditingModule={setEditingModule}
          addingTaskTo={addingTaskTo}
          setAddingTaskTo={setAddingTaskTo}
          onVerifyTask={startProof}
          verifyingTaskId={verifyingTaskId}
        />
      )}
    </div>
  );
}

/* ─────────────────────────── Path row ───────────────────────────
 * One path in the picker. The body selects it (the modules below follow); the chevron
 * pulls its timeline open in place, the same gesture as a mission card on the home
 * screen. The timeline lives here rather than in PathDetail so it belongs to the path
 * you pressed, not to whatever happens to be selected.
 */

function PathRow({ path, active, mine, ownerName, expanded, onSelect, onToggle }: {
  path: LearningPath;
  active: boolean;
  mine: boolean;
  ownerName?: string;
  expanded: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const { percent } = pathProgress(path);

  return (
    <div style={{
      ...panel,
      padding: 12,
      background: active ? 'var(--accent-soft)' : 'rgba(255,255,255,0.04)',
      border: `1px solid ${active ? 'var(--accent)' : 'rgba(255,255,255,0.10)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={onToggle}
          title={expanded ? 'Hide timeline' : 'Show timeline'}
          style={{
            width: 28, height: 28, borderRadius: 9, display: 'grid', placeItems: 'center',
            flexShrink: 0, cursor: 'pointer',
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.7)',
          }}
        >
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>

        <button
          onClick={onSelect}
          style={{
            flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none',
            padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          {!mine && <Users className="w-3.5 h-3.5" style={{ color: 'rgba(255,255,255,0.5)', flexShrink: 0 }} />}
          <span style={{
            fontSize: 13, fontWeight: active ? 600 : 500,
            color: active ? '#fff' : 'rgba(255,255,255,0.7)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {path.title}
          </span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', flexShrink: 0 }}>
            {mine ? `${percent}%` : `@${ownerName ?? '…'}`}
          </span>
        </button>
      </div>

      {/* Mounted only while open, so a collapsed path costs nothing and shows nothing —
          no query, no error banner, just the chevron. */}
      {expanded && <PathTimeline path={path} isOwner={mine} />}
    </div>
  );
}

/* ─────────────────────────── Path detail ─────────────────────────── */

interface DetailProps {
  path: LearningPath;
  isOwner: boolean;
  ownerName?: string;
  busy: boolean;
  run: Run;
  addingModuleTo: string | null;
  setAddingModuleTo: (v: string | null) => void;
  editingModule: string | null;
  setEditingModule: (v: string | null) => void;
  addingTaskTo: string | null;
  setAddingTaskTo: (v: string | null) => void;
  onVerifyTask: (task: LearningTask) => void;
  verifyingTaskId: string | null;
}

function PathDetail(props: DetailProps) {
  const {
    path, isOwner, ownerName, busy, run,
    addingModuleTo, setAddingModuleTo, editingModule, setEditingModule,
    addingTaskTo, setAddingTaskTo,
    onVerifyTask, verifyingTaskId,
  } = props;

  const { done, total, percent } = pathProgress(path);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section style={{ ...panel, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 700, margin: 0 }}>{path.title}</h2>
              {!isOwner && (
                <span style={{
                  display: 'flex', alignItems: 'center', gap: 4, fontSize: 10,
                  color: 'rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.10)', borderRadius: 999, padding: '2px 8px',
                }}>
                  <Lock className="w-3 h-3" /> @{ownerName ?? 'squadmate'} · read-only
                </span>
              )}
            </div>
            {path.overview && (
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 6, maxWidth: 680 }}>
                {path.overview}
              </p>
            )}
            <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
              {path.total_timeline_weeks && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Clock className="w-3.5 h-3.5" /> {path.total_timeline_weeks} weeks
                </span>
              )}
              <span>{path.modules.length} modules</span>
              <span>{done}/{total} tasks done</span>
            </div>
          </div>

          {isOwner && (
            <button
              onClick={() => {
                if (!confirm(`Delete "${path.title}" and all its modules and tasks?`)) return;
                void run(() => deletePath(path.id));
              }}
              disabled={busy}
              title="Delete path"
              style={{
                width: 30, height: 30, display: 'grid', placeItems: 'center', borderRadius: 9,
                background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)',
                color: '#fca5a5', cursor: 'pointer', flexShrink: 0,
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
            <div style={{ width: `${percent}%`, height: '100%', background: 'var(--accent)', transition: 'width .3s' }} />
          </div>
        </div>
      </section>

      {path.modules.map((mod, index) => (
        <ModuleCard
          key={mod.id}
          module={mod}
          path={path}
          index={index}
          isOwner={isOwner}
          busy={busy}
          run={run}
          isEditing={editingModule === mod.id}
          setEditing={(on) => setEditingModule(on ? mod.id : null)}
          isAddingTask={addingTaskTo === mod.id}
          setAddingTask={(on) => setAddingTaskTo(on ? mod.id : null)}
          onVerifyTask={onVerifyTask}
          verifyingTaskId={verifyingTaskId}
        />
      ))}

      {isOwner && (
        addingModuleTo === path.id ? (
          <ModuleForm
            busy={busy}
            onCancel={() => setAddingModuleTo(null)}
            onSubmit={async (values) => {
              const ok = await run(() =>
                createModule({ ...values, path_id: path.id, sort_order: path.modules.length }));
              if (ok) setAddingModuleTo(null);
            }}
          />
        ) : (
          <button
            onClick={() => setAddingModuleTo(path.id)}
            style={{
              ...panel, padding: '12px 16px', display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 6, color: 'rgba(255,255,255,0.5)',
              fontSize: 13, cursor: 'pointer', borderStyle: 'dashed',
            }}
          >
            <Plus className="w-4 h-4" /> Add module
          </button>
        )
      )}
    </div>
  );
}

/* ────────────────────────── Module card ────────────────────────── */

function ModuleCard({ module: mod, path, index, isOwner, busy, run, isEditing, setEditing, isAddingTask, setAddingTask, onVerifyTask, verifyingTaskId }: {
  module: LearningModule;
  path: LearningPath;
  index: number;
  isOwner: boolean;
  busy: boolean;
  run: Run;
  isEditing: boolean;
  setEditing: (v: boolean) => void;
  isAddingTask: boolean;
  setAddingTask: (v: boolean) => void;
  onVerifyTask: (task: LearningTask) => void;
  verifyingTaskId: string | null;
}) {
  const doneCount = mod.tasks.filter((t) => t.is_done).length;

  if (isEditing) {
    return (
      <ModuleForm
        busy={busy}
        initial={mod}
        onCancel={() => setEditing(false)}
        onSubmit={async (values) => {
          const ok = await run(() => updateModule(mod.id, values));
          if (ok) setEditing(false);
        }}
      />
    );
  }

  return (
    <section style={{ ...panel, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{
          width: 24, height: 24, borderRadius: 8, display: 'grid', placeItems: 'center',
          background: 'var(--accent-soft)', color: 'var(--accent)',
          fontSize: 11, fontWeight: 700, flexShrink: 0, marginTop: 1,
        }}>
          {index + 1}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h3 style={{ color: '#fff', fontSize: 15, fontWeight: 600, margin: 0 }}>{mod.title}</h3>
            {mod.estimated_days && (
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>~{mod.estimated_days}d</span>
            )}
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>
              {doneCount}/{mod.tasks.length}
            </span>
          </div>

          {mod.why_it_matters && (
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 5, lineHeight: 1.55 }}>
              {mod.why_it_matters}
            </p>
          )}

          {mod.ai_leverage && (
            <div style={{
              display: 'flex', gap: 7, marginTop: 9, padding: '9px 11px', borderRadius: 10,
              background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.20)',
            }}>
              <Sparkles className="w-3.5 h-3.5" style={{ color: '#A78BFA', flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontSize: 9, letterSpacing: '0.10em', color: '#A78BFA', fontWeight: 700 }}>
                  AI LEVERAGE
                </div>
                <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>
                  {mod.ai_leverage}
                </p>
              </div>
            </div>
          )}
        </div>

        {isOwner && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <IconButton
              title="Move up"
              disabled={busy || index === 0}
              onClick={() => void run(() => reorder('learning_modules', path.modules, mod.id, -1))}
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </IconButton>
            <IconButton
              title="Move down"
              disabled={busy || index === path.modules.length - 1}
              onClick={() => void run(() => reorder('learning_modules', path.modules, mod.id, 1))}
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </IconButton>
            <IconButton title="Edit module" disabled={busy} onClick={() => setEditing(true)}>
              <span style={{ fontSize: 10 }}>Edit</span>
            </IconButton>
            <IconButton
              title="Delete module"
              danger
              disabled={busy}
              onClick={() => {
                if (!confirm(`Delete module "${mod.title}" and its ${mod.tasks.length} task(s)?`)) return;
                void run(() => deleteModule(mod.id));
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </IconButton>
          </div>
        )}
      </div>

      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {mod.tasks.map((task, taskIndex) => (
          <div
            key={task.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 9,
              padding: '7px 8px', borderRadius: 9,
              background: task.is_done ? 'rgba(52,211,153,0.06)' : 'transparent',
            }}
          >
            <button
              onClick={() => void run(() => setTaskDone(task.id, !task.is_done))}
              disabled={busy || !isOwner}
              title={isOwner ? (task.is_done ? 'Mark not done' : 'Mark done') : 'Only the owner can tick this'}
              style={{
                background: 'none', border: 'none', padding: 0, flexShrink: 0,
                cursor: isOwner ? 'pointer' : 'not-allowed',
                color: task.is_done ? '#34D399' : 'rgba(255,255,255,0.28)',
              }}
            >
              {task.is_done
                ? <CheckCircle2 className="w-[18px] h-[18px]" />
                : <Circle className="w-[18px] h-[18px]" />}
            </button>

            <span style={{
              flex: 1, fontSize: 13, minWidth: 0,
              color: task.is_done ? 'rgba(255,255,255,0.38)' : 'rgba(255,255,255,0.78)',
              textDecoration: task.is_done ? 'line-through' : 'none',
            }}>
              {task.label}
            </span>

            <span
              title={`Proof required: ${task.proof_type}`}
              style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', padding: '2px 7px',
                borderRadius: 999, flexShrink: 0,
                color: PROOF_COLORS[task.proof_type],
                background: `${PROOF_COLORS[task.proof_type]}1a`,
                border: `1px solid ${PROOF_COLORS[task.proof_type]}40`,
              }}
            >
              {task.proof_type.toUpperCase()}
            </span>

            {isOwner && (
              <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                {/* Photo proof — Gemini judges the image against this task's label and
                    ticks it via set_task_done() only on a passing verdict. */}
                {!task.is_done && (
                  <IconButton
                    title={`Verify with a photo — judged against "${task.label}"`}
                    disabled={busy || verifyingTaskId !== null}
                    onClick={() => onVerifyTask(task)}
                  >
                    {verifyingTaskId === task.id
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Camera className="w-3 h-3" />}
                  </IconButton>
                )}
                <IconButton
                  title="Move up"
                  disabled={busy || taskIndex === 0}
                  onClick={() => void run(() => reorder('learning_tasks', mod.tasks, task.id, -1))}
                >
                  <ChevronUp className="w-3 h-3" />
                </IconButton>
                <IconButton
                  title="Move down"
                  disabled={busy || taskIndex === mod.tasks.length - 1}
                  onClick={() => void run(() => reorder('learning_tasks', mod.tasks, task.id, 1))}
                >
                  <ChevronDown className="w-3 h-3" />
                </IconButton>
                <IconButton
                  title="Delete task"
                  danger
                  disabled={busy}
                  onClick={() => void run(() => deleteTask(task.id))}
                >
                  <Trash2 className="w-3 h-3" />
                </IconButton>
              </div>
            )}
          </div>
        ))}

        {mod.tasks.length === 0 && (
          <p style={{ color: 'rgba(255,255,255,0.28)', fontSize: 12, padding: '4px 8px' }}>
            No tasks in this module yet.
          </p>
        )}
      </div>

      {isOwner && (
        isAddingTask ? (
          <TaskForm
            busy={busy}
            onCancel={() => setAddingTask(false)}
            onSubmit={async (values) => {
              const ok = await run(() =>
                createTask({ ...values, module_id: mod.id, sort_order: mod.tasks.length }));
              if (ok) setAddingTask(false);
            }}
          />
        ) : (
          <button
            onClick={() => setAddingTask(true)}
            style={{
              marginTop: 8, display: 'flex', alignItems: 'center', gap: 5,
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.4)', fontSize: 12, padding: '4px 8px',
            }}
          >
            <Plus className="w-3.5 h-3.5" /> Add task
          </button>
        )
      )}
    </section>
  );
}

/* ───────────────────────────── Forms ───────────────────────────── */

function NewPathForm({ busy, onCancel, onSubmit }: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (values: { title: string; overview: string; total_timeline_weeks: number | null }) => void;
}) {
  const [title, setTitle] = useState('');
  const [overview, setOverview] = useState('');
  const [weeks, setWeeks] = useState('');

  return (
    <section style={{ ...panel, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>New learning path</div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Goal — e.g. Learn reverse engineering"
        style={inputStyle}
        autoFocus
      />
      <textarea
        value={overview}
        onChange={(e) => setOverview(e.target.value)}
        placeholder="Overview — what you'll be able to do at the end"
        rows={2}
        style={{ ...inputStyle, resize: 'vertical' }}
      />
      <input
        value={weeks}
        onChange={(e) => setWeeks(e.target.value.replace(/[^0-9]/g, ''))}
        placeholder="Timeline in weeks (optional)"
        inputMode="numeric"
        style={{ ...inputStyle, width: 220 }}
      />
      <FormActions
        busy={busy}
        disabled={!title.trim()}
        submitLabel="Create Path"
        onCancel={onCancel}
        onSubmit={() => onSubmit({
          title,
          overview,
          total_timeline_weeks: weeks ? Number(weeks) : null,
        })}
      />
    </section>
  );
}

function ModuleForm({ busy, initial, onCancel, onSubmit }: {
  busy: boolean;
  initial?: LearningModule;
  onCancel: () => void;
  onSubmit: (values: { title: string; why_it_matters: string; ai_leverage: string; estimated_days: number | null }) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [why, setWhy] = useState(initial?.why_it_matters ?? '');
  const [leverage, setLeverage] = useState(initial?.ai_leverage ?? '');
  const [days, setDays] = useState(initial?.estimated_days?.toString() ?? '');

  return (
    <section style={{ ...panel, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
        {initial ? 'Edit module' : 'New module'}
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Module title"
        style={inputStyle}
        autoFocus
      />
      <textarea
        value={why}
        onChange={(e) => setWhy(e.target.value)}
        placeholder="Why it matters"
        rows={2}
        style={{ ...inputStyle, resize: 'vertical' }}
      />
      <textarea
        value={leverage}
        onChange={(e) => setLeverage(e.target.value)}
        placeholder="AI leverage — how to use AI tools to learn or apply this faster"
        rows={2}
        style={{ ...inputStyle, resize: 'vertical' }}
      />
      <input
        value={days}
        onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, ''))}
        placeholder="Estimated days (optional)"
        inputMode="numeric"
        style={{ ...inputStyle, width: 220 }}
      />
      <FormActions
        busy={busy}
        disabled={!title.trim()}
        submitLabel={initial ? 'Save' : 'Add Module'}
        onCancel={onCancel}
        onSubmit={() => onSubmit({
          title,
          why_it_matters: why,
          ai_leverage: leverage,
          estimated_days: days ? Number(days) : null,
        })}
      />
    </section>
  );
}

function TaskForm({ busy, onCancel, onSubmit }: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (values: { label: string; proof_type: ProofType }) => void;
}) {
  const [label, setLabel] = useState('');
  const [proofType, setProofType] = useState<ProofType>('text');

  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Task — what does done look like?"
        onKeyDown={(e) => { if (e.key === 'Enter' && label.trim()) onSubmit({ label, proof_type: proofType }); }}
        style={{ ...inputStyle, flex: 1, minWidth: 200 }}
        autoFocus
      />
      <select
        value={proofType}
        onChange={(e) => setProofType(e.target.value as ProofType)}
        title="Proof required to tick this off (enforced in Phase 4)"
        style={{ ...inputStyle, width: 100, cursor: 'pointer' }}
      >
        {PROOF_TYPES.map((t) => (
          <option key={t} value={t} style={{ background: '#12100d' }}>{t}</option>
        ))}
      </select>
      <button
        onClick={() => onSubmit({ label, proof_type: proofType })}
        disabled={busy || !label.trim()}
        style={{
          padding: '0 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
          background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 600,
        }}
      >
        Add
      </button>
      <button
        onClick={onCancel}
        style={{
          padding: '0 12px', borderRadius: 10, cursor: 'pointer',
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)',
          color: 'rgba(255,255,255,0.6)', fontSize: 12,
        }}
      >
        Cancel
      </button>
    </div>
  );
}

function FormActions({ busy, disabled, submitLabel, onCancel, onSubmit }: {
  busy: boolean;
  disabled: boolean;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button
        onClick={onSubmit}
        disabled={busy || disabled}
        style={{
          padding: '8px 16px', borderRadius: 10, border: 'none',
          background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600,
          cursor: busy || disabled ? 'not-allowed' : 'pointer',
          opacity: busy || disabled ? 0.5 : 1,
        }}
      >
        {busy ? 'Saving…' : submitLabel}
      </button>
      <button
        onClick={onCancel}
        style={{
          padding: '8px 16px', borderRadius: 10, cursor: 'pointer',
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)',
          color: 'rgba(255,255,255,0.6)', fontSize: 13,
        }}
      >
        Cancel
      </button>
    </div>
  );
}

function IconButton({ children, onClick, disabled, danger, title }: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        minWidth: 24, height: 24, padding: '0 5px', display: 'grid', placeItems: 'center',
        borderRadius: 7, cursor: disabled ? 'not-allowed' : 'pointer',
        background: danger ? 'rgba(239,68,68,0.10)' : 'rgba(255,255,255,0.05)',
        border: `1px solid ${danger ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.10)'}`,
        color: danger ? '#fca5a5' : 'rgba(255,255,255,0.55)',
        opacity: disabled ? 0.35 : 1,
      }}
    >
      {children}
    </button>
  );
}
