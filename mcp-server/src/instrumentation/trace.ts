export function isHotspotTraceEnabled(): boolean {
  return process.env.GOJO_TRACE_HOTSPOT === '1';
}

export function traceHotspot(scope: string, stage: string, payload: Record<string, unknown> = {}): void {
  if (!isHotspotTraceEnabled()) {
    return;
  }

  process.stderr.write(
    `${JSON.stringify({
      trace: 'gojo_hotspot',
      scope,
      stage,
      ts: new Date().toISOString(),
      ...payload,
    })}\n`,
  );
}

export async function traceAsync<T>(
  scope: string,
  stage: string,
  fn: () => Promise<T>,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const started = process.hrtime.bigint();
  try {
    const result = await fn();
    const ended = process.hrtime.bigint();
    traceHotspot(scope, stage, {
      ms: Number(ended - started) / 1_000_000,
      ...payload,
    });
    return result;
  } catch (error) {
    const ended = process.hrtime.bigint();
    traceHotspot(scope, `${stage}:error`, {
      ms: Number(ended - started) / 1_000_000,
      message: error instanceof Error ? error.message : String(error),
      ...payload,
    });
    throw error;
  }
}
