/**
 * Runtime-agnostic part of the library: types, the OSCNode tree and (de)serialization of the
 * OSCQuery JSON format. No Node.js APIs, so it runs in browsers and bundlers as well.
 * Import it as `@defektu/oscquery/core`.
 */

export { OSCTypeSimple, OSCTypeSimpleMap, OSCQAccess, OSCQAccessMap } from "./osc_types";
export type {
	OSCType,
	OSCQRange,
	OSCQRangeSingle,
	OSCQClipmode,
	OSCQClipmodeSingle,
	OSCQExtendedType,
	OSCQUnit,
	HostInfo,
} from "./osc_types";

export type { OSCMethodDescription, OSCMethodArgument } from "./osc_method_description";
export { OSCNode } from "./osc_node";
export type { SerializedNode, SerializedRange, SerializedHostInfo } from "./serialized_node";
export {
	deserializeHostInfo,
	deserializeMethodDescription,
	deserializeMethodNode,
	deserializeRange,
	parseTypeString,
} from "./deserialize";
export type { SerializedMethod } from "./deserialize";
export * from "./errors";
