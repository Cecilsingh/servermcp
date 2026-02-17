#!/usr/bin/env node

/**
 * MCP Server for remote host
 * Provides read access to files under /efs directory
 * Change the BASE_PATH value to adjust this for your remote server
 */

//Imports
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";

//Variable declaration
const BASE_PATH = "/efs";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit for safety

//MCP constructor
class MCPServer {
  constructor() {
    this.server = new Server(
      {
        name: "semaphore-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.setupHandlers();
  }

  setupHandlers() {
    //List the available tools from the MCP CLI
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "list_directory",
          description: "List contents of a directory under ${BASE_PATH}",
          inputSchema: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Path relative to ${BASE_PATH}",
              },
            },
            required: ["path"],
          },
        },
        {
          name: "read_file",
          description: "Read contents of a file under ${BASE_PATH}",
          inputSchema: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Path relative to ${BASE_PATH}",
              },
            },
            required: ["path"],
          },
        },
        {
          name: "search_files",
          description: "Search for files by name pattern under ${BASE_PATH}",
          inputSchema: {
            type: "object",
            properties: {
              pattern: {
                type: "string",
                description: "File name pattern to search for (e.g., '*.yaml', 'config*')",
              },
              directory: {
                type: "string",
                description: "Directory to search in, relative to ${BASE_PATH} (default: root)",
              },
            },
            required: ["pattern"],
          },
        },
        {
          name: "get_file_info",
          description: "Get metadata about a file or directory",
          inputSchema: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Path relative to ${BASE_PATH}",
              },
            },
            required: ["path"],
          },
        },
      ],
    }));

    //List the available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: "file://${BASE_PATH}/",
          name: "${BASE_PATH} Root Directory",
          description: "Root of the ${BASE_PATH} file system",
          mimeType: "application/directory",
        },
      ],
    }));

    //Read resource
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      
      if (!uri.startsWith("file://${BASE_PATH}/")) {
        throw new Error("Only file://${BASE_PATH}/ URIs are supported");
      }

      const relativePath = uri.slice("file://${BASE_PATH}/".length);
      const fullPath = this.resolvePath(relativePath);
      
      try {
        const content = await fs.readFile(fullPath, "utf-8");
        return {
          contents: [
            {
              uri,
              mimeType: "text/plain",
              text: content,
            },
          ],
        };
      } catch (error) {
        throw new Error(`Failed to read resource: ${error.message}`);
      }
    });

    //Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "list_directory":
            return await this.listDirectory(args.path);
          
          case "read_file":
            return await this.readFile(args.path);
          
          case "search_files":
            return await this.searchFiles(args.pattern, args.directory || "");
          
          case "get_file_info":
            return await this.getFileInfo(args.path);
          
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  resolvePath(relativePath) {
    //Normalize and resolve the path
    const normalized = path.normalize(relativePath);
    
    //Prevent directory traversal attacks
    if (normalized.includes("..") || path.isAbsolute(normalized)) {
      throw new Error("Invalid path: directory traversal not allowed");
    }
    
    return path.join(BASE_PATH, normalized);
  }

  async listDirectory(relativePath) {
    const fullPath = this.resolvePath(relativePath);
    
    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const items = [];

      for (const entry of entries) {
        const stats = await fs.stat(path.join(fullPath, entry.name));
        items.push({
          name: entry.name,
          type: entry.isDirectory() ? "directory" : "file",
          size: stats.size,
          modified: stats.mtime.toISOString(),
        });
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ path: relativePath, items }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to list directory: ${error.message}`);
    }
  }

  async readFile(relativePath) {
    const fullPath = this.resolvePath(relativePath);
    
    try {
      const stats = await fs.stat(fullPath);
      
      if (!stats.isFile()) {
        throw new Error("Path is not a file");
      }
      
      if (stats.size > MAX_FILE_SIZE) {
        throw new Error(`File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
      }
      
      const content = await fs.readFile(fullPath, "utf-8");
      
      return {
        content: [
          {
            type: "text",
            text: content,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to read file: ${error.message}`);
    }
  }

  async searchFiles(pattern, directory) {
    const searchPath = this.resolvePath(directory);
    const results = [];
    
    try {
      await this.searchRecursive(searchPath, pattern, results, directory);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ pattern, found: results }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to search files: ${error.message}`);
    }
  }

  async searchRecursive(dirPath, pattern, results, relativePath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relPath = path.join(relativePath, entry.name);
      
      if (entry.isDirectory()) {
        await this.searchRecursive(fullPath, pattern, results, relPath);
      } else if (this.matchPattern(entry.name, pattern)) {
        const stats = await fs.stat(fullPath);
        results.push({
          path: relPath,
          size: stats.size,
          modified: stats.mtime.toISOString(),
        });
      }
    }
  }

  matchPattern(filename, pattern) {
    //Simple glob pattern matching
    const regex = pattern
      .replace(/\./g, "\\.")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp(`^${regex}$`, "i").test(filename);
  }

  async getFileInfo(relativePath) {
    const fullPath = this.resolvePath(relativePath);
    
    try {
      const stats = await fs.stat(fullPath);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              path: relativePath,
              type: stats.isDirectory() ? "directory" : "file",
              size: stats.size,
              created: stats.birthtime.toISOString(),
              modified: stats.mtime.toISOString(),
              accessed: stats.atime.toISOString(),
              permissions: stats.mode.toString(8).slice(-3),
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get file info: ${error.message}`);
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("MCP Server running on stdio");
  }
}

// Start the server
const server = new MCPServer();
server.run().catch(console.error);
