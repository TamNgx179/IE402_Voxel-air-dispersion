import {
  buildSolverInvocation,
  classifyExit,
  describeExit,
  overallProgress,
  parseProgressLine,
  TailBuffer,
} from './solver-protocol.js';

describe('classifyExit (spec D2 exit-code table)', () => {
  it.each([
    [0, null],
    [2, 'input'],
    [3, 'model'],
    [4, 'system'],
    [1, 'system'],
    [137, 'system'],
  ])('exit %s → %s', (code, kind) => {
    expect(classifyExit({ code })).toBe(kind);
  });

  it('a signal kill without timeout is a system error', () => {
    expect(classifyExit({ code: null, signal: 'SIGKILL' })).toBe('system');
  });

  it('timeout wins over the exit code', () => {
    expect(
      classifyExit({ code: null, signal: 'SIGTERM', timedOut: true }),
    ).toBe('timeout');
    expect(classifyExit({ code: 0, timedOut: true })).toBe('timeout');
  });

  it('a process that never started is a system error', () => {
    expect(
      classifyExit({ code: null, spawnError: new Error('spawn ENOENT') }),
    ).toBe('system');
  });

  it('describes each case', () => {
    expect(describeExit({ code: 3 }, 900)).toBe('solver exited with code 3');
    expect(describeExit({ code: null, timedOut: true }, 900)).toMatch(
      /900 s timeout/,
    );
    expect(
      describeExit({ code: null, spawnError: new Error('ENOENT') }, 9),
    ).toMatch(/could not be started: ENOENT/);
    expect(describeExit({ code: null, signal: 'SIGKILL' }, 9)).toMatch(
      /signal SIGKILL/,
    );
  });
});

describe('parseProgressLine', () => {
  it('parses a progress event', () => {
    expect(
      parseProgressLine(
        '{"event": "progress", "stage": "wind", "fraction": 0.25}',
      ),
    ).toEqual({
      stage: 'wind',
      fraction: 0.25,
    });
  });

  it.each([
    'Traceback (most recent call last):',
    '',
    '{not json',
    '{"event": "log", "message": "x"}',
    '{"event": "progress", "stage": "wind", "fraction": 1.5}',
    '{"event": "progress", "stage": "wind", "fraction": -0.1}',
    '{"event": "progress", "stage": "wind", "fraction": "0.5"}',
    '[1, 2]',
    'null',
  ])('ignores %j', (line) => {
    expect(parseProgressLine(line)).toBeNull();
  });

  it('tolerates surrounding whitespace and CR', () => {
    expect(
      parseProgressLine(
        '  {"event":"progress","stage":"export","fraction":1}\r',
      ),
    ).toEqual({
      stage: 'export',
      fraction: 1,
    });
  });
});

describe('overallProgress', () => {
  it('maps per-stage fractions onto one monotonic bar', () => {
    let p = 0;
    p = overallProgress(p, { stage: 'setup', fraction: 1 });
    expect(p).toBeCloseTo(0.05);
    p = overallProgress(p, { stage: 'wind', fraction: 0 });
    expect(p).toBeCloseTo(0.05);
    p = overallProgress(p, { stage: 'wind', fraction: 1 });
    expect(p).toBeCloseTo(0.4);
    p = overallProgress(p, { stage: 'transport', fraction: 0.5 });
    expect(p).toBeCloseTo(0.65);
    p = overallProgress(p, { stage: 'export', fraction: 1 });
    expect(p).toBe(1);
  });

  it('never goes backwards and ignores unknown stages', () => {
    expect(overallProgress(0.7, { stage: 'wind', fraction: 0.1 })).toBe(0.7);
    expect(overallProgress(0.3, { stage: 'mystery', fraction: 0.9 })).toBe(0.3);
  });
});

describe('buildSolverInvocation', () => {
  const base = {
    solverCmd: ['/venv/python', '-m', 'src.solver'],
    runId: '3f2b8c1e-6a4d-4e2b-9c1a-7d5e0f9a2b10',
    configPath: '/a/run/config.yaml',
    outDir: '/a/run',
  };

  it('builds the D2 argument array in mock mode', () => {
    expect(buildSolverInvocation({ ...base, mode: 'mock' })).toEqual({
      command: '/venv/python',
      args: [
        '-m',
        'src.solver',
        'run',
        '--run-id',
        base.runId,
        '--config',
        base.configPath,
        '--out',
        base.outDir,
        '--mock',
      ],
    });
  });

  it('adds --mock-fail only in mock mode', () => {
    expect(
      buildSolverInvocation({
        ...base,
        mode: 'mock',
        mockFail: 'model',
      }).args.slice(-3),
    ).toEqual(['--mock', '--mock-fail', 'model']);
    expect(
      buildSolverInvocation({ ...base, mode: 'real', mockFail: 'model' }).args,
    ).not.toContain('--mock-fail');
  });

  it('real mode has no --mock', () => {
    expect(buildSolverInvocation({ ...base, mode: 'real' }).args).not.toContain(
      '--mock',
    );
  });

  it('supports a custom command prefix', () => {
    const inv = buildSolverInvocation({
      ...base,
      solverCmd: ['node', 'fake.mjs'],
      mode: 'real',
    });
    expect(inv.command).toBe('node');
    expect(inv.args.slice(0, 2)).toEqual(['fake.mjs', 'run']);
  });
});

describe('TailBuffer', () => {
  it('keeps only the last N characters', () => {
    const t = new TailBuffer(10);
    for (let i = 0; i < 100; i++) t.push(String(i % 10));
    expect(t.toString()).toBe('0123456789');
    expect(t.toString()).toHaveLength(10);
  });
});
