#!/usr/bin/env python3
"""Headless launcher for terminal-bench's Terminus2 agent.

Terminus2 is a class, not a CLI. Upstream it is driven by the terminal-bench
harness, which hands it a `TmuxSession` backed by `docker exec` into a separate
task container. Here the agent already *is* inside the container the runner
started, so the only thing that has to change is the exec primitive: a local
subprocess instead of `container.exec_run`. Everything that defines the agent --
prompt templates, parsers, episode loop, summarisation, token accounting -- is
upstream code, untouched.

  entry.py --model <litellm-model> --api-base <url> <prompt>

Exits non-zero if the agent raises; the benchmark grades on verify.sh, but a
crash must never look like a completed run.
"""

import argparse
import subprocess
import sys
from collections import namedtuple
from pathlib import Path

from terminal_bench.agents.terminus_2.terminus_2 import Terminus2
from terminal_bench.terminal.tmux_session import TmuxSession
from terminal_bench.utils.logger import logger

# Same shape as docker.models.containers.ExecResult, which is all TmuxSession reads.
ExecResult = namedtuple("ExecResult", "exit_code output")

# tmux writes the pane transcript here. Upstream points it at the harness's shared
# log volume, which does not exist in this rig; keep it off the bind-mounted workdir
# so it never lands in the graded artifact.
_LOG_PATH = Path("/tmp/bench-terminus2.log")


class _LocalContainer:
    """Stands in for docker's Container: runs the command in *this* container."""

    def exec_run(self, cmd, user=""):  # noqa: ARG002 - signature parity with docker
        proc = subprocess.run(cmd, capture_output=True)
        return ExecResult(proc.returncode, proc.stdout + proc.stderr)


class LocalTmuxSession(TmuxSession):
    """TmuxSession over the local tmux server instead of a remote docker exec.

    Bypasses the parent __init__ (which requires a docker Container and copies an
    asciinema helper into it) and sets the same fields. Recording is disabled: the
    .cast file is a bench artefact of the upstream harness, not agent behaviour,
    and asciinema is not installed here.
    """

    def __init__(self, session_name: str) -> None:
        self.container = _LocalContainer()
        self._session_name = session_name
        self._commands_path = None
        self._disable_recording = True
        self._logger = logger.getChild(__name__)
        self._asciinema_markers = []
        self._previous_buffer = None
        self._user = ""

        if self._exec_run(["tmux", "-V"]).exit_code != 0:
            raise RuntimeError("tmux is not installed in this image")

    @property
    def logging_path(self) -> Path:
        return _LOG_PATH

    def _send_blocking_keys(self, keys, max_timeout_sec):
        # Upstream reaches for self.container.exec_run directly here, skipping the
        # user argument; route it through _exec_run so both paths behave the same.
        self._exec_run(self._tmux_send_keys(keys))
        result = self._exec_run(["timeout", f"{max_timeout_sec}s", "tmux", "wait", "done"])
        if result.exit_code != 0:
            raise TimeoutError(f"Command timed out after {max_timeout_sec} seconds")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--api-base", required=True)
    ap.add_argument("prompt")
    args = ap.parse_args()

    session = LocalTmuxSession("bench")
    session.start()
    try:
        agent = Terminus2(model_name=args.model, api_base=args.api_base)
        result = agent.perform_task(instruction=args.prompt, session=session)
    finally:
        session.stop()

    print(
        f"terminus-2: input_tokens={result.total_input_tokens} "
        f"output_tokens={result.total_output_tokens} failure_mode={result.failure_mode}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
