import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import '@cloudscape-design/global-styles/index.css';
import { applyMode, Mode } from '@cloudscape-design/global-styles';
import {
  Alert,
  Badge,
  Box,
  Button,
  Cards,
  ColumnLayout,
  Container,
  FormField,
  Grid,
  Header,
  SpaceBetween,
  StatusIndicator,
  Table,
  Tabs,
  TopNavigation,
} from '@cloudscape-design/components';

applyMode(Mode.Dark);

const TABS = [
  { id: 'overview', label: 'Overview & Telemetry' },
  { id: 'board', label: 'Board & Needs Human' },
  { id: 'workflows', label: 'Workflows (Factory as Code)' },
  { id: 'runtimes', label: 'Runtimes, Router & Circuit Breaker' },
  { id: 'agents', label: 'Agents & Locked Skills (23)' },
  { id: 'controls', label: 'Controls, Deploy & Brain' },
];

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

function ControlPanelApp() {
  const [state, setState] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');

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

  // Workflow editor form state
  const [selectedWf, setSelectedWf] = useState('feature');
  const [wfJson, setWfJson] = useState('');
  const [wfStatus, setWfStatus] = useState('');

  // Operational controls form state
  const [ctrlAutonomy, setCtrlAutonomy] = useState('gated');
  const [ctrlRate, setCtrlRate] = useState('10');
  const [ctrlBudget, setCtrlBudget] = useState('25');
  const [ctrlStallMinutes, setCtrlStallMinutes] = useState('30');
  const [ctrlKill, setCtrlKill] = useState(false);
  const [controlsFeedback, setControlsFeedback] = useState('');

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
      setCtrlStallMinutes(String(f.limits?.stallThresholdMinutes ?? 30));
      setCtrlKill(Boolean(f.killSwitch));
    }
    if (data?.scheduler) {
      setSchedulerEnabled(Boolean(data.scheduler.enabled));
      setSchedulerInterval(String(data.scheduler.intervalSeconds ?? 60));
    }
    setWfJson((prev) => {
      if (prev) return prev;
      const wf = data?.workflows?.[selectedWf];
      return wf ? JSON.stringify(wf, null, 2) : '';
    });
  }, [selectedWf]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const handleSelectWorkflow = (wfId) => {
    setSelectedWf(wfId);
    const wf = state?.workflows?.[wfId];
    if (wf) {
      setWfJson(JSON.stringify(wf, null, 2));
    }
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
    } else {
      setProjFeedback(`Error: ${data.error}`);
    }
    await loadDashboard();
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
    } else {
      setIntakeFeedback(`Error: ${data.error || 'Intake failed'}`);
    }
    await loadDashboard();
  };

  const dispatchTicketKey = async (key, approveCurrentStage = false) => {
    await fetch('/api/tickets/' + encodeURIComponent(key) + '/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approveCurrentStage }),
    });
    await loadDashboard();
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
      body: JSON.stringify({ workflow: parsed, commit: false }),
    });
    const data = await res.json();
    if (res.ok) {
      setWfStatus(`Saved workflow ${selectedWf} (${res.status})`);
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
    const res = await fetch('/api/controls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        autonomy: ctrlAutonomy,
        maxTasksPerHour: Number(ctrlRate),
        dailyBudgetUsd: Number(ctrlBudget),
        stallThresholdMinutes: Number(ctrlStallMinutes),
        killSwitch: ctrlKill,
      }),
    });
    setControlsFeedback(res.ok ? 'Controls saved' : 'Failed to save controls');
    await loadDashboard();
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
    reviewMetrics: { firstRoundApprovalRate: 100, averageReviewRounds: 0 },
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

  return (
    <div id="cloudscape-root" data-testid="cloudscape-app-shell" className="awsui-dark-mode">
      <TopNavigation
        identity={{
          href: '#',
          title: 'Agentic Factory — AWS Cloudscape Control Panel',
        }}
        utilities={[
          {
            type: 'button',
            text: 'tlc-spec-lean v2.2.0',
          },
        ]}
      />

      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0.75rem 1.5rem',
          background: '#0f1b2a',
          borderBottom: '1px solid #232f3e',
        }}
      >
        <SpaceBetween direction="horizontal" size="s" alignItems="center">
          <Box variant="h3" margin="n">
            Agentic Factory
          </Box>
          <Badge color="blue">AWS Cloudscape Design System</Badge>
          <Badge color="severity-medium">tlc-spec-lean v2.2.0</Badge>
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
        <div>
          <button
            id="refresh-telemetry-btn"
            className="awsui-btn-primary"
            onClick={loadDashboard}
            style={{
              background: '#0972d3',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              padding: '0.45rem 0.9rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Refresh Telemetry
          </button>
        </div>
      </header>

      <nav
        id="tabs"
        style={{
          display: 'flex',
          gap: '0.5rem',
          padding: '0.6rem 1.5rem',
          background: '#161d26',
          borderBottom: '1px solid #2b3646',
          flexWrap: 'wrap',
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            data-tab={t.id}
            className={activeTab === t.id ? 'active' : ''}
            onClick={() => setActiveTab(t.id)}
            style={{
              background: activeTab === t.id ? '#0972d3' : 'transparent',
              color: activeTab === t.id ? '#ffffff' : '#9ba7b6',
              border: '1px solid',
              borderColor: activeTab === t.id ? '#0972d3' : '#2b3646',
              borderRadius: '6px',
              padding: '0.4rem 0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main style={{ padding: '1.25rem 1.5rem', maxWidth: '1540px', margin: '0 auto' }}>
        {stalledList.length > 0 && (
          <div
            id="stalled-alarm-banner"
            data-testid="stalled-alarm-banner"
            style={{ marginBottom: '1.25rem' }}
          >
            <Alert
              type="error"
              header={`STALLED TASK ALARM — ${stalledList.length} TASK(S) IDLE BEYOND ${f.limits?.stallThresholdMinutes || 30} MIN THRESHOLD`}
            >
              <SpaceBetween size="s">
                {stalledList.map((item) => (
                  <div
                    key={item.executionKey}
                    data-testid={`alarm-item-${item.issueNumber}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '1rem',
                      padding: '0.6rem',
                      background: 'rgba(127, 29, 29, 0.35)',
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
                      <button
                        data-testid={`alarm-act-btn-${item.issueNumber}`}
                        onClick={() => dispatchTicketKey(item.executionKey, item.needsHuman)}
                        style={{
                          background: '#059669',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '4px',
                          padding: '0.35rem 0.75rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Act Now (Approve & Resume)
                      </button>
                      <button
                        data-testid={`alarm-snooze-btn-${item.issueNumber}`}
                        onClick={() => snoozeTaskAlarm(item.executionKey)}
                        style={{
                          background: '#334155',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '4px',
                          padding: '0.35rem 0.75rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Snooze Alarm
                      </button>
                    </SpaceBetween>
                  </div>
                ))}
              </SpaceBetween>
            </Alert>
          </div>
        )}

        {/* TAB 1: OVERVIEW & TELEMETRY */}
        <section id="tab-overview" style={{ display: activeTab === 'overview' ? 'block' : 'none' }}>
          <SpaceBetween size="l">
            <ColumnLayout columns={4} variant="text-grid">
              <Container>
                <div data-testid="kpi-total-tickets">
                  <Box variant="awsui-key-label">Total Tickets</Box>
                  <Box variant="h1">{st.totalTasks}</Box>
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
                    Daily budget: ${f.limits?.dailyBudgetUsd}
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
                  <Box variant="h1">{st.reviewMetrics?.firstRoundApprovalRate ?? 100}%</Box>
                  <Box variant="small" color="text-body-secondary">
                    Avg review rounds: {st.reviewMetrics?.averageReviewRounds ?? 0} (max{' '}
                    {f.limits?.maxReviewRounds ?? 3})
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

        {/* TAB 2: BOARD, MULTI-TRACKER POLLER (GITHUB / JIRA / ASANA) & NEEDS HUMAN */}
        <section id="tab-board" style={{ display: activeTab === 'board' ? 'block' : 'none' }}>
          <SpaceBetween size="l">
            <Container
              header={
                <Header
                  variant="h2"
                  description="Monitor tickets from GitHub Issues, Jira (JQL / Status filter), and Asana (Project GID / Section or Status filter) with periodic cron polling."
                >
                  Monitored Issue Trackers (GitHub, Jira & Asana Poller + Cron Scheduler)
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
                      placeholder="blocked, manual-only, on-hold"
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
                      placeholder="AI_Allowed=true, Priority=High"
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
                  <button
                    id="proj-add-btn"
                    onClick={addMonitoredProject}
                    style={{
                      background: '#059669',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '0.45rem 0.9rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Add Monitored Repository
                  </button>
                  <button
                    id="sync-repos-btn"
                    onClick={syncAllMonitoredProjects}
                    style={{
                      background: '#0972d3',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '0.45rem 0.9rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Sync Issues from All Monitored Repos
                  </button>
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
                    <button
                      id="scheduler-run-btn"
                      onClick={() => updateScheduler(!schedulerEnabled, true)}
                      style={{
                        background: schedulerEnabled ? '#d97706' : '#4f46e5',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '0.4rem 0.8rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {schedulerEnabled ? 'Pause Cron Poller' : 'Enable Cron & Poll Now'}
                    </button>
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
                            <Badge color={prov === 'jira' ? 'blue' : prov === 'asana' ? 'red' : 'grey'}>
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
                  <button
                    id="intake-submit-btn"
                    onClick={submitTicketIntake}
                    style={{
                      background: '#059669',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '0.45rem 0.9rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Intake & Classify Ticket
                  </button>
                  <span id="intake-feedback" style={{ fontSize: '0.85rem', color: '#93c5fd' }}>
                    {intakeFeedback}
                  </span>
                </div>
              </SpaceBetween>
            </Container>

            <Container header={<Header variant="h2">Needs Human Approval Queue (1-Click Gate Approval)</Header>}>
              <div id="needs-human-list">
                {(st.needsHuman || []).length === 0 ? (
                  <Box color="text-body-secondary">No tickets blocked awaiting human approval.</Box>
                ) : (
                  <SpaceBetween size="xs">
                    {st.needsHuman.map((item) => (
                      <div
                        key={item.executionKey}
                        data-testid={`needs-human-card-${item.issueNumber}`}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '0.65rem',
                          background: '#0f172a',
                          borderRadius: '6px',
                          border: '1px solid #f59e0b',
                        }}
                      >
                        <div>
                          <strong>{item.executionKey}</strong> [{item.type}] — Stage:{' '}
                          <Badge color="severity-medium">{item.stage}</Badge>
                          <br />
                          <span>{item.question}</span>
                        </div>
                        <button
                          data-testid={`approve-btn-${item.issueNumber}`}
                          onClick={() => dispatchTicketKey(item.executionKey, true)}
                          style={{
                            background: '#059669',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '0.4rem 0.8rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          1-Click Approve & Advance
                        </button>
                      </div>
                    ))}
                  </SpaceBetween>
                )}
              </div>
            </Container>

            <div
              id="kanban-board"
              style={{
                display: 'grid',
                gap: '0.75rem',
                gridTemplateColumns: 'repeat(auto-fit, minmax(195px, 1fr))',
              }}
            >
              {STAGES.map((col) => {
                const items = (st.tasks || []).filter((t) => t.stage === col);
                return (
                  <Container
                    key={col}
                    header={
                      <Header variant="h3" counter={`(${items.length})`}>
                        {col}
                      </Header>
                    }
                  >
                    <SpaceBetween size="xs">
                      {items.map((t) => {
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
                              #{t.issue_number} {t.title}
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
                                style={{
                                  background: t.needs_human ? '#78350f' : '#064e3b',
                                  color: '#fff',
                                  padding: '0.1rem 0.45rem',
                                  borderRadius: '4px',
                                  fontSize: '0.72rem',
                                  fontWeight: 600,
                                }}
                              >
                                {t.stage}
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
                            {t.stage !== 'done' && (
                              <div style={{ marginTop: '0.45rem' }}>
                                <button
                                  data-testid={`dispatch-btn-${t.issue_number}`}
                                  onClick={() => dispatchTicketKey(t.execution_key, t.needs_human === 1)}
                                  style={{
                                    background: '#0972d3',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '0.3rem 0.65rem',
                                    fontWeight: 600,
                                    fontSize: '0.75rem',
                                    cursor: 'pointer',
                                  }}
                                >
                                  {t.needs_human === 1 ? 'Approve & Continue' : 'Run Workflow'}
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </SpaceBetween>
                  </Container>
                );
              })}
            </div>
          </SpaceBetween>
        </section>

        {/* TAB 3: WORKFLOWS (FACTORY AS CODE) */}
        <section id="tab-workflows" style={{ display: activeTab === 'workflows' ? 'block' : 'none' }}>
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Workflow-as-Code Editor</Header>}>
              <SpaceBetween size="s">
                <FormField label="Select Workflow">
                  <select
                    id="wf-editor-select"
                    value={selectedWf}
                    onChange={(e) => handleSelectWorkflow(e.target.value)}
                    style={{
                      width: '260px',
                      padding: '0.45rem',
                      background: '#0f172a',
                      color: '#fff',
                      border: '1px solid #334155',
                      borderRadius: '4px',
                    }}
                  >
                    <option value="feature">feature</option>
                    <option value="bug">bug</option>
                    <option value="investigation">investigation</option>
                    <option value="discovery">discovery</option>
                    <option value="chore">chore</option>
                  </select>
                </FormField>
                <textarea
                  id="wf-editor-json"
                  rows={8}
                  value={wfJson}
                  onChange={(e) => setWfJson(e.target.value)}
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
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <button
                    id="wf-editor-save-btn"
                    onClick={saveWorkflowFromEditor}
                    style={{
                      background: '#059669',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '0.45rem 0.9rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Validate & Save Workflow
                  </button>
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

        {/* TAB 4: RUNTIMES, ROUTER & CIRCUIT BREAKER */}
        <section id="tab-runtimes" style={{ display: activeTab === 'runtimes' ? 'block' : 'none' }}>
          <Container header={<Header variant="h2">Runtime Router & Circuit Breaker</Header>}>
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
                      <button
                        data-testid={`reset-circuit-${r.runtime}`}
                        onClick={() => resetCircuit(r.runtime)}
                        style={{
                          background: '#0972d3',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '4px',
                          padding: '0.35rem 0.75rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Reset Circuit Breaker
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Container>
        </section>

        {/* TAB 5: AGENTS & LOCKED SKILLS (23) */}
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
                <button
                  id="save-controls-btn"
                  onClick={saveControls}
                  style={{
                    background: '#059669',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '0.45rem 0.9rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Save Controls to factory.yaml
                </button>
                <div id="controls-feedback" style={{ fontSize: '0.85rem', color: '#93c5fd' }}>
                  {controlsFeedback}
                </div>
              </SpaceBetween>
            </Container>

            <Container header={<Header variant="h2">Post-Deploy Gate & Automatic Rollback</Header>}>
              <SpaceBetween size="s">
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
                <button
                  id="deploy-verify-btn"
                  onClick={verifyDeploymentFromUi}
                  style={{
                    background: '#0972d3',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '0.45rem 0.9rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Verify Deployment
                </button>
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
            </Container>
          </Grid>
        </section>
      </main>
    </div>
  );
}

const rootEl = document.getElementById('app');
if (rootEl) {
  createRoot(rootEl).render(<ControlPanelApp />);
}
