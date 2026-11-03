import { OSCQClipmode, OSCQExtendedType, OSCQUnit } from "./osc_types"

type SerializedRangeSingle = {
	MIN?: number,
	MAX?: number,
	VALS?: unknown[],
};
export type SerializedRange = SerializedRangeSingle | null | SerializedRange[];

export type SerializedNode = {
	FULL_PATH: string,
	CONTENTS?: Record<string, SerializedNode>,
	TYPE?: string,
	ACCESS?: number,
	// RANGE, CLIPMODE, EXTENDED_TYPE, UNIT and VALUE are per-argument arrays, or a single value
	// that applies to every argument (spec shorthand).
	RANGE?: SerializedRange,
	DESCRIPTION?: string,
	TAGS?: string[],
	CRITICAL?: boolean,
	CLIPMODE?: OSCQClipmode,
	EXTENDED_TYPE?: OSCQExtendedType,
	UNIT?: OSCQUnit,
	OVERLOADS?: SerializedNode[],
	VALUE?: unknown,
}

export type SerializedHostInfo = {
	NAME?: string;
	EXTENSIONS ?: Record<string, boolean>;
	OSC_IP?: string;
	OSC_PORT?: number;
	OSC_TRANSPORT?: "TCP" | "UDP";
	WS_IP?: string;
	WS_PORT?: number;
};