import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Tracks the OS "reduce motion" setting, live.
 *
 * index.css already kills every CSS animation under this preference, so decorative
 * @keyframes need no JS. This hook is for the cases CSS cannot cover: not mounting
 * ember particles at all, and skipping the cursor glow's requestAnimationFrame loop —
 * a JS loop is invisible to the media query and would keep running otherwise.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = () => setReduced(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
