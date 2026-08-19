/** Shared shapes for the harness A/B runner. */

export interface HarnessSpec {
	/** Stable id used in results and on metering rows. */
	id: string;
	/** Human label for the report. */
	label: string;
	/**
	 * Argv template for one headless run. Placeholders, substituted per run:
	 *   {{PROMPT_FILE}}  absolute path to a file holding the task prompt
	 *   {{PROMPT}}       the prompt text itself
	 *   {{WORKDIR}}      absolute path to the task working copy
	 *   {{MODEL}}        the pinned model id
	 */
	argv: string[];
	/** Extra env for the child. Same placeholders are substituted in values. */
	env?: Record<string, string>;
	/**
	 * Config files materialized before the run, path -> contents. Both are
	 * placeholder-substituted, so a harness can be pointed at the per-run proxy
	 * through its own config file rather than env alone.
	 */
	files?: Record<string, string>;
	/** How the prompt reaches the agent. */
	promptVia: "argv" | "stdin";
	/** Set false for a harness that cannot be run unattended yet. */
	enabled?: boolean;
	/** Notes surfaced in the report (e.g. approval flags used). */
	notes?: string;
	/**
	 * Optional containerized execution. When present (and `--native` is not
	 * passed) the harness runs inside `podman run --rm` instead of on the host:
	 * the task working copy is bind-mounted at `workdir` (default `/work`),
	 * `env` is forwarded with `-e`, and `{{WORKDIR}}` resolves to the in-container
	 * path for argv/env while per-run `files` are still written on the host.
	 * The proxy stays on the host and is reached at `host.containers.internal`.
	 */
	container?: ContainerSpec;
}

export interface ContainerSpec {
	/** Image reference, e.g. `bench/claude:pinned`. */
	image: string;
	/**
	 * Host path -> in-image path, applied to every `argv` entry that matches
	 * exactly. `argv` records host paths (the binary, and for the fork the bundle
	 * entry script); the image puts them elsewhere.
	 */
	argvRewrite?: Record<string, string>;
	/** Mount point for the task working copy inside the container. Default `/work`. */
	workdir?: string;
	/** Extra `podman run` arguments inserted before the image reference. */
	args?: string[];
}

export interface TaskMeta {
	id: string;
	category: string;
	difficulty?: string;
	timeoutSeconds: number;
	description?: string;
}

export interface UsageRow {
	runId: string;
	harness: string;
	promptTokens?: number;
	completionTokens?: number;
	reasoningTokens?: number;
	cachedTokens?: number;
	totalTokens?: number;
	costUsd?: number;
	ttfbMs?: number;
	totalMs?: number;
	providerServed?: string | null;
	status?: number;
}

export interface RunResult {
	runId: string;
	harness: string;
	task: string;
	category: string;
	attempt: number;
	solved: boolean;
	/** Why an unsolved run failed, when we can tell. */
	outcome: "solved" | "verify_failed" | "timeout" | "harness_error" | "discarded_unpinned";
	/** For a discarded run: which control it broke. Published, never silently dropped. */
	discardReason?: string;
	wallMs: number;
	exitCode: number | null;
	requests: number;
	promptTokens: number;
	completionTokens: number;
	reasoningTokens: number;
	cachedTokens: number;
	totalTokens: number;
	costUsd: number;
	providersServed: string[];
	stdoutPath: string;
	stderrPath: string;
}
