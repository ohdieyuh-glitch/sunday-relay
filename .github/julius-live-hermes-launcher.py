"""THE REVIEW PACKET REACHES HERMES THROUGH A FILE, NOT THROUGH ARGV.

`hermes -z` takes its prompt only as a command-line argument, and Linux refuses
any single argument of 131,072 bytes or more (MAX_ARG_STRLEN) with E2BIG before
a process exists. Mission 5's review packet was 80 KB. A larger one could not be
reviewed at all, and the refusal read as a missing binary. Cutting the packet to
fit would weaken the independent review on exactly the largest missions, so the
transport changes instead.

The paid reviewer's wrapper runs this file with the Hermes virtualenv's own
Python:

    python -P relay-hermes-launcher.py <hermes executable> [--relay-prompt-file PATH] ARGS...

With `--relay-prompt-file PATH` first, it reads the prompt from PATH and calls
the entry point the `hermes` console script calls, `hermes_cli.main.main`, with
`sys.argv` set to `[<hermes executable>, "-z", <prompt>, ARGS...]`. That is the
argument list the argv transport passes, built in memory, where no kernel limit
applies. Argument parsing, `--safe-mode`, profile loading and the one-shot run
are Hermes's own and unchanged. Without the flag every argument passes through,
exactly as the console script passes them.

The prompt file is refused, with exit status 97 and one marker line on stderr,
unless it is a regular file reached without following a symlink, owned by this
user and readable by nobody else, and non-empty valid UTF-8. `runHermesReview`
writes it that way inside the review's own scratch directory and removes it with
that directory. The marker names the reason and nothing from the file.
"""

import os
import stat
import sys

FLAG = "--relay-prompt-file"
TRANSPORT_EXIT_CODE = 97
MARKER = "relay_hermes_prompt_transport_unavailable"


def refuse(reason):
    sys.stderr.write(f"{MARKER}:{reason}\n")
    sys.stderr.flush()
    raise SystemExit(TRANSPORT_EXIT_CODE)


def read_prompt(path):
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError:
        refuse("prompt_file_unreadable")
    try:
        # The descriptor is judged before anything wraps it: on Linux a
        # directory opens read-only, and a file object over it would raise
        # rather than refuse.
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode):
            refuse("prompt_file_not_regular")
        # Ownership and mode mean something only where POSIX permissions exist.
        if os.name == "posix":
            if info.st_mode & 0o077:
                refuse("prompt_file_readable_by_others")
            if info.st_uid != os.getuid():
                refuse("prompt_file_not_owned_by_reviewer")
        with os.fdopen(descriptor, "rb", closefd=False) as handle:
            data = handle.read()
    finally:
        os.close(descriptor)
    try:
        prompt = data.decode("utf-8")
    except UnicodeDecodeError:
        refuse("prompt_file_not_utf8")
    if prompt == "":
        refuse("prompt_file_empty")
    return prompt


def launch(argv):
    if not argv:
        refuse("hermes_executable_not_named")
    hermes, rest = argv[0], list(argv[1:])
    if rest[:1] == [FLAG]:
        if len(rest) < 2:
            refuse("prompt_file_not_named")
        rest = ["-z", read_prompt(rest[1]), *rest[2:]]
    elif FLAG in rest:
        refuse("prompt_file_flag_not_first")
    # What the console script sets before it calls the same function.
    sys.argv = [hermes.removesuffix(".exe"), *rest]
    from hermes_cli.main import main

    return main()


if __name__ == "__main__":
    sys.exit(launch(sys.argv[1:]))
