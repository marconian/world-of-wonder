
  precision highp float;

  uniform float time;

  varying vec3 vAcceleration;

  vec3 convertHsvToRgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    float start = smoothstep(time, 0.0, 1.0);
    vec3 n;
    n.xy = gl_PointCoord * 2.0 - 1.0;
    n.z = 1.0 - dot(n.xy, n.xy);
    if (n.z < 0.0) discard;
    float aLength = length(vAcceleration);
    vec3 color = convertHsvToRgb(vec3(aLength * 0.08 + time * 0.05, 0.5, 0.8));
    gl_FragColor = vec4(color, 0.4 * start);
  }