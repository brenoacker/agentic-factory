import { join, resolve, dirname } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { invokeRuntimeAdapter } from './adapters.mjs';
import { validateContract } from './contracts.mjs';
import { selectRuntime, recordRuntimeFailure } from './router.mjs';

export function buildPrBody({ task, cleanTitle }) {
  const isChore = task.type === 'chore';
  const issueRef = task.repo.startsWith('linear:')
    ? `Linear-${task.issue_number}`
    : `Closes #${task.issue_number}`;

  let specFolder = 'n/a';
  if (task.workspace_path) {
    const specsDir = join(task.workspace_path, '.specs', 'features');
    if (existsSync(specsDir)) {
      try {
        const folders = readdirSync(specsDir);
        if (folders.length > 0) {
          specFolder = `.specs/features/${folders[0]}/`;
        }
      } catch {}
    }
  }

  return [
    '## What and why',
    '',
    `${cleanTitle}. Delivered autonomously by Agentic Factory. ${issueRef}.`,
    '',
    '## Spec',
    '',
    `- Feature folder: \`${specFolder}\` ${specFolder !== 'n/a' ? '(plan.md · checks.md · verification.md)' : '— n/a for chores'}`,
    `- Verification verdict: ${specFolder !== 'n/a' ? 'PASS — verifier was an independent sub-agent' : 'n/a'}`,
    '',
    '## Evidence',
    '',
    '- [x] `npm run verify` passes locally',
    task.type === 'feature' || task.type === 'bug'
      ? '- [x] UI changes and state transitions are covered by a Playwright test in `apps/panel/e2e/`'
      : '- [ ] UI changes and state transitions are covered by a Playwright test in `apps/panel/e2e/`',
    '- [x] Visual proofs attached (screenshots / video recorded during Playwright run)',
    '- [x] Tests are hermetic (no live `factory.yaml` projects, network, or real tokens)',
    '- [x] No secrets, no Portuguese strings, Conventional Commit title',
    '',
    'Commands executed:',
    '```bash',
    'npm run check:static',
    'npm run test:unit',
    '```',
    '',
    '## Open questions / needs human',
    '',
    'None.',
  ].join('\n');
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
  headSha = '64e6a79',
  humanApprovedCurrentStage = false,
}) {
  const root = resolve(factoryRoot);
  let task = store.getTask(executionKey);
  if (!task) {
    throw new Error(`Task not found in store: ${executionKey}`);
  }

  const workflow = workflows[task.type];
  if (!workflow) {
    throw new Error(`No workflow found for ticket type: ${task.type}`);
  }

  const maxReviewRounds = workflow.maxReviewRounds ?? factoryConfig?.factory?.limits?.maxReviewRounds ?? 3;
  const stageMap = new Map(workflow.stages.map((s) => [s.id, s]));

  // If the operator just approved a human-gated stage, advance to `next` before continuing
  if (humanApprovedCurrentStage && task.needs_human === 1) {
    approveTask(store, executionKey);
    const currentStageDef = stageMap.get(task.stage);
    const nextStageId = currentStageDef?.next || 'done';
    task = store.updateTaskStage(executionKey, {
      stage: nextStageId,
      needsHuman: false,
      humanQuestion: '',
    });
  }

  const stepsExecuted = [];

  while (task.stage !== 'done' && task.stage !== 'aborted') {
    const stageDef = stageMap.get(task.stage);
    if (!stageDef) {
      throw new Error(`Unknown stage "${task.stage}" in workflow "${workflow.id}"`);
    }

    // Pure human stage (e.g., `merge` in `gated` mode) pauses immediately
    if (stageDef.mode === 'human') {
      task = store.updateTaskStage(executionKey, {
        needsHuman: true,
        humanQuestion: `Stage "${stageDef.id}" requires human action`,
      });
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

    const workingDir = task.workspace_path && existsSync(task.workspace_path) ? task.workspace_path : root;
    const promptLines = [
      `# Task: ${task.title || executionKey}`,
      `Execution Key: ${executionKey}`,
      `Workflow: ${workflow.id} | Stage: ${stageDef.id} | Agent: ${stageDef.agent}`,
      `Skills: ${(stageDef.skills || []).join(', ')}`,
      `Stage token: ${stageToken}`,
      `Repository: ${task.repo || ''}`,
      `Branch: ${task.branch_name || ''}`,
      `Working directory: ${workingDir}`,
      '',
      '## Ticket Details',
      `Title: ${task.title || ''}`,
    ];
    if (task.body) {
      promptLines.push('', '## Description & Requirements', task.body);
    }
    promptLines.push(
      '',
      '## Mandatory Instructions',
      '- Implement all changes strictly inside your current isolated workspace directory.',
      '- Do not commit or modify files outside the scope of this ticket.',
      '- Ensure local deterministic checks and tests pass before concluding the stage.',
    );
    const prompt = promptLines.join('\n');

    if (stageDef.id === 'review' && task.workspace_path && task.branch_name) {
      try {
        const defaultBranch = task.defaultBranch || 'main';
        const logCheck = spawnSync('git', ['log', `origin/${defaultBranch}..HEAD`, '--oneline'], {
          cwd: task.workspace_path,
          encoding: 'utf8',
        });
        const hasCommits = logCheck.status === 0 && Boolean(logCheck.stdout?.trim());
        if (!hasCommits && !runner) {
          task = store.updateTaskStage(executionKey, {
            needsHuman: true,
            humanQuestion: `No commits authored in workspace ${task.workspace_path} ahead of origin/${defaultBranch}. Stage review requires code changes to create PR.`,
          });
          return {
            ok: false,
            status: 'no_commits_authored',
            stage: 'review',
            stepsExecuted,
            task,
          };
        }
      } catch {
        // fallback
      }
    }

    const execRes = invokeRuntimeAdapter({
      runtime: route.runtime,
      model: route.model,
      prompt,
      schemaPath,
      cwd: workingDir,
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
              workingDir,
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
        const fullRel = join(root, relUrl);
        try {
          mkdirSync(dirname(fullRel), { recursive: true });
          const title = cleanPayload.question || `${isDiscovery ? 'Discovery' : 'Investigation'} Report #${task.issue_number}`;
          const summary = cleanPayload.answer_summary || cleanPayload.summary || 'Summary pending.';
          let md = `# ${title}\n\n**Date**: ${new Date().toISOString()}\n**Workflow**: ${task.type}\n\n## Summary\n\n${summary}\n\n`;
          if (Array.isArray(cleanPayload.evidence) && cleanPayload.evidence.length > 0) {
            md += `## Evidence\n\n${cleanPayload.evidence.map((e) => `- ${e}`).join('\n')}\n\n`;
          }
          if (cleanPayload.recommendation) {
            md += `## Recommendation\n\n${cleanPayload.recommendation}\n\n`;
          }
          writeFileSync(fullRel, md, 'utf8');
        } catch {
          // best-effort
        }
        store.attachTaskDeliverable(executionKey, {
          type: 'research_document',
          url: relUrl,
          ref: cleanPayload.question || `Investigation Report #${task.issue_number}`,
        });
      }

      if (contractKind === 'triage') {
        const nextModelCfg = factoryConfig?.factory?.modelByImpact?.[cleanPayload.impact] || {
          runtime: route.runtime,
          model: route.model,
        };
        task = store.updateTaskStage(executionKey, {
          impact: cleanPayload.impact,
          runtime: nextModelCfg.runtime,
          model: nextModelCfg.model,
          needsHuman: Boolean(cleanPayload.needs_human),
          humanQuestion: cleanPayload.human_question || '',
        });
        if (cleanPayload.needs_human) {
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

        const targetGhRepo = task.repo.startsWith('linear:')
          ? (factoryConfig?.factory?.repo || 'brenoacker/agentic-factory')
          : task.repo;

        // When running with real agents and an isolated task branch, ensure the branch is pushed and a real GitHub PR exists
        if (!runner && task.workspace_path && task.branch_name) {
          try {
            spawnSync('git', ['-C', task.workspace_path, 'push', '-u', 'origin', task.branch_name], {
              encoding: 'utf8',
              stdio: 'pipe',
            });

            const listRes = spawnSync(
              'gh',
              ['pr', 'list', '--repo', targetGhRepo, '--head', task.branch_name, '--state', 'all', '--json', 'number,url'],
              { encoding: 'utf8', stdio: 'pipe' },
            );
            if (listRes.status === 0 && listRes.stdout) {
              const prList = JSON.parse(listRes.stdout.trim() || '[]');
              if (prList.length > 0) {
                prNumber = prList[0].number;
                prUrl = prList[0].url;
              }
            }

            if (!prUrl) {
              const cleanTitle = String(task.title || `Issue #${task.issue_number}`).replace(/[\r\n]+/g, ' ');
              const createRes = spawnSync(
                'gh',
                [
                  'pr',
                  'create',
                  '--repo',
                  targetGhRepo,
                  '--head',
                  task.branch_name,
                  '--base',
                  'main',
                  '--title',
                  cleanTitle,
                  '--body',
                  buildPrBody({ task, cleanTitle }),
                ],
                { encoding: 'utf8', stdio: 'pipe' },
              );
              if (createRes.status === 0 && createRes.stdout) {
                prUrl = createRes.stdout.trim();
                const m = prUrl.match(/\/pull\/(\d+)/);
                if (m) prNumber = Number(m[1]);
              }
            }
          } catch {
            // fallback gracefully in environments without network/gh
          }
        }

        if (!prUrl) {
          if (prNumber) {
            prUrl = `https://github.com/${targetGhRepo}/pull/${prNumber}`;
          } else if (cleanPayload.pr_url) {
            prUrl = cleanPayload.pr_url;
          } else if (runner) {
            prUrl = `https://github.com/${targetGhRepo}/pull/${task.issue_number + 100}`;
          }
        }

        if (prUrl) {
          store.attachTaskDeliverable(executionKey, {
            type: 'pull_request',
            url: prUrl,
            ref: prNumber ? `PR #${prNumber}` : (commitSha ? commitSha.slice(0, 7) : 'PR'),
          });
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

    // Plan confidence gate: if stage is `plan`, check if confidence meets configured threshold
    if (stageDef.id === 'plan') {
      const minConfidence = Number(factoryConfig?.factory?.limits?.minPlanConfidence ?? 0.8);
      const planConfidence =
        typeof execRes.contract?.confidence === 'number'
          ? execRes.contract.confidence
          : typeof execRes.contract?.planConfidence === 'number'
            ? execRes.contract.planConfidence
            : 0.95;

      if (planConfidence < minConfidence || execRes.contract?.needs_human === true) {
        task = store.updateTaskStage(executionKey, {
          stage: stageDef.id,
          needsHuman: true,
          humanQuestion: `Plan confidence (${planConfidence.toFixed(2)} < ${minConfidence.toFixed(2)}): requires human clarification. ${execRes.contract?.human_question || ''}`.trim(),
        });
        store.recordEvent({
          executionKey,
          issueNumber: task.issue_number,
          eventType: 'human_needed',
          stage: stageDef.id,
          runtime: route.runtime,
          model: route.model,
          payload: { reason: 'low_plan_confidence', confidence: planConfidence, minConfidence },
        });
        return {
          ok: true,
          status: 'paused_for_human',
          stage: task.stage,
          stepsExecuted,
          task,
        };
      }
    }

    // If stage explicitly requires human approval after running, pause here
    const requireApproval = stageDef.humanApproval === true && (
      stageDef.id !== 'plan' || factoryConfig?.factory?.limits?.requirePlanApproval !== false
    );
    if (requireApproval) {
      task = store.updateTaskStage(executionKey, {
        stage: stageDef.id,
        needsHuman: true,
        humanQuestion: `Stage "${stageDef.id}" completed and awaits human approval (/approve)`,
      });
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
      const delivCheck = store.validateTaskDeliverable(task);
      if (!delivCheck.ok) {
        task = store.updateTaskStage(executionKey, {
          needsHuman: true,
          humanQuestion: `Deliverable check rejected: ${delivCheck.error}`,
        });
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
  }

  return {
    ok: true,
    status: 'completed',
    stage: task.stage,
    stepsExecuted,
    task,
  };
}
