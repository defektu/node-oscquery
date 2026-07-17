import { OSCQRange, OSCQClipmode, OSCType, OSCQAccess, OSCQExtendedType, OSCQUnit } from "./osc_types";

export interface OSCMethodDescription {
	full_path?: string, // only used in the for the discovery
	description?: string;
	access?: OSCQAccess,
	tags?: string[],
	critical?: boolean,
	arguments?: OSCMethodArgument[];
	overloads?: OSCMethodDescription[];
}

export interface OSCMethodArgument {
	type: OSCType,
	range?: OSCQRange,
	clipmode?: OSCQClipmode,
	extendedType?: string,
	unit?: string,
	value?: unknown,
}