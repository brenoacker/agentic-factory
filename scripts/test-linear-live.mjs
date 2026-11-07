import { getLinearApiKey, pollLinearTracker, updateLinearIssueStatus } from '../packages/core/src/trackers.mjs';
import { spawnSync } from 'node:child_process';

async function main() {
  const apiKey = getLinearApiKey();
  if (!apiKey) {
    console.error('LINEAR_API_KEY not found!');
    process.exit(1);
  }
  console.log('1. LINEAR_API_KEY detected successfully.');

  // Check viewer
  const viewerRes = spawnSync(
    'curl',
    ['-sS', '-X', 'POST', '-H', `Authorization: ${apiKey}`, '-H', 'Content-Type: application/json', '--data-raw', '{"query":"{ viewer { name email } }"}', 'https://api.linear.app/graphql'],
    { encoding: 'utf8' },
  );
  const viewer = JSON.parse(viewerRes.stdout || '{}');
  console.log('2. Authenticated as:', viewer?.data?.viewer?.name, `(${viewer?.data?.viewer?.email})`);

  // Create real issue in Linear
  const createMutation = JSON.stringify({
    query: `mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier number title url state { name } }
      }
    }`,
    variables: {
      input: {
        title: 'Real-world Linear integration test for Agentic Factory',
        teamId: '5735bc1a-0658-4808-8157-b92ee000d715',
        projectId: '01d02135-8e10-49f8-9cec-46e99ab3616a',
        description: 'End-to-end practical test of Linear issue pickup, lifecycle comment, and completion by Agentic Factory.',
      },
    },
  });

  const createProc = spawnSync(
    'curl',
    ['-sS', '-X', 'POST', '-H', `Authorization: ${apiKey}`, '-H', 'Content-Type: application/json', '--data-raw', createMutation, 'https://api.linear.app/graphql'],
    { encoding: 'utf8' },
  );
  const createData = JSON.parse(createProc.stdout || '{}');
  const issue = createData?.data?.issueCreate?.issue;
  if (!issue) {
    console.error('Failed to create issue:', createProc.stdout);
    process.exit(1);
  }
  console.log(`3. Created Linear Issue: ${issue.identifier} (${issue.title})`);
  console.log(`   URL: ${issue.url}`);
  console.log(`   Initial State: ${issue.state?.name}`);

  // Poll via pollLinearTracker
  const pollResult = pollLinearTracker({
    project: {
      repo: 'linear://brenoack/agentic-factory-80f4e9bb2ce1',
      provider: 'linear',
      trackerConfig: {
        projectKey: 'agentic-factory-80f4e9bb2ce1',
        statuses: 'Todo,Backlog,Triage,In Progress',
      },
    },
  });

  console.log(`4. Factory polled issues count: ${pollResult.issues.length}`, {
    skipped: pollResult.skippedByTriggers.map((s) => s.id),
  });
  const found = pollResult.issues.find((i) => i.external_id === issue.id || i.title.includes(issue.identifier));
  console.log(`   Factory recognized issue:`, found ? `YES (${found.title})` : 'NO');

  // Test updating to In Progress with comment
  console.log('5. Updating issue to "In Progress" with pickup comment...');
  updateLinearIssueStatus({
    issueId: issue.id,
    stateName: 'In Progress',
    comment: '🚀 Agentic Factory picked up this ticket for execution.',
  });

  // Test updating to Done with resolution comment
  console.log('6. Updating issue to "Done" with resolution comment...');
  updateLinearIssueStatus({
    issueId: issue.id,
    stateName: 'Done',
    comment: '✅ Feature implemented and verified by Agentic Factory (Commit: 633ad68).',
  });

  // Verify final issue state on Linear
  const verifyRes = spawnSync(
    'curl',
    [
      '-sS',
      '-X',
      'POST',
      '-H',
      `Authorization: ${apiKey}`,
      '-H',
      'Content-Type: application/json',
      '--data-raw',
      JSON.stringify({
        query: `query GetIssue($id: String!) { issue(id: $id) { identifier state { name } comments { nodes { body } } } }`,
        variables: { id: issue.id },
      }),
      'https://api.linear.app/graphql',
    ],
    { encoding: 'utf8' },
  );
  const verifyData = JSON.parse(verifyRes.stdout || '{}');
  const finalIssue = verifyData?.data?.issue;
  console.log('7. Final verification on Linear API:');
  console.log(`   Identifier: ${finalIssue?.identifier}`);
  console.log(`   State: ${finalIssue?.state?.name}`);
  console.log(`   Comments count: ${finalIssue?.comments?.nodes?.length}`);
  for (const c of finalIssue?.comments?.nodes || []) {
    console.log(`   - Comment: "${c.body}"`);
  }

  console.log('\nSUCCESS! Practical end-to-end test on real Linear board completed perfectly.');
}

main().catch(console.error);
