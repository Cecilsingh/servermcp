# MCP Server

A Model Context Protocol (MCP) server that provides read-only file system access to a configurable directory. Designed to run on remote hosts and expose file operations to MCP-compatible clients.

## Features

- Read-only access to files under a configurable base path (default: `/efs`)
- Directory traversal protection
- 10MB file size limit for safety
- Glob pattern matching for file searches

## Requirements

- Node.js >= 18.0.0

## Installation

```bash
npm install
```

## Configuration

Edit the `BASE_PATH` variable in `mcp-server.js` to change the root directory:

```javascript
const BASE_PATH = "/efs";
```

## Usage

Start the server:

```bash
npm start
```

Or run directly:

```bash
node mcp-server.js
```

## Available Tools

### list_directory

List contents of a directory.

**Parameters:**
- `path` (required): Path relative to the base directory

**Returns:** JSON with directory contents including name, type, size, and modification date.

### read_file

Read the contents of a file.

**Parameters:**
- `path` (required): Path relative to the base directory

**Returns:** File contents as text.

### search_files

Search for files by name pattern.

**Parameters:**
- `pattern` (required): Glob pattern (e.g., `*.yaml`, `config*`)
- `directory` (optional): Directory to search in (default: root)

**Returns:** JSON with matching files including path, size, and modification date.

### get_file_info

Get metadata about a file or directory.

**Parameters:**
- `path` (required): Path relative to the base directory

**Returns:** JSON with file metadata including type, size, timestamps, and permissions.

## MCP Client Configuration

Add this server to your MCP client configuration. Example for Claude Code:

```json
{
  "mcpServers": {
    "mcp-server": {
      "command": "node",
      "args": ["/path/to/mcp-server.js"]
    }
  }
}
```

For remote servers using SSH:

```json
{
  "mcpServers": {
    "remote-files": {
      "command": "ssh",
      "args": ["user@host", "node", "/path/to/mcp-server.js"]
    }
  }
}
```

## Security

- Directory traversal attacks are prevented (paths with `..` or absolute paths are rejected)
- Read-only access only (no write, delete, or execute operations)
- File size limited to 10MB

## License

MIT
