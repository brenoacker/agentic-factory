import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import mermaid from 'mermaid';
import { marked } from 'marked';
import '@cloudscape-design/global-styles/index.css';
import { applyMode, Mode } from '@cloudscape-design/global-styles';
import {
  AppLayout,
  Alert,
  Badge,
  Box,
  Button,
  Cards,
  Checkbox,
  ColumnLayout,
  Container,
  ContentLayout,
  ExpandableSection,
  Flashbar,
  FormField,
  Grid,
  Header,
  Input,
  Modal,
  Select,
  SideNavigation,
  SpaceBetween,
  StatusIndicator,
  Table,
  Tabs,
  Textarea,
  TopNavigation,
} from '@cloudscape-design/components';

applyMode(Mode.Dark);

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    darkMode: true,
    background: '#0f1b2a',
    primaryColor: '#1e293b',
    primaryTextColor: '#f8fafc',
    primaryBorderColor: '#0972d3',
    lineColor: '#60a5fa',
    secondaryColor: '#78350f',
    tertiaryColor: '#064e3b',
  },
  securityLevel: 'loose',
});

marked.setOptions({
  gfm: true,
  breaks: true,
});

export const NAV_ITEMS = [
  { type: 'link', text: 'Overview & Telemetry', href: '#overview', id: 'overview' },
  { type: 'link', text: 'Board & Needs Human', href: '#board', id: 'board' },
  { type: 'link', text: 'Workflows (Factory as Code)', href: '#workflows', id: 'workflows' },
  { type: 'link', text: 'Runtimes, Router & Circuit Breaker', href: '#runtimes', id: 'runtimes' },
  { type: 'link', text: 'Agents & Locked Skills (23)', href: '#agents', id: 'agents' },
  { type: 'link', text: 'Controls, Deploy & Brain', href: '#controls', id: 'controls' },
];

export function getTicketExternalUrl(task) {
  if (!task) return '#';
  if (task.ticket_url && typeof task.ticket_url === 'string' && task.ticket_url.startsWith('http')) {
    return task.ticket_url;
  }
  const provider = String(
    task.provider || (String(task.execution_key || task.executionKey || '').startsWith('linear:') ? 'linear' : 'github'),
  ).toLowerCase();
  const issueNum = task.issue_number || task.issueNumber;
  const externalId = task.external_id || task.externalId || issueNum;
  if (provider === 'linear') {
    if (String(externalId).startsWith('http')) return externalId;
    return `https://linear.app/issue/${externalId}`;
  }
  const repo = task.repo;
  if (repo && repo.includes('/')) {
    return `https://github.com/${repo}/issues/${issueNum}`;
  }
  return '#';
}

export const BOARD_COLUMNS = [
  { id: 'triage', label: '📥 Triage', color: '#64748b' },
  { id: 'in_progress', label: '⚡ In Progress', color: '#0284c7' },
  { id: 'waiting_human', label: '🙋 Waiting for Human', color: '#f59e0b' },
  { id: 'done', label: '✅ Done', color: '#10b981' },
];

export function getTaskBoardColumn(task) {
  if (!task) return 'triage';
  if (task.stage === 'done' || task.stage === 'aborted') return 'done';
  if (task.needs_human === 1 || task.stage === 'merge') return 'waiting_human';
  if (task.stage === 'triage') return 'triage';
  return 'in_progress';
}

const STAGES = [
  'triage',
  'plan',
  'checks_and_build',
  'verify',
  'review',
  'investigate',
  'discover',
  'merge',
  'done',
];

const KNOWN_AGENTS = ['planner', 'builder', 'verifier', 'judge', 'triager', 'investigator', 'ops'];

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

export function MermaidRenderer({ code, id = 'workflow-mermaid', containerId = null, testId = 'wf-mermaid-diagram' }) {
  const [svgContent, setSvgContent] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    async function renderDiagram() {
      if (!code || !code.trim()) {
        setSvgContent('');
        return;
      }
      try {
        const cleanId = String(id).replace(/[^a-zA-Z0-9_-]/g, '-');
        const uniqueId = `mermaid-${cleanId}-${Math.random().toString(36).substring(2, 8)}`;
        const { svg } = await mermaid.render(uniqueId, code);
        if (isMounted) {
          setSvgContent(svg);
          setError(null);
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || 'Failed to render Mermaid diagram');
        }
      }
    }
    renderDiagram();
    return () => {
      isMounted = false;
    };
  }, [code, id]);

  if (error) {
    return (
      <div style={{ padding: '0.75rem', background: '#3b1219', color: '#fca5a5', borderRadius: '6px', fontSize: '0.82rem', margin: '0.5rem 0' }}>
        <strong>Mermaid syntax error:</strong> {error}
      </div>
    );
  }

  return (
    <div
      id={containerId || 'wf-mermaid-diagram'}
      data-testid={testId || 'wf-mermaid-diagram'}
      style={{
        padding: '1.25rem',
        background: '#0c131f',
        borderRadius: '8px',
        border: '1px solid #1f2937',
        overflowX: 'auto',
        display: 'flex',
        justifyContent: 'center',
        margin: '0.75rem 0',
      }}
      dangerouslySetInnerHTML={{ __html: svgContent }}
    />
  );
}

export function parseMarkdownWithMermaid(markdownText) {
  if (!markdownText) return [];
  try {
    const tokens = marked.lexer(markdownText);
    const segments = [];
    let currentTokens = [];

    for (const token of tokens) {
      if (token.type === 'code' && (token.lang === 'mermaid' || token.lang === 'mermaid-js')) {
        if (currentTokens.length > 0) {
          currentTokens.links = tokens.links;
          segments.push({
            type: 'html',
            html: marked.parser(currentTokens),
          });
          currentTokens = [];
        }
        segments.push({
          type: 'mermaid',
          code: token.text,
        });
      } else {
        currentTokens.push(token);
      }
    }

    if (currentTokens.length > 0) {
      currentTokens.links = tokens.links;
      segments.push({
        type: 'html',
        html: marked.parser(currentTokens),
      });
    }

    return segments;
  } catch (err) {
    return [{ type: 'html', html: `<p>${markdownText}</p>` }];
  }
}

export function MarkdownDocumentViewer({ content, filePath = '', extension = 'md' }) {
  const isMd = extension === 'md' || extension === 'markdown' || /\.md$/i.test(filePath) || !extension;

  if (!isMd) {
    return (
      <pre
        id="doc-preview-content"
        data-testid="doc-preview-content"
        style={{
          maxHeight: '60vh',
          overflow: 'auto',
          padding: '0.75rem',
          background: '#0a0f1d',
          color: '#e2e8f0',
          border: '1px solid #1e293b',
          borderRadius: '6px',
          fontSize: '0.82rem',
          lineHeight: '1.45',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {content}
      </pre>
    );
  }

  const segments = useMemo(() => parseMarkdownWithMermaid(content || ''), [content]);

  return (
    <div
      id="doc-preview-content"
      data-testid="doc-preview-content"
      className="markdown-document-viewer"
      style={{
        maxHeight: '65vh',
        overflowY: 'auto',
        padding: '1.25rem',
        background: '#090e17',
        color: '#e2e8f0',
        border: '1px solid #1e293b',
        borderRadius: '8px',
        fontSize: '0.9rem',
        lineHeight: '1.65',
      }}
    >
      <style>{`
        .markdown-document-viewer h1 { font-size: 1.5rem; font-weight: 700; margin-top: 0; margin-bottom: 0.75rem; color: #f8fafc; border-bottom: 1px solid #1e293b; padding-bottom: 0.5rem; }
        .markdown-document-viewer h2 { font-size: 1.25rem; font-weight: 600; margin-top: 1.25rem; margin-bottom: 0.5rem; color: #f1f5f9; border-bottom: 1px solid #1e293b; padding-bottom: 0.25rem; }
        .markdown-document-viewer h3 { font-size: 1.05rem; font-weight: 600; margin-top: 1rem; margin-bottom: 0.5rem; color: #e2e8f0; }
        .markdown-document-viewer p { margin-top: 0; margin-bottom: 0.75rem; color: #cbd5e1; }
        .markdown-document-viewer ul, .markdown-document-viewer ol { margin-top: 0; margin-bottom: 0.75rem; padding-left: 1.5rem; }
        .markdown-document-viewer li { margin-bottom: 0.25rem; color: #cbd5e1; }
        .markdown-document-viewer code { background: #1e293b; color: #38bdf8; padding: 0.15rem 0.35rem; border-radius: 4px; font-size: 0.85em; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
        .markdown-document-viewer pre { background: #0c131f; border: 1px solid #1e293b; border-radius: 6px; padding: 0.75rem; overflow-x: auto; margin: 0.75rem 0; }
        .markdown-document-viewer pre code { background: transparent; padding: 0; color: #e2e8f0; }
        .markdown-document-viewer blockquote { border-left: 3px solid #3b82f6; padding-left: 0.75rem; margin: 0.75rem 0; color: #94a3b8; font-style: italic; }
        .markdown-document-viewer table { border-collapse: collapse; width: 100%; margin: 0.75rem 0; font-size: 0.85rem; }
        .markdown-document-viewer th, .markdown-document-viewer td { border: 1px solid #1e293b; padding: 0.4rem 0.6rem; text-align: left; }
        .markdown-document-viewer th { background: #0f1b2a; color: #f8fafc; font-weight: 600; }
        .markdown-document-viewer a { color: #60a5fa; text-decoration: underline; }
      `}</style>
      {(() => {
        let mermaidIdx = 0;
        return segments.map((seg, idx) => {
          if (seg.type === 'mermaid') {
            const currentMermaidIdx = mermaidIdx++;
            return (
              <div key={`mermaid-wrapper-${idx}`} style={{ margin: '1rem 0' }} data-testid="doc-preview-mermaid-wrapper">
                <MermaidRenderer
                  code={seg.code}
                  id={`doc-preview-mermaid-${currentMermaidIdx}`}
                  containerId={`doc-preview-mermaid-${currentMermaidIdx}`}
                  testId={`doc-preview-mermaid-${currentMermaidIdx}`}
                />
              </div>
            );
          }
          return (
            <div
              key={`html-${idx}`}
              className="markdown-section"
              dangerouslySetInnerHTML={{ __html: seg.html }}
            />
          );
        });
      })()}
    </div>
  );
}

function ControlPanelApp() {
  const [state, setState] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [navOpen, setNavOpen] = useState(true);

  // Multi-provider tracker form state
  const [projProvider, setProjProvider] = useState('github');
  const [projRepo, setProjRepo] = useState('');
  const [projBranch, setProjBranch] = useState('main');
  const [projTrackerKey, setProjTrackerKey] = useState('');
  const [projStatusFilter, setProjStatusFilter] = useState('Ready for Agent');
  const [projRequiredLabels, setProjRequiredLabels] = useState('');
  const [projExcludedLabels, setProjExcludedLabels] = useState('');
  const [projCustomFields, setProjCustomFields] = useState('');
  const [projAssigneeFilter, setProjAssigneeFilter] = useState('any');
  const [projJql, setProjJql] = useState('');
  const [projFeedback, setProjFeedback] = useState('');

  // Periodic scheduler state
  const [schedulerInterval, setSchedulerInterval] = useState('60');
  const [schedulerEnabled, setSchedulerEnabled] = useState(false);

  // Ticket intake form state
  const [intakeRepo, setIntakeRepo] = useState('');
  const [intakeIssueNum, setIntakeIssueNum] = useState('');
  const [intakeTitle, setIntakeTitle] = useState('');
  const [intakeType, setIntakeType] = useState('');
  const [intakeBody, setIntakeBody] = useState('');
  const [intakeFeedback, setIntakeFeedback] = useState('');
  const [dispatchingKeys, setDispatchingKeys] = useState({});
  const [addingProject, setAddingProject] = useState(false);
  const [syncingProjects, setSyncingProjects] = useState(false);
  const [intakingTicket, setIntakingTicket] = useState(false);
  const [savingControls, setSavingControls] = useState(false);

  // Workflow editor form state
  const [selectedWf, setSelectedWf] = useState('feature');
  const [currentWfObj, setCurrentWfObj] = useState(null);
  const [wfJson, setWfJson] = useState('');
  const [wfCommit, setWfCommit] = useState(false);
  const [wfStatus, setWfStatus] = useState('');

  // Operational controls form state
  const [ctrlAutonomy, setCtrlAutonomy] = useState('gated');
  const [ctrlRate, setCtrlRate] = useState('10');
  const [ctrlBudget, setCtrlBudget] = useState('25');
  const [ctrlConcurrent, setCtrlConcurrent] = useState('3');
  const [ctrlStallMinutes, setCtrlStallMinutes] = useState('30');
  const [ctrlKill, setCtrlKill] = useState(false);
  const [controlsFeedback, setControlsFeedback] = useState('');
  const [humanReplies, setHumanReplies] = useState({});
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState({ title: '', path: '', content: '', extension: 'md', loading: false, error: null });

  // Post-deploy gate form state
  const [deploySha, setDeploySha] = useState('');
  const [deployErrorRate, setDeployErrorRate] = useState('0.2');
  const [deployMaxRate, setDeployMaxRate] = useState('1.0');
  const [deployFeedback, setDeployFeedback] = useState('');

  const loadDashboard = useCallback(async () => {
    const res = await fetch('/api/dashboard');
    const data = await res.json();
    setState(data);
    if (data?.factoryConfig?.factory) {
      const f = data.factoryConfig.factory;
      setCtrlAutonomy(f.autonomy || 'gated');
      setCtrlRate(String(f.limits?.maxTasksPerHour ?? 10));
      setCtrlBudget(String(f.limits?.dailyBudgetUsd ?? 25));
      setCtrlConcurrent(String(f.limits?.maxConcurrentAgents ?? 3));
      setCtrlStallMinutes(String(f.limits?.stallThresholdMinutes ?? 30));
      setCtrlKill(Boolean(f.killSwitch));
    }
    if (data?.scheduler) {
      setSchedulerEnabled(Boolean(data.scheduler.enabled));
      setSchedulerInterval(String(data.scheduler.intervalSeconds ?? 60));
    }
    const wf = data?.workflows?.[selectedWf];
    if (wf) {
      setCurrentWfObj(structuredClone(wf));
      setWfJson(JSON.stringify(wf, null, 2));
    }
  }, [selectedWf]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const handleSelectWorkflow = (wfId) => {
    setSelectedWf(wfId);
    const wf = state?.workflows?.[wfId];
    if (wf) {
      setCurrentWfObj(structuredClone(wf));
      setWfJson(JSON.stringify(wf, null, 2));
    }
  };

  const updateStageField = (stageIndex, field, value) => {
    if (!currentWfObj) return;
    const nextWf = structuredClone(currentWfObj);
    nextWf.stages[stageIndex][field] = value;
    if (field === 'humanApproval') {
      nextWf.stages[stageIndex].mode = value ? 'human' : 'auto';
    }
    setCurrentWfObj(nextWf);
    setWfJson(JSON.stringify(nextWf, null, 2));
  };

  const updateWfAutonomy = (newAutonomy) => {
    if (!currentWfObj) return;
    const nextWf = structuredClone(currentWfObj);
    nextWf.autonomy = newAutonomy;
    setCurrentWfObj(nextWf);
    setWfJson(JSON.stringify(nextWf, null, 2));
  };

  const addMonitoredProject = async () => {
    const trackerConfig = {};
    if (projProvider === 'jira') {
      trackerConfig.projectKey = projTrackerKey.trim();
      trackerConfig.statusFilter = projStatusFilter.trim() || 'Ready for Agent';
      if (projJql.trim()) trackerConfig.jql = projJql.trim();
    } else if (projProvider === 'asana') {
      trackerConfig.projectGid = projTrackerKey.trim();
      trackerConfig.statusFilter = projStatusFilter.trim() || 'Ready for Agent';
    } else if (projStatusFilter.trim() && projStatusFilter.trim() !== 'Ready for Agent') {
      trackerConfig.statusFilter = projStatusFilter.trim();
    }
    if (projRequiredLabels.trim()) {
      trackerConfig.requiredLabels = projRequiredLabels.trim();
    }
    if (projExcludedLabels.trim()) {
      trackerConfig.excludedLabels = projExcludedLabels.trim();
    }
    if (projCustomFields.trim()) {
      trackerConfig.requiredCustomFields = projCustomFields.trim();
    }
    if (projAssigneeFilter.trim() && projAssigneeFilter.trim() !== 'any') {
      trackerConfig.assigneeFilter = projAssigneeFilter.trim();
    }

    if (addingProject) return;
    setAddingProject(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: projRepo,
          provider: projProvider,
          defaultBranch: projBranch || 'main',
          trackerConfig,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const p = data.project;
        const providerBadge = (p.provider || 'github').toUpperCase();
        setProjFeedback(
          `Monitoring ${p.repo} (${p.defaultBranch}) via ${providerBadge}${
            p.trackerConfig?.statusFilter ? ` [status: ${p.trackerConfig.statusFilter}]` : ''
          }`,
        );
        setProjRepo('');
        setProjTrackerKey('');
      } else {
        setProjFeedback(`Error: ${data.error}`);
      }
      await loadDashboard();
    } catch (err) {
      setProjFeedback(`Error: ${err.message}`);
    } finally {
      setAddingProject(false);
    }
  };

  const toggleProjectPause = async (project) => {
    await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: project.repo,
        provider: project.provider || 'github',
        defaultBranch: project.defaultBranch || 'main',
        trackerConfig: project.trackerConfig || {},
        paused: !project.paused,
      }),
    });
    await loadDashboard();
  };

  const removeProject = async (repo) => {
    await fetch('/api/projects/' + encodeURIComponent(repo), { method: 'DELETE' });
    await loadDashboard();
  };

  const syncAllMonitoredProjects = async () => {
    if (syncingProjects) return;
    setSyncingProjects(true);
    try {
      const res = await fetch('/api/projects/sync', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        const skippedNote =
          data.skippedByTriggersCount > 0 ? ` (${data.skippedByTriggersCount} skipped by triggers)` : '';
        setProjFeedback(
          `Synced ${data.polledRepos} repo(s): ${data.newTasksCount} new issue(s) intaked${skippedNote}`,
        );
      } else {
        setProjFeedback(`Sync error: ${data.error}`);
      }
      await loadDashboard();
    } catch (err) {
      setProjFeedback(`Sync error: ${err.message}`);
    } finally {
      setSyncingProjects(false);
    }
  };

  const updateScheduler = async (nextEnabled, runImmediately = true) => {
    const res = await fetch('/api/scheduler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: nextEnabled,
        intervalSeconds: Number(schedulerInterval),
        runImmediately,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setSchedulerEnabled(Boolean(data.scheduler.enabled));
      setProjFeedback(
        `Scheduler ${data.scheduler.enabled ? 'ACTIVE' : 'PAUSED'} (every ${data.scheduler.intervalSeconds}s · polls: ${data.scheduler.pollCount})`,
      );
    } else {
      setProjFeedback(`Scheduler error: ${data.error}`);
    }
    await loadDashboard();
  };

  const submitTicketIntake = async () => {
    if (intakingTicket) return;
    setIntakingTicket(true);
    try {
      const res = await fetch('/api/tickets/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: intakeRepo || undefined,
          issue_number: Number(intakeIssueNum),
          title: intakeTitle,
          body: intakeBody,
          type: intakeType || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setIntakeFeedback(
          `Classified as ${data.classifiedType} at stage ${data.initialStage} (${data.executionKey})`,
        );
        setIntakeIssueNum('');
        setIntakeTitle('');
        setIntakeBody('');
      } else {
        setIntakeFeedback(`Error: ${data.error || 'Intake failed'}`);
      }
      await loadDashboard();
    } catch (err) {
      setIntakeFeedback(`Error: ${err.message}`);
    } finally {
      setIntakingTicket(false);
    }
  };

  const dispatchTicketKey = async (key, approveCurrentStage = false) => {
    if (dispatchingKeys[key]) return;
    setDispatchingKeys((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await fetch('/api/tickets/' + encodeURIComponent(key) + '/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approveCurrentStage }),
      });
      const data = await res.json();
      if (!res.ok && data.error) {
        setIntakeFeedback(`Dispatch Notice: ${data.error}`);
      }
      await loadDashboard();
    } catch (err) {
      setIntakeFeedback(`Dispatch Failed: ${err.message}`);
    } finally {
      setDispatchingKeys((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const checkTaskPr = async (key) => {
    try {
      const res = await fetch('/api/tasks/' + encodeURIComponent(key) + '/check-pr', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        setIntakeFeedback(`PR Check Notice (${res.status}): ${data.error || 'Failed to check PR'}`);
      } else if (data.merged) {
        setIntakeFeedback(`✅ PR #${data.prNumber || ''} is MERGED! Task advanced to done.`);
      } else {
        setIntakeFeedback(`⏳ PR #${data.prNumber || ''} state is ${data.state || 'OPEN'}. Awaiting merge on GitHub.`);
      }
    } catch (err) {
      setIntakeFeedback(`PR Check Error: ${err.message}`);
    }
    await loadDashboard();
  };

  const submitHumanReply = async (key, replyWords) => {
    const text = replyWords || 'Operator clarification provided';
    const res = await fetch('/api/tasks/' + encodeURIComponent(key) + '/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approver: 'panel-operator', words: text }),
    });
    if (res.ok) {
      await fetch('/api/tickets/' + encodeURIComponent(key) + '/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approveCurrentStage: true }),
      });
      setHumanReplies((prev) => ({ ...prev, [key]: '' }));
    }
    await loadDashboard();
  };

  const openFileInEditor = async (filePath, executionKey, line) => {
    try {
      const res = await fetch('/api/files/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, executionKey, line }),
      });
      const data = await res.json();
      if (!res.ok) {
        setIntakeFeedback(`Failed to open in editor: ${data.error || 'Unknown error'}`);
      } else {
        setIntakeFeedback(`Opened in editor: ${filePath}`);
      }
    } catch (err) {
      setIntakeFeedback(`Editor launcher error: ${err.message}`);
    }
  };

  const openPreviewModal = async (filePath, executionKey, label) => {
    setPreviewDoc({ title: label || filePath, path: filePath, content: '', extension: 'md', loading: true, error: null });
    setPreviewModalOpen(true);
    try {
      const q = new URLSearchParams({ path: filePath });
      if (executionKey) q.set('executionKey', executionKey);
      const res = await fetch(`/api/files/content?${q.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setPreviewDoc({
          title: label || filePath,
          path: filePath,
          content: '',
          extension: 'md',
          loading: false,
          error: data.error || 'Failed to read file',
        });
      } else {
        setPreviewDoc({
          title: label || filePath,
          path: filePath,
          content: data.content,
          extension: data.extension || 'md',
          loading: false,
          error: null,
        });
      }
    } catch (err) {
      setPreviewDoc({
        title: label || filePath,
        path: filePath,
        content: '',
        extension: 'md',
        loading: false,
        error: err.message,
      });
    }
  };

  const snoozeTaskAlarm = async (key) => {
    await fetch('/api/tasks/' + encodeURIComponent(key) + '/acknowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor: 'brenoacker', note: 'Snoozed from Control Panel alarm banner' }),
    });
    await loadDashboard();
  };

  const saveWorkflowFromEditor = async () => {
    let parsed;
    try {
      parsed = JSON.parse(wfJson);
    } catch {
      setWfStatus('Invalid JSON syntax');
      return;
    }
    const res = await fetch('/api/workflows/' + encodeURIComponent(selectedWf), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflow: parsed,
        commit: wfCommit,
        commitMessage: `chore(workflows): update ${selectedWf} workflow from Cloudscape editor`,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setWfStatus(`Saved workflow ${selectedWf} (${res.status})${data.commitSha ? ` [commit: ${data.commitSha}]` : ''}`);
      setCurrentWfObj(parsed);
      await loadDashboard();
    } else {
      setWfStatus(`Rejected (${res.status}): ${(data.errors || [data.error]).join('; ')}`);
    }
  };

  const resetCircuit = async (runtime) => {
    await fetch('/api/controls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resetRuntime: runtime }),
    });
    await loadDashboard();
  };

  const saveControls = async () => {
    if (savingControls) return;
    setSavingControls(true);
    try {
      const res = await fetch('/api/controls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autonomy: ctrlAutonomy,
          maxTasksPerHour: Number(ctrlRate),
          dailyBudgetUsd: Number(ctrlBudget),
          maxConcurrentAgents: Number(ctrlConcurrent),
          stallThresholdMinutes: Number(ctrlStallMinutes),
          killSwitch: ctrlKill,
        }),
      });
      const data = await res.json();
      setControlsFeedback(res.ok ? 'Controls saved successfully' : `Failed to save controls: ${data.error || 'Invalid parameters'}`);
      await loadDashboard();
    } catch (err) {
      setControlsFeedback(`Failed to save controls: ${err.message}`);
    } finally {
      setSavingControls(false);
    }
  };

  const verifyDeploymentFromUi = async () => {
    const res = await fetch('/api/deploy/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commitSha: deploySha,
        errorRate: Number(deployErrorRate),
        maxErrorRate: Number(deployMaxRate),
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setDeployFeedback(
        data.rolledBack
          ? `Rolled back ${deploySha} -> ${data.revertedToSha}`
          : `Healthy deploy ${deploySha} (last_good_sha: ${data.last_good_sha})`,
      );
    } else {
      setDeployFeedback(`Error: ${data.error}`);
    }
    await loadDashboard();
  };

  const st = state?.status || {
    totalTasks: 0,
    byStage: {},
    byType: {},
    byRuntime: {},
    byModel: {},
    tokens: { input: 0, output: 0, cached: 0, total: 0 },
    totalCostUsd: 0,
    reviewMetrics: { reviewedTasks: 0, firstRoundApprovalRate: 0, averageReviewRounds: 0 },
    needsHuman: [],
    stalledTasks: [],
    tasks: [],
  };
  const f = state?.factoryConfig?.factory || {
    autonomy: 'gated',
    killSwitch: false,
    limits: { maxTasksPerHour: 10, dailyBudgetUsd: 25, maxReviewRounds: 3, stallThresholdMinutes: 30 },
  };
  const stalledList = st.stalledTasks || [];
  const stalledMap = Object.fromEntries(stalledList.map((s) => [s.executionKey, s]));
  const etagMap = Object.fromEntries((state?.repoEtags || []).map((e) => [e.repo, e.etag]));
  const scheduler = state?.scheduler || { enabled: false, intervalSeconds: 60, pollCount: 0 };

  const mermaidCode = currentWfObj ? generateWorkflowMermaid(currentWfObj) : 'graph LR\n  empty["Loading..."]';

  return (
    <div id="cloudscape-root" data-testid="cloudscape-app-shell" className="awsui-dark-mode">
      <div className="awsui-top-navigation">
        <TopNavigation
          identity={{
            href: '#overview',
            title: 'AWS Cloudscape — Agentic Factory Console',
            logo: {
              src: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="%23ec7211"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>',
              alt: 'AWS Cloudscape Logo',
            },
          }}
          utilities={[
            {
              type: 'button',
              text: `AUTONOMY: ${String(f.autonomy).toUpperCase()}`,
            },
            {
              type: 'button',
              text: stalledList.length > 0 ? `${stalledList.length} STALLED` : '0 ALARMS',
            },
            {
              type: 'button',
              text: 'Refresh Telemetry',
              onClick: loadDashboard,
            },
          ]}
        />
      </div>

      {/* Cloudscape Top Quick Navigation Tabs (compatible with test selectors) */}
      <div
        id="tabs"
        data-testid="cloudscape-tab-bar"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          padding: '8px 24px',
          background: '#0f1b2a',
          borderBottom: '1px solid #232f3e',
          alignItems: 'center',
        }}
      >
        <div id="operator-view-switch" style={{ display: 'flex', gap: '6px', marginRight: '12px' }}>
          <button
            id="btn-view-operations"
            data-testid="btn-view-operations"
            onClick={() => setActiveTab('overview')}
            style={{
              background: activeTab === 'overview' ? '#0972d3' : '#1e293b',
              color: '#ffffff',
              border: activeTab === 'overview' ? '2px solid #60a5fa' : '1px solid #334155',
              borderRadius: '6px',
              padding: '6px 14px',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            🕹️ Control Tower
          </button>
          <button
            id="btn-view-board"
            data-testid="btn-view-board"
            onClick={() => setActiveTab('board')}
            style={{
              background: activeTab === 'board' ? '#0972d3' : '#1e293b',
              color: '#ffffff',
              border: activeTab === 'board' ? '2px solid #60a5fa' : '1px solid #334155',
              borderRadius: '6px',
              padding: '6px 14px',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            📋 Board & Timeline
          </button>
          <button
            id="btn-view-health"
            data-testid="btn-view-health"
            onClick={() => setActiveTab('runtimes')}
            style={{
              background: activeTab === 'runtimes' || activeTab === 'controls' ? '#0972d3' : '#1e293b',
              color: '#ffffff',
              border: activeTab === 'runtimes' || activeTab === 'controls' ? '2px solid #60a5fa' : '1px solid #334155',
              borderRadius: '6px',
              padding: '6px 14px',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            🛡️ Health & Integrations
          </button>
        </div>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            data-tab={item.id}
            onClick={() => setActiveTab(item.id)}
            className={activeTab === item.id ? 'active' : ''}
            style={{
              background: activeTab === item.id ? '#0972d3' : '#1e293b',
              color: '#ffffff',
              border: activeTab === item.id ? '1px solid #539fe5' : '1px solid #334155',
              borderRadius: '6px',
              padding: '6px 14px',
              fontSize: '13px',
              cursor: 'pointer',
              fontWeight: activeTab === item.id ? '600' : 'normal',
            }}
          >
            {item.text}
          </button>
        ))}
        <button
          id="refresh-telemetry-btn"
          onClick={loadDashboard}
          style={{
            marginLeft: 'auto',
            background: '#232f3e',
            color: '#d1d5db',
            border: '1px solid #414d5c',
            borderRadius: '6px',
            padding: '6px 14px',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          Refresh Telemetry
        </button>
      </div>

      <div className="awsui-app-layout">
        <AppLayout
          navigationOpen={navOpen}
          onNavigationChange={({ detail }) => setNavOpen(detail.open)}
          navigation={
            <div className="awsui-side-navigation">
              <SideNavigation
                activeHref={`#${activeTab}`}
                header={{ href: '#', text: 'Agentic Factory' }}
                items={[
                  {
                    type: 'link',
                    text: '🕹️ Control Tower (Live Operations)',
                    href: '#overview',
                    id: 'nav-operations',
                    info:
                      (st.needsHuman || []).length > 0 ? (
                        <Badge color="severity-medium">{(st.needsHuman || []).length} waiting</Badge>
                      ) : stalledList.length > 0 ? (
                        <Badge color="red">{stalledList.length} stalled</Badge>
                      ) : undefined,
                  },
                  {
                    type: 'link',
                    text: '📋 Board & Timeline (Kanban)',
                    href: '#board',
                    id: 'nav-board',
                  },
                  {
                    type: 'link',
                    text: '🛡️ Settings, Health & Integrations',
                    href: '#controls',
                    id: 'nav-settings',
                  },
                  {
                    type: 'divider',
                  },
                  {
                    type: 'section',
                    text: 'Advanced Diagnostics & Factory as Code',
                    defaultExpanded: true,
                    items: [
                      { type: 'link', text: '⚡ Workflows (Factory as Code)', href: '#workflows', id: 'workflows' },
                      { type: 'link', text: '🤖 Agents & Locked Skills (23)', href: '#agents', id: 'agents' },
                      { type: 'link', text: '🔌 Runtime Router & Circuit Breaker', href: '#runtimes', id: 'runtimes' },
                      { type: 'link', text: '🧠 Factory Long-Term Brain', href: '#controls', id: 'brain' },
                    ],
                  },
                ]}
                onFollow={(e) => {
                  e.preventDefault();
                  const target = e.detail.href.replace('#', '') || 'overview';
                  setActiveTab(target);
                }}
              />
            </div>
          }
        notifications={
          stalledList.length > 0 ? (
            <div id="stalled-alarm-banner" data-testid="stalled-alarm-banner">
              <Alert
                type="error"
                dismissible={false}
                header={`STALLED TASK ALARM — ${stalledList.length} TASK(S) IDLE BEYOND ${f.limits?.stallThresholdMinutes || 30} MIN THRESHOLD`}
              >
                <SpaceBetween size="xs">
                  {stalledList.map((item) => (
                    <div
                      key={item.executionKey}
                      data-testid={`alarm-item-${item.issueNumber}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '1rem',
                        padding: '0.5rem',
                        background: 'rgba(127, 29, 29, 0.4)',
                        borderRadius: '6px',
                        border: '1px solid #ef4444',
                      }}
                    >
                      <div>
                        <Badge color="red">{item.severity.toUpperCase()}</Badge>{' '}
                        <strong>{item.executionKey}</strong> — {item.title} [{item.type}]
                        <br />
                        <small>
                          Stage: <strong>{item.stage}</strong> · Idle for{' '}
                          <strong>{item.idleMinutes}m</strong> · {item.reason}
                        </small>
                      </div>
                      <SpaceBetween direction="horizontal" size="xs">
                        <Button
                          variant="primary"
                          disabled={Boolean(dispatchingKeys[item.executionKey])}
                          data-testid={`alarm-act-btn-${item.issueNumber}`}
                          onClick={() => dispatchTicketKey(item.executionKey, item.needsHuman)}
                        >
                          {dispatchingKeys[item.executionKey] ? 'Resuming...' : 'Act Now (Approve & Resume)'}
                        </Button>
                        <Button
                          variant="normal"
                          data-testid={`alarm-snooze-btn-${item.issueNumber}`}
                          onClick={() => snoozeTaskAlarm(item.executionKey)}
                        >
                          Snooze Alarm
                        </Button>
                      </SpaceBetween>
                    </div>
                  ))}
                </SpaceBetween>
              </Alert>
            </div>
          ) : undefined
        }
        content={
          <ContentLayout
            header={
              <Header
                variant="h1"
                info={
                  <SpaceBetween direction="horizontal" size="xs">
                    <span
                      id="factory-status-badge"
                      className={`badge ${f.killSwitch ? 'red' : 'green'}`}
                      style={{
                        padding: '0.2rem 0.6rem',
                        borderRadius: '6px',
                        fontWeight: 700,
                        fontSize: '0.78rem',
                        background: f.killSwitch ? '#7f1d1d' : '#064e3b',
                        color: '#fff',
                      }}
                    >
                      {f.killSwitch ? 'PAUSED (KILL SWITCH)' : `ACTIVE (${String(f.autonomy).toUpperCase()})`}
                    </span>
                    <span
                      id="header-alarm-badge"
                      data-testid="header-alarm-badge"
                      style={{
                        padding: '0.2rem 0.6rem',
                        borderRadius: '6px',
                        fontWeight: 700,
                        fontSize: '0.78rem',
                        background: stalledList.length > 0 ? '#991b1b' : '#065f46',
                        color: '#fff',
                      }}
                    >
                      {stalledList.length > 0 ? `${stalledList.length} STALLED ALARM(S)` : '0 ALARMS'}
                    </span>
                    <span
                      id="header-human-badge"
                      data-testid="header-human-badge"
                      style={{
                        padding: '0.2rem 0.6rem',
                        borderRadius: '6px',
                        fontWeight: 700,
                        fontSize: '0.78rem',
                        background: (st.needsHuman || []).length > 0 ? '#b45309' : '#1e293b',
                        color: (st.needsHuman || []).length > 0 ? '#fef3c7' : '#94a3b8',
                      }}
                    >
                      {(st.needsHuman || []).length > 0
                        ? `${st.needsHuman.length} WAITING HUMAN`
                        : '0 WAITING HUMAN'}
                    </span>
                    <span
                      id="scheduler-status-badge"
                      data-testid="scheduler-status-badge"
                      style={{
                        padding: '0.2rem 0.6rem',
                        borderRadius: '6px',
                        fontWeight: 600,
                        fontSize: '0.75rem',
                        background: '#1e293b',
                        color: '#93c5fd',
                      }}
                    >
                      {scheduler.enabled
                        ? `CRON: ACTIVE (${scheduler.intervalSeconds}s · #${scheduler.pollCount})`
                        : `CRON: MANUAL (#${scheduler.pollCount || 0})`}
                    </span>
                  </SpaceBetween>
                }
              >
                {activeTab === 'overview' && 'Overview & Telemetry'}
                {activeTab === 'board' && 'Board & Needs Human Queue'}
                {activeTab === 'workflows' && 'Visual Workflows & Factory as Code'}
                {activeTab === 'runtimes' && 'Runtimes, Router & Circuit Breaker'}
                {activeTab === 'agents' && 'Agents Catalog & Locked Skills'}
                {activeTab === 'controls' && 'Operational Controls, Deploy & Long-Term Brain'}
              </Header>
            }
          >
            {/* TAB 1: OVERVIEW */}
            <section id="tab-overview" style={{ display: activeTab === 'overview' ? 'block' : 'none' }}>
              <SpaceBetween size="l">
                <ColumnLayout columns={4} variant="text-grid">
                  <Container>
                    <div data-testid="kpi-total-tickets">
                      <Box variant="awsui-key-label">Total Tickets</Box>
                      <Box variant="h1">{st.totalTasks}</Box>
                      <Box variant="small" color="text-body-secondary" data-testid="kpi-active-concurrency">
                        Active: {st.activeTasksCount ?? (st.totalTasks - (st.byStage?.done || 0))} / {f.limits?.maxConcurrentAgents ?? 3} max agents
                      </Box>
                      <Box variant="small" color="text-body-secondary" data-testid="kpi-executing-agents">
                        Executing: {st.executingAgentsCount ?? 0} running
                      </Box>
                      <Box variant="small" color="text-body-secondary">
                        Completed: {st.byStage?.done || 0}
                      </Box>
                    </div>
                  </Container>
                  <Container>
                    <div data-testid="kpi-total-cost">
                      <Box variant="awsui-key-label">Total Cost (USD)</Box>
                      <Box variant="h1">${Number(st.totalCostUsd || 0).toFixed(4)}</Box>
                      <Box variant="small" color="text-body-secondary">
                        Daily budget: {f.limits?.dailyBudgetUsd != null ? `$${f.limits.dailyBudgetUsd}` : 'Unlimited'}
                      </Box>
                    </div>
                  </Container>
                  <Container>
                    <div data-testid="kpi-tokens">
                      <Box variant="awsui-key-label">Consumed Tokens</Box>
                      <Box variant="h1">{Number(st.tokens?.total || 0).toLocaleString()}</Box>
                      <Box variant="small" color="text-body-secondary">
                        In: {Number(st.tokens?.input || 0).toLocaleString()} · Out:{' '}
                        {Number(st.tokens?.output || 0).toLocaleString()} · Cache:{' '}
                        {Number(st.tokens?.cached || 0).toLocaleString()}
                      </Box>
                    </div>
                  </Container>
                  <Container>
                    <div data-testid="kpi-first-round">
                      <Box variant="awsui-key-label">First-Round PR Approval</Box>
                      <Box variant="h1">
                        {st.reviewMetrics?.reviewedTasks > 0
                          ? `${st.reviewMetrics.firstRoundApprovalRate}%`
                          : 'N/A'}
                      </Box>
                      <Box variant="small" color="text-body-secondary">
                        {st.reviewMetrics?.reviewedTasks > 0
                          ? `Avg review rounds: ${st.reviewMetrics?.averageReviewRounds ?? 0} (max ${f.limits?.maxReviewRounds ?? 3})`
                          : 'No PR reviews recorded yet'}
                      </Box>
                    </div>
                  </Container>
                </ColumnLayout>

                <Container>
                  <div data-testid="kpi-needs-human">
                    <Box variant="awsui-key-label">Needs Human Queue</Box>
                    <Box variant="h2">{(st.needsHuman || []).length}</Box>
                    <Box variant="small" color="text-body-secondary">
                      Human gates awaiting action
                    </Box>
                  </div>
                </Container>

                {/* CONTROL TOWER: LIVE EXECUTING SLOTS & INTERVENTIONS */}
                <Container
                  id="live-execution-tower"
                  data-testid="live-execution-tower"
                  header={
                    <Header
                      variant="h2"
                      description="Real-time execution slots, active tasks with workspaces, and human intervention queue."
                      actions={
                        <SpaceBetween direction="horizontal" size="xs">
                          <Button variant="normal" onClick={() => setActiveTab('board')}>
                            View Kanban Board
                          </Button>
                        </SpaceBetween>
                      }
                    >
                      Control Tower — Live Executing Slots ({st.executingAgentsCount ?? 0} / {f.limits?.maxConcurrentAgents ?? 3})
                    </Header>
                  }
                >
                  <SpaceBetween size="m">
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem' }}>
                      {((st.tasks || []).filter((t) => t.stage !== 'done' && t.stage !== 'aborted' && t.stage !== 'merge' && t.stage !== 'triage' && t.needs_human === 0)).length === 0 ? (
                        <div style={{ padding: '1rem', background: '#0b1320', borderRadius: '6px', border: '1px dashed #334155', color: '#94a3b8' }}>
                          ⚡ No agents actively executing right now. Ready capacity: {Math.max(0, (f.limits?.maxConcurrentAgents ?? 3) - (st.executingAgentsCount ?? 0))} slot(s) free.
                        </div>
                      ) : (
                        (st.tasks || []).filter((t) => t.stage !== 'done' && t.stage !== 'aborted' && t.stage !== 'merge' && t.stage !== 'triage' && t.needs_human === 0).map((t) => (
                          <div
                            key={t.execution_key}
                            style={{
                              padding: '0.75rem',
                              background: '#0f172a',
                              border: '1px solid #0284c7',
                              borderRadius: '6px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.4rem',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <Badge color="blue">EXECUTING</Badge>
                              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Stage: <strong>{t.stage}</strong></span>
                            </div>
                            <a
                              id={`tower-ticket-link-${t.issue_number}`}
                              href={getTicketExternalUrl(t)}
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: '#60a5fa', fontWeight: 700, textDecoration: 'none', fontSize: '0.9rem' }}
                            >
                              #{t.issue_number} {t.title} ↗
                            </a>
                            <div style={{ fontSize: '0.76rem', color: '#cbd5e1' }}>
                              Branch: <code>{t.branch_name || `factory/issue-${t.issue_number}`}</code>
                            </div>
                            {t.workspace_path && (
                              <div style={{ fontSize: '0.72rem', color: '#64748b', wordBreak: 'break-all' }}>
                                Workspace: {t.workspace_path}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', padding: '0.5rem 0', borderTop: '1px solid #1e293b' }}>
                      <span style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
                        📥 <strong>Triage Backlog Queue:</strong> {(st.tasks || []).filter((t) => t.stage === 'triage' && t.needs_human === 0).length} ticket(s) waiting for available slots
                      </span>
                      <span style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
                        ⏳ <strong>Awaiting PR Merge:</strong> {(st.tasks || []).filter((t) => t.stage === 'merge').length} ticket(s)
                      </span>
                      <span style={{ fontSize: '0.85rem', color: (st.needsHuman || []).length > 0 ? '#f59e0b' : '#10b981', fontWeight: 600 }}>
                        🙋 <strong>Awaiting Human Input:</strong> {(st.needsHuman || []).length} agent(s)
                      </span>
                    </div>
                  </SpaceBetween>
                </Container>

                <Grid gridDefinition={[{ colspan: 6 }, { colspan: 6 }]}>
                  <Table
                    header={<Header variant="h2">Usage & Cost by Runtime</Header>}
                    columnDefinitions={[
                      { id: 'rt', header: 'Runtime', cell: (item) => <strong>{item.rt}</strong> },
                      { id: 'events', header: 'Events', cell: (item) => item.events },
                      { id: 'in', header: 'Input Tokens', cell: (item) => item.inputTokens },
                      { id: 'out', header: 'Output Tokens', cell: (item) => item.outputTokens },
                      { id: 'cache', header: 'Cached', cell: (item) => item.cachedTokens },
                      { id: 'cost', header: 'Cost (USD)', cell: (item) => `$${item.costUsd.toFixed(4)}` },
                    ]}
                    items={Object.entries(st.byRuntime || {}).map(([rt, d]) => ({ rt, ...d }))}
                    empty={<Box textAlign="center">No runtime telemetry events recorded yet</Box>}
                  />
                  <Table
                    header={<Header variant="h2">Usage & Cost by Model</Header>}
                    columnDefinitions={[
                      { id: 'model', header: 'Model', cell: (item) => <strong>{item.model}</strong> },
                      { id: 'events', header: 'Events', cell: (item) => item.events },
                      { id: 'in', header: 'Input Tokens', cell: (item) => item.inputTokens },
                      { id: 'out', header: 'Output Tokens', cell: (item) => item.outputTokens },
                      { id: 'cost', header: 'Cost (USD)', cell: (item) => `$${item.costUsd.toFixed(4)}` },
                    ]}
                    items={Object.entries(st.byModel || {}).map(([model, d]) => ({ model, ...d }))}
                    empty={<Box textAlign="center">No model telemetry events recorded yet</Box>}
                  />
                </Grid>
              </SpaceBetween>
            </section>

            {/* TAB 2: BOARD & NEEDS HUMAN */}
            <section id="tab-board" style={{ display: activeTab === 'board' ? 'block' : 'none' }}>
              <SpaceBetween size="l">
                <Container
                  header={
                    <Header
                      variant="h2"
                      description="Monitor tickets from GitHub Issues, Jira, and Asana with custom pickup trigger combinations."
                    >
                      Monitored Issue Trackers & Cron Poller
                    </Header>
                  }
                >
                  <SpaceBetween size="m">
                    <ColumnLayout columns={4}>
                      <FormField label="Tracker Provider">
                        <select
                          id="proj-provider-select"
                          value={projProvider}
                          onChange={(e) => setProjProvider(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '0.45rem',
                            background: '#0f172a',
                            color: '#fff',
                            border: '1px solid #334155',
                            borderRadius: '4px',
                          }}
                        >
                          <option value="github">github (GitHub Issues)</option>
                          <option value="jira">jira (Jira Cloud / Server)</option>
                          <option value="asana">asana (Asana Tasks)</option>
                          <option value="linear">linear (Linear Project Issues)</option>
                        </select>
                      </FormField>
                      <FormField label="Target Repository (owner/repo)">
                        <input
                          type="text"
                          id="proj-repo-input"
                          value={projRepo}
                          onChange={(e) => setProjRepo(e.target.value)}
                          placeholder="brenoacker/my-existing-repo"
                          style={{
                            width: '100%',
                            padding: '0.45rem',
                            background: '#0f172a',
                            color: '#fff',
                            border: '1px solid #334155',
                            borderRadius: '4px',
                          }}
                        />
                      </FormField>
                      <FormField label="Default Branch">
                        <input
                          type="text"
                          id="proj-branch-input"
                          value={projBranch}
                          onChange={(e) => setProjBranch(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '0.45rem',
                            background: '#0f172a',
                            color: '#fff',
                            border: '1px solid #334155',
                            borderRadius: '4px',
                          }}
                        />
                      </FormField>
                      <FormField label="Target Status / Section Filter">
                        <input
                          type="text"
                          id="proj-status-filter-input"
                          value={projStatusFilter}
                          onChange={(e) => setProjStatusFilter(e.target.value)}
                          placeholder="Ready for Agent"
                          style={{
                            width: '100%',
                            padding: '0.45rem',
                            background: '#0f172a',
                            color: '#fff',
                            border: '1px solid #334155',
                            borderRadius: '4px',
                          }}
                        />
                      </FormField>
                    </ColumnLayout>

                    {(projProvider === 'jira' || projProvider === 'asana') && (
                      <ColumnLayout columns={2}>
                        <FormField
                          label={
                            projProvider === 'jira'
                              ? 'Jira Project Key (e.g. FAC)'
                              : 'Asana Project GID (e.g. 120055)'
                          }
                        >
                          <input
                            type="text"
                            id="proj-tracker-key-input"
                            value={projTrackerKey}
                            onChange={(e) => setProjTrackerKey(e.target.value)}
                            placeholder={projProvider === 'jira' ? 'FAC' : '120055'}
                            style={{
                              width: '100%',
                              padding: '0.45rem',
                              background: '#0f172a',
                              color: '#fff',
                              border: '1px solid #334155',
                              borderRadius: '4px',
                            }}
                          />
                        </FormField>
                        {projProvider === 'jira' && (
                          <FormField label="Custom Jira JQL Override (optional)">
                            <input
                              type="text"
                              id="proj-jql-input"
                              value={projJql}
                              onChange={(e) => setProjJql(e.target.value)}
                              placeholder='project = "FAC" AND status = "Ready for Agent"'
                              style={{
                                width: '100%',
                                padding: '0.45rem',
                                background: '#0f172a',
                                color: '#fff',
                                border: '1px solid #334155',
                                borderRadius: '4px',
                              }}
                            />
                          </FormField>
                        )}
                      </ColumnLayout>
                    )}

                    <ColumnLayout columns={4}>
                      <FormField label="Required Flags / Labels / Tags (AND)">
                        <input
                          type="text"
                          id="proj-required-labels-input"
                          value={projRequiredLabels}
                          onChange={(e) => setProjRequiredLabels(e.target.value)}
                          placeholder="agent-ready, approved"
                          style={{
                            width: '100%',
                            padding: '0.45rem',
                            background: '#0f172a',
                            color: '#fff',
                            border: '1px solid #334155',
                            borderRadius: '4px',
                          }}
                        />
                      </FormField>
                      <FormField label="Excluded Blocker Flags / Labels">
                        <input
                          type="text"
                          id="proj-excluded-labels-input"
                          value={projExcludedLabels}
                          onChange={(e) => setProjExcludedLabels(e.target.value)}
                          placeholder="blocked, manual-only"
                          style={{
                            width: '100%',
                            padding: '0.45rem',
                            background: '#0f172a',
                            color: '#fff',
                            border: '1px solid #334155',
                            borderRadius: '4px',
                          }}
                        />
                      </FormField>
                      <FormField label="Required Custom Fields (key=value)">
                        <input
                          type="text"
                          id="proj-custom-fields-input"
                          value={projCustomFields}
                          onChange={(e) => setProjCustomFields(e.target.value)}
                          placeholder="AI_Allowed=true"
                          style={{
                            width: '100%',
                            padding: '0.45rem',
                            background: '#0f172a',
                            color: '#fff',
                            border: '1px solid #334155',
                            borderRadius: '4px',
                          }}
                        />
                      </FormField>
                      <FormField label="Assignee Trigger Rule">
                        <input
                          type="text"
                          id="proj-assignee-filter-input"
                          value={projAssigneeFilter}
                          onChange={(e) => setProjAssigneeFilter(e.target.value)}
                          placeholder="any or unassigned"
                          style={{
                            width: '100%',
                            padding: '0.45rem',
                            background: '#0f172a',
                            color: '#fff',
                            border: '1px solid #334155',
                            borderRadius: '4px',
                          }}
                        />
                      </FormField>
                    </ColumnLayout>

                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <Button variant="primary" id="proj-add-btn" disabled={addingProject} onClick={addMonitoredProject}>
                        {addingProject ? 'Adding Repository...' : 'Add Monitored Repository'}
                      </Button>
                      <Button id="sync-repos-btn" disabled={syncingProjects} onClick={syncAllMonitoredProjects}>
                        {syncingProjects ? 'Syncing Repos...' : 'Sync Issues from All Monitored Repos'}
                      </Button>
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        <label style={{ fontSize: '0.82rem', color: '#9ba7b6' }}>
                          Cron Interval (s):{' '}
                          <input
                            type="number"
                            id="scheduler-interval-input"
                            value={schedulerInterval}
                            onChange={(e) => setSchedulerInterval(e.target.value)}
                            style={{
                              width: '75px',
                              padding: '0.3rem',
                              background: '#0f172a',
                              color: '#fff',
                              border: '1px solid #334155',
                              borderRadius: '4px',
                            }}
                          />
                        </label>
                        <Button id="scheduler-run-btn" onClick={() => updateScheduler(true, true)}>
                          Save Interval & Run Cron
                        </Button>
                      </div>
                      <span id="proj-feedback" style={{ fontSize: '0.85rem', color: '#93c5fd' }}>
                        {projFeedback}
                      </span>
                    </div>

                    <table id="projects-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #2b3646', textAlign: 'left' }}>
                          <th style={{ padding: '0.5rem' }}>Repository</th>
                          <th style={{ padding: '0.5rem' }}>Provider</th>
                          <th style={{ padding: '0.5rem' }}>Tracker Filter</th>
                          <th style={{ padding: '0.5rem' }}>Branch</th>
                          <th style={{ padding: '0.5rem' }}>Status</th>
                          <th style={{ padding: '0.5rem' }}>Last ETag / Sync</th>
                          <th style={{ padding: '0.5rem' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(state?.projects || []).map((p) => {
                          const prov = (p.provider || 'github').toLowerCase();
                          const etagKey = prov === 'github' ? p.repo : `${prov}:${p.repo}`;
                          const tc = p.trackerConfig || {};
                          const triggerParts = [];
                          if (prov === 'jira') {
                            triggerParts.push(`Key: ${tc.projectKey || '-'}`);
                            triggerParts.push(`Stage: ${tc.statusFilter || 'Ready for Agent'}`);
                          } else if (prov === 'asana') {
                            triggerParts.push(`GID: ${tc.projectGid || '-'}`);
                            triggerParts.push(`Stage: ${tc.statusFilter || 'Ready for Agent'}`);
                          } else if (prov === 'linear') {
                            triggerParts.push(`Project: ${tc.projectKey || p.repo}`);
                            triggerParts.push(`Stage: ${tc.statusFilter || 'Ready for Agent'}`);
                          } else {
                            triggerParts.push(tc.statusFilter ? `Stage: ${tc.statusFilter}` : 'state=open');
                          }
                          if (Array.isArray(tc.requiredLabels) && tc.requiredLabels.length > 0) {
                            triggerParts.push(`+Flags: [${tc.requiredLabels.join(', ')}]`);
                          }
                          if (Array.isArray(tc.excludedLabels) && tc.excludedLabels.length > 0) {
                            triggerParts.push(`-Exclude: [${tc.excludedLabels.join(', ')}]`);
                          }
                          if (tc.requiredCustomFields && Object.keys(tc.requiredCustomFields).length > 0) {
                            const cfStr = Object.entries(tc.requiredCustomFields)
                              .map(([k, v]) => `${k}=${v}`)
                              .join(', ');
                            triggerParts.push(`+Fields: [${cfStr}]`);
                          }
                          if (tc.assigneeFilter && tc.assigneeFilter !== 'any') {
                            triggerParts.push(`Assignee: ${tc.assigneeFilter}`);
                          }
                          const filterDesc = triggerParts.join(' · ');

                          return (
                            <tr
                              key={`${prov}:${p.repo}`}
                              data-testid={`project-row-${p.repo}`}
                              style={{ borderBottom: '1px solid #1e293b' }}
                            >
                              <td style={{ padding: '0.5rem' }}>
                                <strong>{p.repo}</strong>
                              </td>
                              <td style={{ padding: '0.5rem' }}>
                                <Badge color={prov === 'jira' ? 'blue' : prov === 'asana' ? 'red' : prov === 'linear' ? 'severity-medium' : 'grey'}>
                                  {prov.toUpperCase()}
                                </Badge>
                              </td>
                              <td style={{ padding: '0.5rem' }}>
                                <code>{filterDesc}</code>
                              </td>
                              <td style={{ padding: '0.5rem' }}>
                                <code>{p.defaultBranch || 'main'}</code>
                              </td>
                              <td style={{ padding: '0.5rem' }}>
                                <StatusIndicator type={p.paused ? 'stopped' : 'success'}>
                                  {p.paused ? 'PAUSED' : 'MONITORING'}
                                </StatusIndicator>
                              </td>
                              <td style={{ padding: '0.5rem' }}>
                                <code>{etagMap[etagKey] || etagMap[p.repo] || '-'}</code>
                              </td>
                              <td style={{ padding: '0.5rem', display: 'flex', gap: '0.4rem' }}>
                                <button
                                  data-testid={`toggle-proj-${p.repo}`}
                                  onClick={() => toggleProjectPause(p)}
                                  style={{
                                    background: '#334155',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '0.3rem 0.65rem',
                                    cursor: 'pointer',
                                  }}
                                >
                                  {p.paused ? 'Resume' : 'Pause'}
                                </button>
                                <button
                                  data-testid={`remove-proj-${p.repo}`}
                                  onClick={() => removeProject(p.repo)}
                                  style={{
                                    background: '#dc2626',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '0.3rem 0.65rem',
                                    cursor: 'pointer',
                                  }}
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </SpaceBetween>
                </Container>

                <Container header={<Header variant="h2">Ticket Intake & Automatic Classifier</Header>}>
                  <SpaceBetween size="m">
                    <ColumnLayout columns={4}>
                      <FormField label="Target Repository (owner/repo)">
                        <input
                          type="text"
                          id="intake-repo"
                          value={intakeRepo}
                          onChange={(e) => setIntakeRepo(e.target.value)}
                          placeholder="brenoacker/agentic-factory"
                          style={{
                            width: '100%',
                            padding: '0.45rem',
                            background: '#0f172a',
                            color: '#fff',
                            border: '1px solid #334155',
                            borderRadius: '4px',
                          }}
                        />
                      </FormField>
                      <FormField label="Issue #">
                        <input
                          type="number"
                          id="intake-issue-number"
                          value={intakeIssueNum}
                          onChange={(e) => setIntakeIssueNum(e.target.value)}
                          placeholder="101"
                          style={{
                            width: '100%',
                            padding: '0.45rem',
                            background: '#0f172a',
                            color: '#fff',
                            border: '1px solid #334155',
                            borderRadius: '4px',
                          }}
                        />
                      </FormField>
                      <FormField label="Ticket Title">
                        <input
                          type="text"
                          id="intake-title"
                          value={intakeTitle}
                          onChange={(e) => setIntakeTitle(e.target.value)}
                          placeholder="[feature] Add webhook signature check"
                          style={{
                            width: '100%',
                            padding: '0.45rem',
                            background: '#0f172a',
                            color: '#fff',
                            border: '1px solid #334155',
                            borderRadius: '4px',
                          }}
                        />
                      </FormField>
                      <FormField label="Explicit Type (optional)">
                        <select
                          id="intake-type"
                          value={intakeType}
                          onChange={(e) => setIntakeType(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '0.45rem',
                            background: '#0f172a',
                            color: '#fff',
                            border: '1px solid #334155',
                            borderRadius: '4px',
                          }}
                        >
                          <option value="">Auto-detect from title/body</option>
                          <option value="feature">feature</option>
                          <option value="bug">bug</option>
                          <option value="investigation">investigation</option>
                          <option value="discovery">discovery</option>
                          <option value="chore">chore</option>
                        </select>
                      </FormField>
                    </ColumnLayout>
                    <FormField label="Description / Context">
                      <input
                        type="text"
                        id="intake-body"
                        value={intakeBody}
                        onChange={(e) => setIntakeBody(e.target.value)}
                        placeholder="Problem statement, steps to reproduce, or investigation question"
                        style={{
                          width: '100%',
                          padding: '0.45rem',
                          background: '#0f172a',
                          color: '#fff',
                          border: '1px solid #334155',
                          borderRadius: '4px',
                        }}
                      />
                    </FormField>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <Button variant="primary" id="intake-submit-btn" disabled={intakingTicket} onClick={submitTicketIntake}>
                        {intakingTicket ? 'Intaking & Classifying...' : 'Intake & Classify Ticket'}
                      </Button>
                      <span id="intake-feedback" style={{ fontSize: '0.85rem', color: '#93c5fd' }}>
                        {intakeFeedback}
                      </span>
                    </div>
                  </SpaceBetween>
                </Container>

                <Container header={<Header variant="h2">Agents Waiting for Human Input & Clarification</Header>}>
                  <div id="waiting-human-screen" data-testid="waiting-human-screen">
                    <div id="needs-human-list">
                      {(st.needsHuman || []).length === 0 ? (
                        <Box color="text-body-secondary">No agents currently waiting for human input or clarification.</Box>
                      ) : (
                        <SpaceBetween size="m">
                          {st.needsHuman.map((item) => (
                            <div
                              key={item.executionKey}
                              data-testid={`needs-human-card-${item.issueNumber}`}
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.65rem',
                                padding: '0.85rem',
                                background: '#0f172a',
                                borderRadius: '6px',
                                border: '1px solid #f59e0b',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                  <Badge color="severity-medium">WAITING FOR HUMAN</Badge>{' '}
                                  <a
                                    id={`human-ticket-link-${item.issueNumber}`}
                                    data-testid={`human-ticket-link-${item.issueNumber}`}
                                    href={getTicketExternalUrl(st.tasks?.find((x) => x.execution_key === item.executionKey) || item)}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ color: '#60a5fa', textDecoration: 'underline', fontWeight: 700 }}
                                  >
                                    #{item.issueNumber} {item.title || item.executionKey} ↗
                                  </a>{' '}
                                  [{item.type}] — Stage:{' '}
                                  <Badge color="blue">{item.stage}</Badge>
                                </div>
                                <Box variant="small" color="text-body-secondary">
                                  Issue #{item.issueNumber}
                                </Box>
                              </div>

                              <div
                                data-testid={`human-question-${item.issueNumber}`}
                                style={{
                                  padding: '0.5rem 0.75rem',
                                  background: 'rgba(245, 158, 11, 0.12)',
                                  borderRadius: '4px',
                                  borderLeft: '4px solid #f59e0b',
                                  color: '#fef08a',
                                  fontSize: '0.9rem',
                                }}
                              >
                                <strong>⚠️ Clarification Needed:</strong> {item.question || 'Agent requested human assistance to proceed'}
                              </div>

                              {item.deliverable_url && (
                                <div
                                  id={`human-deliverable-${item.issueNumber}`}
                                  data-testid={`human-deliverable-${item.issueNumber}`}
                                  style={{
                                    padding: '0.5rem 0.75rem',
                                    background: '#0c131f',
                                    borderRadius: '4px',
                                    border: item.deliverable_type === 'pull_request' || item.deliverable_url.startsWith('http') ? '1px solid #38bdf8' : '1px solid #a78bfa',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '0.5rem',
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
                                    <span style={{ color: item.deliverable_type === 'pull_request' || item.deliverable_url.startsWith('http') ? '#38bdf8' : '#a78bfa', fontWeight: 700 }}>
                                      {item.deliverable_type === 'pull_request' || item.deliverable_url.startsWith('http') ? '🔗 Pull Request for Review:' : '📄 Deliverable Document:'}
                                    </span>
                                    {item.deliverable_url.startsWith('http') ? (
                                      <a
                                        href={item.deliverable_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        style={{ color: '#60a5fa', textDecoration: 'underline', fontWeight: 600 }}
                                      >
                                        {item.deliverable_url} ↗
                                      </a>
                                    ) : (
                                      <code style={{ color: '#e2e8f0' }}>{item.deliverable_ref || item.deliverable_url}</code>
                                    )}
                                  </div>
                                  <div>
                                    {item.deliverable_url.startsWith('http') ? (
                                      <Button
                                        variant="normal"
                                        onClick={() => window.open(item.deliverable_url, '_blank')}
                                      >
                                        Open PR ↗
                                      </Button>
                                    ) : (
                                      <Button
                                        variant="normal"
                                        onClick={() => openPreviewModal(item.deliverable_url, item.executionKey, item.deliverable_ref || item.deliverable_url)}
                                      >
                                        Preview Document
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              )}

                              {item.reviewFiles && item.reviewFiles.length > 0 && (
                                <div
                                  id={`human-review-files-${item.issueNumber}`}
                                  data-testid={`human-review-files-${item.issueNumber}`}
                                  style={{
                                    padding: '0.5rem 0.75rem',
                                    background: 'rgba(30, 41, 59, 0.7)',
                                    borderRadius: '4px',
                                    border: '1px solid #334155',
                                  }}
                                >
                                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#38bdf8', marginBottom: '0.35rem' }}>
                                    Evaluation & Review Files:
                                  </div>
                                  <SpaceBetween size="xs">
                                    {item.reviewFiles.map((rf, idx) => (
                                      <div
                                        key={rf.resolvedPath || idx}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'space-between',
                                          gap: '0.5rem',
                                          fontSize: '0.82rem',
                                        }}
                                      >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', wordBreak: 'break-all' }}>
                                          <span style={{ color: '#94a3b8' }}>📄 {rf.label}:</span>
                                          <a
                                            id={`vscode-link-${item.issueNumber}-${idx}`}
                                            data-testid={`vscode-link-${item.issueNumber}`}
                                            href={rf.vscodeUri || `vscode://file/${rf.resolvedPath}`}
                                            title="Open directly in VS Code / Keiro via vscode:// URI scheme"
                                            style={{ color: '#60a5fa', textDecoration: 'underline' }}
                                          >
                                            <code>{rf.path}</code>
                                          </a>
                                        </div>
                                        <SpaceBetween direction="horizontal" size="xs">
                                          <Button
                                            variant="normal"
                                            id={`open-editor-btn-${item.issueNumber}`}
                                            data-testid={`open-editor-btn-${item.issueNumber}`}
                                            onClick={() => openFileInEditor(rf.path, item.executionKey, rf.line)}
                                          >
                                            Open in Editor
                                          </Button>
                                          <Button
                                            variant="normal"
                                            id={`preview-doc-btn-${item.issueNumber}`}
                                            data-testid={`preview-doc-btn-${item.issueNumber}`}
                                            onClick={() => openPreviewModal(rf.path, item.executionKey, rf.label || rf.path)}
                                          >
                                            Preview Document
                                          </Button>
                                        </SpaceBetween>
                                      </div>
                                    ))}
                                  </SpaceBetween>
                                </div>
                              )}

                              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
                                <div style={{ flex: 1 }}>
                                  <FormField label="Operator Clarification / Missing Requirements">
                                    <input
                                      type="text"
                                      id={`human-reply-input-${item.issueNumber}`}
                                      data-testid={`human-reply-input-${item.issueNumber}`}
                                      value={humanReplies[item.executionKey] || ''}
                                      onChange={(e) =>
                                        setHumanReplies({
                                          ...humanReplies,
                                          [item.executionKey]: e.target.value,
                                        })
                                      }
                                      placeholder="Type missing API specs, parameters, or clarification here..."
                                      style={{
                                        width: '100%',
                                        padding: '0.5rem',
                                        background: '#0c131f',
                                        color: '#fff',
                                        border: '1px solid #475569',
                                        borderRadius: '4px',
                                        fontSize: '0.9rem',
                                      }}
                                    />
                                  </FormField>
                                </div>
                                <SpaceBetween direction="horizontal" size="xs">
                                  {item.stage === 'merge' ? (
                                    <Button
                                      variant="primary"
                                      id={`human-check-pr-btn-${item.issueNumber}`}
                                      data-testid={`human-check-pr-btn-${item.issueNumber}`}
                                      onClick={() => checkTaskPr(item.executionKey)}
                                    >
                                      Check PR Merge Status & Sync
                                    </Button>
                                  ) : (
                                    <Button
                                      variant="primary"
                                      id={`human-reply-btn-${item.issueNumber}`}
                                      data-testid={`human-reply-btn-${item.issueNumber}`}
                                      onClick={() => submitHumanReply(item.executionKey, humanReplies[item.executionKey])}
                                    >
                                      Send Reply & Resume Agent
                                    </Button>
                                  )}
                                  <Button
                                    variant="normal"
                                    id={`approve-btn-${item.issueNumber}`}
                                    data-testid={`approve-btn-${item.issueNumber}`}
                                    onClick={() => dispatchTicketKey(item.executionKey, true)}
                                  >
                                    1-Click Approve & Advance
                                  </Button>
                                </SpaceBetween>
                              </div>
                            </div>
                          ))}
                        </SpaceBetween>
                      )}
                    </div>
                  </div>
                </Container>

                <div
                  id="kanban-board"
                  data-testid="kanban-board"
                  style={{
                    display: 'grid',
                    gap: '0.85rem',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  }}
                >
                  {BOARD_COLUMNS.map((colDef) => {
                    const items = (st.tasks || []).filter((t) => getTaskBoardColumn(t) === colDef.id);
                    return (
                      <div key={colDef.id} id={`kanban-col-${colDef.id}`} data-testid={`kanban-col-${colDef.id}`}>
                        <Container
                          header={
                            <Header variant="h3" counter={`(${items.length})`}>
                              {colDef.label}
                            </Header>
                          }
                        >
                          <SpaceBetween size="xs">
                            {items.length === 0 ? (
                              <Box color="text-body-secondary" textAlign="center" padding={{ vertical: 's' }}>
                                No tasks
                              </Box>
                            ) : (
                              items.map((t) => {
                            const stalledInfo = stalledMap[t.execution_key];
                            return (
                              <div
                                key={t.execution_key}
                                data-testid={`task-card-${t.issue_number}`}
                                style={{
                                  padding: '0.65rem',
                                  background: '#0f172a',
                                  borderRadius: '6px',
                                  border: stalledInfo ? '2px solid #ef4444' : '1px solid #2b3646',
                                  fontSize: '0.82rem',
                                }}
                              >
                                <strong>
                                  <a
                                    id={`kanban-ticket-link-${t.issue_number}`}
                                    data-testid={`kanban-ticket-link-${t.issue_number}`}
                                    href={getTicketExternalUrl(t)}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ color: '#93c5fd', textDecoration: 'none' }}
                                    onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                                    onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                                  >
                                    #{t.issue_number} {t.title} ↗
                                  </a>
                                </strong>
                                <div
                                  style={{
                                    display: 'flex',
                                    gap: '0.35rem',
                                    flexWrap: 'wrap',
                                    margin: '0.35rem 0',
                                  }}
                                >
                                  <span
                                    data-testid={`task-repo-${t.issue_number}`}
                                    style={{
                                      background: '#312e81',
                                      color: '#e0e7ff',
                                      padding: '0.1rem 0.45rem',
                                      borderRadius: '4px',
                                      fontSize: '0.72rem',
                                      fontWeight: 600,
                                    }}
                                  >
                                    {t.repo}
                                  </span>
                                  <span
                                    data-testid={`task-type-${t.issue_number}`}
                                    style={{
                                      background: '#1e293b',
                                      color: '#f8fafc',
                                      padding: '0.1rem 0.45rem',
                                      borderRadius: '4px',
                                      fontSize: '0.72rem',
                                      fontWeight: 600,
                                    }}
                                  >
                                    {t.type}
                                  </span>
                                  <span
                                    data-testid={`task-stage-${t.issue_number}`}
                                    id={`task-stage-badge-${t.issue_number}`}
                                    data-stage={t.stage}
                                    style={{
                                      background: t.needs_human ? '#78350f' : '#064e3b',
                                      color: '#fff',
                                      padding: '0.1rem 0.45rem',
                                      borderRadius: '4px',
                                      fontSize: '0.72rem',
                                      fontWeight: 600,
                                    }}
                                  >
                                    <span data-testid={`task-stage-badge-${t.issue_number}`}>
                                      {t.stage}
                                    </span>
                                  </span>
                                  {stalledInfo && (
                                    <span
                                      data-testid={`task-stalled-badge-${t.issue_number}`}
                                      style={{
                                        background: '#991b1b',
                                        color: '#fff',
                                        padding: '0.1rem 0.45rem',
                                        borderRadius: '4px',
                                        fontSize: '0.72rem',
                                        fontWeight: 700,
                                      }}
                                    >
                                      STALLED ({stalledInfo.idleMinutes}m)
                                    </span>
                                  )}
                                </div>
                                <small style={{ color: '#9ba7b6' }}>
                                  {t.runtime} / {t.model} · ${Number(t.cost_usd || 0).toFixed(4)}
                                </small>
                                {t.branch_name && (
                                  <div style={{ fontSize: '0.72rem', color: '#9ba7b6', marginTop: '0.2rem' }} data-testid={`task-branch-${t.issue_number}`}>
                                    🌿 Branch: <code style={{ color: '#38bdf8' }}>{t.branch_name}</code>
                                  </div>
                                )}
                                {t.workspace_path && (
                                  <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '0.1rem', wordBreak: 'break-all' }} data-testid={`task-ws-${t.issue_number}`}>
                                    📁 Workspace: <code>{t.workspace_path}</code>
                                  </div>
                                )}
                                {t.deliverable_url && (
                                  <div style={{ marginTop: '0.35rem', padding: '0.25rem 0.4rem', background: '#0f172a', borderRadius: '4px', border: '1px solid #1e293b' }} data-testid={`task-deliverable-${t.issue_number}`}>
                                    <span style={{ fontSize: '0.72rem', fontWeight: 600, color: t.deliverable_type === 'pull_request' ? '#38bdf8' : '#a78bfa' }}>
                                      {t.deliverable_type === 'pull_request' ? '🔗 Pull Request: ' : '📄 Research Doc: '}
                                    </span>
                                    <a
                                      href={t.deliverable_url.startsWith('http') ? t.deliverable_url : `/api/tickets/${encodeURIComponent(t.execution_key)}/deliverable`}
                                      target={t.deliverable_url.startsWith('http') ? '_blank' : '_self'}
                                      onClick={(e) => {
                                        if (!t.deliverable_url.startsWith('http')) {
                                          e.preventDefault();
                                          openPreviewModal(t.deliverable_url, t.execution_key, t.deliverable_ref || t.deliverable_url);
                                        }
                                      }}
                                      rel="noreferrer"
                                      style={{ fontSize: '0.72rem', color: '#38bdf8', textDecoration: 'underline', cursor: 'pointer' }}
                                    >
                                      {t.deliverable_ref || t.deliverable_url}
                                    </a>
                                  </div>
                                )}
                                {t.reviewFiles && t.reviewFiles.length > 0 && (
                                  <div
                                    data-testid={`task-review-files-${t.issue_number}`}
                                    style={{
                                      marginTop: '0.35rem',
                                      padding: '0.25rem 0.4rem',
                                      background: '#0f172a',
                                      borderRadius: '4px',
                                      border: '1px solid #1e293b',
                                    }}
                                  >
                                    <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#38bdf8', marginBottom: '0.2rem' }}>
                                      📄 Review Files:
                                    </div>
                                    {t.reviewFiles.map((rf, idx) => (
                                      <div
                                        key={rf.resolvedPath || idx}
                                        style={{
                                          display: 'flex',
                                          justifyContent: 'space-between',
                                          alignItems: 'center',
                                          gap: '0.3rem',
                                          marginTop: '0.15rem',
                                        }}
                                      >
                                        <a
                                          href={rf.vscodeUri || `vscode://file/${rf.resolvedPath}`}
                                          data-testid={`kanban-vscode-link-${t.issue_number}`}
                                          title="Open in VS Code"
                                          style={{ fontSize: '0.72rem', color: '#60a5fa', textDecoration: 'underline' }}
                                        >
                                          {rf.label || rf.path}
                                        </a>
                                        <div style={{ display: 'flex', gap: '0.2rem' }}>
                                          <button
                                            id={`kanban-open-editor-${t.issue_number}-${idx}`}
                                            data-testid={`kanban-open-editor-${t.issue_number}`}
                                            onClick={() => openFileInEditor(rf.path, t.execution_key, rf.line)}
                                            style={{
                                              fontSize: '0.65rem',
                                              padding: '1px 5px',
                                              background: '#1e293b',
                                              color: '#93c5fd',
                                              border: '1px solid #334155',
                                              borderRadius: '3px',
                                              cursor: 'pointer',
                                            }}
                                          >
                                            Editor
                                          </button>
                                          <button
                                            id={`kanban-preview-btn-${t.issue_number}-${idx}`}
                                            data-testid={`kanban-preview-btn-${t.issue_number}`}
                                            onClick={() => openPreviewModal(rf.path, t.execution_key, rf.label || rf.path)}
                                            style={{
                                              fontSize: '0.65rem',
                                              padding: '1px 5px',
                                              background: '#1e293b',
                                              color: '#a78bfa',
                                              border: '1px solid #334155',
                                              borderRadius: '3px',
                                              cursor: 'pointer',
                                            }}
                                          >
                                            Preview
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {t.stage === 'merge' && (
                                  <div
                                    data-testid={`pr-status-box-${t.issue_number}`}
                                    style={{
                                      marginTop: '0.35rem',
                                      padding: '0.35rem 0.5rem',
                                      background: '#1e293b',
                                      border: '1px solid #3b82f6',
                                      borderRadius: '4px',
                                      fontSize: '0.75rem',
                                      color: '#93c5fd',
                                    }}
                                  >
                                    ⏳ <strong>Awaiting GitHub Merge:</strong> Pull Request is open. Awaiting review and merge on GitHub.
                                  </div>
                                )}
                                {t.stage !== 'done' && (
                                  <div style={{ marginTop: '0.45rem' }}>
                                    {t.stage === 'merge' ? (
                                      <Button
                                        variant="primary"
                                        id={`check-pr-btn-${t.issue_number}`}
                                        data-testid={`check-pr-btn-${t.issue_number}`}
                                        onClick={() => checkTaskPr(t.execution_key)}
                                      >
                                        Check PR Merge Status & Sync
                                      </Button>
                                    ) : (
                                      <Button
                                        variant="primary"
                                        disabled={Boolean(dispatchingKeys[t.execution_key])}
                                        data-testid={`dispatch-btn-${t.issue_number}`}
                                        onClick={() => dispatchTicketKey(t.execution_key, t.needs_human === 1)}
                                      >
                                        {dispatchingKeys[t.execution_key]
                                          ? `Executing Stage (${t.stage})...`
                                          : t.needs_human === 1
                                          ? 'Approve & Continue'
                                          : 'Run Workflow'}
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          }))}
                        </SpaceBetween>
                      </Container>
                    </div>
                  );
                })}
                </div>
              </SpaceBetween>
            </section>

            {/* TAB 3: WORKFLOWS (VISUAL MERMAID + LIVE DESIGNER) */}
            <section id="tab-workflows" style={{ display: activeTab === 'workflows' ? 'block' : 'none' }}>
              <SpaceBetween size="l">
                <Container
                  header={
                    <Header
                      variant="h2"
                      description="Interactive Mermaid visual flowchart and live stage editor. Modifying stages updates the diagram in real time."
                    >
                      Visual Workflow Designer & Stage Flowchart
                    </Header>
                  }
                >
                  <SpaceBetween size="m">
                    <ColumnLayout columns={3}>
                      <FormField label="Active Workflow">
                        <select
                          id="wf-editor-select"
                          value={selectedWf}
                          onChange={(e) => handleSelectWorkflow(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '0.45rem',
                            background: '#0f172a',
                            color: '#fff',
                            border: '1px solid #334155',
                            borderRadius: '4px',
                          }}
                        >
                          <option value="feature">feature (Feature Workflow)</option>
                          <option value="bug">bug (Bug Fix Workflow)</option>
                          <option value="investigation">investigation (Investigation Spike)</option>
                          <option value="discovery">discovery (PRD Discovery Workflow)</option>
                          <option value="chore">chore (Maintenance Chore)</option>
                        </select>
                      </FormField>

                      <FormField label="Autonomy Level">
                        <select
                          id="wf-autonomy-select"
                          value={currentWfObj?.autonomy || 'gated'}
                          onChange={(e) => updateWfAutonomy(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '0.45rem',
                            background: '#0f172a',
                            color: '#fff',
                            border: '1px solid #334155',
                            borderRadius: '4px',
                          }}
                        >
                          <option value="manual">manual (Every stage requires human run)</option>
                          <option value="triage">triage (Auto-triage only)</option>
                          <option value="gated">gated (Autonomous coding, pauses at human gates)</option>
                          <option value="auto-low">auto-low (Auto-merge low impact on approval)</option>
                        </select>
                      </FormField>

                      <FormField label="Review Rounds Limit">
                        <input
                          type="number"
                          id="wf-review-rounds-input"
                          value={currentWfObj?.maxReviewRounds || 3}
                          onChange={(e) => {
                            if (!currentWfObj) return;
                            const next = structuredClone(currentWfObj);
                            next.maxReviewRounds = Number(e.target.value);
                            setCurrentWfObj(next);
                            setWfJson(JSON.stringify(next, null, 2));
                          }}
                          style={{
                            width: '100%',
                            padding: '0.45rem',
                            background: '#0f172a',
                            color: '#fff',
                            border: '1px solid #334155',
                            borderRadius: '4px',
                          }}
                        />
                      </FormField>
                    </ColumnLayout>

                    {/* Mermaid Visual Diagram Box */}
                    <Box margin={{ top: 's', bottom: 's' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <Box variant="h3">Visual Stage Flow (Mermaid Diagram)</Box>
                        <SpaceBetween direction="horizontal" size="xs">
                          <Badge color="severity-medium">Amber = Human Gate</Badge>
                          <Badge color="blue">Blue = Automated Stage</Badge>
                          <Badge color="green">Green = Terminal Done</Badge>
                        </SpaceBetween>
                      </div>
                      <MermaidRenderer code={mermaidCode} id={selectedWf} />
                    </Box>

                    {/* Interactive Stage-by-Stage Modifier Form */}
                    <Container header={<Header variant="h3">Modify Stages & Gates</Header>}>
                      <SpaceBetween size="s">
                        {(currentWfObj?.stages || []).map((stg, idx) => (
                          <div
                            key={`${stg.id}-${idx}`}
                            style={{
                              padding: '0.75rem',
                              background: '#0c131f',
                              border: stg.humanApproval || stg.mode === 'human' ? '1px solid #f59e0b' : '1px solid #1f2937',
                              borderRadius: '6px',
                              display: 'grid',
                              gridTemplateColumns: '120px 140px 180px 1fr auto',
                              gap: '0.75rem',
                              alignItems: 'center',
                            }}
                          >
                            <div>
                              <strong style={{ color: '#60a5fa' }}>#{idx + 1} {stg.id}</strong>
                            </div>
                            <div>
                              <label style={{ fontSize: '0.8rem', color: '#9ba7b6' }}>
                                Agent:{' '}
                                <select
                                  value={stg.agent || 'builder'}
                                  onChange={(e) => updateStageField(idx, 'agent', e.target.value)}
                                  style={{
                                    padding: '0.25rem',
                                    background: '#161d26',
                                    color: '#fff',
                                    border: '1px solid #334155',
                                    borderRadius: '4px',
                                  }}
                                >
                                  {KNOWN_AGENTS.map((ag) => (
                                    <option key={ag} value={ag}>
                                      {ag}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                            <div>
                              <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.8rem' }}>
                                <input
                                  type="checkbox"
                                  checked={Boolean(stg.humanApproval || stg.mode === 'human')}
                                  onChange={(e) => updateStageField(idx, 'humanApproval', e.target.checked)}
                                />
                                Human Gate Pause
                              </label>
                            </div>
                            <div>
                              <small style={{ color: '#94a3b8' }}>
                                Skills: {(stg.skills || []).join(', ')}
                              </small>
                            </div>
                            <div>
                              <Badge color={stg.humanApproval || stg.mode === 'human' ? 'severity-medium' : 'blue'}>
                                {stg.humanApproval || stg.mode === 'human' ? 'HUMAN' : 'AUTO'}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </SpaceBetween>
                    </Container>

                    {/* Advanced JSON Editor with Validation & Commit */}
                    <ExpandableSection defaultExpanded headerText="Advanced: Raw Workflow JSON Editor">
                      <SpaceBetween size="s">
                        <textarea
                          id="wf-editor-json"
                          rows={8}
                          value={wfJson}
                          onChange={(e) => {
                            setWfJson(e.target.value);
                            try {
                              const parsed = JSON.parse(e.target.value);
                              setCurrentWfObj(parsed);
                            } catch {
                              // keep raw text
                            }
                          }}
                          style={{
                            width: '100%',
                            padding: '0.6rem',
                            background: '#0f172a',
                            color: '#f8fafc',
                            border: '1px solid #334155',
                            borderRadius: '4px',
                            fontFamily: 'monospace',
                          }}
                        />
                      </SpaceBetween>
                    </ExpandableSection>

                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <Button variant="primary" id="wf-editor-save-btn" onClick={saveWorkflowFromEditor}>
                        Validate & Save Workflow to workflows/{selectedWf}.yaml
                      </Button>
                      <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem' }}>
                        <input
                          type="checkbox"
                          id="wf-editor-commit-check"
                          checked={wfCommit}
                          onChange={(e) => setWfCommit(e.target.checked)}
                        />
                        Commit change to git directly
                      </label>
                      <span id="wf-editor-status" style={{ fontSize: '0.85rem', color: '#93c5fd' }}>
                        {wfStatus}
                      </span>
                    </div>
                  </SpaceBetween>
                </Container>

                <div id="workflows-list">
                  {Object.values(state?.workflows || {}).map((wf) => (
                    <div
                      key={wf.id}
                      className="card"
                      data-testid={`workflow-card-${wf.id}`}
                      style={{ marginBottom: '1rem' }}
                    >
                      <Container
                        header={
                          <Header variant="h2" description={wf.description}>
                            Workflow: {wf.id} ({wf.label}) — Autonomy: {wf.autonomy}
                          </Header>
                        }
                      >
                        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
                          {(wf.stages || []).map((s) => (
                            <div
                              key={s.id}
                              style={{
                                padding: '0.6rem 0.85rem',
                                background: '#0f172a',
                                border:
                                  s.humanApproval || s.mode === 'human'
                                    ? '1px solid #f59e0b'
                                    : '1px solid #2b3646',
                                borderRadius: '6px',
                                fontSize: '0.82rem',
                              }}
                            >
                              <strong>{s.id}</strong> ({s.humanApproval || s.mode === 'human' ? 'HUMAN' : 'AUTO'})
                              <br />
                              Agent: {s.agent}
                              <br />
                              Skills: {(s.skills || []).join(', ')}
                            </div>
                          ))}
                        </div>
                      </Container>
                    </div>
                  ))}
                </div>
              </SpaceBetween>
            </section>

            {/* TAB 4: RUNTIMES */}
            <section id="tab-runtimes" style={{ display: activeTab === 'runtimes' ? 'block' : 'none' }}>
              <Container header={<Header variant="h2">Runtime Router & Circuit Breaker</Header>}>
                <SpaceBetween size="m">
                  <Alert
                    type="info"
                    data-testid="circuit-breaker-explainer"
                    header="Why this exists: Automatic Cost and Rate-Limit Protection"
                  >
                    The Circuit Breaker automatically pauses a malfunctioning AI runtime (e.g. Anthropic Claude, Gemini, Codex) when it encounters consecutive network timeouts or rate-limit errors. This prevents runaway billing and infinite loops. Operators can click <strong>Reset</strong> to resume once upstream services stabilize.
                  </Alert>
                  <table id="circuit-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #2b3646', textAlign: 'left' }}>
                      <th style={{ padding: '0.6rem' }}>Runtime</th>
                      <th style={{ padding: '0.6rem' }}>Status</th>
                      <th style={{ padding: '0.6rem' }}>Remaining Quota</th>
                      <th style={{ padding: '0.6rem' }}>Consecutive Failures</th>
                      <th style={{ padding: '0.6rem' }}>Last Error</th>
                      <th style={{ padding: '0.6rem' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(state?.runtimeHealth || []).map((r) => (
                      <tr
                        key={r.runtime}
                        data-testid={`circuit-row-${r.runtime}`}
                        style={{ borderBottom: '1px solid #1e293b' }}
                      >
                        <td style={{ padding: '0.6rem' }}>
                          <strong>{r.runtime}</strong>
                        </td>
                        <td style={{ padding: '0.6rem' }}>
                          <StatusIndicator type={r.status === 'closed' ? 'success' : 'error'}>
                            {r.status.toUpperCase()}
                          </StatusIndicator>
                        </td>
                        <td style={{ padding: '0.6rem' }}>{r.quota_remaining}</td>
                        <td style={{ padding: '0.6rem' }}>{r.consecutive_failures}</td>
                        <td style={{ padding: '0.6rem' }}>{r.last_error_code || '-'}</td>
                        <td style={{ padding: '0.6rem' }}>
                          <Button
                            variant="primary"
                            data-testid={`reset-circuit-${r.runtime}`}
                            onClick={() => resetCircuit(r.runtime)}
                          >
                            Reset Circuit Breaker
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </SpaceBetween>
              </Container>
            </section>

            {/* TAB 5: AGENTS & LOCKED SKILLS */}
            <section id="tab-agents" style={{ display: activeTab === 'agents' ? 'block' : 'none' }}>
              <SpaceBetween size="l">
                <div
                  id="agents-grid"
                  style={{
                    display: 'grid',
                    gap: '1rem',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  }}
                >
                  {(state?.agents || []).map((a) => (
                    <div key={a.id} className="card" data-testid={`agent-card-${a.id}`}>
                      <Container header={<Header variant="h3">{a.name}</Header>}>
                        <Box variant="small" color="text-body-secondary">
                          {a.responsibility}
                        </Box>
                        <Box margin={{ top: 'xs' }} variant="small">
                          <strong>Skills:</strong> {(a.skills || []).join(', ')}
                        </Box>
                      </Container>
                    </div>
                  ))}
                </div>

                <Container header={<Header variant="h2">Vendored & Locked Skills (skills.lock.json)</Header>}>
                  <table id="skills-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #2b3646', textAlign: 'left' }}>
                        <th style={{ padding: '0.5rem' }}>Skill</th>
                        <th style={{ padding: '0.5rem' }}>Category</th>
                        <th style={{ padding: '0.5rem' }}>Version</th>
                        <th style={{ padding: '0.5rem' }}>SHA-256</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(state?.skills || []).map((s) => (
                        <tr
                          key={s.name}
                          data-testid={`skill-row-${s.name}`}
                          style={{ borderBottom: '1px solid #1e293b' }}
                        >
                          <td style={{ padding: '0.5rem' }}>
                            <strong>{s.name}</strong>
                          </td>
                          <td style={{ padding: '0.5rem' }}>{s.category}</td>
                          <td style={{ padding: '0.5rem' }}>
                            <Badge color="green">{s.version}</Badge>
                          </td>
                          <td style={{ padding: '0.5rem' }}>
                            <code>{String(s.sha256 || '').slice(0, 16)}…</code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Container>
              </SpaceBetween>
            </section>

            {/* TAB 6: CONTROLS, DEPLOY & BRAIN */}
            <section id="tab-controls" style={{ display: activeTab === 'controls' ? 'block' : 'none' }}>
              <Grid gridDefinition={[{ colspan: 4 }, { colspan: 4 }, { colspan: 4 }]}>
                <Container header={<Header variant="h2">Operational Controls</Header>}>
                  <SpaceBetween size="s">
                    <Alert type="info" data-testid="controls-explainer">
                      Factory governance: configure autonomy level, hourly throughput, daily budget limits, and maximum simultaneous running agents.
                    </Alert>
                    <FormField label="Autonomy Mode">
                      <select
                        id="ctrl-autonomy"
                        value={ctrlAutonomy}
                        onChange={(e) => setCtrlAutonomy(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '0.45rem',
                          background: '#0f172a',
                          color: '#fff',
                          border: '1px solid #334155',
                          borderRadius: '4px',
                        }}
                      >
                        <option value="manual">manual</option>
                        <option value="triage">triage</option>
                        <option value="gated">gated</option>
                        <option value="auto-low">auto-low</option>
                      </select>
                    </FormField>
                    <FormField label="Hourly Task Limit">
                      <input
                        type="number"
                        id="ctrl-rate"
                        value={ctrlRate}
                        onChange={(e) => setCtrlRate(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '0.45rem',
                          background: '#0f172a',
                          color: '#fff',
                          border: '1px solid #334155',
                          borderRadius: '4px',
                        }}
                      />
                    </FormField>
                    <FormField label="Daily Budget (USD)">
                      <input
                        type="number"
                        id="ctrl-budget"
                        step="0.5"
                        value={ctrlBudget}
                        onChange={(e) => setCtrlBudget(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '0.45rem',
                          background: '#0f172a',
                          color: '#fff',
                          border: '1px solid #334155',
                          borderRadius: '4px',
                        }}
                      />
                    </FormField>
                    <FormField
                      label="Max Concurrent Running Agents (1 to 10, default: 3)"
                      description="Bounds maximum active simultaneous agent tasks running across all monitored repos"
                    >
                      <input
                        type="number"
                        id="ctrl-concurrent"
                        min="1"
                        max="10"
                        step="1"
                        value={ctrlConcurrent}
                        onChange={(e) => setCtrlConcurrent(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '0.45rem',
                          background: '#0f172a',
                          color: '#fff',
                          border: '1px solid #334155',
                          borderRadius: '4px',
                        }}
                      />
                    </FormField>
                    <FormField label="Stall Alarm Threshold (minutes)">
                      <input
                        type="number"
                        id="ctrl-stall-minutes"
                        value={ctrlStallMinutes}
                        onChange={(e) => setCtrlStallMinutes(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '0.45rem',
                          background: '#0f172a',
                          color: '#fff',
                          border: '1px solid #334155',
                          borderRadius: '4px',
                        }}
                      />
                    </FormField>
                    <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        id="ctrl-kill"
                        checked={ctrlKill}
                        onChange={(e) => setCtrlKill(e.target.checked)}
                      />
                      Global Kill Switch (Pause Factory)
                    </label>
                    <Button variant="primary" id="save-controls-btn" disabled={savingControls} onClick={saveControls}>
                      {savingControls ? 'Saving Controls...' : 'Save Controls to factory.yaml'}
                    </Button>
                    <div id="controls-feedback" style={{ fontSize: '0.85rem', color: '#93c5fd' }}>
                      {controlsFeedback}
                    </div>
                  </SpaceBetween>
                </Container>

                <Container header={<Header variant="h2">Post-Deploy Gate & Automatic Rollback</Header>}>
                  <SpaceBetween size="s">
                    <Alert type="info" data-testid="deploy-gate-explainer">
                      Monitors live production canary metrics post-deploy. If error rates exceed your threshold, it automatically triggers an instant rollback to the last known healthy commit (<code>last_good_sha</code>).
                    </Alert>
                    <FormField label="Commit SHA">
                      <input
                        type="text"
                        id="deploy-sha"
                        value={deploySha}
                        onChange={(e) => setDeploySha(e.target.value)}
                        placeholder="a1b2c3d"
                        style={{
                          width: '100%',
                          padding: '0.45rem',
                          background: '#0f172a',
                          color: '#fff',
                          border: '1px solid #334155',
                          borderRadius: '4px',
                        }}
                      />
                    </FormField>
                    <FormField label="Error Rate (%)">
                      <input
                        type="number"
                        id="deploy-error-rate"
                        step="0.1"
                        value={deployErrorRate}
                        onChange={(e) => setDeployErrorRate(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '0.45rem',
                          background: '#0f172a',
                          color: '#fff',
                          border: '1px solid #334155',
                          borderRadius: '4px',
                        }}
                      />
                    </FormField>
                    <FormField label="Max Allowed (%)">
                      <input
                        type="number"
                        id="deploy-max-rate"
                        step="0.1"
                        value={deployMaxRate}
                        onChange={(e) => setDeployMaxRate(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '0.45rem',
                          background: '#0f172a',
                          color: '#fff',
                          border: '1px solid #334155',
                          borderRadius: '4px',
                        }}
                      />
                    </FormField>
                    <Button variant="primary" id="deploy-verify-btn" onClick={verifyDeploymentFromUi}>
                      Verify Deployment
                    </Button>
                    <div id="deploy-feedback" style={{ fontSize: '0.85rem', color: '#93c5fd' }}>
                      {deployFeedback}
                    </div>
                    <div id="deployments-list">
                      {(state?.deployments || []).map((d) => (
                        <div
                          key={`${d.id}-${d.commit_sha}`}
                          data-testid={`deploy-card-${d.commit_sha}`}
                          style={{
                            padding: '0.5rem',
                            marginTop: '0.4rem',
                            background: '#0f172a',
                            borderRadius: '4px',
                            border: '1px solid #2b3646',
                          }}
                        >
                          <strong>{d.commit_sha}</strong> —{' '}
                          <Badge color={d.status === 'healthy' ? 'green' : 'red'}>{d.status}</Badge>
                          <br />
                          <small>Last good SHA: {d.last_good_sha || '-'}</small>
                        </div>
                      ))}
                    </div>
                  </SpaceBetween>
                </Container>

                <Container header={<Header variant="h2">Factory Brain (Long-Term Memory)</Header>}>
                  <SpaceBetween size="s">
                    <Alert type="info" data-testid="brain-explainer">
                      Persistent cross-ticket repository memory: stores architectural decision records, team conventions, and run postmortems so agents never repeat past mistakes.
                    </Alert>
                    <div id="brain-list">
                      <SpaceBetween size="xs">
                        {(state?.brain || []).map((b) => (
                          <div
                            key={b.source}
                            data-testid={`brain-card-${b.source}`}
                            style={{
                              padding: '0.6rem',
                              background: '#0f172a',
                              borderRadius: '6px',
                              border: '1px solid #2b3646',
                            }}
                          >
                            <strong>{b.source}</strong> ({b.kind})
                            <Box variant="small" color="text-body-secondary">
                              {String(b.content || '').slice(0, 140)}...
                            </Box>
                          </div>
                        ))}
                      </SpaceBetween>
                    </div>
                  </SpaceBetween>
                </Container>
              </Grid>
            </section>
          </ContentLayout>
        }
      />
      <Modal
        visible={previewModalOpen}
        onDismiss={() => setPreviewModalOpen(false)}
        header={<Header variant="h2">{previewDoc.title || 'Document Preview'}</Header>}
        footer={
          <Box float="right">
            <Button
              variant="primary"
              id="close-preview-modal-btn"
              data-testid="close-preview-modal-btn"
              onClick={() => setPreviewModalOpen(false)}
            >
              Close
            </Button>
          </Box>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
            Path: <code>{previewDoc.path}</code>
          </div>
          {previewDoc.loading && <Box color="text-body-secondary">Loading file content...</Box>}
          {previewDoc.error && (
            <Alert type="error" header="Failed to load file">
              {previewDoc.error}
            </Alert>
          )}
          {!previewDoc.loading && !previewDoc.error && (
            <MarkdownDocumentViewer
              content={previewDoc.content}
              filePath={previewDoc.path}
              extension={previewDoc.extension}
            />
          )}
        </div>
      </Modal>
      </div>
    </div>
  );
}

const rootEl = document.getElementById('app');
if (rootEl) {
  createRoot(rootEl).render(<ControlPanelApp />);
}
