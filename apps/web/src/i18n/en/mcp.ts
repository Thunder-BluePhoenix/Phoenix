// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** English text for the Phoenix MCP server settings. */
export const mcp = {
  "mcp.title": "Phoenix MCP server",
  "mcp.intro":
    "Lets coding agents and other MCP clients on this computer read some Phoenix context and ask you for approval. It is off until you turn it on, and each client gets nothing until you grant it.",
  "mcp.unavailable": "MCP server settings could not be loaded.",
  "mcp.demoUnavailable": "The MCP server is not available in demo mode.",

  "mcp.warning.title": "Before you turn this on",
  "mcp.warning.local":
    "It opens a separate listener on this computer only (127.0.0.1). Other computers and web pages cannot reach it.",
  "mcp.warning.token":
    "Each client has its own token, shown once. Any program that holds a token can use whatever you granted that client.",
  "mcp.warning.untrusted":
    "What Phoenix returns is marked as untrusted data, but a model reading it can still be misled by text inside it. Grant only what a client needs.",
  "mcp.warning.approval":
    "An approval a client asks for appears with your other agent approvals. Only you, here or on a paired phone, can answer it.",

  "mcp.enable.label": "Allow MCP clients on this computer to connect",
  "mcp.saved.on": "The MCP server is on.",
  "mcp.saved.off": "The MCP server is off.",
  "mcp.port.label": "Port",
  "mcp.port.save": "Save port",
  "mcp.port.saved": "Port saved.",
  "mcp.killSwitch":
    "The emergency stop is on: the MCP server is closed. Turn it on again here after you release the emergency stop.",
  "mcp.notListening": "The MCP server is enabled but not listening. Check that the port is free.",
  "mcp.listening.url": "Address",

  "mcp.new.title": "Add a client",
  "mcp.new.name": "Client name",
  "mcp.new.create": "Create client",
  "mcp.new.created": "Client created. It has no grants yet.",

  "mcp.token.title": "Copy this token now",
  "mcp.token.note":
    "It is shown only once and Phoenix keeps only a fingerprint of it. Put it in the client's environment as PHOENIX_MCP_TOKEN, never on a command line.",
  "mcp.token.label": "Client token",
  "mcp.token.copy": "Copy token",
  "mcp.token.copied": "Token copied.",
  "mcp.token.copyFailed": "Could not copy. Select the token and copy it by hand.",
  "mcp.token.done": "I have saved it",

  "mcp.clients.title": "Clients",
  "mcp.clients.none": "No clients yet.",
  "mcp.client.created": "Created {date}",
  "mcp.client.id": "Client ID {id} (shown on this client's approval cards)",
  "mcp.client.lastUsed": "Last used {when}",
  "mcp.client.neverUsed": "Never used",
  "mcp.client.revokedOn": "Revoked {date}",
  "mcp.client.noGrants": "No grants: this client can connect but is refused everything.",

  "mcp.grants.title": "What {name} may do",
  "mcp.grants.tools": "Read tools",
  "mcp.grants.tool.phoenix_activity": "Recent agent sessions",
  "mcp.grants.tool.phoenix_meetings": "Meeting decisions and summaries",
  "mcp.grants.tool.phoenix_graph_query": "Knowledge-graph questions",
  "mcp.grants.tool.phoenix_ci_git_state": "Git and CI state",
  "mcp.grants.tool.phoenix_memory_search": "Memory search",
  "mcp.grants.actions": "Actions",
  "mcp.grants.requestApproval": "Ask me for approval",
  "mcp.grants.notify": "Tell Fawkes its state (working, waiting, done)",
  "mcp.grants.memory": "Memory it may read",
  "mcp.grants.memory.note":
    "Memory search, graph questions and meetings only ever see the scopes below, never everything you can see.",
  "mcp.grants.memory.none": "No memory scope granted.",
  "mcp.grants.memory.scope": "Scope",
  "mcp.grants.memory.sensitivity": "Highest sensitivity",
  "mcp.grants.memory.add": "Add scope",
  "mcp.grants.memory.remove": "Remove scope {scope}",
  "mcp.grants.memory.invalid":
    "A scope is *, global, or repo:, path: or meeting: followed by text.",
  "mcp.sensitivity.public": "public",
  "mcp.sensitivity.internal": "internal",
  "mcp.sensitivity.sensitive": "sensitive (meetings)",
  "mcp.grants.save": "Save grants",
  "mcp.grants.saved": "Grants saved.",

  "mcp.revoke": "Revoke {name}",
  "mcp.revoke.ask": "Revoke {name}? It is refused immediately, even in the middle of a call.",
  "mcp.revoke.yes": "Yes, revoke",
  "mcp.revoke.no": "Keep",
  "mcp.revoke.done": "Client revoked.",
} as const;
