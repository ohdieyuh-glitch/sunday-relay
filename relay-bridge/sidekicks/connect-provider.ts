import { askForSecret } from './credential-intake';
import { SIDEKICK_CREDENTIAL_ROUTE } from './sidekick-routes';

/**
 * THE FOUNDER'S OWN CONNECT STEP.
 *
 *   npm run sidekick:connect openai
 *
 * Run by him, in his own terminal, on this machine. It asks for the key with the characters hidden, hands it to the
 * runtime that is already running on loopback, and prints only the reference that comes back. The key is never echoed,
 * never written to a file, never logged, and never reaches Wonderland.
 *
 * WHAT IT IS NOT: a way for anything else to set a credential. The route it posts to is loopback-only, refuses any
 * request carrying an Origin header, and accepts a key only from this machine.
 */

const BASE = process.env.SIDEKICK_URL ?? 'http://127.0.0.1:8795';

async function main(): Promise<void> {
  const providerId = process.argv[2];
  if (providerId !== 'openai') {
    console.error('Usage: npm run sidekick:connect openai');
    console.error('Claude Code needs no key here: sign in to the tool itself with its own flow, which is the safer route.');
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log('CONNECT AN OPENAI KEY TO WONDERLAND');
  console.log('');
  console.log('  Where it comes from: platform.openai.com -> API keys, in your own account.');
  console.log('  A ChatGPT Plus or Pro subscription does NOT by itself grant API access; API use is billed separately.');
  console.log('');
  console.log('  What happens to it: it is held in this running process and nowhere else. It is not written to disk, not');
  console.log('  logged, and never sent to Wonderland -- Wonderland only ever sees the state, the provider and the model.');
  console.log('  It does not survive a restart of this service, by design.');
  console.log('');

  const key = await askForSecret('Paste the key (it will not be shown), then press enter: ');
  if (key.trim().length === 0) {
    console.error('Nothing was given; nothing was connected.');
    process.exitCode = 1;
    return;
  }

  const response = await fetch(`${BASE}${SIDEKICK_CREDENTIAL_ROUTE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId, material: key }),
  }).catch((error: unknown) => {
    console.error(`The runtime is not answering at ${BASE}. Start it first with: npm run julius-connect:dev`);
    console.error(String(error).slice(0, 160));
    return null;
  });
  if (response === null) {
    process.exitCode = 1;
    return;
  }
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; credentialRef?: string; error?: { message?: string } };
  if (!response.ok || body.ok !== true) {
    console.error(`Not connected: ${body.error?.message ?? response.status}`);
    process.exitCode = 1;
    return;
  }
  console.log('');
  console.log(`Connected. The runtime holds it as ${body.credentialRef} -- that reference is all anything else will see.`);
  console.log('');
  console.log('One more step before anything is spent, which is deliberate:');
  console.log('  set WONDERLAND_SIDEKICK_LIVE=1 for the service and restart it, then in Wonderland:');
  console.log('    wl.Sidekicks.Connect llm openai');
  console.log('');
}

void main();
