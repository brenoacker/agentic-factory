/**
 * Generates Mermaid LR flowchart syntax from a workflow object,
 * color-coding human gates with amber style, automated transitions with blue style,
 * and the terminal done node with green style.
 */
export function generateWorkflowMermaid(wf) {
  if (!wf || !Array.isArray(wf.stages) || wf.stages.length === 0) {
    return 'graph LR\n  empty["No stages configured"]';
  }
  const lines = ['graph LR'];
  lines.push('  classDef human fill:#78350f,stroke:#f59e0b,stroke-width:2px,color:#fff;');
  lines.push('  classDef auto fill:#1e293b,stroke:#0972d3,stroke-width:2px,color:#fff;');
  lines.push('  classDef done fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#fff;');

  for (let i = 0; i < wf.stages.length; i += 1) {
    const s = wf.stages[i];
    const isHuman = Boolean(s.humanApproval || s.mode === 'human');
    const nextStage = s.next || (i < wf.stages.length - 1 ? wf.stages[i + 1].id : 'done');
    const cleanId = String(s.id).replace(/[^a-zA-Z0-9_]/g, '_');
    const cleanNext = String(nextStage).replace(/[^a-zA-Z0-9_]/g, '_');
    const label = `${s.id}\\n(${s.agent || 'agent'})`;
    lines.push(`  ${cleanId}["${label}"]:::${isHuman ? 'human' : 'auto'}`);
    lines.push(`  ${cleanId} -->|${isHuman ? 'Human Gate' : 'Auto'}| ${cleanNext}`);
  }
  lines.push('  done["done\\n(complete)"]:::done');
  return lines.join('\n');
}
