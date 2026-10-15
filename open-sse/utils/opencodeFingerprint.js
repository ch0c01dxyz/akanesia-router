/**
 * Helpers for the OpenCode free-tier client fingerprint (v2 contract).
 *
 * Since the 2026-10-14 migration (/zen/v1 -> /inference/v1), the gate requires
 * the shell/edit/glob/grep/read quintet with the GENUINE tool definitions
 * captured from the official CLI -- description and parameters are compared
 * byte-for-byte upstream (PR jasonxu114514/opencode2api#83), so the definitions
 * below must not be reworded or reformatted. Synthesized stubs 403.
 */

/** Canonical names required by the upstream free-tier gate. */
export const FINGERPRINT_TOOL_DEFINITIONS = {
  shell: {
    description: "Execute a shell command and return its output. Commands run on Windows using powershell. Quote file paths containing spaces or special characters. Prefer dedicated tools over shell commands when possible. When output is large, the full result is saved to a file and a truncated preview is returned. Rely on automatic truncation unless filtering the output is more useful. Commands accept an optional timeout, background commands have no timeout by default. Background commands return immediately, and you will be notified when they complete.",
    parameters: {
  "additionalProperties": false,
  "properties": {
    "background": {
      "description": "Run the command in the background and return immediately (useful for dev servers and long-running builds). You do not need to use '&' at the end of the command when using this parameter. You will be notified when it completes. DO NOT poll for completion.",
      "type": "boolean"
    },
    "command": {
      "description": "Shell command string to execute",
      "type": "string"
    },
    "timeout": {
      "description": "Timeout in milliseconds. Set to 0 to disable the timeout. Defaults to 120000 for foreground commands. Background commands have no timeout by default.",
      "minimum": 0,
      "type": "integer"
    },
    "workdir": {
      "description": "Working directory to execute the command in. Defaults to the current working directory. When possible, avoid changing directories in the command and set the working directory here instead.",
      "type": "string"
    }
  },
  "required": [
    "command"
  ],
  "type": "object"
},
  },
  edit: {
    description: "Edit the contents of a file by finding and replacing exact text. When editing text from Read output, preserve the exact indentation (tabs or spaces) and omit the line-number prefix, such as `1: `. Never include the prefix in oldString or newString. Write line breaks as \\n; the file's existing CRLF or LF line endings are matched and preserved. To change line endings themselves, make oldString and newString differ only in \\r; that edit applies to the exact bytes. If there is no exact match, the edit retries while ignoring typographic quote, dash, and space variants, then trailing whitespace on each line. The edit fails if oldString is not found. By default, oldString must identify a UNIQUE location. Multiple matches FAIL unless replaceAll is true. Add more surrounding context to disambiguate, or set replaceAll to true to replace every occurrence. Use replaceAll when the change should apply to every occurrence, such as renaming a variable.",
    parameters: {
  "additionalProperties": false,
  "properties": {
    "newString": {
      "description": "Text to replace oldString with (must differ from oldString)",
      "type": "string"
    },
    "oldString": {
      "description": "Exact text to find and replace",
      "type": "string"
    },
    "path": {
      "description": "File to edit",
      "type": "string"
    },
    "replaceAll": {
      "description": "Whether to replace every occurrence of oldString. When false, oldString must match exactly once. Defaults to false.",
      "type": "boolean"
    }
  },
  "required": [
    "path",
    "oldString",
    "newString"
  ],
  "type": "object"
},
  },
  glob: {
    description: "Search file paths using a glob pattern (examples: \"**/*.ts\", \"src/**/*.tsx\").",
    parameters: {
  "additionalProperties": false,
  "properties": {
    "hidden": {
      "description": "Include hidden files and directories (default: false).",
      "type": "boolean"
    },
    "limit": {
      "description": "Maximum number of matching files to return (default: 100)",
      "exclusiveMinimum": 0,
      "type": "integer"
    },
    "path": {
      "description": "Directory to search. Defaults to the current working directory.",
      "type": "string"
    },
    "pattern": {
      "description": "Glob pattern to match files against",
      "type": "string"
    }
  },
  "required": [
    "pattern"
  ],
  "type": "object"
},
  },
  grep: {
    description: "Search file contents using ripgrep's regular expression syntax or literal text matching. Use it to locate specific code, symbols, or text patterns, and narrow searches with `path` or `include`. Returns matching file paths, line numbers, and line previews.",
    parameters: {
  "additionalProperties": false,
  "properties": {
    "caseSensitive": {
      "description": "Use case-sensitive matching (default: true).",
      "type": "boolean"
    },
    "include": {
      "description": "Glob pattern to filter files (for example, \"*.js\" or \"*.{ts,tsx}\")",
      "type": "string"
    },
    "limit": {
      "description": "Maximum number of matching lines to return (default: 100)",
      "exclusiveMinimum": 0,
      "type": "integer"
    },
    "literal": {
      "description": "Treat `pattern` as exact text instead of a regular expression (default: false).",
      "type": "boolean"
    },
    "path": {
      "description": "File or directory to search. Defaults to the current working directory.",
      "type": "string"
    },
    "pattern": {
      "description": "Regular expression or literal text to match in file contents.",
      "minLength": 1,
      "type": "string"
    }
  },
  "required": [
    "pattern"
  ],
  "type": "object"
},
  },
  read: {
    description: "Read the contents of a file or directory. Supports text files, images, and PDFs. Images and PDFs are presented directly to the model. Each text line is prefixed by its 1-based line number as <line>: <content>. The prefix is for reference and is not part of the file content. Directory entries are returned one per line. Use offset and limit to read large files or directories in sections. Prefer one larger read over many small slices, and use grep to find specific content in large files.",
    parameters: {
  "additionalProperties": false,
  "properties": {
    "limit": {
      "description": "The maximum number of lines or directory entries to read (defaults to and capped at 2000)",
      "minimum": 0,
      "type": "integer"
    },
    "offset": {
      "description": "The line or directory entry to start reading from (1-based)",
      "minimum": 0,
      "type": "integer"
    },
    "path": {
      "description": "File or directory to read",
      "type": "string"
    }
  },
  "required": [
    "path"
  ],
  "type": "object"
},
  },
};

export const OPENCODE_FINGERPRINT_TOOLS = ["shell", "edit", "glob", "grep", "read"];

// Request body -> names renamed for that request. transformRequest() mutates the
// same body object that chatCore passed into the executor, so a WeakMap keeps the
// mapping request-local without putting transport metadata on the wire.
const renamedToolNames = new WeakMap();

/** Canonical lowercase name when `name` is a quartet member; "" otherwise. */
export function fingerprintToolKey(name) {
  const lower = String(name ?? "").trim().toLowerCase();
  return OPENCODE_FINGERPRINT_TOOLS.includes(lower) ? lower : "";
}

/** Read a tool name from either flat ({name}) or chat ({function:{name}}) shape. */
function toolNameOf(tool) {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) return "";
  if (typeof tool.name === "string" && tool.name.trim()) return tool.name.trim();
  const fn = tool.function;
  if (fn && typeof fn === "object" && !Array.isArray(fn) && typeof fn.name === "string") {
    return fn.name.trim();
  }
  return "";
}

/**
 * Canonicalise only the fingerprint quartet and remove duplicate quartet
 * variants. Non-fingerprint tools are preserved verbatim, including tools whose
 * names differ only by case; they are outside OpenCode's fingerprint contract.
 *
 * @param {Array} tools
 * @returns {{ tools: Array, map: Map<string,string> }} map: sent name -> original name
 */
export function concealFingerprintToolNames(tools) {
  const map = new Map();
  if (!Array.isArray(tools) || tools.length === 0) return { tools, map };

  const seenQuartet = new Set();
  const out = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
      out.push(tool);
      continue;
    }

    const current = toolNameOf(tool);
    const key = fingerprintToolKey(current);
    if (!key) {
      out.push(tool);
      continue;
    }

    // `Bash` + `bash` is rejected upstream as a duplicate. Keep exactly one
    // declaration for each quartet member.
    if (seenQuartet.has(key)) continue;
    seenQuartet.add(key);

    if (current !== key) {
      map.set(key, current);
      const fn = tool.function && typeof tool.function === "object" && !Array.isArray(tool.function)
        ? tool.function
        : null;
      out.push(fn ? { ...tool, function: { ...fn, name: key } } : { ...tool, name: key });
    } else {
      out.push(tool);
    }
  }
  return { tools: out, map };
}

/** Append only genuinely missing quartet declarations (verbatim CLI schemas). */
export function appendMissingFingerprintTools(tools, flat) {
  const list = Array.isArray(tools) ? tools : [];
  for (const name of OPENCODE_FINGERPRINT_TOOLS) {
    if (list.some((tool) => fingerprintToolKey(toolNameOf(tool)) === name)) continue;
    const { description, parameters } = FINGERPRINT_TOOL_DEFINITIONS[name];
    list.push(flat ? {
      type: "function",
      name,
      description,
      parameters,
    } : {
      type: "function",
      function: {
        name,
        description,
        parameters,
      },
    });
  }
  return list;
}

/** Point an explicit tool_choice at a quartet member after canonicalisation. */
export function retargetToolChoice(body, map) {
  if (!body || typeof body !== "object" || !map?.size) return;
  const choice = body.tool_choice;
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) return;

  if (typeof choice.name === "string") {
    const key = fingerprintToolKey(choice.name);
    if (key && map.has(key)) body.tool_choice = { ...choice, name: key };
    return;
  }

  const fn = choice.function;
  if (fn && typeof fn === "object" && !Array.isArray(fn) && typeof fn.name === "string") {
    const key = fingerprintToolKey(fn.name);
    if (key && map.has(key)) {
      body.tool_choice = { ...choice, function: { ...fn, name: key } };
    }
  }
}

/**
 * Full request-side pass: canonicalise quartet case variants, remove duplicate
 * quartet declarations, append missing members and preserve the legacy
 * tool_choice defaults used by the OpenCode executor.
 *
 * @param {object} body
 * @param {boolean} flat - true for Responses tools ({name}), false for chat tools
 * @returns {Map<string,string>} map: sent name -> original name
 */
export function applyFingerprintTools(body, flat) {
  if (!body || typeof body !== "object") return new Map();

  const hadClientTools = Array.isArray(body.tools) && body.tools.length > 0;
  const { tools, map } = concealFingerprintToolNames(body.tools);
  body.tools = appendMissingFingerprintTools(tools, flat);
  retargetToolChoice(body, map);

  // v2 gate rejects tool_choice "none": demote it to "auto", and default the
  // no-tool case to "auto" instead of "none". Chat requests that already carry
  // caller tools keep tool_choice absent (unchanged behaviour).
  if (!body.tool_choice) {
    if (flat) body.tool_choice = "auto";
    else if (!hadClientTools) body.tool_choice = "auto";
  } else if (body.tool_choice === "none") {
    body.tool_choice = "auto";
  }

  recordRenamedToolNames(body, map);
  return map;
}

/** Store the rename map for `body`. */
export function recordRenamedToolNames(body, map) {
  if (!body || typeof body !== "object" || !map?.size) return;
  renamedToolNames.set(body, map);
}

/** Retrieve the rename map for `body`. */
export function takeRenamedToolNames(body) {
  if (!body || typeof body !== "object") return null;
  return renamedToolNames.get(body) || null;
}

// Response side -------------------------------------------------------------

/** Restore caller tool spellings in supported response/event shapes. */
export function restoreToolNames(payload, map) {
  if (!map?.size || !payload) return payload;
  if (Array.isArray(payload)) return payload.map((item) => restoreToolNames(item, map));
  if (typeof payload !== "object") return payload;

  let out = payload;
  const put = (key, value) => {
    if (out === payload) out = { ...payload };
    out[key] = value;
  };

  // Claude streaming content_block_start event.
  if (payload.type === "content_block_start") {
    const block = payload.content_block;
    if (block?.type === "tool_use" && typeof block.name === "string" && map.has(block.name)) {
      put("content_block", { ...block, name: map.get(block.name) });
    }
  }

  // Claude non-streaming message body.
  if (Array.isArray(payload.content)) {
    put("content", payload.content.map((block) =>
      block?.type === "tool_use" && typeof block.name === "string" && map.has(block.name)
        ? { ...block, name: map.get(block.name) }
        : block));
  }

  // OpenAI Chat Completions, both streaming delta and JSON message shapes.
  if (Array.isArray(payload.choices)) {
    put("choices", payload.choices.map((choice) => {
      let changed = false;
      const next = { ...choice };
      for (const holder of ["delta", "message"]) {
        const value = choice?.[holder];
        if (!value || !Array.isArray(value.tool_calls) || value.tool_calls.length === 0) continue;
        const calls = value.tool_calls.map((call) => {
          const name = call?.function?.name;
          if (typeof name === "string" && map.has(name)) {
            changed = true;
            return { ...call, function: { ...call.function, name: map.get(name) } };
          }
          return call;
        });
        next[holder] = { ...value, tool_calls: calls };
      }
      return changed ? next : choice;
    }));
  }

  // OpenAI Responses final JSON body.
  if (Array.isArray(payload.output)) {
    put("output", payload.output.map((item) =>
      item?.type === "function_call" && typeof item.name === "string" && map.has(item.name)
        ? { ...item, name: map.get(item.name) }
        : item));
  }

  // OpenAI Responses SSE events such as response.output_item.added/done.
  const item = payload.item;
  if (item?.type === "function_call" && typeof item.name === "string" && map.has(item.name)) {
    put("item", { ...item, name: map.get(item.name) });
  }

  return out;
}
