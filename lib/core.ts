/**
 * Runtime-agnostic part of the library: types, the OSCNode tree and (de)serialization of the
 * OSCQuery JSON format. No Node.js APIs, so it runs in browsers and bundlers as well.
 * Import it as `@defektu/oscquery/core`.
 */

export { OSCTypeSimple, OSCTypeSimpleMap, OSCQAccess, OSCQAccessMap } from "./osc_types.js";
export type {
	OSCType,
	OSCQRange,
	OSCQRangeSingle,
	OSCQClipmode,
	OSCQClipmodeSingle,
	OSCQExtendedType,
	OSCQUnit,
	HostInfo,
} from "./osc_types.js";

export type { OSCMethodDescription, OSCMethodArgument } from "./osc_method_description.js";
export { OSCNode } from "./osc_node.js";
export type { SerializedNode, SerializedRange, SerializedHostInfo } from "./serialized_node.js";
export {
	deserializeHostInfo,
	deserializeMethodDescription,
	deserializeMethodNode,
	deserializeRange,
	parseTypeString,
} from "./deserialize.js";
export type { SerializedMethod } from "./deserialize.js";
export * from "./errors.js";
