import { ROUTE_POSITION_TOLERANCE_PX } from '../../model/persisted-wire-route.mjs';

// Coordinate equality slack in px. Shared with persisted-route validation so
// a route produced by the editor cannot be rejected by save/open.
export const POSITION_TOLERANCE_PX = ROUTE_POSITION_TOLERANCE_PX;

// Looser slack for "is this interior point on the line between its neighbours",
// used when folding nearly-straight runs after a reshape/relink.
export const ALIGNMENT_TOLERANCE = 5;

// Link-snap gravity: how close the cursor gets before a relink snaps to a port.
export const PORT_SNAP_PX = 24;
