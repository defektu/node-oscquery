import { EventEmitter } from "node:events";
import axios from "axios";
import { SerializedHostInfo, SerializedNode, SerializedRange } from "./serialized_node";
import { OSCMethodArgument } from "./osc_method_description";
import { OSCQAccessMap, OSCQRange, OSCType, OSCTypeSimpleMap, HostInfo } from "./osc_types";
import { OSCNode } from "./osc_node";
import { MDNSDiscovery } from "./mdns_discovery";

/**
 * Check if an address is IPv4 (not IPv6)
 */
function isIPv4(address: string): boolean {
	// IPv6 addresses contain colons (and possibly multiple colons)
	// Simple check: if it contains colons, it's likely IPv6
	// More robust: count colons - IPv4 has no colons, IPv6 has multiple
	return !address.includes(":");
}

function deserializeHostInfo(host_info: SerializedHostInfo): HostInfo {
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

function parseTypeString(type_string: string): OSCType {
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

function deserializeRange(range: SerializedRange): OSCQRange {
	if (Array.isArray(range)) {
		return range.map(r => deserializeRange(r));
	} else {
		if (range !== null) {
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

function deserializeMethodNode(node: SerializedNode, parent?: OSCNode): OSCNode {
	const full_path_split = node.FULL_PATH.split("/");
	const osc_node = new OSCNode(full_path_split[full_path_split.length - 1], parent);

	if (node.CONTENTS) {
		for (const key in node.CONTENTS) {
			osc_node.addChild(key, deserializeMethodNode(node.CONTENTS[key], osc_node));
		}
	}

	let method_arguments: OSCMethodArgument[] | undefined = undefined;
	if (node.TYPE) {
		method_arguments = [];
		let arg_types = parseTypeString(node.TYPE);
		
		if (!Array.isArray(arg_types)) {
			arg_types = [ arg_types ]; // this should never happen
		}

		for (let i = 0; i < arg_types.length; i++) {
			const method_arg: OSCMethodArgument = {
				type: arg_types[i],
			};

			if (node.RANGE && node.RANGE[i] !== null) {
				method_arg.range = deserializeRange(node.RANGE[i]!);
			}

			if (node.CLIPMODE && node.CLIPMODE[i]) {
				method_arg.clipmode = node.CLIPMODE[i]!;
			}

			if (node.VALUE && node.VALUE[i] !== undefined) {
				method_arg.value = node.VALUE[i];
			}

			method_arguments.push(method_arg);
		}
	}

	osc_node.setOpts({
		description: node.DESCRIPTION,
		access: node.ACCESS ? OSCQAccessMap[node.ACCESS] : undefined,
		tags: node.TAGS,
		critical: node.CRITICAL,
		arguments: method_arguments,
	});

	return osc_node;
}

export class DiscoveredService {
	private _hostInfo?: HostInfo;
	private _nodes?: OSCNode;

	constructor(
		readonly address: string,
		readonly port: number,
	) {}

	get hostInfo(): HostInfo {
		if (!this._hostInfo) {
			throw new Error("HostInfo has not been loaded yet");
		}
		return this._hostInfo;
	}

	get nodes(): OSCNode {
		if (!this._nodes) {
			throw new Error("Nodes have not been loaded yet");
		}
		return this._nodes;
	}

	flat() {
		return Array.from(this.nodes._methodGenerator());
	}
	async update() {
		console.log("Updating service", this.address, this.port);
		// Only use IPv4 addresses for HTTP requests
		if (!isIPv4(this.address)) {
			throw new Error(`Skipping IPv6 address ${this.address}, only IPv4 addresses are supported for HTTP requests`);
		}
		const baseUrl = `http://${this.address}:${this.port}`;
		const baseResp = await axios.get<SerializedNode>(baseUrl);
		const hostInfoResp = await axios.get<SerializedHostInfo>(baseUrl + "?HOST_INFO");

		this._hostInfo = deserializeHostInfo(hostInfoResp.data);
		this._nodes = deserializeMethodNode(baseResp.data);
	}

	resolvePath(path: string): OSCNode | null {
		const path_split = path.split("/").filter(p => p !== "");

		let node = this.nodes;

		for (const path_component of path_split) {
			if (node.hasChild(path_component)) {
				node = node.getChild(path_component);
			} else {
				return null; // this endpoint doesn't exist
			}
		}

		return node;
	}
}

export class OSCQueryDiscovery extends EventEmitter {
	private _mdnsDiscovery: MDNSDiscovery | null = null;
	private _services: DiscoveredService[] = [];

	constructor() {
		super();
	}

	_handleUp(mdnsService: { address: string; port: number }) {
		// Only process OSCQuery services with IPv4 addresses
		if (mdnsService.address && mdnsService.port && isIPv4(mdnsService.address)) {
			this.queryNewService(mdnsService.address, mdnsService.port).catch((err) => {
				this.emit("error", err);
			});
		}
	}

	_handleDown(mdnsService: { address: string; port: number }) {
		const existingIndex = this._services.findIndex(
			(s) => s.address == mdnsService.address && s.port == mdnsService.port
		);

		if (existingIndex > -1) {
			const removedService = this._services[existingIndex];
			this.emit("down", removedService);
			this._services.splice(existingIndex, 1);
		}
	}

	async queryNewService(address: string, port: number): Promise<DiscoveredService> {
		const service = new DiscoveredService(address, port);

		await service.update();

		this._services.push(service);
		this.emit("up", service);
		return service;
	}

	start() {
		if (this._mdnsDiscovery) {
			return;
		}

		// Use MDNSDiscovery to discover OSCQuery services
		// MDNSDiscovery automatically detects the correct network interface for network discovery
		this._mdnsDiscovery = new MDNSDiscovery({
			serviceTypes: ["oscjson"],
			protocol: "tcp",
			errorCallback: (err: any) => {
				this.emit("error", err);
			},
		});

		// Forward MDNSDiscovery events
		this._mdnsDiscovery.on("up", (mdnsService) => {
			// Only process if it's an OSCQuery service (type check)
			if (mdnsService.type === "oscjson" || mdnsService.fullType.includes("oscjson")) {
				this._handleUp(mdnsService);
			}
		});

		this._mdnsDiscovery.on("down", (mdnsService) => {
			this._handleDown(mdnsService);
		});

		// Start discovery - this will automatically detect and use the correct network interface
		this._mdnsDiscovery.start();
	}

	stop() {
		if (!this._mdnsDiscovery) {
			return;
		}

		this._mdnsDiscovery.stop();
		this._mdnsDiscovery = null;
	}

	getServices() {
		return this._services;
	}
}