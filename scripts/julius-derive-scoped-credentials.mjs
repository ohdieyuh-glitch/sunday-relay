#!/usr/bin/env node
// Runs on the deployment host, never inside Julius: derives one credential per operation from the
// executor's root secret, so the orchestrator can be handed exactly the scopes it needs and never the root.
import { createHmac } from 'node:crypto';
const OPERATIONS=['create','prepare','execute','cancel','destroy','inspect','artifacts','discover','quarantine','reconcile'];
const root=process.env.EXECUTOR_CREDENTIAL_ROOT;
if(!root||root.length<32){process.stderr.write('executor_credential_root_too_weak\n');process.exit(1);}
const args=process.argv.slice(2),json=args.includes('--json'),valuesOnly=args.includes('--values');
const requested=args.filter(argument=>argument!=='--json'&&argument!=='--values');
const chosen=requested.length?requested:OPERATIONS;
for(const operation of chosen)if(!OPERATIONS.includes(operation)){process.stderr.write(`executor_operation_unknown:${operation}\n`);process.exit(1);}
const derive=operation=>createHmac('sha256',root).update(`julius-executor-scope:sandbox:${operation}`).digest('base64url');
if(valuesOnly)for(const operation of chosen)process.stdout.write(`${derive(operation)}\n`);
else if(json)process.stdout.write(`${JSON.stringify(Object.fromEntries(chosen.map(operation=>[operation,derive(operation)])))}\n`);
else for(const operation of chosen)process.stdout.write(`${operation}=${derive(operation)}\n`);
