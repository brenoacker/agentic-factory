import { join, resolve } from 'node:path';
import { invokeRuntimeAdapter } from './adapters.mjs';
import { validateContract } from './contracts.mjs';
import { selectRuntime, recordRuntimeFailure } from './router.mjs';

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

    // If stage requires human approval after running (e.g. `plan` in feature workflow), pause here
    if (stageDef.humanApproval === true) {
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
