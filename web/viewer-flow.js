/* Pure view-model math. Visual particles sample solver wind; not PM2.5 mass. */
(function (root) {
  "use strict";
  function rasterStyle() {
    return {
      version: 8,
      sources: {
        context: {
          type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          maxzoom: 19,
          attribution:
            '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
        },
      },
      layers: [
        {
          id: "context",
          type: "raster",
          source: "context",
          paint: { "raster-saturation": -0.65 },
        },
      ],
    };
  }
  function createField(data, grid, isAir) {
    if (!data) return null;
    const layers = new Map();
    let maxSpeed = 0;
    for (const layer of data.layers) {
      const samples = new Map();
      for (const row of layer.vectors) {
        samples.set(`${row[0]},${row[1]}`, row.slice(4, 7));
        maxSpeed = Math.max(maxSpeed, Math.hypot(...row.slice(4, 7)));
      }
      layers.set(layer.k, { ...layer, samples });
    }
    const air = (x, y, z) =>
      x >= 0 &&
      y >= 0 &&
      z >= 0 &&
      x < grid.nx * grid.dx_m &&
      y < grid.ny * grid.dy_m &&
      z < grid.nz * grid.dz_m &&
      isAir(x, y, z);
    function sample(x, y, z) {
      if (!air(x, y, z)) return null;
      const layer = layers.get(Math.floor(z / grid.dz_m));
      if (!layer) return null;
      const origin = Math.floor(data.stride / 2),
        stride = data.stride;
      const gx = (x / grid.dx_m - 0.5 - origin) / stride,
        gy = (y / grid.dy_m - 0.5 - origin) / stride;
      const ix = Math.floor(gx),
        iy = Math.floor(gy),
        fx = gx - ix,
        fy = gy - iy;
      const velocity = [0, 0, 0];
      let total = 0;
      for (const [a, wx] of [
        [ix, 1 - fx],
        [ix + 1, fx],
      ])
        for (const [b, wy] of [
          [iy, 1 - fy],
          [iy + 1, fy],
        ]) {
          const vector = layer.samples.get(
              `${origin + a * stride},${origin + b * stride}`,
            ),
            weight = wx * wy;
          if (!vector || weight <= 0) continue;
          total += weight;
          vector.forEach((v, n) => (velocity[n] += v * weight));
        }
      return total ? velocity.map((v) => v / total) : null;
    }
    return { grid, layers, air, sample, maxSpeed };
  }
  function createParticles(field, k) {
    const layer = field?.layers.get(k);
    if (!layer) return [];
    const stride = Math.max(1, Math.ceil(layer.vectors.length / 140));
    return layer.vectors
      .filter((_, n) => n % stride === 0)
      .map((row, n) => {
        const seed = {
          x: (row[0] + 0.5) * field.grid.dx_m,
          y: (row[1] + 0.5) * field.grid.dy_m,
          z: layer.z_m,
        };
        return {
          ...seed,
          seed,
          age: (((n * 37) % 101) / 101) * 18,
          fade: 1,
          history: [],
        };
      });
  }
  function reset(particle) {
    Object.assign(particle, particle.seed, { age: 0, history: [], fade: 0 });
  }
  function advance(field, particles, seconds) {
    if (!field || !Number.isFinite(seconds) || seconds <= 0) return;
    const subdivisions = Math.max(
      1,
      Math.ceil(
        (seconds * field.maxSpeed) /
          (Math.min(field.grid.dx_m, field.grid.dy_m, field.grid.dz_m) * 0.4),
      ),
    );
    const dt = seconds / subdivisions;
    for (const p of particles) {
      p.history.push([p.x, p.y, p.z]);
      if (p.history.length > 6) p.history.shift();
      for (let step = 0; step < subdivisions; step++) {
        const velocity = field.sample(p.x, p.y, p.z);
        if (!velocity) {
          reset(p);
          break;
        }
        const next = [
          p.x + velocity[0] * dt,
          p.y + velocity[1] * dt,
          p.z + velocity[2] * dt,
        ];
        if (!field.air(...next)) {
          reset(p);
          break;
        }
        [p.x, p.y, p.z] = next;
        p.age += dt;
        p.fade = Math.min(1, p.fade + dt / 3);
      }
    }
  }
  const api = { createField, createParticles, advance, rasterStyle };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ViewerFlow = api;
})(typeof window !== "undefined" ? window : globalThis);
