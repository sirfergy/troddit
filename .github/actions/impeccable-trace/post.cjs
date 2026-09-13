const { ENTRYPOINT, NATIVE, requiredEnv, runIdentity } = require("./main.cjs");
const { TraceError, readTrace } = require("./trace.cjs");

console.log("IMPECCABLE_TRACE_POST_ENTERED");

function collect() {
  const identity = runIdentity();
  const filename = requiredEnv("STATE_impeccable_trace_file");
  const expected = {
    ...identity,
    trace_id: requiredEnv("STATE_impeccable_trace_id"),
    native_sha256: requiredEnv("STATE_impeccable_native_sha256"),
    wrapper_sha256: requiredEnv("STATE_impeccable_wrapper_sha256"),
  };
  const result = readTrace({
    root: requiredEnv("RUNNER_TEMP"), filename, expected, entrypoint: ENTRYPOINT, native: NATIVE,
  });
  for (const call of result.calls) {
    console.log("IMPECCABLE_NATIVE_INVOCATION " + JSON.stringify({ ...identity, trace_id: expected.trace_id, ...call }));
  }
  console.log("IMPECCABLE_TRACE_SUMMARY " + JSON.stringify({
    ...expected,
    outcome: result.outcome,
    recorded_calls: result.calls.length,
    recorded_completions: result.calls.filter((call) => call.status === "completed").length,
    completed_detect_commands: result.calls.filter((call) =>
      call.command === "detect" && call.status === "completed" && [0, 2].includes(call.return_code)
    ).length,
    issues: result.issues,
    coverage: "best_effort_configured_entrypoint_after_validation",
  }));
  if (result.issues.length) {
    console.error("::warning::Impeccable invocation logging is incomplete; counts are observed records only.");
  }
}

try {
  collect();
} catch (error) {
  const reason = error instanceof TraceError ? error.code : "collector_unavailable";
  console.log("IMPECCABLE_TRACE_SUMMARY " + JSON.stringify({ outcome: "incomplete", reason }));
  console.error("::warning::Impeccable invocation logging is unavailable; no execution count can be established.");
  if (!(error instanceof TraceError) && !Number.isInteger(error.errno)) process.exitCode = 1;
}
