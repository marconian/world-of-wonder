
  uniform sampler2D velocity;
  uniform sampler2D acceleration;
  uniform float time;

  varying vec2 vUv;

  vec3 polar(float radian1, float radian2, float radius) {
    return vec3(
      cos(radian1) * cos(radian2) * radius,
      sin(radian1) * radius,
      cos(radian1) * sin(radian2) * radius
    );
  }

  void main(void) {
    vec3 v = texture2D(acceleration, vUv).xyz + texture2D(velocity, vUv).xyz;
    float vStep = step(1000.0, length(v));
    gl_FragColor = vec4(
      v * (1.0 - vStep) + normalize(v + polar(time, -time, 1.0)) * 80.0 * vStep,
      1.0
    );
  }