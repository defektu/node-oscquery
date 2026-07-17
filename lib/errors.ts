/**
 * Base error class for all OSCQuery-related errors
 */
export class OSCQueryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'OSCQueryError';
		Object.setPrototypeOf(this, OSCQueryError.prototype);
	}
}

/**
 * Error thrown when a path is not found in the OSC address space
 */
export class PathNotFoundError extends OSCQueryError {
	constructor(public readonly path: string) {
		super(`Path not found: ${path}`);
		this.name = 'PathNotFoundError';
		Object.setPrototypeOf(this, PathNotFoundError.prototype);
	}
}

/**
 * Error thrown when attempting to access a path that is not accessible
 */
export class PathAccessError extends OSCQueryError {
	constructor(public readonly path: string, public readonly reason: string) {
		super(`Cannot access path ${path}: ${reason}`);
		this.name = 'PathAccessError';
		Object.setPrototypeOf(this, PathAccessError.prototype);
	}
}

/**
 * Error thrown when an invalid argument index is specified
 */
export class ArgumentIndexError extends OSCQueryError {
	constructor(public readonly path: string, public readonly index: number) {
		super(`Invalid argument index ${index} for path ${path}`);
		this.name = 'ArgumentIndexError';
		Object.setPrototypeOf(this, ArgumentIndexError.prototype);
	}
}

/**
 * Error thrown when an invalid attribute is queried
 */
export class InvalidAttributeError extends OSCQueryError {
	constructor(public readonly attribute: string) {
		super(`Invalid or unsupported attribute: ${attribute}`);
		this.name = 'InvalidAttributeError';
		Object.setPrototypeOf(this, InvalidAttributeError.prototype);
	}
}

/**
 * Error thrown when a network operation fails
 */
export class NetworkError extends OSCQueryError {
	constructor(message: string, public readonly cause?: Error) {
		super(message);
		this.name = 'NetworkError';
		Object.setPrototypeOf(this, NetworkError.prototype);
	}
}

/**
 * Error thrown when serialization/deserialization fails
 */
export class SerializationError extends OSCQueryError {
	constructor(message: string, public readonly cause?: Error) {
		super(message);
		this.name = 'SerializationError';
		Object.setPrototypeOf(this, SerializationError.prototype);
	}
}
