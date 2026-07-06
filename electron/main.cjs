const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DEV_SERVER_URL = 'http://127.0.0.1:5173';
const MAX_FILES = 8000;
const MAX_FILE_BYTES = 1024 * 1024;
const SKIP_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  'coverage',
  'target',
  'vendor',
]);
const TEXT_EXTENSIONS = new Set([
  '.env',
  '.example',
  '.local',
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.conf',
  '.config',
  '.txt',
  '.md',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.cs',
  '.php',
  '.rb',
  '.sh',
  '.ps1',
  '.bat',
  '.sql',
  '.xml',
]);
const SECRET_PATTERNS = [
  { name: 'GitHub token', severity: 'high', regex: /\bgh[pousr]_[A-Za-z0-9_]{30,255}\b/g },
  { name: 'OpenAI API key', severity: 'high', regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { name: 'Anthropic API key', severity: 'high', regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'Google API key', severity: 'high', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'AWS access key', severity: 'high', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'Slack token', severity: 'high', regex: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { name: 'Private key block', severity: 'high', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  {
    name: 'Generic secret assignment',
    severity: 'medium',
    regex: /\b(?:api[_-]?key|secret|token|password|passwd|pwd)\b\s*[:=]\s*['"]?([A-Za-z0-9_./+=:-]{16,})/gi,
  },
];

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: 'Bobo Guard',
    backgroundColor: '#f6f8fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  } else {
    mainWindow.loadURL(DEV_SERVER_URL);
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('bobo:select-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Choose a project folder',
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('bobo:scan-directory', async (_event, targetPath) => {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new Error('A project folder is required.');
  }
  return scanDirectory(targetPath);
});

ipcMain.handle('bobo:audit-github', async () => auditGitHubRepos());

ipcMain.handle('bobo:open-external', async (_event, url) => {
  if (typeof url === 'string' && /^https:\/\/github\.com\//.test(url)) {
    await shell.openExternal(url);
  }
});

async function scanDirectory(rootPath) {
  const root = path.resolve(rootPath);
  const rootStat = await fs.stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error('Selected path is not a directory.');
  }

  const startedAt = new Date().toISOString();
  const risks = [];
  const scannedFiles = [];
  const skipped = { files: 0, directories: 0, largeFiles: 0 };
  const gitignoreText = await readOptional(path.join(root, '.gitignore'));
  const gitignoreLines = gitignoreText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  await walk(root);
  addProjectHygieneRisks(root, risks, gitignoreLines);

  const counts = countSeverities(risks);
  const score = Math.max(0, 100 - counts.high * 18 - counts.medium * 8 - counts.low * 3);

  return {
    root,
    scannedAt: startedAt,
    score,
    filesScanned: scannedFiles.length,
    bytesScanned: scannedFiles.reduce((total, file) => total + file.bytes, 0),
    skipped,
    risks,
    counts,
    gitignoreSuggestions: buildGitignoreSuggestions(gitignoreLines),
  };

  async function walk(currentDir) {
    if (scannedFiles.length >= MAX_FILES) {
      return;
    }

    let entries = [];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      skipped.directories += 1;
      return;
    }

    for (const entry of entries) {
      if (scannedFiles.length >= MAX_FILES) {
        break;
      }

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.endsWith('.app')) {
          skipped.directories += 1;
          continue;
        }
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      const isDotEnv = entry.name === '.env' || entry.name.startsWith('.env.');
      const isKeyFile = /\.(pem|key|p12|pfx)$/i.test(entry.name) || entry.name === 'id_rsa';
      if (!TEXT_EXTENSIONS.has(ext) && !isDotEnv && !isKeyFile) {
        skipped.files += 1;
        continue;
      }

      let stat;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        skipped.files += 1;
        continue;
      }

      if (stat.size > MAX_FILE_BYTES) {
        skipped.largeFiles += 1;
        continue;
      }

      const content = await readOptional(fullPath);
      scannedFiles.push({ path: fullPath, bytes: stat.size });
      inspectContent(root, fullPath, content, risks);
      if (isKeyFile) {
        risks.push(makeRisk('high', 'Private key file', root, fullPath, 1, 'Key material should not live inside a project folder.', 'Move it outside the repo and rotate it if it was ever committed.'));
      }
    }
  }
}

function inspectContent(root, fullPath, content, risks) {
  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(content)) !== null) {
      const value = match[1] || match[0];
      if (isLikelyPlaceholder(value)) {
        continue;
      }
      const line = lineNumberAt(content, match.index);
      risks.push(makeRisk(pattern.severity, pattern.name, root, fullPath, line, redact(value), adviceFor(pattern.name)));
      if (risks.length > 250) {
        return;
      }
    }
  }
}

function addProjectHygieneRisks(root, risks, gitignoreLines) {
  const envIgnored = gitignoreLines.some((line) => line === '.env' || line === '.env*' || line === '*.env' || line.includes('.env'));
  if (!envIgnored) {
    risks.push({
      id: 'missing-env-gitignore',
      severity: 'medium',
      title: '.env is not protected by .gitignore',
      location: '.gitignore',
      line: 1,
      evidence: '.env',
      advice: 'Add .env, .env.local, and key files to .gitignore before committing.',
    });
  }

  for (const fileName of ['.env', '.env.local', 'id_rsa']) {
    const fullPath = path.join(root, fileName);
    try {
      require('node:fs').accessSync(fullPath);
      risks.push(makeRisk(fileName === 'id_rsa' ? 'high' : 'medium', `${fileName} present`, root, fullPath, 1, fileName, 'Keep local secrets out of the repository and commit only safe examples.'));
    } catch {
      // File does not exist.
    }
  }
}

function buildGitignoreSuggestions(lines) {
  const desired = ['.env', '.env.*', '!.env.example', '*.pem', '*.key', 'id_rsa', 'secrets.*'];
  return desired.filter((item) => !lines.includes(item));
}

function makeRisk(severity, title, root, fullPath, line, evidence, advice) {
  const relativePath = path.relative(root, fullPath).replace(/\\/g, '/');
  return {
    id: `${severity}-${title}-${relativePath}-${line}-${evidence}`.slice(0, 160),
    severity,
    title,
    location: relativePath,
    line,
    evidence,
    advice,
  };
}

function lineNumberAt(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function redact(value) {
  const clean = String(value).trim();
  if (clean.length <= 10) {
    return `${clean.slice(0, 2)}...`;
  }
  return `${clean.slice(0, 6)}...${clean.slice(-4)}`;
}

function isLikelyPlaceholder(value) {
  const normalized = String(value).toLowerCase();
  return ['example', 'placeholder', 'changeme', 'your_', 'xxx', 'test', 'dummy', '<'].some((needle) => normalized.includes(needle));
}

function adviceFor(name) {
  if (name.includes('Private key')) {
    return 'Remove the key from the project, rotate it, and keep only a documented path or example file.';
  }
  if (name.includes('Generic')) {
    return 'Confirm whether this is a real credential. If it is, move it into a local secret store and rotate it.';
  }
  return 'Rotate this credential, remove it from Git history if committed, and replace it with an environment variable.';
}

function countSeverities(risks) {
  return risks.reduce(
    (acc, risk) => {
      acc[risk.severity] += 1;
      return acc;
    },
    { high: 0, medium: 0, low: 0 },
  );
}

async function readOptional(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function auditGitHubRepos() {
  const token = await getGitHubToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'bobo-guard-desktop',
  };
  const repos = await fetchAllRepos(headers);
  const recommendations = repos.map((repo) => recommendRepo(repo));
  const counts = {
    total: repos.length,
    public: repos.filter((repo) => !repo.private).length,
    private: repos.filter((repo) => repo.private).length,
    archived: repos.filter((repo) => repo.archived).length,
    improve: recommendations.filter((item) => item.action === 'improve').length,
    makePrivate: recommendations.filter((item) => item.action === 'private').length,
    archive: recommendations.filter((item) => item.action === 'archive').length,
  };

  return {
    scannedAt: new Date().toISOString(),
    counts,
    recommendations,
  };
}

async function fetchAllRepos(headers) {
  const repos = [];
  for (let page = 1; page <= 5; page += 1) {
    const response = await fetch(`https://api.github.com/user/repos?visibility=all&affiliation=owner&sort=updated&per_page=100&page=${page}`, { headers });
    if (!response.ok) {
      throw new Error(`GitHub API failed with HTTP ${response.status}.`);
    }
    const batch = await response.json();
    repos.push(...batch);
    if (batch.length < 100) {
      break;
    }
  }
  return repos;
}

function recommendRepo(repo) {
  const staleDays = daysSince(repo.pushed_at || repo.updated_at);
  const publicSensitive = !repo.private && /(poc|exploit|agent|jarvis|trading|binance|secret|token|seo)/i.test(`${repo.name} ${repo.description || ''}`);
  const missingDescription = !repo.description || repo.description.trim().length < 16;
  const missingLicense = !repo.license;
  const lowSignalPublic = !repo.private && repo.size < 80 && repo.stargazers_count < 3;

  if (repo.archived) {
    return buildRepoRecommendation(repo, 'keep', 'Archived', 'Already out of the active showcase.');
  }
  if (publicSensitive) {
    return buildRepoRecommendation(repo, 'private', 'Make private', 'Security, agent, or trading repos should stay private until the threat model and docs are strong.');
  }
  if (repo.fork && staleDays > 180) {
    return buildRepoRecommendation(repo, 'archive', 'Archive fork', 'Old forks add noise unless they contain an active patch set.');
  }
  if (!repo.private && staleDays > 540 && repo.stargazers_count < 5) {
    return buildRepoRecommendation(repo, 'archive', 'Archive stale repo', 'Public stale repos with little engagement dilute the profile.');
  }
  if (!repo.private && (missingDescription || missingLicense || lowSignalPublic)) {
    const gaps = [];
    if (missingDescription) gaps.push('description');
    if (missingLicense) gaps.push('license');
    if (lowSignalPublic) gaps.push('demo/readme polish');
    return buildRepoRecommendation(repo, 'improve', 'Improve showcase', `Add ${gaps.join(', ')}.`);
  }
  return buildRepoRecommendation(repo, 'keep', 'Keep active', 'Looks suitable for the public profile.');
}

function buildRepoRecommendation(repo, action, label, reason) {
  return {
    id: repo.id,
    name: repo.name,
    url: repo.html_url,
    action,
    label,
    reason,
    private: repo.private,
    archived: repo.archived,
    language: repo.language,
    stars: repo.stargazers_count,
    updatedAt: repo.updated_at,
  };
}

function daysSince(dateString) {
  if (!dateString) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.floor((Date.now() - new Date(dateString).getTime()) / 86400000);
}

async function getGitHubToken() {
  const output = await runGitCredentialFill();
  const lines = output.split(/\r?\n/);
  const fields = {};
  for (const line of lines) {
    const index = line.indexOf('=');
    if (index > 0) {
      fields[line.slice(0, index)] = line.slice(index + 1);
    }
  }
  if (!fields.password) {
    throw new Error('GitHub credential was not found in Git Credential Manager.');
  }
  return fields.password;
}

function runGitCredentialFill() {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['credential', 'fill'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `git credential fill exited with ${code}`));
      }
    });
    child.stdin.write('protocol=https\nhost=github.com\n\n');
    child.stdin.end();
  });
}
