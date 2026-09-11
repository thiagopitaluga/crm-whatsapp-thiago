// Automation tools are opt-in. Creating and editing use drafts by default;
// activation and deletion demand an explicit confirmation parameter.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WacrmClient } from '../client.js';
import { errorResult, handle, jsonResult } from './shared.js';

const stepSchema = z.object({
  step_type: z
    .string()
    .describe(
      'Automation step type, e.g. send_message, add_tag, create_deal, wait, or condition.'
    ),
  step_config: z.record(z.string(), z.unknown()).default({}),
  branches: z
    .object({
      // The CRM validates nested branch nodes before activation. Keeping these
      // values opaque here avoids a self-referential schema while still letting
      // the client send the builder's recursive step-tree format unchanged.
      yes: z.array(z.unknown()).optional(),
      no: z.array(z.unknown()).optional(),
    })
    .optional(),
});

const triggerType = z.enum([
  'new_contact_created',
  'first_inbound_message',
  'new_message_received',
  'keyword_match',
  'tag_added',
  'time_based',
  'interactive_reply',
]);

export function registerAutomationTools(
  server: McpServer,
  client: WacrmClient
): void {
  server.registerTool(
    'list_automations',
    {
      title: 'List automations',
      description:
        'List automations in the current CRM account, newest first. Returns whether each automation is active.',
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
      annotations: {
        title: 'List automations',
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    handle(async (args) => jsonResult(await client.listAutomations(args)))
  );

  server.registerTool(
    'get_automation',
    {
      title: 'Get automation',
      description: 'Read an automation and its complete nested step tree.',
      inputSchema: { id: z.string().describe('Automation id.') },
      annotations: {
        title: 'Get automation',
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    handle(async ({ id }) => jsonResult(await client.getAutomation(id)))
  );

  server.registerTool(
    'create_automation_draft',
    {
      title: 'Create automation draft',
      description:
        'Create a disabled automation draft. It will not run or contact anyone until activated with activate_automation.',
      inputSchema: {
        name: z.string().min(1),
        description: z.string().optional(),
        trigger_type: triggerType,
        trigger_config: z.record(z.string(), z.unknown()).default({}),
        steps: z.array(stepSchema).default([]),
      },
      annotations: {
        title: 'Create automation draft',
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
    handle(async (args) =>
      jsonResult(await client.createAutomation({ ...args, is_active: false }))
    )
  );

  server.registerTool(
    'update_automation',
    {
      title: 'Update automation',
      description:
        'Edit an automation name, description, trigger, or complete step tree. This tool cannot change activation state.',
      inputSchema: {
        id: z.string().describe('Automation id.'),
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        trigger_type: triggerType.optional(),
        trigger_config: z.record(z.string(), z.unknown()).optional(),
        steps: z.array(stepSchema).optional(),
      },
      annotations: {
        title: 'Update automation',
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
    handle(async ({ id, ...body }) =>
      jsonResult(await client.updateAutomation(id, body))
    )
  );

  server.registerTool(
    'activate_automation',
    {
      title: 'Activate automation',
      description:
        'Activate a validated automation. This can cause future real actions for leads, including messages, tags, deal changes, and webhooks. Use only after the user explicitly confirms activation.',
      inputSchema: {
        id: z.string().describe('Automation id.'),
        confirm: z
          .literal(true)
          .describe('Must be true after explicit user confirmation.'),
      },
      annotations: {
        title: 'Activate automation',
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
    },
    handle(async ({ id, confirm }) => {
      if (!confirm) return errorResult('Activation requires confirm: true.');
      return jsonResult(await client.updateAutomation(id, { is_active: true }));
    })
  );

  server.registerTool(
    'delete_automation',
    {
      title: 'Delete automation',
      description:
        'Permanently delete an automation and its steps. Only use after explicit user confirmation.',
      inputSchema: {
        id: z.string().describe('Automation id.'),
        confirm: z
          .literal(true)
          .describe('Must be true after explicit user confirmation.'),
      },
      annotations: {
        title: 'Delete automation',
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
    },
    handle(async ({ id, confirm }) => {
      if (!confirm) return errorResult('Deletion requires confirm: true.');
      return jsonResult(await client.deleteAutomation(id));
    })
  );
}
