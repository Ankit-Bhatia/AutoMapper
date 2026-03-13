import fs from 'node:fs';
import path from 'node:path';

function printHelp() {
  console.log(
    [
      'Usage:',
      '  node scripts/sync-status-jira.mjs --message "<summary>" [options]',
      '',
      'Required:',
      '  --message "<summary>"              One-line or multi-line update summary',
      '',
      'Options:',
      '  --agent <name>                     Default: codex',
      '  --issues <KAN-1,KAN-2>             Jira issue keys (comma separated)',
      '  --files <path1,path2>              Changed file paths (comma separated)',
      '  --status-file <path>               Default: docs/PROJECT-STATUS.md',
      '  --jira-url <url>                   Fallback env: JIRA_URL',
      '  --jira-email <email>               Fallback env: JIRA_EMAIL',
      '  --jira-token <token>               Fallback env: JIRA_API_TOKEN | JIRA_TOKEN',
      '  --dry-run                          Show actions without writing/posting',
      '  --help',
      '',
      'Examples:',
      '  node scripts/sync-status-jira.mjs --agent codex \\',
      '    --message "KAN-70 pipeline stall fix + mapping overlay cleanup" \\',
      '    --issues KAN-70,KAN-68 \\',
      '    --files apps/web/src/components/AgentPipeline.tsx,apps/web/src/styles.css',
    ].join('\n'),
  );
}

function parseArgs(argv) {
  const args = {
    agent: process.env.AGENT_NAME || 'codex',
    message: process.env.LOG_MESSAGE || '',
    issues: [],
    files: [],
    statusFile: 'docs/PROJECT-STATUS.md',
    jiraUrl: process.env.JIRA_URL || '',
    jiraEmail: process.env.JIRA_EMAIL || '',
    jiraToken: process.env.JIRA_API_TOKEN || process.env.JIRA_TOKEN || '',
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];

    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (token === '--agent' && next) {
      args.agent = next;
      i += 1;
      continue;
    }
    if (token === '--message' && next) {
      args.message = next;
      i += 1;
      continue;
    }
    if (token === '--issues' && next) {
      args.issues = next.split(',').map((value) => value.trim()).filter(Boolean);
      i += 1;
      continue;
    }
    if (token === '--files' && next) {
      args.files = next.split(',').map((value) => value.trim()).filter(Boolean);
      i += 1;
      continue;
    }
    if (token === '--status-file' && next) {
      args.statusFile = next;
      i += 1;
      continue;
    }
    if (token === '--jira-url' && next) {
      args.jiraUrl = next;
      i += 1;
      continue;
    }
    if (token === '--jira-email' && next) {
      args.jiraEmail = next;
      i += 1;
      continue;
    }
    if (token === '--jira-token' && next) {
      args.jiraToken = next;
      i += 1;
      continue;
    }
  }

  return args;
}

function nowIstDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function safeLine(value) {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function buildStatusEntry({ date, agent, message, issues, files }) {
  const lines = [];
  lines.push(`### ${date} — ${agent}`);
  for (const line of safeLine(message).split('\n')) {
    lines.push(`- ${line}`);
  }
  if (issues.length) lines.push(`- Jira: ${issues.join(', ')}`);
  if (files.length) lines.push(`- Files: ${files.map((file) => `\`${file}\``).join(', ')}`);
  return `${lines.join('\n')}\n`;
}

function updateStatusFile({ statusFile, entry, date, dryRun }) {
  const absolute = path.resolve(process.cwd(), statusFile);
  const exists = fs.existsSync(absolute);
  const initial = exists ? fs.readFileSync(absolute, 'utf8') : '';
  let content = initial;

  if (!exists) {
    content = [
      '## AutoMapper — Project Status',
      '',
      `> **Last updated:** ${date}`,
      '',
      '---',
      '',
      '## Recent Delivery Log',
      '',
      entry,
    ].join('\n');
  } else {
    content = content.replace(/^> \*\*Last updated:\*\* .*/m, `> **Last updated:** ${date}`);
    if (/## Recent Delivery Log/i.test(content)) {
      content = content.replace(
        /(## Recent Delivery Log[^\n]*\n)/i,
        `$1\n${entry}\n`,
      );
    } else {
      content = `${content.trimEnd()}\n\n---\n\n## Recent Delivery Log\n\n${entry}\n`;
    }
  }

  if (dryRun) {
    console.log(`[dry-run] Would update ${absolute}`);
    return;
  }

  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, 'utf8');
  console.log(`Updated ${path.relative(process.cwd(), absolute)}`);
}

function appendAgentChangeLog({ agent, message, dryRun }) {
  const logPath = path.resolve(process.cwd(), 'docs', 'agent-change-log.md');
  if (!fs.existsSync(logPath)) {
    if (dryRun) {
      console.log('[dry-run] Would create docs/agent-change-log.md');
    } else {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.writeFileSync(
        logPath,
        '# Agent Change Log\n\n' +
          'Tracks implementation entries by automation agent.\n\n' +
          '| Timestamp (UTC) | Agent | Message |\n' +
          '| --- | --- | --- |\n',
        'utf8',
      );
    }
  }

  const now = new Date().toISOString();
  const safeMessage = safeLine(message).replace(/\|/g, '\\|').replace(/\n/g, ' / ');
  const safeAgent = agent.replace(/\|/g, '\\|');
  const line = `| ${now} | ${safeAgent} | ${safeMessage} |\n`;

  if (dryRun) {
    console.log('[dry-run] Would append docs/agent-change-log.md entry');
    return;
  }
  fs.appendFileSync(logPath, line, 'utf8');
  console.log('Updated docs/agent-change-log.md');
}

function buildJiraComment({ date, agent, message, files, statusFile }) {
  const lines = [];
  lines.push(`[${agent} update | ${date}]`);
  lines.push(...safeLine(message).split('\n'));
  lines.push('');
  lines.push(`Status log updated: ${statusFile}`);
  if (files.length) {
    lines.push(`Files: ${files.join(', ')}`);
  }
  return lines.join('\n');
}

async function postJiraComments({
  jiraUrl,
  jiraEmail,
  jiraToken,
  issues,
  commentBody,
  dryRun,
}) {
  if (!issues.length) return;
  if (dryRun) {
    for (const issueKey of issues) {
      console.log(`[dry-run] Would post Jira comment to ${issueKey}`);
    }
    return;
  }
  if (!jiraUrl || !jiraEmail || !jiraToken) {
    throw new Error('Jira credentials missing. Provide --jira-url/--jira-email/--jira-token or set JIRA_URL/JIRA_EMAIL/JIRA_API_TOKEN.');
  }

  const auth = `Basic ${Buffer.from(`${jiraEmail}:${jiraToken}`).toString('base64')}`;
  const normalizedUrl = jiraUrl.replace(/\/+$/, '');

  for (const issueKey of issues) {
    const response = await fetch(`${normalizedUrl}/rest/api/2/issue/${issueKey}/comment`, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: commentBody }),
    });

    const payloadText = await response.text();
    if (!response.ok) {
      throw new Error(`Failed Jira comment for ${issueKey}: ${response.status} ${payloadText.slice(0, 240)}`);
    }
    const payload = JSON.parse(payloadText);
    console.log(`Jira comment posted: ${issueKey} (commentId=${payload.id})`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!safeLine(args.message)) {
    throw new Error('Missing required --message.');
  }

  const date = nowIstDate();
  const entry = buildStatusEntry({
    date,
    agent: args.agent,
    message: args.message,
    issues: args.issues,
    files: args.files,
  });

  updateStatusFile({
    statusFile: args.statusFile,
    entry,
    date,
    dryRun: args.dryRun,
  });
  appendAgentChangeLog({
    agent: args.agent,
    message: args.message,
    dryRun: args.dryRun,
  });

  const jiraBody = buildJiraComment({
    date,
    agent: args.agent,
    message: args.message,
    files: args.files,
    statusFile: args.statusFile,
  });
  await postJiraComments({
    jiraUrl: args.jiraUrl,
    jiraEmail: args.jiraEmail,
    jiraToken: args.jiraToken,
    issues: args.issues,
    commentBody: jiraBody,
    dryRun: args.dryRun,
  });

  if (!args.issues.length) {
    console.log('No Jira issues passed; skipped Jira comments.');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
