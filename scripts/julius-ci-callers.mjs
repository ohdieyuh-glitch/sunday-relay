#!/usr/bin/env node
// Builds the executor-only caller table from two root secrets supplied in the environment.
// Kept as a file rather than an inline command so every deployment-capable path stays readable.
const primary=process.env.JULIUS_PRIMARY_ROOT,secondary=process.env.JULIUS_SECONDARY_ROOT,operator=process.env.JULIUS_OPERATOR_ROOT;
if(!primary||!secondary||!operator){process.stderr.write('julius_ci_callers_missing_roots\n');process.exit(1);}
// Fleet-wide operations are a separate authority. A tenant caller declares no operations and so receives
// only the tenant set; the operator declares the three that read or act across every tenant's sandboxes.
process.stdout.write(JSON.stringify([
  {callerId:process.env.JULIUS_CALLER_ID??'julius-prod',tenantId:process.env.JULIUS_TENANT_ID??'tenant',credentialRoot:primary},
  {callerId:process.env.JULIUS_OTHER_CALLER_ID??'julius-other',tenantId:process.env.JULIUS_OTHER_TENANT_ID??'other-tenant',credentialRoot:secondary},
  {callerId:'julius-operator',tenantId:process.env.JULIUS_TENANT_ID??'tenant',credentialRoot:operator,operations:['discover','reconcile','quarantine']},
]));
