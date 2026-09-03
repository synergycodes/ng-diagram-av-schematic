import { type CanonicalJunction } from '../../diagram/model/canonical-project';

/**
 * Hand-written issue #2 fixture. The one-pin `style: simple` connector is
 * placed onto an existing rail so WireViz supplies electrical connectivity
 * while the versioned project supplies the visual rail identity and taps.
 */
export const MULTIDROP_RAIL_WIREVIZ_YAML = `
metadata:
  title: "Issue 2 multidrop rail"

connectors:
  SUPPLY:
    type: XT30
    subtype: female
    pins: [VCC]
    pinlabels: ["5V source"]
    color: BK
    manufacturer: Amass
    mpn: XT30U-F
    show_name: false
    x-source-tag: "1"
  RAIL_5V:
    type: Distribution point
    subtype: screw-rail
    style: simple
    pins: [1]
    notes: 5 V distribution rail
  LOAD_A:
    type: Sensor
    subtype: revision-a
    pins: [VIN]
  LOAD_B:
    type: Motor driver
    subtype: revision-b
    pins: [VCC]

cables:
  HARNESS:
    wirecount: 3
    colors: [RD, YE, BU]
    wirelabels: [feed, sensor, motor]
    gauge: "0.50 mm2"
    length: "0.25 m"
    notes: Main 5 V fan-out
    type: hookup
    manufacturer: Example Wire
    mpn: HW-050
    color_code: DIN
    shield: false
    x-batch: [alpha, beta]
  SPARE:
    wirecount: 2
    colors: ["#a1b2c3", GY]
    wirelabels: [unused-a, unused-b]
    notes: Disconnected spare cable

connections:
  - - SUPPLY: [VCC]
    - HARNESS: [feed]
    - RAIL_5V: [1]
  - - RAIL_5V: [1]
    - HARNESS: [YE]
    - LOAD_A: [VIN]
  - - RAIL_5V: [1]
    - HARNESS: [3]
    - LOAD_B: [VCC]
`;

export const MULTIDROP_RAIL_PLACEMENT: Readonly<Record<string, string>> = {
  SUPPLY: 'supply',
  RAIL_5V: 'rail-5v',
  LOAD_A: 'load-a',
  LOAD_B: 'load-b',
};

export const MULTIDROP_EXISTING_RAIL: CanonicalJunction = {
  id: 'rail-5v',
  label: 'Rail 5 V',
  kind: 'rail',
};
