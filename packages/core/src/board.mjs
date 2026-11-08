/**
 * Operational Board Columns & Task Categorization for the Agentic Factory Control Panel.
 */

export const BOARD_COLUMNS = [
  { id: 'triage', label: '📥 Triage', color: '#64748b' },
  { id: 'in_progress', label: '⚡ In Progress', color: '#0284c7' },
  { id: 'waiting_human', label: '🙋 Waiting for Human', color: '#f59e0b' },
  { id: 'done', label: '✅ Done', color: '#10b981' },
];

/**
 * Maps a factory task to its operational board column based on stage and human-gate status.
 *
 * Rules:
 * 1. 'done' or 'aborted' -> 'done'
 * 2. 'needs_human === 1' or 'stage === merge' -> 'waiting_human'
 * 3. 'stage === triage' (and needs_human === 0) -> 'triage'
 * 4. All active autonomous stages ('plan', 'checks_and_build', 'verify', 'review', 'investigate', 'discover') -> 'in_progress'
 */
export function getTaskBoardColumn(task) {
  if (!task) return 'triage';
  const stage = String(task.stage || '').toLowerCase();
  const needsHuman = Boolean(task.needs_human === 1 || task.needs_human === true);

  if (stage === 'done' || stage === 'aborted') {
    return 'done';
  }
  if (needsHuman || stage === 'merge') {
    return 'waiting_human';
  }
  if (stage === 'triage') {
    return 'triage';
  }
  return 'in_progress';
}

/**
 * Groups an array of tasks into the 4 operational board columns, guaranteeing 100% task retention.
 */
export function groupTasksByBoardColumn(tasks = []) {
  const grouped = {
    triage: [],
    in_progress: [],
    waiting_human: [],
    done: [],
  };

  for (const task of tasks) {
    const colId = getTaskBoardColumn(task);
    if (grouped[colId]) {
      grouped[colId].push(task);
    } else {
      grouped.in_progress.push(task);
    }
  }

  return grouped;
}
