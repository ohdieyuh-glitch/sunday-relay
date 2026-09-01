#!/usr/bin/env node
// Readiness probe run inside the executor container: the service answers 404 on GET /v1/execute
// once it is listening, and anything else means it is not ready to be trusted with a request.
const url=process.env.EXECUTOR_READY_URL??'http://127.0.0.1:8787/v1/execute';
try{
  const response=await fetch(url);
  process.exit(response.status===404?0:1);
}catch{process.exit(1);}
