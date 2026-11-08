import { join, resolve, dirname } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { invokeRuntimeAdapter } from './adapters.mjs';
import { validateContract } from './contracts.mjs';
import { selectRuntime, recordRuntimeFailure } from './router.mjs';
import { checkGitHubPullRequest, createGitHubPullRequest } from './github.mjs';
import { syncTaskStateToTracker } from './trackers.mjs';

/**
 * Materializes a structured investigation or discovery contract payload into a concrete Markdown report file.
 */
export function materializeInvestigationReport({
  workspacePath = null,
  factoryRoot = null,
  issueNumber,
  contractPayload = {},
  type = 'investigation',
} = {}) {
  const q = contractPayload.question || `Investigation on #${issueNumber}`;
  const summary = contractPayload.answer_summary || contractPayload.summary || 'Summary pending.';
  const evidence = Array.isArray(contractPayload.evidence) ? contractPayload.evidence : [];
  const options = Array.isArray(contractPayload.options_compared) ? contractPayload.options_compared : [];
  const recommendation = contractPayload.recommendation || 'Proceed with findings.';
  const followUps = Array.isArray(contractPayload.follow_up_tickets) ? contractPayload.follow_up_tickets : [];

  let md = `# Investigation Report #${issueNumber}: ${q}\n\n`;
  md += `**Date**: ${new Date().toISOString()}\n`;
  md += `**Type**: ${type}\n\n`;
  md += `## Answer Summary\n\n${summary}\n\n`;

  if (evidence.length > 0) {
    md += `## Evidence\n\n`;
    for (const e of evidence) {
      md += `- ${e}\n`;
    }
    md += `\n`;
  }

  if (options.length > 0) {
    md += `## Options Compared\n\n`;
    md += `| Option | Pros | Cons |\n| --- | --- | --- |\n`;
    for (const opt of options) {
      md += `| ${opt.option || '-'} | ${opt.pros || '-'} | ${opt.cons || '-'} |\n`;
    }
    md += `\n`;
  }

  md += `## Recommendation\n\n${recommendation}\n\n`;

  if (followUps.length > 0) {
    md += `## Follow-up Tickets\n\n`;
    for (const ft of followUps) {
      md += `- **[${ft.type || 'feature'}]** ${ft.title}: ${ft.description || ''}\n`;
    }
    md += `\n`;
  }

  const relPath = `docs/research/issue-${issueNumber}-${type === 'discovery' ? 'report' : 'investigation'}.md`;
  const targets = [];
  if (workspacePath) {
    targets.push(resolve(workspacePath, relPath));
  }
  if (factoryRoot) {
    targets.push(resolve(factoryRoot, relPath));
  }

  for (const targetPath of targets) {
    try {
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, md, 'utf8');
    } catch {
      // Best-effort write
    }
  }

  return {
    ok: true,
    relPath,
    targets,
    content: md,
  };
}

function contractKindFromPath(contractPath) {
  if (!contractPath) return null;
  if (contractPath.includes('triage')) return 'triage';
  if (contractPath.includes('investigation-report')) return 'investigation-report';
  if (contractPath.includes('review')) return 'review';
  if (contractPath.includes('task')) return 'task';
  return null;
}

/**
 * Unblocks a task waiting at a `humanApproval` gate (called by `/approve` comment or Panel 1-click button).
 */
export function approveTask(store, executionKey, { approver = 'operator', words = '/approve' } = {}) {
  const task = store.getTask(executionKey);
  if (!task) {
    throw new Error(`Task not found: ${executionKey}`);
  }
  store.recordEvent({
    executionKey,
    issueNumber: task.issue_number,
    eventType: 'human_approved',
    stage: task.stage,
    runtime: task.runtime,
    model: task.model,
    payload: { approver, words },
  });
  return store.updateTaskStage(executionKey, {
    needsHuman: false,
    humanQuestion: '',
  });
}

/**
 * Drives a task through its workflow stages until it hits a `humanApproval` gate, finishes (`done`),
 * or stops on an error / review round cap (`needs_human = 1`).
 */
export function dispatchTask({
  executionKey,
  factoryRoot,
  factoryConfig,
  workflows,
  pricesConfig,
  store,
  runner = null,
  trackerRunner = null,
  headSha = '64e6a79',
  humanApprovedCurrentStage = false,
}) {
  const root = resolve(factoryRoot);
  let task = store.getTask(executionKey);
  if (!task) {
    throw new Error(`Task not found in store: ${executionKey}`);
  }

  let workflow = workflows[task.type];
  if (!workflow) {
    throw new Error(`No workflow found for ticket type: ${task.type}`);
  }

  const maxReviewRounds = workflow.maxReviewRounds ?? factoryConfig?.factory?.limits?.maxReviewRounds ?? 3;
  let stageMap = new Map(workflow.stages.map((s) => [s.id, s]));

  // If the operator just approved a human-gated stage, advance to `next` before continuing
  if (humanApprovedCurrentStage) {
    if (task.stage === 'merge' && task.deliverable_type === 'pull_request') {
      const prCheck = checkGitHubPullRequest({
        repo: task.repo,
        prNumberOrUrl: task.deliverable_url,
        runner: trackerRunner,
      });
      if (!prCheck.merged) {
        task = store.updateTaskStage(executionKey, {
          needsHuman: true,
          humanQuestion: `Pull request #${prCheck.prNumber || 'unknown'} is still ${prCheck.state || 'OPEN'} on GitHub. Awaiting human merge before completing ticket.`,
        });
        return {
          ok: false,
          status: 'pr_not_merged',
          code: 'pr_not_merged',
          error: `Pull request #${prCheck.prNumber || 'unknown'} is still ${prCheck.state || 'OPEN'} on GitHub. Awaiting human merge before completing ticket.`,
          stage: 'merge',
          stepsExecuted: [],
          task,
        };
      }
    }
    if (task.needs_human === 1) {
      approveTask(store, executionKey);
    }
    const currentStageDef = stageMap.get(task.stage);
    const nextStageId = currentStageDef?.next || 'done';
    task = store.updateTaskStage(executionKey, {
      stage: nextStageId,
      needsHuman: false,
      humanQuestion: '',
    });
    syncTaskStateToTracker({ task, store, runner: trackerRunner });
  }

  syncTaskStateToTracker({ task, store, runner: trackerRunner });

  const stepsExecuted = [];

  while (task.stage !== 'done' && task.stage !== 'aborted') {
    let stageDef = stageMap.get(task.stage);
    if (!stageDef) {
      throw new Error(`Unknown stage "${task.stage}" in workflow "${workflow.id}"`);
    }

    // Pure human stage (e.g., `merge` in `gated` mode) pauses immediately
    if (stageDef.mode === 'human') {
      task = store.updateTaskStage(executionKey, {
        needsHuman: true,
        humanQuestion: `Stage "${stageDef.id}" requires human action`,
      });
      syncTaskStateToTracker({ task, store, runner: trackerRunner });
      store.recordEvent({
        executionKey,
        issueNumber: task.issue_number,
        eventType: 'human_needed',
        stage: stageDef.id,
        runtime: task.runtime,
        model: task.model,
        payload: { reason: 'human_stage' },
      });
      return {
        ok: true,
        status: 'paused_for_human',
        stage: task.stage,
        stepsExecuted,
        task,
      };
    }

    // Route runtime and model based on current impact
    const route = selectRuntime({
      impact: task.impact,
      FactoryConfig: factoryConfig,
      factoryConfig,
      store,
    });

    if (!route.ok) {
      task = store.updateTaskStage(executionKey, {
        needsHuman: true,
        humanQuestion: `Router halted: ${route.reason}`,
      });
      return {
        ok: false,
        status: 'no_healthy_runtime',
        code: route.code,
        stage: task.stage,
        stepsExecuted,
        task,
      };
    }

    const stageToken = store.issueStageToken(executionKey, stageDef.id);
    const contractKind = contractKindFromPath(stageDef.contract);
    const schemaPath = stageDef.contract ? join(root, stageDef.contract) : null;
    const prompt = [
      `Factory task: ${executionKey}`,
      `Workflow: ${workflow.id} | Stage: ${stageDef.id} | Agent: ${stageDef.agent}`,
      `Skills: ${(stageDef.skills || []).join(', ')}`,
      `Stage token: ${stageToken}`,
    ].join('\n');

    const execRes = invokeRuntimeAdapter({
      runtime: route.runtime,
      model: route.model,
      prompt,
      schemaPath,
      cwd: root,
      runner: runner
        ? (callSpec) =>
            runner({
              ...callSpec,
              executionKey,
              stage: stageDef.id,
              agent: stageDef.agent,
              skills: stageDef.skills,
              stageToken,
              round: task.review_rounds + 1,
            })
        : null,
    });

    if (!execRes.ok) {
      recordRuntimeFailure(store, route.runtime, execRes.errorCode);
      task = store.updateTaskStage(executionKey, {
        needsHuman: true,
        humanQuestion: `Stage "${stageDef.id}" failed on ${route.runtime} (${execRes.errorCode})`,
      });
      store.recordEvent({
        executionKey,
        issueNumber: task.issue_number,
        eventType: 'aborted',
        stage: stageDef.id,
        runtime: route.runtime,
        model: route.model,
        durationMs: execRes.durationMs,
        payload: { errorCode: execRes.errorCode, stderr: execRes.stderr },
      });
      return {
        ok: false,
        status: 'runtime_error',
        errorCode: execRes.errorCode,
        stage: task.stage,
        stepsExecuted,
        task,
      };
    }

    // Consume single-use stage token
    const tokenGate = store.consumeStageToken({
      token: execRes.contract?.stage_token || stageToken,
      executionKey,
      stage: stageDef.id,
    });
    if (!tokenGate.ok) {
      return {
        ok: false,
        status: 'token_rejected',
        code: tokenGate.code,
        stage: task.stage,
        stepsExecuted,
        task,
      };
    }

    // Record usage telemetry
    store.recordEvent(
      {
        executionKey,
        issueNumber: task.issue_number,
        eventType: 'usage',
        stage: stageDef.id,
        runtime: route.runtime,
        model: route.model,
        inputTokens: execRes.usage.inputTokens,
        outputTokens: execRes.usage.outputTokens,
        cachedTokens: execRes.usage.cachedTokens,
        explicitCostUsd: execRes.usage.explicitCostUsd,
        durationMs: execRes.durationMs,
        payload: { agent: stageDef.agent, estimated: execRes.usage.estimated },
      },
      pricesConfig,
    );

    // Check if agent explicitly raised its hand for human clarification (needs_human: true)
    if (execRes.contract?.needs_human === true) {
      task = store.updateTaskStage(executionKey, {
        needsHuman: true,
        humanQuestion: execRes.contract.human_question || `Stage "${stageDef.id}" requested human clarification`,
      });
      syncTaskStateToTracker({ task, store, runner: trackerRunner });
      store.recordEvent({
        executionKey,
        issueNumber: task.issue_number,
        eventType: 'human_needed',
        stage: stageDef.id,
        runtime: route.runtime,
        model: route.model,
        payload: { reason: 'agent_requested_human', question: execRes.contract.human_question },
      });
      return {
        ok: true,
        status: 'paused_for_human',
        stage: task.stage,
        stepsExecuted: [...stepsExecuted, stageDef.id],
        task,
      };
    }

    // Validate contract if the stage specifies one
    if (contractKind) {
      const cleanPayload = { ...execRes.contract };
      delete cleanPayload.stage_token;
      const currentRound = stageDef.id === 'review' ? task.review_rounds + 1 : task.review_rounds;
      if (stageDef.id === 'review' && cleanPayload.round === undefined) {
        cleanPayload.round = currentRound;
      }

      const validation = validateContract(contractKind, cleanPayload, {
        head_sha: headSha,
        maxReviewRounds,
      });

      if (!validation.ok) {
        task = store.updateTaskStage(executionKey, {
          needsHuman: true,
          humanQuestion: `Contract ${contractKind} rejected: ${validation.errors.join('; ')}`,
        });
        return {
          ok: false,
          status: 'contract_rejected',
          ruleCodes: validation.ruleCodes,
          stage: task.stage,
          stepsExecuted,
          task,
        };
      }

      if (contractKind === 'investigation-report') {
        const isDiscovery = task.type === 'discovery';
        const relUrl = `docs/research/issue-${task.issue_number}-${isDiscovery ? 'report' : 'investigation'}.md`;
        materializeInvestigationReport({
          workspacePath: task.workspace_path,
          factoryRoot: root,
          issueNumber: task.issue_number,
          contractPayload: cleanPayload,
          type: task.type,
        });
        store.attachTaskDeliverable(executionKey, {
          type: 'research_document',
          url: relUrl,
          ref: cleanPayload.question || `${isDiscovery ? 'Discovery Report' : 'Investigation Report'} #${task.issue_number}`,
        });
        task = store.getTask(executionKey) || task;
      }

      if (contractKind === 'triage') {
        const nextModelCfg = factoryConfig?.factory?.modelByImpact?.[cleanPayload.impact] || {
          runtime: route.runtime,
          model: route.model,
        };
        const classifiedType = cleanPayload.type || task.type;
        task = store.updateTaskStage(executionKey, {
          type: classifiedType,
          impact: cleanPayload.impact,
          runtime: nextModelCfg.runtime,
          model: nextModelCfg.model,
          needsHuman: Boolean(cleanPayload.needs_human),
          humanQuestion: cleanPayload.human_question || '',
        });
        if (cleanPayload.type && workflows[cleanPayload.type] && cleanPayload.type !== workflow.id) {
          workflow = workflows[cleanPayload.type];
          stageMap = new Map(workflow.stages.map((s) => [s.id, s]));
          stageDef = stageMap.get(task.stage) || stageDef;
        }
        if (cleanPayload.needs_human) {
          syncTaskStateToTracker({ task, store, runner: trackerRunner });
          return {
            ok: true,
            status: 'paused_for_human',
            stage: task.stage,
            stepsExecuted: [...stepsExecuted, stageDef.id],
            task,
          };
        }
      }

      if (contractKind === 'review') {
        let prNumber = cleanPayload.pr_number;
        let commitSha = cleanPayload.commit_sha;
        let prUrl = null;

        let targetRepo = task.repo;
        if (task.provider !== 'github' || !targetRepo || targetRepo.includes('://')) {
          targetRepo = factoryConfig?.factory?.repo || 'brenoacker/agentic-factory';
        }

        // When running in real mode (no mock runner passed), push branch and create/lookup real PR on GitHub
        if (!runner && task.workspace_path && task.branch_name) {
          try {
            const revRes = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: task.workspace_path, encoding: 'utf8' });
            if (revRes.status === 0 && revRes.stdout?.trim()) {
              commitSha = revRes.stdout.trim();
            }
            const prRes = createGitHubPullRequest({
              repo: targetRepo,
              head: task.branch_name,
              base: 'main',
              title: task.title,
              body: `Automated PR generated by Agentic Factory for ${task.execution_key}.\n\nStage: review (round ${cleanPayload.round || 1})\nVerdict: ${cleanPayload.verdict || 'APPROVE'}`,
              cwd: task.workspace_path,
            });
            if (prRes.ok && prRes.url) {
              prUrl = prRes.url;
              if (prRes.prNumber) prNumber = prRes.prNumber;
            }
          } catch {
            // fallback
          }
        }

        if (!prUrl && prNumber) {
          prUrl = `https://github.com/${targetRepo}/pull/${prNumber}`;
        }

        if (prUrl) {
          store.attachTaskDeliverable(executionKey, {
            type: 'pull_request',
            url: prUrl,
            ref: commitSha || headSha,
          });
          task = store.getTask(executionKey) || task;
        }

        const newRound = cleanPayload.round;
        const approvedFirstRound =
          newRound === 1 && cleanPayload.verdict === 'APPROVE' ? true : Boolean(task.approved_first_round);
        store.recordEvent({
          executionKey,
          issueNumber: task.issue_number,
          eventType: 'verdict',
          stage: 'review',
          runtime: route.runtime,
          model: route.model,
          payload: { verdict: cleanPayload.verdict, round: newRound, commit_sha: cleanPayload.commit_sha },
        });

        if (cleanPayload.verdict === 'REQUEST_CHANGES') {
          if (newRound >= maxReviewRounds) {
            task = store.updateTaskStage(executionKey, {
              reviewRounds: newRound,
              needsHuman: true,
              humanQuestion: `max_review_rounds_reached (${newRound}/${maxReviewRounds})`,
            });
            syncTaskStateToTracker({ task, store, runner: trackerRunner });
            store.recordEvent({
              executionKey,
              issueNumber: task.issue_number,
              eventType: 'human_needed',
              stage: 'review',
              runtime: route.runtime,
              model: route.model,
              payload: { reason: 'max_review_rounds_reached', round: newRound },
            });
            return {
              ok: false,
              status: 'max_review_rounds_reached',
              stage: task.stage,
              stepsExecuted: [...stepsExecuted, stageDef.id],
              task,
            };
          }

          const gotoStage = stageDef.onChangesRequested?.goto || 'checks_and_build';
          task = store.updateTaskStage(executionKey, {
            stage: gotoStage,
            reviewRounds: newRound,
            needsHuman: false,
          });
          syncTaskStateToTracker({ task, store, runner: trackerRunner });
          stepsExecuted.push(stageDef.id);
          continue;
        }

        task = store.updateTaskStage(executionKey, {
          reviewRounds: newRound,
          approvedFirstRound,
        });
      }
    }

    stepsExecuted.push(stageDef.id);

    // If stage requires human approval after running (e.g. `plan` in feature workflow), pause here
    if (stageDef.humanApproval === true) {
      task = store.updateTaskStage(executionKey, {
        stage: stageDef.id,
        needsHuman: true,
        humanQuestion: `Stage "${stageDef.id}" completed and awaits human approval (/approve)`,
      });
      syncTaskStateToTracker({ task, store, runner: trackerRunner });
      store.recordEvent({
        executionKey,
        issueNumber: task.issue_number,
        eventType: 'human_needed',
        stage: stageDef.id,
        runtime: route.runtime,
        model: route.model,
        payload: { reason: 'stage_gate_approval' },
      });
      return {
        ok: true,
        status: 'paused_for_human',
        stage: task.stage,
        stepsExecuted,
        task,
      };
    }

    const nextStage = stageDef.next || 'done';
    if (nextStage === 'done') {
      task = store.getTask(executionKey) || task;
      const delivCheck = store.validateTaskDeliverable(task);
      if (!delivCheck.ok) {
        task = store.updateTaskStage(executionKey, {
          needsHuman: true,
          humanQuestion: `Deliverable check rejected: ${delivCheck.error}`,
        });
        syncTaskStateToTracker({ task, store, runner: trackerRunner });
        return {
          ok: false,
          status: 'missing_deliverable',
          code: delivCheck.code,
          error: delivCheck.error,
          stage: task.stage,
          stepsExecuted,
          task,
        };
      }
    }

    task = store.updateTaskStage(executionKey, {
      stage: nextStage,
      needsHuman: false,
      humanQuestion: '',
    });
    syncTaskStateToTracker({ task, store, runner: trackerRunner });
  }

  syncTaskStateToTracker({ task, store, runner: trackerRunner });
  return {
    ok: true,
    status: 'completed',
    stage: task.stage,
    stepsExecuted,
    task,
  };
}
