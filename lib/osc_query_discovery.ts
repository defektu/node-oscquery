import { EventEmitter } from "node:events";
import axios from "axios";
import { SerializedHostInfo, SerializedNode } from "./serialized_node";
import { HostInfo } from "./osc_types";
import { OSCNode } from "./osc_node";
import { deserializeHostInfo, deserializeMethodNode } from "./deserialize";
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

/**
 * Format an IP address for use in a URL
 * IPv6 addresses need to be wrapped in brackets
 */
function formatAddressForURL(address: string): string {
	if (isIPv4(address)) {
		return address;
	} else {
		// IPv6 address - wrap in brackets
		return `[${address}]`;
	}
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
		const formattedAddress = formatAddressForURL(this.address);
		const baseUrl = `http://${formattedAddress}:${this.port}`;
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
		// Process OSCQuery services with both IPv4 and IPv6 addresses
		if (mdnsService.address && mdnsService.port) {
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