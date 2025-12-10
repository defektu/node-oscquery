import http from "node:http";
import { getResponder, type Responder, type CiaoService, Protocol } from "@homebridge/ciao";
import portfinder from "portfinder";
import { Server as OSCServer } from "node-osc";

import { OSCNode } from "./osc_node"; 
import { SerializedHostInfo, SerializedNode } from "./serialized_node";
import { HostInfo, OSCQAccess } from "./osc_types";
import { OSCMethodDescription } from "./osc_method_description";
import { OSCQueryWebSocketServer } from "./osc_websocket_server";

export interface OSCQueryServiceOptions {
	httpPort?: number;
	bindAddress?: string;
	rootDescription?: string,
	oscQueryHostName?: string,
	oscIp?: string,
	oscPort?: number,
	oscTransport?: "TCP" | "UDP",
	serviceName?: string,
	wsIp?: string,
	wsPort?: number,
	broadcast?: boolean,
}

const EXTENSIONS = {
	ACCESS: true,
	VALUE: true,
	RANGE: true,
	DESCRIPTION: true,
	TAGS: true,
	// EXTENDED_TYPE 
	// UNIT
	CRITICAL: true,
	CLIPMODE: true,
	// OVERLOADS
	// HTML
	LISTEN: true, // Indicates WebSocket/bidirectional communication support
	PATH_CHANGED: true, // Indicates server will send PATH_CHANGED messages
}

const VALID_ATTRIBUTES = [
	"FULL_PATH",
	"CONTENTS",
	"TYPE",
	"ACCESS",
	"RANGE",
	"DESCRIPTION",
	"TAGS",
	"CRITICAL",
	"CLIPMODE",
	"VALUE",
	"HOST_INFO",
]

function respondJson(json: Object, res: http.ServerResponse) {
	res.setHeader("Content-Type", "application/json");
	res.write(JSON.stringify(json));
	res.end();
}

/**
 * Sanitize service name for mDNS according to RFC 6763:
 * - Normalize Unicode to ASCII
 * - Keep only alphanumeric chars and hyphens
 * - Cannot start or end with hyphen
 * - No spaces, underscores, or other punctuation
 * - Each label ≤ 63 bytes
 * - Full name ≤ 255 bytes (accounting for ._oscjson._tcp suffix = 13 bytes)
 */
function sanitizeName(name: string): string { 
	// Normalize Unicode characters (NFD = Normalization Form Decomposed)
	// This separates base characters from diacritics (é -> e + ´)
	let normalized = name.normalize("NFD");
	
	// Remove diacritics (accents, umlauts, etc.) and keep only ASCII alphanumeric and hyphens
	normalized = normalized.replace(/[\u0300-\u036f]/g, ""); // Remove combining diacritical marks
	normalized = normalized.replace(/[^a-zA-Z0-9-]/g, ""); // Keep only alphanumeric and hyphens
	
	// Split by dots (mDNS labels) and process each label
	const labels = normalized.split(".").filter(label => label.length > 0);
	const processedLabels: string[] = [];
	
	for (let label of labels) {
		// Collapse multiple consecutive hyphens to single hyphen
		label = label.replace(/-+/g, "-");
		
		// Remove leading and trailing hyphens
		label = label.replace(/^-+|-+$/g, "");
		
		// Skip empty labels
		if (label.length === 0) continue;
		
		// Truncate label to 63 bytes (UTF-8 encoding)
		// Since we only have ASCII chars, byte length = character length
		if (label.length > 63) {
			label = label.substring(0, 63);
			// Remove trailing hyphen if truncation created one
			label = label.replace(/-+$/, "");
		}
		
		if (label.length > 0) {
			processedLabels.push(label);
		}
	}
	
	// Join labels back with dots
	let result = processedLabels.join(".");
	
	// If no valid labels remain, use default
	if (result.length === 0) {
		result = "OSCQuery-" + Math.random().toString(36).substring(2, 15);
	}
	
	// Account for ._oscjson._tcp suffix (13 bytes) when checking total length
	// Full hostname format: ${result}._oscjson._tcp
	const maxServiceNameLength = 255 - 13; // Reserve space for suffix
	
	if (result.length > maxServiceNameLength) {
		// Truncate to fit, ensuring we don't end with hyphen or dot
		result = result.substring(0, maxServiceNameLength);
		// Remove trailing hyphens and dots (both are invalid at the end)
		result = result.replace(/[-.]+$/, "");
		
		// If truncation left nothing, use default
		if (result.length === 0) {
			result = "OSCQuery";
		}
	}
	
	return result;
}

export class OSCQueryServer {
	private _mdns: Responder;
	private _mdnsService: CiaoService | null = null;
	private _server: http.Server;
	private _wsServer: OSCQueryWebSocketServer | null = null;
	private _oscServer: OSCServer | null = null;
	private _opts: OSCQueryServiceOptions;
	private _root: OSCNode = new OSCNode("");

	constructor(opts?: OSCQueryServiceOptions) {
		this._opts = opts || {};

		this._server = http.createServer(this._httpHandler.bind(this));

		this._mdns = getResponder();

		this._root.setOpts({
			description: this._opts.rootDescription || "root node",
			access: OSCQAccess.NO_VALUE,
		});
	}

	_httpHandler(req: http.IncomingMessage, res: http.ServerResponse) {
		// Set CORS headers
		const origin = req.headers.origin;
		if (origin) {
			res.setHeader("Access-Control-Allow-Origin", origin);
		} else {
			res.setHeader("Access-Control-Allow-Origin", "*");
		}
		res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type");
		res.setHeader("Access-Control-Max-Age", "86400"); // 24 hours

		// Handle preflight OPTIONS request
		if (req.method === "OPTIONS") {
			res.statusCode = 204;
			res.end();
			return;
		}

		if (req.method != "GET") {
			res.statusCode = 400;
			res.end();
			return;
		}

		const url = new URL(req.url!, `http://${req.headers.host}`);
		return this._handleGet(url, res);
	}

	_handleGet(url: URL, res: http.ServerResponse) {
		const query = (url.search.length > 0) ? url.search.substring(1) : null;
		const path_split = url.pathname.split("/").filter(p => p !== "");

		if (query && !VALID_ATTRIBUTES.includes(query)) {
			res.statusCode = 400;
			return res.end();
		}

		if (query == "HOST_INFO") {
			// Build extensions dynamically - include WebSocket extensions only if server is running
			const extensions: Record<string, boolean> = {
				ACCESS: EXTENSIONS.ACCESS,
				VALUE: EXTENSIONS.VALUE,
				RANGE: EXTENSIONS.RANGE,
				DESCRIPTION: EXTENSIONS.DESCRIPTION,
				TAGS: EXTENSIONS.TAGS,
				CRITICAL: EXTENSIONS.CRITICAL,
				CLIPMODE: EXTENSIONS.CLIPMODE,
			};
			
			// Only include WebSocket extensions if server is running
			if (this._wsServer && this._wsServer.isRunning()) {
				extensions.LISTEN = EXTENSIONS.LISTEN;
				extensions.PATH_CHANGED = EXTENSIONS.PATH_CHANGED;
			}

			const hostInfo: SerializedHostInfo = {
				NAME: this._opts.oscQueryHostName,
				EXTENSIONS: extensions,
				OSC_IP: this._opts.oscIp || this._opts.bindAddress || "0.0.0.0", // the proposal says that an undefined OSC_IP means that the http host should be used, but I think it's okay to be nice about it
				OSC_PORT: this._opts.oscPort || this._opts.httpPort, // the proposal says that an undefined OSC_PORT means that the http port should be used, but I think it's okay to be nice about it
				OSC_TRANSPORT: this._opts.oscTransport || "UDP", // per the proposal the default for an undefined values is "UDP", but there is nothing wrong with setting it either way
				WS_IP: this._opts.wsIp || this._opts.bindAddress || "0.0.0.0",
				WS_PORT: this._opts.wsPort || this._opts.httpPort,
			};

			return respondJson(hostInfo, res);
		}

		let node = this._root;

		for (const path_component of path_split) {
			if (node.hasChild(path_component)) {
				node = node.getChild(path_component);
			} else {
				res.statusCode = 404;
				return res.end();
			}
		}

		if (!query) {
			return respondJson(node.serialize(), res);
		} else {
			const serialized = node.serialize();

			const access = serialized.ACCESS;
			if (access !== undefined) {
				if ((access == 0 || access == 2) && query == "VALUE") {
					res.statusCode = 204;
					return res.end();
				}
			}

			return respondJson({
				[query]: serialized[query as keyof SerializedNode],
			}, res);
		}
	}

	_getNodeForPath(path: string): OSCNode | null {
		const path_split = path.split("/").filter(p => p !== "");

		let node = this._root;

		for (const path_component of path_split) {
			if (node.hasChild(path_component)) {
				node = node.getChild(path_component);
			} else {
				return null; // this endpoint doesn't exist
			}
		}

		return node;
	}

	async start(): Promise<HostInfo> {
		if (!this._opts.httpPort) {
			this._opts.httpPort = await portfinder.getPortPromise();
		}

		// Start WebSocket server
		// According to OSCQuery proposal: if WS_PORT is not specified,
		// it defaults to the same port as the HTTP server
		if (!this._opts.wsPort) {
			this._opts.wsPort = this._opts.httpPort;
		}

		const wsIp = this._opts.wsIp || this._opts.bindAddress || "0.0.0.0";
		const httpIp = this._opts.bindAddress || "0.0.0.0";
		const isAttached = this._opts.wsPort === this._opts.httpPort && wsIp === httpIp;

		// Create WebSocket server
		if (isAttached) {
			console.log("WebSocket server attached to HTTP server", {
				port: this._opts.wsPort,
				host: wsIp,
			});
			this._wsServer = new OSCQueryWebSocketServer({
				server: this._server,
			});
		} else {
			console.log("WebSocket server created on separate port", {
				port: this._opts.wsPort,
				host: wsIp,
			});
			this._wsServer = new OSCQueryWebSocketServer({
				port: this._opts.wsPort,
				host: wsIp,
			});
		}

		// Set up HTTP server
		const httpListenPromise: Promise<void> = new Promise(resolve => {
			this._server.listen(this._opts.httpPort, this._opts.bindAddress || "0.0.0.0", resolve);
		});

		// Set up WebSocket server promise
		const wsListenPromise: Promise<void> = (async () => {
			if (isAttached) {
				// WebSocket server is attached to HTTP server, so start it after HTTP server is ready
				await httpListenPromise;
				await this._wsServer!.start();
				console.log("WebSocket server ready (attached to HTTP server)");
			} else {
				// Separate WebSocket server - start it independently
				await this._wsServer!.start();
				console.log("WebSocket server listening on port", this._opts.wsPort);
			}
		})();

		const serviceName = this._opts.serviceName ?? "OSCQuery";
		const sanitizedServiceName = sanitizeName(serviceName);

		this._mdnsService = this._mdns.createService({
			name: sanitizedServiceName,
			type: "oscjson",
			port: this._opts.httpPort,
			protocol: Protocol.TCP,
			hostname: `${sanitizedServiceName}._oscjson._tcp`,
		});

		// Set up OSC message handler for WebSocket binary messages
		if (this._wsServer) {
			this._wsServer.setOSCMessageHandler((path: string, args: unknown[]) => {
				this.receiveOSCMessage(path, args);
			});
		}

		// Set up OSC server for UDP/TCP OSC messages
		const oscPort = this._opts.oscPort || this._opts.httpPort!;
		const oscIp = this._opts.oscIp || this._opts.bindAddress || "0.0.0.0";
		const oscTransport = this._opts.oscTransport || "UDP";

		// Currently node-osc only supports UDP, but we set it up anyway
		if (oscTransport === "UDP") {
			const oscListenPromise: Promise<void> = new Promise((resolve) => {
				this._oscServer = new OSCServer(oscPort, oscIp, () => {
					console.log(`OSC server is listening on port ${oscPort}`);
					resolve();
				});
			});

			// TypeScript knows _oscServer is assigned above in the same block
			const oscServer = this._oscServer!;
			oscServer.on("message", (msg) => {
				const address = msg[0];
				const data = msg.slice(1);
				this.receiveOSCMessage(address, data);
			});

			oscServer.on("error", (err) => {
				console.error("OSC server error:", err);
			});

			await Promise.all([
				httpListenPromise,
				wsListenPromise,
				oscListenPromise,
				this._mdnsService.advertise(),
			]);
		} else {
			// TCP not yet supported by node-osc, log a warning
			console.warn(`OSC transport "${oscTransport}" is not yet supported, only UDP is available`);
			await Promise.all([
				httpListenPromise,
				wsListenPromise,
				this._mdnsService.advertise(),
			]);
		}

		// wsPort is guaranteed to be defined here since we set it above if it wasn't already set
		const wsPort = this._opts.wsPort!;

		return {
			name: this._opts.oscQueryHostName,
			extensions: EXTENSIONS,
			oscIp: this._opts.oscIp || this._opts.bindAddress || "0.0.0.0",
			oscPort: this._opts.oscPort || this._opts.httpPort,
			oscTransport: this._opts.oscTransport || "UDP",
			wsIp: this._opts.wsIp || this._opts.bindAddress || "0.0.0.0",
			wsPort: wsPort,
		};
	}

	async stop(): Promise<void> {
		const httpEndPromise: Promise<void> = new Promise((resolve, reject) => {
			this._server.close(err => err ? reject(err) : resolve());
		});

		const wsEndPromise: Promise<void> = (async () => {
			if (this._wsServer) {
				await this._wsServer.stop();
				this._wsServer = null;
			}
		})();

		const oscEndPromise: Promise<void> = new Promise((resolve) => {
			if (this._oscServer) {
				this._oscServer.close(() => {
					this._oscServer = null;
					resolve();
				});
			} else {
				resolve();
			}
		});

		await Promise.all([
			httpEndPromise,
			wsEndPromise,
			oscEndPromise,
			this._mdnsService ? this._mdnsService.end() : Promise.resolve(),
		]);
	}

	addMethod(path: string, params: OSCMethodDescription) {
		const path_split = path.split("/").filter(p => p !== "");

		let node = this._root;

		for (const path_component of path_split) {
			node = node.getOrCreateChild(path_component);
		}

		node.setOpts(params);
		if (this._wsServer) {
			this._wsServer.broadcastPathChanged(path);
		}
	}

	removeMethod(path: string) {
		let node = this._getNodeForPath(path);

		if (!node) return;

		node.setOpts({}); // make the node into an empty container

		// go back through the nodes in reverse and delete nodes until we have either reached the root or
		// hit a non-empty one
		while (node.parent != null && node.isEmpty()) {
			const parentPath = this._getPathForNode(node.parent);
			node.parent.removeChild(node.name);
			node = node.parent;
			// Broadcast changes for parent paths that were modified
			if (parentPath && this._wsServer) {
				this._wsServer.broadcastPathChanged(parentPath);
			}
		}

		if (this._wsServer) {
			this._wsServer.broadcastPathChanged(path);
		}
	}

	_getPathForNode(node: OSCNode): string {
		const pathComponents: string[] = [];
		let current: OSCNode | null = node;

		while (current && current.parent) {
			pathComponents.unshift(current.name);
			current = current.parent;
		}

		return "/" + pathComponents.join("/");
	}

	setValue(path: string, arg_index: number, value: unknown) {
		const node = this._getNodeForPath(path);

		if (node) {
			node.setValue(arg_index, value);
			if (this._wsServer) {
				this._wsServer.broadcastPathChanged(path);
			}
		}
	}

	/**
	 * Send OSC message to clients via WebSocket
	 * This sends the actual OSC binary message to all clients.
	 */
	sendValue(path: string, ...args: unknown[]) {
		const node = this._getNodeForPath(path);
		
		// Update internal node values if path exists
		if (node && args.length > 0) {
			for (let i = 0; i < args.length; i++) {
				try {
					node.setValue(i, args[i]);
				} catch (err) {
					console.error(`Failed to set value for ${path} argument ${i}:`, err);
				}
			}
		}

		// Send OSC message to WebSocket clients
		if (this._wsServer) {
			this._wsServer.broadcastOSCMessage(path, args);
		}
	}

	unsetValue(path: string, arg_index: number) {
		const node = this._getNodeForPath(path);

		if (node) {
			node.unsetValue(arg_index);
			if (this._wsServer) {
				this._wsServer.broadcastPathChanged(path);
			}
		}
	}

	/**
	 * Broadcast PATH_RENAMED message to all WebSocket clients
	 */
	broadcastPathRenamed(oldPath: string, newPath: string) {
		if (this._wsServer) {
			this._wsServer.broadcastPathRenamed(oldPath, newPath);
		}
	}

	/**
	 * Handle incoming OSC message (e.g., from WebSocket binary)
	 * Updates node values based on the OSC message path and arguments
	 */
	receiveOSCMessage(path: string, args: unknown[]) {
		const node = this._getNodeForPath(path);

		if (!node) {
			console.log(`OSC message received for unknown path: ${path}`);
			return;
		}

		// Check if node has arguments (is a method, not just a container)
		const serialized = node.serialize();
		const access = serialized.ACCESS;

		// Check if node is writable
		if (access === undefined || access === OSCQAccess.NO_VALUE || access === OSCQAccess.READONLY) {
			console.log(`OSC message received for read-only path: ${path}`);
			return;
		}

		// Update values for each argument
		for (let i = 0; i < args.length; i++) {
			try {
				node.setValue(i, args[i]);
			} catch (err) {
				console.error(`Failed to set value for ${path} argument ${i}:`, err);
			}
		}
		// broadcast oscquery message to all clients except sender (only if broadcast is enabled)
		if (this._opts.broadcast && this._wsServer) {
			this._wsServer.broadcastOSCMessage(path, args);
			console.log("Broadcasted OSC message", path, args);
		}
	}
}