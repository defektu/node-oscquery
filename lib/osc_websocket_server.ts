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
	 * Broadcast OSC message (binary) to subscribed clients
	 */
	broadcastOSCMessage(path: string, args: unknown[]) {
		if (this._wsClients.size === 0) {
			return;
		}

		const oscBuffer = this._encodeOSCMessage(path, args);
		if (!oscBuffer) {
			return;
		}

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
						client.ws.send(oscBuffer);
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
		console.log("WebSocket client connected");

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
			try {
				const decoded = this._decodeOSCMessage(data);
				if (decoded) {
					console.log("WebSocket binary OSC message received", {
						path: decoded.path,
						args: decoded.args,
					});
					
					// Call the OSC message handler if set
					if (this._onOSCMessage) {
						this._onOSCMessage(decoded.path, decoded.args);
					}
				}
			} catch (err) {
				console.error("Failed to decode OSC binary message", err);
			}
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

	/**
	 * Decode OSC binary message from buffer
	 * OSC format: address (null-terminated, 4-byte aligned) + type tag (null-terminated, 4-byte aligned) + arguments
	 */
	private _decodeOSCMessage(buffer: Buffer): { path: string; args: unknown[] } | null {
		if (buffer.length < 4) {
			return null;
		}

		let offset = 0;

		// Read address (null-terminated string, 4-byte aligned)
		const addressEnd = buffer.indexOf(0, offset);
		if (addressEnd === -1) {
			return null;
		}
		const path = buffer.toString("utf8", offset, addressEnd);
		offset = Math.ceil((addressEnd + 1) / 4) * 4; // Align to 4-byte boundary

		if (offset >= buffer.length) {
			return { path, args: [] };
		}

		// Read type tag string (starts with ',', null-terminated, 4-byte aligned)
		const typeTagEnd = buffer.indexOf(0, offset);
		if (typeTagEnd === -1 || buffer[offset] !== 0x2C) { // 0x2C is ','
			return { path, args: [] };
		}
		const typeTag = buffer.toString("utf8", offset + 1, typeTagEnd);
		offset = Math.ceil((typeTagEnd + 1) / 4) * 4; // Align to 4-byte boundary

		// Parse arguments based on type tag
		const args: unknown[] = [];

		for (let i = 0; i < typeTag.length && offset < buffer.length; i++) {
			const type = typeTag[i];
			let value: unknown;

			switch (type) {
				case "i": // int32
					if (offset + 4 > buffer.length) break;
					value = buffer.readInt32BE(offset);
					offset += 4;
					break;

				case "f": // float32
					if (offset + 4 > buffer.length) break;
					value = buffer.readFloatBE(offset);
					offset += 4;
					break;

				case "s": // string
				case "S": // alternate string
					const strEnd = buffer.indexOf(0, offset);
					if (strEnd === -1) break;
					value = buffer.toString("utf8", offset, strEnd);
					offset = Math.ceil((strEnd + 1) / 4) * 4;
					break;

				case "b": // blob
					if (offset + 4 > buffer.length) break;
					const blobSize = buffer.readUInt32BE(offset);
					offset += 4;
					if (offset + blobSize > buffer.length) break;
					value = buffer.subarray(offset, offset + blobSize);
					offset = Math.ceil((offset + blobSize) / 4) * 4;
					break;

				case "h": // int64
					if (offset + 8 > buffer.length) break;
					// Read as BigInt for 64-bit integers
					const high = buffer.readInt32BE(offset);
					const low = buffer.readUInt32BE(offset + 4);
					// Convert to number (may lose precision for very large values)
					value = high * 0x100000000 + low;
					offset += 8;
					break;

				case "t": // timetag
					if (offset + 8 > buffer.length) break;
					// OSC timetag is 64-bit NTP timestamp
					const seconds = buffer.readUInt32BE(offset);
					const fraction = buffer.readUInt32BE(offset + 4);
					value = { seconds, fraction };
					offset += 8;
					break;

				case "d": // float64 (double)
					if (offset + 8 > buffer.length) break;
					value = buffer.readDoubleBE(offset);
					offset += 8;
					break;

				case "c": // char
					if (offset + 4 > buffer.length) break;
					value = String.fromCharCode(buffer.readUInt32BE(offset));
					offset += 4;
					break;

				case "r": // RGBA color
					if (offset + 4 > buffer.length) break;
					const r = buffer[offset];
					const g = buffer[offset + 1];
					const b = buffer[offset + 2];
					const a = buffer[offset + 3];
					value = { r, g, b, a };
					offset += 4;
					break;

				case "m": // MIDI message
					if (offset + 4 > buffer.length) break;
					const port = buffer[offset];
					const status = buffer[offset + 1];
					const data1 = buffer[offset + 2];
					const data2 = buffer[offset + 3];
					value = { port, status, data1, data2 };
					offset += 4;
					break;

				case "T": // TRUE
					value = true;
					break;

				case "F": // FALSE
					value = false;
					break;

				case "N": // NIL
					value = null;
					break;

				case "I": // INFINITUM
					value = Infinity;
					break;

				case "[": // Array start
					// Arrays are handled by reading nested type tags
					// For simplicity, we'll skip arrays for now
					break;

				case "]": // Array end
					break;

				default:
					// Unknown type, skip
					break;
			}

			if (value !== undefined) {
				args.push(value);
			}
		}

		return { path, args };
	}

	/**
	 * Encode OSC message to binary buffer
	 * OSC format: address (null-terminated, 4-byte aligned) + type tag (null-terminated, 4-byte aligned) + arguments
	 */
	private _encodeOSCMessage(path: string, args: unknown[]): Buffer | null {
		// Encode address (path)
		const pathBuffer = Buffer.from(path + "\0", "utf8");
		const pathPadding = (4 - (pathBuffer.length % 4)) % 4;
		const paddedPathBuffer: Buffer = Buffer.concat([pathBuffer as Uint8Array, Buffer.alloc(pathPadding) as Uint8Array]) as Buffer;

		// Build type tag
		let typeTag = ",";
		const argBuffers: Buffer[] = [];

		for (const arg of args) {
			if (typeof arg === "number") {
				if (Number.isInteger(arg)) {
					// int32
					typeTag += "i";
					const buffer = Buffer.allocUnsafe(4);
					buffer.writeInt32BE(arg, 0);
					argBuffers.push(buffer);
				} else {
					// float32
					typeTag += "f";
					const buffer = Buffer.allocUnsafe(4);
					buffer.writeFloatBE(arg, 0);
					argBuffers.push(buffer);
				}
			} else if (typeof arg === "string") {
				typeTag += "s";
				const strBuffer = Buffer.from(arg + "\0", "utf8");
				const strPadding = (4 - (strBuffer.length % 4)) % 4;
				argBuffers.push(Buffer.concat([strBuffer as Uint8Array, Buffer.alloc(strPadding) as Uint8Array]) as Buffer);
			} else if (typeof arg === "boolean") {
				typeTag += arg ? "T" : "F";
			} else if (arg === null || arg === undefined) {
				typeTag += "N";
			} else if (Buffer.isBuffer(arg)) {
				// blob
				typeTag += "b";
				const sizeBuffer = Buffer.allocUnsafe(4);
				sizeBuffer.writeUInt32BE(arg.length, 0);
				const blobPadding = (4 - (arg.length % 4)) % 4;
				argBuffers.push(sizeBuffer);
				argBuffers.push(arg);
				argBuffers.push(Buffer.alloc(blobPadding));
			} else {
				console.error("Unsupported type", typeof arg);
				// Unsupported type, skip
				continue;
			}
		}

		// Encode type tag
		const typeTagBuffer = Buffer.from(typeTag + "\0", "utf8");
		const typeTagPadding = (4 - (typeTagBuffer.length % 4)) % 4;
		const paddedTypeTagBuffer: Buffer = Buffer.concat([typeTagBuffer as Uint8Array, Buffer.alloc(typeTagPadding) as Uint8Array]) as Buffer;

		// Combine all buffers
		return Buffer.concat([paddedPathBuffer as Uint8Array, paddedTypeTagBuffer as Uint8Array, ...argBuffers.map(b => b as Uint8Array)]) as Buffer;
	}
}

