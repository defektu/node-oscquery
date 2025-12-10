import {
	OSCQueryServer,
	OSCTypeSimple,
	OSCQAccess,
	OSCQueryServiceOptions,
} from "../index";
import * as fs from "fs";
import * as path from "path";

/**
 * Example: Create OSCQuery server from Max/MSP objects JSON
 * 
 * This example reads a JSON file containing Max/MSP Live object definitions
 * and automatically creates an OSCQuery server with methods for each object.
 */

interface MaxObject {
	index: number;
	varname: string;
	maxclass: string;
	path: string;
	type: "float" | "bool" | "enum" | "bang";
	value: number | string;
	range: {
		MIN: number;
		MAX: number;
	} | null;
	description: string;
	presentation_rect?: number[];
	min?: number;
	max?: number;
	steps?: number;
}

interface MaxObjectsData {
	[key: string]: MaxObject;
}

/**
 * Map Max/MSP type to OSC type
 */
function mapMaxTypeToOSCType(maxType: string): OSCTypeSimple {
	switch (maxType.toLowerCase()) {
		case "float":
			return OSCTypeSimple.FLOAT;
		case "bool":
		case "boolean":
			return OSCTypeSimple.INT; // Booleans in Max are 0/1, use INT
		case "enum":
			return OSCTypeSimple.INT; // Enums are typically represented as integers
		case "bang":
		case "impulse":
			return OSCTypeSimple.TRUE; // Bang/impulse can use TRUE as trigger
		default:
			return OSCTypeSimple.FLOAT; // Default fallback
	}
}

/**
 * Convert Max range format to OSCQuery range format
 */
function convertRange(
	maxRange: { MIN: number; MAX: number } | null,
	min?: number,
	max?: number
): { min: number; max: number } | undefined {
	// Prefer explicit min/max if available
	if (min !== undefined && max !== undefined) {
		return { min, max };
	}

	// Fall back to range.MIN/MAX
	if (maxRange) {
		return { min: maxRange.MIN, max: maxRange.MAX };
	}

	return undefined;
}

/**
 * Create OSCQuery server from Max objects JSON
 */
async function createServerFromMaxObjects(
	jsonPath: string,
	serviceOptions?: OSCQueryServiceOptions
) {
	// Read and parse JSON file
	const jsonContent = fs.readFileSync(jsonPath, "utf8");
	const maxObjects: MaxObjectsData = JSON.parse(jsonContent);

	// Create OSCQuery server
	const options: OSCQueryServiceOptions = {
		serviceName: "MaxObjectsOSCQuery",
		broadcast: true,
		...serviceOptions,
	};
	const service = new OSCQueryServer(options);

	console.log(`Creating OSCQuery server from ${Object.keys(maxObjects).length} Max objects...\n`);

	// Iterate through all objects and create OSC methods
	for (const [key, obj] of Object.entries(maxObjects)) {
		const oscPath = obj.path;
		const oscType = mapMaxTypeToOSCType(obj.type);
		const range = convertRange(obj.range, obj.min, obj.max);

		// Build method description
		const methodDesc: any = {
			description: obj.description || `${obj.maxclass} - ${obj.varname}`,
			access: OSCQAccess.READWRITE, // Most Max objects are read/write
			arguments: [
				{
					type: oscType,
					...(range && { range }),
				},
			],
		};

		// Add method to server
		try {
			service.addMethod(oscPath, methodDesc);

			// Set initial value
			if (obj.value !== undefined && obj.value !== null) {
				// For bang/impulse types, we don't set a value
				if (oscType !== OSCTypeSimple.TRUE || obj.type !== "bang") {
					service.setValue(oscPath, 0, obj.value);
				}
			}

			console.log(`✓ Added: ${oscPath} (${obj.type}) = ${obj.value}`);
		} catch (error) {
			console.error(`✗ Failed to add ${oscPath}:`, error);
		}
	}

	console.log(`\nServer created with ${Object.keys(maxObjects).length} methods.`);
	console.log("Starting server...\n");

	// Start the server
	const hostInfo = await service.start();

	console.log("OSCQuery Server started!");
	const httpPort = options.httpPort || hostInfo.oscPort || 5678;
	console.log(`HTTP: http://${hostInfo.oscIp || "localhost"}:${httpPort}`);
	console.log(`Service Name: ${options.serviceName || "OSCQuery"}`);

	return service;
}

// Main execution
const jsonPath = path.join(__dirname, "maxobjects.json");

createServerFromMaxObjects(jsonPath, {
	serviceName: "MaxObjectsOSCQuery",
	httpPort: 8003,
})
	.then((service) => {
		console.log("\nServer is running. Press Ctrl+C to stop.");
		// service.sendValue("/live.dial", 55);
		// send value to all clients random
		setInterval(() => {
			service.sendValue("/live.dial", Math.random() * 100);
		}, 1000);
	})
	.catch((error) => {
		console.error("Failed to start server:", error);
		process.exit(1);
	});