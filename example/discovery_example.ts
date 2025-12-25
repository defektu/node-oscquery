import {
	OSCQueryDiscovery,
	DiscoveredService,
	MDNSDiscovery,
	DiscoveredMDNSService,
} from "../index";

// OSCQuery discovery
const oscQueryDiscovery = new OSCQueryDiscovery();

oscQueryDiscovery.on("up", (service: DiscoveredService) => {
	console.log(`[OSCQuery] discovered service running on ${service.address}:${service.port}`);
	console.log("host info:", service.hostInfo.name, service.hostInfo.oscIp);
	// console.log("methods:", JSON.stringify(service.nodes.serialize(), null, 4));
});

oscQueryDiscovery.on("down", (service: DiscoveredService) => {
	console.log(`[OSCQuery] service removed: ${service.address}:${service.port}`);
});

oscQueryDiscovery.on("error", (error: Error) => {
	console.error("[OSCQuery] discovery error:", error.message);
});

// Generic mDNS discovery for HTTP and HTTPS services
const mdnsDiscovery = new MDNSDiscovery({
	serviceTypes: ["_http", "_https"],
	protocol: "tcp",
});

mdnsDiscovery.on("up", (service: DiscoveredMDNSService) => {
	console.log(`[mDNS] discovered ${service.fullType} service: ${service.name}`);
	console.log(`  Address: ${service.address}:${service.port}`);
	console.log(`  Host: ${service.host}`);
	if (Object.keys(service.txt).length > 0) {
		console.log(`  TXT:`, service.txt);
	}
});

mdnsDiscovery.on("down", (service: DiscoveredMDNSService) => {
	console.log(`[mDNS] service removed: ${service.name} (${service.address}:${service.port})`);
});

mdnsDiscovery.on("error", (error: Error) => {
	console.error("[mDNS] discovery error:", error.message);
});

// Start both discoveries
console.log("Starting OSCQuery discovery...");
oscQueryDiscovery.start();

console.log("Starting mDNS discovery for HTTP and HTTPS services...");
mdnsDiscovery.start();

// Graceful shutdown
process.on("SIGINT", () => {
	console.log("\nStopping discoveries...");
	oscQueryDiscovery.stop();
	mdnsDiscovery.stop();
	process.exit(0);
});