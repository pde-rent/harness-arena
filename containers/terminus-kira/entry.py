#!/usr/bin/env python3
"""Headless launcher for Terminus-KIRA (krafton-ai/KIRA), a native-tool-calling
variant of harbor's Terminus 2.

Upstream, KIRA is driven by `harbor run`, which brings its own container, its own
Terminal-Bench task format and its own grader. This rig supplies all three itself,
so harbor's orchestration is not used: the agent class is driven directly against
the bind-mounted workdir, which keeps the agent loop, prompts and tool schema
identical while holding task, instruction file and metering constant.

The only thing that has to be supplied is harbor's `BaseEnvironment` -- its
abstraction for "the machine the agent acts on". Here that machine is this
container, so LocalEnvironment implements it with subprocess and shutil. The
agent's own TmuxSession (constructed by Terminus2.setup) is stock and talks to it
through `exec` exactly as it would to a remote docker environment.

  entry.py --model <litellm-model> --api-base <url> <prompt>

Exits non-zero if the agent raises.
"""

import argparse
import asyncio
import logging
import shutil
import sys
from pathlib import Path

from harbor.environments.base import BaseEnvironment, ExecResult
from harbor.models.agent.context import AgentContext
from terminus_kira.terminus_kira import TerminusKira

WORKDIR = "/work"


class LocalEnvironment(BaseEnvironment):
    """harbor's environment abstraction, backed by this container.

    BaseEnvironment.__init__ wants a trial layout, an environment definition and a
    task config -- all harbor-orchestration concepts that do not exist here -- so it
    is bypassed and only the attributes the agent actually reads are set.
    """

    def __init__(self, session_id: str = "bench") -> None:
        self.environment_dir = Path(WORKDIR)
        self.environment_name = "bench"
        self.session_id = session_id
        self.trial_paths = None  # only read when terminal recording is enabled
        self.task_env_config = None
        self.logger = logging.getLogger("bench.env")

    @staticmethod
    def type() -> str:
        return "local"

    @property
    def is_mounted(self) -> bool:
        return True

    @property
    def supports_gpus(self) -> bool:
        return False

    @property
    def can_disable_internet(self) -> bool:
        return False

    def _validate_definition(self) -> None:
        return None

    async def start(self, force_build: bool = False) -> None:
        return None

    async def stop(self, delete: bool = False) -> None:
        return None

    async def exec(self, command, cwd=None, env=None, timeout_sec=None) -> ExecResult:
        proc = await asyncio.create_subprocess_shell(
            command,
            cwd=cwd or WORKDIR,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout_sec)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise
        return ExecResult(
            stdout=stdout.decode(errors="replace"),
            stderr=stderr.decode(errors="replace"),
            return_code=proc.returncode,
        )

    # Upload/download are host<->environment transfers upstream. Both sides are this
    # filesystem here, so they are copies.
    async def upload_file(self, source_path, target_path):
        Path(target_path).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_path, target_path)

    async def upload_dir(self, source_dir, target_dir):
        shutil.copytree(source_dir, target_dir, dirs_exist_ok=True)

    async def download_file(self, source_path, target_path):
        Path(target_path).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_path, target_path)

    async def download_dir(self, source_dir, target_dir):
        shutil.copytree(source_dir, target_dir, dirs_exist_ok=True)


async def run(model: str, api_base: str, prompt: str) -> None:
    env = LocalEnvironment()
    agent = TerminusKira(
        logs_dir=Path("/tmp/terminus-kira-logs"),
        model_name=model,
        api_base=api_base,
        # Recording is a harbor bench artefact, not agent behaviour, and it is the
        # only thing that needs a trial layout.
        record_terminal_session=False,
    )
    await agent.setup(env)
    context = AgentContext()
    try:
        await agent.run(prompt, env, context)
    finally:
        print(
            f"terminus-kira: input_tokens={context.n_input_tokens} "
            f"output_tokens={context.n_output_tokens} metadata={context.metadata}",
            file=sys.stderr,
        )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--api-base", required=True)
    ap.add_argument("prompt")
    args = ap.parse_args()
    asyncio.run(run(args.model, args.api_base, args.prompt))
    return 0


if __name__ == "__main__":
    sys.exit(main())
