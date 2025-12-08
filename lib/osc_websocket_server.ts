import { WebSocketServer, WebSocket } from "ws";

export interface WebSocketClient {
	ws: WebSocket;
	subscribedPaths: Set<string>;
}

export interface WebSocketMessage {
	COMMAND: string;
	DATA?: unknown;
}

export interface OSCQueryWebSocketServerOptions {
	port?: number;
	host?: string;
	server?: any; // http.Server for attached mode
}

export class OSCQueryWebSocketServer {
	private _wsServer: WebSocketServer | null = null;
	private _wsClients: Set<WebSocketClient> = new Set();
	private _onOSCMessage?: (path: string, args: unknown[]) => void;

	constructor(private _opts: OSCQueryWebSocketServerOptions) {}

	/**
	 * Start the WebSocket server
	 */
	async start(): Promise<void> {
		return new Promise((resolve, reject) => {
			if (this._opts.server) {
				// Attached to HTTP server
				this._wsServer = new WebSocketServer({
					server: this._opts.server,
				});
				resolve();
			} else {
				// Standalone WebSocket server
				this._wsServer = new WebSocketServer({
					port: this._opts.port,
					host: this._opts.host,
				});

				this._wsServer.on("listening", () => {
					resolve();
				});

				this._wsServer.on("error", (err: Error) => {
					reject(err);
				});
			}

			// Set up connection handler
			this._wsServer.on("connection", (ws: WebSocket) => {
				this._handleWebSocketConnection(ws);
			});
		});
	}

	/**
	 * Stop the WebSocket server
	 */
	async stop(): Promise<void> {
		return new Promise((resolve) => {
			if (this._wsServer) {
				// Close all client connections
				for (const client of this._wsClients) {
					client.ws.close();
				}
				this._wsClients.clear();

				// Close the server
				this._wsServer.close(() => {
					this._wsServer = null;
					resolve();
				});
			} else {
				resolve();
			}
		});
	}

	/**
	 * Check if WebSocket server is running
	 */
	isRunning(): boolean {
		return this._wsServer !== null;
	}

	/**
	 * Set callback for handling incoming OSC messages
	 */
	setOSCMessageHandler(handler: (path: string, args: unknown[]) => void) {
		this._onOSCMessage = handler;
	}

	/**
	 * Broadcast PATH_CHANGED message to subscribed clients
	 */
	broadcastPathChanged(path: string) {
		if (this._wsClients.size === 0) {
			return;
		}

		const message = JSON.stringify({
			COMMAND: "PATH_CHANGED",
			DATA: path,
		});

		// Send to all clients subscribed to this path or any parent path
		for (const client of this._wsClients) {
			if (client.ws.readyState === WebSocket.OPEN) {
				// Check if client is subscribed to this path or any parent
				let shouldNotify = false;
				for (const subscribedPath of client.subscribedPaths) {
					if (path === subscribedPath || path.startsWith(subscribedPath + "/")) {
						shouldNotify = true;
						break;
					}
				}

				// If no specific subscription, notify all clients (default behavior)
				if (client.subscribedPaths.size === 0 || shouldNotify) {
					try {
						client.ws.send(message);
					} catch (err) {
						// Connection may have closed, remove it
						this._wsClients.delete(client);
					}
				}
			}
		}
	}

	/**
	 * Broadcast PATH_RENAMED message to all clients
	 */
	broadcastPathRenamed(oldPath: string, newPath: string) {
		if (this._wsClients.size === 0) {
			return;
		}

		const message = JSON.stringify({
			COMMAND: "PATH_RENAMED",
			DATA: {
				OLD: oldPath,
				NEW: newPath,
			},
		});

		for (const client of this._wsClients) {
			if (client.ws.readyState === WebSocket.OPEN) {
				try {
					client.ws.send(message);
				} catch (err) {
					this._wsClients.delete(client);
				}
			}
		}
	}

	/**
	 * Get number of connected clients
	 */
	getClientCount(): number {
		return this._wsClients.size;
	}

	private _handleWebSocketConnection(ws: WebSocket) {
		console.log("WebSocket client connected", {
			readyState: ws.readyState,
			protocol: ws.protocol,
			url: ws.url,
		});

		const client: WebSocketClient = {
			ws,
			subscribedPaths: new Set(),
		};

		this._wsClients.add(client);

		ws.on("message", (data: Buffer) => {
			this._handleMessage(client, data);
		});

		ws.on("close", (code: number, reason: Buffer) => {
			console.log("WebSocket client disconnected", {
				code,
				reason: reason.toString(),
			});
			this._wsClients.delete(client);
		});

		ws.on("error", (error: Error) => {
			console.error("WebSocket client error", error);
			this._wsClients.delete(client);
		});

		if (ws.readyState === WebSocket.OPEN) {
			console.log("WebSocket connection is open and ready");
		}
	}

	private _handleMessage(client: WebSocketClient, data: Buffer) {
		// Check if message is JSON (text) or binary (OSC)
		if (data.length > 0 && (data[0] === 0x2F || data[0] === 0x23)) {
			// Binary OSC message (starts with '/' or '#')
			// TODO: Handle OSC binary messages
			console.log("WebSocket binary OSC message received (not yet implemented)", {
				length: data.length,
				firstByte: data[0],
			});
			
			// When OSC binary handling is implemented, call this._onOSCMessage here
		} else {
			// Try to parse as JSON
			try {
				const messageStr = data.toString("utf8");
				const message: WebSocketMessage = JSON.parse(messageStr);
				this._handleWebSocketMessage(client, message);
				console.log("WebSocket JSON message received", message);
			} catch (err) {
				console.log("WebSocket: Failed to parse message as JSON", {
					error: err,
					dataLength: data.length,
					dataPreview: data.toString("utf8").substring(0, 100),
				});
			}
		}
	}

	private _handleWebSocketMessage(client: WebSocketClient, message: WebSocketMessage) {
		switch (message.COMMAND) {
			case "LISTEN": {
				const path = typeof message.DATA === "string" ? message.DATA : "";
				if (path) {
					client.subscribedPaths.add(path);
					console.log("Client subscribed to path:", path);
				}
				break;
			}
			case "IGNORE": {
				const path = typeof message.DATA === "string" ? message.DATA : "";
				if (path) {
					client.subscribedPaths.delete(path);
					console.log("Client unsubscribed from path:", path);
				}
				break;
			}
			// Handle other commands as needed
		}
	}
}

