import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { marked } from 'marked';

/**
 * Checks whether a given target path is strictly contained within at least one allowed root directory.
 */
export function isPathContained(targetPath, allowedRoots = []) {
  if (!targetPath) return false;
  const roots = Array.isArray(allowedRoots) ? allowedRoots : [allowedRoots];
  for (const root of roots) {
    if (!root) continue;
    const resolvedRoot = resolve(root);
    const resolvedTarget = isAbsolute(targetPath) ? resolve(targetPath) : resolve(resolvedRoot, targetPath);
    const rel = relative(resolvedRoot, resolvedTarget);
    if (!rel.startsWith('..') && !isAbsolute(rel)) {
      return true;
    }
  }
  return false;
}

/**
 * Extracts and resolves evaluation and review files for a task from its stage, deliverable, workspace, and human question.
 */
export function resolveTaskReviewFiles(task, options = {}) {
  if (!task) return [];
  const factoryRoot = typeof options === 'string' ? options : (options.factoryRoot || process.cwd());
  const root = resolve(factoryRoot);
  const allowedRoots = [root];
  if (task.workspace_path) {
    allowedRoots.push(resolve(task.workspace_path));
  }

  const reviewFiles = [];
  const seenPaths = new Set();

  function addCandidate(label, rawPath, defaultLine = null) {
    if (!rawPath) return;
    let cleanPath = String(rawPath).trim();
    let line = defaultLine;

    const lineMatch = cleanPath.match(/#L(\d+)(?:-L\d+)?$/);
    if (lineMatch) {
      line = Number(lineMatch[1]);
      cleanPath = cleanPath.replace(/#L\d+(?:-L\d+)?$/, '');
    }

    if (cleanPath.startsWith('file:///')) {
      cleanPath = cleanPath.replace(/^file:\/\/\/?/, '');
    }

    // Ignore remote HTTP URLs
    if (/^https?:\/\//i.test(cleanPath)) return;

    let resolvedPath = isAbsolute(cleanPath)
      ? resolve(cleanPath)
      : task.workspace_path && existsSync(resolve(task.workspace_path, cleanPath))
        ? resolve(task.workspace_path, cleanPath)
        : existsSync(resolve(root, cleanPath))
          ? resolve(root, cleanPath)
          : task.workspace_path
            ? resolve(task.workspace_path, cleanPath)
            : resolve(root, cleanPath);

    const normKey = resolvedPath.toLowerCase().replace(/\\/g, '/');
    if (seenPaths.has(normKey)) return;
    seenPaths.add(normKey);

    const exists = existsSync(resolvedPath);
    let isDirectory = false;
    if (exists) {
      try {
        isDirectory = statSync(resolvedPath).isDirectory();
      } catch {
        // Fallback
      }
    }

    const forwardSlashPath = resolvedPath.replace(/\\/g, '/');
    const vscodeUrl = `vscode://file/${forwardSlashPath}${line ? `:${line}` : ''}`;
    const rel = relative(root, resolvedPath).replace(/\\/g, '/');

    reviewFiles.push({
      label,
      path: resolvedPath,
      resolvedPath,
      relativePath: rel.startsWith('..') ? (task.workspace_path ? relative(task.workspace_path, resolvedPath) : resolvedPath) : rel,
      line,
      vscodeUrl,
      vscodeUri: vscodeUrl,
      exists,
      isDirectory,
      extension: extname(resolvedPath).slice(1).toLowerCase(),
    });
  }

  // 1. Deliverable file (research doc, investigation doc, or local spec)
  if (task.deliverable_url && !task.deliverable_url.startsWith('http')) {
    addCandidate(task.deliverable_type === 'research_document' ? 'Research Document' : 'Deliverable File', task.deliverable_url);
  }

  // 2. Stage plan: look for plan files in task workspace or factory root
  if (task.stage === 'plan') {
    const slug = String(task.title || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const candidates = [
      task.workspace_path ? resolve(task.workspace_path, 'plan.md') : null,
      task.workspace_path ? resolve(task.workspace_path, 'docs', 'plan.md') : null,
      resolve(root, '.specs', 'features', slug, 'plan.md'),
      resolve(root, 'docs', 'plan.md'),
      task.workspace_path ? resolve(task.workspace_path, `.specs/features/issue-${task.issue_number}/plan.md`) : null,
    ];

    if (task.human_question) {
      const qMatches = task.human_question.matchAll(/(?:[\w.-]+[/\\])+plan\.md/gi);
      for (const m of qMatches) {
        const p = resolve(root, m[0]);
        if (existsSync(p)) {
          candidates.unshift(p);
        }
      }
    }

    let foundPlan = false;
    for (const c of candidates) {
      if (c && existsSync(c)) {
        addCandidate('Plan Specification', c);
        foundPlan = true;
        break;
      }
    }

    if (!foundPlan) {
      // Default canonical plan path for review
      const defaultPlan = task.workspace_path
        ? resolve(task.workspace_path, 'plan.md')
        : resolve(root, '.specs', 'features', slug || `issue-${task.issue_number}`, 'plan.md');
      addCandidate('Plan Specification', defaultPlan);
    }
  }

  // 3. Detect cited file references in human_question
  if (task.human_question) {
    const fileMatches = task.human_question.matchAll(/(?:[\w.-]+[/\\])+[\w.-]+\.(?:md|json|mjs|js|ts|jsx|tsx|py|yaml|yml)(?:#L\d+(?:-L\d+)?)?/gi);
    for (const match of fileMatches) {
      addCandidate('Cited Reference', match[0]);
    }
  }

  // 4. Task workspace directory
  if (task.workspace_path && existsSync(task.workspace_path)) {
    addCandidate('Workspace Directory', task.workspace_path);
  }

  return reviewFiles;
}

/**
 * Launches the operator's code editor (VS Code, Cursor, or system opener) at the specified path and optional line.
 */
export function openInEditor(filePath, { rootDir = process.cwd(), line = null, runner = null, editor = null } = {}) {
  if (!filePath) {
    return { ok: false, status: 400, error: 'File path is required' };
  }

  const root = resolve(rootDir);
  const resolved = isAbsolute(filePath) ? resolve(filePath) : resolve(root, filePath);

  if (runner) {
    return runner({ action: 'open_file', path: resolved, line, editor });
  }

  if (!existsSync(resolved)) {
    return { ok: false, status: 404, error: `File not found: ${filePath}` };
  }

  try {
    const targetWithLine = line ? `${resolved}:${line}` : resolved;
    // Launch VS Code via `code` CLI if available
    const proc = spawn('code', line ? ['-g', targetWithLine] : [resolved], {
      shell: true,
      detached: true,
      stdio: 'ignore',
    });
    proc.unref();

    return {
      ok: true,
      status: 200,
      path: resolved,
      line,
      method: 'code',
    };
  } catch {
    try {
      // Fallback to system default opener
      const opener = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      const args = process.platform === 'win32' ? ['/c', 'start', '', resolved] : [resolved];
      const fallback = spawn(opener, args, { shell: true, detached: true, stdio: 'ignore' });
      fallback.unref();

      return {
        ok: true,
        status: 200,
        path: resolved,
        line,
        method: 'system',
      };
    } catch (err) {
      return {
        ok: false,
        status: 500,
        error: `Failed to open file: ${err.message}`,
      };
    }
  }
}

/**
 * Safely reads the text content of a review document, enforcing path containment within allowed directories.
 */
export function readFileContent(filePath, { factoryRoot = process.cwd(), allowedRoots = [], maxSize = 2 * 1024 * 1024 } = {}) {
  if (!filePath) {
    return { ok: false, status: 400, error: 'File path is required' };
  }

  const root = resolve(factoryRoot);
  const roots = allowedRoots.length > 0 ? allowedRoots.map((r) => resolve(r)) : [root];

  let resolved = isAbsolute(filePath) ? resolve(filePath) : resolve(root, filePath);

  if (!existsSync(resolved)) {
    // If not found at primary path, attempt lookup relative to any other allowed roots (e.g., task workspace)
    const relFromRoot = relative(root, resolved);
    for (const altRoot of roots) {
      if (altRoot === root) continue;
      const candidate = resolve(altRoot, relFromRoot);
      if (existsSync(candidate)) {
        resolved = candidate;
        break;
      }
    }
  }

  if (!isPathContained(resolved, roots)) {
    return {
      ok: false,
      status: 400,
      error: 'Access denied: path is outside allowed repository and workspace roots',
    };
  }

  if (!existsSync(resolved)) {
    return {
      ok: false,
      status: 404,
      error: `File not found: ${filePath}`,
    };
  }

  try {
    const stat = statSync(resolved);
    if (stat.isDirectory()) {
      return {
        ok: false,
        status: 400,
        error: 'Path is a directory, not a readable text file',
      };
    }

    if (stat.size > maxSize) {
      return {
        ok: false,
        status: 413,
        error: `File exceeds maximum preview size of ${maxSize} bytes`,
      };
    }

    const content = readFileSync(resolved, 'utf8');
    const ext = extname(resolved).slice(1).toLowerCase();

    return {
      ok: true,
      status: 200,
      path: resolved,
      content,
      extension: ext || 'txt',
      sizeBytes: stat.size,
    };
  } catch (err) {
    return {
      ok: false,
      status: 500,
      error: `Failed to read file: ${err.message}`,
    };
  }
}

/**
 * Parses markdown text into interleaved sections of rendered HTML and Mermaid diagram code blocks.
 */
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
