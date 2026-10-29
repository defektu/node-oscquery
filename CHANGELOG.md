# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-07-17

### Added
- **Full OSCQuery Protocol Compliance**
  - `EXTENDED_TYPE` extension support for detailed type information
  - `UNIT` extension support for physical units
  - `OVERLOADS` support for methods with multiple signatures
  - `PATH_ADDED` WebSocket notifications when nodes are added
  - `PATH_REMOVED` WebSocket notifications when nodes are removed
- **EventEmitter Pattern**
  - `osc:message` event emitted when OSC messages are received
  - Public API for listening to OSC traffic
- **Enhanced Error Handling**
  - Custom error classes: `OSCQueryError`, `PathNotFoundError`, `PathAccessError`
  - `ArgumentIndexError`, `InvalidAttributeError`, `NetworkError`, `SerializationError`
- **IPv6 Support**
  - Proper handling of IPv6 addresses in mDNS discovery
  - IPv6 URL formatting for HTTP requests
- **Optional Logger System**
  - Configurable logger interface replacing console logging
  - Enables custom logging implementations
- **Comprehensive Test Suite**
  - Vitest framework integration
  - Unit tests for core functionality
  - Coverage reporting
- **Modern TypeScript**
  - Upgraded to TypeScript 5.9
  - Improved type definitions
  - Export of `OSCNode` class and error classes

### Changed
- Updated TypeScript from 4.9 to 5.9
- Improved documentation in README with correct behavior descriptions
- Enhanced WebSocket server with better notification broadcasting
- `PATH_CHANGED` now properly emits on `receiveOSCMessage()`

### Fixed
- `wsPort` documentation corrected (dynamically assigned by default)
- IPv6 address URL formatting in discovery
- README inconsistencies and outdated information
- Missing exports for `OSCNode` and error classes

### Breaking Changes
None - This release is fully backward compatible with v1.x.

---

**Note:** This is a fork of [node-oscquery](https://github.com/jangxx/node-oscquery) v1.1.1 by Jan Scheiper, with significant enhancements for full OSCQuery protocol compliance.

[2.0.0]: https://github.com/defektu/node-oscquery/compare/v1.1.3...v2.0.0
