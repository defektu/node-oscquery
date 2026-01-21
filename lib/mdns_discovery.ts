import { EventEmitter } from "node:events";
import { networkInterfaces, platform } from "node:os";
import Bonjour, { ServiceConfig, type Browser, type Service } from "bonjour-service";

/**
 * Options for multicast-dns (passed to Bonjour constructor)
 * Type definition based on multicast-dns package implementation
 * @see https://github.com/mafintosh/multicast-dns
 * 
 * Extracted from multicast-dns/index.js implementation
 */
export interface MulticastDNSOptions {
	/** Set the UDP port (default: 5353) */
	port?: number;
	/** Socket type: 'udp4' or 'udp6' (default: 'udp4') */
	type?: "udp4" | "udp6";
	/** Set the UDP IP address (default: '224.0.0.251' for udp4) */
	ip?: string;
	/** Alias for ip */
	host?: string;
	/** Explicitly specify a network interface IP address (required for udp6) */
	interface?: string;
	/** Set the reuseAddr option when creating the socket (default: true) */
	reuseAddr?: boolean;
	/** Use UDP multicasting (default: true) */
	multicast?: boolean;
	/** Set the multicast TTL (default: 255) */
	ttl?: number;
	/** Receive your own packets (default: true) */
	loopback?: boolean;
	/** Bind address (string) or disable binding (false) */
	bind?: string | false;
	/** Custom socket instance */
	socket?: any;
}

/**
 * Generic mDNS service information
 */
export interface DiscoveredMDNSService {
	readonly address: string;
	readonly port: number;
	readonly name: string;
	readonly type: string;
	readonly fullType: string;
	readonly host: string;
	readonly txt: Record<string, any>;
}

/**
 * Options for MDNSDiscovery
 */
export interface MDNSDiscoveryOptions {
	/**
	 * Service types to discover (e.g., ["http", "_http._tcp", "oscjson"])
	 * Leading underscores and ._tcp suffixes are automatically normalized
	 */
	serviceTypes?: string[];
	/**
	 * Protocol to use (default: "tcp")
	 */
	protocol?: "tcp" | "udp";
	/**
	 * Error callback (optional, errors are also emitted as events)
	 */
	errorCallback?: (err: any) => void;
}

/**
 * Generic mDNS Discovery class for discovering any service type via mDNS/Bonjour
 */
export class MDNSDiscovery extends EventEmitter {
	private _mdns: Bonjour | null = null;
	private _browsers: Map<string, Browser> = new Map();
	private _services: Map<string, DiscoveredMDNSService> = new Map();
	private _serviceTypes: string[] = [];
	private _protocol: "tcp" | "udp" = "tcp";

	constructor(options: MDNSDiscoveryOptions = {}) {
		super();
		this._serviceTypes = options.serviceTypes || [];
		this._protocol = options.protocol || "tcp";

		if (options.errorCallback) {
			this.on("error", options.errorCallback);
		}
	}

	/**
	 * Normalize service type string
	 * Removes leading underscore and ._tcp suffix if present
	 */
	private _normalizeServiceType(serviceType: string): string {
		return serviceType.replace(/^_/, "").replace(/\._tcp$/, "");
	}

	/**
	 * Get service key for tracking
	 */
	private _getServiceKey(address: string, port: number): string {
		return `${address}:${port}`;
	}

	/**
	 * Handle service discovery
	 */
	private _handleUp(service: Service, serviceType: string) {
		if (service.protocol !== this._protocol) {
			return;
		}

		service.addresses?.forEach((address) => {
			const key = this._getServiceKey(address, service.port);
			const serviceInfo: DiscoveredMDNSService = {
				address: address,
				port: service.port,
				name: service.name,
				type: service.type,
				fullType: service.type + "._" + this._protocol + ".local",
				host: service.host,
				txt: service.txt || {},
			};

			// Only emit if this is a new service
			if (!this._services.has(key)) {
				this._services.set(key, serviceInfo);
				this.emit("up", serviceInfo);
			}
		});
	}

	/**
	 * Handle service removal
	 */
	private _handleDown(service: Service) {
		service.addresses?.forEach((address) => {
			const key = this._getServiceKey(address, service.port);
			const serviceInfo = this._services.get(key);

			if (serviceInfo) {
				this._services.delete(key);
				this.emit("down", serviceInfo);
			}
		});
	}

	/**
	 * Start discovery for the configured service types
	 */
	start(serviceTypes?: string[]): void {
		if (this._mdns) {
			return; // Already started
		}

		const typesToDiscover = serviceTypes || this._serviceTypes;
		if (typesToDiscover.length === 0) {
			this.emit("error", new Error("No service types specified for discovery"));
			return;
		}

		// Detect network interfaces to find the correct one for multicast
		const interfaces = networkInterfaces();
		const networkIPs: string[] = [];
		let primaryNetworkIP: string | undefined = undefined;

		// Find IPv4 addresses that are not loopback
		for (const name of Object.keys(interfaces || {})) {
			const nets = interfaces![name];
			if (nets) {
				for (const net of nets) {
					if (net.family === 'IPv4' && !net.internal && net.address) {
						networkIPs.push(net.address);
						// Prefer 192.168.x.x or 10.x.x.x ranges (common local network ranges)
						if (!primaryNetworkIP && (net.address.startsWith('192.168.') || net.address.startsWith('10.'))) {
							primaryNetworkIP = net.address;
						}
					}
				}
			}
		}

		// Use first non-loopback IP if no preferred one found
		if (!primaryNetworkIP && networkIPs.length > 0) {
			primaryNetworkIP = networkIPs[0];
		}

		// Pass multicast-dns options to enable network discovery
		// On Windows, we may need to explicitly specify the interface IP
		// On macOS, do NOT specify interface as it conflicts with mDNSResponder (EADDRINUSE on port 5353)
		const mdnsOptions: MulticastDNSOptions = {
			multicast: true, // Use UDP multicasting for network discovery
			// On Windows, explicitly setting interface may be required for network discovery
			// On macOS, omit interface to avoid bind conflicts with system mDNSResponder
			// If we found a network interface and we're not on macOS, use it; otherwise let multicast-dns decide
			...(primaryNetworkIP && platform() !== "darwin" ? { interface: primaryNetworkIP } : {}),
		};

		// For discovery/browsing, pass multicast-dns options (not service config options)
		// TypeScript types say ServiceConfig, but bonjour-service actually accepts multicast-dns options here
		// We cast to any to work around the incorrect TypeScript definition
		this._mdns = new Bonjour(mdnsOptions as any, (err: any) => {
			this.emit("error", err);
		});

		// Create browsers for each service type
		typesToDiscover.forEach((serviceType) => {
			const cleanType = this._normalizeServiceType(serviceType);
			const browser = this._mdns!.find({
				type: cleanType,
				protocol: this._protocol,
			});

			browser.on("up", (service: Service) => {
				this._handleUp(service, cleanType);
			});

			browser.on("down", (service: Service) => {
				this._handleDown(service);
			});

			this._browsers.set(cleanType, browser);
		});
	}

	/**
	 * Stop discovery and clean up
	 */
	stop(): void {
		if (!this._mdns) {
			return;
		}

		// Stop all browsers
		this._browsers.forEach((browser) => {
			browser.stop();
		});
		this._browsers.clear();

		// Destroy Bonjour instance
		this._mdns.destroy();
		this._mdns = null;

		// Clear services
		this._services.clear();
	}

	/**
	 * Get all currently discovered services
	 */
	getServices(): DiscoveredMDNSService[] {
		return Array.from(this._services.values());
	}

	/**
	 * Get services by type
	 */
	getServicesByType(type: string): DiscoveredMDNSService[] {
		const normalizedType = this._normalizeServiceType(type);
		return this.getServices().filter(
			(service) => service.type === normalizedType
		);
	}

	/**
	 * Check if discovery is running
	 */
	isRunning(): boolean {
		return this._mdns !== null;
	}
}

