const { test } = require("node:test");
const assert = require("node:assert/strict");
const { lines, outline, validCell } = require("../viewer-grid.js");
const grid = { nx: 100, ny: 100 },
  node = (i, j) => [106 + i * 0.00001, 10 + j * 0.00001];
test("every grid boundary is drawn once, including outer edges, with 10-cell divisions", () => {
  const data = lines(grid, node);
  assert.equal(data.length, 202);
  assert.equal(data.filter((d) => d.major).length, 22);
  assert.deepEqual(data[100].path, [node(100, 0), node(100, 100)]);
});
test("selected cell outline is closed, aligned to all four grid nodes and current altitude", () => {
  const path = outline({ i: 4, j: 8 }, node, 15.08);
  assert.equal(path.length, 5);
  assert.deepEqual(path[0], path[4]);
  assert.deepEqual(path[2], [...node(5, 9), 15.08]);
  assert.ok(path.every((p) => p[2] === 15.08));
});
test("coordinate picker rejects out-of-range, fractional and invalid indices", () => {
  assert.ok(validCell(grid, 0, 0));
  assert.ok(validCell(grid, 99, 99));
  for (const [i, j] of [
    [100, 0],
    [-1, 0],
    [0, 100],
    [0.5, 0],
    [NaN, 1],
  ])
    assert.equal(validCell(grid, i, j), false);
});
