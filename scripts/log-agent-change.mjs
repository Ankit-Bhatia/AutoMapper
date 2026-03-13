import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const agentArgIndex = args.findIndex((arg) => arg === '--agent');
const messageArgIndex = args.findIndex((arg) => arg === '--message');

const agent =
  (agentArgIndex >= 0 && args[agentArgIndex + 1]) ||
  process.env.AGENT_NAME ||
  'unknown';

const message =
  (messageArgIndex >= 0 && args[messageArgIndex + 1]) ||
  process.env.LOG_MESSAGE ||
  'Change entry recorded';

const now = new Date().toISOString();
const logPath = path.resolve(process.cwd(), 'docs', 'agent-change-log.md');

if (!fs.existsSync(logPath)) {
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

const safeMessage = message.replace(/\|/g, '\\|');
const safeAgent = agent.replace(/\|/g, '\\|');
const line = `| ${now} | ${safeAgent} | ${safeMessage} |\n`;
fs.appendFileSync(logPath, line, 'utf8');

console.log(`Logged ${safeAgent} change to docs/agent-change-log.md`);
