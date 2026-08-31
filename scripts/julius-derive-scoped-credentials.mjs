#!/usr/bin/env node
// Runs on the deployment host, never inside Julius: prints one derived credential per operation
// so the orchestrator can be handed exactly the scopes it needs and never the root secret.
import { createHmac } from 'node:crypto';
const OPERATIONS=['create','prepare','execute','cancel','destroy','inspect','artifacts','discover','quarantine','reconcile'];
const root=process.env.EXECUTOR_CREDENTIAL_ROOT;
if(!root||root.length<16){process.stderr.write('executor_credential_root_too_weak\n');process.exit(1);}
const requested=process.argv.slice(2).length?process.argv.slice(2):OPERATIONS;
for(const operation of requested){
  if(!OPERATIONS.includes(operation)){process.stderr.write(`executor_operation_unknown:${operation}\n`);process.exit(1);}
  process.stdout.write(`${operation}=${createHmac('sha256',root).update(`julius-executor-scope:sandbox:${operation}`).digest('base64url')}\n`);
}
