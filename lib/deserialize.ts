import { SerializedHostInfo, SerializedNode, SerializedRange } from "./serialized_node";
import { OSCMethodArgument, OSCMethodDescription } from "./osc_method_description";
import { OSCQAccessMap, OSCQRange, OSCType, OSCTypeSimpleMap, HostInfo } from "./osc_types";
import { OSCNode } from "./osc_node";

export function deserializeHostInfo(host_info: SerializedHostInfo): HostInfo {
	return {
		name: host_info.NAME,
		extensions: host_info.EXTENSIONS,
		oscIp: host_info.OSC_IP,
		oscPort: host_info.OSC_PORT,
		oscTransport: host_info.OSC_TRANSPORT,
		wsIp: host_info.WS_IP,
		wsPort: host_info.WS_PORT,
	};
}

export function parseTypeString(type_string: string): OSCType {
	const tokens: (string | string[])[] = [];
	let current_token = "";
	let brackets_open = 0;
	for (const c of type_string) {
		if (c == "[" && brackets_open == 0) {
			current_token = "";
			brackets_open = 1;
		} else if (c == "[" && brackets_open > 0) {
			brackets_open += 1;
			current_token += c;
		} else if (c == "]" && brackets_open > 0) {
			brackets_open -= 1;
			if (brackets_open == 0) {
				tokens.push([ current_token ]);
			} else {
				current_token += c;
			}
		} else if (c in OSCTypeSimpleMap) {
			if (brackets_open == 0) {
				tokens.push(c);
			} else {
				current_token += c;
			}
		} // otherwise we ignore the invalid token
	}

	return tokens.map(token => {
		if (Array.isArray(token)) {
			return parseTypeString(token[0]);
		} else {
			return OSCTypeSimpleMap[token];
		}
	});
}

export function deserializeRange(range: SerializedRange): OSCQRange {
	if (Array.isArray(range)) {
		return range.map(r => deserializeRange(r));
	} else {
		if (range !== null && typeof range === "object") {
			return {
				min: range.MIN,
				max: range.MAX,
				vals: range.VALS,
			}
		} else {
			return null;
		}
	}
}

/**
 * The value an optional attribute (VALUE, RANGE, CLIPMODE, EXTENDED_TYPE, UNIT) holds for one argument.
 * The spec allows a single value instead of an array when every argument shares it, so anything
 * that is not an array applies to all arguments.
 */
function attributeForArgument<T>(attribute: T | T[] | undefined, index: number): T | undefined {
	if (attribute === undefined) return undefined;
	if (!Array.isArray(attribute)) return attribute;
	return attribute[index];
}

function deserializeArguments(node: SerializedMethod): OSCMethodArgument[] | undefined {
	if (!node.TYPE) return undefined;

	let arg_types = parseTypeString(node.TYPE);
	if (!Array.isArray(arg_types)) {
		arg_types = [ arg_types ]; // this should never happen
	}

	return arg_types.map((type, i) => {
		const method_arg: OSCMethodArgument = { type };

		const range = attributeForArgument<SerializedRange>(node.RANGE, i);
		if (range !== undefined && range !== null) {
			method_arg.range = deserializeRange(range);
		}

		const clipmode = attributeForArgument(node.CLIPMODE, i);
		if (clipmode) method_arg.clipmode = clipmode;

		const extendedType = attributeForArgument(node.EXTENDED_TYPE, i);
		if (typeof extendedType === "string") method_arg.extendedType = extendedType;

		const unit = attributeForArgument(node.UNIT, i);
		if (typeof unit === "string") method_arg.unit = unit;

		const value = attributeForArgument(node.VALUE, i);
		if (value !== undefined) method_arg.value = value;

		return method_arg;
	});
}

/** The attributes of a single node, without its children (CONTENTS) or path. */
export type SerializedMethod = Omit<SerializedNode, "FULL_PATH" | "CONTENTS">;

/** Interpret one node's attributes: access, description, typed arguments and overloads. */
export function deserializeMethodDescription(node: SerializedMethod): OSCMethodDescription {
	const desc: OSCMethodDescription = {};
	if (node.DESCRIPTION) desc.description = node.DESCRIPTION;
	if (node.ACCESS) desc.access = OSCQAccessMap[node.ACCESS];
	if (node.TAGS) desc.tags = node.TAGS;
	if (node.CRITICAL) desc.critical = node.CRITICAL;
	const args = deserializeArguments(node);
	if (args) desc.arguments = args;
	if (node.OVERLOADS && node.OVERLOADS.length > 0) {
		desc.overloads = node.OVERLOADS.map(deserializeMethodDescription);
	}
	return desc;
}

/** Build an OSCNode tree from a namespace JSON response (the reply to `GET /` or `GET /some/path`). */
export function deserializeMethodNode(node: SerializedNode, parent?: OSCNode): OSCNode {
	const full_path_split = node.FULL_PATH.split("/");
	const osc_node = new OSCNode(full_path_split[full_path_split.length - 1], parent);

	if (node.CONTENTS) {
		for (const key in node.CONTENTS) {
			osc_node.addChild(key, deserializeMethodNode(node.CONTENTS[key], osc_node));
		}
	}

	osc_node.setOpts(deserializeMethodDescription(node));

	return osc_node;
}
