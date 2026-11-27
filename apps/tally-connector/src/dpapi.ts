import { spawn } from 'node:child_process';
import { join } from 'node:path';

/**
 * Windows DPAPI through Windows PowerShell's `ProtectedData` (docs/03-roadmap-appendix/phase5.md
 * §2 question 1): the settings file is sealed to the Windows account that ran the setup, which is
 * the service's own account, so another account on the PC or a copy of the file elsewhere cannot
 * open it. No package is needed. The secret travels through standard input as Base64, never on a
 * command line another process could read, and PowerShell is started from its full path.
 */

/** Runs a PowerShell script with `input` on standard input and answers its standard output. */
export type PowerShell = (script: string, input: string) => Promise<string>;

/** Extra entropy, so a DPAPI blob from another program under the same account does not open. */
const ENTROPY = 'shakti-tally-connector';

function script(operation: 'Protect' | 'Unprotect'): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Security',
    '$in = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())',
    `$entropy = [Text.Encoding]::UTF8.GetBytes('${ENTROPY}')`,
    `$out = [Security.Cryptography.ProtectedData]::${operation}($in, $entropy, 'CurrentUser')`,
    '[Console]::Out.Write([Convert]::ToBase64String($out))',
  ].join('\n');
}

export class DpapiFailed extends Error {
  override name = 'DpapiFailed';
}

/** Windows PowerShell 5.1, which every supported Windows has, from its fixed place. */
export const runPowerShell: PowerShell = (text, input) =>
  new Promise((resolve, reject) => {
    const exe = join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const child = spawn(
      exe,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(text, 'utf16le').toString('base64'),
      ],
      { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true },
    );
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', () => {
      reject(new DpapiFailed('powershell_not_started'));
    });
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks).toString('ascii').trim());
      else reject(new DpapiFailed('powershell_failed'));
    });
    child.stdin.end(input, 'ascii');
  });

/** Seals text to the current Windows account; answers the sealed bytes as Base64. */
export async function protect(
  plain: string,
  powershell: PowerShell = runPowerShell,
): Promise<string> {
  const sealed = await powershell(script('Protect'), Buffer.from(plain, 'utf8').toString('base64'));
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(sealed)) throw new DpapiFailed('unexpected_output');
  return sealed;
}

/** Opens what `protect` sealed, under the same Windows account. */
export async function unprotect(
  sealed: string,
  powershell: PowerShell = runPowerShell,
): Promise<string> {
  const opened = await powershell(script('Unprotect'), sealed);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(opened)) throw new DpapiFailed('unexpected_output');
  return Buffer.from(opened, 'base64').toString('utf8');
}
