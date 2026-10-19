"""DRY-RUN ONLY (never part of a mission): the REFERENCE RUNNER FIX, applied AFTER half-fix-bound-only.py. Streams decode through StringDecoder, and each stream is
REDACTED FIRST and BOUNDED SECOND, so no part of a secret survives a cut and the stored size honours the caller's bound.
Usage: python full-fix-runner.py   (run from the workspace root)"""
import pathlib

path = pathlib.Path('src/relay/workspace/command-runner.ts')
text = path.read_text(encoding='utf-8')


def swap(old: str, new: str) -> None:
    global text
    assert text.count(old) == 1, f'anchor not found exactly once: {old[:60]!r}'
    text = text.replace(old, new)


swap("import { spawn, type ChildProcess } from 'node:child_process';\n",
     "import { spawn, type ChildProcess } from 'node:child_process';\nimport { StringDecoder } from 'node:string_decoder';\n")
swap("    let child: ChildProcess;\n",
     "    let child: ChildProcess;\n    const stdoutDecoder = new StringDecoder('utf8');\n    const stderrDecoder = new StringDecoder('utf8');\n")
swap("      const boundedOut = boundOutput(stdout, request.outputLimitBytes);\n"
     "      const boundedErr = boundOutput(stderr, request.outputLimitBytes);\n"
     "      const cleanOut = sanitizeOutput(boundedOut.text);\n"
     "      const cleanErr = sanitizeOutput(boundedErr.text);\n",
     "      const cleanOut = sanitizeOutput(stdout + stdoutDecoder.end());\n"
     "      const cleanErr = sanitizeOutput(stderr + stderrDecoder.end());\n"
     "      const boundedOut = boundOutput(cleanOut.text, request.outputLimitBytes);\n"
     "      const boundedErr = boundOutput(cleanErr.text, request.outputLimitBytes);\n")
swap("        stdout: cleanOut.text,\n        stderr: cleanErr.text,\n",
     "        stdout: boundedOut.text,\n        stderr: boundedErr.text,\n")
swap("if (stdoutBytes <= request.outputLimitBytes * 2) stdout += chunk.toString('utf8');",
     "if (stdoutBytes <= request.outputLimitBytes * 2) stdout += stdoutDecoder.write(chunk);")
swap("if (stderrBytes <= request.outputLimitBytes * 2) stderr += chunk.toString('utf8');",
     "if (stderrBytes <= request.outputLimitBytes * 2) stderr += stderrDecoder.write(chunk);")
path.write_text(text, encoding='utf-8', newline='')
print('full fix applied: decoders per stream, redact first, bound second')
