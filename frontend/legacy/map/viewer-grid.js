/* Grid decoration only; node() uses the existing study-area transform. */
(function (root) {
  "use strict";
  function validCell(grid, i, j) {
    return (
      Number.isInteger(i) &&
      Number.isInteger(j) &&
      i >= 0 &&
      j >= 0 &&
      i < grid.nx &&
      j < grid.ny
    );
  }
  function lines(grid, node) {
    const result = [];
    for (let i = 0; i <= grid.nx; i++)
      result.push({
        major: i % 10 === 0 || i === grid.nx,
        path: [node(i, 0), node(i, grid.ny)],
      });
    for (let j = 0; j <= grid.ny; j++)
      result.push({
        major: j % 10 === 0 || j === grid.ny,
        path: [node(0, j), node(grid.nx, j)],
      });
    return result;
  }
  function outline(cell, node, z) {
    const { i, j } = cell;
    return [
      [i, j],
      [i + 1, j],
      [i + 1, j + 1],
      [i, j + 1],
      [i, j],
    ].map(([x, y]) => [...node(x, y), z]);
  }
  const api = { validCell, lines, outline };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ViewerGrid = api;
})(typeof window !== "undefined" ? window : globalThis);
