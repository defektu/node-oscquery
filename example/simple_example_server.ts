import {
	OSCQueryServer,
	OSCTypeSimple,
	OSCQAccess,
	HostInfo,
	OSCQueryServiceOptions,
} from "../index";

// this example is almost an exact copy of the example on https://github.com/Vidvox/OSCQueryProposal#oscquery-examples

const serviceOptions: OSCQueryServiceOptions = {
	serviceName: "Node*OscQuery şğüıçö",
};

const service = new OSCQueryServer(serviceOptions);

service.addMethod("/foo", {
	description: "demonstrates a read-only OSC node- single float value ranged 0-100",
	access: OSCQAccess.READONLY,
	arguments: [
		{ 
			type: OSCTypeSimple.FLOAT,
			range: { min: 0, max: 100},
		}
	]
});
service.setValue("/foo", 0, 0.5);

service.addMethod("/bar", {
	description: "demonstrates a read/write OSC node- two ints with different ranges",
	access: OSCQAccess.READWRITE,
	arguments: [
		{
			type: OSCTypeSimple.INT,
			range: { min: 0, max: 50 },
		},
		{
			type: OSCTypeSimple.INT,
			range: { min: 51, max: 100 },
		}
	]
});
service.setValue("/bar", 0, 4);
service.setValue("/bar", 1, 51);

service.addMethod("/baz", {
	description: "simple container node, with one method- qux",
});

service.addMethod("/baz/qux", {
	description: "read/write OSC node- accepts one of several string-type inputs",
	access: OSCQAccess.RW,
	arguments: [
		{
			type: OSCTypeSimple.STRING,
			range: { vals: [ "empty", "half-full", "full" ] }
		}
	]
});
service.setValue("/baz/qux", 0, "half-full");

// complex example with array types:

// service.addEndpoint("/test", {
// 	description: "array test",
// 	access: OSCQAccess.READONLY,
// 	arguments: [
// 		{ type: OSCType.STRING },
// 		{
// 			type: [ OSCType.INT, OSCType.FALSE ],
// 			range: [ { min: -100}, null ],
// 		}
// 	]
// });
// service.setValue("/test", 0, "asd");
// service.setValue("/test", 1, [ 1, false ]);

setInterval(() => {
	service.sendValue("/foo", Math.random() * 100);
}, 1000);

service.addMethod("/lfo", {
	description: "demonstrates a read-write OSC node-single float value ranged 0-100",
	access: OSCQAccess.READWRITE,
	arguments: [
		{ 
			type: OSCTypeSimple.FLOAT,
			range: { min: 0, max: 100},
		}
	]
});
service.setValue("/lfo", 0, 0.5);

let lfoPhase = 0;
const lfoFrequency = 0.5; // Hz - adjust this to change the speed of the sine wave
setInterval(() => {
	lfoPhase += (lfoFrequency * 2 * Math.PI) / 60; // 60fps
	const sineValue = (Math.sin(lfoPhase) + 1) / 2; // Convert from -1..1 to 0..1
	service.sendValue("/lfo", sineValue * 100); // Scale to 0-100 range
}, 8);

service.start();