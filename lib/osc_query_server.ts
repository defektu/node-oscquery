import http from "node:http";
import { getResponder, type Responder, type CiaoService, Protocol } from "@homebridge/ciao";
import portfinder from "portfinder";

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

export class OSCQueryServer {
	private _mdns: Responder;
	private _mdnsService: CiaoService | null = null;
	private _server: http.Server;
	private _wsServer: OSCQueryWebSocketServer | null = null;
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

		this._mdnsService = this._mdns.createService({
			name: serviceName,
			type: "oscjson",
			port: this._opts.httpPort,
			protocol: Protocol.TCP,
			hostname: `${serviceName}._oscjson._tcp`,
		});

		await Promise.all([
			httpListenPromise,
			wsListenPromise,
			this._mdnsService.advertise(),
		]);

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

		await Promise.all([
			httpEndPromise,
			wsEndPromise,
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
}