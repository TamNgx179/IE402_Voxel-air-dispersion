// Health is degraded when DB/Python/artifact storage is unavailable.
try {
  const response = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/health`, {
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) process.exit(1);
  const report = await response.json();
  process.exit(report.status === 'ok' ? 0 : 1);
} catch {
  process.exit(1);
}
