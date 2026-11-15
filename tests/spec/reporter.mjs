import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { SOURCE } from './canonical.mjs';

const clean = value => String(value ?? '').replace(/\u001b\[[0-9;]*m/g, '');
const cell = value => clean(value).replaceAll('|', '\\|').replace(/\s+/g, ' ').trim();
export default class SpecReporter {
  onBegin(config, suite) { this.suite = suite; }
  async onEnd(result) {
    const tests = this.suite.allTests().map(test => {
      const last = test.results.at(-1);
      const outcome = test.outcome();
      const status = outcome === 'expected' && last?.status === 'passed' ? 'PASS' :
        outcome === 'skipped' ? 'NOT RUN' : outcome === 'flaky' ? 'FLAKY' : 'FAIL';
      return {
        title: test.title, category: test.title.startsWith('[SPEC-') ? 'canonical' : 'regression',
        status, duration_ms: last?.duration ?? 0,
        errors: (last?.errors ?? []).map(error => clean(error.message)),
        location: test.location,
        attachments: (last?.attachments ?? []).map(({ name, path, contentType }) => ({ name, path, contentType }))
      };
    });
    let commit = 'unknown', dirty = null;
    try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
    try { dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()); } catch {}
    const totals = Object.fromEntries(['PASS', 'FAIL', 'FLAKY', 'NOT RUN'].map(status =>
      [status, tests.filter(test => test.status === status).length]));
    const report = { generated_at: new Date().toISOString(), commit, dirty, node: process.version,
      source: SOURCE, run_status: result.status, totals, tests };
    await mkdir('spec-report', { recursive: true });
    await writeFile('spec-report/results.json', JSON.stringify(report, null, 2) + '\n');
    const lines = [
      '# CanopyGuard specification evaluation', '',
      `Commit: \`${commit}\` · Node: \`${process.version}\` · Generated: ${report.generated_at}`, '',
      `Uncommitted changes at evaluation time: ${dirty === null ? 'unknown' : dirty ? 'yes' : 'no'}.`, '',
      `Source: **${SOURCE.title}**, \`${SOURCE.file}\`.`,
      `SHA-256: \`${SOURCE.sha256}\`. ${SOURCE.scope}`, '',
      `**${totals.PASS} passed; ${totals.FAIL} failed; ${totals.FLAKY} flaky; ${totals['NOT RUN']} not run.**`, '',
      'Failures are observed mismatches, not expected failures or automatically approved deviations.',
      'See docs/SPEC_EVALUATION.md for name mappings, later requirements, and untested limits.', '',
      '| Result | Requirement / regression |', '| --- | --- |',
      ...tests.map(test => `| ${test.status} | ${cell(test.title)} |`), '',
      '## Failure evidence', ''
    ];
    for (const test of tests.filter(test => test.status === 'FAIL')) {
      lines.push(`### ${test.title}`, '', '```text', test.errors.join('\n\n'), '```', '');
    }
    lines.push('Interactive report: run `npm run report:spec`.', '');
    await writeFile('spec-report/summary.md', lines.join('\n'));
  }
}
