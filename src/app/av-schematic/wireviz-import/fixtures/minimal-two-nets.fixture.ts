/**
 * Minimal WireViz-style fixture for the issue #1 tracer bullet: two
 * connectors (Arduino Nano, TB6612FNG breakout) and exactly two nets between
 * them (a PWM speed line and a direction line), one wire color each.
 *
 * Written by hand for this slice, in the WireViz `connectors` / `cables` /
 * `connections` shape -- not copied from any WireForm/WireViz fixture or
 * example. See docs/wireviz-import-limits.md for what this parser accepts.
 */
export const MINIMAL_TWO_NETS_WIREVIZ_YAML = `
# Minimal WireViz fixture — issue #1 tracer bullet.
# Exactly two connectors and two point-to-point nets.
connectors:
  NANO:
    type: Arduino Nano
    pins: [D8, D9, GND, VIN, "5V"]
  TB6612FNG:
    type: TB6612FNG breakout
    pins: [PWMA, AIN1, STBY, VCC, GND]

cables:
  W1:
    colors: [YE]
  W2:
    colors: [OG]

connections:
  - - NANO: [D9]
    - W1: [1]
    - TB6612FNG: [PWMA]
  - - NANO: [D8]
    - W2: [1]
    - TB6612FNG: [AIN1]
`;

/** Diagram node ids the two WireViz connectors are placed on (see diagram/data.ts). */
export const MINIMAL_TWO_NETS_PLACEMENT: Readonly<Record<string, string>> = {
  NANO: 'nano-1',
  TB6612FNG: 'tb6612-1',
};
