// Versor (unit quaternion) maths for rotating a globe under the finger.
// Adapted from d3/versor (https://github.com/d3/versor), ISC licence. Pure: no DOM, no d3.
//
// ISC License
//
// Copyright 2013-2021 Mike Bostock
//
// Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby
// granted, provided that the above copyright notice and this permission notice appear in all copies.
//
// THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
// INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN
// AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
// PERFORMANCE OF THIS SOFTWARE.

const RAD = Math.PI / 180, DEG = 180 / Math.PI;
const clamp1 = (x) => Math.max(-1, Math.min(1, x));

// Euler rotation [lambda, phi, gamma] in degrees (d3's convention) to a quaternion [w, x, y, z].
export default function versor(e) {
  const l = e[0] / 2 * RAD, p = e[1] / 2 * RAD, g = (e[2] || 0) / 2 * RAD;
  const sl = Math.sin(l), cl = Math.cos(l), sp = Math.sin(p), cp = Math.cos(p), sg = Math.sin(g), cg = Math.cos(g);
  return [
    cl * cp * cg + sl * sp * sg,
    sl * cp * cg - cl * sp * sg,
    cl * sp * cg + sl * cp * sg,
    cl * cp * sg - sl * sp * cg,
  ];
}

// [lon, lat] degrees to a unit vector.
versor.cartesian = (e) => {
  const l = e[0] * RAD, p = e[1] * RAD, cp = Math.cos(p);
  return [cp * Math.cos(l), cp * Math.sin(l), Math.sin(p)];
};

// Quaternion to Euler rotation [lambda, phi, gamma] in degrees.
versor.rotation = (q) => [
  Math.atan2(2 * (q[0] * q[1] + q[2] * q[3]), 1 - 2 * (q[1] * q[1] + q[2] * q[2])) * DEG,
  Math.asin(clamp1(2 * (q[0] * q[2] - q[3] * q[1]))) * DEG,
  Math.atan2(2 * (q[0] * q[3] + q[1] * q[2]), 1 - 2 * (q[2] * q[2] + q[3] * q[3])) * DEG,
];

// Quaternion for the shortest rotation taking unit vector v0 to v1.
versor.delta = (v0, v1) => {
  const w = [v0[1] * v1[2] - v0[2] * v1[1], v0[2] * v1[0] - v0[0] * v1[2], v0[0] * v1[1] - v0[1] * v1[0]];
  const l = Math.sqrt(w[0] * w[0] + w[1] * w[1] + w[2] * w[2]);
  if (!l) return [1, 0, 0, 0];
  const t = Math.acos(clamp1(v0[0] * v1[0] + v0[1] * v1[1] + v0[2] * v1[2])) / 2, s = Math.sin(t);
  return [Math.cos(t), w[2] / l * s, -w[1] / l * s, w[0] / l * s];
};

versor.multiply = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];

export { versor };
